import type {
  AgentDefinition,
  AppState,
  Conversation,
  LiveWorkflowEvent,
  Message,
  WorkspaceSignal,
  WorkspaceRoom,
  WorkflowEvent,
  WorkflowEventRecord,
} from './types'

export const DEFAULT_ORCHESTRATOR_NAME = '项目经理 Agent'

const STAGE_LABELS: Record<string, string> = {
  chat: '自由对话',
  requirements_intake: '需求澄清',
  planning: '方案规划',
  awaiting_confirmation: '等待确认',
  execution: '执行中',
  review: '审查验收',
}

/**
 * Builds a lookup table for agents by id.
 * Input: the full AppState.
 * Output: a Map keyed by agent id.
 */
export function buildAgentMap(state: AppState): Map<string, AgentDefinition> {
  return new Map(state.agents.map(agent => [agent.id, agent]))
}

/**
 * Resolves the current display name for one agent without changing the stable id.
 * Input: optional agent definition and an optional fallback id.
 * Output: display-ready agent name.
 */
export function agentDisplayName(agent: AgentDefinition | undefined, fallbackId?: string): string {
  const trimmedName = agent?.name?.trim() ?? ''

  if (trimmedName) {
    return trimmedName
  }

  if (agent?.id === 'orchestrator' || fallbackId === 'orchestrator') {
    return DEFAULT_ORCHESTRATOR_NAME
  }

  return agent?.id ?? fallbackId ?? 'Agent'
}

/**
 * Returns conversations that belong to one workspace.
 * Input: AppState and a workspace id.
 * Output: conversations sorted by recent activity.
 */
