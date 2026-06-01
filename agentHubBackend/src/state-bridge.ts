import type {
  ConversationType,
  FrontendAppState,
  FrontendWorkspace,
  RuntimeAgent,
  ProjectStateResponse,
  ProjectResponse,
  ProjectStatePage,
  RuntimeAppState,
  RuntimeConversation,
  RuntimeDiagnosticLog,
  RuntimeWorkbenchRoomSummary,
  StoredProjectRecord,
  WorkbenchPage,
  WorkbenchOverviewResponse,
} from './types'

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
  conversationId?: string
  conversationType?: ConversationType
  targetAgentId?: string
  pinnedAt?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}): ProjectResponse {
  return {
    ...project,
    conversationId: project.conversationId ?? '',
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
    conversationId?: string
    pinnedAt?: string
    archivedAt?: string
    currentVersionId?: string
    versions?: Array<{
      versionId: string
      sourceZipUrl: string
      buildPreviewUrl?: string
      buildStatus?: 'pending' | 'success' | 'failed'
      buildLog?: string
      createdAt: string
      updatedAt: string
    }>
    deployments?: Array<{
      deploymentId: string
      versionId: string
      deployUrl: string
      createdAt: string
    }>
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
  const conversationId = project.conversationId && conversationIds.has(project.conversationId)
    ? project.conversationId
    : conversations[0]?.id
  const allMessages = state.messages
    .filter(message => message.workspaceId === workspaceId || conversationIds.has(message.conversationId))
    .slice()
  const deliveryMessages = conversationId
    ? buildProjectDeliveryMessages({
        workspaceId,
        conversationId,
        currentVersionId: project.currentVersionId,
        versions: project.versions ?? [],
        deployments: project.deployments ?? [],
      })
    : []
  const mergedMessages = [...allMessages, ...deliveryMessages]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const messagePage = paginateMessages(mergedMessages, options?.messageLimit)
  const visibleTurnIds = new Set(
    messagePage.messages
      .map(message => typeof message.turnId === 'string' ? message.turnId : undefined)
      .filter((turnId): turnId is string => Boolean(turnId)),
  )
  const visibleMessageIds = new Set(messagePage.messages.map(message => message.id))
  const mergedArtifacts = [
    ...state.artifacts.filter(
      artifact => artifact.workspaceId === workspaceId || (artifact.agentRunId ? runIds.has(artifact.agentRunId) : false),
    ),
    ...buildProjectDeliveryArtifacts({
      workspaceId,
      currentVersionId: project.currentVersionId,
      versions: project.versions ?? [],
      deployments: project.deployments ?? [],
    }),
  ].sort((left, right) => readTimestamp(left.createdAt).localeCompare(readTimestamp(right.createdAt)))

  return {
    state: {
      workspaces: state.workspaces
        .filter(workspace => workspace.id === workspaceId)
        .map(workspace => attachProjectMetadata(workspace, project)),
      conversations,
      messages: messagePage.messages,
      agents: state.agents,
      agentSessions,
      agentSessionMessages: state.agentSessionMessages.filter(
        message => message.workspaceId === workspaceId || sessionIds.has(message.sessionId),
      ),
      taskHandoffs,
      agentRuns,
      artifacts: mergedArtifacts,
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
        record => (
          record.workspaceId === workspaceId || conversationIds.has(record.conversationId)
        ) && (
          visibleTurnIds.size === 0 ||
          (typeof record.event.turnId === 'string' && visibleTurnIds.has(record.event.turnId)) ||
          (record.event.type === 'assistant_message_started' && typeof record.event.messageId === 'string' && visibleMessageIds.has(record.event.messageId))
        ),
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
 * Input: full runtime state and stored projects.
 * Output: one overview payload with room summaries only.
 */
export function buildWorkbenchOverview(
  state: RuntimeAppState,
  projects: StoredProjectRecord[],
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
        workspace: attachProjectMetadata(workspace, project),
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
    page: {
      limit: rooms.length,
      hasMore: false,
      total: rooms.length,
    },
  }
}

/**
 * Builds one paged workbench overview from precomputed AgentHub room summaries.
 * Input: lightweight agent list, stored projects for the current page, runtime rooms, and page metadata.
 * Output: frontend-ready workbench overview payload.
 */
export function buildWorkbenchOverviewPage(
  agents: RuntimeAgent[],
  projects: StoredProjectRecord[],
  runtimeRooms: RuntimeWorkbenchRoomSummary[],
  page: WorkbenchPage,
): WorkbenchOverviewResponse {
  const projectByWorkspaceId = new Map(projects.map(project => [project.workspaceId, project]))
  const rooms = runtimeRooms.flatMap(room => {
    const project = projectByWorkspaceId.get(room.workspace.id)
    if (!project) {
      return []
    }

    return [{
      ...room,
      workspace: attachProjectMetadata(room.workspace, project),
    }]
  })

  return {
    agents,
    rooms,
    page,
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
  return `/preview/${encodeURIComponent(workspaceId)}`
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
function attachProjectMetadata(
  workspace: RuntimeAppState['workspaces'][number],
  project: Pick<StoredProjectRecord, 'projectId' | 'pinnedAt' | 'archivedAt'>,
): FrontendWorkspace {
  return {
    ...workspace,
    projectId: project.projectId,
    agentHubPreviewUrl: previewUrlFor(workspace.id),
    agentHubZipUrl: zipUrlFor(workspace.id),
    pinnedAt: project.pinnedAt,
    archivedAt: project.archivedAt,
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

type DeliveryProjectionInput = {
  workspaceId: string
  conversationId?: string
  currentVersionId?: string
  versions: Array<{
    versionId: string
    sourceZipUrl: string
    buildPreviewUrl?: string
    buildStatus?: 'pending' | 'success' | 'failed'
    buildLog?: string
    createdAt: string
    updatedAt: string
  }>
  deployments: Array<{
    deploymentId: string
    versionId: string
    deployUrl: string
    createdAt: string
  }>
}

/**
 * Builds the synthetic delivery artifacts derived from business-project metadata.
 * Input: current project delivery metadata.
 * Output: stable artifact records injected into the frontend state.
 */
function buildProjectDeliveryArtifacts(input: DeliveryProjectionInput): FrontendAppState['artifacts'] {
  const artifacts: FrontendAppState['artifacts'] = []
  const currentVersion = resolveCurrentDeliveryVersion(input)
  const latestDeployment = resolveLatestDeployment(input)

  if (currentVersion) {
    artifacts.push({
      id: `local-source-${currentVersion.versionId}`,
      workspaceId: input.workspaceId,
      type: 'zip',
      title: '源码快照',
      content: `版本 ${currentVersion.versionId} 的源码快照已保存，可直接下载。`,
      url: currentVersion.sourceZipUrl,
      createdByAgentId: 'system',
      metadata: {
        status: 'ready',
        versionId: currentVersion.versionId,
      },
      createdAt: currentVersion.createdAt,
    })

    if (currentVersion.buildStatus === 'success' && currentVersion.buildPreviewUrl) {
      artifacts.push({
        id: `local-build-${currentVersion.versionId}`,
        workspaceId: input.workspaceId,
        type: 'web-preview',
        title: '交付构建预览',
        content: `版本 ${currentVersion.versionId} 的交付构建已完成，可直接查看构建产物。`,
        url: currentVersion.buildPreviewUrl,
        createdByAgentId: 'system',
        metadata: {
          status: 'ready',
          versionId: currentVersion.versionId,
          kind: 'build',
        },
        createdAt: currentVersion.updatedAt,
      })
    } else if (currentVersion.buildStatus === 'failed') {
      artifacts.push({
        id: `local-build-${currentVersion.versionId}`,
        workspaceId: input.workspaceId,
        type: 'deploy-status',
        title: '交付构建状态',
        content: clipDeliveryLog(
          currentVersion.buildLog,
          `版本 ${currentVersion.versionId} 的交付构建失败，可在代码面板重试。`,
        ),
        createdByAgentId: 'system',
        metadata: {
          status: 'failed',
          versionId: currentVersion.versionId,
          kind: 'build',
        },
        createdAt: currentVersion.updatedAt,
      })
    }
  }

  if (latestDeployment) {
    artifacts.push({
      id: `local-deploy-${latestDeployment.deploymentId}`,
      workspaceId: input.workspaceId,
      type: 'deploy-status',
      title: '本地部署',
      content: `版本 ${latestDeployment.versionId} 已部署到本地地址，可直接打开查看。`,
      url: latestDeployment.deployUrl,
      createdByAgentId: 'system',
      metadata: {
        status: 'ready',
        versionId: latestDeployment.versionId,
        kind: 'deployment',
      },
      createdAt: latestDeployment.createdAt,
    })
  }

  return artifacts
}

/**
 * Builds the synthetic delivery messages shown in the main chat flow.
 * Input: current project delivery metadata plus one target conversation id.
 * Output: stable system messages with inline delivery artifacts.
 */
function buildProjectDeliveryMessages(input: DeliveryProjectionInput & {
  conversationId: string
}): FrontendAppState['messages'] {
  const messages: FrontendAppState['messages'] = []
  const currentVersion = resolveCurrentDeliveryVersion(input)
  const latestDeployment = resolveLatestDeployment(input)
  const artifacts = buildProjectDeliveryArtifacts(input)

  if (currentVersion) {
    const versionArtifacts = artifacts.filter(artifact =>
      artifact.id === `local-source-${currentVersion.versionId}` ||
      artifact.id === `local-build-${currentVersion.versionId}`,
    )
    messages.push({
      id: `local-version-message-${currentVersion.versionId}`,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      senderType: 'system',
      senderId: 'system',
      content: currentVersion.buildStatus === 'success'
        ? `已保存源码版本 ${currentVersion.versionId}，并生成了可用于交付的构建产物。`
        : currentVersion.buildStatus === 'failed'
          ? `已保存源码版本 ${currentVersion.versionId}，但交付构建失败。`
          : `已保存源码版本 ${currentVersion.versionId}。`,
      artifacts: versionArtifacts,
      createdAt: currentVersion.updatedAt,
    })
  }

  if (latestDeployment) {
    const deploymentArtifacts = artifacts.filter(artifact => artifact.id === `local-deploy-${latestDeployment.deploymentId}`)
    messages.push({
      id: `local-deploy-message-${latestDeployment.deploymentId}`,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      senderType: 'system',
      senderId: 'system',
      content: `本地部署已更新到 ${latestDeployment.versionId}。`,
      artifacts: deploymentArtifacts,
      createdAt: latestDeployment.createdAt,
    })
  }

  return messages
}

/**
 * Resolves the current delivery version, preferring the tracked current version id.
 * Input: current delivery metadata.
 * Output: matching version record or the newest fallback.
 */
function resolveCurrentDeliveryVersion(input: DeliveryProjectionInput) {
  if (input.currentVersionId) {
    const currentVersion = input.versions.find(version => version.versionId === input.currentVersionId)
    if (currentVersion) {
      return currentVersion
    }
  }

  return input.versions
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

/**
 * Resolves the newest local deployment record for one project.
 * Input: current deployment metadata.
 * Output: latest deployment or undefined.
 */
function resolveLatestDeployment(input: DeliveryProjectionInput) {
  return input.deployments
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
}

/**
 * Clips one delivery log into a short frontend-safe sentence.
 * Input: optional raw build log and fallback summary.
 * Output: compact delivery log excerpt.
 */
function clipDeliveryLog(log: string | undefined, fallback: string): string {
  const normalized = log
    ?.replace(/\s+/g, ' ')
    .trim()
  if (!normalized) {
    return fallback
  }
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

/**
 * Normalizes one unknown timestamp-like value into a comparable ISO string.
 * Input: unknown createdAt payload.
 * Output: string timestamp or an empty fallback.
 */
function readTimestamp(value: unknown): string {
  return typeof value === 'string' ? value : ''
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
