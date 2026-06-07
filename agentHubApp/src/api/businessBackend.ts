declare const process: {
  env?: Record<string, string | undefined>
}

import EventSource from 'react-native-sse'

const DEFAULT_BUSINESS_API_BASE_URL = 'http://120.79.130.49:8790'

export const BUSINESS_API_BASE_URL =
  process.env?.EXPO_PUBLIC_BUSINESS_API_BASE_URL?.replace(/\/+$/, '') ??
  DEFAULT_BUSINESS_API_BASE_URL

export type BusinessHealth = {
  ok: boolean
  service: string
  agentHubBaseUrl?: string
  storageRoot?: string
}

export type WorkspaceListStatus = 'active' | 'archived' | 'all'
export type WorkspaceSortField = 'updatedAt' | 'createdAt' | 'name'
export type SortDirection = 'asc' | 'desc'

export type WorkbenchOverviewInput = {
  pageSize?: number
  cursor?: string
  query?: string
  status: WorkspaceListStatus
  sortBy: WorkspaceSortField
  sortDirection: SortDirection
}

export type WorkbenchRoom = {
  id: string
  conversationId?: string
  kind: 'group' | 'direct'
  title?: string
  subtitle?: string
  workspace: {
    id: string
    projectId?: string
    name?: string
    goal?: string
    workspaceType?: 'dev' | 'research' | 'writing' | 'chat'
    runtimeStatus?: string
    pinnedAt?: string
    archivedAt?: string
    updatedAt?: string
  }
  participantAgentIds?: string[]
  signal?: {
    runningAgents?: number
    latestEventLabel?: string
    artifactCount?: number
    messageCount?: number
  }
  lastActivityAt?: string
}

export type ProjectAgent = {
  rowId?: string
  row_id?: string
  id: string
  name?: string
  role?: string
  description?: string
  whenToUse?: string
  systemPrompt?: string
  modelProvider?: string
  model?: string
  contextPolicy?: Record<string, unknown>
  tools?: string[]
  permissions?: Record<string, unknown>
  disallowedTools?: string[]
  permissionMode?: 'readonly' | 'ask' | 'acceptEdits' | 'dangerous'
  runtimePolicy?: {
    workspaceOnly: boolean
    allowNetwork: boolean
    allowShell: boolean
    maxRunSeconds: number
  }
  outputSchema?: string
  isolation?: 'shared' | 'worktree'
  skills?: string[]
  routingProfile?: Record<string, unknown>
  source?: 'built-in' | 'workspace' | 'custom' | string
  workspaceId?: string
  conversationId?: string
  createdAt?: string
  updatedAt?: string
}

export type UpdateProjectAgentInput = {
  name?: string
  role?: string
  description?: string
  whenToUse?: string
  systemPrompt?: string
  modelProvider?: string
  model?: string
  contextPolicy?: ProjectAgent['contextPolicy']
  tools?: string[]
  permissions?: ProjectAgent['permissions']
  disallowedTools?: string[]
  permissionMode?: ProjectAgent['permissionMode']
  runtimePolicy?: ProjectAgent['runtimePolicy']
  outputSchema?: string
  isolation?: ProjectAgent['isolation']
  skills?: string[]
  routingProfile?: ProjectAgent['routingProfile']
}

export type CreateProjectAgentInput = UpdateProjectAgentInput & {
  id?: string
  name: string
  systemPrompt: string
}

export type WorkbenchOverview = {
  agents: ProjectAgent[]
  rooms: WorkbenchRoom[]
  page: {
    limit: number
    nextCursor?: string
    hasMore: boolean
    total: number
    status?: WorkspaceListStatus
    sortBy?: WorkspaceSortField
    sortDirection?: SortDirection
    query?: string
  }
}

export type CreateWorkspaceInput = {
  name: string
  goal: string
  workspaceType?: 'dev' | 'research' | 'writing' | 'chat'
  conversationType?: 'group' | 'direct'
  agentIds?: string[]
}

export type BusinessProject = {
  projectId: string
  workspaceId: string
  name: string
  goal: string
  conversationId?: string
  conversationType?: 'group' | 'direct'
  targetAgentId?: string
  createdAt?: string
  updatedAt?: string
}

export type WorkspaceMetadataUpdate = {
  pinned?: boolean
  archived?: boolean
}

