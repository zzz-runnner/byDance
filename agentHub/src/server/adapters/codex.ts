import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { isoNow } from '@shared/contracts'
import type { ServerEnv } from '../env'
import type { LocalToolGateway } from '../tool-gateway'
import { buildAgentPrompt, buildStdinPrompt, resolveCliCommand } from './command'
import { checkCodexBridge } from './codex-bridge'
import { createAgentOutputEmitter } from './stream-events'
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './types'

type CodexStreamRecord = {
  type?: string
  thread_id?: string
  item?: unknown
  usage?: unknown
  error?: unknown
  message?: unknown
}

type CodexStreamItem = {
  type?: string
  text?: string
  name?: string
  command?: string | string[]
  output?: string
  status?: string
}

/**
 * Resolves an AgentHub-local CODEX_HOME path for child Codex runs.
 * Input: configured CODEX_HOME value. Output: absolute path used only by the child process.
 */
function resolveCodexHome(codexHome: string): string {
  return path.isAbsolute(codexHome) ? codexHome : path.resolve(process.cwd(), codexHome)
}

/**
 * Builds Codex CLI config overrides for the optional DeepSeek bridge.
 * Input: server environment and the resolved model name. Output: extra CLI arguments for codex exec.
 */
function buildCodexBridgeArgs(env: ServerEnv, model: string): string[] {
  const providerPrefix = `model_providers.${env.AGENTHUB_CODEX_MODEL_PROVIDER}`
  const providerName = 'AgentHub DeepSeek Bridge'
  return [
    '--ignore-user-config',
    '-m',
    model,
    '-c',
    `model_provider=${JSON.stringify(env.AGENTHUB_CODEX_MODEL_PROVIDER)}`,
    '-c',
    `model=${JSON.stringify(model)}`,
    '-c',
    `${providerPrefix}.name=${JSON.stringify(providerName)}`,
    '-c',
    `${providerPrefix}.base_url=${JSON.stringify(env.AGENTHUB_CODEX_BRIDGE_URL)}`,
    '-c',
    `${providerPrefix}.wire_api="responses"`,
    '-c',
    `${providerPrefix}.env_key="AGENTHUB_CODEX_BRIDGE_API_KEY"`,
  ]
}

/**
 * Builds child-process environment overrides for AgentHub Codex runs.
 * Input: server environment. Output: process env visible only to the Codex child process.
 */
async function buildCodexProcessEnv(env: ServerEnv): Promise<NodeJS.ProcessEnv> {
  const codexHome = resolveCodexHome(env.AGENTHUB_CODEX_HOME)
  await mkdir(codexHome, { recursive: true })

  return {
    ...process.env,
    CODEX_HOME: codexHome,
    AGENTHUB_CODEX_BRIDGE_API_KEY: env.AGENTHUB_CODEX_BRIDGE_API_KEY,
  }
}

/**
 * Resolves the Codex model for one child-agent run.
 * Input: server environment and agent definition.
 * Output: explicit model override or the configured AgentHub default.
 */
function resolveCodexModel(env: ServerEnv, agent: AgentAdapterInput['agent']): string {
  const model = agent.model?.trim()
  if (model && model.toLowerCase() !== 'default') {
    return model
  }
  return env.AGENTHUB_CODEX_MODEL
}

/**
 * Maps AgentHub permissions to a Codex sandbox mode.
 * Input: adapter input with agent permissions. Output: Codex sandbox mode.
 */
function toCodexSandbox(input: AgentAdapterInput): string {
  if (input.agent.permissions.fileWrite && input.agent.permissionMode === 'acceptEdits') {
    return process.platform === 'win32' ? 'danger-full-access' : 'workspace-write'
  }
  return 'read-only'
}

/**
 * Reads a Codex last-message file and removes it after use.
 * Input: absolute temporary file path. Output: final assistant message text.
 */
async function readAndRemoveLastMessage(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf8')
    await unlink(filePath).catch(() => undefined)
    return content.trim()
  } catch {
    return ''
  }
}

/**
 * Converts unknown Codex command payloads into a compact display string.
 * Input: raw command payload. Output: readable command text.
 */
