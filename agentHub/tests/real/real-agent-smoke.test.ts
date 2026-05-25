import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '../../src/shared/contracts'
import { cleanupRealTestApp, createRealTestApp, realTestsEnabled, type RealTestApp } from '../setup/real-test-app'
import { selectAgentDirect } from '../setup/state-selectors'

let testApp: RealTestApp | undefined

afterEach(async () => {
  await cleanupRealTestApp(testApp)
  testApp = undefined
})

/**
 * Returns true when a file is present in the temporary runtime repo.
 * Input: absolute file path. Output: true when the file can be accessed.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

describe.skipIf(!realTestsEnabled())('real agent smoke', () => {
  it('runs a short real engineer task when explicitly enabled', async () => {
    testApp = await createRealTestApp()
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectAgentDirect(initialState, 'engineer')
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        agentId: 'engineer',
        content: '/run Return exactly this sentence and do not read or write files or run commands: Real child agent smoke completed.',
      },
    })
    const state = response.json() as AppState

    expect(response.statusCode).toBe(200)
    expect(state.agentRuns.some(run => run.agentId === 'engineer' && run.provider !== 'mock')).toBe(true)
  }, 180_000)

  it('creates real static page files in an isolated workspace', async () => {
    testApp = await createRealTestApp()
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectAgentDirect(initialState, 'engineer')
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        agentId: 'engineer',
        content: [
          '/run Create a minimal static web page in the current workspace. Write only index.html and styles.css.',
          'index.html must reference ./styles.css and contain the exact title text Real Agent File Smoke.',
          'styles.css should contain a few basic styles. Do not start a server, install dependencies, or modify other files.',
        ].join(' '),
      },
    })
    const state = response.json() as AppState
    const repoPath = path.join(testApp.runtimeRoot.path, workspace.id, 'repo')
    const indexPath = path.join(repoPath, 'index.html')
    const stylesPath = path.join(repoPath, 'styles.css')
    const latestRun = [...state.agentRuns].reverse().find(run => run.agentId === 'engineer')
    const indexContent = await readFile(indexPath, 'utf8')

    expect(response.statusCode).toBe(200)
    expect(await fileExists(indexPath)).toBe(true)
    expect(await fileExists(stylesPath)).toBe(true)
    expect(indexContent).toContain('Real Agent File Smoke')
    expect(latestRun?.status).not.toBe('running')
    expect(state.changeSets.some(changeSet =>
      changeSet.agentRunId === latestRun?.id &&
      changeSet.files.some(file => file.path === 'index.html') &&
      changeSet.files.some(file => file.path === 'styles.css'),
    )).toBe(true)
    expect(state.workflowEvents.some(record =>
      record.event.type === 'change_set_created' && record.event.runId === latestRun?.id,
    )).toBe(true)
    expect(state.workflowEvents.some(record =>
      record.event.type === 'preview_ready' && record.event.runId === latestRun?.id,
    )).toBe(true)
  }, 240_000)
})
