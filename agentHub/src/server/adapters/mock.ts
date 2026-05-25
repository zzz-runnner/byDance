import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isoNow } from '@shared/contracts'
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './types'

/**
 * Writes deterministic mock files when a test task requests a repair success path.
 * Input: adapter input. Output: true when mock files were written.
 */
async function maybeWriteMockDelivery(input: AgentAdapterInput): Promise<boolean> {
  if (!/mock repair success|mock delivery success/i.test(input.task)) {
    return false
  }
  await mkdir(input.runtime.repoPath, { recursive: true })
  await writeFile(
    path.join(input.runtime.repoPath, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body>Mock Repair Success</body></html>',
    'utf8',
  )
  await writeFile(
    path.join(input.runtime.repoPath, 'styles.css'),
    'body { font-family: sans-serif; }',
    'utf8',
  )
  return true
}

/**
 * Returns a deterministic reviewer verdict for repair integration tests.
 * Input: adapter input. Output: verdict text when the reviewer task is test-controlled.
 */
function mockReviewerVerdict(input: AgentAdapterInput): string | undefined {
  if (input.agent.id !== 'reviewer') {
    return undefined
  }
  if (/mock review fail/i.test(input.task)) {
    return 'VERDICT: FAIL\nIssue: mock review failed and requires repair.'
  }
  if (/Review the automatic repair pass/i.test(input.task)) {
    return 'VERDICT: PASS\nThe automatic repair fixed the mocked delivery issue.'
  }
  return undefined
}

export const mockAdapter: AgentAdapter = {
  provider: 'mock',
  /**
   * Returns deterministic local output when a real CLI is disabled or unavailable.
   * Input: standard adapter input. Output: successful synthetic adapter result.
   */
  async run(input: AgentAdapterInput): Promise<AgentAdapterResult> {
    const wroteFiles = await maybeWriteMockDelivery(input)
    const reviewerVerdict = mockReviewerVerdict(input)
    return {
      status: 'success',
      content: [
        reviewerVerdict,
        `${input.agent.name} received the task.`,
        `Task summary: ${input.task}`,
        wroteFiles ? 'Mock delivery success files were written.' : undefined,
        'The current result comes from the mock adapter for local validation.',
      ].filter(Boolean).join('\n'),
      artifacts: [
        {
          id: `artifact-${randomUUID()}`,
          workspaceId: input.workspaceId,
          type: 'text',
          title: `${input.agent.name} run summary`,
          content: `Mock adapter generated at ${isoNow()}.`,
          createdByAgentId: input.agent.id,
          createdAt: isoNow(),
        },
      ],
      logs: ['mock adapter used'],
    }
  },
}
