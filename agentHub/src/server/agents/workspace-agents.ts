import type { AgentDefinition, AppState, WorkspaceAgentMember } from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import { normalizeBuiltInAgentPresentation } from './agent-presentation'

export const DEFAULT_WORKSPACE_AGENT_ORDER = [
  'orchestrator',
  'product-manager',
  'engineer',
  'reviewer',
] as const

const DEFAULT_WORKSPACE_AGENT_ORDER_MAP = new Map<string, number>(
  DEFAULT_WORKSPACE_AGENT_ORDER.map((agentId, index) => [agentId, index] as const),
)

/**
 * Returns whether one agent definition is a global built-in template.
 * Input: one agent definition. Output: true for built-in templates only.
 */
export function isBuiltInAgent(agent: AgentDefinition): boolean {
  return agent.source === 'built-in'
}

/**
 * Returns whether one agent definition belongs to one workspace only.
 * Input: one agent definition. Output: true for workspace-scoped custom agents.
 */
export function isWorkspaceScopedAgent(agent: AgentDefinition): boolean {
  return agent.source !== 'built-in'
}

/**
 * Returns built-in templates in stable workspace display order.
 * Input: full application state. Output: normalized built-in agent templates.
 */
export function listBuiltInAgents(state: AppState): AgentDefinition[] {
  return state.agents
    .filter(isBuiltInAgent)
    .map(agent => normalizeBuiltInAgentPresentation(agent))
    .sort((left, right) => compareAgentOrder(left.id, right.id) || left.createdAt.localeCompare(right.createdAt))
}

/**
 * Returns workspace-scoped custom agents for one workspace.
 * Input: full state and workspace id. Output: custom agents in stable order.
 */
export function listWorkspaceCustomAgents(state: AppState, workspaceId: string): AgentDefinition[] {
  return state.agents
    .filter(agent => isWorkspaceScopedAgent(agent) && agent.workspaceId === workspaceId)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
}

/**
 * Creates the default locked built-in members for one workspace.
 * Input: built-in templates, workspace id, and timestamp. Output: default membership rows.
 */
export function createDefaultWorkspaceAgentMembers(
  agents: AgentDefinition[],
  workspaceId: string,
  createdAt = isoNow(),
): WorkspaceAgentMember[] {
  return agents
    .filter(isBuiltInAgent)
    .map(agent => normalizeBuiltInAgentPresentation(agent))
    .sort((left, right) => compareAgentOrder(left.id, right.id) || left.createdAt.localeCompare(right.createdAt))
    .map((agent, index) => ({
      workspaceId,
      agentId: agent.id,
      displayName: agent.name,
      sortOrder: DEFAULT_WORKSPACE_AGENT_ORDER_MAP.get(agent.id) ?? index + DEFAULT_WORKSPACE_AGENT_ORDER.length,
      locked: true,
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    }))
}

/**
 * Ensures one workspace has locked built-in membership rows.
 * Input: mutable application state, workspace id, and timestamp. Output: workspace members after backfill.
 */
export function ensureWorkspaceAgentMembers(
  state: AppState,
  workspaceId: string,
  createdAt = isoNow(),
): WorkspaceAgentMember[] {
  const builtInAgents = listBuiltInAgents(state)
  const existingMembers = state.workspaceAgentMembers.filter(member => member.workspaceId === workspaceId)
  const memberByAgentId = new Map(existingMembers.map(member => [member.agentId, member]))
  let changed = false

  for (const member of createDefaultWorkspaceAgentMembers(builtInAgents, workspaceId, createdAt)) {
    if (memberByAgentId.has(member.agentId)) {
      continue
    }
    state.workspaceAgentMembers.push(member)
    memberByAgentId.set(member.agentId, member)
    changed = true
  }

  return changed
    ? state.workspaceAgentMembers.filter(member => member.workspaceId === workspaceId).sort(compareWorkspaceMembers)
    : existingMembers.sort(compareWorkspaceMembers)
}

/**
 * Upserts one workspace member row without changing its stable agent id.
 * Input: mutable state and partial member payload. Output: stored workspace member row.
 */
