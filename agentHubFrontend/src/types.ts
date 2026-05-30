import type {
  AgentDefinition,
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

export type WorkspaceSignal = {
  runningAgents: number
  latestEventLabel: string
  artifactCount: number
  messageCount: number
}

export type StreamMessageInput = {
  projectId?: string
  workspaceId: string
  conversationId: string
  content: string
  agentId?: string
  replyTo?: ReplyReference
}

export type LiveWorkflowEvent = WorkflowEvent & {
  receivedAt: string
}
