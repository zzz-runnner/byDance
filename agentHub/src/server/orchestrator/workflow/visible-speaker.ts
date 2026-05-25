import type { MainBrainTurn, TurnFinalizationMode } from '@shared/contracts'

export type VisibleTurnResolution = {
  speakerAgentId: string
  finalizationMode: TurnFinalizationMode
}

/**
 * Resolves the one visible speaker for a turn.
 * Input: main-brain turn decision. Output: visible speaker plus finalization mode.
 */
export function resolveVisibleTurn(decision: MainBrainTurn): VisibleTurnResolution {
  const providedFinalization = decision.finalizationMode && decision.finalizationMode !== 'none'
    ? (decision.finalizationMode as TurnFinalizationMode)
    : undefined

  if (decision.kind !== 'dispatch_agents') {
    return {
      speakerAgentId: 'orchestrator',
      finalizationMode: (providedFinalization ?? 'speaker_direct') as TurnFinalizationMode,
    }
  }

  const targetAgents = decision.dispatches.map(brief => brief.agentId)
  if (targetAgents.length > 1) {
    return {
      speakerAgentId: 'orchestrator',
      finalizationMode: 'main_synthesis',
    }
  }

  if (providedFinalization && providedFinalization !== 'speaker_direct') {
    return {
      speakerAgentId: 'orchestrator',
      finalizationMode: providedFinalization,
    }
  }

  const singleDispatchAgentId = targetAgents[0]
  const providedSpeaker = decision.speakerAgentId?.trim()
  const speakerAgentId =
    providedSpeaker === 'orchestrator'
      ? 'orchestrator'
      : providedSpeaker && targetAgents.includes(providedSpeaker)
        ? providedSpeaker
        : singleDispatchAgentId ?? 'orchestrator'

  return {
    speakerAgentId,
    finalizationMode: speakerAgentId === 'orchestrator' ? 'main_synthesis' : 'speaker_direct',
  }
}

/**
 * Returns whether a child-agent run should be written as the visible conversation message.
 * Input: main-brain turn decision and child agent id. Output: true when the child agent is the visible speaker.
 */
export function shouldPersistChildRunAsConversationMessage(decision: MainBrainTurn, agentId: string): boolean {
  const visibleTurn = resolveVisibleTurn(decision)
  return visibleTurn.finalizationMode === 'speaker_direct' && visibleTurn.speakerAgentId === agentId
}
