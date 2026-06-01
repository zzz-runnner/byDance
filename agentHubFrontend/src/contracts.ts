export type WorkspaceType = 'dev' | 'research' | 'writing' | 'chat'
export type RuntimeType = 'cloud' | 'local'
export type RuntimeStatus = 'creating' | 'ready' | 'error'
export type ConversationType = 'group' | 'direct'
export type SenderType = 'user' | 'agent' | 'system'
export type ArtifactType = 'code' | 'diff' | 'web-preview' | 'file' | 'deploy-status' | 'zip' | 'text'
export type AgentProvider = 'claude' | 'codex' | 'mock'
export type PermissionMode = 'readonly' | 'ask' | 'acceptEdits' | 'dangerous'
export type Isolation = 'shared' | 'worktree'
export type TaskHandoffSource = 'main' | 'user_direct'
export type TaskHandoffStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed'
export type AgentRunStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed'
export type WorkflowTaskStage = 'chat' | 'requirements_intake' | 'planning' | 'awaiting_confirmation' | 'execution' | 'review'
export type ExecutionReadiness =
  | 'not_a_task'
  | 'unclear_requirements'
  | 'plan_ready'
  | 'user_confirmed'
  | 'execution_in_progress'
export type AssistantMessageScope = 'main_brain' | 'agent_session' | 'synthesis'
export type AgentOutputStream = 'stdout' | 'stderr'
export type DeliveryValidationStatus = 'pass' | 'partial' | 'fail' | 'skipped'
export type DeliveryIssueSeverity = 'info' | 'warning' | 'blocking'
export type ReviewVerdict = 'pass' | 'partial' | 'fail' | 'unknown'
export type MainBrainSynthesisKind = 'final_answer' | 'continue_dispatch' | 'ask_clarification' | 'report_failure'
export type MainBrainVerdict = 'success' | 'partial' | 'failed'
export type MainBrainTurnKind = 'direct_answer' | 'dispatch_agents' | 'ask_clarification'
export type TurnFinalizationMode = 'speaker_direct' | 'main_synthesis' | 'local_summary' | 'none'

