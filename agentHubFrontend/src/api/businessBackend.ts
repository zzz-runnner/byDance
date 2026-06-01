import type {
  AgentDefinition,
  AgentProvider,
  AppState,
  ProjectStateEnvelope,
  SortDirection,
  WorkspaceFileTree,
  WorkbenchOverview,
  StreamMessageInput,
  Workspace,
  WorkspaceDiffSnapshot,
  WorkspaceFileContent,
  WorkspacePreviewCapability,
  WorkspacePreviewTargets,
  WorkspaceListStatus,
  WorkspaceSortField,
  WorkflowEvent,
} from '../types'

type BusinessProject = {
  id?: string
  projectId?: string
  name?: string
  goal?: string
  workspaceId?: string
  conversationId?: string
  agentHubPreviewUrl?: string
  agentHubZipUrl?: string
  pinnedAt?: string
  archivedAt?: string
  createdAt?: string
  updatedAt?: string
}

type AgentsResponse = AgentDefinition[] | {
  agents?: AgentDefinition[]
}

type WorkbenchOverviewResponse = WorkbenchOverview | {
  agents?: AgentDefinition[]
  rooms?: WorkbenchOverview['rooms']
  page?: WorkbenchOverview['page']
}

type ProjectStateEnvelopeResponse = ProjectStateEnvelope | {
  state?: AppState
  messagePage?: ProjectStateEnvelope['messagePage']
}

const DEFAULT_GROUP_AGENT_IDS = ['product-manager', 'engineer', 'reviewer']

type FetchWorkbenchOverviewInput = {
  limit?: number
  pageSize?: number
  cursor?: string
  query?: string
  status?: WorkspaceListStatus
  sortBy?: WorkspaceSortField
  sortDirection?: SortDirection
}

export type CreateBusinessAgentInput = {
  id?: string
  name: string
  role?: string
  description?: string
  whenToUse?: string
  systemPrompt: string
  modelProvider?: AgentProvider
  model?: string
  contextPolicy?: AgentDefinition['contextPolicy']
  tools?: string[]
  permissions?: AgentDefinition['permissions']
  disallowedTools?: string[]
  permissionMode?: AgentDefinition['permissionMode']
  runtimePolicy?: AgentDefinition['runtimePolicy']
  outputSchema?: string
  isolation?: AgentDefinition['isolation']
  skills?: string[]
  routingProfile?: AgentDefinition['routingProfile']
}

export type UpdateBusinessAgentInput = Partial<Omit<CreateBusinessAgentInput, 'id'>>

export type WorkspaceMetadataUpdate = {
  pinned?: boolean
  archived?: boolean
}

/**
 * Builds an empty workbench state for a backend with no projects yet.
 * Input: optional agent list.
 * Output: AppState with empty project-scoped collections.
 */
export function createEmptyWorkbenchState(agents: AgentDefinition[] = []): AppState {
  return {
    workspaces: [],
    conversations: [],
    messages: [],
    agents,
    agentSessions: [],
    agentSessionMessages: [],
    taskHandoffs: [],
    agentRuns: [],
    artifacts: [],
    changeSets: [],
    contextSnapshots: [],
    workflowEvents: [],
    diagnosticLogs: [],
  }
}

/**
 * Parses a JSON response and gives errors a backend-oriented label.
 * Input: fetch response and operation label.
 * Output: parsed JSON payload.
 */
async function readJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

/**
 * Returns agent definitions from the backend response shape.
 * Input: agents payload.
 * Output: normalized agent list.
 */
function extractAgents(payload: AgentsResponse): AgentDefinition[] {
  return Array.isArray(payload) ? payload : payload.agents ?? []
}

/**
 * Returns the overview payload from the backend response shape.
 * Input: overview payload.
 * Output: normalized light workbench overview.
 */
