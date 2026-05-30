import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
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

/**
 * Creates a workspace record plus its default group conversation.
 * Input: workspace creation payload. Output: workspace and conversation records.
 */
function createWorkspaceRecords(input: z.infer<typeof CreateWorkspaceInputSchema>): {
  workspace: Workspace
  conversation: Conversation
} {
  const now = isoNow()
  const workspaceId = `ws-${randomUUID()}`
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

  const conversation: Conversation = {
    id: `conv-${randomUUID()}`,
    workspaceId,
    type: 'group',
    title: '项目主群聊',
    participants: ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer'],
    createdAt: now,
    updatedAt: now,
  }

  return { workspace, conversation }
}

/**
 * Creates a workspace-scoped custom agent from the user form payload.
 * Input: custom agent payload. Output: complete AgentDefinition.
 */
function createCustomAgent(input: z.infer<typeof CreateAgentInputSchema>): AgentDefinition {
  const now = isoNow()
  return {
    ...input,
    id: input.id ?? `agent-${randomUUID()}`,
    source: 'workspace',
    createdAt: now,
    updatedAt: now,
  }
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
 * Resolves a preview asset response and streams it through Fastify.
 * Input: runtime services, workspace id, preview path, and reply context. Output: HTTP reply.
 */
async function sendPreviewAsset(
  services: WorkflowServices,
  workspaceId: string,
  relativePath: string,
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

  app.post('/api/workspaces', async request => {
    const input = CreateWorkspaceInputSchema.parse(request.body)
    const created = createWorkspaceRecords(input)
    await services.runtime.prepareWorkspace(created.workspace)
    await services.store.update(state => {
      state.workspaces.push(created.workspace)
      state.conversations.push(created.conversation)
    })
    return services.store.read()
  })

  app.post('/api/conversations', async request => {
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
    await services.store.update(state => {
      if (!state.workspaces.some(workspace => workspace.id === input.workspaceId)) {
        throw new Error(`Workspace not found: ${input.workspaceId}`)
      }
      state.conversations.push(conversation)
    })
    return services.store.read()
  })

  app.post('/api/agents', async request => {
    const input = CreateAgentInputSchema.parse(request.body)
    const agent = createCustomAgent(input)
    await services.store.update(state => {
      state.agents.push(agent)
    })
    return services.store.read()
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
      await sendPreviewAsset(services, params.workspaceId, 'index.html', reply)
    } catch (error) {
      const safeError = error instanceof Error ? error.message : String(error)
      reply.status(safeError.includes('not found') || safeError.includes('ENOENT') ? 404 : 400)
      return reply.send({ error: safeError })
    }
  })

  app.get('/preview/:workspaceId/*', async (request, reply) => {
    const params = request.params as { workspaceId: string; '*': string }
    try {
      await sendPreviewAsset(services, params.workspaceId, params['*'] || 'index.html', reply)
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
