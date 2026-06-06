import { randomUUID } from 'node:crypto'
import type {
  AgentDefinition,
  AgentRun,
  AgentSession,
  AppState,
  Artifact,
  ChangeSet,
  ChangedFile,
  Conversation,
  ContextSnapshot,
  DiagnosticLog,
  RoutingTaskBrief,
  SendMessageInput,
  TaskHandoff,
  WorkflowEvent,
  WorkflowEventRecord,
  Workspace,
} from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import type { ServerEnv } from '../env'
import { createAdapterForAgent, runAgentWithFallback } from '../adapters'
import {
  findMentionedAgentIds,
  ORCHESTRATOR_AGENT_ID,
  resolveAgentDisplayName,
  stripLeadingAgentMention,
  stripLeadingOrchestratorMention,
} from '../agents/agent-presentation'
import { resolveConversationAgents, resolveWorkspaceAgent, resolveWorkspaceAgents } from '../agents/workspace-agents'
import type { StateStore } from '../store/types'
import { WorkspaceRuntimeManager } from '../runtime/workspace'
import type { LocalToolGateway } from '../tool-gateway'
import { buildAgentContextAssembly, buildSynthesisContextPackage } from './context'
import {
  createArtifactCreatedEvent,
  createChangeSetCreatedEvent,
  createPreviewReadyEvent,
  sliceChangedFiles,
} from './artifacts'
import { decideRoutingWithPlanner, type PlannedRoutingDecision } from './planner'
import { selectDynamicVisibleSpeaker } from './dynamic-speaker-selection'
import { resolveReplyContinuationAgentId } from './reply-context'
import { synthesizeLocally, synthesizeWithMainBrain, type PlannedSynthesis } from './synthesis'
import { runAutomaticRepairIfNeeded, type TaskBriefRunResult } from './repair'
import {
  completeTaskHandoff,
  createTaskHandoff,
  ensureAgentSession,
  markTaskHandoffRunning,
  runAgentSessionTurn,
} from './agent-session'
import { routeAllowsExecution, routeTurnLocally, routeTurnWithModel, type TurnRoute } from './turn-router'
import {
  emitAndPersistStaticAssistantReply,
  streamAndPersistAgentReply,
  streamAndPersistMainBrainReply,
  streamAndPersistSynthesisReply,
} from './workflow/assistant-replies'
import { logDiagnostic, summarizeTurnRoute } from './workflow/diagnostics'
import {
  emitAgentTaskDispatched,
  emitTaskStageUpdated,
  emitWorkflowEvent,
  persistWorkflowEvents,
} from './workflow/workflow-events'
import {
  compactText,
  createMessage,
  diffRepoSnapshots,
  readRepoSnapshot,
  requiredById,
} from './workflow/workflow-utils'
import {
  resolveVisibleTurn,
  shouldPersistChildRunAsConversationMessage,
} from './workflow/visible-speaker'
import { assessDelivery, formatRunStatus, toHandoffStatus } from './delivery/status'
import {
  deliveryDiagnosticLevel,
  runDeliveryValidation,
  runReviewVerdictParsing,
} from './delivery/checks'
import type { DeliveryAssessment } from './delivery/types'

export type { WorkflowEvent } from '@shared/contracts'

export type WorkflowServices = {
  env: ServerEnv
  store: StateStore
  runtime: WorkspaceRuntimeManager
  toolGateway: LocalToolGateway
  eventSink?: (event: WorkflowEvent) => void
  workflowEventLog?: WorkflowEventRecord[]
  diagnosticLogBuffer?: DiagnosticLog[]
  turnId?: string
}

type TaskRunSessionScope = {
  session: AgentSession
  handoff: TaskHandoff
}

type ExplicitAgentLock = {
  lockedAgentId?: string
  errorResponse?: string
}

/**
 * Resolves the current orchestrator display name from the active agent registry.
 * Input: current agent definitions.
 * Output: display-ready orchestrator name.
 */
function orchestratorDisplayName(agents: AgentDefinition[]): string {
  return resolveAgentDisplayName(agents, ORCHESTRATOR_AGENT_ID)
}

/**
 * Resolves whether the current group-turn content explicitly locks execution to one agent.
 * Input: raw content, conversation shape, available agents, and optional direct-room target id.
 * Output: one locked agent id or a user-facing validation error.
 */
function resolveExplicitAgentLock(
  content: string,
  conversation: Conversation,
  agents: AgentDefinition[],
  activeAgentId?: string,
): ExplicitAgentLock {
  if (conversation.type === 'direct' && activeAgentId) {
    return { lockedAgentId: activeAgentId }
  }

  if (conversation.type !== 'group') {
    return {}
  }

  const mentionedAgentIds = findMentionedAgentIds(content, agents, { includeOrchestrator: false })
  if (mentionedAgentIds.length > 1) {
    return {
      errorResponse: `一次只能 @ 一个 Agent。当前检测到：${mentionedAgentIds.join('、')}。请保留一个后再发送。`,
    }
  }

  return {
    lockedAgentId: mentionedAgentIds[0],
  }
}

/**
 * Forces one routing decision into a single locked-agent turn.
 * Input: any existing routing decision and one agent id. Output: single-agent speaker-direct routing.
 */
function lockRoutingDecisionToAgent(decision: PlannedRoutingDecision, agentId: string): PlannedRoutingDecision {
  if (decision.decision.kind !== 'dispatch_agents') {
    return {
      ...decision,
      decision: {
        kind: 'dispatch_agents',
        finalResponse: decision.decision.finalResponse,
        execution: 'serial',
        dispatches: [],
        targetAgents: [agentId],
        speakerAgentId: agentId,
        finalizationMode: 'speaker_direct',
        lockedAgentId: agentId,
        internalNote: [decision.decision.internalNote, `Locked turn to explicit agent ${agentId}.`]
          .filter(Boolean)
          .join(' '),
      },
    }
  }

  const lockedDispatches = decision.decision.dispatches.filter(brief => brief.agentId === agentId)
  const lockedDispatch = lockedDispatches[0]
  if (!lockedDispatch) {
    return {
      ...decision,
      decision: {
        ...decision.decision,
        execution: 'serial',
        dispatches: [],
        targetAgents: [agentId],
        speakerAgentId: agentId,
        finalizationMode: 'speaker_direct',
        lockedAgentId: agentId,
        internalNote: [decision.decision.internalNote, `Locked turn to explicit agent ${agentId}.`]
          .filter(Boolean)
          .join(' '),
      },
    }
  }

  return {
    ...decision,
    decision: {
      ...decision.decision,
      execution: 'serial',
      dispatches: [lockedDispatch],
      targetAgents: [agentId],
      speakerAgentId: agentId,
      finalizationMode: 'speaker_direct',
      lockedAgentId: agentId,
      internalNote: [decision.decision.internalNote, `Locked turn to explicit agent ${agentId}.`]
        .filter(Boolean)
        .join(' '),
    },
  }
}

/**
 * Returns whether this stage should still go through the planner and handoff path.
 * Input: current task stage. Output: true when direct child-speaker shortcut should be skipped.
 */
function shouldKeepPlannerDispatch(taskStage: TurnRoute['taskStage'] | undefined): boolean {
  return taskStage === 'requirements_intake' || taskStage === 'planning' || taskStage === 'awaiting_confirmation'
}

/**
 * Runs an async task while emitting a recurring heartbeat event.
 * Input: workflow services, a starter event, a heartbeat factory, and a task. Output: task result.
 */
async function runWithHeartbeat<T>(
  services: WorkflowServices,
  starter: WorkflowEvent,
  heartbeat: (tick: number) => WorkflowEvent,
  task: () => Promise<T>,
  intervalMs = 4000,
): Promise<T> {
  emitWorkflowEvent(services, starter)
  let tick = 0
  const timer = setInterval(() => {
    tick += 1
    emitWorkflowEvent(services, heartbeat(tick))
  }, intervalMs)

  try {
    return await task()
  } finally {
    clearInterval(timer)
  }
}

/**
 * Downgrades unsafe parallel execution while leaving task ordering to the planner.
 * Input: workflow services, state, workspace, conversation, and routing. Output: safe routing decision.
 */
function applyExecutionSafety(
  services: WorkflowServices,
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  routing: PlannedRoutingDecision,
): PlannedRoutingDecision {
  const workspaceAgents = resolveConversationAgents(state, workspace.id, conversation.id)
  const decision = routing.decision
  if (decision.execution !== 'parallel') {
    return routing
  }

  if (decision.kind !== 'dispatch_agents') {
    return routing
  }

  const fileWritingAgents = decision.dispatches
    .map(brief => requiredById(workspaceAgents, brief.agentId, 'Agent'))
    .filter(agent => agent.permissions.fileWrite)

  if (!fileWritingAgents.length) {
    return routing
  }

  emitWorkflowEvent(services, {
    type: 'agent_progress',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    runId: `routing-${conversation.id}`,
    agentId: ORCHESTRATOR_AGENT_ID,
    agentName: orchestratorDisplayName(workspaceAgents),
    message: `Parallel execution downgraded to serial because file-writing agents require exclusive workspace writes: ${fileWritingAgents
      .map(agent => agent.id)
      .join(', ')}.`,
  })

  return {
    ...routing,
    decision: {
      ...decision,
      execution: 'serial',
    },
  }
}

/**
 * Finds whether a dispatch targets an agent that can mutate or execute workspace work.
 * Input: app state and task brief. Output: true for implementation-capable dispatches.
 */
function isExecutionAgentDispatch(state: AppState, workspaceId: string, brief: RoutingTaskBrief): boolean {
  const agent = resolveWorkspaceAgent(state, workspaceId, brief.agentId)
  return Boolean(agent?.permissions.fileWrite || agent?.permissions.shell || agent?.id === 'engineer')
}

