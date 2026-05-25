import type { AgentDefinition } from '@shared/contracts'
import type { ServerEnv } from '../env'
import { createClaudeCodeAdapter } from './claude-code'
import { createCodexAdapter } from './codex'
import { mockAdapter } from './mock'
import type { LocalToolGateway } from '../tool-gateway'
import { createLocalToolGateway } from '../tool-gateway'
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './types'

/**
 * Selects the configured adapter for a child agent provider.
 * Input: agent definition and server environment. Output: adapter instance.
 */
export function createAdapterForAgent(
  agent: AgentDefinition,
  env: ServerEnv,
  toolGateway: LocalToolGateway = createLocalToolGateway(env),
): AgentAdapter {
  if (!env.AGENTHUB_REAL_AGENTS || agent.modelProvider === 'mock') {
    return mockAdapter
  }
  if (agent.modelProvider === 'claude') {
    return createClaudeCodeAdapter(env, toolGateway)
  }
  if (agent.modelProvider === 'codex') {
    return createCodexAdapter(env, toolGateway)
  }
  return mockAdapter
}

/**
 * Runs an agent adapter and optionally falls back to mock output on failure.
 * Input: adapter, adapter input, and fallback flag. Output: adapter result.
 */
export async function runAgentWithFallback(
  adapter: AgentAdapter,
  input: AgentAdapterInput,
  allowFallback = true,
): Promise<AgentAdapterResult> {
  try {
    const result = await adapter.run(input)
    if (result.status === 'success' || result.status === 'partial' || !allowFallback) {
      return result
    }
    const fallback = await mockAdapter.run(input)
    return {
      ...fallback,
      content: `${fallback.content}\n\n真实适配器返回失败：${result.content}`,
      logs: [...result.logs, ...fallback.logs],
    }
  } catch (error) {
    if (!allowFallback) {
      return {
        status: 'failed',
        content: `真实适配器异常：${error instanceof Error ? error.message : String(error)}`,
        artifacts: [],
        logs: ['real adapter threw'],
      }
    }
    const fallback = await mockAdapter.run(input)
    return {
      ...fallback,
      content: `${fallback.content}\n\n真实适配器异常：${error instanceof Error ? error.message : String(error)}`,
      logs: [...fallback.logs, 'real adapter threw'],
    }
  }
}
