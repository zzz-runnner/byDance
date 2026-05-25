import { AppStateSchema, type AppState } from '@shared/contracts'
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