/**
 * Restricts planner output according to the model-selected task stage.
 * Input: workflow context, routing decision, and route. Output: guarded routing decision.
 */
function applyTaskStageGuard(
  services: WorkflowServices,
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  routing: PlannedRoutingDecision,
  route?: TurnRoute,
  userContent?: string,
): PlannedRoutingDecision {
  const workspaceAgents = resolveConversationAgents(state, workspace.id, conversation.id)
  if (!route || routing.decision.kind !== 'dispatch_agents') {
    if (!route || route.taskStage !== 'requirements_intake' && route.taskStage !== 'planning') {
      return routing
    }

    if (!userContent?.trim()) {
      return routing
    }

    emitWorkflowEvent(services, {
      type: 'agent_progress',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      runId: `routing-${conversation.id}`,
      agentId: ORCHESTRATOR_AGENT_ID,
      agentName: orchestratorDisplayName(workspaceAgents),
      message: `当前处于${route.taskStage === 'requirements_intake' ? '需求对接' : '方案规划'}阶段，已改为由产品经理先接管本轮澄清。`,
    })

    return {
      ...routing,
      decision: {
        kind: 'dispatch_agents',
        finalResponse: '我先让产品经理跟你对接这一轮，把需求、范围和验收标准收清楚。',
        execution: 'serial',
        dispatches: [buildProductClarificationBrief(userContent, route.taskStage)],
        targetAgents: ['product-manager'],
        speakerAgentId: 'product-manager',
        finalizationMode: 'speaker_direct',
        internalNote: 'Task-stage guard converted a non-dispatch turn into a product-manager clarification dispatch.',
      },
    }
  }

  if (route.taskStage === 'execution' || route.taskStage === 'review') {
    return routing
  }

  if (route.taskStage === 'chat') {
    return {
      ...routing,
      decision: {
        kind: 'direct_answer',
        finalResponse: routing.decision.finalResponse?.trim() || '我先按普通聊天处理，不会派发子 Agent 执行任务。',
        execution: 'serial',
        dispatches: [],
        targetAgents: [],
        internalNote: 'Task-stage guard blocked dispatch for chat stage.',
      },
    }
  }

  if (route.taskStage === 'requirements_intake' || route.taskStage === 'planning') {
    const allowedDispatches = routing.decision.dispatches.filter(brief => brief.agentId === 'product-manager')
    const removedDispatches = routing.decision.dispatches.filter(brief => !allowedDispatches.includes(brief))
    if (removedDispatches.length) {
      emitWorkflowEvent(services, {
        type: 'agent_progress',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        runId: `routing-${conversation.id}`,
        agentId: ORCHESTRATOR_AGENT_ID,
        agentName: orchestratorDisplayName(workspaceAgents),
        message: `当前处于${route.taskStage === 'requirements_intake' ? '需求对接' : '方案规划'}阶段，已暂缓工程实现：${removedDispatches
          .map(brief => brief.agentId)
          .join(', ')}。`,
      })
    }
    if (allowedDispatches.length) {
      return {
        ...routing,
        decision: {
          ...routing.decision,
          execution: 'serial',
          dispatches: allowedDispatches,
          targetAgents: allowedDispatches.map(brief => brief.agentId),
          internalNote: [routing.decision.internalNote, 'Task-stage guard allowed only product-manager before confirmation.']
            .filter(Boolean)
            .join(' '),
        },
      }
    }
  }

  if (
    route.taskStage === 'awaiting_confirmation' ||
    routing.decision.dispatches.some(brief => isExecutionAgentDispatch(state, workspace.id, brief))
  ) {
    return {
      ...routing,
      decision: {
        kind: 'ask_clarification',
        finalResponse:
          route.taskStage === 'awaiting_confirmation'
            ? '我先不派工程师执行。请确认是否按当前方案开始实现；确认后我再进入开发和验收链路。'
            : '这个需求还没有到执行阶段。我会先帮你澄清范围和验收标准；确认方案后再派工程师实现。',
        execution: 'serial',
        dispatches: [],
        targetAgents: [],
        internalNote: 'Task-stage guard blocked execution before user confirmation.',
      },
    }
  }

  return routing
}

/**
 * Builds the self-contained product-manager brief used before execution is approved.
 * Input: raw user request and the current non-execution task stage.
 * Output: product-manager dispatch brief.
 */
function buildProductClarificationBrief(
  userContent: string,
  taskStage: Extract<TurnRoute['taskStage'], 'requirements_intake' | 'planning'>,
): RoutingTaskBrief {
  return {
    agentId: 'product-manager',
    task:
      taskStage === 'requirements_intake'
        ? `Clarify the user's intent, scope, modules, constraints, and acceptance criteria before implementation.\nUser request:\n${userContent}`
        : `Refine the current plan into a concise product-facing proposal with scope, user flow, risks, and acceptance criteria.\nUser request:\n${userContent}`,
    requiredContext: [
      'workspace goal',
      'recent conversation messages',
      'current task stage',
    ],
    expectedOutput:
      taskStage === 'requirements_intake'
        ? 'A concise clarification reply or a structured requirement package that the user can confirm.'
        : 'A concise final plan that the user can confirm before implementation starts.',
  }
}

/**
 * Builds a context snapshot for storage and later retrieval.
 * Input: workspace, conversation, run id, and assembled context package. Output: snapshot record.
 */
function buildContextSnapshot(
  workspace: Workspace,
  conversation: Conversation,
  runId: string,
  assembly: { inputContext: string; summary: string; tokenEstimate: number; sourceRefs: string[] },
): ContextSnapshot {
  const createdAt = isoNow()
  return {
    id: `snapshot-${randomUUID()}`,
    workspaceId: workspace.id,
    conversationId: conversation.id,
    agentRunId: runId,
    inputContext: assembly.inputContext,
    summary: assembly.summary,
    sourceRefs: assembly.sourceRefs,
    tokenEstimate: assembly.tokenEstimate,
    createdAt,
  }
}

type ReviewSourceFileSummary = {
  path: string
  status: ChangedFile['status']
  lineCount: number
  byteLength: number
  summary: string
}

type ReviewEvidence = {
  latestChangeSet?: {
    id: string
    baseCommit: string
    summary: string
    files: ChangedFile[]
  }
  previewUrl?: string
  zipUrl: string
  sourceFileSummaries: ReviewSourceFileSummary[]
}

/**
 * Builds reviewer evidence from the latest workspace change set.
 * Input: workflow services, repo path, workspace, and state. Output: reviewer evidence payload.
 */
