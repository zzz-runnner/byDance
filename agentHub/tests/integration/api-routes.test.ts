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
  })
})
