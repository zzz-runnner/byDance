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
  WorkspaceDeliverySummary,
  WorkspaceDeploymentRecord,
  WorkspaceDocumentPreview,
  WorkspaceFileContent,
  WorkspaceListStatus,
  WorkspacePreviewCapability,
  WorkspacePreviewTargets,
  WorkspaceSortField,
  WorkspaceVersionDiff,
  WorkspaceVersionRecord,
  WorkspaceVersionRestoreResult,
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

type DeleteBusinessProjectResponse = {
  deleted: boolean
  projectId: string
  workspaceId: string
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

const DEFAULT_GROUP_AGENT_IDS = ['orchestrator', 'product-manager', 'engineer', 'reviewer']

type FetchWorkbenchOverviewInput = {
  limit?: number
  pageSize?: number
  cursor?: string
  query?: string
  status?: WorkspaceListStatus
  sortBy?: WorkspaceSortField
  sortDirection?: SortDirection
}

export type FetchProjectStateInput = {
  messagePageSize?: number
  messageCursor?: string
  messageLimit?: number
}

export function backendUrl(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

export function backendAssetUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }

  return url.startsWith('/') || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')
    ? url
    : `/${url}`
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
    workspaceAgentMembers: [],
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
 * Maps common backend/runtime English errors into concise Chinese UI copy.
 * Input: raw backend detail text. Output: localized detail when a known pattern matches.
 */
function localizeBackendErrorDetail(detail: string): string {
  const normalized = detail.trim()
  const nameConflictMatch = normalized.match(/^Agent name already exists in workspace:\s*(.+)$/i)
  if (nameConflictMatch) {
    return `当前工作区中已存在同名 Agent：${nameConflictMatch[1]}`
  }

  const idConflictMatch = normalized.match(/^Agent already exists:\s*(.+)$/i)
  if (idConflictMatch) {
    return `Agent 标识已存在：${idConflictMatch[1]}`
  }

  if (/^Custom agents can only be added to group workspaces\.?$/i.test(normalized)) {
    return '只有群聊工作区可以创建自定义 Agent'
  }
  if (/^Direct workspaces can only talk to built-in Claude Code or Codex direct agents\.?$/i.test(normalized)) {
    return '单聊工作区只能选择内置的 Claude Code 或 Codex Agent'
  }
  if (/^Built-in agent cannot be deleted:\s*(.+)$/i.test(normalized)) {
    const agentId = normalized.replace(/^Built-in agent cannot be deleted:\s*/i, '')
    return `默认 Agent 不允许删除：${agentId}`
  }
  if (/^Agent not found in workspace:\s*(.+)$/i.test(normalized) || /^Agent not found in project workspace room:\s*(.+)$/i.test(normalized)) {
    const agentId = normalized.replace(/^Agent not found(?: in workspace| in project workspace room):\s*/i, '')
    return `当前工作区中未找到该 Agent：${agentId}`
  }
  if (/^Workspace not found:\s*(.+)$/i.test(normalized)) {
    const workspaceId = normalized.replace(/^Workspace not found:\s*/i, '')
    return `未找到工作区：${workspaceId}`
  }

  return normalized
}

/**
 * Parses a JSON response and gives errors a backend-oriented label.
 * Input: fetch response and operation label.
 * Output: parsed JSON payload.
 */
async function readJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json() as { message?: string | string[]; error?: string | string[] }
      if (Array.isArray(payload.message)) {
        detail = payload.message.join('; ')
      } else if (typeof payload.message === 'string') {
        detail = payload.message
      } else if (Array.isArray(payload.error)) {
        detail = payload.error.join('; ')
      } else if (typeof payload.error === 'string') {
        detail = payload.error
      }
    } catch {
      try {
        detail = (await response.text()).trim()
      } catch {
        detail = ''
      }
    }

    const suffix = detail ? `：${localizeBackendErrorDetail(detail)}` : ''
    throw new Error(`${label} failed: ${response.status}${suffix}`)
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
  const response = await fetch(backendUrl('/api/agents'))
  const payload = await readJson<AgentsResponse>(response, 'Load business agents')
  return extractAgents(payload)
}

export async function createBusinessAgent(input: CreateBusinessAgentInput): Promise<AgentDefinition> {
  const response = await fetch(backendUrl('/api/agents'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<AgentDefinition>(response, 'Create business agent')
}

export async function fetchBusinessProjectAgents(projectId: string): Promise<AgentDefinition[]> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents`))
  const payload = await readJson<AgentsResponse>(response, 'Load project agents')
  return extractAgents(payload)
}

export async function createBusinessProjectAgent(
  projectId: string,
  input: CreateBusinessAgentInput,
): Promise<AgentDefinition> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<AgentDefinition>(response, 'Create project agent')
}

export async function updateBusinessProjectAgent(
  projectId: string,
  agentId: string,
  input: UpdateBusinessAgentInput,
): Promise<AgentDefinition> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<AgentDefinition>(response, 'Update project agent')
}

export async function deleteBusinessProjectAgent(projectId: string, agentId: string): Promise<void> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`), {
    method: 'DELETE',
  })
  await readJson<{ deleted: boolean; agentId: string; workspaceId: string }>(response, 'Delete project agent')
}

