import type { ServerEnv } from '../env'
import {
  normalizeBuiltInAgentPresentation,
  syncAgentDerivedTitles,
} from '../agents/agent-presentation'
import {
  AGENT_TEMPLATES,
  createDirectAgentInstance,
  createGroupAgentInstances,
  DIRECT_CHAT_AGENT_ORDER,
  ensureWorkspaceAgentMembers,
  syncWorkspaceGroupParticipants,
} from '../agents/workspace-agents'
import { MemoryStateStore } from './memory'
import { createPostgresStateStore } from './postgres'
import { createSeedState } from './seed'
import { recoverStaleAgentRunsInState } from './stale-runs'
import type { StateStore } from './types'
import type { AppState } from '@shared/contracts'
import { isoNow } from '@shared/contracts'

const DEFAULT_DIRECT_CHAT_AGENT_ID = 'codex-direct'
const DIRECT_CHAT_AGENT_IDS = new Set<string>(DIRECT_CHAT_AGENT_ORDER)

/**
 * Finds one scoped agent row by room-local id.
 * Input: mutable state plus scope fields. Output: matching scoped agent or undefined.
 */
function findScopedAgent(
  state: AppState,
  workspaceId: string,
  conversationId: string,
  agentId: string,
) {
  return state.agents.find(agent =>
    agent.id === agentId &&
    agent.workspaceId === workspaceId &&
    agent.conversationId === conversationId,
  )
}

/**
 * Finds the best legacy built-in row to preserve user-editable fields while scoping it.
 * Input: runtime state plus target workspace and room-local id. Output: legacy built-in row or undefined.
 */
function findLegacyBuiltInAgent(state: AppState, workspaceId: string, agentId: string) {
  return (
    state.agents.find(agent =>
      agent.id === agentId &&
      agent.source === 'built-in' &&
      agent.workspaceId === workspaceId &&
      !agent.conversationId,
    ) ??
    state.agents.find(agent =>
      agent.id === agentId &&
      agent.source === 'built-in' &&
      !agent.workspaceId &&
      !agent.conversationId,
    )
  )
}

/**
 * Applies legacy built-in edits to a newly scoped template instance.
 * Input: state, target agent instance, and workspace id. Output: scoped built-in agent row.
 */
function preserveLegacyBuiltInEdits(
  state: AppState,
  instance: AppState['agents'][number],
  workspaceId: string,
) {
  const legacy = findLegacyBuiltInAgent(state, workspaceId, instance.id)
  if (!legacy) {
    return instance
  }

  return normalizeBuiltInAgentPresentation({
    ...instance,
    name: legacy.name,
    modelProvider: legacy.modelProvider,
    model: legacy.model,
    updatedAt: legacy.updatedAt,
  })
}

/**
 * Moves legacy one-on-one conversations from group agents to the dedicated direct-chat agent.
 * Input: current runtime state. Output: true when any direct conversation was changed.
 */
function applyLegacyDirectConversationTargets(state: AppState): boolean {
  let changed = false
  const now = isoNow()
  for (const conversation of state.conversations) {
    if (conversation.type !== 'direct') {
      continue
    }

    const targetAgentIds = conversation.participants.filter(participant => participant !== 'user')
    if (
      targetAgentIds.length !== 1 ||
      DIRECT_CHAT_AGENT_IDS.has(targetAgentIds[0])
    ) {
      continue
    }

    conversation.participants = ['user', DEFAULT_DIRECT_CHAT_AGENT_ID]
    conversation.title = 'Codex Agent 私聊'
    conversation.updatedAt = now
    changed = true
  }

  return changed
}

/**
 * Ensures every conversation has its own built-in agent rows and removes legacy global built-ins.
 * Input: current runtime state. Output: true when scoped rows were created or global rows removed.
 */
function applyScopedBuiltInAgentInstances(state: AppState): boolean {
  let changed = false
  const now = isoNow()

  for (const conversation of state.conversations) {
    if (conversation.type === 'group') {
      for (const agent of createGroupAgentInstances(conversation.workspaceId, conversation.id, now)) {
        if (findScopedAgent(state, conversation.workspaceId, conversation.id, agent.id)) {
          continue
        }
        state.agents.push(preserveLegacyBuiltInEdits(state, agent, conversation.workspaceId))
        changed = true
      }
      continue
    }

    const targetAgentId = conversation.participants.find(participant => participant !== 'user')
    if (!targetAgentId || !DIRECT_CHAT_AGENT_IDS.has(targetAgentId)) {
      continue
    }
    if (findScopedAgent(state, conversation.workspaceId, conversation.id, targetAgentId)) {
      continue
    }
    const agent = createDirectAgentInstance(
      targetAgentId as typeof DIRECT_CHAT_AGENT_ORDER[number],
      conversation.workspaceId,
      conversation.id,
      now,
    )
    state.agents.push(preserveLegacyBuiltInEdits(state, agent, conversation.workspaceId))
    changed = true
  }

  const scopedAgents = state.agents.filter(agent => {
    const keep = agent.source !== 'built-in' || Boolean(agent.workspaceId && agent.conversationId)
    if (!keep) {
      changed = true
    }
    return keep
  })
  if (scopedAgents.length !== state.agents.length) {
    state.agents = scopedAgents
  }

  return changed
}

/**
 * Backfills conversation scope for legacy custom agents.
 * Input: current runtime state. Output: true when custom agent rows were scoped.
 */
