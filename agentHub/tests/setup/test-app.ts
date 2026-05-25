import type { FastifyInstance } from 'fastify'
import { createApp } from '../../src/server/app'
import { createMockServerEnv, createTestRuntimeRoot, type TestRuntimeRoot } from './test-env'

export type TestApp = {
  app: FastifyInstance
  runtimeRoot: TestRuntimeRoot
}

/**
 * Creates a quiet Fastify app with memory storage and mock agents.
 * Input: optional temp folder label. Output: app instance and runtime root cleanup handle.
 */
export async function createMockTestApp(label = 'agenthub-app-'): Promise<TestApp> {
  const runtimeRoot = await createTestRuntimeRoot(label)
  const app = await createApp(createMockServerEnv(runtimeRoot.path), { logger: false })
  return {
    app,
    runtimeRoot,
  }
}

/**
 * Closes a test app and removes its runtime folder.
 * Input: optional test app handle. Output: promise resolved after cleanup.
 */
export async function cleanupTestApp(testApp: TestApp | undefined): Promise<void> {
  await testApp?.app.close()
  await testApp?.runtimeRoot.cleanup()
}
