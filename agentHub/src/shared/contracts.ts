import { z } from 'zod'

export const WorkspaceTypeSchema = z.enum(['dev', 'research', 'writing', 'chat'])
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>

export const RuntimeTypeSchema = z.enum(['cloud', 'local'])
export type RuntimeType = z.infer<typeof RuntimeTypeSchema>

export const RuntimeStatusSchema = z.enum(['creating', 'ready', 'error'])
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>

export const ConversationTypeSchema = z.enum(['group', 'direct'])
export type ConversationType = z.infer<typeof ConversationTypeSchema>

export const SenderTypeSchema = z.enum(['user', 'agent', 'system'])
export type SenderType = z.infer<typeof SenderTypeSchema>

export const ArtifactTypeSchema = z.enum([
  'code',
  'diff',
  'web-preview',
  'file',
  'deploy-status',
  'zip',
  'text',
])
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

export const AgentProviderSchema = z.enum(['claude', 'codex', 'mock'])
export type AgentProvider = z.infer<typeof AgentProviderSchema>

export const PermissionModeSchema = z.enum([
  'readonly',
  'ask',
  'acceptEdits',
  'dangerous',
])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

export const IsolationSchema = z.enum(['shared', 'worktree'])
export type Isolation = z.infer<typeof IsolationSchema>

export const RoutingModeSchema = z.enum([
  'answer_directly',
  'single_agent',
  'multi_agent',
])
export type RoutingMode = z.infer<typeof RoutingModeSchema>

export const RoutingExecutionSchema = z.enum(['serial', 'parallel'])
export type RoutingExecution = z.infer<typeof RoutingExecutionSchema>

export const MainBrainTurnKindSchema = z.enum([
  'direct_answer',
  'dispatch_agents',
  'ask_clarification',
])
export type MainBrainTurnKind = z.infer<typeof MainBrainTurnKindSchema>

export const TurnFinalizationModeSchema = z.enum([
  'speaker_direct',
  'main_synthesis',
  'local_summary',
  'none',
])
export type TurnFinalizationMode = z.infer<typeof TurnFinalizationModeSchema>

export const MainBrainSynthesisKindSchema = z.enum([
  'final_answer',
  'continue_dispatch',
  'ask_clarification',
  'report_failure',
])
export type MainBrainSynthesisKind = z.infer<typeof MainBrainSynthesisKindSchema>

export const MainBrainVerdictSchema = z.enum(['success', 'partial', 'failed'])
export type MainBrainVerdict = z.infer<typeof MainBrainVerdictSchema>

export const AgentSessionStatusSchema = z.enum(['active', 'archived'])
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>

export const AgentSessionMessageKindSchema = z.enum([
  'user_message',
  'agent_reply',
  'task_handoff',
  'task_result',
  'system_note',
])
export type AgentSessionMessageKind = z.infer<typeof AgentSessionMessageKindSchema>

export const TaskHandoffSourceSchema = z.enum(['main', 'user_direct'])
export type TaskHandoffSource = z.infer<typeof TaskHandoffSourceSchema>

export const TaskHandoffStatusSchema = z.enum(['pending', 'running', 'completed', 'partial', 'failed'])
export type TaskHandoffStatus = z.infer<typeof TaskHandoffStatusSchema>

export const AgentSessionTurnKindSchema = z.enum(['chat_reply', 'run_task', 'ask_clarification'])
export type AgentSessionTurnKind = z.infer<typeof AgentSessionTurnKindSchema>

export const AgentRunStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'partial',
  'failed',
])
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>

export const DeliveryValidationStatusSchema = z.enum(['pass', 'partial', 'fail', 'skipped'])
export type DeliveryValidationStatus = z.infer<typeof DeliveryValidationStatusSchema>

export const DeliveryIssueSeveritySchema = z.enum(['info', 'warning', 'blocking'])
export type DeliveryIssueSeverity = z.infer<typeof DeliveryIssueSeveritySchema>

export const ReviewVerdictSchema = z.enum(['pass', 'partial', 'fail', 'unknown'])
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>

export const DiagnosticLogLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
export type DiagnosticLogLevel = z.infer<typeof DiagnosticLogLevelSchema>

