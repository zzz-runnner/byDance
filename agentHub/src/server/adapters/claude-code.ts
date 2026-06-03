import { randomUUID } from 'node:crypto'
import { isoNow } from '@shared/contracts'
import type { ServerEnv } from '../env'
import type { LocalToolGateway } from '../tool-gateway'
import { buildAgentPrompt, buildStdinPrompt, resolveCliCommand } from './command'
import { createAgentOutputEmitter } from './stream-events'
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './types'

type ClaudeResult = {
  result?: string
  is_error?: boolean
  subtype?: string
}

type ClaudeStreamRecord = {
  type?: string
  result?: string
  is_error?: boolean
  subtype?: string
  event?: unknown
  message?: unknown
}

type ClaudeStreamEvent = {
  type?: string
  content_block?: unknown
  delta?: unknown
}

/**
 * Extracts assistant text from Claude's final assistant payload.
 * Input: raw assistant message object. Output: concatenated text content.
 */
function extractAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') {
    return undefined
  }

  const record = message as Record<string, unknown>
  const content = record.content
  if (!Array.isArray(content)) {
    return undefined
  }

  const text = content
    .flatMap(block => {
      if (!block || typeof block !== 'object') {
        return []
      }
      const blockRecord = block as Record<string, unknown>
      return typeof blockRecord.text === 'string' ? [blockRecord.text] : []
    })
    .join('')
    .trim()

  return text || undefined
}

/**
 * Normalizes one parsed Claude payload into a final result when possible.
 * Input: parsed JSON payload. Output: simplified Claude result or undefined.
 */
function extractClaudeResult(payload: unknown): ClaudeResult | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined
  }

  const record = payload as ClaudeStreamRecord
  if (typeof record.result === 'string') {
    return {
      result: record.result,
      is_error: record.is_error,
      subtype: record.subtype,
    }
  }

  if (record.type === 'assistant') {
    const text = extractAssistantText(record.message)
    if (text) {
      return {
        result: text,
        is_error: record.is_error,
        subtype: record.subtype,
      }
    }
  }

  return undefined
}

/**
 * Parses Claude Code JSON output from either a full stdout payload or a JSON line.
 * Input: raw stdout text. Output: parsed Claude result when available.
 */
function parseClaudeResult(stdout: string): ClaudeResult | undefined {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed)
    return extractClaudeResult(parsed)
  } catch {
    // Continue with line-based parsing for CLIs that print extra diagnostics.
  }

  for (const line of trimmed.split(/\r?\n/).reverse()) {
    const candidate = line.trim()
    if (!candidate.startsWith('{')) {
      continue
    }
    try {
      const parsed = JSON.parse(candidate)
      const result = extractClaudeResult(parsed)
      if (result) {
        return result
      }
    } catch {
      // Ignore non-result JSON-looking diagnostics.
    }
  }

  return undefined
}

/**
 * Creates a readable stream bridge for Claude's stream-json output.
 * Input: adapter input with run identity and optional event sink. Output: line-aware stdout/stderr emitters.
 */