function applyCustomAgentConversationScopes(state: AppState): boolean {
  let changed = false
  const conversationsByWorkspace = new Map<string, AppState['conversations']>()
  for (const conversation of state.conversations) {
    conversationsByWorkspace.set(conversation.workspaceId, [
      ...(conversationsByWorkspace.get(conversation.workspaceId) ?? []),
      conversation,
    ])
  }
  const fallbackConversation =
    state.conversations.find(conversation => conversation.type === 'group') ??
    state.conversations[0]

  for (const agent of state.agents) {
    if (agent.source === 'built-in' || agent.conversationId) {
      continue
    }

    const workspaceConversations = agent.workspaceId
      ? conversationsByWorkspace.get(agent.workspaceId) ?? []
      : []
    const targetConversation =
      workspaceConversations.find(conversation => conversation.type === 'group') ??
      workspaceConversations[0] ??
      fallbackConversation

    if (!targetConversation) {
      continue
    }

    agent.workspaceId = targetConversation.workspaceId
    agent.conversationId = targetConversation.id
    agent.updatedAt = isoNow()
    changed = true
  }

  return changed
}

/**
 * Migrates built-in agent runtime limits upward without overwriting user agents.
 * Input: runtime state. Output: true when defaults are applied.
 */
function applyBuiltInAgentRuntimeDefaults(state: AppState): boolean {
  let changed = false
  for (const agent of state.agents) {
    const template = AGENT_TEMPLATES[agent.id]
    if (agent.source !== 'built-in' || !template) {
      continue
    }
    const defaultSeconds = template.runtimePolicy.maxRunSeconds
    if (agent.runtimePolicy.maxRunSeconds < defaultSeconds) {
      agent.runtimePolicy.maxRunSeconds = defaultSeconds
      agent.updatedAt = isoNow()
      changed = true
    }
  }
  return changed
}

/**
 * Backfills missing built-in routing metadata after schema upgrades.
 * Input: runtime state. Output: true when defaults are applied.
 */
function applyBuiltInAgentRoutingProfiles(state: AppState): boolean {
  let changed = false
  for (const agent of state.agents) {
    const defaultProfile = AGENT_TEMPLATES[agent.id]?.routingProfile
    if (agent.source !== 'built-in' || !defaultProfile || agent.routingProfile) {
      continue
    }
    agent.routingProfile = defaultProfile
    agent.updatedAt = isoNow()
    changed = true
  }
  return changed
}

/**
 * Backfills built-in display names after presentation updates without changing stable ids.
 * Input: state store.
 * Output: promise resolved after built-in names are normalized.
 */
function applyBuiltInAgentPresentationDefaults(state: AppState): boolean {
  let changed = false
  for (const agent of state.agents) {
    if (agent.source !== 'built-in') {
      continue
    }

    const normalized = normalizeBuiltInAgentPresentation(agent)
    if (normalized.name !== agent.name) {
      const previousAgent = {
        id: agent.id,
        name: agent.name,
      }
      agent.name = normalized.name
      agent.updatedAt = isoNow()
      syncAgentDerivedTitles(state, previousAgent, agent, agent.updatedAt, agent.workspaceId)
      changed = true
    }
  }
  return changed
}

/**
 * Backfills workspace membership rows for built-ins and keeps group rooms in sync.
 * Input: state store.
 * Output: promise resolved after workspace memberships are normalized.
 */
function applyWorkspaceAgentMembershipDefaults(state: AppState): boolean {
  let changed = false
  const now = isoNow()

  for (const workspace of state.workspaces) {
    const beforeMembers = JSON.stringify(
      state.workspaceAgentMembers.filter(member => member.workspaceId === workspace.id),
    )
    ensureWorkspaceAgentMembers(state, workspace.id, now)
    const afterMembers = JSON.stringify(
      state.workspaceAgentMembers.filter(member => member.workspaceId === workspace.id),
    )
    if (beforeMembers !== afterMembers) {
      changed = true
    }
    if (syncWorkspaceGroupParticipants(state, workspace.id, now)) {
      changed = true
    }
  }

  return changed
}

/**
 * Runs startup-only state migrations in a single store transaction.
 * Input: state store and seed state. Output: migration summary for diagnostics.
 */
async function applyStartupStateMigrations(store: StateStore, seed: AppState): Promise<{ changed: boolean; recoveredRuns: number }> {
  return store.update(state => {
    const changed = [
      applyLegacyDirectConversationTargets(state),
      applyScopedBuiltInAgentInstances(state),
      applyCustomAgentConversationScopes(state),
      applyBuiltInAgentRuntimeDefaults(state),
      applyBuiltInAgentRoutingProfiles(state),
      applyBuiltInAgentPresentationDefaults(state),
      applyWorkspaceAgentMembershipDefaults(state),
    ].some(Boolean)
    const recoveredRuns = recoverStaleAgentRunsInState(state)
    return {
      changed: changed || recoveredRuns > 0,
      recoveredRuns,
    }
  })
}

/**
 * Creates the configured application state store.
 * Input: validated server environment. Output: ready state store.
 */
export async function createStateStore(env: ServerEnv): Promise<StateStore> {
  const seed = createSeedState()
  let store: StateStore
  if (env.AGENTHUB_STORAGE === 'postgres') {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when AGENTHUB_STORAGE=postgres')
    }
    store = await createPostgresStateStore(env.DATABASE_URL, seed)
  } else {
    store = new MemoryStateStore(seed)
  }
  const migration = await applyStartupStateMigrations(store, seed)
  if (migration.changed) {
    console.info(`[agenthub] Startup state migrations applied. recoveredRuns=${migration.recoveredRuns}`)
  }
  return store
}