async function buildReviewerEvidence(
  services: WorkflowServices,
  repoPath: string,
  workspace: Workspace,
  state: AppState,
): Promise<ReviewEvidence> {
  const latestChangeSet = [...state.changeSets]
    .filter(changeSet => changeSet.workspaceId === workspace.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  const trackedFiles = latestChangeSet ? sliceChangedFiles(latestChangeSet.files, 8) : []
  const sourceFileSummaries: ReviewSourceFileSummary[] = []

  for (const file of trackedFiles) {
    if (file.status === 'deleted') {
      sourceFileSummaries.push({
        path: file.path,
        status: file.status,
        lineCount: 0,
        byteLength: 0,
        summary: 'File was deleted, so no source content is available.',
      })
      continue
    }

    try {
      const content = await services.toolGateway.readTextFile(repoPath, file.path)
      const normalized = content.replace(/\r\n/g, '\n')
      sourceFileSummaries.push({
        path: file.path,
        status: file.status,
        lineCount: normalized.split('\n').filter(line => line.trim().length > 0).length,
        byteLength: Buffer.byteLength(content, 'utf8'),
        summary: compactText(content, 520),
      })
    } catch (error) {
      sourceFileSummaries.push({
        path: file.path,
        status: file.status,
        lineCount: 0,
        byteLength: 0,
        summary: error instanceof Error ? `Unavailable: ${error.message}` : 'Unavailable: unable to read source content.',
      })
    }
  }

  return {
    latestChangeSet: latestChangeSet
      ? {
          id: latestChangeSet.id,
          baseCommit: latestChangeSet.baseCommit,
          summary: latestChangeSet.summary,
          files: trackedFiles,
        }
      : undefined,
    previewUrl: await services.runtime.getDefaultPreviewUrl(workspace.id),
    zipUrl: `/api/workspaces/${workspace.id}/zip`,
    sourceFileSummaries,
  }
}

/**
 * Adds a reviewer dispatch when an execution route asks engineer to change files without review.
 * Input: workflow context, state, workspace, conversation, and routing. Output: routing with review safety applied.
 */
function applyReviewSafety(
  services: WorkflowServices,
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  routing: PlannedRoutingDecision,
): PlannedRoutingDecision {
  const workspaceAgents = resolveConversationAgents(state, workspace.id, conversation.id)
  const decision = routing.decision
  if (decision.kind !== 'dispatch_agents') {
    return routing
  }
  const hasEngineer = decision.dispatches.some(brief => brief.agentId === 'engineer')
  const hasReviewer = decision.dispatches.some(brief => brief.agentId === 'reviewer')
  const reviewer = workspaceAgents.find(agent => agent.id === 'reviewer')
  if (!hasEngineer || hasReviewer || !reviewer) {
    return routing
  }

  const engineerBrief = decision.dispatches.find(brief => brief.agentId === 'engineer')
  const reviewBrief: RoutingTaskBrief = {
    agentId: 'reviewer',
    task: [
      'Review the engineer delivery against the confirmed user request.',
      engineerBrief ? `Engineer task: ${engineerBrief.task}` : undefined,
      'Use changed files, delivery validation, preview, zip, and source summaries as evidence.',
      'Return PASS, PARTIAL, or FAIL with concrete findings.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    requiredContext: ['projectBrief', 'recentMessages', 'artifacts', 'changeSets', 'reviewEvidence'],
    expectedOutput: 'PASS/PARTIAL/FAIL verdict with concrete findings and remaining risks.',
  }
  emitWorkflowEvent(services, {
    type: 'agent_progress',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    runId: `routing-${conversation.id}`,
    agentId: ORCHESTRATOR_AGENT_ID,
    agentName: orchestratorDisplayName(workspaceAgents),
    message: 'Added reviewer dispatch because an engineer execution requires review before final synthesis.',
  })

  return {
    ...routing,
    decision: {
      ...decision,
      execution: 'serial',
      dispatches: [...decision.dispatches, reviewBrief],
      targetAgents: Array.from(new Set([...decision.targetAgents, 'reviewer'])),
      internalNote: [decision.internalNote, 'Review safety added reviewer after engineer execution.']
        .filter(Boolean)
        .join(' '),
    },
  }
}

/**
 * Injects reviewer evidence into the model-facing context assembly.
 * Input: base context assembly and review evidence. Output: augmented context assembly.
 */
function augmentContextAssemblyWithReviewEvidence(
  assembly: { inputContext: string; summary: string; tokenEstimate: number; sourceRefs: string[] },
  reviewEvidence: ReviewEvidence,
): { inputContext: string; summary: string; tokenEstimate: number; sourceRefs: string[] } {
  const payload = JSON.parse(assembly.inputContext) as Record<string, unknown>
  payload.reviewEvidence = reviewEvidence
  const inputContext = JSON.stringify(payload, null, 2)
  const summaryLines = [
    assembly.summary,
    `reviewEvidence: preview=${reviewEvidence.previewUrl ?? 'none'} zip=${reviewEvidence.zipUrl}`,
    reviewEvidence.latestChangeSet ? `reviewChangeSet: ${reviewEvidence.latestChangeSet.summary}` : 'reviewChangeSet: none',
    `sourceFileSummaries: ${reviewEvidence.sourceFileSummaries.length}`,
  ]

  return {
    inputContext,
    summary: summaryLines.join('\n'),
    tokenEstimate: Math.max(1, Math.ceil(inputContext.length / 4)),
    sourceRefs: [
      ...assembly.sourceRefs,
      ...(reviewEvidence.previewUrl ? [`preview:${reviewEvidence.previewUrl}`] : []),
      `zip:${reviewEvidence.zipUrl}`,
      ...(reviewEvidence.latestChangeSet ? [`changeSet:${reviewEvidence.latestChangeSet.id}`] : []),
      ...reviewEvidence.sourceFileSummaries.map(file => `source:${file.path}`),
    ],
  }
}

/**
 * Returns whether a main-brain route can skip planner JSON and stream a direct answer.
 * Input: turn route. Output: true for non-execution lightweight final text routes.
 */
function canStreamMainRouteDirectly(routeValue: TurnRoute): boolean {
  return routeValue.taskStage === 'chat' && !routeAllowsExecution(routeValue) && routeValue.modelProfile === 'router'
}

/**
 * Creates a text artifact for an adapter output.
 * Input: workspace id, agent id, run id, and content. Output: artifact record.
 */
function createTextArtifact(workspaceId: string, agentId: string, runId: string, content: string): Artifact {
  return {
    id: `artifact-${randomUUID()}`,
    workspaceId,
    agentRunId: runId,
    type: 'text',
    title: `${agentId} 运行摘要`,
    content,
    createdByAgentId: agentId,
    createdAt: isoNow(),
  }
}

/**
 * Creates a local preview artifact that points at the runtime preview URL.
 * Input: workspace id, agent id, run id, and preview URL. Output: artifact record.
 */
function createPreviewArtifact(workspaceId: string, agentId: string, runId: string, previewUrl: string): Artifact {
  return {
    id: `artifact-${randomUUID()}`,
    workspaceId,
    agentRunId: runId,
    type: 'web-preview',
    title: '本地预览 URL',
    content: '由本地 Workspace Runtime 提供的静态预览入口。',
    url: previewUrl,
    createdByAgentId: agentId,
    createdAt: isoNow(),
  }
}

/**
 * Writes a run result, artifacts, message, and optional change set into the store.
 * Input: workflow services, run id, entities, adapter result, and diff details. Output: promise resolved after update.
 */
async function persistRunResult(
  services: WorkflowServices,
  runId: string,
  workspace: Workspace,
  conversation: Conversation,
  agent: AgentDefinition,
  result: DeliveryAssessment,
  patch: string,
  changedFiles: ChangedFile[],
  baseCommit: string,
  sessionScope?: TaskRunSessionScope,
  previewUrl?: string,
  publishConversationMessage = true,
): Promise<void> {
  const now = isoNow()
  const deliveryMetadata: Record<string, unknown> = {
    deliveryStatus: result.status,
    deliveryReason: result.reason,
    validation: result.validation,
    review: result.review,
  }
  const artifacts: Artifact[] = [
    ...result.artifacts.map(artifact => ({
      ...artifact,
      agentRunId: artifact.agentRunId ?? runId,
      metadata: {
        ...(artifact.metadata ?? {}),
        deliveryStatus: result.status,
      },
    })),
    {
      ...createTextArtifact(workspace.id, agent.id, runId, result.content),
      metadata: deliveryMetadata,
    },
  ]
  if (agent.id === 'engineer' && previewUrl) {
    artifacts.push(createPreviewArtifact(workspace.id, agent.id, runId, previewUrl))
  }

  const changeSet: ChangeSet | undefined = patch || changedFiles.length
    ? {
        id: `changeset-${randomUUID()}`,
        workspaceId: workspace.id,
        agentRunId: runId,
        baseCommit,
        files: changedFiles,
        summary: changedFiles.length ? 'Runtime repo changed during agent run.' : 'Patch captured from runtime repo.',
        patch: patch || `Changed files without text diff:\n${changedFiles.map(file => `${file.status} ${file.path}`).join('\n')}`,
        createdAt: now,
      }
    : undefined

  await services.store.update(state => {
    const run = requiredById(state.agentRuns, runId, 'AgentRun')
    run.output = result.content
    run.status = result.status
    run.logs = result.logs
    run.finishedAt = now
    run.error = result.status === 'failed' ? result.reason : undefined
    if (publishConversationMessage) {
      const agentMessage = createMessage({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        turnId: services.turnId,
        senderType: 'agent',
        senderId: agent.id,
        content: result.content,
        artifacts,
      })
      state.messages.push(agentMessage)
    }
    state.artifacts.push(...artifacts)
    if (changeSet) {
      state.changeSets.push(changeSet)
    }
    if (sessionScope) {
      const session = requiredById(state.agentSessions, sessionScope.session.id, 'AgentSession')
      session.lastHandoffId = sessionScope.handoff.id
      session.updatedAt = now
    }
    const targetConversation = requiredById(state.conversations, conversation.id, 'Conversation')
    targetConversation.updatedAt = now
    const targetWorkspace = requiredById(state.workspaces, workspace.id, 'Workspace')
    targetWorkspace.updatedAt = now
  })

  for (const artifact of artifacts) {
    emitWorkflowEvent(
      services,
      createArtifactCreatedEvent(workspace.id, conversation.id, artifact, {
        runId,
        agentId: agent.id,
      }),
    )
    if (artifact.type === 'web-preview') {
      emitWorkflowEvent(
        services,
        createPreviewReadyEvent(workspace.id, conversation.id, artifact, {
          runId,
          agentId: agent.id,
        }),
      )
    }
  }
  if (changeSet) {
    emitWorkflowEvent(services, createChangeSetCreatedEvent(workspace.id, conversation.id, changeSet))
  }
}

/**
 * Runs one child agent task and persists the AgentRun lifecycle.
 * Input: workflow services, current state, workspace, conversation, and task brief. Output: structured run result for synthesis.
 */
async function runTaskBrief(
  services: WorkflowServices,
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  brief: RoutingTaskBrief,
  sessionScope?: TaskRunSessionScope,
  turnRoute?: TurnRoute,
  options?: { publishConversationMessage?: boolean },
): Promise<TaskBriefRunResult> {
  const agent = resolveWorkspaceAgent(state, workspace.id, brief.agentId)
  if (!agent) {
    throw new Error(`Agent not found in workspace: ${brief.agentId}`)
  }
  const routeBlocksAgentRun = !routeAllowsExecution(turnRoute) && (agent.permissions.fileWrite || agent.permissions.shell)
  if (routeBlocksAgentRun) {
    const runId = `run-blocked-${randomUUID()}`
    const summary = `${agent.name}: blocked by turn route tool policy.`
    logDiagnostic(services, {
      level: 'warn',
      category: 'agent_run',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      sessionId: sessionScope?.session.id,
      handoffId: sessionScope?.handoff.id,
      runId,
      agentId: agent.id,
      message: 'Blocked child-agent adapter run because the turn route forbids execution.',
      data: {
        route: summarizeTurnRoute(turnRoute),
        task: brief.task,
      },
    })
    return {
      runId,
      agentId: agent.id,
      agentName: agent.name,
      status: 'failed',
      task: brief.task,
      expectedOutput: brief.expectedOutput,
      output: 'This turn is in read-only discussion mode, so AgentHub did not start a real child-agent execution.',
      baseCommit: 'blocked',
      summary,
    }
  }
  const runId = `run-${randomUUID()}`
  emitWorkflowEvent(services, {
    type: 'context_started',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    scope: 'agent_run',
    agentId: agent.id,
    agentName: agent.name,
    sessionId: sessionScope?.session.id,
    handoffId: sessionScope?.handoff.id,
    runId,
  })
  const runtime = await services.runtime.prepareWorkspace(workspace)
  let contextAssembly = buildAgentContextAssembly({
    state,
    workspace,
    conversation,
    task: brief.task,
    requiredContext: brief.requiredContext,
    expectedOutput: brief.expectedOutput,
    codeSelection: brief.codeSelection,
    agentScope: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      tools: agent.tools,
      permissions: agent.permissions,
      includeSameConversationOnly: agent.contextPolicy.includeSameConversationOnly,
      recentMessageLimit: agent.contextPolicy.recentMessageLimit,
    },
    agentModelProvider: agent.modelProvider,
    agentSession: sessionScope
      ? {
          sessionId: sessionScope.session.id,
          handoffId: sessionScope.handoff.id,
        }
      : undefined,
  })
  if (agent.id === 'reviewer') {
    const reviewEvidence = await buildReviewerEvidence(services, runtime.repoPath, workspace, state)
    contextAssembly = augmentContextAssemblyWithReviewEvidence(contextAssembly, reviewEvidence)
  }
  const inputContext = contextAssembly.inputContext
  const contextSnapshot = buildContextSnapshot(workspace, conversation, runId, contextAssembly)
  const startedAt = contextSnapshot.createdAt

  emitWorkflowEvent(services, {
    type: 'context_finished',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    scope: 'agent_run',
    agentId: agent.id,
    agentName: agent.name,
    sessionId: sessionScope?.session.id,
    handoffId: sessionScope?.handoff.id,
    runId,
    tokenEstimate: contextSnapshot.tokenEstimate,
    summary: contextAssembly.summary,
  })
  logDiagnostic(services, {
    level: 'debug',
    category: 'context',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: sessionScope?.session.id,
    handoffId: sessionScope?.handoff.id,
    runId,
    agentId: agent.id,
    message: 'Built child-agent context package.',
    data: {
      tokenEstimate: contextSnapshot.tokenEstimate,
      sourceRefs: contextSnapshot.sourceRefs,
    },
  })

  emitWorkflowEvent(services, {
    type: 'agent_started',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    runId,
    agentId: agent.id,
    agentName: agent.name,
    task: brief.task,
    contextTokens: contextSnapshot.tokenEstimate,
  })
  const baseCommit = await services.runtime.getBaseCommit(runtime.repoPath)
  const beforeSnapshot = await readRepoSnapshot(services.runtime, runtime.repoPath)

  const run: AgentRun = {
    id: runId,
    workspaceId: workspace.id,
    conversationId: conversation.id,
    agentId: agent.id,
    sessionId: sessionScope?.session.id,
    handoffId: sessionScope?.handoff.id,
    inputContext,
    output: '',
    status: 'running',
    provider: agent.modelProvider,
    logs: [],
    startedAt,
  }

  await services.store.update(nextState => {
    nextState.agentRuns.push(run)
    nextState.contextSnapshots.push(contextSnapshot)
  })

  if (sessionScope) {
    await markTaskHandoffRunning(services.store, sessionScope.handoff.id)
    emitWorkflowEvent(services, {
      type: 'handoff_updated',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      handoffId: sessionScope.handoff.id,
      sessionId: sessionScope.session.id,
      agentId: agent.id,
      agentName: agent.name,
      status: 'running',
      runId,
    })
  }

  const adapter = createAdapterForAgent(agent, services.env, services.toolGateway)
  logDiagnostic(services, {
    level: 'info',
    category: 'adapter',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: sessionScope?.session.id,
    handoffId: sessionScope?.handoff.id,
    runId,
    agentId: agent.id,
    message: 'Starting child-agent adapter run.',
    data: {
      provider: adapter.provider,
      realAgents: services.env.AGENTHUB_REAL_AGENTS,
      runtimeRepoPath: runtime.repoPath,
    },
  })
  const adapterStartedAt = Date.now()
  const result = await runWithHeartbeat(
    services,
    {
      type: 'agent_progress',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      runId,
      agentId: agent.id,
      agentName: agent.name,
      message: `正在运行 ${agent.name}，已准备工作区并锁定 baseCommit=${baseCommit}。`,
    },
    tick => ({
      type: 'agent_progress',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      runId,
      agentId: agent.id,
      agentName: agent.name,
      message: `仍在执行中，等待第 ${tick} 次进度刷新。`,
    }),
    () =>
      runAgentWithFallback(
        adapter,
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          runId,
          agent,
          task: brief.task,
          contextPackage: inputContext,
          runtime,
          eventSink: event => emitWorkflowEvent(services, event),
        },
        !services.env.AGENTHUB_REAL_AGENTS,
      ),
    3500,
  )

  const afterSnapshot = await readRepoSnapshot(services.runtime, runtime.repoPath)
  const { patch, changedFiles } = diffRepoSnapshots(beforeSnapshot, afterSnapshot)
  const previewUrl = agent.id === 'engineer'
    ? await services.runtime.getDefaultPreviewUrl(workspace.id)
    : undefined
  const previewReady = agent.id === 'engineer' && Boolean(previewUrl)
  const validation = await runDeliveryValidation(agent, runtime.repoPath, brief, changedFiles, previewReady)
  if (validation) {
    emitWorkflowEvent(services, {
      type: 'delivery_validation_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      runId,
      agentId: agent.id,
      status: validation.status,
      summary: validation.summary,
      issues: validation.issues,
    })
  }
  const review = runReviewVerdictParsing(agent, result.content)
  if (review) {
    emitWorkflowEvent(services, {
      type: 'review_verdict',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      runId,
      agentId: agent.id,
      verdict: review.verdict,
      summary: review.summary,
      issues: review.issues,
    })
  }
  const assessment = assessDelivery({
    agent,
    task: brief.task,
    expectedOutput: brief.expectedOutput,
    adapterResult: result,
    changedFiles,
    validation,
    review,
  })
  logDiagnostic(services, {
    level: deliveryDiagnosticLevel(assessment.status),
    category: 'adapter',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: sessionScope?.session.id,
    handoffId: sessionScope?.handoff.id,
    runId,
    agentId: agent.id,
    message: 'Finished child-agent adapter run.',
    data: {
      provider: adapter.provider,
      adapterStatus: result.status,
      deliveryStatus: assessment.status,
      deliveryReason: assessment.reason,
      elapsedMs: Date.now() - adapterStartedAt,
      artifactCount: result.artifacts.length,
      changedFileCount: changedFiles.length,
      logCount: result.logs.length,
      validationStatus: validation?.status,
      reviewVerdict: review?.verdict,
    },
  })

  await persistRunResult(
    services,
    runId,
    { ...workspace, rootPath: runtime.repoPath },
    conversation,
    agent,
    assessment,
    patch,
    changedFiles,
    baseCommit,
    sessionScope,
    previewUrl,
    options?.publishConversationMessage ?? true,
  )

  if (sessionScope) {
    await completeTaskHandoff(
      services.store,
      sessionScope.handoff.id,
      runId,
      assessment.status,
      assessment.content,
    )
    emitWorkflowEvent(services, {
      type: 'handoff_updated',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      handoffId: sessionScope.handoff.id,
      sessionId: sessionScope.session.id,
      agentId: agent.id,
      agentName: agent.name,
      status: toHandoffStatus(assessment.status),
      runId,
    })
  }

  emitWorkflowEvent(services, {
    type: 'agent_finished',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    runId,
    agentId: agent.id,
    agentName: agent.name,
    status: assessment.status,
    baseCommit,
    summary: assessment.content,
  })

  const summary = `${agent.name}: ${formatRunStatus(assessment.status)}. baseCommit=${baseCommit}. reason=${assessment.reason}`
  return {
    runId,
    agentId: agent.id,
    agentName: agent.name,
    status: assessment.status,
    task: brief.task,
    expectedOutput: brief.expectedOutput,
    output: assessment.content,
    baseCommit,
    deliveryReason: assessment.reason,
    validation: assessment.validation,
    review: assessment.review,
    summary,
  }
}

