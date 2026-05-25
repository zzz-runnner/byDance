import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '../../src/shared/contracts'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'

let testApp: TestApp | undefined

/**
 * Selects the seed group conversation used by integration tests.
 * Input: application state. Output: workspace and conversation ids.
 */
function selectPrimaryConversation(state: AppState): { workspaceId: string; conversationId: string } {
  const workspace = state.workspaces[0]
  const conversation = state.conversations.find(item => item.workspaceId === workspace.id && item.type === 'group')
  if (!conversation) {
    throw new Error('Seed group conversation not found.')
  }
  return {
    workspaceId: workspace.id,
    conversationId: conversation.id,
  }
}

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('mock workflow integration', () => {
  it('handles a direct chat turn without creating an agent run', async () => {
    testApp = await createMockTestApp('agenthub-workflow-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const target = selectPrimaryConversation(initialState)
    const initialRunCount = initialState.agentRuns.length

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        ...target,
        content: '你好',
      },
    })

    const state = response.json() as AppState
    expect(response.statusCode).toBe(200)
    expect(state.agentRuns).toHaveLength(initialRunCount)
    expect(state.messages.some(message => message.senderId === 'orchestrator')).toBe(true)
    expect(state.workflowEvents.some(record => record.event.type === 'task_stage_updated')).toBe(true)
  })

  it('guards unclear requirements so engineer runs are not created', async () => {
    testApp = await createMockTestApp('agenthub-workflow-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const target = selectPrimaryConversation(initialState)

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        ...target,
        content: '帮我做一个小程序',
      },
    })

    const state = response.json() as AppState
    expect(response.statusCode).toBe(200)
    expect(state.agentRuns.map(run => run.agentId)).not.toContain('engineer')
    expect(state.taskHandoffs.map(handoff => handoff.agentId)).not.toContain('engineer')
    expect(state.taskHandoffs.map(handoff => handoff.agentId)).toContain('product-manager')
  })

  it('creates handoff and run records for explicit direct-agent run tasks', async () => {
    testApp = await createMockTestApp('agenthub-workflow-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const workspace = initialState.workspaces[0]
    const directConversation = initialState.conversations.find(item =>
      item.workspaceId === workspace.id && item.type === 'direct' && item.participants.includes('engineer'))
    if (!directConversation) {
      throw new Error('Seed engineer direct conversation not found.')
    }

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: directConversation.id,
        agentId: 'engineer',
        content: '/run 请只输出一句话，不要修改文件。',
      },
    })

    const state = response.json() as AppState
    expect(response.statusCode).toBe(200)
    expect(state.taskHandoffs.some(handoff => handoff.agentId === 'engineer')).toBe(true)
    expect(state.agentRuns.some(run =>
      run.agentId === 'engineer' && run.logs.some(log => log.includes('mock adapter used')),
    )).toBe(true)
  })
})
