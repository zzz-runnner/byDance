export type WorkspaceType = 'dev' | 'research' | 'writing' | 'chat'
export type ConversationType = 'group' | 'direct'

export interface StoredProjectRecord {
  projectId: string
  workspaceId: string
  name: string
  goal: string
  conversationId: string
  conversationType?: ConversationType
  targetAgentId?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectResponse extends StoredProjectRecord {
  agentHubPreviewUrl: string
  agentHubZipUrl: string
}

export interface RuntimeWorkspace extends Record<string, unknown> {
  id: string
  name: string
  goal: string
  workspaceType: WorkspaceType
  rootPath: string
  runtimeType: string
  runtimeStatus: string
  projectBrief: string
  pinnedMessageIds: string[]
  createdAt: string
  updatedAt: string
}

export interface FrontendWorkspace extends RuntimeWorkspace {
  projectId: string
  agentHubPreviewUrl: string
  agentHubZipUrl: string
}

export interface RuntimeConversation extends Record<string, unknown> {
  id: string
  workspaceId: string
  type: ConversationType
  title: string
  participants: string[]
  createdAt: string
  updatedAt: string
}

export interface RuntimeMessage extends Record<string, unknown> {
  id: string
  workspaceId: string
  conversationId: string
}

export interface RuntimeAgent extends Record<string, unknown> {
  id: string
  name?: string
}

export interface RuntimeAgentSession extends Record<string, unknown> {
  id: string
  workspaceId: string
}

export interface RuntimeAgentSessionMessage extends Record<string, unknown> {
  id: string
  workspaceId: string
  sessionId: string
}

export interface RuntimeTaskHandoff extends Record<string, unknown> {
  id: string
  workspaceId: string
  conversationId: string
  sessionId: string
  resultRunId?: string
}

export interface RuntimeAgentRun extends Record<string, unknown> {
  id: string
  workspaceId: string
  conversationId: string
  sessionId?: string
  handoffId?: string
}

export interface RuntimeArtifact extends Record<string, unknown> {
  id: string
  workspaceId: string
  agentRunId?: string
  url?: string
}

export interface RuntimeChangeSet extends Record<string, unknown> {
  id: string
  workspaceId: string
  agentRunId: string
}

export interface RuntimeContextSnapshot extends Record<string, unknown> {
  id: string
  workspaceId: string
  conversationId: string
  agentRunId?: string
}

export interface RuntimeWorkflowEventRecord extends Record<string, unknown> {
  id: string
  workspaceId: string
  conversationId: string
  event: Record<string, unknown>
  createdAt: string
}

export interface RuntimeDiagnosticLog extends Record<string, unknown> {
  id: string
  workspaceId: string
  conversationId?: string
  sessionId?: string
  handoffId?: string
  runId?: string
}

export interface RuntimeAppState {
  workspaces: RuntimeWorkspace[]
  conversations: RuntimeConversation[]
  messages: RuntimeMessage[]
  agents: RuntimeAgent[]
  agentSessions: RuntimeAgentSession[]
  agentSessionMessages: RuntimeAgentSessionMessage[]
  taskHandoffs: RuntimeTaskHandoff[]
  agentRuns: RuntimeAgentRun[]
  artifacts: RuntimeArtifact[]
  changeSets: RuntimeChangeSet[]
  contextSnapshots: RuntimeContextSnapshot[]
  workflowEvents: RuntimeWorkflowEventRecord[]
  diagnosticLogs: RuntimeDiagnosticLog[]
}

export interface FrontendAppState extends Omit<RuntimeAppState, 'workspaces'> {
  workspaces: FrontendWorkspace[]
}

export interface CreateProjectInput {
  name: string
  goal: string
  workspaceType: WorkspaceType
  conversationType?: ConversationType
  agentIds?: string[]
}

export interface StreamProjectMessageInput {
  content: string
  conversationId?: string
  agentId?: string
}
