import { createServer } from './server.js'
import { readConfig } from './config.js'

/**
 * Boots the local locateBackend HTTP server.
 * Input: environment-derived application config.
 * Output: listening Fastify instance.
 */
async function main(): Promise<void> {
  const config = readConfig()
  const app = createServer(config)

  await app.listen({
    host: config.host,
    port: config.port,
  })
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
