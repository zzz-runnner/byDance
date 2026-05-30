import { describe, expect, it } from 'vitest'
import type { Conversation, ReplyReference } from '../../src/shared/contracts'
import { resolveReplyContinuationAgentId } from '../../src/server/orchestrator/reply-context'
import { createSeedState } from '../../src/server/store/seed'

function createGroupConversation(participants: string[] = ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer']): Conversation {
  return {
    id: 'conv-reply-context-test',
    workspaceId: 'ws-test',
    type: 'group',
    title: 'Reply Context Test',
    participants,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  }
}

function createReplyReference(senderId: string): ReplyReference {
  return {
    messageId: `msg-${senderId}`,
    senderId,
    senderName: senderId,
    excerpt: 'Quoted content.',
  }
}

describe('reply context continuity', () => {
  it('returns the quoted child agent when that agent is still in the current conversation', () => {
    const state = createSeedState()

    expect(resolveReplyContinuationAgentId(
      createReplyReference('engineer'),
      createGroupConversation(),
      state.agents,
    )).toBe('engineer')
  })

  it('ignores quoted user and orchestrator messages', () => {
    const state = createSeedState()

    expect(resolveReplyContinuationAgentId(
      createReplyReference('user'),
      createGroupConversation(),
      state.agents,
    )).toBeUndefined()
    expect(resolveReplyContinuationAgentId(
      createReplyReference('orchestrator'),
      createGroupConversation(),
      state.agents,
    )).toBeUndefined()
  })

  it('ignores quoted child agents that are no longer participants in the current conversation', () => {
    const state = createSeedState()

    expect(resolveReplyContinuationAgentId(
      createReplyReference('engineer'),
      createGroupConversation(['user', 'orchestrator', 'product-manager', 'reviewer']),
      state.agents,
    )).toBeUndefined()
  })
})
