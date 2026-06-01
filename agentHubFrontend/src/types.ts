import type {
  AgentDefinition,
  AgentProvider,
  AgentRun,
  AgentSession,
  AgentSessionMessage,
  AppState,
  Artifact,
  ChangedFile,
  ChangeSet,
  Conversation,
  ContextSnapshot,
  DiagnosticLog,
  Message,
  ReplyReference,
  TaskHandoff,
  WorkflowEvent,
  WorkflowEventRecord,
  Workspace,
} from './contracts'

export type {
  AgentDefinition,
  AgentProvider,
  AgentRun,
  AgentSession,
  AgentSessionMessage,
  AppState,
  Artifact,
  ChangedFile,
  ChangeSet,
  Conversation,
  ContextSnapshot,
  DiagnosticLog,
  Message,
  ReplyReference,
  TaskHandoff,
  WorkflowEvent,
  WorkflowEventRecord,
  Workspace,
}

export type ConnectionStatus = 'connecting' | 'live' | 'error'
export type WorkspaceListStatus = 'active' | 'archived' | 'all'
export type WorkspaceSortField = 'updatedAt' | 'createdAt' | 'name'
export type SortDirection = 'asc' | 'desc'

export type WorkspaceSignal = {
  runningAgents: number
  latestEventLabel: string
  artifactCount: number
  messageCount: number
}

export type WorkspaceRoom = {
  id: string
  kind: 'group' | 'direct'
  title: string
  subtitle: string
  workspace: Workspace
  conversation: Conversation
  targetAgentId?: string
  participantAgentIds: string[]
  signal: WorkspaceSignal
  lastActivityAt: string
}

export type WorkbenchPage = {
  limit: number
  nextCursor?: string
  hasMore: boolean
  total: number
  status?: WorkspaceListStatus
  sortBy?: WorkspaceSortField
  sortDirection?: SortDirection
  query?: string
}

export type WorkbenchOverview = {
  agents: AgentDefinition[]
  rooms: WorkspaceRoom[]
  page: WorkbenchPage
}

export type ProjectStatePage = {
  limit: number
  total: number
  hasMore: boolean
}

export type ProjectStateEnvelope = {
  state: AppState
  messagePage: ProjectStatePage
}

export type CodeSelectionReference = {
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

export type WorkspaceFileNode = {
  path: string
  name: string
  kind: 'directory' | 'file'
  byteLength?: number
  language?: string
  isText: boolean
  children?: WorkspaceFileNode[]
}

export type WorkspaceFileTree = {
  rootLabel: string
  entries: WorkspaceFileNode[]
}

export type WorkspaceFileContent = {
  path: string
  name: string
  content: string
  language: string
  byteLength: number
  updatedAt: string
  lineCount: number
}

export type WorkspaceDiffSnapshot = {
  baseCommit: string
  status: string
  patch: string
}

export type WorkspacePreviewTarget = {
  path: string
  url: string
  source?: 'runtime' | 'module-shell' | 'build'
}

export type WorkspacePreviewTargets = {
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
export type PreviewBuildStatus = 'idle' | 'running' | 'success' | 'failed'

export type WorkspacePreviewBuildState = {
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

export type WorkspacePreviewCapability = {
  mode: PreviewMode
  framework: PreviewFramework
  reason: string
  sourceHash: string
  entryPath?: string
  defaultTargetPath?: string
  targets: WorkspacePreviewTarget[]
  build?: WorkspacePreviewBuildState
}

export type StreamMessageInput = {
  projectId?: string
  workspaceId: string
  conversationId: string
  content: string
  agentId?: string
  replyTo?: ReplyReference
  codeSelection?: CodeSelectionReference
}

export type LiveWorkflowEvent = WorkflowEvent & {
  receivedAt: string
}
