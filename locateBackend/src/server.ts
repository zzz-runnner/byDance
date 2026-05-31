import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { z } from 'zod'
import type { AppConfig } from './config.js'
import { AgentHubClient } from './agenthub-client.js'
import { ProjectStore } from './project-store.js'
import { sendBufferedUpstreamResponse, sendSseUpstreamResponse } from './sse-proxy.js'
import {
  buildWorkbenchOverviewPage,
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
  replyTo: z.object({
    messageId: z.string(),
    senderId: z.string(),
    senderName: z.string().optional(),
    excerpt: z.string().min(1),
  }).optional(),
  codeSelection: z.object({
    filePath: z.string().min(1),
    selectedText: z.string().min(1),
    startLine: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
    language: z.string().optional(),
    beforeContext: z.string().optional(),
    afterContext: z.string().optional(),
  }).optional(),
})

const FileContentQuerySchema = z.object({
  path: z.string().min(1),
})

const ProjectStateQuerySchema = z.object({
  messageLimit: z.coerce.number().int().positive().max(200).optional(),
})

const WorkbenchQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(20),
  cursor: z.string().optional(),
  q: z.string().optional(),
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

  app.get('/api/workbench', async request => {
    const query = WorkbenchQuerySchema.parse(request.query)
    const projectPage = await projectStore.listProjectsPage({
      limit: query.limit,
      cursor: query.cursor,
      query: query.q,
    })
    const [agents, roomBatch] = await Promise.all([
      agentHub.fetchAgents(),
      projectPage.items.length > 0
        ? agentHub.fetchWorkspaceOverviewBatch({
            items: projectPage.items.map(project => ({
              workspaceId: project.workspaceId,
              conversationType: project.conversationType,
              targetAgentId: project.targetAgentId,
            })),
          })
        : Promise.resolve({ rooms: [] }),
    ])

    return buildWorkbenchOverviewPage(agents, projectPage.items, roomBatch.rooms, {
      limit: query.limit,
      nextCursor: projectPage.nextCursor,
      hasMore: projectPage.hasMore,
      total: projectPage.total,
    })
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
    return agentHub.fetchAgents()
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
    const query = ProjectStateQuerySchema.parse(request.query)
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    const state = await agentHub.fetchState()
    return selectProjectState(state, project, {
      messageLimit: query.messageLimit,
    })
  })

  app.get('/api/projects/:projectId/files', async request => {
    const { projectId } = request.params as { projectId: string }
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    const fileTree = await agentHub.fetchWorkspaceFiles(project.workspaceId)
    return {
      rootLabel: `${project.name} / repo`,
      entries: fileTree.entries,
    }
  })

  app.get('/api/projects/:projectId/files/content', async request => {
    const { projectId } = request.params as { projectId: string }
    const query = FileContentQuerySchema.parse(request.query)
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    return agentHub.fetchWorkspaceFileContent(project.workspaceId, query.path)
  })

  app.get('/api/projects/:projectId/diff', async request => {
    const { projectId } = request.params as { projectId: string }
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    return agentHub.fetchWorkspaceDiff(project.workspaceId)
  })

  app.get('/api/projects/:projectId/preview-targets', async request => {
    const { projectId } = request.params as { projectId: string }
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    return agentHub.fetchWorkspacePreviewTargets(project.workspaceId)
  })

  app.post('/api/projects/:projectId/messages/stream', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const input = StreamProjectMessageInputSchema.parse(request.body) as StreamProjectMessageInput
    const project = await projectStore.getProject(projectId)

    if (!project) {
      throw createHttpError(404, `Project not found: ${projectId}`)
    }

    const state = await agentHub.fetchState()
    const targetAgentId = resolveStreamTargetAgentId(project, input, state)
    const upstream = await agentHub.streamMessage({
      workspaceId: project.workspaceId,
      conversationId: input.conversationId ?? project.conversationId,
      content: input.content,
      replyTo: input.replyTo,
      codeSelection: input.codeSelection,
      ...(targetAgentId ? { agentId: targetAgentId } : {}),
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

/**
 * Resolves the current conversation for one frontend message stream request.
 * Input: runtime conversation list, stored project, and optional requested conversation id.
 * Output: the matching runtime conversation when it exists.
 */
function resolveStreamConversation(
  conversations: RuntimeAppState['conversations'],
  project: StoredProjectRecord,
  conversationId?: string,
) {
  const targetConversationId = conversationId ?? project.conversationId
  return conversations.find(conversation => conversation.id === targetConversationId)
}

/**
 * Detects one explicit child-agent mention from group-chat composer content.
 * Input: raw composer content and candidate runtime agents.
 * Output: one unique agent id when the user explicitly mentioned exactly one child agent.
 */
function resolveMentionTargetAgentId(content: string, agents: RuntimeAgent[]): string | undefined {
  const normalized = content.toLowerCase()
  const matches = [...new Set(
    agents
      .filter(agent => agent.id !== 'orchestrator')
      .filter(agent => {
        const agentId = agent.id.toLowerCase()
        const agentName = agent.name?.toLowerCase()
        return normalized.includes(`@${agentId}`) || Boolean(agentName && normalized.includes(`@${agentName}`))
      })
      .map(agent => agent.id),
  )]

  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Resolves the upstream target agent for one streamed frontend message.
 * Input: stored project metadata, frontend stream input, and the latest runtime state.
 * Output: direct target agent id or one explicit group-chat @ mention.
 */
function resolveStreamTargetAgentId(
  project: StoredProjectRecord,
  input: StreamProjectMessageInput,
  state: RuntimeAppState,
): string | undefined {
  if (input.agentId?.trim()) {
    return input.agentId.trim()
  }

  const conversation = resolveStreamConversation(state.conversations, project, input.conversationId)

  if (!conversation) {
    return project.targetAgentId
  }

  if (conversation.type === 'direct') {
    return conversation.participants.find(participant => participant !== 'user') ?? project.targetAgentId
  }

  const candidateAgents = state.agents.filter(agent => conversation.participants.includes(agent.id))
  const mentionedAgentId = resolveMentionTargetAgentId(input.content, candidateAgents)
  if (mentionedAgentId) {
    return mentionedAgentId
  }
  if (input.codeSelection) {
    return candidateAgents.some(agent => agent.id === 'engineer') ? 'engineer' : undefined
  }
  return undefined
}
