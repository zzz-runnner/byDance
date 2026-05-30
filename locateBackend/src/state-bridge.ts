import type {
  ConversationType,
  FrontendAppState,
  FrontendWorkspace,
  ProjectStateResponse,
  ProjectResponse,
  ProjectStatePage,
  RuntimeAppState,
  RuntimeConversation,
  RuntimeDiagnosticLog,
  StoredProjectRecord,
  WorkbenchOverviewResponse,
} from './types.js'

const DEFAULT_MESSAGE_LIMIT = 40
const MAX_MESSAGE_LIMIT = 200

/**
 * Adds preview and zip metadata to one stored project record.
 * Input: stored project record fields.
 * Output: frontend-ready project response.
 */
export function toProjectResponse(project: {
  projectId: string
  workspaceId: string
  name: string
  goal: string
  conversationId: string
  conversationType?: ConversationType
  targetAgentId?: string
  createdAt: string
  updatedAt: string
}): ProjectResponse {
  return {
    ...project,
    agentHubPreviewUrl: previewUrlFor(project.workspaceId),
    agentHubZipUrl: zipUrlFor(project.workspaceId),
  }
}

/**
 * Filters the global AgentHub state down to one project workspace.
 * Input: full runtime state and one stored project reference.
 * Output: frontend-scoped state for a single workspace.
 */
export function selectProjectState(
  state: RuntimeAppState,
  project: {
    projectId: string
    workspaceId: string
  },
  options?: {
    messageLimit?: number
  },
): ProjectStateResponse {
  const workspaceId = project.workspaceId
  const conversations = state.conversations.filter(conversation => conversation.workspaceId === workspaceId)
  const conversationIds = new Set(conversations.map(conversation => conversation.id))
  const agentSessions = state.agentSessions.filter(session => session.workspaceId === workspaceId)
  const sessionIds = new Set(agentSessions.map(session => session.id))
  const taskHandoffs = state.taskHandoffs.filter(handoff => handoff.workspaceId === workspaceId)
  const handoffIds = new Set(taskHandoffs.map(handoff => handoff.id))
  const agentRuns = state.agentRuns.filter(run => run.workspaceId === workspaceId)
  const runIds = new Set(agentRuns.map(run => run.id))
  const allMessages = state.messages
    .filter(message => message.workspaceId === workspaceId || conversationIds.has(message.conversationId))
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const messagePage = paginateMessages(allMessages, options?.messageLimit)

  return {
    state: {
      workspaces: state.workspaces
        .filter(workspace => workspace.id === workspaceId)
        .map(workspace => attachProjectMetadata(workspace, project.projectId)),
      conversations,
      messages: messagePage.messages,
      agents: state.agents,
      agentSessions,
      agentSessionMessages: state.agentSessionMessages.filter(
        message => message.workspaceId === workspaceId || sessionIds.has(message.sessionId),
      ),
      taskHandoffs,
      agentRuns,
      artifacts: state.artifacts.filter(
        artifact => artifact.workspaceId === workspaceId || (artifact.agentRunId ? runIds.has(artifact.agentRunId) : false),
      ),
      changeSets: state.changeSets.filter(
        changeSet => changeSet.workspaceId === workspaceId || runIds.has(changeSet.agentRunId),
      ),
      contextSnapshots: state.contextSnapshots.filter(
        snapshot =>
          snapshot.workspaceId === workspaceId ||
          conversationIds.has(snapshot.conversationId) ||
          (snapshot.agentRunId ? runIds.has(snapshot.agentRunId) : false),
      ),
      workflowEvents: state.workflowEvents.filter(
        record => record.workspaceId === workspaceId || conversationIds.has(record.conversationId),
      ),
      diagnosticLogs: state.diagnosticLogs.filter(log =>
        belongsToWorkspace(log, workspaceId, conversationIds, sessionIds, handoffIds, runIds),
      ),
    },
    messagePage: {
      limit: messagePage.limit,
      total: messagePage.total,
      hasMore: messagePage.hasMore,
    },
  }
}

/**
 * Builds the lightweight workbench overview used by the left workspace list.
 * Input: full runtime state, stored projects, and one source-root display label.
 * Output: one overview payload with room summaries only.
 */
export function buildWorkbenchOverview(
  state: RuntimeAppState,
  projects: StoredProjectRecord[],
  sourceRootLabel: string,
): WorkbenchOverviewResponse {
  const rooms = projects
    .flatMap(project => {
      const workspace = state.workspaces.find(candidate => candidate.id === project.workspaceId)
      const conversation = selectProjectConversation(
        state.conversations,
        project.workspaceId,
        project.conversationType ?? 'group',
        project.targetAgentId,
      )

      if (!workspace || !conversation) {
        return []
      }

      const participantAgentIds = conversation.participants.filter(participant => participant !== 'user')
      const latestEvent = state.workflowEvents
        .filter(record => record.workspaceId === workspace.id && record.conversationId === conversation.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      const latestMessage = state.messages
        .filter(message => message.conversationId === conversation.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      const artifactCount = state.artifacts.filter(artifact => artifact.workspaceId === workspace.id).length
      const runningAgents = state.agentRuns.filter(
        run => run.workspaceId === workspace.id && run.conversationId === conversation.id && run.status === 'running',
      ).length
      const messageCount = state.messages.filter(message => message.conversationId === conversation.id).length
      const lastActivityAt = [workspace.updatedAt, conversation.updatedAt, latestEvent?.createdAt, latestMessage?.createdAt]
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => right.localeCompare(left))[0] ?? conversation.updatedAt

      return [{
        id: workspace.id,
        kind: conversation.type,
        title: conversation.type === 'group' ? workspace.name : conversation.title,
        subtitle: conversation.type === 'group' ? workspace.goal : `${workspace.name} / ${workspace.goal}`,
        workspace: attachProjectMetadata(workspace, project.projectId),
        conversation,
        targetAgentId: conversation.type === 'direct' ? participantAgentIds[0] : project.targetAgentId,
        participantAgentIds,
        signal: {
          runningAgents,
          latestEventLabel: latestEventLabel(latestEvent),
          artifactCount,
          messageCount,
        },
        lastActivityAt,
      }]
    })
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))

  return {
    agents: state.agents,
    rooms,
    sourceRootLabel,
  }
}

