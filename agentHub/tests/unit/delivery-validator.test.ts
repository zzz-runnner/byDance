import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDelivery } from '../../src/server/orchestrator/delivery/validator'
import { createTestRuntimeRoot, type TestRuntimeRoot } from '../setup/test-env'

let runtimeRoot: TestRuntimeRoot | undefined

/**
 * Creates an empty test repository folder.
 * Input: none. Output: absolute repo path.
 */
async function createRepo(): Promise<string> {
  runtimeRoot = await createTestRuntimeRoot('agenthub-validator-')
  const repoPath = path.join(runtimeRoot.path, 'repo')
  await mkdir(repoPath, { recursive: true })
  return repoPath
}

afterEach(async () => {
  await runtimeRoot?.cleanup()
  runtimeRoot = undefined
})

describe('validateDelivery', () => {
  it('passes a static site with local assets present', async () => {
    const repoPath = await createRepo()
    await writeFile(path.join(repoPath, 'index.html'), '<link rel="stylesheet" href="./styles.css">', 'utf8')
    await writeFile(path.join(repoPath, 'styles.css'), 'body{}', 'utf8')

    const result = await validateDelivery({
      repoPath,
      task: 'Create a static web page.',
      expectedOutput: 'Previewable HTML.',
      changedFiles: [{ path: 'index.html', status: 'added', additions: 1, deletions: 0 }],
    })

    expect(result.status).toBe('pass')
    expect(result.issues).toHaveLength(0)
  })

  it('reports missing static assets as partial delivery', async () => {
    const repoPath = await createRepo()
    await writeFile(path.join(repoPath, 'index.html'), '<script src="./missing.js"></script>', 'utf8')

    const result = await validateDelivery({
      repoPath,
      task: 'Create a static web page.',
      expectedOutput: 'Previewable HTML.',
      changedFiles: [{ path: 'index.html', status: 'added', additions: 1, deletions: 0 }],
    })

    expect(result.status).toBe('partial')
    expect(result.issues[0]?.message).toContain('missing')
  })

  it('detects called WeChat cloud functions that are not implemented', async () => {
    const repoPath = await createRepo()
    await writeFile(path.join(repoPath, 'project.config.json'), JSON.stringify({ cloudfunctionRoot: 'cloudfunctions' }), 'utf8')
    await mkdir(path.join(repoPath, 'pages', 'index'), { recursive: true })
    await writeFile(
      path.join(repoPath, 'pages', 'index', 'index.js'),
      "wx.cloud.callFunction({ name: 'login' })",
      'utf8',
    )

    const result = await validateDelivery({
      repoPath,
      task: 'Create a WeChat miniprogram with cloudfunction support.',
      expectedOutput: 'Cloud functions are implemented.',
      changedFiles: [{ path: 'project.config.json', status: 'added', additions: 1, deletions: 0 }],
    })

    expect(result.status).toBe('partial')
    expect(result.issues.some(issue => issue.path === 'cloudfunctions/login')).toBe(true)
  })
})
