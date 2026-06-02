import type {
  AppState,
  Artifact,
  ChangedFile,
  LiveWorkflowEvent,
  Message,
  StreamingAssistantDraft,
  WorkflowEvent,
  WorkspaceDeliverySurface,
} from './types'

export type ChatProcessTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger'
export type ChatTurnStatus = 'running' | 'awaiting_commit' | 'completed' | 'partial' | 'failed'
export type ChatTurnArtifactKind = 'preview' | 'diff' | 'review' | 'zip' | 'deploy' | 'text' | 'artifact'
export type ChatProcessKind =
  | 'route'
  | 'stage'
  | 'context'
  | 'dispatch'
  | 'progress'
  | 'log'
  | 'artifact'
  | 'validation'
  | 'review'
  | 'synthesis'
  | 'reply'
  | 'status'

export type ChatTurnProcessEntry = {
  id: string
  kind: ChatProcessKind
  title: string
  summary?: string
  detail?: string
  time: string
  tone: ChatProcessTone
  agentId?: string
  badge?: string
  meta?: string
  logStream?: 'stdout' | 'stderr'
  logExcerpt?: string
}

export type ChatTurnArtifact = {
  id: string
  kind: ChatTurnArtifactKind
  title: string
  summary: string
  createdAt: string
  url?: string
  agentId?: string
  deliverySurface?: WorkspaceDeliverySurface
  verdict?: string
  issues?: string[]
  detailText?: string
  patch?: string
  files?: ChangedFile[]
  fileCount?: number
  byteLength?: number
}

export type ChatTurn = {
  id: string
  turnId?: string
  userMessage: Message
  finalMessage?: Message
  streamingMessage?: Message
  settlingMessage?: Message
  processEntries: ChatTurnProcessEntry[]
  artifacts: ChatTurnArtifact[]
  startedAt: string
  updatedAt: string
  status: ChatTurnStatus
  speakerAgentId?: string
  taskStage?: string
}

export type ChatTimelineItem =
  | {
      kind: 'turn'
      id: string
      createdAt: string
      turn: ChatTurn
    }
  | {
      kind: 'message'
      id: string
      createdAt: string
      message: Message
    }

type BuildChatTimelineInput = {
  state: AppState
  workspaceId: string
  conversationId: string
  messages: Message[]
  streamingMessages: StreamingAssistantDraft[]
  workflowEvents: LiveWorkflowEvent[]
}

type MutableTurn = {
  id: string
  turnId?: string
  userMessage: Message
  finalMessage?: Message
  streamingMessage?: Message
  settlingMessage?: Message
  processEntries: ChatTurnProcessEntry[]
  artifacts: ChatTurnArtifact[]
  startedAt: string
  updatedAt: string
  status: ChatTurnStatus
  speakerAgentId?: string
  taskStage?: string
}

type ReviewArtifactSource = {
  verdict?: string
  summary: string
  issues: string[]
  createdAt: string
  agentId?: string
}

const EVENT_STAGE_LABELS: Record<string, string> = {
  chat: '自由对话',
  requirements_intake: '需求澄清',
  planning: '方案规划',
  awaiting_confirmation: '等待确认',
  execution: '执行中',
  review: '审查验收',
}

/**
 * Builds the chat timeline items used by the conversation UI.
 * Input: room-scoped state, messages, streaming messages, and workflow events.
 * Output: standalone messages and grouped turn blocks in chronological order.
 */
