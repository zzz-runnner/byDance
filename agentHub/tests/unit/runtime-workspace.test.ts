import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalToolGateway } from '../../src/server/tool-gateway'
import { WorkspaceRuntimeManager } from '../../src/server/runtime/workspace'
import { createTestWorkspace } from '../setup/state-factory'
import { createMockServerEnv, createTestRuntimeRoot, type TestRuntimeRoot } from '../setup/test-env'

let runtimeRoot: TestRuntimeRoot | undefined

/**
 * Creates a runtime manager backed by a temp root.
 * Input: none. Output: runtime manager and workspace repo metadata.
 */
async function createRuntime() {
  runtimeRoot = await createTestRuntimeRoot('agenthub-runtime-')
  const env = createMockServerEnv(runtimeRoot.path)
  const runtime = new WorkspaceRuntimeManager(runtimeRoot.path, createLocalToolGateway(env))
  const workspace = createTestWorkspace()
  const local = await runtime.prepareWorkspace(workspace)
  return { runtime, workspace, local }
}

afterEach(async () => {
  await runtimeRoot?.cleanup()
  runtimeRoot = undefined
})

describe('WorkspaceRuntimeManager', () => {
  it('opens preview assets with the expected MIME type', async () => {
    const { runtime, workspace, local } = await createRuntime()
    await writeFile(path.join(local.repoPath, 'styles.css'), 'body{}', 'utf8')

    const asset = await runtime.openPreviewAsset(workspace.id, 'styles.css')

    expect(asset.contentType).toBe('text/css; charset=utf-8')
  })

  it('rejects preview paths outside the workspace', async () => {
    const { runtime, workspace } = await createRuntime()

    await expect(runtime.openPreviewAsset(workspace.id, '../outside.txt')).rejects.toThrow(/outside the workspace/i)
  })

  it('excludes unsafe and generated folders from workspace zip files', async () => {
    const { runtime, workspace, local } = await createRuntime()
    await writeFile(path.join(local.repoPath, 'index.html'), '<h1>ok</h1>', 'utf8')
    await mkdir(path.join(local.repoPath, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(path.join(local.repoPath, 'node_modules', 'pkg', 'index.js'), 'bad', 'utf8')
    await writeFile(path.join(local.repoPath, '.env.local'), 'SECRET=bad', 'utf8')

    const archive = await runtime.buildWorkspaceZip(workspace.id)
    const entries = Object.keys(unzipSync(new Uint8Array(archive.buffer)))

    expect(entries).toContain('index.html')
    expect(entries.some(entry => entry.includes('node_modules'))).toBe(false)
    expect(entries.some(entry => entry.startsWith('.env'))).toBe(false)
    expect(entries.some(entry => entry.includes('.git'))).toBe(false)
  })
})