export function upsertWorkspaceAgentMember(
  state: AppState,
  input: Omit<WorkspaceAgentMember, 'createdAt' | 'updatedAt'> & {
    createdAt?: string
    updatedAt?: string
  },
): WorkspaceAgentMember {
  const existing = state.workspaceAgentMembers.find(
    member => member.workspaceId === input.workspaceId && member.agentId === input.agentId,
  )
  const now = input.updatedAt ?? isoNow()

  if (existing) {
    existing.displayName = input.displayName
    existing.modelProviderOverride = input.modelProviderOverride
    existing.modelOverride = input.modelOverride
    existing.sortOrder = input.sortOrder
    existing.locked = input.locked
    existing.enabled = input.enabled
    existing.updatedAt = now
    return existing
  }

  const created: WorkspaceAgentMember = {
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    displayName: input.displayName,
    modelProviderOverride: input.modelProviderOverride,
    modelOverride: input.modelOverride,
    sortOrder: input.sortOrder,
    locked: input.locked,
    enabled: input.enabled,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  }
  state.workspaceAgentMembers.push(created)
  return created
}

/**
 * Resolves the effective agent list visible inside one workspace.
 * Input: full state and workspace id. Output: built-in members plus workspace custom agents.
 */
export function resolveWorkspaceAgents(state: AppState, workspaceId: string): AgentDefinition[] {
  const builtInTemplates = new Map(listBuiltInAgents(state).map(agent => [agent.id, agent]))
  const members = [
    ...state.workspaceAgentMembers.filter(member => member.workspaceId === workspaceId),
    ...createDefaultWorkspaceAgentMembers(listBuiltInAgents(state), workspaceId).filter(
      member => !state.workspaceAgentMembers.some(
        existing => existing.workspaceId === workspaceId && existing.agentId === member.agentId,
      ),
    ),
  ]
    .filter(member => member.enabled)
    .sort(compareWorkspaceMembers)

  const builtInAgents = members.flatMap(member => {
    const template = builtInTemplates.get(member.agentId)
    if (!template) {
      return []
    }

    const updatedAt =
      member.updatedAt.localeCompare(template.updatedAt) > 0
        ? member.updatedAt
        : template.updatedAt

    return [{
      ...template,
      name: member.displayName.trim() || template.name,
      modelProvider: member.modelProviderOverride ?? template.modelProvider,
      model: member.modelOverride ?? template.model,
      updatedAt,
    }]
  })

  const customAgents = listWorkspaceCustomAgents(state, workspaceId)
  return [...builtInAgents, ...customAgents]
}

/**
 * Resolves one effective agent view inside one workspace.
 * Input: full state, workspace id, and stable agent id. Output: display-ready agent or undefined.
 */
export function resolveWorkspaceAgent(
  state: AppState,
  workspaceId: string,
  agentId: string,
): AgentDefinition | undefined {
  return resolveWorkspaceAgents(state, workspaceId).find(agent => agent.id === agentId)
}

/**
 * Synchronizes group-conversation participants with workspace-available agents.
 * Input: mutable state, workspace id, and timestamp. Output: whether any group conversation changed.
 */
export function syncWorkspaceGroupParticipants(
  state: AppState,
  workspaceId: string,
  updatedAt = isoNow(),
): boolean {
  const nextParticipants = ['user', ...resolveWorkspaceAgents(state, workspaceId).map(agent => agent.id)]
  let changed = false

  for (const conversation of state.conversations) {
    if (conversation.workspaceId !== workspaceId || conversation.type !== 'group') {
      continue
    }

    const currentParticipants = conversation.participants.join('\u0000')
    const targetParticipants = nextParticipants.join('\u0000')
    if (currentParticipants === targetParticipants) {
      continue
    }

    conversation.participants = [...nextParticipants]
    conversation.updatedAt = updatedAt
    changed = true
  }

  return changed
}

function compareAgentOrder(leftId: string, rightId: string): number {
  const leftOrder = DEFAULT_WORKSPACE_AGENT_ORDER_MAP.get(leftId) ?? Number.MAX_SAFE_INTEGER
  const rightOrder = DEFAULT_WORKSPACE_AGENT_ORDER_MAP.get(rightId) ?? Number.MAX_SAFE_INTEGER
  return leftOrder - rightOrder || leftId.localeCompare(rightId)
}

function compareWorkspaceMembers(left: WorkspaceAgentMember, right: WorkspaceAgentMember): number {
  return (
    left.sortOrder - right.sortOrder ||
    compareAgentOrder(left.agentId, right.agentId) ||
    left.createdAt.localeCompare(right.createdAt)
  )
}