export type ProjectConversation = {
  id: string
  workspaceId?: string
  type?: 'group' | 'direct'
  title?: string
  participants?: string[]
  createdAt?: string
  updatedAt?: string
}

export type ProjectMessageReplyReference = {
  messageId: string
  senderId: string
  senderName?: string
  excerpt: string
}

export type ProjectMessage = {
  id: string
  workspaceId?: string
  conversationId?: string
  turnId?: string
  senderType: 'user' | 'agent' | 'system'
  senderId?: string
  content?: string
  replyTo?: ProjectMessageReplyReference
  artifacts?: ProjectArtifact[]
  createdAt?: string
}

export type ProjectWorkflowEvent = {
  id: string
  workspaceId?: string
  conversationId?: string
  event?: {
    type?: string
    turnId?: string
    agentId?: string
    agentName?: string
    status?: string
    summary?: string
    task?: string
    reason?: string
    taskStage?: string
    scope?: string
    provider?: string
    model?: string
    elapsedMs?: number
    error?: string
    message?: string
    delta?: string
    content?: string
    text?: string
    contentLength?: number
    tokenEstimate?: number
    contextTokens?: number
    expectedOutput?: string
    artifactId?: string
    artifactType?: string
    changeSetId?: string
    title?: string
    previewUrl?: string
    zipUrl?: string
    fileCount?: number
    byteLength?: number
    verdict?: string
    issues?: unknown[]
    files?: unknown[]
    baseCommit?: string
    senderId?: string
    senderName?: string
    messageId?: string
    handoffId?: string
    runId?: string
  }
  createdAt?: string
}

export type ProjectChangedFile = {
  path: string
  status: string
  additions?: number
  deletions?: number
  patch?: string
}

export const PROJECT_WORKFLOW_STREAM_EVENT_NAMES = [
  'workflow_event',
  'turn_started',
  'workflow_received',
  'assistant_message_started',
  'assistant_message_finished',
  'assistant_message_error',
  'routing_started',
  'routing_finished',
  'task_stage_updated',
  'context_started',
  'context_finished',
  'model_call_started',
  'model_call_finished',
  'model_call_failed',
  'handoff_created',
  'handoff_updated',
  'agent_task_dispatched',
  'agent_started',
  'agent_progress',
  'agent_finished',
  'agent_output_started',
  'agent_stdout_delta',
  'agent_stderr_delta',
  'agent_output_finished',
  'artifact_created',
  'change_set_created',
  'delivery_validation_finished',
  'review_verdict',
  'preview_ready',
  'zip_ready',
  'agent_session_started',
  'agent_session_finished',
  'synthesis_started',
  'synthesis_finished',
  'workflow_finished',
] as const

export type ProjectWorkflowStreamEvent = (typeof PROJECT_WORKFLOW_STREAM_EVENT_NAMES)[number]

export type ProjectStreamEvent = 'assistant_delta' | 'message' | ProjectWorkflowStreamEvent

export type ProjectArtifact = {
  id: string
  workspaceId?: string
  agentRunId?: string
  type?: string
  title?: string
  content?: string
  summary?: string
  url?: string
  createdByAgentId?: string
  createdAt?: string
  metadata?: Record<string, unknown>
}

export type ProjectChangeSet = {
  id: string
  workspaceId?: string
  agentRunId?: string
  summary?: string
  patch?: string
  files?: ProjectChangedFile[]
  createdAt?: string
}

export type DeliveryAssetStatus = 'idle' | 'ready' | 'failed'

export type ProjectDeliveryAsset = {
  status: DeliveryAssetStatus
  summary: string
  versionId?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  log?: string
}

export type ProjectDeliverySummary = {
  projectId: string
  currentVersion?: {
    versionId: string
    createdAt?: string
    updatedAt?: string
  }
  sourceArchive: ProjectDeliveryAsset
  build: ProjectDeliveryAsset
  deployment: ProjectDeliveryAsset
}

export type ProjectVersionRecord = {
  versionId: string
  tag?: string
  commitSha?: string
  sourceZipUrl?: string
  buildPreviewUrl?: string
  buildStatus?: 'pending' | 'success' | 'failed'
  buildLog?: string
  isCurrent?: boolean
  createdAt?: string
  updatedAt?: string
}

export type ProjectDeploymentRecord = {
  deploymentId?: string
  versionId: string
  deployUrl: string
  createdAt?: string
}

export type ProjectPreviewTarget = {
  path: string
  url: string
  source?: 'runtime' | 'module-shell' | 'build'
}