export const DiagnosticLogCategorySchema = z.enum([
  'workflow',
  'main_brain',
  'routing',
  'agent_session',
  'handoff',
  'agent_run',
  'adapter',
  'context',
  'synthesis',
  'store',
])
export type DiagnosticLogCategory = z.infer<typeof DiagnosticLogCategorySchema>

export const WorkflowContextScopeSchema = z.enum(['main_brain', 'agent_session', 'agent_run', 'synthesis'])
export type WorkflowContextScope = z.infer<typeof WorkflowContextScopeSchema>

export const WorkflowModelCallScopeSchema = z.enum(['main_brain', 'agent_session', 'synthesis'])
export type WorkflowModelCallScope = z.infer<typeof WorkflowModelCallScopeSchema>

export const AssistantMessageScopeSchema = z.enum(['main_brain', 'agent_session', 'synthesis'])
export type AssistantMessageScope = z.infer<typeof AssistantMessageScopeSchema>

export const AgentOutputStreamSchema = z.enum(['stdout', 'stderr'])
export type AgentOutputStream = z.infer<typeof AgentOutputStreamSchema>

export const WorkflowTaskStageSchema = z.enum([
  'chat',
  'requirements_intake',
  'planning',
  'awaiting_confirmation',
  'execution',
  'review',
])
export type WorkflowTaskStage = z.infer<typeof WorkflowTaskStageSchema>

export const ExecutionReadinessSchema = z.enum([
  'not_a_task',
  'unclear_requirements',
  'plan_ready',
  'user_confirmed',
  'execution_in_progress',
])
export type ExecutionReadiness = z.infer<typeof ExecutionReadinessSchema>

export const ChangedFileSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  additions: z.number().int(),
  deletions: z.number().int(),
})
export type ChangedFile = z.infer<typeof ChangedFileSchema>

export const ArtifactSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  agentRunId: z.string().optional(),
  type: ArtifactTypeSchema,
  title: z.string(),
  content: z.string(),
  url: z.string().optional(),
  createdByAgentId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})
export type Artifact = z.infer<typeof ArtifactSchema>

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  workspaceType: WorkspaceTypeSchema,
  rootPath: z.string(),
  runtimeType: RuntimeTypeSchema,
  runtimeStatus: RuntimeStatusSchema,
  projectBrief: z.string(),
  pinnedMessageIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const ConversationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: ConversationTypeSchema,
  title: z.string(),
  participants: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Conversation = z.infer<typeof ConversationSchema>

export const ReplyReferenceSchema = z.object({
  messageId: z.string(),
  senderId: z.string(),
  senderName: z.string().optional(),
  excerpt: z.string(),
})
export type ReplyReference = z.infer<typeof ReplyReferenceSchema>

export const CodeSelectionReferenceSchema = z.object({
  filePath: z.string().min(1),
  selectedText: z.string().min(1),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive(),
  language: z.string().optional(),
  beforeContext: z.string().optional(),
  afterContext: z.string().optional(),
})
export type CodeSelectionReference = z.infer<typeof CodeSelectionReferenceSchema>

export const MessageSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  conversationId: z.string(),
  turnId: z.string().optional(),
  senderType: SenderTypeSchema,
  senderId: z.string(),
  content: z.string(),
  replyTo: ReplyReferenceSchema.optional(),
  artifacts: z.array(ArtifactSchema),
  createdAt: z.string(),
})
export type Message = z.infer<typeof MessageSchema>

export const ContextPolicySchema = z.object({
  includeProjectBrief: z.boolean(),
  includePinnedMessages: z.boolean(),
  recentMessageLimit: z.number().int().nonnegative(),
  includeSameConversationOnly: z.boolean(),
  includeArtifacts: z.boolean(),
  includeFileSummaries: z.boolean(),
  allowReadFilesOnDemand: z.boolean(),
})
export type ContextPolicy = z.infer<typeof ContextPolicySchema>

export const RuntimePolicySchema = z.object({
  workspaceOnly: z.boolean(),
  allowNetwork: z.boolean(),
  allowShell: z.boolean(),
  maxRunSeconds: z.number().int().positive(),
})
export type RuntimePolicy = z.infer<typeof RuntimePolicySchema>

