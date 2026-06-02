import type { AgentDefinition, Conversation, ReplyReference } from '@shared/contracts'
import { resolveAgentDisplayName } from '../agents/agent-presentation'

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
  if (
    replyTo.senderId === 'user' ||
    replyTo.senderId === 'orchestrator' ||
    agents.some(agent => agent.id === replyTo.senderId)
  ) {
    return resolveAgentDisplayName(agents, replyTo.senderId)
  }

  return replyTo.senderName?.trim() || replyTo.senderId
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
 * Resolves one quoted child-agent id only when that agent is still a participant in the current conversation.
 * Input: reply reference, current conversation, and current agent registry. Output: continuable agent id or undefined.
 */
export function resolveReplyContinuationAgentId(
  replyTo: ReplyReference | undefined,
  conversation: Pick<Conversation, 'participants'>,
  agents: AgentDefinition[],
): string | undefined {
  const agentId = resolveReplyTargetAgentId(replyTo, agents)
  if (!agentId) {
    return undefined
  }

  return conversation.participants.includes(agentId) ? agentId : undefined
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
