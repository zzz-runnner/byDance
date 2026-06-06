import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'

let testApp: TestApp | undefined

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('API routes', () => {
  it('returns health and initial state', async () => {
    testApp = await createMockTestApp('agenthub-api-')
    const health = await testApp.app.inject({ method: 'GET', url: '/api/health' })
    const state = await testApp.app.inject({ method: 'GET', url: '/api/state' })

    expect(health.statusCode).toBe(200)
    expect(health.json()).toMatchObject({ ok: true, storage: 'memory', realAgents: false })
    expect(state.statusCode).toBe(200)
    expect(state.json().workspaces.length).toBeGreaterThan(0)
  })

  it('creates a workspace with a default group conversation', async () => {
    testApp = await createMockTestApp('agenthub-api-')
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        name: 'Automated Test Workspace',
        goal: 'Exercise workspace creation.',
        workspaceType: 'dev',
      },
    })

    const state = response.json()
    const workspace = state.workspaces.find((item: { name: string }) => item.name === 'Automated Test Workspace')
    const conversation = state.conversations.find((item: { workspaceId: string; type: string }) =>
      item.workspaceId === workspace.id && item.type === 'group')

    expect(response.statusCode).toBe(200)
    expect(workspace).toBeTruthy()
    expect(conversation).toBeTruthy()
    expect(conversation.participants).toEqual([
      'user',
      'orchestrator',
      'product-manager',
      'engineer',
      'reviewer',
    ])
    expect(
      state.agents
        .filter((agent: { workspaceId: string; source: string }) =>
          agent.workspaceId === workspace.id && agent.source === 'built-in')
        .map((agent: { id: string }) => agent.id)
        .sort(),
    ).toEqual(['engineer', 'orchestrator', 'product-manager', 'reviewer'].sort())
    expect(
      state.workspaceAgentMembers
        .filter((member: { workspaceId: string }) => member.workspaceId === workspace.id)
        .every((member: { locked: boolean }) => member.locked),
    ).toBe(true)
  })

  it('keeps default workspace agents editable but not deletable', async () => {
    testApp = await createMockTestApp('agenthub-api-')
    const createResponse = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        name: 'Agent Config Workspace',
        goal: 'Exercise default agent config.',
        workspaceType: 'dev',
      },
    })
    const workspace = createResponse
      .json()
      .workspaces
      .find((item: { name: string }) => item.name === 'Agent Config Workspace')

    const updateResponse = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}/agents/engineer`,
      payload: {
        name: '工程 Agent',
        systemPrompt: 'Use this edited default configuration.',
        modelProvider: 'codex',
        model: 'default',
      },
    })
    const deleteResponse = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}/agents/engineer`,
    })

    expect(updateResponse.statusCode).toBe(200)
    expect(updateResponse.json()).toMatchObject({
      id: 'engineer',
      name: '工程 Agent',
      systemPrompt: 'Use this edited default configuration.',
      source: 'built-in',
    })
    expect(deleteResponse.statusCode).toBe(400)
  })

  it('binds a single-chat workspace to the selected direct agent', async () => {
    testApp = await createMockTestApp('agenthub-api-')
    const workspaceResponse = await testApp.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        name: 'Codex Direct Workspace',
        goal: 'Talk directly with Codex.',
        workspaceType: 'chat',
      },
    })
    const workspace = workspaceResponse
      .json()
      .workspaces
      .find((item: { name: string }) => item.name === 'Codex Direct Workspace')
    const groupResponse = await testApp.app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {
        workspaceId: workspace.id,
        type: 'group',
        title: 'Invalid group',
        participants: ['user', 'engineer'],
      },
    })
    const conversationResponse = await testApp.app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {
        workspaceId: workspace.id,
        type: 'direct',
        title: 'Codex Agent 私聊',
        participants: ['user', 'codex-direct'],
      },
    })
    const state = conversationResponse.json()
    const conversation = state.conversations.find((item: { workspaceId: string; type: string }) =>
      item.workspaceId === workspace.id && item.type === 'direct')
    const agents = state.agents.filter((agent: { workspaceId: string }) => agent.workspaceId === workspace.id)
    const members = state.workspaceAgentMembers.filter((member: { workspaceId: string }) =>
      member.workspaceId === workspace.id)
    const agentsResponse = await testApp.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/agents`,
    })

    expect(groupResponse.statusCode).toBe(400)
    expect(conversationResponse.statusCode).toBe(200)
    expect(conversation.participants).toEqual(['user', 'codex-direct'])
    expect(agents.map((agent: { id: string }) => agent.id)).toEqual(['codex-direct'])
    expect(members.map((member: { agentId: string }) => member.agentId)).toEqual(['codex-direct'])
    expect(agentsResponse.statusCode).toBe(200)
    expect(agentsResponse.json().map((agent: { id: string }) => agent.id)).toEqual(['codex-direct'])
  })
})