export async function updateBusinessAgent(
  agentId: string,
  input: UpdateBusinessAgentInput,
): Promise<AgentDefinition> {
  const response = await fetch(backendUrl(`/api/agents/${encodeURIComponent(agentId)}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<AgentDefinition>(response, 'Update business agent')
}

export async function deleteBusinessAgent(agentId: string): Promise<void> {
  const response = await fetch(backendUrl(`/api/agents/${encodeURIComponent(agentId)}`), {
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
  const response = await fetch(backendUrl(`/api/workbench${query.size ? `?${query.toString()}` : ''}`))
  const payload = await readJson<WorkbenchOverviewResponse>(response, 'Load workbench overview')
  return extractWorkbenchOverview(payload)
}

export async function updateBusinessWorkspaceMetadata(
  projectId: string,
  input: WorkspaceMetadataUpdate,
): Promise<BusinessProject> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/metadata`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<BusinessProject>(response, 'Update workspace metadata')
}

export async function deleteBusinessWorkspace(projectId: string): Promise<DeleteBusinessProjectResponse> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
    method: 'DELETE',
  })
  return readJson<DeleteBusinessProjectResponse>(response, 'Delete workspace')
}

/**
 * Loads one paged project state from the business backend.
 * Input: project id plus requested message page size and optional older-page cursor.
 * Output: active-room state plus pagination metadata.
 */
export async function fetchBusinessProjectState(
  projectId: string,
  input: number | FetchProjectStateInput = 40,
): Promise<ProjectStateEnvelope> {
  const normalized = typeof input === 'number' ? { messagePageSize: input } : input
  const query = new URLSearchParams()
  if (normalized.messagePageSize) {
    query.set('messagePageSize', String(normalized.messagePageSize))
  }
  if (normalized.messageCursor) {
    query.set('messageCursor', normalized.messageCursor)
  }
  if (normalized.messageLimit) {
    query.set('messageLimit', String(normalized.messageLimit))
  }
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/state?${query.toString()}`))
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
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/messages/stream`), {
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
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/files`))
  return readJson<WorkspaceFileTree>(response, 'Load business project files')
}

/**
 * Loads one UTF-8 file from the current project workspace.
 * Input: project id and repo-relative file path.
 * Output: file content plus editor metadata.
 */
export async function fetchBusinessProjectFileContent(projectId: string, filePath: string): Promise<WorkspaceFileContent> {
  const query = new URLSearchParams({ path: filePath })
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/files/content?${query.toString()}`))
  return readJson<WorkspaceFileContent>(response, 'Load business project file')
}

/**
 * Loads one local document preview payload for PDF, Word, or PowerPoint files.
 * Input: project id and repo-relative file path.
 * Output: lightweight document preview data for the workspace dialog.
 */
export async function fetchBusinessProjectFilePreview(
  projectId: string,
  filePath: string,
): Promise<WorkspaceDocumentPreview> {
  const query = new URLSearchParams({ path: filePath })
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/files/preview?${query.toString()}`))
  return readJson<WorkspaceDocumentPreview>(response, 'Load business project file preview')
}

/**
 * Loads the current diff snapshot for one project workspace.
 * Input: project id.
 * Output: git status summary and unified patch text.
 */
export async function fetchBusinessProjectDiff(projectId: string): Promise<WorkspaceDiffSnapshot> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/diff`))
  return readJson<WorkspaceDiffSnapshot>(response, 'Load business project diff')
}

/**
 * Applies one recorded AgentHub change set onto the current workspace repo.
 * Input: project id and change-set id.
 * Output: apply status plus a short backend summary.
 */
export async function applyBusinessProjectChangeSet(
  projectId: string,
  changeSetId: string,
): Promise<{ status: 'applied' | 'already_applied'; changeSetId: string; summary: string }> {
  const response = await fetch(
    backendUrl(`/api/projects/${encodeURIComponent(projectId)}/change-sets/${encodeURIComponent(changeSetId)}/apply`),
    {
      method: 'POST',
    },
  )
  return readJson(response, 'Apply business project change set')
}

/**
 * Pins one persisted chat message into the workspace-level long-term context list.
 * Input: project id and runtime message id.
 * Output: updated pin payload from the backend.
 */
