import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app'
import { readEnv } from '../../src/server/env'
import type { AppState } from '../../src/shared/contracts'
import type { TestRuntimeRoot } from '../setup/test-env'
import { createTestRuntimeRoot } from '../setup/test-env'
import { selectAgentDirect } from '../setup/state-selectors'

let runtimeRoot: TestRuntimeRoot | undefined

/**
 * Returns whether real-agent tests are explicitly enabled.
 * Input: process environment. Output: true when real tests should run.
 */
function realTestsEnabled(): boolean {
  return process.env.AGENTHUB_RUN_REAL_TESTS === 'true'
}

afterEach(async () => {
  await runtimeRoot?.cleanup()
  runtimeRoot = undefined
})

/**
 * Creates a real-agent test app with an isolated temporary runtime root.
 * Input: none. Output: app, env, and runtime root for a real-agent smoke run.
 */
async function createRealAgentApp() {
  runtimeRoot = await createTestRuntimeRoot('agenthub-real-')
  const env = readEnv({
    ...process.env,
    AGENTHUB_STORAGE: 'memory',
    AGENTHUB_REAL_AGENTS: 'true',
    AGENTHUB_RUNTIME_ROOT: runtimeRoot.path,
  })
  const app = await createApp(env, { logger: false })
  return { app, env }
}

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
    const { app } = await createRealAgentApp()
    try {
      const initialState = (await app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
      const { workspace, conversation } = selectAgentDirect(initialState, 'engineer')
      const response = await app.inject({
        method: 'POST',
        url: '/api/messages',
        payload: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          agentId: 'engineer',
          content: '/run 请只输出一句话：真实子 Agent 测试完成。不要读写文件，不要运行命令。',
        },
      })
      const state = response.json() as AppState

      expect(response.statusCode).toBe(200)
      expect(state.agentRuns.some(run => run.agentId === 'engineer' && run.provider !== 'mock')).toBe(true)
    } finally {
      await app.close()
    }
  }, 180_000)

  it('creates real static page files in an isolated workspace', async () => {
    const { app } = await createRealAgentApp()
    try {
      const initialState = (await app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
      const { workspace, conversation } = selectAgentDirect(initialState, 'engineer')
      const response = await app.inject({
        method: 'POST',
        url: '/api/messages',
        payload: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          agentId: 'engineer',
          content: [
            '/run 请在当前 workspace 创建一个极简静态网页，只写入两个文件：index.html 和 styles.css。',
            'index.html 必须引用 ./styles.css，并包含标题文字 Real Agent File Smoke。',
            'styles.css 写入少量基础样式即可。不要启动服务，不要安装依赖，不要修改其他文件。',
          ].join(' '),
        },
      })
      const state = response.json() as AppState
      const repoPath = path.join(runtimeRoot?.path ?? '', workspace.id, 'repo')
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
    } finally {
      await app.close()
    }
  }, 240_000)
})