function createClaudeStreamBridge(input: AgentAdapterInput): {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  finish: (exitCode: number | null, timedOut: boolean) => void
} {
  const output = createAgentOutputEmitter(input)
  let stdoutBuffer = ''
  let sawTextDelta = false

  /**
   * Emits a readable chunk into the child-agent output stream.
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
   * Handles a parsed Claude stream event and emits human-readable deltas.
   * Input: parsed stream event payload. Output: none.
   */
  function handleStreamEvent(event: ClaudeStreamEvent): void {
    if (event.type === 'content_block_start') {
      const contentBlock = event.content_block && typeof event.content_block === 'object' ? (event.content_block as Record<string, unknown>) : undefined
      const blockType = typeof contentBlock?.type === 'string' ? contentBlock.type : undefined
      if (blockType === 'thinking') {
        output.stdout('\n[thinking] 子 Agent 正在推理...\n')
      } else if (blockType === 'tool_use') {
        const toolName = typeof contentBlock?.name === 'string' ? contentBlock.name : 'unknown'
        output.stdout(`\n[tool:${toolName}]\n`)
      } else if (blockType === 'text') {
        output.stdout('\n')
      }
      return
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta && typeof event.delta === 'object' ? (event.delta as Record<string, unknown>) : undefined
      if (!delta) {
        return
      }
      const deltaType = typeof delta?.type === 'string' ? delta.type : undefined
      if (deltaType === 'thinking_delta') {
        return
      }
      if (deltaType === 'text_delta' && typeof delta.text === 'string') {
        sawTextDelta = true
        output.stdout(delta.text)
        return
      }
      if (deltaType === 'input_json_delta') {
        const partial = typeof delta.partial_json === 'string'
          ? delta.partial_json
          : typeof delta.input === 'string'
            ? delta.input
            : undefined
        if (partial) {
          output.stdout(partial)
        }
      }
    }
  }

  /**
   * Parses buffered stream-json lines and emits readable chunks.
   * Input: raw stdout chunk from Claude. Output: none.
   */
  function consume(chunk: string): void {
    stdoutBuffer += chunk
    let newlineIndex = stdoutBuffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
      if (line) {
        try {
          const parsed = JSON.parse(line) as ClaudeStreamRecord
          if (parsed.type === 'stream_event' && parsed.event && typeof parsed.event === 'object') {
            handleStreamEvent(parsed.event as ClaudeStreamEvent)
          } else if (parsed.type === 'result' && !sawTextDelta && typeof parsed.result === 'string') {
            output.stdout(parsed.result)
          }
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
          const parsed = JSON.parse(trailing) as ClaudeStreamRecord
          if (parsed.type === 'stream_event' && parsed.event && typeof parsed.event === 'object') {
            handleStreamEvent(parsed.event as ClaudeStreamEvent)
          } else if (parsed.type === 'result' && !sawTextDelta && typeof parsed.result === 'string') {
            output.stdout(parsed.result)
          }
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
 * Builds concise process warnings without turning a valid model result into failure.
 * Input: process exit code and timeout state. Output: warning log rows.
 */
function buildProcessWarnings(code: number | null, timedOut: boolean): string[] {
  const warnings: string[] = []
  if (timedOut) {
    warnings.push('warning: Claude Code process timed out after returning a valid result.')
  }
  if (code !== 0 && code !== null) {
    warnings.push(`warning: Claude Code exited with code ${code} after returning a valid result.`)
  }
  if (code === null) {
    warnings.push('warning: Claude Code process exited without a numeric code after returning a valid result.')
  }
  return warnings
}

/**
 * Maps AgentHub permission mode to Claude Code print-mode permission mode.
 * Input: AgentHub permission mode. Output: Claude Code permission mode.
 */
function toClaudePermissionMode(mode: AgentAdapterInput['agent']['permissionMode']): string {
  if (mode === 'acceptEdits') {
    return 'acceptEdits'
  }
  if (mode === 'dangerous') {
    return 'bypassPermissions'
  }
  return 'default'
}

/**
 * Builds Claude Code tool allowlist flags from AgentHub permissions.
 * Input: child-agent definition. Output: CLI arguments that constrain available tools.
 */
function buildAllowedToolArgs(agent: AgentAdapterInput['agent']): string[] {
  const tools = ['Read', 'Glob', 'Grep']
  if (agent.permissions.shell) {
    tools.push('Bash')
  }
  if (agent.permissions.fileWrite) {
    tools.push('Edit', 'MultiEdit', 'Write')
  }
  return ['--allowedTools', tools.join(',')]
}

/**
 * Resolves the Claude model flag for one AgentHub child-agent run.
 * Input: child-agent definition.
 * Output: CLI arguments that keep the default model unless an explicit override exists.
 */
function buildClaudeModelArgs(agent: AgentAdapterInput['agent']): string[] {
  const model = agent.model?.trim()
  if (!model || model.toLowerCase() === 'default') {
    return []
  }
  return ['--model', model]
}

/**
 * Creates a Claude Code adapter backed by the local claude CLI.
 * Input: server environment. Output: AgentHub adapter implementation.
 */
export function createClaudeCodeAdapter(env: ServerEnv, toolGateway: LocalToolGateway): AgentAdapter {
  return {
    provider: 'claude',
    async run(input: AgentAdapterInput): Promise<AgentAdapterResult> {
      const prompt = buildAgentPrompt(input.task, input.contextPackage, input.agent.outputSchema)
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--no-session-persistence',
        ...buildClaudeModelArgs(input.agent),
        '--permission-mode',
        toClaudePermissionMode(input.agent.permissionMode),
        ...buildAllowedToolArgs(input.agent),
      ]
      const output = createClaudeStreamBridge(input)

      const result = await toolGateway.runCommand({
        workspaceRepoPath: input.runtime.repoPath,
        cwd: input.runtime.repoPath,
        command: resolveCliCommand(env.CLAUDE_CODE_BIN),
        args,
        stdin: buildStdinPrompt(input.agent.systemPrompt, prompt),
        timeoutMs: input.agent.runtimePolicy.maxRunSeconds * 1000,
        onStdout: output.stdout,
        onStderr: output.stderr,
      })
      output.finish(result.code, result.timedOut)

      const parsed = parseClaudeResult(result.stdout)
      const content = parsed?.result?.trim() || result.stdout.trim()
      if (!content) {
        return {
          status: 'failed',
          content: result.stderr || `Claude Code returned an empty response. exitCode=${result.code}`,
          artifacts: [],
          logs: [result.stdout, result.stderr].filter(Boolean),
        }
      }

      const hasValidParsedResult = Boolean(parsed?.result?.trim())
      const failedByModel = parsed?.is_error === true
      const failedByProcess = !hasValidParsedResult && (result.code !== 0 || result.timedOut)
      if (failedByModel || failedByProcess) {
        return {
          status: 'failed',
          content: failedByModel ? content : result.stderr || `Claude Code exited with code ${result.code}.`,
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
