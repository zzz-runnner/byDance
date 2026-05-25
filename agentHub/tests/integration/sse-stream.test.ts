import { afterEach, describe, expect, it } from 'vitest'
import type { AppState, WorkflowEvent } from '../../src/shared/contracts'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'
import { selectPrimaryGroup } from '../setup/state-selectors'

let testApp: TestApp | undefined

/**
 * Parses Server-Sent Events frames from a Fastify inject response.
 * Input: raw SSE body text. Output: parsed event payloads.
 */
function parseSseEvents(body: string): WorkflowEvent[] {
  return body
    .split('\n\n')
    .map(frame => frame.trim())
    .filter(Boolean)
    .map(frame => frame.split('\n').find(line => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map(line => JSON.parse(line.slice('data: '.length)) as WorkflowEvent)
}

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('messages SSE route', () => {
  it('streams workflow and assistant events for a mock chat turn', async () => {
    testApp = await createMockTestApp('agenthub-sse-')
    const state = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectPrimaryGroup(state)

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages/stream',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: '你好',
      },
    })
    const events = parseSseEvents(response.body)
    const eventTypes = events.map(event => event.type)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(eventTypes).toContain('turn_started')
    expect(eventTypes).toContain('task_stage_updated')
    expect(eventTypes).toContain('assistant_delta')
    expect(eventTypes).toContain('workflow_finished')
  })
})