/**
 * Runs one lightweight or task-based child-agent turn while writing the visible reply into the current conversation.
 * Input: workflow services, current state, workspace, conversation, target agent id, and raw user content.
 * Output: updated application state after the directed child-agent turn finishes.
 */
async function runDirectedAgentConversationTurn(
  workflowServices: WorkflowServices,
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  agentId: string,
  rawContent: string,
  replyTo?: SendMessageInput['replyTo'],
  codeSelection?: SendMessageInput['codeSelection'],
): Promise<AppState> {
  const agent = resolveWorkspaceAgent(state, workspace.id, agentId)
  if (!agent) {
    throw new Error(`Agent not found in workspace: ${agentId}`)
  }
  const normalizedContent = stripLeadingAgentMention(rawContent, agent) || rawContent.trim()
  const session = await ensureAgentSession(workflowServices.store, workspace, agent)
  const localRoutePreview = routeTurnLocally({
    content: normalizedContent,
    workspace,
    conversation,
    agent,
    replyTo,
    codeSelection,
  })
  const previewWillStreamFinalText =
    localRoutePreview && !routeAllowsExecution(localRoutePreview) && localRoutePreview.modelProfile === 'router'

  if (
    !normalizedContent.trim().toLowerCase().startsWith('/run') &&
    !localRoutePreview?.localResponse &&
    !previewWillStreamFinalText
  ) {
    emitWorkflowEvent(workflowServices, {
      type: 'context_started',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: 'agent_session',
      agentId: agent.id,
      agentName: agent.name,
      sessionId: session.id,
    })
    emitWorkflowEvent(workflowServices, {
      type: 'model_call_started',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: 'agent_session',
      provider: workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
      model: localRoutePreview?.modelProfile === 'router'
        ? workflowServices.env.AGENTHUB_ROUTER_MODEL
        : workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
      agentId: agent.id,
      agentName: agent.name,
      sessionId: session.id,
    })
  }

  emitWorkflowEvent(workflowServices, {
    type: 'agent_session_started',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: session.id,
    agentId: agent.id,
    agentName: agent.name,
    content: normalizedContent,
  })

  const latestState = await workflowServices.store.read()
  const plannedTurn = await runAgentSessionTurn({
    services: {
      ...workflowServices,
      streamAgentReply: replyInput => streamAndPersistAgentReply(workflowServices, replyInput),
    },
    state: latestState,
    workspace,
    conversation,
    agent,
    session,
    content: normalizedContent,
    replyTo,
    codeSelection,
  })
  logDiagnostic(workflowServices, {
    level: plannedTurn.routeError ? 'warn' : 'info',
    category: 'routing',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: plannedTurn.session.id,
    agentId: agent.id,
    message: conversation.type === 'direct' ? 'Resolved direct-agent turn route.' : 'Resolved group-directed agent turn route.',
    data: {
      route: summarizeTurnRoute(plannedTurn.route),
      routeProvider: plannedTurn.routeProvider,
      routeModel: plannedTurn.routeModel,
      routeElapsedMs: plannedTurn.routeElapsedMs,
      routeError: plannedTurn.routeError,
    },
  })
  emitTaskStageUpdated(workflowServices, workspace, conversation, plannedTurn.route)
  if (plannedTurn.contextTokenEstimate !== undefined) {
    emitWorkflowEvent(workflowServices, {
      type: 'context_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: 'agent_session',
      agentId: agent.id,
      agentName: agent.name,
      sessionId: plannedTurn.session.id,
      tokenEstimate: plannedTurn.contextTokenEstimate,
      summary: `${agent.name} private session context.`,
    })
  }
  if (plannedTurn.source === 'model' && plannedTurn.modelElapsedMs !== undefined) {
    emitWorkflowEvent(workflowServices, {
      type: 'model_call_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: 'agent_session',
      provider: plannedTurn.provider ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
      model: plannedTurn.model ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
      agentId: agent.id,
      agentName: agent.name,
      sessionId: plannedTurn.session.id,
      elapsedMs: plannedTurn.modelElapsedMs ?? 0,
    })
  } else if (plannedTurn.source === 'local_fallback') {
    emitWorkflowEvent(workflowServices, {
      type: 'model_call_failed',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: 'agent_session',
      provider: plannedTurn.provider ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
      model: plannedTurn.model ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
      agentId: agent.id,
      agentName: agent.name,
      sessionId: plannedTurn.session.id,
      elapsedMs: plannedTurn.modelElapsedMs ?? 0,
      error: plannedTurn.error ?? 'Agent session model fell back locally.',
    })
  }

  emitWorkflowEvent(workflowServices, {
    type: 'agent_session_finished',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: plannedTurn.session.id,
    agentId: agent.id,
    agentName: agent.name,
    source: plannedTurn.source,
    provider: plannedTurn.provider,
    model: plannedTurn.model,
    error: plannedTurn.error,
    turnKind: plannedTurn.turn.kind,
  })

  if (plannedTurn.turn.kind === 'run_task' && plannedTurn.turn.taskBrief && plannedTurn.handoff) {
    const handoff = plannedTurn.handoff
    const taskBrief = plannedTurn.turn.taskBrief
    emitWorkflowEvent(workflowServices, {
      type: 'handoff_created',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      handoffId: handoff.id,
      sessionId: plannedTurn.session.id,
      agentId: agent.id,
      agentName: agent.name,
      source: handoff.source,
      status: handoff.status,
    })
    emitAgentTaskDispatched(
      workflowServices,
      workspace,
      conversation,
      agent,
      plannedTurn.session,
      handoff,
      taskBrief,
    )
    logDiagnostic(workflowServices, {
      level: 'info',
      category: 'handoff',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      sessionId: plannedTurn.session.id,
      handoffId: handoff.id,
      agentId: agent.id,
      message: conversation.type === 'direct' ? 'Created direct-agent task handoff.' : 'Created group-directed task handoff.',
      data: {
        task: taskBrief.task,
        expectedOutput: taskBrief.expectedOutput,
      },
    })
    const runState = await workflowServices.store.read()
    const runResult = await runTaskBrief(workflowServices, runState, workspace, conversation, taskBrief, {
      session: plannedTurn.session,
      handoff,
    }, plannedTurn.route)
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: runResult.summary,
    })
  } else {
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: plannedTurn.turn.finalResponse ?? `${agent.name} session updated.`,
    })
  }

  try {
    await persistWorkflowEvents(workflowServices)
  } catch (error) {
    console.error(error)
  }
  return await workflowServices.store.read()
}

