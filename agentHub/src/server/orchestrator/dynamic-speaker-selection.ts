import type { AgentDefinition, Conversation, WorkflowTaskStage } from '@shared/contracts'

export type DynamicSpeakerSelection = {
  agentId: string
  confidence: number
  reason: string
}

type DynamicSpeakerSelectionInput = {
  content: string
  conversation: Conversation
  agents: AgentDefinition[]
  taskStage?: WorkflowTaskStage
}

const SYSTEM_SUBJECT_PATTERN =
  /\u670d\u52a1|\u7aef\u53e3|\u94fe\u8def|\u540e\u7aef|\u524d\u7aef|health|port|backend|frontend|api state|api\b/i
const SYSTEM_STATUS_INTENT_PATTERN =
  /\u6b63\u5e38\u5417|\u80fd\u4e0d\u80fd\u7528|\u72b6\u6001|\u5065\u5eb7|\u8fd8\u5728\u5417|still normal|healthy|running|available|what port|which port|health/i
const COORDINATION_PATTERN =
  /\u5148\u8c01|\u63a5\u4e0b\u6765|\u5206\u5de5|\u6c47\u603b|\u603b\u7ed3|\u534f\u8c03|\u4e00\u8d77|\u591a\u4e2a\u4eba|\u591a\u4e2aagent|multi-agent|orchestr/i
const ENGLISH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'for',
  'from',
  'help',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'our',
  'please',
  'should',
  'the',
  'this',
  'to',
  'us',
  'we',
  'what',
  'why',
  'with',
  'you',
])

/**
 * Detects whether the current turn is about system status instead of specialist work.
 * Input: raw user content. Output: true when orchestrator should keep the answer.
 */
function isSystemStatusQuestion(content: string): boolean {
  return SYSTEM_SUBJECT_PATTERN.test(content) && SYSTEM_STATUS_INTENT_PATTERN.test(content)
}

/**
 * Extracts meaningful English and Chinese search terms from one user message.
 * Input: raw user content. Output: normalized terms without obvious filler words.
 */
function extractSearchTerms(content: string): string[] {
  return (content.toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fa5]{2,}/g) ?? []).filter(term => {
    if (/^[a-z]/.test(term)) {
      return term.length >= 3 && !ENGLISH_STOP_WORDS.has(term)
    }
    return term.length >= 2
  })
}

/**
 * Builds a lowercase text blob from one agent routing profile and fallback metadata.
 * Input: agent definition. Output: searchable plain text.
 */
function buildAgentSearchText(agent: AgentDefinition): string {
  const profile = agent.routingProfile
  return [
    agent.id,
    agent.name,
    agent.role,
    agent.description,
    agent.whenToUse,
    profile?.routingSummary,
    ...(profile?.responsibilities ?? []),
    ...(profile?.goodAt ?? []),
    ...(profile?.exampleRequests ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * Scores one agent against the current user message and task stage.
 * Input: agent, message text, and optional workflow stage. Output: normalized score.
 */
function scoreAgent(agent: AgentDefinition, content: string, taskStage?: WorkflowTaskStage): number {
  if (agent.id === 'orchestrator') {
    return -1
  }

  const profile = agent.routingProfile
  if (profile?.speakerMode === 'worker_only') {
    return -1
  }

  const searchText = buildAgentSearchText(agent)
  const normalized = content.toLowerCase()
  let score = 0

  for (const term of extractSearchTerms(normalized)) {
    if (searchText.includes(term)) {
      score += Math.max(1.6, term.length >= 4 ? 2.8 : 1.8)
    }
  }

  if (profile?.preferredStages?.includes(taskStage ?? 'chat')) {
    score += 2.2
  }

  for (const blockedText of profile?.notFor ?? []) {
    if (normalized.includes(blockedText.toLowerCase())) {
      score -= 1.6
    }
  }

  return score
}

/**
 * Selects a visible child agent for one group-chat turn when one role clearly owns the answer.
 * Input: message text, group conversation, available agents, and optional stage. Output: selected agent or undefined.
 */
export function selectDynamicVisibleSpeaker(input: DynamicSpeakerSelectionInput): DynamicSpeakerSelection | undefined {
  if (input.conversation.type !== 'group') {
    return undefined
  }

  if (isSystemStatusQuestion(input.content) || COORDINATION_PATTERN.test(input.content)) {
    return undefined
  }

  const candidateAgents = input.agents.filter(agent => input.conversation.participants.includes(agent.id))
  const scored = candidateAgents
    .map(agent => ({
      agentId: agent.id,
      score: scoreAgent(agent, input.content, input.taskStage),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score)

  const best = scored[0]
  const second = scored[1]
  if (!best) {
    return undefined
  }

  const scoreGap = best.score - (second?.score ?? 0)
  if (best.score < 4.8 || scoreGap < 1.4) {
    return undefined
  }

  return {
    agentId: best.agentId,
    confidence: Math.min(0.96, 0.55 + best.score / 12),
    reason: `Dynamic routing favored ${best.agentId} with score ${best.score.toFixed(2)} and gap ${scoreGap.toFixed(2)}.`,
  }
}
