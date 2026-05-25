import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '../../src/shared/contracts'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'
import { selectPrimaryGroup } from '../setup/state-selectors'

let testApp: TestApp | undefined

/**
 * Returns zip entry names from an HTTP zip response.
 * Input: raw response payload. Output: archive entry names.
 */
function zipEntries(payload: Buffer): string[] {
  return Object.keys(unzipSync(new Uint8Array(payload)))
}

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('workspace zip route', () => {
  it('downloads a zip, excludes unsafe folders, and records zip events', async () => {
    testApp = await createMockTestApp('agenthub-zip-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace } = selectPrimaryGroup(initialState)
    const repoPath = path.join(testApp.runtimeRoot.path, workspace.id, 'repo')
    await writeFile(path.join(repoPath, 'app.js'), 'console.log("ok")', 'utf8')
    await writeFile(path.join(repoPath, '.env.local'), 'SECRET=bad', 'utf8')
    await mkdir(path.join(repoPath, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(path.join(repoPath, 'node_modules', 'pkg', 'index.js'), 'bad', 'utf8')

    const response = await testApp.app.inject({ method: 'GET', url: `/api/workspaces/${workspace.id}/zip` })
    const state = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const entries = zipEntries(response.rawPayload)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/zip')
    expect(entries).toContain('app.js')
    expect(entries.some(entry => entry.includes('node_modules'))).toBe(false)
    expect(entries.some(entry => entry.startsWith('.env'))).toBe(false)
    expect(entries.some(entry => entry.includes('.git'))).toBe(false)
    expect(state.artifacts.some(artifact => artifact.type === 'zip')).toBe(true)
    expect(state.workflowEvents.some(record => record.event.type === 'zip_ready')).toBe(true)
  })
})
