import type {
  AppState,
  Artifact,
  ChangedFile,
  LiveWorkflowEvent,
  Message,
  WorkflowEvent,
} from './types'

export type ChatProcessTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger'
export type ChatTurnStatus = 'running' | 'completed' | 'partial' | 'failed'
export type ChatTurnArtifactKind = 'preview' | 'diff' | 'review' | 'zip' | 'text' | 'artifact'

export type ChatTurnProcessEntry = {
  id: string
  label: string
  detail?: string
  time: string
  tone: ChatProcessTone
  agentId?: string
}

export type ChatTurnArtifact = {
  id: string
  kind: ChatTurnArtifactKind
  title: string
  summary: string
  createdAt: string
  url?: string
  agentId?: string
  verdict?: string
  issues?: string[]
  detailText?: string
  patch?: string
  files?: ChangedFile[]
}

export type ChatTurn = {
  id: string
  turnId?: string
  userMessage: Message
  finalMessage?: Message
  streamingMessage?: Message
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
  streamingMessages: Message[]
  workflowEvents: LiveWorkflowEvent[]
}

type MutableTurn = {
  id: string
  turnId?: string
  userMessage: Message
  finalMessage?: Message
  streamingMessage?: Message
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
    .filter(message => message.conversationId === input.conversationId)
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const userMessages = roomMessages.filter(message => message.senderType === 'user')
  const turnStartedEvents = roomEvents.filter(
    (event): event is Extract<LiveWorkflowEvent, { type: 'turn_started' }> => event.type === 'turn_started',
  )
  const turnOrder: MutableTurn[] = userMessages.map((message, index) => {
    const startEvent = turnStartedEvents[index]
    return {
      id: startEvent?.turnId ?? `turn-local-${index}`,
      turnId: startEvent?.turnId,
      userMessage: message,
      finalMessage: undefined,
      streamingMessage: undefined,
      processEntries: [],
      artifacts: [],
      startedAt: startEvent?.receivedAt ?? message.createdAt,
      updatedAt: message.createdAt,
      status: 'running',
      speakerAgentId: undefined,
      taskStage: undefined,
    }
  })
  const turnById = new Map(turnOrder.map(turn => [turn.id, turn]))
  const userMessageTurnIds = new Map(turnOrder.map(turn => [turn.userMessage.id, turn.id]))
  const assistantMessageTurnIds = new Map<string, string>()

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

    const directTurnId = assistantMessageTurnIds.get(message.id)
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

    const processEntry = eventToProcessEntry(event, agentNames)
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

  for (const streamingMessage of roomStreamingMessages) {
    const directTurnId = assistantMessageTurnIds.get(streamingMessage.id)
    const targetTurn =
      (directTurnId ? turnById.get(directTurnId) : undefined) ??
      turnOrder[turnOrder.length - 1]

    if (!targetTurn) {
      continue
    }

    targetTurn.streamingMessage = streamingMessage
    targetTurn.updatedAt = laterTimestamp(targetTurn.updatedAt, streamingMessage.createdAt)
    targetTurn.status = 'running'
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
    } else if (!turn.finalMessage && turn.status === 'running') {
      turn.status = 'running'
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
    detailText: artifact.type === 'text' ? artifact.content : undefined,
  }
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
    text: 4,
    artifact: 5,
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

  existing.label = candidate.label
  existing.detail = candidate.detail
  existing.time = candidate.time
  existing.tone = candidate.tone
  existing.agentId = candidate.agentId
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
    label,
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
    processEntries: turn.processEntries.slice().sort((left, right) => left.time.localeCompare(right.time)),
    artifacts: turn.artifacts.slice(),
    startedAt: turn.startedAt,
    updatedAt: turn.updatedAt,
    status: turn.status,
    speakerAgentId: turn.speakerAgentId,
    taskStage: turn.taskStage,
  }
}