function formatCodexCommand(command: unknown): string | undefined {
  if (Array.isArray(command)) {
    return command.map(part => String(part)).join(' ')
  }
  return typeof command === 'string' ? command : undefined
}

/**
 * Extracts the last visible assistant message from Codex JSONL stdout.
 * Input: raw Codex stdout text. Output: final assistant text when present.
 */
function parseCodexFinalMessage(stdout: string): string | undefined {
  let finalText: string | undefined
  for (const line of stdout.split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate.startsWith('{')) {
      continue
    }
    try {
      const record = JSON.parse(candidate) as CodexStreamRecord
      const item = record.item && typeof record.item === 'object' ? (record.item as CodexStreamItem) : undefined
      if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
        finalText = item.text.trim()
      }
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  }
  return finalText
}

/**
 * Creates a readable stream bridge for Codex JSONL events.
 * Input: adapter input with run identity and optional event sink. Output: line-aware stdout/stderr emitters.
 */
function createCodexStreamBridge(input: AgentAdapterInput): {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  finish: (exitCode: number | null, timedOut: boolean) => void
} {
  const output = createAgentOutputEmitter(input)
  let stdoutBuffer = ''

  /**
   * Emits a readable child-agent output chunk.
   * Input: stream text. Output: none.
   */
  function emitReadableChunk(text: string): void {
    const trimmed = text.trimEnd()
    if (!trimmed) {
      return
    }
    output.stdout(`${trimmed}\n`)
  }

  /**
   * Emits a concise status for a completed Codex stream item.
   * Input: parsed Codex item. Output: none.
   */
  function emitCompletedItem(item: CodexStreamItem): void {
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      output.stdout(`${item.text.trimEnd()}\n`)
      return
    }
    if (item.type === 'reasoning') {
      output.stdout('\n[thinking] Codex 完成推理。\n')
      return
    }

    const command = formatCodexCommand(item.command)
    if (command) {
      output.stdout(`\n[command] ${command}\n`)
    }
    if (typeof item.output === 'string' && item.output.trim()) {
      output.stdout(`${item.output.trimEnd()}\n`)
    }
  }

  /**
   * Emits a readable update for one parsed Codex JSONL record.
   * Input: parsed Codex record. Output: none.
   */
  function handleRecord(record: CodexStreamRecord): void {
    if (record.type === 'thread.started' && typeof record.thread_id === 'string') {
      output.stdout(`[thread] Codex session ${record.thread_id}\n`)
      return
    }
    if (record.type === 'turn.started') {
      output.stdout('[turn] Codex 开始执行。\n')
      return
    }
    if (record.type === 'turn.completed') {
      output.stdout('[turn] Codex 执行完成。\n')
      return
    }
    if (record.type === 'error') {
      const message = typeof record.message === 'string'
        ? record.message
        : typeof record.error === 'string'
          ? record.error
          : 'Codex reported an error.'
      output.stderr(`${message}\n`)
      return
    }

    const item = record.item && typeof record.item === 'object' ? (record.item as CodexStreamItem) : undefined
    if (!item) {
      return
    }
    if (record.type === 'item.started') {
      if (item.type === 'reasoning') {
        output.stdout('\n[thinking] Codex 正在推理...\n')
        return
      }
      const label = item.name ?? item.type ?? 'item'
      output.stdout(`\n[${label}] Codex 开始处理。\n`)
      return
    }
    if (record.type === 'item.completed') {
      emitCompletedItem(item)
    }
  }

  /**
   * Parses buffered JSONL stdout and emits readable child-agent output.
   * Input: raw Codex stdout chunk. Output: none.
   */
  function consume(chunk: string): void {
    stdoutBuffer += chunk
    let newlineIndex = stdoutBuffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      if (line) {
        try {
          handleRecord(JSON.parse(line) as CodexStreamRecord)
        } catch {
          emitReadableChunk(line)
        }
      }
      newlineIndex = stdoutBuffer.indexOf('\n')
    }
  }

  return {
    stdout: consume,
    stderr: output.stderr,
    finish(exitCode: number | null, timedOut: boolean): void {
      const trailing = stdoutBuffer.trim()
      if (trailing) {
        try {
          handleRecord(JSON.parse(trailing) as CodexStreamRecord)
        } catch {
          emitReadableChunk(trailing)
        }
      }
      stdoutBuffer = ''
      output.finish(exitCode, timedOut)
    },
  }
}

