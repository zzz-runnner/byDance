import type { AgentDefinition, AppState } from '@shared/contracts'

export type StorageMode = 'memory' | 'postgres'

export type StateMutator<T> = (state: AppState) => T

export type StateStore = {
  mode: StorageMode
  read(): Promise<AppState>
  update<T>(mutator: StateMutator<T>): Promise<T>
  createAgent?(agent: AgentDefinition): Promise<AgentDefinition>
  updateAgent?(
    agentId: string,
    updater: (agent: AgentDefinition) => AgentDefinition,
  ): Promise<AgentDefinition | undefined>
  deleteAgent?(agentId: string): Promise<boolean>
}

/**
 * Clones application state so callers cannot mutate stored references.
 * Input: current application state. Output: detached application state copy.
 */
export function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState
}
