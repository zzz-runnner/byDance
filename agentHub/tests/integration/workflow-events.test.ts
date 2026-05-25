import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '../../src/shared/contracts'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'
import { selectPrimaryGroup } from '../setup/state-selectors'

let testApp: TestApp | undefined

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('workflow event persistence', () => {
  it('replays key workflow events from state after a chat turn', async () => {
    testApp = await createMockTestApp('agenthub-events-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectPrimaryGroup(initialState)

    await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: '你好',
      },
    })
    const state = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const eventTypes = state.workflowEvents.map(record => record.event.type)

    expect(eventTypes).toContain('turn_started')
    expect(eventTypes).toContain('task_stage_updated')
    expect(eventTypes).toContain('workflow_finished')
  })
})
