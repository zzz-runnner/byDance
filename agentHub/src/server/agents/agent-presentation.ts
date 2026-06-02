export const ORCHESTRATOR_AGENT_ID = 'orchestrator'
export const DEFAULT_ORCHESTRATOR_AGENT_NAME = '项目经理 Agent'

const LEGACY_ORCHESTRATOR_AGENT_NAMES = new Set([
  '',
  '项目协调 Agent',
  'Project Orchestrator',
  'Orchestrator',
])

type AgentLike = {
  id: string
  name?: string
}

type AgentDerivedTitleState = {
  conversations: Array<{
    workspaceId: string
    type: string
    participants: string[]
    title: string
    updatedAt: string
  }>
  agentSessions: Array<{
    workspaceId: string
    agentId: string
    title: string
    updatedAt: string
  }>
}

/**
 * Returns the trimmed display name for one agent when available.
 * Input: one agent-like record.
 * Output: trimmed display name or an empty string.
 */
function trimmedAgentName(agent: AgentLike | undefined): string {
  return agent?.name?.trim() ?? ''
}

/**
 * Returns the stable display name that should be shown for one agent.
 * Input: one agent-like record.
 * Output: resolved display name or the stable id fallback.
 */
export function agentDisplayName(agent: AgentLike | undefined): string {
  if (!agent) {
    return DEFAULT_ORCHESTRATOR_AGENT_NAME
  }

  const trimmedName = trimmedAgentName(agent)
  if (trimmedName) {
    return trimmedName
  }

  if (agent.id === ORCHESTRATOR_AGENT_ID) {
    return DEFAULT_ORCHESTRATOR_AGENT_NAME
  }

  return agent.id
}

/**
 * Returns whether one built-in orchestrator record still carries a legacy display name.
 * Input: one agent-like record.
 * Output: true when the display name should be normalized.
 */
export function shouldNormalizeOrchestratorName(agent: AgentLike): boolean {
  return agent.id === ORCHESTRATOR_AGENT_ID && LEGACY_ORCHESTRATOR_AGENT_NAMES.has(trimmedAgentName(agent))
}

/**
 * Normalizes the orchestrator display name without changing the stable id.
 * Input: one agent-like record.
 * Output: the same record shape with the default orchestrator display name applied.
 */
export function normalizeBuiltInAgentPresentation<T extends AgentLike>(agent: T): T {
  if (!shouldNormalizeOrchestratorName(agent)) {
    return agent
  }

  return {
    ...agent,
    name: DEFAULT_ORCHESTRATOR_AGENT_NAME,
  }
}

/**
 * Finds one agent by id inside the current registry.
 * Input: agent registry and target id.
 * Output: matching agent or undefined.
 */
export function findAgentById<T extends AgentLike>(agents: T[], agentId: string): T | undefined {
  return agents.find(agent => agent.id === agentId)
}

/**
 * Resolves one sender id into the current display name.
 * Input: agent registry and sender id.
 * Output: display-ready sender label.
 */
export function resolveAgentDisplayName(agents: AgentLike[], agentId: string): string {
  if (agentId === 'user') {
    return 'User'
  }

  const agent = findAgentById(agents, agentId)
  if (agent) {
    return agentDisplayName(agent)
  }

  if (agentId === ORCHESTRATOR_AGENT_ID) {
    return DEFAULT_ORCHESTRATOR_AGENT_NAME
  }

  return agentId
}

/**
 * Escapes literal text so it can be safely interpolated into a regular expression.
 * Input: raw literal text.
 * Output: escaped regular-expression source.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds short human-facing aliases derived from one display name.
 * Input: one agent display name.
 * Output: short aliases without duplicates.
 */
function shortAgentNameAliases(name: string): string[] {
  const aliases = new Set<string>()
  const trimmedName = name.trim()

  if (!trimmedName) {
    return []
  }

  aliases.add(trimmedName)
  aliases.add(trimmedName.replace(/\s+agent$/i, '').trim())

  const firstToken = trimmedName.split(/\s+/)[0]?.trim()
  if (firstToken) {
    aliases.add(firstToken)
  }

  return [...aliases].filter(Boolean)
}

/**
 * Returns every supported mention alias for one agent.
 * Input: one agent-like record.
 * Output: normalized lowercase aliases including stable ids.
 */
