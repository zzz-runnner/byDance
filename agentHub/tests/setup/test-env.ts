import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import type { ServerEnv } from '../../src/server/env'

export type TestRuntimeRoot = {
  path: string
  cleanup(): Promise<void>
}

/**
 * Waits for a short interval before retrying filesystem cleanup.
 * Input: delay in milliseconds. Output: promise resolved after the delay.
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Removes a temp folder with retries for Windows process-handle delays.
 * Input: folder path and retry count. Output: promise resolved after cleanup or final failure.
 */
async function removeTempFolder(folder: string, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(folder, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === attempts) {
        throw error
      }
      await wait(250 * attempt)
    }
  }
}

/**
 * Creates a temporary runtime root for tests.
 * Input: optional label. Output: temp folder path plus cleanup callback.
 */
export async function createTestRuntimeRoot(label = 'agenthub-test-'): Promise<TestRuntimeRoot> {
  const folder = await mkdtemp(path.join(os.tmpdir(), label))
  return {
    path: folder,
    async cleanup(): Promise<void> {
      await removeTempFolder(folder)
    },
  }
}

/**
 * Builds a deterministic server env for mock-mode tests.
 * Input: runtime root and optional overrides. Output: complete ServerEnv object.
 */
export function createMockServerEnv(runtimeRoot: string, overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    PORT: 8787,
    WEB_PORT: 5173,
    AGENTHUB_STORAGE: 'memory',
    DATABASE_URL: undefined,
    CLAUDE_CODE_BIN: 'claude',
    CODEX_BIN: 'codex',
    AGENTHUB_CODEX_BRIDGE_URL: 'http://127.0.0.1:8788/v1',
    AGENTHUB_CODEX_MODEL_PROVIDER: 'agenthub-deepseek',
    AGENTHUB_CODEX_MODEL: 'deepseek-v4-pro',
    AGENTHUB_CODEX_HOME: '.codex-agenthub-test',
    AGENTHUB_CODEX_BRIDGE_API_KEY: 'agenthub-local',
    AGENTHUB_REAL_AGENTS: false,
    AGENTHUB_RUNTIME_ROOT: runtimeRoot,
    AGENTHUB_ORCHESTRATOR_PROVIDER: 'mock',
    AGENTHUB_ORCHESTRATOR_MODEL: undefined,
    AGENTHUB_ORCHESTRATOR_TIMEOUT_MS: 90_000,
    AGENTHUB_ORCHESTRATOR_MAX_TOKENS: 2_000,
    AGENTHUB_ROUTER_MODEL: 'deepseek-v4-flash',
    AGENTHUB_ROUTER_TIMEOUT_MS: 8_000,
    AGENTHUB_ROUTER_MAX_TOKENS: 500,
    DEEPSEEK_API_KEY: undefined,
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    ...overrides,
  }
}