/**
 * Appends the Orchestrator summary after direct answers or fallback dispatch summaries.
 * Input: workflow services, workspace, conversation, routing decision, and child summaries. Output: promise resolved after update.
 */
async function appendFinalSummary(
  services: WorkflowServices,
  workspace: Workspace,
  conversation: Conversation,
  routing: PlannedRoutingDecision,
  summaries: string[],
): Promise<void> {
  const decision = routing.decision
  const routingLine = `路由来源：${routing.source}${routing.provider ? `（${routing.provider}/${routing.model}）` : ''}`
  const visibleFallbackLine = routing.error ? '主脑模型输出异常，已使用本地兜底。详细原因可在 /logs 或数据库 workflow_events 中查看。' : undefined
  const content =
    decision.kind === 'direct_answer' || decision.kind === 'ask_clarification'
      ? [decision.finalResponse ?? '任务已记录。', routingLine, visibleFallbackLine].filter(Boolean).join('\n')
      : [
          decision.finalResponse ?? '主脑已完成本轮子 Agent 调度。',
          routingLine,
          visibleFallbackLine,
          `执行模式：${decision.execution}`,
          ...summaries,
        ]
          .filter(Boolean)
          .join('\n')

  await emitAndPersistStaticAssistantReply(services, workspace, conversation, 'main_brain', content)
}

/**
 * Appends the synthesized main-brain response after child-agent runs finish.
 * Input: workflow services, workspace, conversation, synthesis metadata, and local summaries. Output: promise resolved after update.
 */
async function appendSynthesisSummary(
  services: WorkflowServices,
  workspace: Workspace,
  conversation: Conversation,
  userMessage: string,
  synthesis: PlannedSynthesis,
  localSummaries: string[],
): Promise<void> {
  const result = synthesis.synthesis
  const sourceLine = `综合来源：${synthesis.source}${synthesis.provider ? `（${synthesis.provider}/${synthesis.model}）` : ''}`
  const followUpLine = result.kind === 'continue_dispatch' && result.followUpDispatches.length
    ? `建议后续派发：${result.followUpDispatches.map(brief => brief.agentId).join(', ')}（当前版本未自动执行二次派发）`
    : undefined
  const content = [
    result.finalResponse,
    synthesis.source === 'model' && !synthesis.error ? sourceLine : undefined,
    `综合结论：${result.verdict}`,
    followUpLine,
  ]
    .filter(Boolean)
    .join('\n')

  if (synthesis.error || synthesis.source === 'rule_fallback') {
    await emitAndPersistStaticAssistantReply(services, workspace, conversation, 'synthesis', content)
    return
  }

  await streamAndPersistSynthesisReply(services, workspace, conversation, userMessage, result, localSummaries, content)
}

/**
 * Returns whether a simple requirement-intake turn can use local synthesis.
 * Input: planned routing and child-agent results. Output: true when no model-backed synthesis is needed.
 */
function canUseLocalRequirementSynthesis(routing: PlannedRoutingDecision, results: TaskBriefRunResult[]): boolean {
  if (routing.decision.kind !== 'dispatch_agents') {
    return false
  }
  return (
    results.length === 1 &&
    results[0]?.agentId === 'product-manager' &&
    routing.decision.dispatches.length === 1 &&
    routing.decision.dispatches[0]?.agentId === 'product-manager'
  )
}

/**
 * Runs the main-brain synthesis step after child agents finish.
 * Input: workflow services, state, workspace, conversation, routing, user message, and run results. Output: planned synthesis.
 */
