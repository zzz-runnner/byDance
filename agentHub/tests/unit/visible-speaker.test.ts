import { describe, expect, it } from 'vitest'
import type { MainBrainTurn } from '../../src/shared/contracts'
import {
  resolveVisibleTurn,
  shouldPersistChildRunAsConversationMessage,
} from '../../src/server/orchestrator/workflow/visible-speaker'

describe('visible speaker resolution', () => {
  it('uses orchestrator for direct answers', () => {
    const decision: MainBrainTurn = {
      kind: 'direct_answer',
      finalResponse: 'hello',
      execution: 'serial',
      dispatches: [],
      targetAgents: [],
    }

    expect(resolveVisibleTurn(decision)).toEqual({
      speakerAgentId: 'orchestrator',
      finalizationMode: 'speaker_direct',
    })
  })

  it('lets a single dispatched agent speak directly by default', () => {
    const decision: MainBrainTurn = {
      kind: 'dispatch_agents',
      execution: 'serial',
      dispatches: [{
        agentId: 'engineer',
        task: 'Inspect files.',
        requiredContext: [],
        expectedOutput: 'Summary.',
      }],
      targetAgents: ['engineer'],
    }

    expect(resolveVisibleTurn(decision).speakerAgentId).toBe('engineer')
    expect(shouldPersistChildRunAsConversationMessage(decision, 'engineer')).toBe(true)
  })

  it('routes multi-agent dispatches through main synthesis', () => {
    const decision: MainBrainTurn = {
      kind: 'dispatch_agents',
      execution: 'serial',
      dispatches: [
        { agentId: 'engineer', task: 'Build.', requiredContext: [], expectedOutput: 'Code.' },
        { agentId: 'reviewer', task: 'Review.', requiredContext: [], expectedOutput: 'Verdict.' },
      ],
      targetAgents: ['engineer', 'reviewer'],
    }

    expect(resolveVisibleTurn(decision)).toEqual({
      speakerAgentId: 'orchestrator',
      finalizationMode: 'main_synthesis',
    })
    expect(shouldPersistChildRunAsConversationMessage(decision, 'engineer')).toBe(false)
  })
})
