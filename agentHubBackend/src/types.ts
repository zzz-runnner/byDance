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

export interface ProjectStatePage {
  limit: number
  total: number
  hasMore: boolean
}

export interface WorkspaceSignal {
  runningAgents: number
  latestEventLabel: string
  artifactCount: number
  messageCount: number
}

export interface WorkbenchPage {
  limit: number
  nextCursor?: string
  hasMore: boolean
  total: number
}

export interface WorkbenchRoomSummary {
  id: string
  kind: ConversationType
  title: string
  subtitle: string
  workspace: FrontendWorkspace
  conversation: RuntimeConversation
  targetAgentId?: string
  participantAgentIds: string[]
  signal: WorkspaceSignal
  lastActivityAt: string
}

export interface RuntimeWorkbenchRoomSummary extends Omit<WorkbenchRoomSummary, 'workspace'> {
  workspace: RuntimeWorkspace
}

export interface WorkbenchOverviewResponse {
  agents: RuntimeAgent[]
  rooms: WorkbenchRoomSummary[]
  page: WorkbenchPage
}

export interface ProjectStateResponse {
  state: FrontendAppState
  messagePage: ProjectStatePage
}

export interface CodeSelectionReference {
  filePath: string
  selectedText: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  language?: string
  beforeContext?: string
  afterContext?: string
}

export interface ProjectFileNode {
  path: string
  name: string
  kind: 'directory' | 'file'
  byteLength?: number
  language?: string
  isText: boolean
  children?: ProjectFileNode[]
}

export interface ProjectFileContent {
  path: string
  name: string
  content: string
  language: string
  byteLength: number
  updatedAt: string
  lineCount: number
}

export interface ProjectWorkspaceDiff {
  baseCommit: string
  status: string
  patch: string
}

export interface WorkspacePreviewTarget {
  path: string
  url: string
}

export interface ProjectPreviewTargetsResponse {
  defaultTarget?: WorkspacePreviewTarget
  targets: WorkspacePreviewTarget[]
}

export type PreviewMode = 'static' | 'module-shell' | 'build' | 'unsupported'
export type PreviewFramework =
  | 'static-html'
  | 'vanilla-module'
  | 'vite-react'
  | 'vite-vue'
  | 'vite-svelte'
  | 'vite'
  | 'angular'
  | 'unsupported'
export type PreviewTargetSource = 'runtime' | 'module-shell' | 'build'
export type PreviewBuildStatus = 'idle' | 'running' | 'success' | 'failed'

export interface ProjectPreviewRenderableTarget {
  path: string
  url: string
  source: PreviewTargetSource
}

export interface ProjectPreviewBuildState {
  status: PreviewBuildStatus
  sourceHash: string
  buildId?: string
  summary: string
  installCommand?: string
  buildCommand?: string
  startedAt?: string
  finishedAt?: string
  logExcerpt?: string
  error?: string
}

export interface ProjectPreviewCapabilityResponse {
  mode: PreviewMode
  framework: PreviewFramework
  reason: string
  sourceHash: string
  entryPath?: string
  defaultTargetPath?: string
  targets: ProjectPreviewRenderableTarget[]
  build?: ProjectPreviewBuildState
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
  createdAt: string
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
  replyTo?: {
    messageId: string
    senderId: string
    senderName?: string
    excerpt: string
  }
  codeSelection?: CodeSelectionReference
}
