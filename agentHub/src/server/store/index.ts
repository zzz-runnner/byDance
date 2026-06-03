import type { ServerEnv } from '../env'
import {
  normalizeBuiltInAgentPresentation,
  syncAgentDerivedTitles,
} from '../agents/agent-presentation'
import {
  ensureWorkspaceAgentMembers,
  syncWorkspaceGroupParticipants,
} from '../agents/workspace-agents'
import { MemoryStateStore } from './memory'
import { createPostgresStateStore } from './postgres'
import { createSeedState } from './seed'
import { recoverStaleAgentRuns } from './stale-runs'
import type { StateStore } from './types'
import type { AppState } from '@shared/contracts'
import { isoNow } from '@shared/contracts'

/**
 * Migrates built-in agent runtime limits upward without overwriting user agents.
 * Input: state store and seed state. Output: promise resolved after defaults are applied.
 */
async function applyBuiltInAgentRuntimeDefaults(store: StateStore, seed: AppState): Promise<void> {
  const defaults = new Map(seed.agents.map(agent => [agent.id, agent.runtimePolicy.maxRunSeconds]))
  await store.update(state => {
    let changed = false
    for (const agent of state.agents) {
      const defaultSeconds = defaults.get(agent.id)
      if (agent.source !== 'built-in' || defaultSeconds === undefined) {
        continue
      }
      if (agent.runtimePolicy.maxRunSeconds < defaultSeconds) {
        agent.runtimePolicy.maxRunSeconds = defaultSeconds
        agent.updatedAt = isoNow()
        changed = true
      }
    }
    return changed
  })
}

/**
 * Backfills missing built-in routing metadata after schema upgrades.
 * Input: state store and seed state. Output: promise resolved after defaults are applied.
 */
async function applyBuiltInAgentRoutingProfiles(store: StateStore, seed: AppState): Promise<void> {
  const defaults = new Map(
    seed.agents
      .filter(agent => agent.routingProfile)
      .map(agent => [agent.id, agent.routingProfile]),
  )
  await store.update(state => {
    let changed = false
    for (const agent of state.agents) {
      const defaultProfile = defaults.get(agent.id)
      if (agent.source !== 'built-in' || !defaultProfile || agent.routingProfile) {
        continue
      }
      agent.routingProfile = defaultProfile
      agent.updatedAt = isoNow()
      changed = true
    }
    return changed
  })
}

/**
 * Backfills built-in display names after presentation updates without changing stable ids.
 * Input: state store.
 * Output: promise resolved after built-in names are normalized.
 */
async function applyBuiltInAgentPresentationDefaults(store: StateStore): Promise<void> {
  await store.update(state => {
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
        syncAgentDerivedTitles(state, previousAgent, agent, agent.updatedAt)
        changed = true
      }
    }
    return changed
  })
}

/**
 * Backfills workspace membership rows for built-ins and keeps group rooms in sync.
 * Input: state store.
 * Output: promise resolved after workspace memberships are normalized.
 */
async function applyWorkspaceAgentMembershipDefaults(store: StateStore): Promise<void> {
  await store.update(state => {
    let changed = false
    const now = isoNow()

    for (const workspace of state.workspaces) {
      const beforeCount = state.workspaceAgentMembers.length
      ensureWorkspaceAgentMembers(state, workspace.id, now)
      if (state.workspaceAgentMembers.length !== beforeCount) {
        changed = true
      }
      if (syncWorkspaceGroupParticipants(state, workspace.id, now)) {
        changed = true
      }
    }

    return changed
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
  await applyBuiltInAgentRuntimeDefaults(store, seed)
  await applyBuiltInAgentRoutingProfiles(store, seed)
  await applyBuiltInAgentPresentationDefaults(store)
  await applyWorkspaceAgentMembershipDefaults(store)
  await recoverStaleAgentRuns(store)
  return store
}