/**
 * Builds concise process warnings for Codex runs that already produced a final answer.
 * Input: process exit code and timeout state. Output: warning log rows.
 */
function buildProcessWarnings(code: number | null, timedOut: boolean): string[] {
  const warnings: string[] = []
  if (timedOut) {
    warnings.push('warning: Codex process timed out after returning a valid final message.')
  }
  if (code !== 0 && code !== null) {
    warnings.push(`warning: Codex exited with code ${code} after returning a valid final message.`)
  }
  if (code === null) {
    warnings.push('warning: Codex process exited without a numeric code after returning a valid final message.')
  }
  return warnings
}

/**
 * Creates a Codex adapter backed by the local codex CLI.
 * Input: server environment. Output: AgentHub adapter implementation.
 */
export function createCodexAdapter(env: ServerEnv, toolGateway: LocalToolGateway): AgentAdapter {
  return {
    provider: 'codex',
    async run(input: AgentAdapterInput): Promise<AgentAdapterResult> {
      const bridgeCheck = await checkCodexBridge(env.AGENTHUB_CODEX_BRIDGE_URL)
      if (!bridgeCheck.ok) {
        return {
          status: 'failed',
          content: bridgeCheck.message,
          artifacts: [],
          logs: [
            'codex_bridge_unavailable',
            bridgeCheck.message,
          ],
        }
      }
      const outputPath = path.join(tmpdir(), `agenthub-codex-${randomUUID()}.txt`)
      const prompt = buildAgentPrompt(input.task, input.contextPackage, input.agent.outputSchema)
      const processEnv = await buildCodexProcessEnv(env)
      const model = resolveCodexModel(env, input.agent)
      const args = [
        'exec',
        ...buildCodexBridgeArgs(env, model),
        '--json',
        '--color',
        'never',
        '--cd',
        input.runtime.repoPath,
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        toCodexSandbox(input),
        '--output-last-message',
        outputPath,
        '-',
      ]
      const output = createCodexStreamBridge(input)

      const result = await toolGateway.runCommand({
        workspaceRepoPath: input.runtime.repoPath,
        cwd: input.runtime.repoPath,
        command: resolveCliCommand(env.CODEX_BIN),
        args,
        env: processEnv,
        stdin: buildStdinPrompt(input.agent.systemPrompt, prompt),
        timeoutMs: input.agent.runtimePolicy.maxRunSeconds * 1000,
        onStdout: output.stdout,
        onStderr: output.stderr,
      })
      output.finish(result.code, result.timedOut)
      const lastMessage = await readAndRemoveLastMessage(outputPath)
      const parsedFinalMessage = parseCodexFinalMessage(result.stdout)
      const content = lastMessage || parsedFinalMessage || result.stdout.trim()
      const hasFinalMessage = Boolean(lastMessage || parsedFinalMessage)
      const hasCleanStdout = Boolean(result.stdout.trim()) && result.code === 0 && !result.timedOut

      if (!content || (!hasFinalMessage && !hasCleanStdout)) {
        return {
          status: 'failed',
          content: content || result.stderr || `Codex exited with code ${result.code}.`,
          artifacts: [],
          logs: [result.stdout, result.stderr].filter(Boolean),
        }
      }

      const warnings = buildProcessWarnings(result.code, result.timedOut)
      return {
        status: warnings.length ? 'partial' : 'success',
        content,
        artifacts: [
          {
            id: `artifact-${randomUUID()}`,
            workspaceId: input.workspaceId,
            type: 'text',
            title: `${input.agent.name} 输出`,
            content,
            createdByAgentId: input.agent.id,
            createdAt: isoNow(),
          },
        ],
        logs: [...warnings, result.stderr].filter(Boolean),
      }
    },
  }
}