export function buildChatTimeline(input: BuildChatTimelineInput): ChatTimelineItem[] {
  const agentNames = new Map(input.state.agents.map(agent => [agent.id, agent.name]))
  const roomEvents = input.workflowEvents
    .filter(event => event.workspaceId === input.workspaceId && event.conversationId === input.conversationId)
    .slice()
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
  const roomMessages = input.messages
    .filter(message => message.conversationId === input.conversationId)
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const roomStreamingMessages = input.streamingMessages
    .filter(draft => draft.message.conversationId === input.conversationId)
    .slice()
    .sort((left, right) => left.message.createdAt.localeCompare(right.message.createdAt))
  const turnStartedEvents = roomEvents.filter(
    (event): event is Extract<LiveWorkflowEvent, { type: 'turn_started' }> => event.type === 'turn_started',
  )
  const turnOrder: MutableTurn[] = []
  const turnById = new Map<string, MutableTurn>()
  const userMessageTurnIds = new Map<string, string>()
  const assistantMessageTurnIds = new Map<string, string>()
  const unassignedUserMessages = roomMessages
    .filter(message => message.senderType === 'user')
    .slice()

  for (const event of turnStartedEvents) {
    if (!event.turnId) {
      continue
    }

    const matchingUserMessage = roomMessages.find(message =>
      message.senderType === 'user' &&
      message.turnId === event.turnId,
    ) ?? findLatestUnassignedUserMessage(unassignedUserMessages, userMessageTurnIds, event.receivedAt)

    if (!matchingUserMessage) {
      continue
    }

    const turn: MutableTurn = {
      id: event.turnId,
      turnId: event.turnId,
      userMessage: matchingUserMessage,
      finalMessage: undefined,
      streamingMessage: undefined,
      settlingMessage: undefined,
      processEntries: [],
      artifacts: [],
      startedAt: event.receivedAt,
      updatedAt: matchingUserMessage.createdAt,
      status: 'running',
      speakerAgentId: undefined,
      taskStage: undefined,
    }
    turnOrder.push(turn)
    turnById.set(turn.id, turn)
    userMessageTurnIds.set(matchingUserMessage.id, turn.id)
  }

  const unboundUserMessages = roomMessages.filter(message =>
    message.senderType === 'user' && !userMessageTurnIds.has(message.id),
  )

  for (const [index, message] of unboundUserMessages.entries()) {
    const fallbackTurnId = message.turnId ?? `turn-local-${index}-${message.id}`
    const turn: MutableTurn = {
      id: fallbackTurnId,
      turnId: message.turnId,
      userMessage: message,
      finalMessage: undefined,
      streamingMessage: undefined,
      settlingMessage: undefined,
      processEntries: [],
      artifacts: [],
      startedAt: message.createdAt,
      updatedAt: message.createdAt,
      status: 'completed',
      speakerAgentId: undefined,
      taskStage: undefined,
    }
    turnOrder.push(turn)
    turnById.set(turn.id, turn)
    userMessageTurnIds.set(message.id, turn.id)
  }

  for (const event of roomEvents) {
    if (event.type === 'assistant_message_started' && event.turnId) {
      assistantMessageTurnIds.set(event.messageId, event.turnId)
    }
  }

  const artifactsById = new Map(
    input.state.artifacts
      .filter(artifact => artifact.workspaceId === input.workspaceId)
      .map(artifact => [artifact.id, artifact]),
  )
  const changeSetsById = new Map(
    input.state.changeSets
      .filter(changeSet => changeSet.workspaceId === input.workspaceId)
      .map(changeSet => [changeSet.id, changeSet]),
  )
  const reviewArtifactsByTurnId = new Map<string, ReviewArtifactSource>()
  const mappedMessageIds = new Set<string>()
  const standaloneMessages: Message[] = []

  for (const message of roomMessages) {
    if (message.senderType === 'user') {
      continue
    }

    const directTurnId = message.turnId ?? assistantMessageTurnIds.get(message.id)
    const fallbackTurn = findLatestTurnBefore(turnOrder, message.createdAt)
    const targetTurn = (directTurnId ? turnById.get(directTurnId) : undefined) ?? fallbackTurn

    if (!targetTurn) {
      standaloneMessages.push(message)
      continue
    }

    if (!targetTurn.finalMessage || targetTurn.finalMessage.createdAt <= message.createdAt) {
      targetTurn.finalMessage = message
      targetTurn.updatedAt = laterTimestamp(targetTurn.updatedAt, message.createdAt)
      mappedMessageIds.add(message.id)
    }
  }

  for (const event of roomEvents) {
    const targetTurn = resolveEventTurn(turnOrder, turnById, event)

    if (!targetTurn) {
      continue
    }

    targetTurn.updatedAt = laterTimestamp(targetTurn.updatedAt, event.receivedAt)

    if (event.type === 'routing_finished') {
      targetTurn.speakerAgentId = event.speakerAgentId
      targetTurn.taskStage = event.taskStage
    } else if (event.type === 'task_stage_updated') {
      targetTurn.taskStage = event.taskStage
    } else if (event.type === 'workflow_finished') {
      targetTurn.status = 'completed'
    } else if (event.type === 'assistant_message_error') {
      targetTurn.status = 'failed'
    } else if (event.type === 'agent_finished' && event.status === 'failed') {
      targetTurn.status = 'failed'
    } else if (
      (event.type === 'agent_finished' && event.status === 'partial') ||
      (event.type === 'delivery_validation_finished' && event.status === 'partial') ||
      (event.type === 'review_verdict' && event.verdict === 'partial')
    ) {
      if (targetTurn.status !== 'failed') {
        targetTurn.status = 'partial'
      }
    } else if (
      (event.type === 'delivery_validation_finished' && event.status === 'fail') ||
      (event.type === 'review_verdict' && event.verdict === 'fail')
    ) {
      targetTurn.status = 'failed'
    }

    const processEntry = eventToProcessCard(event, agentNames)
    if (processEntry) {
      upsertProcessEntry(targetTurn.processEntries, processEntry)
    }

    if (event.type === 'artifact_created') {
      const artifact = artifactsById.get(event.artifactId)
      if (artifact) {
        pushUniqueArtifact(targetTurn.artifacts, artifactToChatArtifact(artifact))
      }
    } else if (event.type === 'preview_ready') {
      const artifact = artifactsById.get(event.artifactId)
      if (artifact) {
        pushUniqueArtifact(targetTurn.artifacts, artifactToChatArtifact(artifact))
      }
    } else if (event.type === 'zip_ready') {
      const artifact = artifactsById.get(event.artifactId)
      if (artifact) {
        pushUniqueArtifact(targetTurn.artifacts, artifactToChatArtifact(artifact))
      }
    } else if (event.type === 'change_set_created') {
      const changeSet = changeSetsById.get(event.changeSetId)
      if (changeSet) {
        pushUniqueArtifact(targetTurn.artifacts, {
          id: changeSet.id,
          kind: 'diff',
          title: '代码 Diff',
          summary: changeSet.summary,
          createdAt: changeSet.createdAt,
          patch: changeSet.patch,
          files: changeSet.files,
        })
      }
    } else if (event.type === 'review_verdict') {
      reviewArtifactsByTurnId.set(targetTurn.id, {
        verdict: event.verdict.toUpperCase(),
        summary: event.summary,
        issues: event.issues,
        createdAt: event.receivedAt,
        agentId: event.agentId,
      })
    } else if (event.type === 'delivery_validation_finished') {
      reviewArtifactsByTurnId.set(targetTurn.id, {
        verdict: event.status.toUpperCase(),
        summary: event.summary,
        issues: event.issues.map(issue => issue.path ? `${issue.path}: ${issue.message}` : issue.message),
        createdAt: event.receivedAt,
        agentId: event.agentId,
      })
    }
  }

  for (const draft of roomStreamingMessages) {
    const streamingMessage = draft.message
    const directTurnId = streamingMessage.turnId ?? assistantMessageTurnIds.get(streamingMessage.id)
    const targetTurn =
      (directTurnId ? turnById.get(directTurnId) : undefined) ??
      turnOrder[turnOrder.length - 1]

    if (!targetTurn) {
      continue
    }

    if (draft.phase === 'streaming') {
      targetTurn.streamingMessage = streamingMessage
      targetTurn.settlingMessage = undefined
    } else {
      targetTurn.settlingMessage = streamingMessage
      targetTurn.streamingMessage = undefined
    }
    targetTurn.updatedAt = laterTimestamp(targetTurn.updatedAt, streamingMessage.createdAt)
    targetTurn.status = draft.phase === 'streaming' ? 'running' : targetTurn.status
  }

  for (const turn of turnOrder) {
    if (turn.finalMessage?.artifacts.length) {
      for (const artifact of turn.finalMessage.artifacts) {
        pushUniqueArtifact(turn.artifacts, artifactToChatArtifact(artifact))
      }
    }

    const reviewArtifact = reviewArtifactsByTurnId.get(turn.id)
    if (reviewArtifact) {
      pushUniqueArtifact(turn.artifacts, {
        id: `review-${turn.id}`,
        kind: 'review',
        title: '审查结论',
        summary: reviewArtifact.summary,
        createdAt: reviewArtifact.createdAt,
        verdict: reviewArtifact.verdict,
        issues: reviewArtifact.issues,
        agentId: reviewArtifact.agentId,
      })
    }

    if (turn.streamingMessage) {
      turn.status = 'running'
    } else if (turn.settlingMessage && !turn.finalMessage) {
      if (turn.status !== 'failed' && turn.status !== 'partial') {
        turn.status = 'awaiting_commit'
      }
    } else if (turn.finalMessage && turn.status === 'running') {
      turn.status = 'completed'
    } else if (!turn.finalMessage && turn.status === 'running') {
      turn.status = turn.processEntries.length > 0 ? 'running' : 'completed'
    }

    sortArtifacts(turn.artifacts)
  }

  const items: ChatTimelineItem[] = []
  const turnIdsInTimeline = new Set<string>()

  for (const message of roomMessages) {
    const userTurnId = userMessageTurnIds.get(message.id)
    if (userTurnId) {
      const turn = turnById.get(userTurnId)
      if (turn && !turnIdsInTimeline.has(turn.id)) {
        items.push({
          kind: 'turn',
          id: turn.id,
          createdAt: turn.startedAt,
          turn: turnToReadonly(turn),
        })
        turnIdsInTimeline.add(turn.id)
      }
      continue
    }

    if (!mappedMessageIds.has(message.id)) {
      items.push({
        kind: 'message',
        id: message.id,
        createdAt: message.createdAt,
        message,
      })
    }
  }

  for (const turn of turnOrder) {
    if (!turnIdsInTimeline.has(turn.id)) {
      items.push({
        kind: 'turn',
        id: turn.id,
        createdAt: turn.startedAt,
        turn: turnToReadonly(turn),
      })
    }
  }

  return items.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

/**
 * Returns the latest turn whose user message already exists before a timestamp.
 * Input: ordered turns and a timestamp. Output: closest earlier turn or undefined.
 */
function findLatestTurnBefore(turns: MutableTurn[], timestamp: string): MutableTurn | undefined {
  const eligible = turns.filter(turn => turn.userMessage.createdAt <= timestamp)
  return eligible[eligible.length - 1]
}

/**
 * Returns the latest unassigned visible user message before one event timestamp.
 * Input: visible user messages, the assigned-message set, and one event timestamp.
 * Output: closest earlier unbound user message or undefined.
 */
function findLatestUnassignedUserMessage(
  messages: Message[],
  assignedTurnIds: Map<string, string>,
  timestamp: string,
): Message | undefined {
  const eligible = messages.filter(message =>
    !assignedTurnIds.has(message.id) &&
    message.createdAt <= timestamp,
  )
  return eligible[eligible.length - 1]
}

/**
 * Resolves one event to its owning turn.
 * Input: ordered turns, turn lookup, and one workflow event. Output: target turn or undefined.
 */
function resolveEventTurn(
  turns: MutableTurn[],
  turnById: Map<string, MutableTurn>,
  event: LiveWorkflowEvent,
): MutableTurn | undefined {
  if (event.turnId) {
    const directTurn = turnById.get(event.turnId)
    if (directTurn) {
      return directTurn
    }
  }

  return findLatestTurnBefore(turns, event.receivedAt)
}

/**
 * Converts one persisted artifact into the chat-specific artifact view model.
 * Input: runtime artifact. Output: chat artifact card payload.
 */
function artifactToChatArtifact(artifact: Artifact): ChatTurnArtifact {
  const kind = artifact.type === 'web-preview'
    ? 'preview'
    : artifact.type === 'zip'
      ? 'zip'
      : artifact.type === 'deploy-status'
        ? 'deploy'
      : artifact.type === 'text'
        ? 'text'
        : 'artifact'

  return {
    id: artifact.id,
    kind,
    title: artifact.title,
    summary: artifact.content,
    createdAt: artifact.createdAt,
    url: artifact.url,
    agentId: artifact.createdByAgentId,
    deliverySurface: readDeliverySurfaceMetadata(artifact.metadata?.kind),
    detailText: artifact.type === 'text' ? artifact.content : undefined,
    fileCount: readNumericMetadata(artifact.metadata, 'fileCount'),
    byteLength: readNumericMetadata(artifact.metadata, 'byteLength'),
  }
}

/**
 * Maps one raw artifact metadata value into the delivery-preview surface union.
 * Input: metadata.kind from the backend artifact payload.
 * Output: build or deployment when the artifact belongs to local delivery.
 */
function readDeliverySurfaceMetadata(value: unknown): WorkspaceDeliverySurface | undefined {
  return value === 'build' || value === 'deployment' ? value : undefined
}

/**
 * Reads one numeric artifact metadata field when it is available.
 * Input: raw metadata record and the desired numeric key.
 * Output: numeric value or undefined when the field is absent or invalid.
 */
function readNumericMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Keeps artifact cards unique by id while preserving the first visible order.
 * Input: artifact list and candidate artifact. Output: none.
 */
function pushUniqueArtifact(artifacts: ChatTurnArtifact[], artifact: ChatTurnArtifact): void {
  if (artifacts.some(candidate => candidate.id === artifact.id)) {
    return
  }
  artifacts.push(artifact)
}

/**
 * Sorts chat artifact cards into preview, diff, review, zip, text, then generic order.
 * Input: artifact list. Output: none.
 */
function sortArtifacts(artifacts: ChatTurnArtifact[]): void {
  const weight: Record<ChatTurnArtifactKind, number> = {
    preview: 0,
    diff: 1,
    review: 2,
    zip: 3,
    deploy: 4,
    text: 5,
    artifact: 6,
  }

  artifacts.sort((left, right) => {
    const weightGap = weight[left.kind] - weight[right.kind]
    if (weightGap !== 0) {
      return weightGap
    }
    return left.createdAt.localeCompare(right.createdAt)
  })
}

/**
 * Upserts one process entry and merges noisy log output into a single row.
 * Input: current process entries and a candidate entry. Output: none.
 */
function upsertProcessEntry(entries: ChatTurnProcessEntry[], candidate: ChatTurnProcessEntry): void {
  const existing = entries.find(entry => entry.id === candidate.id)
  if (!existing) {
    entries.push(candidate)
    return
  }

  existing.kind = candidate.kind
  existing.title = candidate.title
  existing.summary = candidate.summary
  existing.detail = candidate.detail
  existing.time = candidate.time
  existing.tone = candidate.tone
  existing.agentId = candidate.agentId
  existing.badge = candidate.badge
  existing.meta = candidate.meta
  existing.logStream = candidate.logStream
  existing.logExcerpt = candidate.kind === 'log'
    ? mergeLogExcerpt(existing.logExcerpt, candidate.logExcerpt)
    : candidate.logExcerpt
}

/**
 * Converts one workflow event into a readable process row for the chat timeline.
 * Input: room-scoped workflow event. Output: display-ready process entry or undefined.
 */
function eventToProcessEntry(event: LiveWorkflowEvent, agentNames: Map<string, string>): ChatTurnProcessEntry | undefined {
  switch (event.type) {
    case 'workflow_received':
      return createProcessEntry(event, 'workflow-received', '已接收本轮消息', undefined, 'neutral')
    case 'routing_started':
      return createProcessEntry(event, 'routing-started', '主脑正在判断由谁处理', undefined, 'running')
    case 'task_stage_updated':
      return createProcessEntry(
        event,
        `task-stage-${event.taskStage}`,
        `当前阶段：${EVENT_STAGE_LABELS[event.taskStage] ?? event.taskStage}`,
        compactText(event.reason, 120),
        'neutral',
      )
    case 'routing_finished':
      return createProcessEntry(
        event,
        'routing-finished',
        describeRoutingFinished(event, agentNames),
        buildRoutingDetail(event),
        'success',
        event.speakerAgentId,
      )
    case 'context_started':
      return createProcessEntry(
        event,
        `context-${event.scope}-${event.agentId ?? 'main'}`,
        describeContextStarted(event),
        undefined,
        'running',
        event.agentId,
      )
    case 'agent_task_dispatched':
      return createProcessEntry(
        event,
        `dispatch-${event.handoffId}`,
        `已派给 ${event.agentName}`,
        compactText(event.task, 160),
        'running',
        event.agentId,
      )
    case 'agent_started':
      return createProcessEntry(
        event,
        `agent-started-${event.runId}`,
        `${event.agentName} 已开始执行`,
        compactText(event.task, 160),
        'running',
        event.agentId,
      )
    case 'agent_progress':
      return createProcessEntry(
        event,
        `agent-progress-${event.runId}-${compactKey(event.message)}`,
        `${event.agentName} 执行进展`,
        compactText(event.message, 180),
        'running',
        event.agentId,
      )
    case 'agent_stdout_delta':
    case 'agent_stderr_delta':
      return createProcessEntry(
        event,
        `${event.type}-${event.runId}`,
        `${event.agentName} 执行输出`,
        summarizeLogDelta(event.delta),
        event.type === 'agent_stderr_delta' ? 'warning' : 'running',
        event.agentId,
      )
    case 'agent_output_finished':
      return createProcessEntry(
        event,
        `agent-output-finished-${event.runId}-${event.stream}`,
        `${event.agentName} 输出结束`,
        describeOutputFinished(event),
        event.exitCode === 0 || event.exitCode === null ? 'success' : 'warning',
        event.agentId,
      )
    case 'agent_finished':
      return createProcessEntry(
        event,
        `agent-finished-${event.runId}`,
        `${event.agentName}${describeAgentFinishedStatus(event.status)}`,
        compactText(event.summary, 180),
        event.status === 'failed' ? 'danger' : event.status === 'partial' ? 'warning' : 'success',
        event.agentId,
      )
    case 'delivery_validation_finished':
      return createProcessEntry(
        event,
        `delivery-${event.runId}`,
        `交付校验：${event.status.toUpperCase()}`,
        compactText(event.summary, 180),
        deliveryTone(event.status),
        event.agentId,
      )
    case 'review_verdict':
      return createProcessEntry(
        event,
        `review-${event.runId}`,
        `审查结论：${event.verdict.toUpperCase()}`,
        compactText(event.summary, 180),
        deliveryTone(event.verdict),
        event.agentId,
      )
    case 'artifact_created':
      return createProcessEntry(
        event,
        `artifact-${event.artifactId}`,
        `已生成产物：${event.title}`,
        undefined,
        'success',
        event.agentId,
      )
    case 'change_set_created':
      return createProcessEntry(
        event,
        `changes-${event.changeSetId}`,
        '已生成代码 Diff',
        compactText(event.summary, 160),
        'success',
      )
    case 'preview_ready':
      return createProcessEntry(event, `preview-${event.artifactId}`, '已生成本地预览', compactText(event.previewUrl, 120), 'success', event.agentId)
    case 'zip_ready':
      return createProcessEntry(event, `zip-${event.artifactId}`, '已打包源码', `${event.fileCount} files`, 'success')
    case 'assistant_message_started':
      return createProcessEntry(
        event,
        `assistant-started-${event.messageId}`,
        `${event.senderName ?? event.senderId} 正在输出结果`,
        undefined,
        'running',
        event.senderId,
      )
    case 'assistant_message_error':
      return createProcessEntry(
        event,
        `assistant-error-${event.messageId}`,
        '结果输出失败',
        compactText(event.error, 160),
        'danger',
      )
    case 'synthesis_started':
      return createProcessEntry(event, 'synthesis-started', '主脑正在汇总多 Agent 结果', undefined, 'running')
    case 'synthesis_finished':
      return createProcessEntry(
        event,
        'synthesis-finished',
        '主脑已完成结果汇总',
        compactText(event.synthesisKind, 80),
        'success',
      )
    case 'workflow_finished':
      return createProcessEntry(event, 'workflow-finished', '本轮已完成', compactText(event.summary, 120), 'success')
    default:
      return undefined
  }
}

/**
 * Creates one normalized process entry.
 * Input: workflow event plus display metadata. Output: process entry.
 */
function createProcessEntry(
  event: LiveWorkflowEvent,
  id: string,
  label: string,
  detail: string | undefined,
  tone: ChatProcessTone,
  agentId?: string,
): ChatTurnProcessEntry {
  return {
    id,
    kind: 'status',
    title: label,
    detail,
    time: event.receivedAt,
    tone,
    agentId,
  }
}

/**
 * Describes the final routing decision in plain Chinese.
 * Input: routing-finished event. Output: concise label text.
 */
function describeRoutingFinished(
  event: Extract<WorkflowEvent, { type: 'routing_finished' }>,
  agentNames: Map<string, string>,
): string {
  if (!event.targetAgents.length) {
    return '主脑将直接回复'
  }

  if (event.finalizationMode === 'speaker_direct' && event.speakerAgentId && event.speakerAgentId !== 'orchestrator') {
    return `${displayAgentName(event.speakerAgentId, agentNames)} 将直接回复`
  }

  if (event.targetAgents.length === 1) {
    return `已确定由 ${displayAgentName(event.targetAgents[0], agentNames)} 处理这一轮`
  }

  return `已安排 ${event.targetAgents.map(agentId => displayAgentName(agentId, agentNames)).join(' -> ')} 协作处理`
}

/**
 * Builds a routing detail line with stage and finish mode context.
 * Input: routing-finished event. Output: compact detail text.
 */
function buildRoutingDetail(event: Extract<WorkflowEvent, { type: 'routing_finished' }>): string | undefined {
  const details = [
    event.taskStage ? `阶段：${EVENT_STAGE_LABELS[event.taskStage] ?? event.taskStage}` : undefined,
    event.finalizationMode ? `输出：${event.finalizationMode}` : undefined,
  ].filter(Boolean)

  return details.length ? details.join(' · ') : undefined
}

/**
 * Describes which context scope is being prepared.
 * Input: context-started event. Output: human-readable label.
 */
function describeContextStarted(event: Extract<WorkflowEvent, { type: 'context_started' }>): string {
  if (event.agentName) {
    return `正在为 ${event.agentName} 整理上下文`
  }
  return '正在整理上下文'
}

/**
 * Summarizes one stdout or stderr delta into a short readable excerpt.
 * Input: raw output delta. Output: compact multi-line excerpt.
 */
function summarizeLogDelta(delta: string): string {
  const lines = delta
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const joined = lines.slice(-4).join('\n')
  return compactText(joined || delta.trim(), 220)
}

/**
 * Describes the output-finished event in one compact line.
 * Input: output-finished event. Output: short summary.
 */
function describeOutputFinished(event: Extract<WorkflowEvent, { type: 'agent_output_finished' }>): string {
  const parts = [
    event.stream,
    `chunks=${event.chunkCount}`,
    event.exitCode === null ? undefined : `exit=${event.exitCode}`,
    event.timedOut ? 'timed out' : undefined,
  ].filter(Boolean)
  return parts.join(' · ')
}

/**
 * Returns the suffix used when an agent run completes.
 * Input: agent-finished status. Output: display suffix.
 */
function describeAgentFinishedStatus(status: 'success' | 'partial' | 'failed'): string {
  if (status === 'failed') {
    return ' 执行失败'
  }
  if (status === 'partial') {
    return ' 部分完成'
  }
  return ' 已完成'
}

/**
 * Maps delivery and review verdicts to process tones.
 * Input: status or verdict string. Output: matching visual tone.
 */
function deliveryTone(value: string): ChatProcessTone {
  if (value === 'fail' || value === 'failed') {
    return 'danger'
  }
  if (value === 'partial') {
    return 'warning'
  }
  return 'success'
}

/**
 * Converts one workflow event into a structured process card for the chat timeline.
 * Input: room-scoped workflow event plus the current agent-name map.
 * Output: display-ready process card data or undefined.
 */
function eventToProcessCard(event: LiveWorkflowEvent, agentNames: Map<string, string>): ChatTurnProcessEntry | undefined {
  switch (event.type) {
    case 'workflow_received':
      return createProcessCard(event, {
        id: 'workflow-received',
        kind: 'status',
        badge: '接收',
        title: '已接收本轮消息',
        tone: 'neutral',
      })
    case 'routing_started':
      return createProcessCard(event, {
        id: 'routing-decision',
        kind: 'route',
        badge: '路由',
        title: '主脑正在判断由谁处理',
        summary: compactText(event.content, 180),
        tone: 'running',
      })
    case 'task_stage_updated':
      return createProcessCard(event, {
        id: `task-stage-${event.taskStage}`,
        kind: 'stage',
        badge: '阶段',
        title: `当前阶段：${EVENT_STAGE_LABELS[event.taskStage] ?? event.taskStage}`,
        summary: compactText(event.reason, 180),
        meta: buildTaskStageMeta(event),
        tone: 'neutral',
      })
    case 'routing_finished':
      return createProcessCard(event, {
        id: 'routing-decision',
        kind: 'route',
        badge: '路由',
        title: describeRoutingFinished(event, agentNames),
        summary: buildRoutingSummary(event),
        detail: buildRoutingCardDetail(event),
        tone: 'success',
        agentId: event.speakerAgentId,
      })
    case 'context_started':
      return createProcessCard(event, {
        id: `context-${event.scope}-${event.agentId ?? 'main'}`,
        kind: 'context',
        badge: '上下文',
        title: describeContextStarted(event),
        detail: `范围：${event.scope}`,
        tone: 'running',
        agentId: event.agentId,
      })
    case 'context_finished':
      return createProcessCard(event, {
        id: `context-${event.scope}-main`,
        kind: 'context',
        badge: '上下文',
        title: '上下文整理完成',
        summary: compactText(event.summary ?? '', 180) || undefined,
        detail: `范围：${event.scope} | 约 ${event.tokenEstimate} tokens`,
        tone: 'success',
      })
    case 'model_call_started':
      return createProcessCard(event, {
        id: `model-call-${event.scope}-${event.agentId ?? event.provider}`,
        kind: 'progress',
        badge: '模型',
        title: describeModelCallStarted(event),
        detail: buildModelCallDetail(event.provider, event.model),
        tone: 'running',
        agentId: event.agentId,
      })
    case 'model_call_finished':
      return createProcessCard(event, {
        id: `model-call-${event.scope}-${event.provider}`,
        kind: 'progress',
        badge: '模型',
        title: `模型调用完成：${event.provider}`,
        detail: [buildModelCallDetail(event.provider, event.model), `${Math.round(event.elapsedMs)}ms`]
          .filter(Boolean)
          .join(' | '),
        tone: 'success',
      })
    case 'model_call_failed':
      return createProcessCard(event, {
        id: `model-call-${event.scope}-${event.provider ?? 'unknown'}`,
        kind: 'progress',
        badge: '模型',
        title: `模型调用失败：${event.provider ?? 'unknown'}`,
        summary: compactText(event.error, 200),
        detail: buildModelCallDetail(event.provider, event.model),
        tone: 'danger',
      })
    case 'agent_task_dispatched':
      return createProcessCard(event, {
        id: `dispatch-${event.handoffId}`,
        kind: 'dispatch',
        badge: '派发',
        title: `已派发给 ${event.agentName}`,
        summary: compactText(event.task, 220),
        detail: buildDispatchDetail(event.expectedOutput, event.requiredContext),
        tone: 'running',
        agentId: event.agentId,
      })
    case 'agent_started':
      return createProcessCard(event, {
        id: `agent-run-${event.runId}`,
        kind: 'progress',
        badge: '执行',
        title: `${event.agentName} 已开始执行`,
        summary: compactText(event.task, 220),
        detail: `上下文：${event.contextTokens} tokens`,
        tone: 'running',
        agentId: event.agentId,
      })
    case 'agent_progress':
      return createProcessCard(event, {
        id: `agent-progress-${event.runId}-${compactKey(event.message)}`,
        kind: 'progress',
        badge: '进展',
        title: `${event.agentName} 执行进展`,
        summary: event.message,
        tone: 'running',
        agentId: event.agentId,
      })
    case 'agent_stdout_delta':
    case 'agent_stderr_delta':
      return createProcessCard(event, {
        id: `agent-log-${event.runId}-${event.type === 'agent_stderr_delta' ? 'stderr' : 'stdout'}`,
        kind: 'log',
        badge: event.type === 'agent_stderr_delta' ? 'stderr' : 'stdout',
        title: `${event.agentName} 执行输出`,
        logStream: event.type === 'agent_stderr_delta' ? 'stderr' : 'stdout',
        logExcerpt: summarizeLogDelta(event.delta),
        detail: `最近输出 | ${event.byteLength} bytes`,
        tone: event.type === 'agent_stderr_delta' ? 'warning' : 'running',
        agentId: event.agentId,
      })
    case 'agent_output_finished':
      return createProcessCard(event, {
        id: `agent-log-${event.runId}-${event.stream}`,
        kind: 'log',
        badge: event.stream,
        title: `${event.agentName} 输出结束`,
        detail: describeOutputFinished(event),
        logStream: event.stream,
        tone: event.exitCode === 0 || event.exitCode === null ? 'success' : 'warning',
        agentId: event.agentId,
      })
    case 'agent_finished':
      return createProcessCard(event, {
        id: `agent-run-${event.runId}`,
        kind: 'status',
        badge: '执行',
        title: `${event.agentName}${describeAgentFinishedStatus(event.status)}`,
        summary: compactText(event.summary, 220),
        detail: `baseCommit: ${event.baseCommit}`,
        tone: event.status === 'failed' ? 'danger' : event.status === 'partial' ? 'warning' : 'success',
        agentId: event.agentId,
      })
    case 'delivery_validation_finished':
      return createProcessCard(event, {
        id: `delivery-${event.runId}`,
        kind: 'validation',
        badge: '校验',
        title: `交付校验：${event.status.toUpperCase()}`,
        summary: compactText(event.summary, 220),
        detail: buildValidationDetail(event.issues),
        tone: deliveryTone(event.status),
        agentId: event.agentId,
      })
    case 'review_verdict':
      return createProcessCard(event, {
        id: `review-${event.runId}`,
        kind: 'review',
        badge: '审查',
        title: `审查结论：${event.verdict.toUpperCase()}`,
        summary: compactText(event.summary, 220),
        detail: buildIssueMarkdown(event.issues),
        tone: deliveryTone(event.verdict),
        agentId: event.agentId,
      })
    case 'artifact_created':
      return createProcessCard(event, {
        id: `artifact-${event.artifactId}`,
        kind: 'artifact',
        badge: '产物',
        title: `已生成产物：${event.title}`,
        detail: describeArtifactDetail(event.artifactType, event.url),
        tone: 'success',
        agentId: event.agentId,
      })
    case 'change_set_created':
      return createProcessCard(event, {
        id: `changes-${event.changeSetId}`,
        kind: 'artifact',
        badge: 'Diff',
        title: '已生成代码 Diff',
        summary: compactText(event.summary, 220),
        detail: buildChangedFilesDetail(event.files),
        tone: 'success',
      })
    case 'preview_ready':
      return createProcessCard(event, {
        id: `preview-${event.artifactId}`,
        kind: 'artifact',
        badge: 'Preview',
        title: '已生成本地预览',
        detail: compactText(event.previewUrl, 180),
        tone: 'success',
        agentId: event.agentId,
      })
    case 'zip_ready':
      return createProcessCard(event, {
        id: `zip-${event.artifactId}`,
        kind: 'artifact',
        badge: 'Zip',
        title: '已打包源码',
        detail: `${event.fileCount} files | ${formatByteLength(event.byteLength)}`,
        tone: 'success',
      })
    case 'assistant_message_started':
      return createProcessCard(event, {
        id: `reply-${event.messageId}`,
        kind: 'reply',
        badge: '回复',
        title: `${event.senderName ?? event.senderId} 正在输出结果`,
        tone: 'running',
        agentId: event.senderId,
      })
    case 'assistant_message_finished':
      return createProcessCard(event, {
        id: `reply-${event.messageId}`,
        kind: 'reply',
        badge: '回复',
        title: '结果输出完成',
        detail: `内容长度：${event.contentLength} chars`,
        tone: 'success',
      })
    case 'assistant_message_error':
      return createProcessCard(event, {
        id: `reply-${event.messageId}`,
        kind: 'reply',
        badge: '回复',
        title: '结果输出失败',
        summary: compactText(event.error, 200),
        tone: 'danger',
      })
    case 'synthesis_started':
      return createProcessCard(event, {
        id: 'synthesis-state',
        kind: 'synthesis',
        badge: '汇总',
        title: '主脑正在汇总多 Agent 结果',
        detail: `${event.runCount} 个执行结果`,
        tone: 'running',
      })
    case 'synthesis_finished':
      return createProcessCard(event, {
        id: 'synthesis-state',
        kind: 'synthesis',
        badge: '汇总',
        title: '主脑已完成结果汇总',
        summary: buildSynthesisSummary(event),
        detail: buildSynthesisDetail(event.followUpAgents),
        tone: event.verdict === 'failed' ? 'danger' : event.verdict === 'partial' ? 'warning' : 'success',
      })
    case 'workflow_finished':
      return createProcessCard(event, {
        id: 'workflow-finished',
        kind: 'status',
        badge: '完成',
        title: '本轮已完成',
        summary: compactText(event.summary, 220),
        tone: 'success',
      })
    default:
      return undefined
  }
}

/**
 * Creates one structured process card entry.
 * Input: workflow event plus the process-card payload without time.
 * Output: normalized process card entry.
 */
function createProcessCard(
  event: LiveWorkflowEvent,
  input: Omit<ChatTurnProcessEntry, 'time'>,
): ChatTurnProcessEntry {
  return {
    ...input,
    time: event.receivedAt,
  }
}

/**
 * Builds one compact metadata line for a stage update.
 * Input: task-stage-updated event. Output: compact metadata text.
 */
function buildTaskStageMeta(event: Extract<WorkflowEvent, { type: 'task_stage_updated' }>): string {
  return [
    `readiness: ${event.executionReadiness}`,
    event.needsUserConfirmation ? '需要确认' : '无需确认',
  ].join(' · ')
}

/**
 * Builds one readable summary body for the routing decision card.
 * Input: routing-finished event. Output: short Markdown-friendly text.
 */
function buildRoutingSummary(event: Extract<WorkflowEvent, { type: 'routing_finished' }>): string | undefined {
  const lines = [
    event.execution ? `执行判断：${event.execution}` : undefined,
    event.brainKind ? `主脑动作：${describeBrainKind(event.brainKind)}` : undefined,
    event.needsUserConfirmation ? '当前仍需用户确认后再继续执行。' : undefined,
  ].filter(Boolean)

  return lines.length ? lines.join('\n') : undefined
}

/**
 * Builds one compact detail line for the routing decision card.
 * Input: routing-finished event. Output: compact detail text.
 */
function buildRoutingCardDetail(event: Extract<WorkflowEvent, { type: 'routing_finished' }>): string | undefined {
  const details = [
    event.taskStage ? `阶段：${EVENT_STAGE_LABELS[event.taskStage] ?? event.taskStage}` : undefined,
    event.finalizationMode ? `输出：${event.finalizationMode}` : undefined,
    event.source ? `来源：${event.source}` : undefined,
  ].filter(Boolean)

  return details.length ? details.join(' | ') : undefined
}

/**
 * Builds one compact detail line for a handoff dispatch card.
 * Input: expected output and required context refs. Output: compact text.
 */
function buildDispatchDetail(expectedOutput: string, requiredContext: string[]): string {
  const parts = [
    expectedOutput ? `期望输出：${compactText(expectedOutput, 140)}` : undefined,
    requiredContext.length ? `上下文引用：${requiredContext.length}` : undefined,
  ].filter(Boolean)

  return parts.join(' | ')
}

/**
 * Builds one compact provider-model label for model-call cards.
 * Input: provider and optional model values. Output: compact text or undefined.
 */
function buildModelCallDetail(provider: string | undefined, model: string | undefined): string | undefined {
  const parts = [provider, model].filter(Boolean)
  return parts.length ? parts.join(' / ') : undefined
}

/**
 * Describes a started model call in plain language.
 * Input: model-call-started event. Output: process-card title text.
 */
function describeModelCallStarted(event: Extract<WorkflowEvent, { type: 'model_call_started' }>): string {
  if (event.agentName) {
    return `${event.agentName} 正在调用 ${event.provider}`
  }

  return `正在调用 ${event.provider}`
}

/**
 * Converts validation issues into a Markdown bullet list.
 * Input: validation issue array. Output: Markdown bullets or undefined.
 */
function buildValidationDetail(
  issues: Array<{ severity: string; message: string; path?: string }>,
): string | undefined {
  if (!issues.length) {
    return undefined
  }

  return issues
    .map(issue => `- [${issue.severity}] ${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
    .join('\n')
}

/**
 * Converts plain issue strings into a Markdown bullet list.
 * Input: issue strings. Output: Markdown bullets or undefined.
 */
function buildIssueMarkdown(issues: string[]): string | undefined {
  if (!issues.length) {
    return undefined
  }

  return issues.map(issue => `- ${issue}`).join('\n')
}

/**
 * Builds a compact changed-file bullet list for a diff card.
 * Input: changed files. Output: Markdown bullets or undefined.
 */
function buildChangedFilesDetail(files: ChangedFile[]): string | undefined {
  if (!files.length) {
    return undefined
  }

  return files
    .slice(0, 4)
    .map(file => `- \`${file.path}\` (+${file.additions} / -${file.deletions})`)
    .join('\n')
}

/**
 * Describes an artifact card in one compact line.
 * Input: artifact type and optional URL. Output: compact detail text.
 */
function describeArtifactDetail(type: Artifact['type'], url: string | undefined): string | undefined {
  const typeLabel = type === 'web-preview'
    ? '本地预览'
    : type === 'zip'
      ? '源码压缩包'
      : type === 'text'
        ? '文本产物'
        : type

  const parts = [typeLabel, url ? compactText(url, 140) : undefined].filter(Boolean)
  return parts.length ? parts.join(' | ') : undefined
}

/**
 * Describes one synthesis result in compact form.
 * Input: synthesis-finished event. Output: compact summary text.
 */
function buildSynthesisSummary(event: Extract<WorkflowEvent, { type: 'synthesis_finished' }>): string {
  return [
    `结果类型：${event.synthesisKind}`,
    `结论：${event.verdict}`,
  ].join(' · ')
}

/**
 * Builds a follow-up line for synthesis output.
 * Input: follow-up agents. Output: compact text or undefined.
 */
function buildSynthesisDetail(followUpAgents: string[]): string | undefined {
  if (!followUpAgents.length) {
    return undefined
  }

  return `后续参与：${followUpAgents.join(', ')}`
}

/**
 * Merges incremental log excerpts and keeps the latest visible lines.
 * Input: current excerpt and a new excerpt chunk. Output: merged excerpt.
 */
function mergeLogExcerpt(current: string | undefined, candidate: string | undefined): string | undefined {
  if (!candidate) {
    return current
  }

  const lines = [current, candidate]
    .filter(Boolean)
    .flatMap(value => value!.split('\n'))
    .map(line => line.trimEnd())
    .filter(Boolean)

  return lines.slice(-8).join('\n')
}

/**
 * Formats byte length into a compact human-readable label.
 * Input: raw byte count. Output: bytes / KB / MB label.
 */
function formatByteLength(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`
  }

  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }

  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Describes the main-brain turn kind in plain Chinese.
 * Input: brain kind. Output: localized text.
 */
function describeBrainKind(kind: string): string {
  if (kind === 'direct_answer') {
    return '直接回答'
  }
  if (kind === 'dispatch_agents') {
    return '派发子 Agent'
  }
  if (kind === 'ask_clarification') {
    return '要求补充信息'
  }
  return kind
}

/**
 * Produces a compact stable key from free text.
 * Input: raw text. Output: truncated text key used for dedupe.
 */
function compactKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').slice(0, 48)
}

/**
 * Keeps the later timestamp between two ISO strings.
 * Input: current and candidate timestamps. Output: the later value.
 */
function laterTimestamp(current: string, candidate: string): string {
  return current >= candidate ? current : candidate
}

/**
 * Clips long text so process rows stay readable inside the chat stream.
 * Input: raw text and max length. Output: compact text.
 */
function compactText(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

/**
 * Resolves one agent id to its display name when available.
 * Input: agent id and room agent-name map.
 * Output: localized agent display name or the original id.
 */
function displayAgentName(agentId: string, agentNames: Map<string, string>): string {
  return agentNames.get(agentId) ?? agentId
}

/**
 * Freezes a mutable turn into the readonly timeline shape.
 * Input: mutable turn under construction. Output: immutable chat turn.
 */
function turnToReadonly(turn: MutableTurn): ChatTurn {
  return {
    id: turn.id,
    turnId: turn.turnId,
    userMessage: turn.userMessage,
    finalMessage: turn.finalMessage,
    streamingMessage: turn.streamingMessage,
    settlingMessage: turn.settlingMessage,
    processEntries: turn.processEntries.slice().sort((left, right) => left.time.localeCompare(right.time)),
    artifacts: turn.artifacts.slice(),
    startedAt: turn.startedAt,
    updatedAt: turn.updatedAt,
    status: turn.status,
    speakerAgentId: turn.speakerAgentId,
    taskStage: turn.taskStage,
  }
}
