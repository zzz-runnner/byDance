import type {
  CodeSelectionReference,
  ConversationType,
  ProjectFileContent,
  ProjectFileNode,
  ProjectPreviewTargetsResponse,
  ProjectWorkspaceDiff,
  RuntimeAgent,
  RuntimeAppState,
  RuntimeConversation,
  RuntimeWorkbenchRoomSummary,
  RuntimeWorkspace,
  WorkspaceType,
} from '../types'

export type AgentHubWorkspace = RuntimeWorkspace
export type AgentHubConversation = RuntimeConversation
export type AgentHubState = RuntimeAppState
export type AgentHubAgent = RuntimeAgent

export interface CreateAgentHubWorkspaceInput {
  name: string
  goal: string
  workspaceType?: WorkspaceType
}

export interface CreateAgentHubConversationInput {
  workspaceId: string
  type: ConversationType
  title: string
  participants: string[]
}

export interface SendAgentHubMessageInput {
  workspaceId: string
  conversationId: string
  content: string
  agentId?: string
  replyTo?: {
    messageId: string
    senderId: string
    senderName?: string
    excerpt: string
  }
  codeSelection?: CodeSelectionReference
}

export interface WorkspaceOverviewBatchInput {
  items: Array<{
    workspaceId: string
    conversationType?: ConversationType
    targetAgentId?: string
  }>
}

export interface WorkspaceOverviewBatchResponse {
  rooms: RuntimeWorkbenchRoomSummary[]
}

export interface WorkspaceFileTreeResponse {
  entries: ProjectFileNode[]
}

export type WorkspaceFileContentResponse = ProjectFileContent
export type WorkspaceDiffResponse = ProjectWorkspaceDiff
export type WorkspacePreviewTargetsResponse = ProjectPreviewTargetsResponse
