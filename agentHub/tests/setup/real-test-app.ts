import type { FastifyInstance } from 'fastify'
import { createApp } from '../../src/server/app'
import { readEnv, type ServerEnv } from '../../src/server/env'
import { createTestRuntimeRoot, type TestRuntimeRoot } from './test-env'

export type RealTestApp = {
  app: FastifyInstance
  env: ServerEnv
  runtimeRoot: TestRuntimeRoot
}

/**
 * Returns whether opt-in real-agent tests should run.
 * Input: process environment. Output: true when real tests are enabled.
 */
export function realTestsEnabled(): boolean {
  return process.env.AGENTHUB_RUN_REAL_TESTS === 'true'
}

/**
 * Creates a quiet real-agent app with memory storage and an isolated runtime root.
 * Input: optional temp folder label and env overrides. Output: app, env, and cleanup handle.
 */
export async function createRealTestApp(
  label = 'agenthub-real-',
  overrides: Partial<ServerEnv> = {},
): Promise<RealTestApp> {
  const runtimeRoot = await createTestRuntimeRoot(label)
  const env: ServerEnv = {
    ...readEnv(),
    AGENTHUB_STORAGE: 'memory',
    AGENTHUB_REAL_AGENTS: true,
    AGENTHUB_RUNTIME_ROOT: runtimeRoot.path,
    ...overrides,
  }
  const app = await createApp(env, { logger: false })
  return {
    app,
    env,
    runtimeRoot,
  }
}

/**
 * Closes a real test app and removes the isolated runtime folder.
 * Input: optional real test app. Output: promise resolved after cleanup.
 */
export async function cleanupRealTestApp(testApp: RealTestApp | undefined): Promise<void> {
  await testApp?.app.close()
  await testApp?.runtimeRoot.cleanup()
}
