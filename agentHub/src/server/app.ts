import Fastify from 'fastify'
import cors from '@fastify/cors'
import type { ServerEnv } from './env'
import { createStateStore } from './store'
import { createLocalToolGateway } from './tool-gateway'
import { WorkspaceRuntimeManager } from './runtime/workspace'
import { registerRoutes } from './routes'

export type CreateAppOptions = {
  logger?: boolean
}

/**
 * Creates the Fastify application with storage, runtime, adapters, and routes wired together.
 * Input: validated server environment and optional app settings. Output: configured Fastify application instance.
 */
export async function createApp(env: ServerEnv, options: CreateAppOptions = {}) {
  const store = await createStateStore(env)
  const toolGateway = createLocalToolGateway(env)
  const runtime = new WorkspaceRuntimeManager(env.AGENTHUB_RUNTIME_ROOT, toolGateway)
  const initialState = await store.read()
  await Promise.all(initialState.workspaces.map(workspace => runtime.prepareWorkspace(workspace)))

  const app = Fastify({
    logger: options.logger ?? true,
  })

  await app.register(cors, {
    origin: [`http://localhost:${env.WEB_PORT}`, `http://127.0.0.1:${env.WEB_PORT}`],
  })

  await registerRoutes(app, { env, store, runtime, toolGateway })

  app.setErrorHandler((error, request, reply) => {
    const safeError = error instanceof Error ? error : new Error(String(error))
    request.log.error(error)
    reply.status(400).send({
      error: safeError.name,
      message: safeError.message,
    })
  })

  return app
}
