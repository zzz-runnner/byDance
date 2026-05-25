import type { AppState, Conversation, Workspace } from '../../src/shared/contracts'

export type WorkspaceConversation = {
  workspace: Workspace
  conversation: Conversation
}

/**
 * Selects the first seed group conversation.
 * Input: application state. Output: workspace and group conversation.
 */
export function selectPrimaryGroup(state: AppState): WorkspaceConversation {
  const workspace = state.workspaces[0]
  const conversation = state.conversations.find(item => item.workspaceId === workspace.id && item.type === 'group')
  if (!conversation) {
    throw new Error('Seed group conversation not found.')
  }
  return { workspace, conversation }
}

/**
 * Selects the seed direct conversation for one agent.
 * Input: application state and agent id. Output: workspace and direct conversation.
 */
export function selectAgentDirect(state: AppState, agentId: string): WorkspaceConversation {
  const workspace = state.workspaces[0]
  const conversation = state.conversations.find(item =>
    item.workspaceId === workspace.id && item.type === 'direct' && item.participants.includes(agentId))
  if (!conversation) {
    throw new Error(`Seed direct conversation not found for agent: ${agentId}`)
  }
  return { workspace, conversation }
}