export type ProjectPreviewCapability = {
  mode: 'static' | 'module-shell' | 'build' | 'unsupported'
  framework: string
  reason: string
  sourceHash: string
  entryPath?: string
  defaultTargetPath?: string
  targets: ProjectPreviewTarget[]
  build?: {
    status: 'idle' | 'running' | 'success' | 'failed'
    sourceHash: string
    buildId?: string
    summary: string
    startedAt?: string
    finishedAt?: string
    logExcerpt?: string
    error?: string
  }
}

export type ProjectStateEnvelope = {
  state: {
    conversations?: ProjectConversation[]
    messages?: ProjectMessage[]
    agents?: ProjectAgent[]
    workflowEvents?: ProjectWorkflowEvent[]
    artifacts?: ProjectArtifact[]
    changeSets?: ProjectChangeSet[]
  }
  messagePage?: {
    page?: number
    limit: number
    total: number
    hasMore: boolean
  }
}

export type ProjectStateInput = {
  messageLimit?: number
  page?: number
}

export type ProjectTurnRecoveryInput = {
  messageLimit?: number
}

export type ProjectTurnRecoveryResponse = {
  projectId: string
  workspaceId: string
  conversationId?: string
  turnId: string
  status: 'running' | 'finished' | 'failed' | 'not_found'
  hasAssistantReply: boolean
  lastEventType?: string
  latestMessageCreatedAt?: string
  latestEventCreatedAt?: string
  messages: ProjectMessage[]
  workflowEvents: ProjectWorkflowEvent[]
  artifacts: ProjectArtifact[]
  changeSets: ProjectChangeSet[]
  agents: ProjectAgent[]
}

export type StreamProjectMessageInput = {
  conversationId?: string
  content: string
  agentId?: string
  replyTo?: ProjectMessageReplyReference
}

export type ProjectStreamPayload = {
  eventType: ProjectStreamEvent
  rawData: string | null
}

export type ProjectMessageStream = {
  close: () => void
}

export type ProjectMessageStreamHandlers = {
  onEvent: (payload: ProjectStreamPayload) => void
  onError?: (error: Error) => void
  onClose?: () => void
}

export class BusinessBackendError extends Error {
  readonly status?: number
  readonly retryable: boolean

  constructor(message: string, input?: { status?: number; retryable?: boolean }) {
    super(message)
    this.name = 'BusinessBackendError'
    this.status = input?.status
    this.retryable = input?.retryable ?? true
  }
}

export function isBusinessBackendError(error: unknown): error is BusinessBackendError {
  return error instanceof BusinessBackendError
}

function withTimeout(milliseconds: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), milliseconds)

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  }
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json() as { message?: string | string[] }
      detail = Array.isArray(payload.message) ? payload.message.join('; ') : payload.message ?? ''
    } catch {
      detail = ''
    }

    throw new BusinessBackendError(`${label} failed: ${response.status}${detail ? ` ${detail}` : ''}`, {
      status: response.status,
      retryable: response.status >= 500 || response.status === 408 || response.status === 429,
    })
  }

  return response.json() as Promise<T>
}

