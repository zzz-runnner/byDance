import type { DiagnosticLog, DiagnosticLogCategory, DiagnosticLogLevel } from '@shared/contracts'
import { createDiagnosticLog } from '../../logging'
import { routeAllowsExecution, type TurnRoute } from '../turn-router'

export type LogDiagnosticInput = {
  level: DiagnosticLogLevel
  category: DiagnosticLogCategory
  workspaceId: string
  conversationId?: string
  sessionId?: string
  handoffId?: string
  runId?: string
  agentId?: string
  message: string
  data?: Record<string, unknown>
}

type DiagnosticLogHost = {
  turnId?: string
  diagnosticLogBuffer?: DiagnosticLog[]
}

/**
 * Buffers a structured diagnostic log for persistence at the end of the turn.
 * Input: workflow service log host and log details. Output: none.
 */
export function logDiagnostic(services: DiagnosticLogHost, input: LogDiagnosticInput): void {
  services.diagnosticLogBuffer?.push(
    createDiagnosticLog({
      ...input,
      turnId: services.turnId,
    }),
  )
}

/**
 * Converts route internals into a compact diagnostic payload.
 * Input: optional turn route. Output: log-safe route summary.
 */
export function summarizeTurnRoute(route?: TurnRoute): Record<string, unknown> | undefined {
  if (!route) {
    return undefined
  }
  return {
    interactionMode: route.interactionMode,
    toolPolicy: route.toolPolicy,
    size: route.size,
    risk: route.risk,
    source: route.source,
    modelProfile: route.modelProfile,
    contextProfile: route.contextProfile,
    taskStage: route.taskStage,
    executionReadiness: route.executionReadiness,
    needsUserConfirmation: route.needsUserConfirmation,
    confidence: route.confidence,
    reason: route.reason,
    constraints: route.constraints,
    allowsExecution: routeAllowsExecution(route),
  }
}
