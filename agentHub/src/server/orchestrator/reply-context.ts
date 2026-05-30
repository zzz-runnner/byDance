import type { AgentDefinition, ReplyReference } from '@shared/contracts'

export type ReplyContextPayload = {
  messageId: string
  senderId: string
  senderName: string
  excerpt: string
  senderKind: 'user' | 'orchestrator' | 'child_agent' | 'unknown'
  preferredAgentId?: string
  routingHint?: string
}

/**
 * Resolves the replied speaker label from the stored reply reference.
 * Input: reply reference plus the current agent registry. Output: readable sender name.
 */
function resolveReplySenderName(replyTo: ReplyReference, agents: AgentDefinition[]): string {
  const explicitName = replyTo.senderName?.trim()
  if (explicitName) {
    return explicitName
  }

  if (replyTo.senderId === 'user') {
    return 'User'
  }

  if (replyTo.senderId === 'orchestrator') {
    return 'Project Orchestrator'
  }

  return agents.find(agent => agent.id === replyTo.senderId)?.name ?? replyTo.senderId
}

/**
 * Resolves one replied child-agent id when the quoted message belongs to a known agent.
 * Input: reply reference plus the current agent registry. Output: child-agent id or undefined.
 */
export function resolveReplyTargetAgentId(
  replyTo: ReplyReference | undefined,
  agents: AgentDefinition[],
): string | undefined {
  if (!replyTo || replyTo.senderId === 'orchestrator' || replyTo.senderId === 'user') {
    return undefined
  }

  return agents.find(agent => agent.id === replyTo.senderId)?.id
}

/**
 * Builds one prompt-friendly reply-context payload for routing and final responses.
 * Input: reply reference plus the current agent registry. Output: normalized reply context or undefined.
 */
export function buildReplyContextPayload(
  replyTo: ReplyReference | undefined,
  agents: AgentDefinition[] = [],
): ReplyContextPayload | undefined {
  if (!replyTo) {
    return undefined
  }

  const preferredAgentId = resolveReplyTargetAgentId(replyTo, agents)
  const senderKind =
    replyTo.senderId === 'user'
      ? 'user'
      : replyTo.senderId === 'orchestrator'
        ? 'orchestrator'
        : preferredAgentId
          ? 'child_agent'
          : 'unknown'
  const senderName = resolveReplySenderName(replyTo, agents)

  return {
    messageId: replyTo.messageId,
    senderId: replyTo.senderId,
    senderName,
    excerpt: replyTo.excerpt,
    senderKind,
    preferredAgentId,
    routingHint: preferredAgentId
      ? `The user is replying to ${senderName}. Prefer ${preferredAgentId} as the visible speaker unless the new message clearly belongs to another role or needs orchestrator coordination.`
      : replyTo.senderId === 'orchestrator'
        ? 'The user is replying to the orchestrator. Keep the orchestrator unless the new message clearly belongs to one child agent.'
        : undefined,
  }
}
