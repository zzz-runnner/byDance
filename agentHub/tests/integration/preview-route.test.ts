import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppState } from '../../src/shared/contracts'
import { cleanupTestApp, createMockTestApp, type TestApp } from '../setup/test-app'
import { selectPrimaryGroup } from '../setup/state-selectors'

let testApp: TestApp | undefined

/**
 * Returns the repo path for a workspace in a test app.
 * Input: test app and workspace id. Output: absolute repo path.
 */
function repoPathFor(testAppHandle: TestApp, workspaceId: string): string {
  return path.join(testAppHandle.runtimeRoot.path, workspaceId, 'repo')
}

afterEach(async () => {
  await cleanupTestApp(testApp)
  testApp = undefined
})

describe('preview routes', () => {
  it('serves HTML and CSS preview assets with correct content types', async () => {
    testApp = await createMockTestApp('agenthub-preview-')
    const state = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace } = selectPrimaryGroup(state)
    await writeFile(path.join(repoPathFor(testApp, workspace.id), 'styles.css'), 'body{}', 'utf8')

    const html = await testApp.app.inject({ method: 'GET', url: `/preview/${workspace.id}/index.html` })
    const css = await testApp.app.inject({ method: 'GET', url: `/preview/${workspace.id}/styles.css` })

    expect(html.statusCode).toBe(200)
    expect(html.headers['content-type']).toContain('text/html')
    expect(css.statusCode).toBe(200)
    expect(css.headers['content-type']).toContain('text/css')
  })

  it('returns an error for missing or escaped preview paths', async () => {
    testApp = await createMockTestApp('agenthub-preview-')
    const state = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace } = selectPrimaryGroup(state)

    const missing = await testApp.app.inject({ method: 'GET', url: `/preview/${workspace.id}/missing.css` })
    const escaped = await testApp.app.inject({ method: 'GET', url: `/preview/${workspace.id}/../outside.txt` })

    expect(missing.statusCode).toBe(404)
    expect(escaped.statusCode).toBeGreaterThanOrEqual(400)
  })
})
