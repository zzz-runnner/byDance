import type { AgentOutputStream } from '@shared/contracts'
import type { AgentAdapterInput } from './types'

type StreamStats = {
  byteLength: number
  chunkCount: number
  sequence: number
  started: boolean
}

type StreamState = Record<AgentOutputStream, StreamStats>

/**
 * Creates live output event helpers for one child-agent process.
 * Input: adapter input with run identity and optional event sink. Output: stdout/stderr emitters and finish notifier.
 */
export function createAgentOutputEmitter(input: AgentAdapterInput): {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  finish: (exitCode: number | null, timedOut: boolean) => void
} {
  const state: StreamState = {
    stdout: { byteLength: 0, chunkCount: 0, sequence: 0, started: false },
    stderr: { byteLength: 0, chunkCount: 0, sequence: 0, started: false },
  }

  /**
   * Builds shared workflow event fields for child-agent output events.
   * Input: none. Output: event identity fields.
   */
  function baseFields(): {
    workspaceId: string
    conversationId: string
    runId: string
    agentId: string
    agentName: string
  } {
    return {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.agent.id,
      agentName: input.agent.name,
    }
  }

  /**
   * Emits a stream-started event once per stream.
   * Input: stream name. Output: none.
   */
  function ensureStarted(stream: AgentOutputStream): void {
    const stats = state[stream]
    if (stats.started) {
      return
    }
    stats.started = true
    input.eventSink?.({
      ...baseFields(),
      type: 'agent_output_started',
      stream,
    })
  }

  /**
   * Emits one stdout or stderr delta while collecting byte statistics.
   * Input: stream name and text chunk. Output: none.
   */
  function emitDelta(stream: AgentOutputStream, chunk: string): void {
    if (!chunk) {
      return
    }
    ensureStarted(stream)
    const stats = state[stream]
    const byteLength = Buffer.byteLength(chunk, 'utf8')
    stats.sequence += 1
    stats.chunkCount += 1
    stats.byteLength += byteLength
    if (stream === 'stdout') {
      input.eventSink?.({
        ...baseFields(),
        type: 'agent_stdout_delta',
        sequence: stats.sequence,
        delta: chunk,
        byteLength,
      })
      return
    }

    input.eventSink?.({
      ...baseFields(),
      type: 'agent_stderr_delta',
      sequence: stats.sequence,
      delta: chunk,
      byteLength,
    })
  }

  /**
   * Emits stream-finished events for streams that produced output.
   * Input: child process exit code and timeout flag. Output: none.
   */
  function finish(exitCode: number | null, timedOut: boolean): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const stats = state[stream]
      if (!stats.started) {
        continue
      }
      input.eventSink?.({
        ...baseFields(),
        type: 'agent_output_finished',
        stream,
        byteLength: stats.byteLength,
        chunkCount: stats.chunkCount,
        exitCode,
        timedOut,
      })
    }
  }

  return {
    stdout: chunk => emitDelta('stdout', chunk),
    stderr: chunk => emitDelta('stderr', chunk),
    finish,
  }
}