function extractWorkbenchOverview(payload: WorkbenchOverviewResponse): WorkbenchOverview {
  if (
    'rooms' in payload &&
    Array.isArray(payload.rooms) &&
    Array.isArray(payload.agents) &&
    payload.page
  ) {
    return {
      agents: payload.agents,
      rooms: payload.rooms,
      page: payload.page,
    }
  }

  throw new Error('Business backend returned an invalid workbench overview payload.')
}

/**
 * Returns the paged project state payload from the backend response shape.
 * Input: project state payload.
 * Output: normalized state plus message-page metadata.
 */
function extractProjectStateEnvelope(payload: ProjectStateEnvelopeResponse): ProjectStateEnvelope {
  if (payload.state && payload.messagePage) {
    return {
      state: payload.state,
      messagePage: payload.messagePage,
    }
  }

  throw new Error('Business backend returned an invalid project state payload.')
}

/**
 * Loads available agent definitions from the business backend.
 * Input: none.
 * Output: agent definition list.
 */
export async function fetchBusinessAgents(): Promise<AgentDefinition[]> {
  const response = await fetch('/api/agents')
  const payload = await readJson<AgentsResponse>(response, 'Load business agents')
  return extractAgents(payload)
}

export async function createBusinessAgent(input: CreateBusinessAgentInput): Promise<AgentDefinition> {
  const response = await fetch('/api/agents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<AgentDefinition>(response, 'Create business agent')
}

export async function updateBusinessAgent(
  agentId: string,
  input: UpdateBusinessAgentInput,
): Promise<AgentDefinition> {
  const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<AgentDefinition>(response, 'Update business agent')
}

export async function deleteBusinessAgent(agentId: string): Promise<void> {
  const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  })
  await readJson<{ deleted: boolean; agentId: string }>(response, 'Delete business agent')
}

/**
 * Loads the lightweight workbench overview used by the left workspace list.
 * Input: optional cursor-paging and server-side search arguments.
 * Output: room summaries plus agent definitions and page metadata.
 */
export async function fetchBusinessWorkbenchOverview(
  input: FetchWorkbenchOverviewInput = {},
): Promise<WorkbenchOverview> {
  const query = new URLSearchParams()
  const pageSize = input.pageSize ?? input.limit
  if (pageSize) {
    query.set('pageSize', String(pageSize))
  }
  if (input.cursor) {
    query.set('cursor', input.cursor)
  }
  if (input.query?.trim()) {
    query.set('query', input.query.trim())
  }
  if (input.status) {
    query.set('status', input.status)
  }
  if (input.sortBy) {
    query.set('sortBy', input.sortBy)
  }
  if (input.sortDirection) {
    query.set('sortDirection', input.sortDirection)
  }
  const response = await fetch(`/api/workbench${query.size ? `?${query.toString()}` : ''}`)
  const payload = await readJson<WorkbenchOverviewResponse>(response, 'Load workbench overview')
  return extractWorkbenchOverview(payload)
}

export async function updateBusinessWorkspaceMetadata(
  projectId: string,
  input: WorkspaceMetadataUpdate,
): Promise<BusinessProject> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/metadata`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<BusinessProject>(response, 'Update workspace metadata')
}

/**
 * Loads one paged project state from the business backend.
 * Input: project id and requested recent-message limit.
 * Output: active-room state plus pagination metadata.
 */
export async function fetchBusinessProjectState(
  projectId: string,
  messageLimit = 40,
): Promise<ProjectStateEnvelope> {
  const query = new URLSearchParams({
    messageLimit: String(messageLimit),
  })
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/state?${query.toString()}`)
  const payload = await readJson<ProjectStateEnvelopeResponse>(response, 'Load business project state')
  return extractProjectStateEnvelope(payload)
}

/**
 * Sends one chat message to a project-scoped streaming endpoint.
 * Input: message payload and a callback for parsed workflow events.
 * Output: a Promise that resolves after the stream closes.
 */
