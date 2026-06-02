import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import type { AgentDefinition, Conversation, Workspace } from '@shared/contracts'
import type { ServerEnv } from '../env'
import type { ModelGatewayRequest, ModelGatewayResponse, ModelGatewayStreamHandlers } from '../model-gateway'
import { createMockGateway } from '../model-gateway/providers/mock'
import type { WorkspaceRuntimeManager } from '../runtime/workspace'
import type { LocalToolGateway } from '../tool-gateway'
import { buildStdinPrompt, resolveCliCommand } from '../adapters/command'

type AgentModelInput = {
  env: ServerEnv
  runtime: WorkspaceRuntimeManager
  toolGateway: LocalToolGateway
  workspace: Workspace
  conversation: Conversation
  agent: AgentDefinition
  request: ModelGatewayRequest
}

/**
 * Returns the explicit agent model when configured, otherwise the provided fallback.
 * Input: agent definition and one route-derived fallback model.
 * Output: resolved model name or undefined when the provider will choose its default.
 */
export function resolveAgentConfiguredModel(
  agent: AgentDefinition,
  fallback?: string,
): string | undefined {
  const configured = agent.model?.trim()
  if (configured && configured.toLowerCase() !== 'default') {
    return configured
  }
  return fallback
}

/**
 * Streams one agent-provider response by replaying the final content in compact chunks.
 * Input: final response text and one delta handler.
 * Output: the same text after all chunks are emitted.
 */
async function emitChunkedText(
  content: string,
  handlers: ModelGatewayStreamHandlers,
): Promise<string> {
  for (let index = 0; index < content.length; index += 24) {
    await handlers.onDelta(content.slice(index, index + 24))
  }
  return content
}

/**
 * Reads and deletes one Codex last-message file.
 * Input: temporary file path.
 * Output: trimmed assistant text or an empty string.
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
 * Extracts the last visible assistant message from Codex JSONL stdout.
 * Input: raw stdout text from one Codex exec process.
 * Output: final assistant text when present.
 */
function parseCodexFinalMessage(stdout: string): string | undefined {
  let finalText: string | undefined
  for (const line of stdout.split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate.startsWith('{')) {
      continue
    }
    try {
      const record = JSON.parse(candidate) as {
        item?: {
          type?: string
          text?: string
        }
      }
      if (record.item?.type === 'agent_message' && typeof record.item.text === 'string' && record.item.text.trim()) {
        finalText = record.item.text.trim()
      }
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  }
  return finalText
}

/**
 * Builds Codex CLI config overrides for the optional DeepSeek bridge.
 * Input: server environment and one resolved model name.
 * Output: extra CLI arguments for one codex exec invocation.
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
 * Runs one real Claude lightweight prompt without enabling file or shell tools.
 * Input: agent-provider request bundle.
 * Output: normalized text response.
 */
async function runClaudeAgentModel(input: AgentModelInput): Promise<ModelGatewayResponse> {
  const runtime = await input.runtime.prepareWorkspace(input.workspace)
  const model = resolveAgentConfiguredModel(input.agent, input.request.model) ?? 'default'
  const args = [
    '-p',
    '--output-format',
    'text',
    '--no-session-persistence',
    '--permission-mode',
    'default',
    '--tools',
    '',
  ]
  if (model !== 'default') {
    args.push('--model', model)
  }

  const result = await input.toolGateway.runCommand({
    workspaceRepoPath: runtime.repoPath,
    cwd: runtime.repoPath,
    command: resolveCliCommand(input.env.CLAUDE_CODE_BIN),
    args,
    stdin: buildStdinPrompt(input.request.systemPrompt, input.request.userPrompt),
    timeoutMs: input.request.timeoutMs,
  })

  const content = result.stdout.trim()
  if (!content) {
    throw new Error(result.stderr.trim() || `Claude returned an empty response. exitCode=${result.code}`)
  }
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `Claude exited with code ${result.code}.`)
  }

  return {
    provider: 'claude',
    model,
    content,
    raw: {
      stdout: result.stdout,
      stderr: result.stderr,
    },
  }
}

/**
 * Runs one real Codex lightweight prompt in a read-only sandbox.
 * Input: agent-provider request bundle.
 * Output: normalized text response.
 */
async function runCodexAgentModel(input: AgentModelInput): Promise<ModelGatewayResponse> {
  const runtime = await input.runtime.prepareWorkspace(input.workspace)
  const model = resolveAgentConfiguredModel(input.agent, input.request.model) ?? input.env.AGENTHUB_CODEX_MODEL
  const outputPath = path.join(tmpdir(), `agenthub-light-${randomUUID()}.txt`)
  const result = await input.toolGateway.runCommand({
    workspaceRepoPath: runtime.repoPath,
    cwd: runtime.repoPath,
    command: resolveCliCommand(input.env.CODEX_BIN),
    args: [
      'exec',
      ...buildCodexBridgeArgs(input.env, model),
      '--json',
      '--color',
      'never',
      '--cd',
      runtime.repoPath,
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--output-last-message',
      outputPath,
      '-',
    ],
    env: {
      ...process.env,
      AGENTHUB_CODEX_BRIDGE_API_KEY: input.env.AGENTHUB_CODEX_BRIDGE_API_KEY,
    },
    stdin: buildStdinPrompt(input.request.systemPrompt, input.request.userPrompt),
    timeoutMs: input.request.timeoutMs,
  })

  const content = (await readAndRemoveLastMessage(outputPath)) || parseCodexFinalMessage(result.stdout) || result.stdout.trim()
  if (!content) {
    throw new Error(result.stderr.trim() || `Codex returned an empty response. exitCode=${result.code}`)
  }
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `Codex exited with code ${result.code}.`)
  }

  return {
    provider: 'codex',
    model,
    content,
    raw: {
      stdout: result.stdout,
      stderr: result.stderr,
    },
  }
}

/**
 * Generates one child-agent model response using the agent's configured provider.
 * Input: runtime services, workspace, agent, and one model request.
 * Output: normalized text response for lightweight replies or structured turns.
 */
export async function generateAgentModelResponse(input: AgentModelInput): Promise<ModelGatewayResponse> {
  if (!input.env.AGENTHUB_REAL_AGENTS || input.agent.modelProvider === 'mock') {
    return createMockGateway().generate({
      ...input.request,
      model: resolveAgentConfiguredModel(input.agent, input.request.model),
    })
  }
  if (input.agent.modelProvider === 'claude') {
    return runClaudeAgentModel(input)
  }
  if (input.agent.modelProvider === 'codex') {
    return runCodexAgentModel(input)
  }
  return createMockGateway().generate(input.request)
}

/**
 * Streams one child-agent model response using the configured provider and a chunked fallback.
 * Input: runtime services, workspace, agent, request, and stream handlers.
 * Output: normalized text response after the emitted deltas finish.
 */
export async function streamAgentModelResponse(
  input: AgentModelInput,
  handlers: ModelGatewayStreamHandlers,
): Promise<ModelGatewayResponse> {
  if (!input.env.AGENTHUB_REAL_AGENTS || input.agent.modelProvider === 'mock') {
    return createMockGateway().streamText(
      {
        ...input.request,
        model: resolveAgentConfiguredModel(input.agent, input.request.model),
      },
      handlers,
    )
  }

  const response = await generateAgentModelResponse(input)
  await emitChunkedText(response.content, handlers)
  return response
}
