import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { z } from 'zod'
import type { AppConfig } from './config.js'
import { AgentHubClient } from './agenthub-client.js'
import { ProjectStore } from './project-store.js'
import { sendBufferedUpstreamResponse, sendSseUpstreamResponse } from './sse-proxy.js'
import {
  previewUrlFor,
  selectProjectConversation,
  selectProjectState,
  toProjectResponse,
  zipUrlFor,
} from './state-bridge.js'
import type {
  ConversationType,
  CreateProjectInput,
  RuntimeAgent,
  RuntimeAppState,
  StreamProjectMessageInput,
  StoredProjectRecord,
  WorkspaceType,
} from './types.js'

const CreateProjectInputSchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  workspaceType: z.enum(['dev', 'research', 'writing', 'chat']).default('dev'),
  conversationType: z.enum(['group', 'direct']).optional(),
  agentIds: z.array(z.string()).optional(),
})

const StreamProjectMessageInputSchema = z.object({
  content: z.string().min(1),
  conversationId: z.string().optional(),
  agentId: z.string().optional(),
})

type HttpError = Error & {
  statusCode?: number
}

/**
 * Creates the locateBackend Fastify server and registers all proxy routes.
 * Input: application config.
 * Output: configured Fastify instance.
 */
export function createServer(config: AppConfig) {
  const app = Fastify({
    logger: true,
  })

  const agentHub = new AgentHubClient(config.agentHubBaseUrl)
  const projectStore = new ProjectStore(config.projectsFilePath)

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as HttpError).statusCode ?? 500
    const message = error instanceof Error ? error.message : String(error)
    reply.code(statusCode).send({
      error: message,
    })
  })

  app.get('/api/health', async () => {
    const agentHubHealth = await agentHub.health()
    return {
      ok: true,
      service: 'locate-backend',
      agentHubBaseUrl: config.agentHubBaseUrl,
      dataFilePath: config.projectsFilePath,
      agentHub: agentHubHealth,
    }
  })

  app.get('/api/projects', async () => {
    const projects = await projectStore.listProjects()
    return projects.map(project => toProjectResponse(project))
  })

  app.get('/api/projects/:projectId', async request => {
    const { projectId } = request.params as { projectId: string }
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    return toProjectResponse(project)
  })

  app.get('/api/agents', async () => {
    const state = await agentHub.fetchState()
    return state.agents
  })

  app.post('/api/projects', async request => {
    const input = CreateProjectInputSchema.parse(request.body) as CreateProjectInput
    const conversationType = resolveConversationType(input)
    const directAgentId = resolveDirectAgentId(input)
    let state = await agentHub.createWorkspace({
      name: input.name,
      goal: input.goal,
      workspaceType: normalizeWorkspaceType(input.workspaceType, conversationType),
    })
    const workspace = selectLatestWorkspace(state.workspaces, input.name)

    if (!workspace) {
      throw createHttpError(502, 'AgentHub did not return a workspace after creation.')
    }

    if (conversationType === 'direct' && directAgentId) {
      const directAgent = requireAgent(state, directAgentId)
      state = await agentHub.createConversation(
        buildDirectConversationInput(workspace.id, directAgent),
      )
    }

    const conversation = selectProjectConversation(
      state.conversations,
      workspace.id,
      conversationType,
      directAgentId,
    )

    if (!conversation) {
      throw createHttpError(502, `AgentHub did not create a conversation for workspace ${workspace.id}.`)
    }

    const project = await projectStore.upsertProject(
      createStoredProjectRecord({
        workspaceId: workspace.id,
        name: workspace.name,
        goal: workspace.goal,
        conversationId: conversation.id,
        conversationType,
        targetAgentId: directAgentId,
      }),
    )

    return toProjectResponse(project)
  })

  app.get('/api/projects/:projectId/state', async request => {
    const { projectId } = request.params as { projectId: string }
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    const state = await agentHub.fetchState()
    return selectProjectState(state, project)
  })

  app.post('/api/projects/:projectId/messages/stream', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const input = StreamProjectMessageInputSchema.parse(request.body) as StreamProjectMessageInput
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    const upstream = await agentHub.streamMessage({
      workspaceId: project.workspaceId,
      conversationId: input.conversationId ?? project.conversationId,
      content: input.content,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    })

    await sendSseUpstreamResponse(reply, upstream)
  })

  app.get('/api/workspaces/:workspaceId/zip', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const upstream = await agentHub.proxy(`/api/workspaces/${encodeURIComponent(workspaceId)}/zip`)
    await sendBufferedUpstreamResponse(reply, upstream)
  })

  app.get('/preview/*', async (request, reply) => {
    const params = request.params as { '*': string }
    const suffix = params['*'] ?? ''
    const pathname = suffix ? `/preview/${suffix}` : '/preview'
    const upstream = await agentHub.proxy(pathname)
    await sendBufferedUpstreamResponse(reply, upstream)
  })

  app.all('/build-preview/*', async (_request, reply) => {
    reply.code(404).send({
      error: 'build-preview is not implemented in locateBackend yet.',
    })
  })

  app.all('/deploy/*', async (_request, reply) => {
    reply.code(404).send({
      error: 'deploy is not implemented in locateBackend yet.',
    })
  })

  app.get('/', async () => ({
    ok: true,
    service: 'locate-backend',
    previewPathExample: previewUrlFor('workspace-id'),
    zipPathExample: zipUrlFor('workspace-id'),
  }))

  return app
}