export const AgentSpeakerModeSchema = z.enum(['direct_speaker', 'worker_only', 'either'])
export type AgentSpeakerMode = z.infer<typeof AgentSpeakerModeSchema>

export const AgentRoutingProfileSchema = z.object({
  routingSummary: z.string(),
  responsibilities: z.array(z.string()),
  goodAt: z.array(z.string()),
  notFor: z.array(z.string()),
  preferredStages: z.array(WorkflowTaskStageSchema),
  exampleRequests: z.array(z.string()),
  speakerMode: AgentSpeakerModeSchema,
})
export type AgentRoutingProfile = z.infer<typeof AgentRoutingProfileSchema>

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  description: z.string(),
  whenToUse: z.string(),
  systemPrompt: z.string(),
  modelProvider: AgentProviderSchema,
  model: z.string().optional(),
  contextPolicy: ContextPolicySchema,
  tools: z.array(z.string()),
  permissions: z.object({
    fileRead: z.boolean(),
    fileWrite: z.boolean(),
    shell: z.boolean(),
    webSearch: z.boolean(),
    webFetch: z.boolean(),
    deploy: z.boolean(),
  }),
  disallowedTools: z.array(z.string()).optional(),
  permissionMode: PermissionModeSchema,
  runtimePolicy: RuntimePolicySchema,
  outputSchema: z.string(),
  isolation: IsolationSchema,
  skills: z.array(z.string()),
  routingProfile: AgentRoutingProfileSchema.optional(),
  source: z.enum(['built-in', 'workspace', 'custom']),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export const AgentRunSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  conversationId: z.string(),
  agentId: z.string(),
  sessionId: z.string().optional(),
  handoffId: z.string().optional(),
  inputContext: z.string(),
  output: z.string(),
  status: AgentRunStatusSchema,
  provider: AgentProviderSchema,
  logs: z.array(z.string()),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
})
export type AgentRun = z.infer<typeof AgentRunSchema>

export const RoutingTaskBriefSchema = z.object({
  agentId: z.string(),
  task: z.string(),
  requiredContext: z.array(z.string()),
  expectedOutput: z.string(),
  codeSelection: CodeSelectionReferenceSchema.optional(),
})
export type RoutingTaskBrief = z.infer<typeof RoutingTaskBriefSchema>

export const AgentSessionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  title: z.string(),
  status: AgentSessionStatusSchema,
  lastHandoffId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type AgentSession = z.infer<typeof AgentSessionSchema>

export const AgentSessionMessageSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  senderType: SenderTypeSchema,
  senderId: z.string(),
  kind: AgentSessionMessageKindSchema,
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})
export type AgentSessionMessage = z.infer<typeof AgentSessionMessageSchema>

export const TaskHandoffSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  conversationId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  source: TaskHandoffSourceSchema,
  task: z.string(),
  requiredContext: z.array(z.string()),
  expectedOutput: z.string(),
  status: TaskHandoffStatusSchema,
  resultRunId: z.string().optional(),
  resultSummary: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type TaskHandoff = z.infer<typeof TaskHandoffSchema>

const OptionalStringSchema = z.preprocess(value => (value === null ? undefined : value), z.string().optional())
const OptionalRoutingTaskBriefSchema = z.preprocess(
  value => (value === null ? undefined : value),
  RoutingTaskBriefSchema.optional(),
)

export const AgentSessionTurnSchema = z.object({
  kind: AgentSessionTurnKindSchema,
  finalResponse: OptionalStringSchema,
  taskBrief: OptionalRoutingTaskBriefSchema,
  internalNote: OptionalStringSchema,
})
export type AgentSessionTurn = z.infer<typeof AgentSessionTurnSchema>

export const RoutingDecisionSchema = z.object({
  mode: RoutingModeSchema,
  targetAgents: z.array(z.string()),
  execution: RoutingExecutionSchema,
  taskBriefs: z.array(RoutingTaskBriefSchema),
  finalResponse: z.string().optional(),
})
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>

