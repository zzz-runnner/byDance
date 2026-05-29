import type { ServerEnv } from '../env'
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
  await recoverStaleAgentRuns(store)
  return store
}