export async function streamBusinessProjectMessage(
  input: StreamMessageInput,
  onEvent: (event: WorkflowEvent) => void,
): Promise<void> {
  const projectId = input.projectId ?? input.workspaceId
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversationId: input.conversationId,
      content: input.content,
      agentId: input.agentId,
      replyTo: input.replyTo,
      codeSelection: input.codeSelection,
    }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`Stream business project message failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    frames.forEach(frame => {
      const dataLine = frame
        .split('\n')
        .find(line => line.startsWith('data: '))

      if (!dataLine) {
        return
      }

      const payload = dataLine.slice('data: '.length)
      const parsed = JSON.parse(payload) as WorkflowEvent | { error: string }

      if ('error' in parsed) {
        throw new Error(parsed.error)
      }

      onEvent(parsed)
    })
  }
}

/**
 * Loads the browser-visible file tree for one project workspace.
 * Input: project id.
 * Output: nested file nodes rooted at the current workspace repo.
 */
export async function fetchBusinessProjectFiles(projectId: string): Promise<WorkspaceFileTree> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`)
  return readJson<WorkspaceFileTree>(response, 'Load business project files')
}

/**
 * Loads one UTF-8 file from the current project workspace.
 * Input: project id and repo-relative file path.
 * Output: file content plus editor metadata.
 */
export async function fetchBusinessProjectFileContent(projectId: string, filePath: string): Promise<WorkspaceFileContent> {
  const query = new URLSearchParams({ path: filePath })
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/content?${query.toString()}`)
  return readJson<WorkspaceFileContent>(response, 'Load business project file')
}

/**
 * Loads the current diff snapshot for one project workspace.
 * Input: project id.
 * Output: git status summary and unified patch text.
 */
export async function fetchBusinessProjectDiff(projectId: string): Promise<WorkspaceDiffSnapshot> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/diff`)
  return readJson<WorkspaceDiffSnapshot>(response, 'Load business project diff')
}

/**
 * Loads the current static preview targets for one workspace-backed project.
 * Input: project id.
 * Output: preview target list plus the default target when available.
 */
export async function fetchBusinessProjectPreviewTargets(projectId: string): Promise<WorkspacePreviewTargets> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview-targets`)
  return readJson<WorkspacePreviewTargets>(response, 'Load business project preview targets')
}

/**
 * Loads the current preview capability for one workspace-backed project.
 * Input: project id.
 * Output: preview mode, targets, and optional build state.
 */
export async function fetchBusinessProjectPreviewCapability(projectId: string): Promise<WorkspacePreviewCapability> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview-capability`)
  return readJson<WorkspacePreviewCapability>(response, 'Load business project preview capability')
}

/**
 * Starts or retries the preview build for one workspace-backed project.
 * Input: project id and optional force flag.
 * Output: refreshed preview capability after the build request is accepted.
 */
export async function triggerBusinessProjectPreviewBuild(
  projectId: string,
  force = false,
): Promise<WorkspacePreviewCapability> {
  const query = new URLSearchParams()
  if (force) {
    query.set('force', 'true')
  }
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/preview-build${query.size ? `?${query.toString()}` : ''}`,
    {
      method: 'POST',
    },
  )
  return readJson<WorkspacePreviewCapability>(response, 'Start business project preview build')
}

/**
 * Creates a new product workspace through the business backend.
 * Input: workspace name, goal, type, and optional direct target agent.
 * Output: the created business project record.
 */
export async function createBusinessWorkspace(
  name: string,
  goal: string,
  workspaceType: Workspace['workspaceType'] = 'dev',
  targetAgentId?: string,
): Promise<BusinessProject> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      goal,
      workspaceType,
      conversationType: targetAgentId ? 'direct' : 'group',
      agentIds: targetAgentId ? [targetAgentId] : DEFAULT_GROUP_AGENT_IDS,
    }),
  })
  return readJson<BusinessProject>(response, 'Create business project')
}