async function runSynthesis(
  services: WorkflowServices,
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  routing: PlannedRoutingDecision,
  userMessage: string,
  results: TaskBriefRunResult[],
): Promise<PlannedSynthesis> {
  const workspaceAgents = resolveConversationAgents(state, workspace.id, conversation.id)
  const localSummaries = results.map(result => result.summary)
  if (canUseLocalRequirementSynthesis(routing, results)) {
    const requirementSummaries = results.map(result => `${result.agentName}: ${compactText(result.output, 1200)}`)
    const localContext = requirementSummaries.join('\n')
    const tokenEstimate = Math.max(1, Math.ceil(localContext.length / 4))
    emitWorkflowEvent(services, {
      type: 'context_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: 'synthesis',
      tokenEstimate,
      summary: 'Local synthesis for single product-manager requirement intake.',
    })
    logDiagnostic(services, {
      level: 'info',
      category: 'synthesis',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      message: 'Skipped model-backed synthesis for single product-manager requirement intake.',
      data: {
        tokenEstimate,
        resultCount: results.length,
      },
    })
    return synthesizeLocally(requirementSummaries)
  }

  const contextPackage = buildSynthesisContextPackage({
    state,
    workspace,
    conversation,
    userMessage,
    routing: routing.decision,
    agentResults: results,
    localSummaries,
  })
  const synthesisTokenEstimate = Math.max(1, Math.ceil(contextPackage.length / 4))
  emitWorkflowEvent(services, {
    type: 'context_finished',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    scope: 'synthesis',
    tokenEstimate: synthesisTokenEstimate,
    summary: `Synthesis context for ${results.length} child-agent result(s).`,
  })
  logDiagnostic(services, {
    level: 'debug',
    category: 'context',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    message: 'Built synthesis context package.',
    data: {
      tokenEstimate: synthesisTokenEstimate,
      resultCount: results.length,
      localSummaryCount: localSummaries.length,
    },
  })

  return runWithHeartbeat(
    services,
    {
      type: 'synthesis_started',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      runCount: results.length,
    },
    tick => ({
      type: 'agent_progress',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      runId: `synthesis-${conversation.id}`,
      agentId: ORCHESTRATOR_AGENT_ID,
      agentName: orchestratorDisplayName(workspaceAgents),
      message: `主脑正在综合子 Agent 结果，第 ${tick} 次刷新。`,
    }),
    async () => {
      emitWorkflowEvent(services, {
        type: 'model_call_started',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        scope: 'synthesis',
        provider: services.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
        model: services.env.AGENTHUB_ORCHESTRATOR_MODEL,
      })
      const synthesis = await synthesizeWithMainBrain({
        env: services.env,
        contextPackage,
        agents: workspaceAgents,
        localSummaries,
      })
      if (synthesis.error) {
        emitWorkflowEvent(services, {
          type: 'model_call_failed',
          workspaceId: workspace.id,
          conversationId: conversation.id,
          scope: 'synthesis',
          provider: synthesis.provider ?? services.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
          model: synthesis.model ?? services.env.AGENTHUB_ORCHESTRATOR_MODEL,
          elapsedMs: synthesis.modelElapsedMs,
          error: synthesis.error,
        })
        logDiagnostic(services, {
          level: 'warn',
          category: 'synthesis',
          workspaceId: workspace.id,
          conversationId: conversation.id,
          message: 'Synthesis model failed and fallback was used.',
          data: {
            error: synthesis.error,
            elapsedMs: synthesis.modelElapsedMs,
          },
        })
      } else {
        emitWorkflowEvent(services, {
          type: 'model_call_finished',
          workspaceId: workspace.id,
          conversationId: conversation.id,
          scope: 'synthesis',
          provider: synthesis.provider ?? services.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
          model: synthesis.model ?? services.env.AGENTHUB_ORCHESTRATOR_MODEL,
          elapsedMs: synthesis.modelElapsedMs ?? 0,
        })
      }
      return synthesis
    },
    3000,
  )
}

/**
 * Creates a persistent child-agent session handoff before running a main dispatch.
 * Input: workflow services, workspace, conversation, state, and task brief. Output: session run scope.
 */
async function createMainDispatchSessionScope(
  services: WorkflowServices,
  workspace: Workspace,
  conversation: Conversation,
  state: AppState,
  brief: RoutingTaskBrief,
): Promise<TaskRunSessionScope> {
  const agent = resolveWorkspaceAgent(state, workspace.id, brief.agentId)
  if (!agent) {
    throw new Error(`Agent not found in workspace: ${brief.agentId}`)
  }
  const session = await ensureAgentSession(services.store, workspace, agent)
  const handoff = await createTaskHandoff({
    store: services.store,
    workspace,
    conversation,
    session,
    agent,
    brief,
    source: 'main',
  })
  emitWorkflowEvent(services, {
    type: 'handoff_created',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    handoffId: handoff.id,
    sessionId: session.id,
    agentId: agent.id,
    agentName: agent.name,
    source: handoff.source,
    status: handoff.status,
  })
  emitAgentTaskDispatched(services, workspace, conversation, agent, session, handoff, brief)
  logDiagnostic(services, {
    level: 'info',
    category: 'handoff',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: session.id,
    handoffId: handoff.id,
    agentId: agent.id,
    message: 'Created main-dispatch task handoff.',
    data: {
      task: brief.task,
      expectedOutput: brief.expectedOutput,
      requiredContext: brief.requiredContext,
    },
  })
  return {
    session,
    handoff,
  }
}

/**
 * Handles a user chat message and runs the required Orchestrator workflow.
 * Input: validated send-message payload and workflow services. Output: latest application state.
 */