export function absoluteBackendUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  return `${BUSINESS_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export async function fetchBusinessHealth(): Promise<BusinessHealth> {
  const timeout = withTimeout(8000)

  try {
    const response = await fetch(absoluteBackendUrl('/api/health'), {
      method: 'GET',
      signal: timeout.signal,
    })
    return await readJson<BusinessHealth>(response, 'Load business backend health')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '连接业务后端超时。'
        : '无法连接业务后端。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function fetchWorkbenchOverview(input: WorkbenchOverviewInput): Promise<WorkbenchOverview> {
  const query = new URLSearchParams()
  if (input.pageSize) query.set('pageSize', String(input.pageSize))
  if (input.cursor) query.set('cursor', input.cursor)
  if (input.query?.trim()) query.set('query', input.query.trim())
  query.set('status', input.status)
  query.set('sortBy', input.sortBy)
  query.set('sortDirection', input.sortDirection)

  const timeout = withTimeout(10000)

  const queryString = query.toString()

  try {
    const response = await fetch(absoluteBackendUrl(`/api/workbench${queryString ? `?${queryString}` : ''}`), {
      method: 'GET',
      signal: timeout.signal,
    })
    return await readJson<WorkbenchOverview>(response, 'Load workbench overview')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '加载工作区列表超时。'
        : '无法加载工作区列表。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function createBusinessWorkspace(input: CreateWorkspaceInput): Promise<BusinessProject> {
  const timeout = withTimeout(12000)

  try {
    const response = await fetch(absoluteBackendUrl('/api/projects'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: timeout.signal,
    })
    return await readJson<BusinessProject>(response, 'Create workspace')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '创建工作区超时。'
        : '无法创建工作区。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function updateWorkspaceMetadata(projectId: string, input: WorkspaceMetadataUpdate): Promise<BusinessProject> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/metadata`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: timeout.signal,
    })
    return await readJson<BusinessProject>(response, 'Update workspace metadata')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '更新工作区状态超时。'
        : '无法更新工作区状态。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function fetchProjectState(projectId: string, input?: ProjectStateInput): Promise<ProjectStateEnvelope> {
  const query = new URLSearchParams()
  query.set('messageLimit', String(input?.messageLimit ?? 40))

  const timeout = withTimeout(12000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/state?${query.toString()}`), {
      method: 'GET',
      signal: timeout.signal,
    })
    return await readJson<ProjectStateEnvelope>(response, 'Load project state')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '加载对话状态超时。'
        : '无法加载对话状态。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function fetchProjectTurnRecovery(
  projectId: string,
  turnId: string,
  input?: ProjectTurnRecoveryInput,
): Promise<ProjectTurnRecoveryResponse> {
  const query = new URLSearchParams()
  if (input?.messageLimit) query.set('messageLimit', String(input.messageLimit))

  const timeout = withTimeout(12000)

  try {
    const response = await fetch(
      absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/turns/${encodeURIComponent(turnId)}/recovery${query.size > 0 ? `?${query.toString()}` : ''}`),
      {
        method: 'GET',
        signal: timeout.signal,
      },
    )
    return await readJson<ProjectTurnRecoveryResponse>(response, 'Load project turn recovery')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '加载当前轮次恢复状态超时。'
        : '无法加载当前轮次恢复状态。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function fetchProjectPreviewCapability(projectId: string): Promise<ProjectPreviewCapability> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-capability`), {
      method: 'GET',
      signal: timeout.signal,
    })
    return await readJson<ProjectPreviewCapability>(response, 'Load project preview capability')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '加载预览能力超时。'
        : '无法加载预览能力。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function triggerProjectPreviewBuild(projectId: string, force = false): Promise<ProjectPreviewCapability> {
  const timeout = withTimeout(10000)
  const query = force ? '?force=true' : ''

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-build${query}`), {
      method: 'POST',
      signal: timeout.signal,
    })
    return await readJson<ProjectPreviewCapability>(response, 'Start project preview build')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '启动预览构建超时。'
        : '无法启动预览构建。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function fetchProjectDeliverySummary(projectId: string): Promise<ProjectDeliverySummary> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/delivery`), {
      method: 'GET',
      signal: timeout.signal,
    })
    return await readJson<ProjectDeliverySummary>(response, 'Load project delivery summary')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '加载交付状态超时。'
        : '无法加载交付状态。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function createProjectVersion(projectId: string, message?: string): Promise<ProjectVersionRecord> {
  const timeout = withTimeout(20000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/versions`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message ? { message } : {}),
      signal: timeout.signal,
    })
    return await readJson<ProjectVersionRecord>(response, 'Create project version')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const messageText =
      error instanceof Error && error.name === 'AbortError'
        ? '保存源码版本超时。'
        : '无法保存源码版本。'
    throw new BusinessBackendError(messageText)
  } finally {
    timeout.cancel()
  }
}

export async function buildProjectVersion(projectId: string, versionId?: string): Promise<ProjectVersionRecord> {
  const timeout = withTimeout(60000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/builds`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(versionId ? { versionId } : {}),
      signal: timeout.signal,
    })
    return await readJson<ProjectVersionRecord>(response, 'Build project version')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '交付构建超时。'
        : '无法执行交付构建。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function deployProjectVersion(projectId: string, versionId?: string): Promise<ProjectDeploymentRecord> {
  const timeout = withTimeout(30000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/deploy`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(versionId ? { versionId } : {}),
      signal: timeout.signal,
    })
    return await readJson<ProjectDeploymentRecord>(response, 'Deploy project version')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '本地部署超时。'
        : '无法执行本地部署。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function applyProjectChangeSet(projectId: string, changeSetId: string): Promise<unknown> {
  const timeout = withTimeout(20000)

  try {
    const response = await fetch(
      absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/change-sets/${encodeURIComponent(changeSetId)}/apply`),
      {
        method: 'POST',
        signal: timeout.signal,
      },
    )
    return await readJson<unknown>(response, 'Apply project change set')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '应用代码 Diff 超时。'
        : '无法应用代码 Diff。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function fetchProjectAgents(projectId: string): Promise<ProjectAgent[]> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents`), {
      method: 'GET',
      signal: timeout.signal,
    })
    const payload = await readJson<ProjectAgent[] | { agents?: ProjectAgent[] }>(response, 'Load project agents')
    return Array.isArray(payload) ? payload : payload.agents ?? []
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '加载当前工作区 Agent 超时。'
        : '无法加载当前工作区 Agent。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function createProjectAgent(projectId: string, input: CreateProjectAgentInput): Promise<ProjectAgent> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: timeout.signal,
    })
    return await readJson<ProjectAgent>(response, 'Create project agent')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '创建当前工作区 Agent 超时。'
        : '无法创建当前工作区 Agent。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function updateProjectAgent(projectId: string, agentId: string, input: UpdateProjectAgentInput): Promise<ProjectAgent> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: timeout.signal,
    })
    return await readJson<ProjectAgent>(response, 'Update project agent')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '更新当前工作区 Agent 超时。'
        : '无法更新当前工作区 Agent。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export async function deleteProjectAgent(projectId: string, agentId: string): Promise<{ deleted: boolean; agentId: string; workspaceId: string }> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`), {
      method: 'DELETE',
      signal: timeout.signal,
    })
    return await readJson<{ deleted: boolean; agentId: string; workspaceId: string }>(response, 'Delete project agent')
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '删除当前工作区 Agent 超时。'
        : '无法删除当前工作区 Agent。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export function projectMessageStreamUrl(projectId: string): string {
  return absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/messages/stream`)
}

export function streamProjectMessage(projectId: string, input: StreamProjectMessageInput, handlers: ProjectMessageStreamHandlers): ProjectMessageStream {
  const source = new EventSource<ProjectStreamEvent>(projectMessageStreamUrl(projectId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    pollingInterval: 0,
  })
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    source.close()
  }

  const forwardEvent = (eventType: ProjectStreamEvent) => {
    source.addEventListener(eventType, event => {
      handlers.onEvent({
        eventType,
        rawData: event.data,
      })
    })
  }

  source.addEventListener('error', event => {
    const message = 'message' in event && typeof event.message === 'string' ? event.message : '流式响应失败。'
    handlers.onError?.(new BusinessBackendError(message))
  })
  source.addEventListener('close', () => {
    handlers.onClose?.()
  })

  forwardEvent('assistant_delta')
  forwardEvent('message')
  PROJECT_WORKFLOW_STREAM_EVENT_NAMES.forEach(forwardEvent)

  return { close }
}

async function requestProjectAction(projectId: string, action: 'pin' | 'archive', method: 'PUT' | 'DELETE', label: string): Promise<BusinessProject> {
  const timeout = withTimeout(10000)

  try {
    const response = await fetch(absoluteBackendUrl(`/api/projects/${encodeURIComponent(projectId)}/${action}`), {
      method,
      signal: timeout.signal,
    })
    return await readJson<BusinessProject>(response, label)
  } catch (error) {
    if (error instanceof BusinessBackendError) {
      throw error
    }

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '更新工作区状态超时。'
        : '无法更新工作区状态。'
    throw new BusinessBackendError(message)
  } finally {
    timeout.cancel()
  }
}

export function pinWorkspace(projectId: string): Promise<BusinessProject> {
  return requestProjectAction(projectId, 'pin', 'PUT', 'Pin workspace')
}

export function unpinWorkspace(projectId: string): Promise<BusinessProject> {
  return requestProjectAction(projectId, 'pin', 'DELETE', 'Unpin workspace')
}

export function archiveWorkspace(projectId: string): Promise<BusinessProject> {
  return requestProjectAction(projectId, 'archive', 'PUT', 'Archive workspace')
}

export function unarchiveWorkspace(projectId: string): Promise<BusinessProject> {
  return requestProjectAction(projectId, 'archive', 'DELETE', 'Unarchive workspace')
}
