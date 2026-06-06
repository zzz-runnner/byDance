import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  AgentRoutingProfileSchema,
  AgentProviderSchema,
  CreateWorkspaceInputSchema,
  IsolationSchema,
  PermissionModeSchema,
  SendMessageInputSchema,
  isoNow,
  type AppState,
  type AgentDefinition,
  type Conversation,
  type WorkflowEvent,
  type WorkflowEventRecord,
  type Workspace,
} from '@shared/contracts'
import {
  createArtifactCreatedEvent,
  createZipArtifact,
  createZipReadyEvent,
} from './orchestrator/artifacts'
import { syncAgentDerivedTitles } from './agents/agent-presentation'
import {
  createDirectAgentInstance,
  createDefaultWorkspaceAgentMembers,
  createGroupAgentInstances,
  DIRECT_CHAT_AGENT_ORDER,
  ensureWorkspaceAgentMembers,
  resolveWorkspaceAgent,
  resolveWorkspaceAgents,
  syncWorkspaceGroupParticipants,
} from './agents/workspace-agents'
import { handleUserMessage, type WorkflowServices } from './orchestrator/workflow'

const CreateConversationInputSchema = z.object({
  workspaceId: z.string().min(1),
  type: z.enum(['group', 'direct']).default('group'),
  title: z.string().min(1),
  participants: z.array(z.string().min(1)).min(1),
})

const WorkspaceFileContentQuerySchema = z.object({
  path: z.string().min(1),
})

const WorkspaceOverviewBatchInputSchema = z.object({
  items: z.array(z.object({
    workspaceId: z.string().min(1),
    conversationType: z.enum(['group', 'direct']).optional(),
    targetAgentId: z.string().optional(),
  })).max(100),
})

const AgentParamsSchema = z.object({
  agentId: z.string().min(1),
})

const WorkspaceParamsSchema = z.object({
  workspaceId: z.string().min(1),
})

const WorkspaceAgentParamsSchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
})

const WorkspaceMessageParamsSchema = z.object({
  workspaceId: z.string().min(1),
  messageId: z.string().min(1),
})

const AgentContextPolicyInputSchema = z.object({
  includeProjectBrief: z.boolean(),
  includePinnedMessages: z.boolean(),
  recentMessageLimit: z.number().int().nonnegative(),
  includeSameConversationOnly: z.boolean(),
  includeArtifacts: z.boolean(),
  includeFileSummaries: z.boolean(),
  allowReadFilesOnDemand: z.boolean(),
})

const AgentPermissionsInputSchema = z.object({
  fileRead: z.boolean(),
  fileWrite: z.boolean(),
  shell: z.boolean(),
  webSearch: z.boolean(),
  webFetch: z.boolean(),
  deploy: z.boolean(),
})

const AgentRuntimePolicyInputSchema = z.object({
  workspaceOnly: z.boolean(),
  allowNetwork: z.boolean(),
  allowShell: z.boolean(),
  maxRunSeconds: z.number().int().positive(),
})

const CreateAgentInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  role: z.string().min(1).default('自定义 Agent'),
  description: z.string().min(1).default('用户自建 Agent'),
  whenToUse: z.string().min(1).default('当用户显式选择或 @ 到该 Agent 时调用。'),
  systemPrompt: z.string().min(1),
  modelProvider: AgentProviderSchema.default('claude'),
  model: z.string().optional(),
  contextPolicy: z
    .object({
      includeProjectBrief: z.boolean(),
      includePinnedMessages: z.boolean(),
      recentMessageLimit: z.number().int().nonnegative(),
      includeSameConversationOnly: z.boolean(),
      includeArtifacts: z.boolean(),
      includeFileSummaries: z.boolean(),
      allowReadFilesOnDemand: z.boolean(),
    })
    .default({
      includeProjectBrief: true,
      includePinnedMessages: true,
      recentMessageLimit: 10,
      includeSameConversationOnly: false,
      includeArtifacts: true,
      includeFileSummaries: true,
      allowReadFilesOnDemand: false,
    }),
  tools: z.array(z.string()).default(['readContext']),
  permissions: z
    .object({
      fileRead: z.boolean(),
      fileWrite: z.boolean(),
      shell: z.boolean(),
      webSearch: z.boolean(),
      webFetch: z.boolean(),
      deploy: z.boolean(),
    })
    .default({
      fileRead: true,
      fileWrite: false,
      shell: false,
      webSearch: false,
      webFetch: false,
      deploy: false,
    }),
  disallowedTools: z.array(z.string()).optional(),
  permissionMode: PermissionModeSchema.default('readonly'),
  runtimePolicy: z
    .object({
      workspaceOnly: z.boolean(),
      allowNetwork: z.boolean(),
      allowShell: z.boolean(),
      maxRunSeconds: z.number().int().positive(),
    })
    .default({
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: false,
      maxRunSeconds: 90,
    }),
  outputSchema: z.string().min(1).default('Return a concise task result and next steps.'),
  isolation: IsolationSchema.default('shared'),
  skills: z.array(z.string()).default([]),
})

const UpdateAgentInputSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  whenToUse: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  modelProvider: AgentProviderSchema.optional(),
  model: z.string().min(1).optional(),
  contextPolicy: AgentContextPolicyInputSchema.optional(),
  tools: z.array(z.string()).optional(),
  permissions: AgentPermissionsInputSchema.optional(),
  disallowedTools: z.array(z.string()).optional(),
  permissionMode: PermissionModeSchema.optional(),
  runtimePolicy: AgentRuntimePolicyInputSchema.optional(),
  outputSchema: z.string().min(1).optional(),
  isolation: IsolationSchema.optional(),
  skills: z.array(z.string()).optional(),
  routingProfile: AgentRoutingProfileSchema.optional(),
})

type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>

const AGENT_UPDATE_FIELDS = [
  'name',
  'modelProvider',
  'model',
  'role',
  'description',
  'whenToUse',
  'systemPrompt',
  'contextPolicy',
  'tools',
  'permissions',
  'disallowedTools',
  'permissionMode',
  'runtimePolicy',
  'outputSchema',
  'isolation',
  'skills',
  'routingProfile',
] satisfies Array<keyof UpdateAgentInput>

const BUILT_IN_AGENT_UPDATE_FIELDS = AGENT_UPDATE_FIELDS
const CUSTOM_AGENT_UPDATE_FIELDS = AGENT_UPDATE_FIELDS

const DIRECT_CHAT_AGENT_IDS = new Set<string>(DIRECT_CHAT_AGENT_ORDER)

/**
 * Creates a workspace record plus its default group conversation.
 * Input: workspace creation payload. Output: workspace and conversation records.
 */
function createWorkspaceRecords(
  input: z.infer<typeof CreateWorkspaceInputSchema>,
): {
  workspace: Workspace
  conversation?: Conversation
  agents: AgentDefinition[]
  workspaceAgentMembers: AppState['workspaceAgentMembers']
} {
  const now = isoNow()
  const workspaceId = `ws-${randomUUID()}`
  const conversationId = `conv-${randomUUID()}`
  const agents = input.workspaceType === 'chat' ? [] : createGroupAgentInstances(workspaceId, conversationId, now)
  const workspaceAgentMembers = input.workspaceType === 'chat'
    ? []
    : createDefaultWorkspaceAgentMembers(agents, workspaceId, now)
  const workspace: Workspace = {
    id: workspaceId,
    name: input.name,
    goal: input.goal,
    workspaceType: input.workspaceType,
    rootPath: `data/workspaces/${workspaceId}/repo`,
    runtimeType: 'local',
    runtimeStatus: 'ready',
    projectBrief: input.goal,
    pinnedMessageIds: [],
    createdAt: now,
    updatedAt: now,
  }

  const conversation: Conversation | undefined = input.workspaceType === 'chat'
    ? undefined
    : {
        id: conversationId,
        workspaceId,
        type: 'group',
        title: '项目主群聊',
        participants: ['user', ...workspaceAgentMembers.filter(member => member.enabled).map(member => member.agentId)],
        createdAt: now,
        updatedAt: now,
      }

  return { workspace, conversation, agents, workspaceAgentMembers }
}

/**
 * Creates a workspace-scoped custom agent from the user form payload.
 * Input: custom agent payload. Output: complete AgentDefinition.
 */