export async function handleUserMessage(input: SendMessageInput, services: WorkflowServices): Promise<AppState> {
  const workflowEventLog: WorkflowEventRecord[] = []
  const diagnosticLogBuffer: DiagnosticLog[] = []
  const turnId = `turn-${randomUUID()}`
  const workflowServices: WorkflowServices = {
    ...services,
    workflowEventLog,
    diagnosticLogBuffer,
    turnId,
  }
  try {
  const userMessage = createMessage({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    turnId,
    senderType: 'user',
    senderId: 'user',
    content: input.content,
    replyTo: input.replyTo,
    artifacts: [],
  })

  await workflowServices.store.update(state => {
    requiredById(state.workspaces, input.workspaceId, 'Workspace')
    const conversation = requiredById(state.conversations, input.conversationId, 'Conversation')
    conversation.updatedAt = userMessage.createdAt
    state.messages.push(userMessage)
  })

  const state = await workflowServices.store.read()
  const workspace = requiredById(state.workspaces, input.workspaceId, 'Workspace')
  const conversation = requiredById(state.conversations, input.conversationId, 'Conversation')
  const workspaceAgents = resolveConversationAgents(state, workspace.id, conversation.id)
  const explicitAgentLock = resolveExplicitAgentLock(input.content, conversation, workspaceAgents, input.agentId)
  const normalizedMainContent = conversation.type === 'group'
    ? stripLeadingOrchestratorMention(input.content, workspaceAgents) || input.content.trim()
    : input.content

  if (explicitAgentLock.errorResponse) {
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_received',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      content: normalizedMainContent,
    })
    emitWorkflowEvent(workflowServices, {
      type: 'routing_finished',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      source: 'explicit_rule',
      speakerAgentId: 'orchestrator',
      finalizationMode: 'speaker_direct',
      taskStage: 'chat',
      executionReadiness: 'not_a_task',
      needsUserConfirmation: false,
      mode: 'answer_directly',
      brainKind: 'direct_answer',
      execution: 'serial',
      targetAgents: [],
    })
    const conflictRouting: PlannedRoutingDecision = {
      source: 'explicit_rule',
      decision: {
        kind: 'direct_answer',
        finalResponse: explicitAgentLock.errorResponse,
        execution: 'serial',
        dispatches: [],
        targetAgents: [],
        speakerAgentId: 'orchestrator',
        finalizationMode: 'speaker_direct',
        internalNote: 'Blocked group turn because multiple explicit agent mentions were provided.',
      },
    }
    await appendFinalSummary(workflowServices, workspace, conversation, conflictRouting, [])
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: explicitAgentLock.errorResponse,
    })
    try {
      await persistWorkflowEvents(workflowServices)
    } catch (error) {
      console.error(error)
    }
    return await workflowServices.store.read()
  }

  const lockedAgentId = explicitAgentLock.lockedAgentId
  emitWorkflowEvent(workflowServices, {
    type: 'turn_started',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    content: input.content,
    activeAgentId: input.agentId,
  })
  logDiagnostic(workflowServices, {
    level: 'info',
    category: 'workflow',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    agentId: input.agentId,
    message: 'Started chat turn.',
    data: {
      contentLength: input.content.length,
      conversationType: conversation.type,
    },
  })
  const directAgentId = input.agentId && conversation.type === 'direct' ? input.agentId : undefined
  if (directAgentId) {
    return await runDirectedAgentConversationTurn(
      workflowServices,
      state,
      workspace,
      conversation,
      directAgentId,
      input.content,
      input.replyTo,
      input.codeSelection,
    )
    /*
    const agent = requiredById(workspaceAgents, directAgentId, 'Agent')
    const session = await ensureAgentSession(workflowServices.store, workspace, agent)
    const localRoutePreview = routeTurnLocally({
      content: input.content,
      workspace,
      conversation,
      agent,
    })
    const previewWillStreamFinalText =
      localRoutePreview && !routeAllowsExecution(localRoutePreview) && localRoutePreview.modelProfile === 'router'
    if (
      !input.content.trim().toLowerCase().startsWith('/run') &&
      !localRoutePreview?.localResponse &&
      !previewWillStreamFinalText
    ) {
      emitWorkflowEvent(workflowServices, {
        type: 'context_started',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        scope: 'agent_session',
        agentId: agent.id,
        agentName: agent.name,
        sessionId: session.id,
      })
      emitWorkflowEvent(workflowServices, {
        type: 'model_call_started',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        scope: 'agent_session',
        provider: workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
        model: localRoutePreview?.modelProfile === 'router'
          ? workflowServices.env.AGENTHUB_ROUTER_MODEL
          : workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
        agentId: agent.id,
        agentName: agent.name,
        sessionId: session.id,
      })
    }
    emitWorkflowEvent(workflowServices, {
      type: 'agent_session_started',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      sessionId: session.id,
      agentId: agent.id,
      agentName: agent.name,
      content: input.content,
    })

    const latestState = await workflowServices.store.read()
    const plannedTurn = await runAgentSessionTurn({
      services: {
        ...workflowServices,
        streamAgentReply: replyInput => streamAndPersistAgentReply(workflowServices, replyInput),
      },
      state: latestState,
      workspace,
      conversation,
      agent,
      session,
      content: input.content,
    })
    logDiagnostic(workflowServices, {
      level: plannedTurn.routeError ? 'warn' : 'info',
      category: 'routing',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      sessionId: plannedTurn.session.id,
      agentId: agent.id,
      message: 'Resolved direct-agent turn route.',
      data: {
        route: summarizeTurnRoute(plannedTurn.route),
        routeProvider: plannedTurn.routeProvider,
        routeModel: plannedTurn.routeModel,
        routeElapsedMs: plannedTurn.routeElapsedMs,
        routeError: plannedTurn.routeError,
      },
    })
    emitTaskStageUpdated(workflowServices, workspace, conversation, plannedTurn.route)
    if (plannedTurn.contextTokenEstimate !== undefined) {
      emitWorkflowEvent(workflowServices, {
        type: 'context_finished',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        scope: 'agent_session',
        agentId: agent.id,
        agentName: agent.name,
        sessionId: plannedTurn.session.id,
        tokenEstimate: plannedTurn.contextTokenEstimate,
        summary: `${agent.name} private session context.`,
      })
    }
    if (plannedTurn.source === 'model' && plannedTurn.modelElapsedMs !== undefined) {
      emitWorkflowEvent(workflowServices, {
        type: 'model_call_finished',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        scope: 'agent_session',
        provider: plannedTurn.provider ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
        model: plannedTurn.model ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
        agentId: agent.id,
        agentName: agent.name,
        sessionId: plannedTurn.session.id,
        elapsedMs: plannedTurn.modelElapsedMs ?? 0,
      })
    } else if (plannedTurn.source === 'local_fallback') {
      emitWorkflowEvent(workflowServices, {
        type: 'model_call_failed',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        scope: 'agent_session',
        provider: plannedTurn.provider ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
        model: plannedTurn.model ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
        agentId: agent.id,
        agentName: agent.name,
        sessionId: plannedTurn.session.id,
        elapsedMs: plannedTurn.modelElapsedMs,
        error: plannedTurn.error ?? 'Agent session model fell back locally.',
      })
    }

    emitWorkflowEvent(workflowServices, {
      type: 'agent_session_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      sessionId: plannedTurn.session.id,
      agentId: agent.id,
      agentName: agent.name,
      source: plannedTurn.source,
      provider: plannedTurn.provider,
      model: plannedTurn.model,
      error: plannedTurn.error,
      turnKind: plannedTurn.turn.kind,
    })

    if (plannedTurn.turn.kind === 'run_task' && plannedTurn.turn.taskBrief && plannedTurn.handoff) {
      emitWorkflowEvent(workflowServices, {
        type: 'handoff_created',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        handoffId: plannedTurn.handoff.id,
        sessionId: plannedTurn.session.id,
        agentId: agent.id,
        agentName: agent.name,
        source: plannedTurn.handoff.source,
        status: plannedTurn.handoff.status,
      })
      emitAgentTaskDispatched(
        workflowServices,
        workspace,
        conversation,
        agent,
        plannedTurn.session,
        plannedTurn.handoff,
        plannedTurn.turn.taskBrief,
      )
      logDiagnostic(workflowServices, {
        level: 'info',
        category: 'handoff',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        sessionId: plannedTurn.session.id,
        handoffId: plannedTurn.handoff.id,
        agentId: agent.id,
        message: 'Created direct-agent task handoff.',
        data: {
          task: plannedTurn.turn.taskBrief.task,
          expectedOutput: plannedTurn.turn.taskBrief.expectedOutput,
        },
      })
      const runState = await workflowServices.store.read()
      const runResult = await runTaskBrief(workflowServices, runState, workspace, conversation, plannedTurn.turn.taskBrief, {
        session: plannedTurn.session,
        handoff: plannedTurn.handoff,
      }, plannedTurn.route)
      emitWorkflowEvent(workflowServices, {
        type: 'workflow_finished',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        summary: runResult.summary,
      })
    } else {
      emitWorkflowEvent(workflowServices, {
        type: 'workflow_finished',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        summary: plannedTurn.turn.finalResponse ?? `${agent.name} 私聊会话已更新。`,
      })
    }

    try {
      await persistWorkflowEvents(workflowServices)
    } catch (error) {
      console.error(error)
    }
    return await workflowServices.store.read()
    */
  }

  const replyContinuationAgentId =
    !input.agentId && conversation.type === 'group'
      ? resolveReplyContinuationAgentId(input.replyTo, conversation, workspaceAgents)
      : undefined
  const directedGroupAgentId = conversation.type === 'group'
    ? lockedAgentId ?? input.agentId ?? replyContinuationAgentId
    : undefined

  if (replyContinuationAgentId) {
    logDiagnostic(workflowServices, {
      level: 'info',
      category: 'routing',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      agentId: replyContinuationAgentId,
      message: 'Preserved quoted child-agent continuity for the current group turn.',
      data: {
        replyTo: input.replyTo,
      },
    })
  }

  emitWorkflowEvent(workflowServices, {
    type: 'workflow_received',
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    content: normalizedMainContent,
  })

  const mainRoute = await routeTurnWithModel({
    env: workflowServices.env,
    content: normalizedMainContent,
    workspace,
    conversation,
    replyTo: input.replyTo,
    codeSelection: input.codeSelection,
  })
  logDiagnostic(workflowServices, {
    level: mainRoute.error ? 'warn' : 'info',
    category: 'routing',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    message: 'Resolved main-brain turn route.',
    data: {
      route: summarizeTurnRoute(mainRoute.route),
      routeProvider: mainRoute.provider,
      routeModel: mainRoute.model,
      routeElapsedMs: mainRoute.elapsedMs,
      routeError: mainRoute.error,
    },
  })
  emitTaskStageUpdated(workflowServices, workspace, conversation, mainRoute.route)

  if (directedGroupAgentId && !routeAllowsExecution(mainRoute.route)) {
    emitWorkflowEvent(workflowServices, {
      type: 'routing_finished',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      source: 'explicit_rule',
      provider: mainRoute.provider,
      model: mainRoute.model,
      error: mainRoute.error,
      lockedAgentId,
      taskStage: mainRoute.route.taskStage,
      executionReadiness: mainRoute.route.executionReadiness,
      needsUserConfirmation: mainRoute.route.needsUserConfirmation,
      speakerAgentId: directedGroupAgentId,
      finalizationMode: 'speaker_direct',
      mode: 'single_agent',
      brainKind: 'dispatch_agents',
      execution: 'serial',
      targetAgents: [directedGroupAgentId],
    })
    return await runDirectedAgentConversationTurn(
      workflowServices,
      state,
      workspace,
      conversation,
      directedGroupAgentId,
      input.content,
      input.replyTo,
      input.codeSelection,
    )
  }

  const dynamicVisibleSpeaker = selectDynamicVisibleSpeaker({
    content: normalizedMainContent,
    conversation,
    agents: workspaceAgents,
    taskStage: mainRoute.route.taskStage,
    replyTo: input.replyTo,
  })
  if (
    dynamicVisibleSpeaker &&
    !input.agentId &&
    !routeAllowsExecution(mainRoute.route) &&
    !shouldKeepPlannerDispatch(mainRoute.route.taskStage)
  ) {
    logDiagnostic(workflowServices, {
      level: 'info',
      category: 'routing',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      message: 'Selected one visible child agent for a group-chat turn.',
      data: dynamicVisibleSpeaker,
    })
    emitWorkflowEvent(workflowServices, {
      type: 'routing_finished',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      source: 'explicit_rule',
      provider: mainRoute.provider,
      model: mainRoute.model,
      error: mainRoute.error,
      taskStage: mainRoute.route.taskStage,
      executionReadiness: mainRoute.route.executionReadiness,
      needsUserConfirmation: mainRoute.route.needsUserConfirmation,
      speakerAgentId: dynamicVisibleSpeaker.agentId,
      finalizationMode: 'speaker_direct',
      mode: 'single_agent',
      brainKind: 'dispatch_agents',
      execution: 'serial',
      targetAgents: [dynamicVisibleSpeaker.agentId],
    })
    return await runDirectedAgentConversationTurn(
      workflowServices,
      state,
      workspace,
      conversation,
      dynamicVisibleSpeaker.agentId,
      input.content,
      input.replyTo,
      input.codeSelection,
    )
  }

  if (mainRoute.route.needsModel && canStreamMainRouteDirectly(mainRoute.route)) {
    emitWorkflowEvent(workflowServices, {
      type: 'routing_finished',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      source: mainRoute.route.source,
      provider: mainRoute.provider,
      model: mainRoute.model,
      error: mainRoute.error,
      taskStage: mainRoute.route.taskStage,
      executionReadiness: mainRoute.route.executionReadiness,
      needsUserConfirmation: mainRoute.route.needsUserConfirmation,
      speakerAgentId: 'orchestrator',
      finalizationMode: 'speaker_direct',
      mode: 'answer_directly',
      brainKind: 'direct_answer',
      execution: 'serial',
      targetAgents: [],
    })
    const finalContent = await streamAndPersistMainBrainReply(
      workflowServices,
      workspace,
      conversation,
      normalizedMainContent,
      input.replyTo,
      input.codeSelection,
      mainRoute.route,
      mainRoute.route.localResponse,
    )
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: finalContent,
    })
    try {
      await persistWorkflowEvents(workflowServices)
    } catch (error) {
      console.error(error)
    }
    return await workflowServices.store.read()
  }

  if (!mainRoute.route.needsModel && mainRoute.route.localResponse) {
    const localRouting: PlannedRoutingDecision = {
      source: 'explicit_rule',
      decision: {
        kind: 'direct_answer',
        finalResponse: mainRoute.route.localResponse,
        execution: 'serial',
        dispatches: [],
        targetAgents: [],
        internalNote: mainRoute.route.reason,
      },
    }
    emitWorkflowEvent(workflowServices, {
      type: 'routing_finished',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      source: localRouting.source,
      taskStage: mainRoute.route.taskStage,
      executionReadiness: mainRoute.route.executionReadiness,
      needsUserConfirmation: mainRoute.route.needsUserConfirmation,
      speakerAgentId: 'orchestrator',
      finalizationMode: 'speaker_direct',
      mode: 'answer_directly',
      brainKind: 'direct_answer',
      execution: 'serial',
      targetAgents: [],
    })
    await appendFinalSummary(workflowServices, workspace, conversation, localRouting, [])
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: mainRoute.route.localResponse,
    })
    try {
      await persistWorkflowEvents(workflowServices)
    } catch (error) {
      console.error(error)
    }
    return await workflowServices.store.read()
  }

  emitWorkflowEvent(workflowServices, {
    type: 'context_started',
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    scope: 'main_brain',
  })
  const plannedRouting = await runWithHeartbeat(
    workflowServices,
    {
      type: 'routing_started',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      content: normalizedMainContent,
    },
    tick => ({
      type: 'agent_progress',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      runId: `routing-${input.conversationId}`,
      agentId: ORCHESTRATOR_AGENT_ID,
      agentName: orchestratorDisplayName(workspaceAgents),
      message: `主脑正在规划本轮调度，第 ${tick} 次刷新。`,
    }),
    async () => {
      emitWorkflowEvent(workflowServices, {
        type: 'model_call_started',
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        scope: 'main_brain',
        provider: workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
        model: mainRoute.route.modelProfile === 'router'
          ? workflowServices.env.AGENTHUB_ROUTER_MODEL
          : workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
      })
      return decideRoutingWithPlanner({
        content: normalizedMainContent,
        conversation,
        agents: workspaceAgents,
        targetAgentId: directedGroupAgentId,
        lockedAgentId,
        replyTo: input.replyTo,
        codeSelection: input.codeSelection,
        env: workflowServices.env,
        state,
        workspace,
        route: mainRoute.route,
      })
    },
    3000,
  )
  if (plannedRouting.contextTokenEstimate !== undefined) {
    emitWorkflowEvent(workflowServices, {
      type: 'context_finished',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      scope: 'main_brain',
      tokenEstimate: plannedRouting.contextTokenEstimate,
      summary: 'Main-brain planner context.',
    })
    logDiagnostic(workflowServices, {
      level: 'debug',
      category: 'context',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      message: 'Built main-brain planner context.',
      data: {
        tokenEstimate: plannedRouting.contextTokenEstimate,
      },
    })
  }
  if (plannedRouting.error) {
    emitWorkflowEvent(workflowServices, {
      type: 'model_call_failed',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      scope: 'main_brain',
      provider: plannedRouting.provider ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
      model: plannedRouting.model ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
      elapsedMs: plannedRouting.modelElapsedMs,
      error: plannedRouting.error,
    })
    logDiagnostic(workflowServices, {
      level: 'warn',
      category: 'main_brain',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      message: 'Main-brain model failed and fallback routing was used.',
      data: {
        error: plannedRouting.error,
        elapsedMs: plannedRouting.modelElapsedMs,
      },
    })
  } else if (plannedRouting.source === 'model') {
    emitWorkflowEvent(workflowServices, {
      type: 'model_call_finished',
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      scope: 'main_brain',
      provider: plannedRouting.provider ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_PROVIDER,
      model: plannedRouting.model ?? workflowServices.env.AGENTHUB_ORCHESTRATOR_MODEL,
      elapsedMs: plannedRouting.modelElapsedMs ?? 0,
    })
  }
  const stageGuardedRouting = applyTaskStageGuard(
    workflowServices,
    state,
    workspace,
    conversation,
    plannedRouting,
    mainRoute.route,
    normalizedMainContent,
  )
  // A group-room explicit @agent is a hard lock: one executor, one visible speaker, no orchestration fan-out.
  const explicitLockedRouting = lockedAgentId
    ? lockRoutingDecisionToAgent(stageGuardedRouting, lockedAgentId)
    : stageGuardedRouting
  const reviewGuardedRouting = lockedAgentId
    ? explicitLockedRouting
    : applyReviewSafety(workflowServices, state, workspace, conversation, explicitLockedRouting)
  const routing = lockedAgentId
    ? explicitLockedRouting
    : applyExecutionSafety(workflowServices, state, workspace, conversation, reviewGuardedRouting)
  const decision = routing.decision
  const visibleTurn = resolveVisibleTurn(decision)

  emitWorkflowEvent(workflowServices, {
    type: 'routing_finished',
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    source: routing.source,
    provider: routing.provider,
    model: routing.model,
    error: routing.error,
    lockedAgentId,
    taskStage: mainRoute.route.taskStage,
    executionReadiness: mainRoute.route.executionReadiness,
    needsUserConfirmation: mainRoute.route.needsUserConfirmation,
    speakerAgentId: visibleTurn.speakerAgentId,
    finalizationMode: visibleTurn.finalizationMode,
    mode: decision.kind === 'dispatch_agents'
      ? decision.dispatches.length > 1
        ? 'multi_agent'
        : 'single_agent'
      : 'answer_directly',
    brainKind: decision.kind,
    execution: decision.execution,
    targetAgents: decision.targetAgents,
  })

  if (decision.kind === 'direct_answer' || decision.kind === 'ask_clarification') {
    await appendFinalSummary(workflowServices, workspace, conversation, routing, [])
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: decision.finalResponse ?? '任务已记录。',
    })
    try {
      await persistWorkflowEvents(workflowServices)
    } catch (error) {
      console.error(error)
    }
    const finalState = await workflowServices.store.read()
    return finalState
  }

  const results: TaskBriefRunResult[] = []
  if (decision.execution === 'parallel') {
    results.push(
      ...(await Promise.all(
        decision.dispatches.map(async brief => {
          const latestState = await workflowServices.store.read()
          const sessionScope = await createMainDispatchSessionScope(
            workflowServices,
            workspace,
            conversation,
            latestState,
            brief,
          )
          const runState = await workflowServices.store.read()
          return runTaskBrief(
            workflowServices,
            runState,
            workspace,
            conversation,
            brief,
            sessionScope,
            mainRoute.route,
            {
              publishConversationMessage: shouldPersistChildRunAsConversationMessage(decision, brief.agentId),
            },
          )
        }),
      )),
    )
  } else {
    for (const brief of decision.dispatches) {
      const latestState = await workflowServices.store.read()
      const sessionScope = await createMainDispatchSessionScope(workflowServices, workspace, conversation, latestState, brief)
      const runState = await workflowServices.store.read()
      results.push(
        await runTaskBrief(
          workflowServices,
          runState,
          workspace,
          conversation,
          brief,
          sessionScope,
          mainRoute.route,
          {
            publishConversationMessage: shouldPersistChildRunAsConversationMessage(decision, brief.agentId),
          },
        ),
      )
    }
  }

  if (!decision.lockedAgentId) {
    const repairedResults = await runAutomaticRepairIfNeeded(
      workflowServices,
      workspace,
      conversation,
      results,
      decision.dispatches,
      (brief, runState, sessionScope) => runTaskBrief(
        workflowServices,
        runState,
        workspace,
        conversation,
        brief,
        sessionScope,
        mainRoute.route,
      ),
    )
    results.splice(0, results.length, ...repairedResults)
  }

  if (visibleTurn.finalizationMode === 'speaker_direct' && visibleTurn.speakerAgentId !== 'orchestrator' && results.length === 1) {
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: results[0]?.summary ?? results[0]?.output ?? '本轮子 Agent 已完成。',
    })
    try {
      await persistWorkflowEvents(workflowServices)
    } catch (error) {
      console.error(error)
    }
    return await workflowServices.store.read()
  }

  if (decision.lockedAgentId) {
    emitWorkflowEvent(workflowServices, {
      type: 'workflow_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      summary: results.at(-1)?.summary ?? results.at(-1)?.output ?? `${decision.lockedAgentId} finished.`,
    })
    try {
      await persistWorkflowEvents(workflowServices)
    } catch (error) {
      console.error(error)
    }
    return await workflowServices.store.read()
  }

  const synthesisState = await workflowServices.store.read()
  const synthesis = await runSynthesis(
    workflowServices,
    synthesisState,
    workspace,
    conversation,
    routing,
    normalizedMainContent,
    results,
  )

  emitWorkflowEvent(workflowServices, {
    type: 'synthesis_finished',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    source: synthesis.source,
    provider: synthesis.provider,
    model: synthesis.model,
    error: synthesis.error,
    synthesisKind: synthesis.synthesis.kind,
    verdict: synthesis.synthesis.verdict,
    followUpAgents: synthesis.synthesis.followUpDispatches.map(brief => brief.agentId),
  })

  const localSummaries = results.map(result => result.summary)
  await appendSynthesisSummary(workflowServices, workspace, conversation, normalizedMainContent, synthesis, localSummaries)
  emitWorkflowEvent(workflowServices, {
    type: 'workflow_finished',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    summary: synthesis.synthesis.finalResponse ?? (localSummaries.join(' | ') || '本轮调度完成。'),
  })
  try {
    await persistWorkflowEvents(workflowServices)
  } catch (error) {
    console.error(error)
  }
  const finalState = await workflowServices.store.read()
  return finalState
  } finally {
    if (workflowEventLog.length > 0 || diagnosticLogBuffer.length > 0) {
      try {
        await persistWorkflowEvents(workflowServices)
      } catch (error) {
        console.error(error)
      }
    }
  }
}
