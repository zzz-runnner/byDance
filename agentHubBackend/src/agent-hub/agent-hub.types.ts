export interface AgentHubWorkspace {
  id: string
  name: string
  goal?: string
  previewUrl?: string
  createdAt?: string
  updatedAt?: string
}

export interface AgentHubConversation {
  id: string
  workspaceId: string
  type: 'group' | 'direct'
  title?: string
}

export interface AgentHubState {
  workspaces?: AgentHubWorkspace[]
  conversations?: AgentHubConversation[]
}

export interface CreateAgentHubWorkspaceInput {
  name: string
  goal: string
  workspaceType?: 'dev' | 'research' | 'writing' | 'chat'
}

export interface SendAgentHubMessageInput {
  workspaceId: string
  conversationId: string
  content: string
}
