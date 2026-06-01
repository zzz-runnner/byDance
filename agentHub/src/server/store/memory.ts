import { AgentDefinitionSchema, AppStateSchema, type AgentDefinition, type AppState } from '@shared/contracts'
import { cloneState, type StateMutator, type StateStore } from './types'

export class MemoryStateStore implements StateStore {
  mode = 'memory' as const

  private state: AppState
  private updateQueue: Promise<void> = Promise.resolve()

  constructor(seed: AppState) {
    this.state = AppStateSchema.parse(seed)
  }

  /**
   * Reads the current in-memory application state.
   * Input: none. Output: detached application state copy.
   */
  async read(): Promise<AppState> {
    return cloneState(this.state)
  }

  /**
   * Applies a synchronous mutation to in-memory state and validates the result.
   * Input: mutation callback. Output: callback return value.
   */
  async update<T>(mutator: StateMutator<T>): Promise<T> {
    const operation = this.updateQueue.then(() => this.applyUpdate(mutator), () => this.applyUpdate(mutator))
    this.updateQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  async createAgent(agent: AgentDefinition): Promise<AgentDefinition> {
    return this.update(state => {
      if (state.agents.some(item => item.id === agent.id)) {
        throw new Error(`Agent already exists: ${agent.id}`)
      }
      const parsed = AgentDefinitionSchema.parse(agent)
      state.agents.push(parsed)
      return parsed
    })
  }

  async updateAgent(
    agentId: string,
    updater: (agent: AgentDefinition) => AgentDefinition,
  ): Promise<AgentDefinition | undefined> {
    return this.update(state => {
      const index = state.agents.findIndex(agent => agent.id === agentId)
      if (index === -1) {
        return undefined
      }
      const updated = AgentDefinitionSchema.parse(updater(state.agents[index]))
      state.agents[index] = updated
      return updated
    })
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    return this.update(state => {
      const previousLength = state.agents.length
      state.agents = state.agents.filter(agent => agent.id !== agentId)
      return state.agents.length !== previousLength
    })
  }

  /**
   * Applies one queued mutation to in-memory state and validates the result.
   * Input: mutation callback. Output: callback return value.
   */
  private async applyUpdate<T>(mutator: StateMutator<T>): Promise<T> {
    const draft = cloneState(this.state)
    const result = mutator(draft)
    this.state = AppStateSchema.parse(draft)
    return result
  }
}