/**
 * Selects the default group conversation for one workspace.
 * Input: runtime conversations and a workspace id.
 * Output: preferred group conversation or the latest fallback.
 */
export function selectDefaultConversation(
  conversations: RuntimeConversation[],
  workspaceId: string,
): RuntimeConversation | undefined {
  const workspaceConversations = conversations
    .filter(conversation => conversation.workspaceId === workspaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return workspaceConversations.find(conversation => conversation.type === 'group') ?? workspaceConversations[0]
}

/**
 * Selects the conversation that should back one project room.
 * Input: runtime conversations, workspace id, preferred type, and optional target agent.
 * Output: matching conversation or the latest workspace fallback.
 */
export function selectProjectConversation(
  conversations: RuntimeConversation[],
  workspaceId: string,
  conversationType: ConversationType,
  targetAgentId?: string,
): RuntimeConversation | undefined {
  const workspaceConversations = conversations
    .filter(conversation => conversation.workspaceId === workspaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  if (conversationType === 'direct') {
    return (
      workspaceConversations.find(
        conversation =>
          conversation.type === 'direct' &&
          (!targetAgentId || conversation.participants.includes(targetAgentId)),
      ) ??
      workspaceConversations.find(conversation => conversation.type === 'direct') ??
      workspaceConversations[0]
    )
  }

  return workspaceConversations.find(conversation => conversation.type === 'group') ?? workspaceConversations[0]
}

/**
 * Builds the frontend preview URL for one workspace.
 * Input: workspace id.
 * Output: relative preview URL.
 */
export function previewUrlFor(workspaceId: string): string {
  return `/preview/${encodeURIComponent(workspaceId)}/index.html`
}

/**
 * Builds the frontend zip URL for one workspace.
 * Input: workspace id.
 * Output: relative zip URL.
 */
export function zipUrlFor(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/zip`
}

/**
 * Copies one runtime workspace with project metadata for the frontend.
 * Input: runtime workspace and project id.
 * Output: augmented workspace object.
 */
function attachProjectMetadata(workspace: RuntimeAppState['workspaces'][number], projectId: string): FrontendWorkspace {
  return {
    ...workspace,
    projectId,
    agentHubPreviewUrl: previewUrlFor(workspace.id),
    agentHubZipUrl: zipUrlFor(workspace.id),
  }
}

/**
 * Slices one complete message list into the recent page exposed to the frontend.
 * Input: ordered message list and optional requested limit.
 * Output: paged messages plus page metadata.
 */
function paginateMessages(
  messages: FrontendAppState['messages'],
  requestedLimit?: number,
): ProjectStatePage & { messages: FrontendAppState['messages'] } {
  const limit = Math.max(1, Math.min(requestedLimit ?? DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT))
  const pagedMessages = messages.slice(-limit)
  return {
    limit,
    total: messages.length,
    hasMore: messages.length > pagedMessages.length,
    messages: pagedMessages,
  }
}

/**
 * Converts the latest persisted workflow record into one short room summary label.
 * Input: optional persisted workflow event record.
 * Output: localized one-line activity label.
 */
function latestEventLabel(
  record: RuntimeAppState['workflowEvents'][number] | undefined,
): string {
  const eventType = typeof record?.event?.type === 'string' ? record.event.type : ''

  switch (eventType) {
    case 'turn_started':
      return '用户发起了新任务'
    case 'routing_finished':
      return '主脑完成了本轮路由'
    case 'assistant_message_started':
      return 'Agent 开始回复'
    case 'assistant_message_finished':
      return 'Agent 回复完成'
    case 'preview_ready':
      return '网页预览已准备好'
    case 'change_set_created':
      return '生成了新的代码 Diff'
    case 'workflow_finished':
      return '本轮任务已完成'
    case 'agent_progress':
      return 'Agent 正在持续执行'
    default:
      return '暂无新事件'
  }
}

/**
 * Returns whether one diagnostic log belongs to the selected workspace scope.
 * Input: log record plus workspace-linked entity ids.
 * Output: true when the log should be exposed to the frontend.
 */
function belongsToWorkspace(
  log: RuntimeDiagnosticLog,
  workspaceId: string,
  conversationIds: Set<string>,
  sessionIds: Set<string>,
  handoffIds: Set<string>,
  runIds: Set<string>,
): boolean {
  if (log.workspaceId === workspaceId) {
    return true
  }

  if (log.conversationId && conversationIds.has(log.conversationId)) {
    return true
  }

  if (log.sessionId && sessionIds.has(log.sessionId)) {
    return true
  }

  if (log.handoffId && handoffIds.has(log.handoffId)) {
    return true
  }

  return Boolean(log.runId && runIds.has(log.runId))
}