export const MainBrainTurnSchema = z.object({
  kind: MainBrainTurnKindSchema,
  finalResponse: z.string().optional(),
  execution: RoutingExecutionSchema.default('serial'),
  dispatches: z.array(RoutingTaskBriefSchema).default([]),
  targetAgents: z.array(z.string()).default([]),
  speakerAgentId: z.string().optional(),
  finalizationMode: TurnFinalizationModeSchema.optional(),
  internalNote: z.string().optional(),
})
export type MainBrainTurn = z.infer<typeof MainBrainTurnSchema>

export const MainBrainSynthesisSchema = z.object({
  kind: MainBrainSynthesisKindSchema,
  verdict: MainBrainVerdictSchema,
  finalResponse: z.string().optional(),
  execution: RoutingExecutionSchema.default('serial'),
  followUpDispatches: z.array(RoutingTaskBriefSchema).default([]),
  internalNote: z.string().optional(),
})
export type MainBrainSynthesis = z.infer<typeof MainBrainSynthesisSchema>

export const ChangeSetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  agentRunId: z.string(),
  baseCommit: z.string(),
  files: z.array(ChangedFileSchema),
  summary: z.string(),
  patch: z.string().optional(),
  createdAt: z.string(),
})
export type ChangeSet = z.infer<typeof ChangeSetSchema>

export const ContextSnapshotSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  conversationId: z.string(),
  agentRunId: z.string().optional(),
  inputContext: z.string(),
  summary: z.string(),
  sourceRefs: z.array(z.string()),
  tokenEstimate: z.number().int().nonnegative(),
  createdAt: z.string(),
})
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>

export const DiagnosticLogSchema = z.object({
  id: z.string(),
  level: DiagnosticLogLevelSchema,
  category: DiagnosticLogCategorySchema,
  workspaceId: z.string(),
  conversationId: z.string().optional(),
  sessionId: z.string().optional(),
  handoffId: z.string().optional(),
  runId: z.string().optional(),
  agentId: z.string().optional(),
  turnId: z.string().optional(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})
export type DiagnosticLog = z.infer<typeof DiagnosticLogSchema>

const WorkflowEventBaseSchema = z.object({
  workspaceId: z.string(),
  conversationId: z.string(),
  turnId: z.string().optional(),
})

export const TurnStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('turn_started'),
  content: z.string(),
  activeAgentId: z.string().optional(),
})

export const WorkflowReceivedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('workflow_received'),
  content: z.string(),
})

export const RoutingStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('routing_started'),
  content: z.string(),
})

export const RoutingFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('routing_finished'),
  source: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  speakerAgentId: z.string().optional(),
  finalizationMode: TurnFinalizationModeSchema.optional(),
  taskStage: WorkflowTaskStageSchema.optional(),
  executionReadiness: ExecutionReadinessSchema.optional(),
  needsUserConfirmation: z.boolean().optional(),
  mode: RoutingModeSchema,
  brainKind: MainBrainTurnKindSchema.optional(),
  execution: RoutingExecutionSchema,
  targetAgents: z.array(z.string()),
})

export const TaskStageUpdatedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('task_stage_updated'),
  taskStage: WorkflowTaskStageSchema,
  executionReadiness: ExecutionReadinessSchema,
  needsUserConfirmation: z.boolean(),
  reason: z.string(),
})

export const ContextStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('context_started'),
  scope: WorkflowContextScopeSchema,
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
  handoffId: z.string().optional(),
  runId: z.string().optional(),
})

export const ContextFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('context_finished'),
  scope: WorkflowContextScopeSchema,
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
  handoffId: z.string().optional(),
  runId: z.string().optional(),
  tokenEstimate: z.number().int().nonnegative(),
  summary: z.string().optional(),
})

export const ModelCallStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('model_call_started'),
  scope: WorkflowModelCallScopeSchema,
  provider: z.string(),
  model: z.string().optional(),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
})

export const ModelCallFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('model_call_finished'),
  scope: WorkflowModelCallScopeSchema,
  provider: z.string(),
  model: z.string().optional(),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
  elapsedMs: z.number().int().nonnegative(),
})

export const ModelCallFailedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('model_call_failed'),
  scope: WorkflowModelCallScopeSchema,
  provider: z.string().optional(),
  model: z.string().optional(),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  sessionId: z.string().optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
  error: z.string(),
})

