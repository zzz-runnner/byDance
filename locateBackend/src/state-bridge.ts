import type {
  ConversationType,
  FrontendAppState,
  FrontendWorkspace,
  ProjectResponse,
  RuntimeAppState,
  RuntimeConversation,
  RuntimeDiagnosticLog,
} from './types.js'

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
): FrontendAppState {
  const workspaceId = project.workspaceId
  const conversations = state.conversations.filter(conversation => conversation.workspaceId === workspaceId)
  const conversationIds = new Set(conversations.map(conversation => conversation.id))
  const agentSessions = state.agentSessions.filter(session => session.workspaceId === workspaceId)
  const sessionIds = new Set(agentSessions.map(session => session.id))
  const taskHandoffs = state.taskHandoffs.filter(handoff => handoff.workspaceId === workspaceId)
  const handoffIds = new Set(taskHandoffs.map(handoff => handoff.id))
  const agentRuns = state.agentRuns.filter(run => run.workspaceId === workspaceId)
  const runIds = new Set(agentRuns.map(run => run.id))

  return {
    workspaces: state.workspaces
      .filter(workspace => workspace.id === workspaceId)
      .map(workspace => attachProjectMetadata(workspace, project.projectId)),
    conversations,
    messages: state.messages.filter(
      message => message.workspaceId === workspaceId || conversationIds.has(message.conversationId),
    ),
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
    diagnosticLogs: state.diagnosticLogs.filter(log => belongsToWorkspace(log, workspaceId, conversationIds, sessionIds, handoffIds, runIds)),
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
