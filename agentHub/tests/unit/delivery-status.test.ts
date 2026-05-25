import { describe, expect, it } from 'vitest'
import { assessDelivery } from '../../src/server/orchestrator/delivery/status'
import { createTestAgent } from '../setup/state-factory'

const agent = createTestAgent()

/**
 * Builds a minimal successful adapter result for delivery status tests.
 * Input: optional content and logs. Output: adapter result object.
 */
function adapterSuccess(content = 'done', logs: string[] = []) {
  return {
    status: 'success' as const,
    content,
    artifacts: [],
    logs,
  }
}

describe('assessDelivery', () => {
  it('downgrades a successful adapter result when timeout evidence exists', () => {
    const assessment = assessDelivery({
      agent,
      task: 'Create a static page.',
      expectedOutput: 'Updated files.',
      adapterResult: adapterSuccess('final output', ['process timed out after 90s']),
      changedFiles: [{ path: 'index.html', status: 'added', additions: 10, deletions: 0 }],
    })

    expect(assessment.status).toBe('partial')
    expect(assessment.reason).toContain('timed out')
  })

  it('downgrades file-writing tasks with no changed files', () => {
    const assessment = assessDelivery({
      agent,
      task: 'Implement a web page.',
      expectedOutput: 'HTML and CSS files.',
      adapterResult: adapterSuccess(),
      changedFiles: [],
    })

    expect(assessment.status).toBe('partial')
    expect(assessment.reason).toContain('expected file changes')
  })

  it('fails when delivery validation fails', () => {
    const assessment = assessDelivery({
      agent,
      task: 'Create a static page.',
      expectedOutput: 'Valid page.',
      adapterResult: adapterSuccess(),
      changedFiles: [{ path: 'index.html', status: 'added', additions: 10, deletions: 0 }],
      validation: {
        status: 'fail',
        summary: 'Validation failed.',
        issues: [{ severity: 'blocking', message: 'Missing index.html.' }],
      },
    })

    expect(assessment.status).toBe('failed')
    expect(assessment.reason).toContain('Missing index.html')
  })
})
