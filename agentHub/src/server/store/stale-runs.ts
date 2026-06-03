import { randomUUID } from 'node:crypto'
import type { AgentDefinition, AgentRun, AppState, DiagnosticLog } from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import { resolveWorkspaceAgent } from '../agents/workspace-agents'
import type { StateStore } from './types'

const DEFAULT_STALE_SECONDS = 900

/**
 * Returns the stale-run timeout for an agent run.
 * Input: agent run and optional agent definition. Output: timeout in milliseconds.
 */
function getStaleRunTimeoutMs(run: AgentRun, agent?: AgentDefinition): number {
  const policySeconds = agent?.runtimePolicy.maxRunSeconds
  const staleSeconds = Math.max(DEFAULT_STALE_SECONDS, policySeconds ? policySeconds * 2 : DEFAULT_STALE_SECONDS)
  return staleSeconds * 1000
}

/**
 * Returns whether a running AgentRun is old enough to be recovered as failed.
 * Input: agent run, matching agent definition, and current timestamp. Output: true for stale runs.
 */
function isStaleRun(run: AgentRun, agent: AgentDefinition | undefined, nowMs: number): boolean {
  const startedMs = Date.parse(run.startedAt)
  if (!Number.isFinite(startedMs)) {
    return true
  }
  return nowMs - startedMs > getStaleRunTimeoutMs(run, agent)
}

/**
 * Creates a diagnostic log entry for stale-run recovery.
 * Input: recovered run and timestamp. Output: diagnostic log record.
 */
function createRecoveryLog(run: AgentRun, recoveredAt: string): DiagnosticLog {
  return {
    id: `diag-${randomUUID()}`,
    level: 'warn',
    category: 'store',
    workspaceId: run.workspaceId,
    conversationId: run.conversationId,
    sessionId: run.sessionId,
    handoffId: run.handoffId,
    runId: run.id,
    agentId: run.agentId,
    message: 'Recovered stale running AgentRun after process interruption.',
    data: {
      previousStatus: 'running',
      recoveredStatus: 'failed',
      startedAt: run.startedAt,
      recoveredAt,
    },
    createdAt: recoveredAt,
  }
}

/**
 * Marks stale running AgentRuns and linked handoffs as failed after startup.
 * Input: state store. Output: number of recovered runs.
 */
export async function recoverStaleAgentRuns(store: StateStore): Promise<number> {
  const nowMs = Date.now()
  const recoveredAt = isoNow()
  return store.update((state: AppState) => {
    let recoveredCount = 0
    for (const run of state.agentRuns) {
      if (run.status !== 'running') {
        continue
      }
      const agent = resolveWorkspaceAgent(state, run.workspaceId, run.agentId)
      if (!isStaleRun(run, agent, nowMs)) {
        continue
      }

      recoveredCount += 1
      run.status = 'failed'
      run.finishedAt = recoveredAt
      run.error = 'Recovered stale running AgentRun after process interruption.'
      run.logs = [
        ...run.logs,
        `recovered_stale_running_at=${recoveredAt}`,
        'recovered_reason=process interruption or server restart left this run open',
      ]

      const handoff = run.handoffId
        ? state.taskHandoffs.find(candidate => candidate.id === run.handoffId)
        : undefined
      if (handoff && handoff.status === 'running') {
        handoff.status = 'failed'
        handoff.resultRunId = handoff.resultRunId ?? run.id
        handoff.resultSummary = run.error
        handoff.updatedAt = recoveredAt
      }

      state.diagnosticLogs.push(createRecoveryLog(run, recoveredAt))
    }

    if (state.diagnosticLogs.length > 2000) {
      state.diagnosticLogs = state.diagnosticLogs.slice(-2000)
    }
    return recoveredCount
  })
}