export const AssistantMessageStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('assistant_message_started'),
  scope: AssistantMessageScopeSchema,
  messageId: z.string(),
  senderId: z.string(),
  senderName: z.string().optional(),
})

export const AssistantDeltaEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('assistant_delta'),
  scope: AssistantMessageScopeSchema,
  messageId: z.string(),
  delta: z.string(),
})

export const AssistantMessageFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('assistant_message_finished'),
  scope: AssistantMessageScopeSchema,
  messageId: z.string(),
  contentLength: z.number().int().nonnegative(),
})

export const AssistantMessageErrorEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('assistant_message_error'),
  scope: AssistantMessageScopeSchema,
  messageId: z.string(),
  error: z.string(),
})

export const HandoffCreatedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('handoff_created'),
  handoffId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  source: TaskHandoffSourceSchema,
  status: TaskHandoffStatusSchema,
})

export const AgentTaskDispatchedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_task_dispatched'),
  handoffId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  source: TaskHandoffSourceSchema,
  task: z.string(),
  expectedOutput: z.string(),
  requiredContext: z.array(z.string()),
})

export const HandoffUpdatedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('handoff_updated'),
  handoffId: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  status: TaskHandoffStatusSchema,
  runId: z.string().optional(),
})

export const AgentStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_started'),
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  task: z.string(),
  contextTokens: z.number().int().nonnegative(),
})

export const AgentProgressEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_progress'),
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  message: z.string(),
})

export const AgentOutputStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_output_started'),
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  stream: AgentOutputStreamSchema,
})

export const AgentStdoutDeltaEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_stdout_delta'),
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  sequence: z.number().int().positive(),
  delta: z.string(),
  byteLength: z.number().int().nonnegative(),
})

export const AgentStderrDeltaEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_stderr_delta'),
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  sequence: z.number().int().positive(),
  delta: z.string(),
  byteLength: z.number().int().nonnegative(),
})

export const AgentOutputFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_output_finished'),
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  stream: AgentOutputStreamSchema,
  byteLength: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
})

export const AgentFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_finished'),
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  status: z.enum(['success', 'partial', 'failed']),
  baseCommit: z.string(),
  summary: z.string(),
})

export const DeliveryValidationFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('delivery_validation_finished'),
  runId: z.string(),
  agentId: z.string(),
  status: DeliveryValidationStatusSchema,
  summary: z.string(),
  issues: z.array(z.object({
    severity: DeliveryIssueSeveritySchema,
    message: z.string(),
    path: z.string().optional(),
  })),
})

export const ReviewVerdictEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('review_verdict'),
  runId: z.string(),
  agentId: z.string(),
  verdict: ReviewVerdictSchema,
  summary: z.string(),
  issues: z.array(z.string()),
})

export const RepairSuggestedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('repair_suggested'),
  reason: z.string(),
  targetAgentId: z.string(),
  issueCount: z.number().int().nonnegative(),
})

export const RepairStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('repair_started'),
  targetAgentId: z.string(),
  attempt: z.number().int().positive(),
  task: z.string(),
})

export const RepairFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('repair_finished'),
  targetAgentId: z.string(),
  attempt: z.number().int().positive(),
  status: z.enum(['success', 'partial', 'failed']),
  reviewerStatus: z.enum(['success', 'partial', 'failed']).optional(),
})

export const RepairBlockedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('repair_blocked'),
  reason: z.string(),
  maxAttempts: z.number().int().nonnegative(),
})

export const ArtifactCreatedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('artifact_created'),
  artifactId: z.string(),
  artifactType: ArtifactTypeSchema,
  title: z.string(),
  url: z.string().optional(),
  runId: z.string().optional(),
  agentId: z.string().optional(),
})

export const ChangeSetCreatedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('change_set_created'),
  changeSetId: z.string(),
  runId: z.string(),
  baseCommit: z.string(),
  summary: z.string(),
  files: z.array(ChangedFileSchema),
})

export const PreviewReadyEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('preview_ready'),
  artifactId: z.string(),
  previewUrl: z.string(),
  runId: z.string().optional(),
  agentId: z.string().optional(),
})

