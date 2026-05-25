import type { ServerEnv } from '../env'
import { createDeepSeekGateway } from './providers/deepseek'
import { createMockGateway } from './providers/mock'
import type { ModelGateway } from './types'

/**
 * Creates the configured model gateway for Orchestrator planning.
 * Input: validated server environment. Output: model gateway implementation.
 */
export function createModelGateway(env: ServerEnv): ModelGateway {
  if (env.AGENTHUB_ORCHESTRATOR_PROVIDER === 'mock') {
    return createMockGateway()
  }
  return createDeepSeekGateway(env)
}

export type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse, ModelGatewayStreamHandlers } from './types'
