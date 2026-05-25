import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '../../src/shared/contracts'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'
import { selectAgentDirect } from '../setup/state-selectors'

let testApp: TestApp | undefined

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('direct agent run workflow', () => {
  it('syncs handoff, run, artifact, and event state for a mock engineer run', async () => {
    testApp = await createMockTestApp('agenthub-direct-run-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectAgentDirect(initialState, 'engineer')

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        agentId: 'engineer',
        content: '/run 请只输出一句话，不要修改文件。',
      },
    })
    const state = response.json() as AppState
    const run = [...state.agentRuns].reverse().find(item => item.agentId === 'engineer')
    const handoff = [...state.taskHandoffs].reverse().find(item => item.agentId === 'engineer')

    expect(response.statusCode).toBe(200)
    expect(run?.status).not.toBe('running')
    expect(handoff?.status).toBeTruthy()
    expect(['completed', 'partial', 'failed']).toContain(handoff?.status)
    expect(handoff?.resultRunId).toBe(run?.id)
    expect(state.artifacts.some(artifact => artifact.agentRunId === run?.id)).toBe(true)
    expect(state.workflowEvents.some(record =>
      record.event.type === 'handoff_updated' && record.event.runId === run?.id,
    )).toBe(true)
    expect(state.workflowEvents.some(record =>
      record.event.type === 'agent_finished' && record.event.runId === run?.id,
    )).toBe(true)
  })
})