function createCustomAgent(
  input: z.infer<typeof CreateAgentInputSchema>,
  workspaceId: string,
  conversationId: string,
): AgentDefinition {
  const now = isoNow()
  return {
    ...input,
    id: input.id ?? `agent-${randomUUID()}`,
    source: 'workspace',
    workspaceId,
    conversationId,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Returns whether one participant list represents one allowed direct-chat target.
 * Input: current state and participants. Output: true when exactly one dedicated built-in direct agent is selected.
 */
function isAllowedDirectConversationTarget(state: AppState, participants: string[]): boolean {
  if (!participants.includes('user')) {
    return false
  }

  const targetAgentIds = participants.filter(participant => participant !== 'user')
  if (targetAgentIds.length !== 1) {
    return false
  }

  return DIRECT_CHAT_AGENT_IDS.has(targetAgentIds[0])
}

/**
 * Returns whether a workspace uses the direct-chat shape.
 * Input: one workspace record. Output: true for single-agent chat workspaces.
 */
function isDirectChatWorkspace(workspace: Workspace): boolean {
  return workspace.workspaceType === 'chat'
}

/**
 * Applies one editable-field patch without changing ids, source, or timestamps outside updatedAt.
 * Input: existing agent definition and validated update payload.
 * Output: the same agent object after applying allowed fields.
 */
function updateAgentDefinition(agent: AgentDefinition, input: UpdateAgentInput): AgentDefinition {
  const allowedFields = agent.source === 'built-in' ? BUILT_IN_AGENT_UPDATE_FIELDS : CUSTOM_AGENT_UPDATE_FIELDS
  const mutableAgent = agent as unknown as Record<string, unknown>
  for (const field of allowedFields) {
    const value = input[field]
    if (value !== undefined) {
      mutableAgent[field] = value
    }
  }
  agent.updatedAt = isoNow()
  return agent
}

/**
 * Applies a workspace-scoped agent update and returns the resolved agent view.
 * Input: mutable state, workspace id, agent id, and validated update payload.
 * Output: updated workspace-visible agent or undefined when not found.
 */
function updateWorkspaceAgentDefinition(
  state: AppState,
  workspaceId: string,
  agentId: string,
  input: UpdateAgentInput,
): AgentDefinition | undefined {
  ensureWorkspaceAgentMembers(state, workspaceId)
  const currentAgent = resolveWorkspaceAgent(state, workspaceId, agentId)
  if (!currentAgent) {
    return undefined
  }

  const previousAgent = {
    id: currentAgent.id,
    name: currentAgent.name,
  }

  if (currentAgent.source === 'built-in') {
    const agent = state.agents.find(candidate =>
      candidate.id === agentId &&
      candidate.workspaceId === workspaceId &&
      candidate.source === 'built-in',
    )
    if (!agent) {
      return undefined
    }

    const updatedAgent = updateAgentDefinition(agent, input)
    const member = state.workspaceAgentMembers.find(item =>
      item.workspaceId === workspaceId && item.agentId === agentId,
    )
    if (member) {
      member.displayName = updatedAgent.name
      member.modelProviderOverride = updatedAgent.modelProvider
      member.modelOverride = updatedAgent.model
      member.updatedAt = updatedAgent.updatedAt
    }
    const resolvedAgent = resolveWorkspaceAgent(state, workspaceId, agentId) ?? updatedAgent
    syncAgentDerivedTitles(state, previousAgent, resolvedAgent, resolvedAgent.updatedAt, workspaceId)
    return resolvedAgent
  }

  const agent = state.agents.find(candidate => candidate.id === agentId && candidate.workspaceId === workspaceId)
  if (!agent) {
    return undefined
  }

  const updatedAgent = updateAgentDefinition(agent, input)
  syncAgentDerivedTitles(state, previousAgent, updatedAgent, updatedAgent.updatedAt, workspaceId)
  return updatedAgent
}

/**
 * Writes one AgentHub workflow event as a Server-Sent Events frame.
 * Input: raw HTTP response and workflow event. Output: bytes written to the response.
 */
function writeSseEvent(response: NodeJS.WritableStream, event: WorkflowEvent): void {
  response.write(`event: ${event.type}\n`)
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

/**
 * Writes one SSE error frame without exposing stack traces.
 * Input: raw HTTP response and unknown error. Output: bytes written to the response.
 */
function writeSseError(response: NodeJS.WritableStream, error: unknown): void {
  const safeError = error instanceof Error ? error.message : String(error)
  response.write('event: error\n')
  response.write(`data: ${JSON.stringify({ error: safeError })}\n\n`)
}

/**
 * Creates a workflow event record for direct store writes outside a turn.
 * Input: workflow event payload. Output: persisted workflow event record.
 */
function createWorkflowEventRecord(event: WorkflowEvent): WorkflowEventRecord {
  return {
    id: `workflow-event-${randomUUID()}`,
    workspaceId: event.workspaceId,
    conversationId: event.conversationId,
    event,
    createdAt: isoNow(),
  }
}

/**
 * Picks the primary group conversation for a workspace, then falls back to the most recent one.
 * Input: application state and workspace id. Output: matching conversation or undefined.
 */
function selectWorkspaceConversation(state: AppState, workspaceId: string): Conversation | undefined {
  const conversations = [...state.conversations]
    .filter(conversation => conversation.workspaceId === workspaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return conversations.find(conversation => conversation.type === 'group') ?? conversations[0]
}

/**
 * Selects the conversation that should back one workspace overview item.
 * Input: application state, workspace id, preferred type, and optional target agent.
 * Output: matching conversation or the latest workspace fallback.
 */
function selectProjectConversation(
  state: AppState,
  workspaceId: string,
  conversationType: 'group' | 'direct',
  targetAgentId?: string,
): Conversation | undefined {
  const workspaceConversations = [...state.conversations]
    .filter(conversation => conversation.workspaceId === workspaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  if (conversationType === 'direct') {
    return (
      workspaceConversations.find(
        conversation =>
          conversation.type === 'direct' &&
          (!targetAgentId || conversation.participants.includes(targetAgentId)),
      ) ??
      workspaceConversations.find(conversation => conversation.type === 'direct') ??
      workspaceConversations[0]
    )
  }

  return workspaceConversations.find(conversation => conversation.type === 'group') ?? workspaceConversations[0]
}

/**
 * Converts the latest persisted workflow record into one short room summary label.
 * Input: optional persisted workflow event record.
 * Output: localized one-line activity label.
 */
function latestEventLabel(record: AppState['workflowEvents'][number] | undefined): string {
  const eventType = typeof record?.event?.type === 'string' ? record.event.type : ''

  switch (eventType) {
    case 'turn_started':
      return '用户发起了新任务'
    case 'routing_finished':
      return '主脑完成了本轮路由'
    case 'assistant_message_started':
      return 'Agent 开始回复'
    case 'assistant_message_finished':
      return 'Agent 回复完成'
    case 'preview_ready':
      return '网页预览已准备好'
    case 'change_set_created':
      return '生成了新的代码 Diff'
    case 'workflow_finished':
      return '本轮任务已完成'
    case 'agent_progress':
      return 'Agent 正在持续执行'
    default:
      return '暂无新事件'
  }
}

/**
 * Builds one batch of workspace overview rooms for the requested project mappings.
 * Input: application state and requested workspace mappings. Output: room summaries keyed by workspace scope.
 */
function buildWorkspaceOverviewBatch(
  state: AppState,
  items: Array<{
    workspaceId: string
    conversationType?: 'group' | 'direct'
    targetAgentId?: string
  }>,
) {
  return items.flatMap(item => {
    const workspace = state.workspaces.find(candidate => candidate.id === item.workspaceId)
    const conversation = selectProjectConversation(
      state,
      item.workspaceId,
      item.conversationType ?? 'group',
      item.targetAgentId,
    )

    if (!workspace || !conversation) {
      return []
    }

    const participantAgentIds = conversation.participants.filter(participant => participant !== 'user')
    const latestEvent = state.workflowEvents
      .filter(record => record.workspaceId === workspace.id && record.conversationId === conversation.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    const latestMessage = state.messages
      .filter(message => message.conversationId === conversation.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    const artifactCount = state.artifacts.filter(artifact => artifact.workspaceId === workspace.id).length
    const runningAgents = state.agentRuns.filter(
      run => run.workspaceId === workspace.id && run.conversationId === conversation.id && run.status === 'running',
    ).length
    const messageCount = state.messages.filter(message => message.conversationId === conversation.id).length
    const lastActivityAt = [workspace.updatedAt, conversation.updatedAt, latestEvent?.createdAt, latestMessage?.createdAt]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? conversation.updatedAt

    return [{
      id: workspace.id,
      kind: conversation.type,
      title: conversation.type === 'group' ? workspace.name : conversation.title,
      subtitle: conversation.type === 'group' ? workspace.goal : `${workspace.name} / ${workspace.goal}`,
      workspace,
      conversation,
      targetAgentId: conversation.type === 'direct' ? participantAgentIds[0] : item.targetAgentId,
      participantAgentIds,
      signal: {
        runningAgents,
        latestEventLabel: latestEventLabel(latestEvent),
        artifactCount,
        messageCount,
      },
      lastActivityAt,
    }]
  })
}

/**
 * Resolves a preview asset response and streams it through Fastify.
 * Input: runtime services, workspace id, optional preview path, and reply context. Output: HTTP reply.
 */
async function sendPreviewAsset(
  services: WorkflowServices,
  workspaceId: string,
  relativePath: string | undefined,
  reply: FastifyReply,
): Promise<void> {
  const asset = await services.runtime.openPreviewAsset(workspaceId, relativePath)
  reply.type(asset.contentType)
  reply.header('Cache-Control', 'no-cache')
  await reply.send(asset.stream)
}

/**
 * Registers all HTTP routes for the local AgentHub API.
 * Input: Fastify instance and workflow services. Output: promise resolved after route registration.
 */
export async function registerRoutes(app: FastifyInstance, services: WorkflowServices): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    storage: services.store.mode,
    realAgents: services.env.AGENTHUB_REAL_AGENTS,
  }))

  app.get('/api/state', async () => services.store.read())

  app.get('/api/agents', async (_request, reply) => {
    reply.status(400)
    return reply.send({ error: 'Global agents are not supported. Use /api/workspaces/:workspaceId/agents.' })
  })

  app.get('/api/agents/:agentId', async (request, reply) => {
    const params = AgentParamsSchema.parse(request.params)
    reply.status(400)
    return reply.send({ error: `Global agent lookup is not supported: ${params.agentId}` })
  })

  app.post('/api/workspaces/overview-batch', async request => {
    const input = WorkspaceOverviewBatchInputSchema.parse(request.body)
    const state = await services.store.read()
    return {
      rooms: buildWorkspaceOverviewBatch(state, input.items),
    }
  })

  app.get('/api/workspaces/:workspaceId/files', async (request, reply) => {
    const params = request.params as { workspaceId: string }
    const state = await services.store.read()
    const workspace = state.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }

    await services.runtime.prepareWorkspace(workspace)
    return {
      entries: await services.runtime.listWorkspaceFiles(workspace.id),
    }
  })

  app.get('/api/workspaces/:workspaceId/files/content', async (request, reply) => {
    const params = request.params as { workspaceId: string }
    const query = WorkspaceFileContentQuerySchema.parse(request.query)
    const state = await services.store.read()
    const workspace = state.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }

    try {
      await services.runtime.prepareWorkspace(workspace)
      return await services.runtime.readWorkspaceTextFile(workspace.id, query.path)
    } catch (error) {
      const safeError = error instanceof Error ? error.message : String(error)
      reply.status(safeError.includes('ENOENT') ? 404 : 400)
      return reply.send({ error: safeError })
    }
  })

  app.get('/api/workspaces/:workspaceId/diff', async (request, reply) => {
    const params = request.params as { workspaceId: string }
    const state = await services.store.read()
    const workspace = state.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }

    await services.runtime.prepareWorkspace(workspace)
    return services.runtime.getWorkspaceDiff(workspace.id)
  })

  app.get('/api/workspaces/:workspaceId/preview-targets', async (request, reply) => {
    const params = request.params as { workspaceId: string }
    const state = await services.store.read()
    const workspace = state.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }

    await services.runtime.prepareWorkspace(workspace)
    const targets = await services.runtime.listPreviewTargets(workspace.id)
    return {
      targets,
      defaultTarget: targets[0],
    }
  })

  app.post('/api/workspaces', async request => {
    const input = CreateWorkspaceInputSchema.parse(request.body)
    const created = createWorkspaceRecords(input)
    await services.runtime.prepareWorkspace(created.workspace)
    await services.store.update(state => {
      state.workspaces.push(created.workspace)
      if (created.conversation) {
        state.conversations.push(created.conversation)
      }
      state.agents.push(...created.agents)
      state.workspaceAgentMembers.push(...created.workspaceAgentMembers)
    })
    return services.store.read()
  })

  app.delete('/api/workspaces/:workspaceId', async (request, reply) => {
    const params = WorkspaceParamsSchema.parse(request.params)
    const currentState = await services.store.read()
    if (!currentState.workspaces.some(workspace => workspace.id === params.workspaceId)) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }

    await services.store.update(state => {
      state.workspaces = state.workspaces.filter(workspace => workspace.id !== params.workspaceId)
      state.conversations = state.conversations.filter(conversation => conversation.workspaceId !== params.workspaceId)
      state.messages = state.messages.filter(message => message.workspaceId !== params.workspaceId)
      state.agents = state.agents.filter(agent => agent.workspaceId !== params.workspaceId)
      state.workspaceAgentMembers = state.workspaceAgentMembers.filter(member => member.workspaceId !== params.workspaceId)
      state.agentSessions = state.agentSessions.filter(session => session.workspaceId !== params.workspaceId)
      state.agentSessionMessages = state.agentSessionMessages.filter(message => message.workspaceId !== params.workspaceId)
      state.taskHandoffs = state.taskHandoffs.filter(handoff => handoff.workspaceId !== params.workspaceId)
      state.agentRuns = state.agentRuns.filter(run => run.workspaceId !== params.workspaceId)
      state.artifacts = state.artifacts.filter(artifact => artifact.workspaceId !== params.workspaceId)
      state.changeSets = state.changeSets.filter(changeSet => changeSet.workspaceId !== params.workspaceId)
      state.contextSnapshots = state.contextSnapshots.filter(snapshot => snapshot.workspaceId !== params.workspaceId)
      state.workflowEvents = state.workflowEvents.filter(event => event.workspaceId !== params.workspaceId)
      state.diagnosticLogs = state.diagnosticLogs.filter(log => log.workspaceId !== params.workspaceId)
    })
    await services.runtime.deleteWorkspace(params.workspaceId)

    return {
      deleted: true,
      workspaceId: params.workspaceId,
    }
  })

  app.get('/api/workspaces/:workspaceId/agents', async (request, reply) => {
    const params = WorkspaceParamsSchema.parse(request.params)
    const state = await services.store.read()
    if (!state.workspaces.some(workspace => workspace.id === params.workspaceId)) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }
    return resolveWorkspaceAgents(state, params.workspaceId)
  })

  app.get('/api/workspaces/:workspaceId/agents/:agentId', async (request, reply) => {
    const params = WorkspaceAgentParamsSchema.parse(request.params)
    const state = await services.store.read()
    if (!state.workspaces.some(workspace => workspace.id === params.workspaceId)) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }
    const agent = resolveWorkspaceAgent(state, params.workspaceId, params.agentId)
    if (!agent) {
      reply.status(404)
      return reply.send({ error: `Agent not found in workspace: ${params.agentId}` })
    }
    return agent
  })

  app.put('/api/workspaces/:workspaceId/messages/:messageId/pin', async (request, reply) => {
    const params = WorkspaceMessageParamsSchema.parse(request.params)
    const currentState = await services.store.read()
    const workspace = currentState.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }
    if (!currentState.messages.some(message => message.workspaceId === params.workspaceId && message.id === params.messageId)) {
      reply.status(404)
      return reply.send({ error: `Message not found in workspace: ${params.messageId}` })
    }

    return services.store.update(state => {
      const targetWorkspace = state.workspaces.find(item => item.id === params.workspaceId)
      if (!targetWorkspace) {
        throw new Error(`Workspace not found: ${params.workspaceId}`)
      }
      if (!targetWorkspace.pinnedMessageIds.includes(params.messageId)) {
        targetWorkspace.pinnedMessageIds.push(params.messageId)
      }
      targetWorkspace.updatedAt = isoNow()
      return {
        workspaceId: targetWorkspace.id,
        messageId: params.messageId,
        pinnedMessageIds: [...targetWorkspace.pinnedMessageIds],
      }
    })
  })

  app.delete('/api/workspaces/:workspaceId/messages/:messageId/pin', async (request, reply) => {
    const params = WorkspaceMessageParamsSchema.parse(request.params)
    const currentState = await services.store.read()
    const workspace = currentState.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }

    return services.store.update(state => {
      const targetWorkspace = state.workspaces.find(item => item.id === params.workspaceId)
      if (!targetWorkspace) {
        throw new Error(`Workspace not found: ${params.workspaceId}`)
      }
      targetWorkspace.pinnedMessageIds = targetWorkspace.pinnedMessageIds.filter(messageId => messageId !== params.messageId)
      targetWorkspace.updatedAt = isoNow()
      return {
        workspaceId: targetWorkspace.id,
        messageId: params.messageId,
        pinnedMessageIds: [...targetWorkspace.pinnedMessageIds],
      }
    })
  })

  app.post('/api/conversations', async (request, reply) => {
    const input = CreateConversationInputSchema.parse(request.body)
    const now = isoNow()
    const conversation: Conversation = {
      id: `conv-${randomUUID()}`,
      workspaceId: input.workspaceId,
      type: input.type,
      title: input.title,
      participants: input.participants,
      createdAt: now,
      updatedAt: now,
    }
    const currentState = await services.store.read()
    if (!currentState.workspaces.some(workspace => workspace.id === input.workspaceId)) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${input.workspaceId}` })
    }
    const workspace = currentState.workspaces.find(item => item.id === input.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${input.workspaceId}` })
    }
    if (input.type === 'direct' && !isDirectChatWorkspace(workspace)) {
      reply.status(400)
      return reply.send({ error: 'Direct conversations can only be created inside single-chat workspaces.' })
    }
    if (input.type === 'group' && isDirectChatWorkspace(workspace)) {
      reply.status(400)
      return reply.send({ error: 'Single-chat workspaces do not support group conversations.' })
    }
    if (input.type === 'direct' && !isAllowedDirectConversationTarget(currentState, input.participants)) {
      reply.status(400)
      return reply.send({ error: 'Direct conversations can only target built-in Claude Code or Codex direct agents.' })
    }
    await services.store.update(state => {
      state.conversations.push(conversation)
      if (conversation.type === 'direct') {
        const directAgentId = conversation.participants.find(participant => participant !== 'user')
        if (directAgentId) {
          state.agents.push(createDirectAgentInstance(
            directAgentId as typeof DIRECT_CHAT_AGENT_ORDER[number],
            conversation.workspaceId,
            conversation.id,
            conversation.createdAt,
          ))
        }
        ensureWorkspaceAgentMembers(state, conversation.workspaceId, conversation.createdAt)
      }
    })
    return services.store.read()
  })

  app.post('/api/workspaces/:workspaceId/agents', async (request, reply) => {
    const params = WorkspaceParamsSchema.parse(request.params)
    const input = CreateAgentInputSchema.parse(request.body)
    const currentState = await services.store.read()
    const workspace = currentState.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }
    if (workspace.workspaceType === 'chat') {
      reply.status(400)
      return reply.send({ error: 'Custom child agents can only be added to group workspaces.' })
    }
    const groupConversation = currentState.conversations.find(
      conversation => conversation.workspaceId === params.workspaceId && conversation.type === 'group',
    )
    if (!groupConversation) {
      reply.status(400)
      return reply.send({ error: 'Custom child agents require a group conversation.' })
    }
    const requestedId = input.id?.trim()
    if (
      requestedId &&
      currentState.agents.some(agent =>
        agent.id === requestedId &&
        agent.workspaceId === params.workspaceId &&
        agent.conversationId === groupConversation.id,
      )
    ) {
      reply.status(400)
      return reply.send({ error: `Agent already exists: ${requestedId}` })
    }
    const created = await services.store.update(state => {
      const agent = createCustomAgent(input, params.workspaceId, groupConversation.id)
      if (state.agents.some(item =>
        item.id === agent.id &&
        item.workspaceId === params.workspaceId &&
        item.conversationId === groupConversation.id,
      )) {
        throw new Error(`Agent already exists: ${agent.id}`)
      }
      state.agents.push(agent)
      syncWorkspaceGroupParticipants(state, params.workspaceId, agent.updatedAt)
      return agent
    })
    return created
  })

  app.patch('/api/workspaces/:workspaceId/agents/:agentId', async (request, reply) => {
    const params = WorkspaceAgentParamsSchema.parse(request.params)
    const input = UpdateAgentInputSchema.parse(request.body)
    const currentState = await services.store.read()
    if (!currentState.workspaces.some(workspace => workspace.id === params.workspaceId)) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }
    const updated = await services.store.update(state =>
      updateWorkspaceAgentDefinition(state, params.workspaceId, params.agentId, input),
    )
    if (!updated) {
      reply.status(404)
      return reply.send({ error: `Agent not found in workspace: ${params.agentId}` })
    }
    return updated
  })

  app.delete('/api/workspaces/:workspaceId/agents/:agentId', async (request, reply) => {
    const params = WorkspaceAgentParamsSchema.parse(request.params)
    const currentState = await services.store.read()
    if (!currentState.workspaces.some(workspace => workspace.id === params.workspaceId)) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }
    const currentAgent = resolveWorkspaceAgent(currentState, params.workspaceId, params.agentId)
    if (!currentAgent) {
      reply.status(404)
      return reply.send({ error: `Agent not found in workspace: ${params.agentId}` })
    }
    if (currentAgent.source === 'built-in') {
      reply.status(400)
      return reply.send({ error: `Built-in agent cannot be deleted: ${params.agentId}` })
    }
    const deleted = await services.store.update(state => {
      const previousLength = state.agents.length
      state.agents = state.agents.filter(
        agent => !(agent.id === params.agentId && agent.workspaceId === params.workspaceId),
      )
      syncWorkspaceGroupParticipants(state, params.workspaceId)
      return state.agents.length !== previousLength
    })
    if (!deleted) {
      reply.status(404)
      return reply.send({ error: `Agent not found in workspace: ${params.agentId}` })
    }
    return {
      deleted: true,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
    }
  })

  app.post('/api/agents', async (_request, reply) => {
    reply.status(400)
    return reply.send({ error: 'Use /api/workspaces/:workspaceId/agents to create workspace-scoped agents.' })
  })

  app.patch('/api/agents/:agentId', async (_request, reply) => {
    reply.status(400)
    return reply.send({ error: 'Use /api/workspaces/:workspaceId/agents/:agentId to update workspace-scoped agents.' })
  })

  app.delete('/api/agents/:agentId', async (_request, reply) => {
    reply.status(400)
    return reply.send({ error: 'Use /api/workspaces/:workspaceId/agents/:agentId to delete workspace-scoped agents.' })
  })

  app.post('/api/messages', async request => {
    const input = SendMessageInputSchema.parse(request.body)
    return handleUserMessage(input, services)
  })

  app.post('/api/messages/stream', async (request, reply) => {
    const input = SendMessageInputSchema.parse(request.body)
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    try {
      await handleUserMessage(input, {
        ...services,
        eventSink: event => writeSseEvent(reply.raw, event),
      })
    } catch (error) {
      writeSseError(reply.raw, error)
    } finally {
      reply.raw.end()
    }
  })

  app.get('/preview/:workspaceId', async (request, reply) => {
    const params = request.params as { workspaceId: string }
    try {
      await sendPreviewAsset(services, params.workspaceId, undefined, reply)
    } catch (error) {
      const safeError = error instanceof Error ? error.message : String(error)
      reply.status(safeError.includes('not found') || safeError.includes('ENOENT') ? 404 : 400)
      return reply.send({ error: safeError })
    }
  })

  app.get('/preview/:workspaceId/*', async (request, reply) => {
    const params = request.params as { workspaceId: string; '*': string }
    try {
      await sendPreviewAsset(services, params.workspaceId, params['*'] || undefined, reply)
    } catch (error) {
      const safeError = error instanceof Error ? error.message : String(error)
      reply.status(safeError.includes('not found') || safeError.includes('ENOENT') ? 404 : 400)
      return reply.send({ error: safeError })
    }
  })

  app.get('/api/workspaces/:workspaceId/zip', async (request, reply) => {
    const params = request.params as { workspaceId: string }
    const state = await services.store.read()
    const workspace = state.workspaces.find(item => item.id === params.workspaceId)
    if (!workspace) {
      reply.status(404)
      return reply.send({ error: `Workspace not found: ${params.workspaceId}` })
    }

    const conversation = selectWorkspaceConversation(state, workspace.id)
    if (!conversation) {
      reply.status(404)
      return reply.send({ error: `Conversation not found for workspace: ${workspace.id}` })
    }

    await services.runtime.prepareWorkspace(workspace)
    const archive = await services.runtime.buildWorkspaceZip(workspace.id)
    const zipUrl = `/api/workspaces/${workspace.id}/zip`
    const artifact = createZipArtifact(workspace.id, zipUrl, archive.fileCount, archive.byteLength)
    const artifactEvent = createArtifactCreatedEvent(workspace.id, conversation.id, artifact)
    const zipEvent = createZipReadyEvent(workspace.id, conversation.id, artifact, archive.fileCount, archive.byteLength)

    await services.store.update(nextState => {
      nextState.artifacts.push(artifact)
      nextState.workflowEvents.push(createWorkflowEventRecord(artifactEvent))
      nextState.workflowEvents.push(createWorkflowEventRecord(zipEvent))
    })

    reply.type('application/zip')
    reply.header('Content-Disposition', `attachment; filename="${workspace.id}.zip"`)
    reply.header('Cache-Control', 'no-cache')
    return reply.send(archive.buffer)
  })
}
