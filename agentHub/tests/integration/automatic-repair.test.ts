import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '../../src/shared/contracts'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'
import { selectPrimaryGroup } from '../setup/state-selectors'

let testApp: TestApp | undefined

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('automatic repair workflow', () => {
  it('runs one engineer repair and reviewer re-check after a failed review', async () => {
    testApp = await createMockTestApp('agenthub-repair-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectPrimaryGroup(initialState)

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: 'Start implementation now with mock repair success and mock review fail.',
      },
    })
    const state = response.json() as AppState
    const newRuns = state.agentRuns.filter(run => !initialState.agentRuns.some(existing => existing.id === run.id))
    const eventTypes = state.workflowEvents.map(record => record.event.type)

    expect(response.statusCode).toBe(200)
    expect(newRuns.filter(run => run.agentId === 'engineer')).toHaveLength(2)
    expect(newRuns.filter(run => run.agentId === 'reviewer')).toHaveLength(2)
    expect(eventTypes).toContain('repair_suggested')
    expect(eventTypes).toContain('repair_started')
    expect(eventTypes).toContain('repair_finished')
    expect(state.changeSets.some(changeSet =>
      changeSet.files.some(file => file.path === 'index.html') &&
      changeSet.files.some(file => file.path === 'styles.css'),
    )).toBe(true)
  }, 120_000)
})
