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
  modelProvider?: string
  model?: string
  skills?: string[]
  source?: string
  workspaceId?: string
  conversationId?: string
  createdAt?: string
  updatedAt?: string
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

export type ProjectMessage = {
  id: string
  workspaceId?: string
  conversationId?: string
  turnId?: string
  senderType: 'user' | 'agent' | 'system'
  senderId?: string
  content?: string
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
  type?: string
  title?: string
  content?: string
  summary?: string
  createdByAgentId?: string
  createdAt?: string
}

export type ProjectStateEnvelope = {
  state: {
    conversations?: ProjectConversation[]
    messages?: ProjectMessage[]
    agents?: ProjectAgent[]
    workflowEvents?: ProjectWorkflowEvent[]
    artifacts?: ProjectArtifact[]
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

export type StreamProjectMessageInput = {
  conversationId?: string
  content: string
  agentId?: string
  replyTo?: {
    messageId: string
    senderId: string
    senderName?: string
    excerpt: string
  }
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