export function conversationsForWorkspace(state: AppState, workspaceId: string): Conversation[] {
  return state.conversations
    .filter(conversation => conversation.workspaceId === workspaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/**
 * Resolves the direct agent id for a conversation when possible.
 * Input: a conversation.
 * Output: a participant agent id or undefined.
 */
export function directAgentId(conversation: Conversation | undefined): string | undefined {
  if (!conversation || conversation.type !== 'direct') {
    return undefined
  }

  return conversation.participants.find(participant => participant !== 'user')
}

/**
 * Selects one primary chat conversation for a workspace.
 * Input: AppState and workspace id.
 * Output: the preferred group conversation or a direct fallback.
 */
export function primaryConversationForWorkspace(state: AppState, workspaceId: string): Conversation | undefined {
  const workspace = state.workspaces.find(item => item.id === workspaceId)
  const conversations = conversationsForWorkspace(state, workspaceId)

  if (workspace?.workspaceType === 'chat') {
    return conversations.find(conversation => conversation.type === 'direct') ?? conversations[0]
  }

  return conversations.find(conversation => conversation.type === 'group') ?? conversations[0]
}

/**
 * Builds one UI chat room per workspace while hiding backend conversations.
 * Input: the full AppState.
 * Output: workspace rooms sorted by recent activity.
 */
export function workspaceRooms(state: AppState): WorkspaceRoom[] {
  return state.workspaces
    .map(workspace => {
      const conversation = primaryConversationForWorkspace(state, workspace.id)

      if (!conversation) {
        return undefined
      }

      const targetAgentId = directAgentId(conversation)
      const participantAgentIds = conversation.participants.filter(participant => participant !== 'user')
      const title = conversation.type === 'group' ? workspace.name : conversation.title
      const subtitle = conversation.type === 'group' ? workspace.goal : `${workspace.name} / ${workspace.goal}`

      return {
        id: workspace.id,
        kind: conversation.type,
        title,
        subtitle,
        workspace,
        conversation,
        participantAgentIds,
        signal: {
          runningAgents: 0,
          latestEventLabel: '暂无新事件',
          artifactCount: 0,
          messageCount: 0,
        },
        lastActivityAt: conversation.updatedAt,
        ...(targetAgentId ? { targetAgentId } : {}),
      } satisfies WorkspaceRoom
    })
    .filter((room): room is WorkspaceRoom => Boolean(room))
    .sort((left, right) => right.conversation.updatedAt.localeCompare(left.conversation.updatedAt))
}

/**
 * Returns the first available UI workspace room id.
 * Input: the full AppState.
 * Output: workspace id for the first room or an empty string.
 */
export function firstWorkspaceRoomId(state: AppState): string {
  return workspaceRooms(state)[0]?.id ?? ''
}

/**
 * Returns the display label for a workspace room type.
 * Input: room kind.
 * Output: localized room kind label.
 */
export function workspaceRoomKindLabel(kind: WorkspaceRoom['kind']): string {
  return kind === 'group' ? '群聊工作区' : '单聊工作区'
}

/**
 * Returns messages that belong to one conversation.
 * Input: AppState and a conversation id.
 * Output: messages sorted by creation time.
 */
export function messagesForConversation(state: AppState, conversationId: string): Message[] {
  return state.messages
    .filter(message => message.conversationId === conversationId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

/**
 * Formats an ISO timestamp into a compact UI time.
 * Input: ISO timestamp string.
 * Output: display-ready local time.
 */
export function formatTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '--:--'
  }

  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Converts a workflow event type into a readable label.
 * Input: workflow event.
 * Output: short label for timelines and workspace cards.
 */
export function eventLabel(event: WorkflowEvent): string {
  switch (event.type) {
    case 'turn_started':
      return '用户发起新任务'
    case 'workflow_received':
      return '主流程已接收任务'
    case 'routing_started':
      return '开始判断任务路由'
    case 'routing_finished':
      return `路由完成，目标 ${event.targetAgents.join(', ')}`
    case 'task_stage_updated':
      return `阶段更新：${STAGE_LABELS[event.taskStage] ?? event.taskStage}`
    case 'context_started':
      return `开始整理 ${event.scope} 上下文`
    case 'context_finished':
      return `上下文完成，约 ${event.tokenEstimate} tokens`
    case 'model_call_started':
      return `开始调用 ${event.provider}`
    case 'model_call_finished':
      return `模型调用完成，耗时 ${Math.round(event.elapsedMs)}ms`
    case 'model_call_failed':
      return `模型调用失败：${event.error}`
    case 'assistant_message_started':
      return '开始流式回复'
    case 'assistant_delta':
      return '正在流式回复'
    case 'assistant_message_finished':
      return '回复完成'
    case 'assistant_message_error':
      return `回复失败：${event.error}`
    case 'handoff_created':
      return `创建任务包给 ${event.agentName}`
    case 'agent_task_dispatched':
      return `派发给 ${event.agentName}`
    case 'handoff_updated':
      return `${event.agentName} 状态更新为 ${event.status}`
    case 'agent_started':
      return `${event.agentName} 开始执行`
    case 'agent_progress':
      return `${event.agentName} 更新了执行进度`
    case 'agent_output_started':
      return `${event.agentName} 开始输出 ${event.stream}`
    case 'agent_stdout_delta':
    case 'agent_stderr_delta':
      return `${event.agentName} 持续输出日志`
    case 'agent_output_finished':
      return `${event.agentName} 输出结束`
    case 'agent_finished':
      return `${event.agentName} ${event.status === 'success' ? '完成' : event.status === 'partial' ? '部分完成' : '失败'}`
    case 'delivery_validation_finished':
      return `交付验证 ${event.status}`
    case 'review_verdict':
      return `Reviewer 结论：${event.verdict}`
    case 'artifact_created':
      return `生成产物：${event.title}`
    case 'change_set_created':
      return '生成变更集'
    case 'preview_ready':
      return '预览已就绪'
    case 'zip_ready':
      return '源码包已生成'
    case 'agent_session_started':
      return `${event.agentName} 会话开始`
    case 'agent_session_finished':
      return `${event.agentName} 会话结束`
    case 'synthesis_started':
      return '开始汇总 Agent 输出'
    case 'synthesis_finished':
      return `汇总完成：${event.synthesisKind}`
    case 'workflow_finished':
      return '工作流完成'
  }
}

/**
 * Converts workflow events into the recent live event model used by the UI.
 * Input: persisted workflow events and live streamed workflow events.
 * Output: newest workflow events first.
 */
export function mergeWorkflowEvents(records: WorkflowEventRecord[], liveEvents: LiveWorkflowEvent[]): LiveWorkflowEvent[] {
  const persisted = records.map(record => ({
    ...record.event,
    receivedAt: record.createdAt,
  }))

  return [...persisted, ...liveEvents].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
}

/**
 * Computes status signals for one workspace room.
 * Input: AppState, workspace room, and workflow events.
 * Output: summarized signal values for room cards and watchers.
 */
export function workspaceRoomSignal(state: AppState, room: WorkspaceRoom, events: LiveWorkflowEvent[]): WorkspaceSignal {
  const runningAgents = state.agentRuns.filter(
    run => run.workspaceId === room.workspace.id && run.conversationId === room.conversation.id && run.status === 'running',
  ).length
  const roomEvents = events.filter(
    event => event.workspaceId === room.workspace.id && event.conversationId === room.conversation.id,
  )
  const artifactCount = state.artifacts.filter(artifact => artifact.workspaceId === room.workspace.id).length
  const messageCount = state.messages.filter(message => message.conversationId === room.conversation.id).length

  return {
    runningAgents,
    latestEventLabel: roomEvents[0] ? eventLabel(roomEvents[0]) : '暂无新事件',
    artifactCount,
    messageCount,
  }
}

/**
 * Returns the display label for a workflow stage.
 * Input: raw stage value.
 * Output: localized stage label.
 */
export function stageLabel(stage: string | undefined): string {
  return stage ? STAGE_LABELS[stage] ?? stage : '自由对话'
}

/**
 * Returns a stable visual tone for an agent id.
 * Input: agent id.
 * Output: CSS tone class suffix.
 */
export function agentTone(agentId: string): string {
  if (agentId === 'engineer' || agentId === 'codex-direct' || agentId === 'claude-code-direct') {
    return 'blue'
  }

  if (agentId === 'reviewer') {
    return 'green'
  }

  if (agentId === 'product-manager') {
    return 'amber'
  }

  return 'pink'
}
