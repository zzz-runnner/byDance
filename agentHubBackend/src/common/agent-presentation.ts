export const ORCHESTRATOR_AGENT_ID = 'orchestrator'
export const DEFAULT_ORCHESTRATOR_AGENT_NAME = '项目经理 Agent'

type AgentLike = {
  id: string
  name?: string
}

/**
 * Returns the stable display name for one backend-facing agent.
 * Input: one runtime-like agent record.
 * Output: display-ready agent name with the orchestrator fallback applied.
 */
export function agentDisplayName(agent: AgentLike | undefined): string {
  const trimmedName = agent?.name?.trim() ?? ''

  if (trimmedName) {
    return trimmedName
  }

  if (agent?.id === ORCHESTRATOR_AGENT_ID) {
    return DEFAULT_ORCHESTRATOR_AGENT_NAME
  }

  return agent?.id ?? DEFAULT_ORCHESTRATOR_AGENT_NAME
}

/**
 * Builds short mention aliases from the current display name.
 * Input: one runtime-like agent record.
 * Output: normalized lowercase aliases without duplicates.
 */
export function agentMentionAliases(agent: AgentLike): string[] {
  const aliases = new Set<string>()
  const displayName = agentDisplayName(agent)

  aliases.add(agent.id.toLowerCase())
  aliases.add(displayName.toLowerCase())

  const withoutAgentSuffix = displayName.replace(/\s+agent$/i, '').trim()
  if (withoutAgentSuffix) {
    aliases.add(withoutAgentSuffix.toLowerCase())
  }

  const firstToken = displayName.split(/\s+/)[0]?.trim()
  if (firstToken) {
    aliases.add(firstToken.toLowerCase())
  }

  if (agent.id === ORCHESTRATOR_AGENT_ID) {
    aliases.add('main')
  }

  return [...aliases].filter(Boolean)
}

/**
 * Detects one explicit @mention alias inside the provided content.
 * Input: raw message content and one normalized alias.
 * Output: true when the alias is explicitly mentioned.
 */
export function matchesMentionAlias(content: string, alias: string): boolean {
  const pattern = new RegExp(`(^|[\\s(（\\[{])@${escapeRegex(alias)}(?=$|[\\s:：,，.。;；!！?？)）\\]}])`, 'i')
  return pattern.test(content)
}

/**
 * Resolves one unique mentioned agent id from the candidate list.
 * Input: raw message content, candidate agents, and an orchestrator toggle.
 * Output: mentioned agent id or undefined when absent or ambiguous.
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
 * Escapes literal text for use inside a regular expression.
 * Input: raw literal text.
 * Output: escaped regular-expression source.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
