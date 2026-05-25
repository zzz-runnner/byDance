import { randomUUID } from 'node:crypto'
import type {
  AgentDefinition,
  AgentSession,
  Conversation,
  DiagnosticLog,
  RoutingTaskBrief,
  TaskHandoff,
  WorkflowEvent,
  WorkflowEventRecord,
  Workspace,
} from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import type { StateStore } from '../../store/types'
import type { TurnRoute } from '../turn-router'
import { compactText } from './workflow-utils'

type WorkflowEventHost = {
  turnId?: string
  workflowEventLog?: WorkflowEventRecord[]
  eventSink?: (event: WorkflowEvent) => void
}

type WorkflowEventPersistenceHost = WorkflowEventHost & {
  store: StateStore
  diagnosticLogBuffer?: DiagnosticLog[]
}

const WORKFLOW_EVENT_LIMIT = 1000
const HIGH_VOLUME_EVENT_LIMIT = 200

/**
 * Creates a persistable workflow event record with storage metadata.
 * Input: workflow event. Output: workflow event record.
 */
function createWorkflowEventRecord(event: WorkflowEvent): WorkflowEventRecord {
  return {
    id: `workflow-event-${randomUUID()}`,
    workspaceId: event.workspaceId,
    conversationId: event.conversationId,
    event,
    createdAt: isoNow(),
  }
}

/**
 * Shrinks high-volume live events before storing them for later replay.
 * Input: workflow event. Output: event safe for database persistence.
 */
function createPersistableWorkflowEvent(event: WorkflowEvent): WorkflowEvent {
  if (event.type === 'agent_stdout_delta' || event.type === 'agent_stderr_delta') {
    return {
      ...event,
      delta: compactText(event.delta, 600),
    }
  }
  return event
}

/**
 * Returns whether an event type can flood storage during long child-agent runs.
 * Input: workflow event record. Output: true for high-volume event records.
 */
function isHighVolumeWorkflowEvent(record: WorkflowEventRecord): boolean {
  return (
    record.event.type === 'agent_stdout_delta' ||
    record.event.type === 'agent_stderr_delta' ||
    record.event.type === 'agent_progress'
  )
}

/**
 * Keeps critical workflow events while bounding noisy streaming deltas.
 * Input: workflow event records in chronological order. Output: retained workflow events.
 */
function retainWorkflowEvents(records: WorkflowEventRecord[]): WorkflowEventRecord[] {
  if (records.length <= WORKFLOW_EVENT_LIMIT) {
    return records
  }

  const highVolume = records.filter(isHighVolumeWorkflowEvent).slice(-HIGH_VOLUME_EVENT_LIMIT)
  const criticalCapacity = Math.max(0, WORKFLOW_EVENT_LIMIT - highVolume.length)
  const critical = records.filter(record => !isHighVolumeWorkflowEvent(record)).slice(-criticalCapacity)
  return [...critical, ...highVolume]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-WORKFLOW_EVENT_LIMIT)
}

/**
 * Sends a workflow event to the optional CLI sink and in-memory event log.
 * Input: workflow services and structured event payload. Output: none.
 */
export function emitWorkflowEvent(services: WorkflowEventHost, event: WorkflowEvent): void {
  const eventWithTurn = services.turnId && !event.turnId
    ? {
        ...event,
        turnId: services.turnId,
      }
    : event
  if (eventWithTurn.type !== 'assistant_delta') {
    services.workflowEventLog?.push(createWorkflowEventRecord(createPersistableWorkflowEvent(eventWithTurn)))
  }
  services.eventSink?.(eventWithTurn)
}

/**
 * Persists workflow events after a run finishes or fails.
 * Input: workflow services. Output: promise resolved after log persistence.
 */
export async function persistWorkflowEvents(services: WorkflowEventPersistenceHost): Promise<void> {
  const workflowEventLog = services.workflowEventLog
  const diagnosticLogBuffer = services.diagnosticLogBuffer
  if (!workflowEventLog?.length && !diagnosticLogBuffer?.length) {
    return
  }

  const events = workflowEventLog ? [...workflowEventLog] : []
  const logs = diagnosticLogBuffer ? [...diagnosticLogBuffer] : []

  await services.store.update(state => {
    if (events.length) {
      state.workflowEvents.push(...events)
      if (state.workflowEvents.length > WORKFLOW_EVENT_LIMIT) {
        state.workflowEvents = retainWorkflowEvents(state.workflowEvents)
      }
    }
    if (logs.length) {
      state.diagnosticLogs.push(...logs)
      if (state.diagnosticLogs.length > 2000) {
        state.diagnosticLogs = state.diagnosticLogs.slice(-2000)
      }
    }
  })

  if (workflowEventLog) {
    workflowEventLog.length = 0
  }
  if (diagnosticLogBuffer) {
    diagnosticLogBuffer.length = 0
  }
}

/**
 * Emits the current task stage so frontends can render the workflow phase.
 * Input: workflow services, workspace, conversation, and route. Output: none.
 */
export function emitTaskStageUpdated(
  services: WorkflowEventHost,
  workspace: Workspace,
  conversation: Conversation,
  route?: TurnRoute,
): void {
  if (!route) {
    return
  }
  emitWorkflowEvent(services, {
    type: 'task_stage_updated',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    taskStage: route.taskStage,
    executionReadiness: route.executionReadiness,
    needsUserConfirmation: route.needsUserConfirmation,
    reason: route.reason,
  })
}

/**
 * Emits the self-contained task package that the main brain assigned to an agent.
 * Input: workflow services, entities, handoff, and task brief. Output: none.
 */
export function emitAgentTaskDispatched(
  services: WorkflowEventHost,
  workspace: Workspace,
  conversation: Conversation,
  agent: AgentDefinition,
  session: AgentSession,
  handoff: TaskHandoff,
  brief: RoutingTaskBrief,
): void {
  emitWorkflowEvent(services, {
    type: 'agent_task_dispatched',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    handoffId: handoff.id,
    sessionId: session.id,
    agentId: agent.id,
    agentName: agent.name,
    source: handoff.source,
    task: brief.task,
    expectedOutput: brief.expectedOutput,
    requiredContext: brief.requiredContext,
  })
}
