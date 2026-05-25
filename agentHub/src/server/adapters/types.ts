import type { AgentDefinition, AgentProvider, Artifact, WorkflowEvent } from '@shared/contracts'
import type { LocalWorkspaceRuntime } from '../runtime/workspace'

export type AgentAdapterStatus = 'success' | 'partial' | 'failed'

export type AgentAdapterInput = {
  workspaceId: string
  conversationId: string
  runId: string
  agent: AgentDefinition
  task: string
  contextPackage: string
  runtime: LocalWorkspaceRuntime
  eventSink?: (event: WorkflowEvent) => void
}

export type AgentAdapterResult = {
  status: AgentAdapterStatus
  content: string
  artifacts: Artifact[]
  logs: string[]
}

export type AgentAdapter = {
  provider: AgentProvider
  run(input: AgentAdapterInput): Promise<AgentAdapterResult>
}