export const ZipReadyEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('zip_ready'),
  artifactId: z.string(),
  zipUrl: z.string(),
  fileCount: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
})

export const AgentSessionStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_session_started'),
  sessionId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  content: z.string(),
})

export const AgentSessionFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('agent_session_finished'),
  sessionId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  source: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  turnKind: AgentSessionTurnKindSchema,
})

export const SynthesisStartedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('synthesis_started'),
  runCount: z.number().int().nonnegative(),
})

export const SynthesisFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('synthesis_finished'),
  source: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  synthesisKind: MainBrainSynthesisKindSchema,
  verdict: MainBrainVerdictSchema,
  followUpAgents: z.array(z.string()),
})

export const WorkflowFinishedEventSchema = WorkflowEventBaseSchema.extend({
  type: z.literal('workflow_finished'),
  summary: z.string(),
})

export const WorkflowEventSchema = z.discriminatedUnion('type', [
  TurnStartedEventSchema,
  WorkflowReceivedEventSchema,
  RoutingStartedEventSchema,
  RoutingFinishedEventSchema,
  TaskStageUpdatedEventSchema,
  ContextStartedEventSchema,
  ContextFinishedEventSchema,
  ModelCallStartedEventSchema,
  ModelCallFinishedEventSchema,
  ModelCallFailedEventSchema,
  AssistantMessageStartedEventSchema,
  AssistantDeltaEventSchema,
  AssistantMessageFinishedEventSchema,
  AssistantMessageErrorEventSchema,
  ArtifactCreatedEventSchema,
  ChangeSetCreatedEventSchema,
  PreviewReadyEventSchema,
  ZipReadyEventSchema,
  HandoffCreatedEventSchema,
  AgentTaskDispatchedEventSchema,
  HandoffUpdatedEventSchema,
  AgentStartedEventSchema,
  AgentProgressEventSchema,
  AgentOutputStartedEventSchema,
  AgentStdoutDeltaEventSchema,
  AgentStderrDeltaEventSchema,
  AgentOutputFinishedEventSchema,
  AgentFinishedEventSchema,
  DeliveryValidationFinishedEventSchema,
  ReviewVerdictEventSchema,
  RepairSuggestedEventSchema,
  RepairStartedEventSchema,
  RepairFinishedEventSchema,
  RepairBlockedEventSchema,
  AgentSessionStartedEventSchema,
  AgentSessionFinishedEventSchema,
  SynthesisStartedEventSchema,
  SynthesisFinishedEventSchema,
  WorkflowFinishedEventSchema,
])
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>

export const WorkflowEventRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  conversationId: z.string(),
  event: WorkflowEventSchema,
  createdAt: z.string(),
})
export type WorkflowEventRecord = z.infer<typeof WorkflowEventRecordSchema>

export const CreateWorkspaceInputSchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  workspaceType: WorkspaceTypeSchema.default('dev'),
})
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>

export const SendMessageInputSchema = z.object({
  workspaceId: z.string(),
  conversationId: z.string(),
  content: z.string().min(1),
  agentId: z.string().optional(),
  replyTo: ReplyReferenceSchema.optional(),
  codeSelection: CodeSelectionReferenceSchema.optional(),
})
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>

export const AppStateSchema = z.object({
  workspaces: z.array(WorkspaceSchema),
  conversations: z.array(ConversationSchema),
  messages: z.array(MessageSchema),
  agents: z.array(AgentDefinitionSchema),
  agentSessions: z.array(AgentSessionSchema),
  agentSessionMessages: z.array(AgentSessionMessageSchema),
  taskHandoffs: z.array(TaskHandoffSchema),
  agentRuns: z.array(AgentRunSchema),
  artifacts: z.array(ArtifactSchema),
  changeSets: z.array(ChangeSetSchema),
  contextSnapshots: z.array(ContextSnapshotSchema),
  workflowEvents: z.array(WorkflowEventRecordSchema),
  diagnosticLogs: z.array(DiagnosticLogSchema),
})
export type AppState = z.infer<typeof AppStateSchema>

/**
 * Returns the current wall-clock time as an ISO string.
 * Input: none. Output: UTC timestamp string.
 */
export function isoNow(): string {
  return new Date().toISOString()
}
