import { readEnv } from './env'
import { createApp } from './app'

/**
 * Starts the local AgentHub API server.
 * Input: process environment. Output: listening Fastify server.
 */
async function main(): Promise<void> {
  const env = readEnv()
  const app = await createApp(env)
  await app.listen({
    port: env.PORT,
    host: '0.0.0.0',
  })
  app.server.requestTimeout = 0
  app.server.headersTimeout = 0
  app.server.keepAliveTimeout = 75_000
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