/**
 * Creates one HTTP error object with an attached status code.
 * Input: HTTP status code and human-readable message.
 * Output: error instance understood by the Fastify error handler.
 */
function createHttpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode })
}

/**
 * Resolves the requested project conversation type.
 * Input: raw project creation input.
 * Output: normalized group or direct conversation type.
 */
function resolveConversationType(input: CreateProjectInput): ConversationType {
  return input.conversationType === 'direct' ? 'direct' : 'group'
}

/**
 * Normalizes the runtime workspace type for group and direct rooms.
 * Input: requested workspace type and normalized conversation type.
 * Output: runtime workspace type expected by the frontend.
 */
function normalizeWorkspaceType(
  value: WorkspaceType,
  conversationType: ConversationType,
): WorkspaceType {
  return conversationType === 'direct' ? 'chat' : value
}

/**
 * Resolves the target agent id for one direct room request.
 * Input: raw project creation input.
 * Output: direct target agent id or undefined for group rooms.
 */
function resolveDirectAgentId(input: CreateProjectInput): string | undefined {
  if (input.conversationType !== 'direct') {
    return undefined
  }

  return input.agentIds?.find(Boolean) ?? 'engineer'
}

/**
 * Ensures the requested direct agent exists in the runtime agent list.
 * Input: runtime state and requested direct agent id.
 * Output: matching runtime agent definition.
 */
function requireAgent(state: RuntimeAppState, agentId: string): RuntimeAgent {
  const agent = state.agents.find(candidate => candidate.id === agentId)

  if (!agent) {
    throw createHttpError(400, `Unknown direct agent: ${agentId}`)
  }

  return agent
}

/**
 * Builds the AgentHub direct conversation payload for one target agent.
 * Input: workspace id and target agent definition.
 * Output: AgentHub conversation creation payload.
 */
function buildDirectConversationInput(workspaceId: string, agent: RuntimeAgent) {
  const agentName = agent.name ?? agent.id

  return {
    workspaceId,
    type: 'direct' as const,
    title: `${agentName} 私聊`,
    participants: ['user', agent.id],
  }
}

/**
 * Creates one stored project record for the local JSON project map.
 * Input: runtime identifiers plus frontend metadata.
 * Output: persisted project record.
 */
function createStoredProjectRecord(input: {
  workspaceId: string
  name: string
  goal: string
  conversationId: string
  conversationType: ConversationType
  targetAgentId?: string
}): StoredProjectRecord {
  const now = new Date().toISOString()

  return {
    projectId: `proj-${randomUUID()}`,
    workspaceId: input.workspaceId,
    name: input.name,
    goal: input.goal,
    conversationId: input.conversationId,
    conversationType: input.conversationType,
    targetAgentId: input.targetAgentId,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Picks the most recently updated workspace from one create-workspace state snapshot.
 * Input: workspace list and requested workspace name.
 * Output: matching workspace or the latest workspace fallback.
 */
function selectLatestWorkspace(
  workspaces: Array<{
    id: string
    name: string
    updatedAt: string
    goal: string
  }>,
  name: string,
) {
  const named = workspaces
    .filter(workspace => workspace.name === name)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return named[0] ?? [...workspaces].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}