export function agentMentionAliases(agent: AgentLike): string[] {
  const aliases = new Set<string>()

  aliases.add(agent.id.toLowerCase())

  for (const alias of shortAgentNameAliases(agentDisplayName(agent))) {
    aliases.add(alias.toLowerCase())
  }

  if (agent.id === ORCHESTRATOR_AGENT_ID) {
    aliases.add('main')
  }

  return [...aliases].filter(Boolean)
}

/**
 * Removes one leading explicit @alias when it targets the provided agent.
 * Input: raw message content and one agent-like record.
 * Output: content without the leading mention or the trimmed original content.
 */
export function stripLeadingAgentMention(content: string, agent: AgentLike): string {
  const trimmed = content.trim()

  if (!trimmed.startsWith('@')) {
    return trimmed
  }

  const body = trimmed.slice(1).trim()
  const lowerBody = body.toLowerCase()
  const matchedAlias = agentMentionAliases(agent)
    .sort((left, right) => right.length - left.length)
    .find(alias => lowerBody === alias || lowerBody.startsWith(`${alias} `))

  if (!matchedAlias) {
    return trimmed
  }

  return body.slice(matchedAlias.length).trim()
}

/**
 * Removes one leading main-brain mention without changing the stable orchestrator id.
 * Input: raw message content and the current agent registry.
 * Output: content without one leading orchestrator mention when present.
 */
export function stripLeadingOrchestratorMention(content: string, agents: AgentLike[]): string {
  const orchestrator = findAgentById(agents, ORCHESTRATOR_AGENT_ID) ?? {
    id: ORCHESTRATOR_AGENT_ID,
    name: DEFAULT_ORCHESTRATOR_AGENT_NAME,
  }

  return stripLeadingAgentMention(content, orchestrator)
}

/**
 * Detects whether the content contains one explicit @alias mention.
 * Input: raw message content and one normalized alias.
 * Output: true when the alias is explicitly mentioned.
 */
export function matchesMentionAlias(content: string, alias: string): boolean {
  if (!alias.trim()) {
    return false
  }

  const pattern = new RegExp(`(^|[\\s(（\\[{])@${escapeRegex(alias)}(?=$|[\\s:：,，.。;；!！?？)）\\]}])`, 'i')
  return pattern.test(content)
}

/**
 * Resolves one unique explicit mention inside the provided content.
 * Input: raw message content, candidate agents, and an orchestrator toggle.
 * Output: the mentioned agent id or undefined when absent or ambiguous.
 */
export function findMentionedAgentId(
  content: string,
  agents: AgentLike[],
  options: { includeOrchestrator?: boolean } = {},
): string | undefined {
  const includeOrchestrator = options.includeOrchestrator ?? true
  const normalizedContent = content.toLowerCase()
  const matches = [...new Set(
    agents
      .filter(agent => includeOrchestrator || agent.id !== ORCHESTRATOR_AGENT_ID)
      .filter(agent => agentMentionAliases(agent).some(alias => matchesMentionAlias(normalizedContent, alias)))
      .map(agent => agent.id),
  )]

  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Synchronizes direct conversation and session titles after one agent display-name update.
 * Input: mutable application state, previous agent record, and updated agent record.
 * Output: the same state object with derived titles refreshed in place.
 */
export function syncAgentDerivedTitles(
  state: AgentDerivedTitleState,
  previousAgent: AgentLike,
  updatedAgent: AgentLike,
  updatedAt: string,
  workspaceId?: string,
): void {
  if (agentDisplayName(previousAgent) === agentDisplayName(updatedAgent)) {
    return
  }

  const nextDirectTitle = `${agentDisplayName(updatedAgent)} 私聊`
  const nextSessionTitle = `${agentDisplayName(updatedAgent)} 会话`

  for (const conversation of state.conversations) {
    if (workspaceId && conversation.workspaceId !== workspaceId) {
      continue
    }
    if (conversation.type === 'direct' && conversation.participants.includes(updatedAgent.id)) {
      conversation.title = nextDirectTitle
      conversation.updatedAt = updatedAt
    }
  }

  for (const session of state.agentSessions) {
    if (workspaceId && session.workspaceId !== workspaceId) {
      continue
    }
    if (session.agentId === updatedAgent.id) {
      session.title = nextSessionTitle
      session.updatedAt = updatedAt
    }
  }
}
