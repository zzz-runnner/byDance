import { describe, expect, it } from 'vitest'
import type { Conversation } from '../../src/shared/contracts'
import { selectDynamicVisibleSpeaker } from '../../src/server/orchestrator/dynamic-speaker-selection'
import { createSeedState } from '../../src/server/store/seed'

function createGroupConversation(): Conversation {
  return {
    id: 'conv-group-test',
    workspaceId: 'ws-test',
    type: 'group',
    title: 'Dynamic Speaker Test',
    participants: ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer'],
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
  }
}

describe('dynamic visible speaker selection', () => {
  it('routes requirement clarification to product-manager', () => {
    const state = createSeedState()

    expect(selectDynamicVisibleSpeaker({
      content: 'Please clarify the page modules, scope, and acceptance criteria before implementation.',
      conversation: createGroupConversation(),
      agents: state.agents,
      taskStage: 'requirements_intake',
    })).toMatchObject({
      agentId: 'product-manager',
    })
  })

  it('routes implementation questions to engineer', () => {
    const state = createSeedState()

    expect(selectDynamicVisibleSpeaker({
      content: 'Please help me fix this frontend bug and explain the technical solution.',
      conversation: createGroupConversation(),
      agents: state.agents,
      taskStage: 'execution',
    })).toMatchObject({
      agentId: 'engineer',
    })
  })

  it('routes review and testing questions to reviewer', () => {
    const state = createSeedState()

    expect(selectDynamicVisibleSpeaker({
      content: 'Please review this version, point out the risks, and give me a testing verdict.',
      conversation: createGroupConversation(),
      agents: state.agents,
      taskStage: 'review',
    })).toMatchObject({
      agentId: 'reviewer',
    })
  })

  it('keeps system status questions with orchestrator', () => {
    const state = createSeedState()

    expect(selectDynamicVisibleSpeaker({
      content: 'Is the backend still normal and which port is the frontend using?',
      conversation: createGroupConversation(),
      agents: state.agents,
      taskStage: 'chat',
    })).toBeUndefined()
  })
})