export async function pinBusinessProjectMessage(
  projectId: string,
  messageId: string,
): Promise<{ workspaceId: string; messageId: string; pinnedMessageIds: string[] }> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/messages/${encodeURIComponent(messageId)}/pin`), {
    method: 'PUT',
  })
  return readJson(response, 'Pin business project message')
}

/**
 * Removes one persisted chat message from the workspace-level pinned list.
 * Input: project id and runtime message id.
 * Output: updated pin payload from the backend.
 */
export async function unpinBusinessProjectMessage(
  projectId: string,
  messageId: string,
): Promise<{ workspaceId: string; messageId: string; pinnedMessageIds: string[] }> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/messages/${encodeURIComponent(messageId)}/pin`), {
    method: 'DELETE',
  })
  return readJson(response, 'Unpin business project message')
}

/**
 * Loads the current static preview targets for one workspace-backed project.
 * Input: project id.
 * Output: preview target list plus the default target when available.
 */
export async function fetchBusinessProjectPreviewTargets(projectId: string): Promise<WorkspacePreviewTargets> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-targets`))
  return readJson<WorkspacePreviewTargets>(response, 'Load business project preview targets')
}

/**
 * Loads the current preview capability for one workspace-backed project.
 * Input: project id.
 * Output: preview mode, targets, and optional build state.
 */
export async function fetchBusinessProjectPreviewCapability(projectId: string): Promise<WorkspacePreviewCapability> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-capability`))
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
    backendUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-build${query.size ? `?${query.toString()}` : ''}`),
    {
      method: 'POST',
    },
  )
  return readJson<WorkspacePreviewCapability>(response, 'Start business project preview build')
}

/**
 * Loads the current delivery summary for one workspace-backed project.
 * Input: project id.
 * Output: latest source archive, build, and deployment status summary.
 */
export async function fetchBusinessProjectDeliverySummary(projectId: string): Promise<WorkspaceDeliverySummary> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/delivery`))
  return readJson<WorkspaceDeliverySummary>(response, 'Load business project delivery summary')
}

/**
 * Saves the current workspace repo as one downloadable source snapshot.
 * Input: project id and optional git-style message.
 * Output: created or refreshed version record.
 */
export async function createBusinessProjectVersion(
  projectId: string,
  message?: string,
): Promise<WorkspaceVersionRecord> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/versions`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(message ? { message } : {}),
    }),
  })
  return readJson<WorkspaceVersionRecord>(response, 'Create business project version')
}

/**
 * Loads saved source versions for one workspace-backed project.
 * Input: project id.
 * Output: version history ordered by backend default.
 */
export async function fetchBusinessProjectVersions(projectId: string): Promise<WorkspaceVersionRecord[]> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/versions`))
  return readJson<WorkspaceVersionRecord[]>(response, 'Load business project versions')
}

/**
 * Loads the unified diff between two saved project versions.
 * Input: project id and two version ids.
 * Output: backend version diff payload.
 */
export async function fetchBusinessProjectVersionDiff(
  projectId: string,
  v1: string,
  v2: string,
): Promise<WorkspaceVersionDiff> {
  const query = new URLSearchParams({
    v1,
    v2,
  })
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/version-diff?${query.toString()}`))
  return readJson<WorkspaceVersionDiff>(response, 'Load business project version diff')
}

/**
 * Restores the current workspace repo to one saved version.
 * Input: project id, target version id, and optional restore guard settings.
 * Output: restore result with optional auto snapshot.
 */
export async function restoreBusinessProjectVersion(
  projectId: string,
  versionId: string,
  input: {
    createSnapshotBeforeRestore?: boolean
    message?: string
  } = {},
): Promise<WorkspaceVersionRestoreResult> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  return readJson<WorkspaceVersionRestoreResult>(response, 'Restore business project version')
}

/**
 * Builds the selected saved version into a deployable static artifact.
 * Input: project id and optional version id override.
 * Output: updated version record after the build finishes.
 */
export async function buildBusinessProjectVersion(
  projectId: string,
  versionId?: string,
): Promise<WorkspaceVersionRecord> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/builds`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(versionId ? { versionId } : {}),
    }),
  })
  return readJson<WorkspaceVersionRecord>(response, 'Build business project version')
}

/**
 * Deploys the selected built version into the local static deployment route.
 * Input: project id and optional version id override.
 * Output: created deployment record.
 */
export async function deployBusinessProjectVersion(
  projectId: string,
  versionId?: string,
): Promise<WorkspaceDeploymentRecord> {
  const response = await fetch(backendUrl(`/api/projects/${encodeURIComponent(projectId)}/deploy`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(versionId ? { versionId } : {}),
    }),
  })
  return readJson<WorkspaceDeploymentRecord>(response, 'Deploy business project version')
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
  const response = await fetch(backendUrl('/api/projects'), {
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
