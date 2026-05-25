import { randomUUID } from 'node:crypto'
import { isoNow } from '@shared/contracts'
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './types'

export const mockAdapter: AgentAdapter = {
  provider: 'mock',
  /**
   * Returns deterministic local output when a real CLI is disabled or unavailable.
   * Input: standard adapter input. Output: successful synthetic adapter result.
   */
  async run(input: AgentAdapterInput): Promise<AgentAdapterResult> {
    return {
      status: 'success',
      content: [
        `${input.agent.name} 已收到任务。`,
        `任务摘要：${input.task}`,
        '当前结果来自 mock adapter，仅用于本地验证或显式 mock 模式。',
      ].join('\n'),
      artifacts: [
        {
          id: `artifact-${randomUUID()}`,
          workspaceId: input.workspaceId,
          type: 'text',
          title: `${input.agent.name} 运行摘要`,
          content: `Mock adapter generated at ${isoNow()}.`,
          createdByAgentId: input.agent.id,
          createdAt: isoNow(),
        },
      ],
      logs: ['mock adapter used'],
    }
  },
}