export type ChangedFile = {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

export type Artifact = {
  id: string
  workspaceId: string
  agentRunId?: string
  type: ArtifactType
  title: string
  content: string
  url?: string
  createdByAgentId?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export type Workspace = {
  id: string
  projectId?: string
  name: string
  goal: string
  workspaceType: WorkspaceType
  rootPath: string
  runtimeType: RuntimeType
  runtimeStatus: RuntimeStatus
  projectBrief: string
  agentHubPreviewUrl?: string
  agentHubZipUrl?: string
  pinnedMessageIds: string[]
  createdAt: string
  updatedAt: string
}

export type Conversation = {
  id: string
  workspaceId: string
  type: ConversationType
  title: string
  participants: string[]
  createdAt: string
  updatedAt: string
}

export type ReplyReference = {
  messageId: string
  senderId: string
  senderName?: string
  excerpt: string
}

export type Message = {
  id: string
  workspaceId: string
  conversationId: string
  senderType: SenderType
  senderId: string
  content: string
  replyTo?: ReplyReference
  artifacts: Artifact[]
  createdAt: string
}

export type ContextPolicy = {
  includeProjectBrief: boolean
  includePinnedMessages: boolean
  recentMessageLimit: number
  includeSameConversationOnly: boolean
  includeArtifacts: boolean
  includeFileSummaries: boolean
  allowReadFilesOnDemand: boolean
}

export type RuntimePolicy = {
  workspaceOnly: boolean
  allowNetwork: boolean
  allowShell: boolean
  maxRunSeconds: number
}

export type AgentSpeakerMode = 'direct_speaker' | 'worker_only' | 'either'

export type AgentRoutingProfile = {
  routingSummary: string
  responsibilities: string[]
  goodAt: string[]
  notFor: string[]
  preferredStages: WorkflowTaskStage[]
  exampleRequests: string[]
  speakerMode: AgentSpeakerMode
}

export type AgentDefinition = {
  id: string
  name: string
  role: string
  description: string
  whenToUse: string
  systemPrompt: string
  modelProvider: AgentProvider
  model?: string
  contextPolicy: ContextPolicy
  tools: string[]
  permissions: {
    fileRead: boolean
    fileWrite: boolean
    shell: boolean
    webSearch: boolean
    webFetch: boolean
    deploy: boolean
  }
  disallowedTools?: string[]
  permissionMode: PermissionMode
  runtimePolicy: RuntimePolicy
  outputSchema: string
  isolation: Isolation
  skills: string[]
  routingProfile?: AgentRoutingProfile
  source: 'built-in' | 'workspace' | 'custom'
  createdAt: string
  updatedAt: string
}

export type AgentRun = {
  id: string
  workspaceId: string
  conversationId: string
  agentId: string
  sessionId?: string
  handoffId?: string
  inputContext: string
  output: string
  status: AgentRunStatus
  provider: AgentProvider
  logs: string[]
  startedAt: string
  finishedAt?: string
  error?: string
}

export type AgentSession = {
  id: string
  workspaceId: string
  agentId: string
  title: string
  status: 'active' | 'archived'
  lastHandoffId?: string
  createdAt: string
  updatedAt: string
}

export type AgentSessionMessage = {
  id: string
  workspaceId: string
  sessionId: string
  agentId: string
  senderType: SenderType
  senderId: string
  kind: 'user_message' | 'agent_reply' | 'task_handoff' | 'task_result' | 'system_note'
  content: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export type TaskHandoff = {
  id: string
  workspaceId: string
  conversationId: string
  sessionId: string
  agentId: string
  source: TaskHandoffSource
  task: string
  requiredContext: string[]
  expectedOutput: string
  status: TaskHandoffStatus
  resultRunId?: string
  resultSummary?: string
  createdAt: string
  updatedAt: string
}

export type ChangeSet = {
  id: string
  workspaceId: string
  agentRunId: string
  baseCommit: string
  files: ChangedFile[]
  summary: string
  patch?: string
  createdAt: string
}

export type ContextSnapshot = {
  id: string
  workspaceId: string
  conversationId: string
  agentRunId?: string
  inputContext: string
  summary: string
  sourceRefs: string[]
  tokenEstimate: number
  createdAt: string
}

export type DiagnosticLog = {
  id: string
  level: 'debug' | 'info' | 'warn' | 'error'
  category: string
  workspaceId: string
  conversationId?: string
  sessionId?: string
  handoffId?: string
  runId?: string
  agentId?: string
  turnId?: string
  message: string
  data?: Record<string, unknown>
  createdAt: string
}

type WorkflowEventBase = {
  workspaceId: string
  conversationId: string
  turnId?: string
}

export type WorkflowEvent =
  | (WorkflowEventBase & { type: 'turn_started'; content: string; activeAgentId?: string })
  | (WorkflowEventBase & { type: 'workflow_received'; content: string })
  | (WorkflowEventBase & { type: 'routing_started'; content: string })
  | (WorkflowEventBase & {
      type: 'routing_finished'
      source: string
      provider?: string
      model?: string
      error?: string
      speakerAgentId?: string
      finalizationMode?: TurnFinalizationMode
      taskStage?: WorkflowTaskStage
      executionReadiness?: ExecutionReadiness
      needsUserConfirmation?: boolean
      mode: string
      brainKind?: MainBrainTurnKind
      execution: string
      targetAgents: string[]
    })
  | (WorkflowEventBase & {
      type: 'task_stage_updated'
      taskStage: WorkflowTaskStage
      executionReadiness: ExecutionReadiness
      needsUserConfirmation: boolean
      reason: string
    })
  | (WorkflowEventBase & { type: 'context_started'; scope: string; agentId?: string; agentName?: string })
  | (WorkflowEventBase & { type: 'context_finished'; scope: string; tokenEstimate: number; summary?: string })
  | (WorkflowEventBase & { type: 'model_call_started'; scope: string; provider: string; model?: string; agentId?: string; agentName?: string })
  | (WorkflowEventBase & { type: 'model_call_finished'; scope: string; provider: string; model?: string; elapsedMs: number })
  | (WorkflowEventBase & { type: 'model_call_failed'; scope: string; provider?: string; model?: string; elapsedMs?: number; error: string })
  | (WorkflowEventBase & {
      type: 'assistant_message_started'
      scope: AssistantMessageScope
      messageId: string
      senderId: string
      senderName?: string
    })
  | (WorkflowEventBase & { type: 'assistant_delta'; scope: AssistantMessageScope; messageId: string; delta: string })
  | (WorkflowEventBase & { type: 'assistant_message_finished'; scope: AssistantMessageScope; messageId: string; contentLength: number })
  | (WorkflowEventBase & { type: 'assistant_message_error'; scope: AssistantMessageScope; messageId: string; error: string })
  | (WorkflowEventBase & {
      type: 'handoff_created'
      handoffId: string
      sessionId: string
      agentId: string
      agentName: string
      source: TaskHandoffSource
      status: TaskHandoffStatus
    })
  | (WorkflowEventBase & {
      type: 'agent_task_dispatched'
      handoffId: string
      sessionId: string
      agentId: string
      agentName: string
      source: TaskHandoffSource
      task: string
      expectedOutput: string
      requiredContext: string[]
    })
  | (WorkflowEventBase & { type: 'handoff_updated'; handoffId: string; sessionId: string; agentId: string; agentName: string; status: TaskHandoffStatus })
  | (WorkflowEventBase & { type: 'agent_started'; runId: string; agentId: string; agentName: string; task: string; contextTokens: number })
  | (WorkflowEventBase & { type: 'agent_progress'; runId: string; agentId: string; agentName: string; message: string })
  | (WorkflowEventBase & { type: 'agent_output_started'; runId: string; agentId: string; agentName: string; stream: AgentOutputStream })
  | (WorkflowEventBase & {
      type: 'agent_stdout_delta' | 'agent_stderr_delta'
      runId: string
      agentId: string
      agentName: string
      sequence: number
      delta: string
      byteLength: number
    })
  | (WorkflowEventBase & {
      type: 'agent_output_finished'
      runId: string
      agentId: string
      agentName: string
      stream: AgentOutputStream
      byteLength: number
      chunkCount: number
      exitCode: number | null
      timedOut: boolean
    })
  | (WorkflowEventBase & { type: 'agent_finished'; runId: string; agentId: string; agentName: string; status: 'success' | 'partial' | 'failed'; baseCommit: string; summary: string })
  | (WorkflowEventBase & { type: 'delivery_validation_finished'; runId: string; agentId: string; status: DeliveryValidationStatus; summary: string; issues: Array<{ severity: DeliveryIssueSeverity; message: string; path?: string }> })
  | (WorkflowEventBase & { type: 'review_verdict'; runId: string; agentId: string; verdict: ReviewVerdict; summary: string; issues: string[] })
  | (WorkflowEventBase & { type: 'artifact_created'; artifactId: string; artifactType: ArtifactType; title: string; url?: string; runId?: string; agentId?: string })
  | (WorkflowEventBase & { type: 'change_set_created'; changeSetId: string; runId: string; baseCommit: string; summary: string; files: ChangedFile[] })
  | (WorkflowEventBase & { type: 'preview_ready'; artifactId: string; previewUrl: string; runId?: string; agentId?: string })
  | (WorkflowEventBase & { type: 'zip_ready'; artifactId: string; zipUrl: string; fileCount: number; byteLength: number })
  | (WorkflowEventBase & { type: 'agent_session_started'; sessionId: string; agentId: string; agentName: string; content: string })
  | (WorkflowEventBase & { type: 'agent_session_finished'; sessionId: string; agentId: string; agentName: string; source: string; turnKind: string })
  | (WorkflowEventBase & { type: 'synthesis_started'; runCount: number })
  | (WorkflowEventBase & { type: 'synthesis_finished'; source: string; synthesisKind: MainBrainSynthesisKind; verdict: MainBrainVerdict; followUpAgents: string[] })
  | (WorkflowEventBase & { type: 'workflow_finished'; summary: string })

export type WorkflowEventRecord = {
  id: string
  workspaceId: string
  conversationId: string
  event: WorkflowEvent
  createdAt: string
}

export type AppState = {
  workspaces: Workspace[]
  conversations: Conversation[]
  messages: Message[]
  agents: AgentDefinition[]
  agentSessions: AgentSession[]
  agentSessionMessages: AgentSessionMessage[]
  taskHandoffs: TaskHandoff[]
  agentRuns: AgentRun[]
  artifacts: Artifact[]
  changeSets: ChangeSet[]
  contextSnapshots: ContextSnapshot[]
  workflowEvents: WorkflowEventRecord[]
  diagnosticLogs: DiagnosticLog[]
}
