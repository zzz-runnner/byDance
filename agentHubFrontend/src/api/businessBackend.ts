import type { AgentDefinition, AppState, StreamMessageInput, Workspace, WorkflowEvent } from '../types'

type BusinessProject = {
  id?: string
  projectId?: string
  name?: string
  goal?: string
  workspaceId?: string
  conversationId?: string
  agentHubPreviewUrl?: string
  agentHubZipUrl?: string
  createdAt?: string
  updatedAt?: string
}

type ProjectListResponse = BusinessProject[] | {
  projects?: BusinessProject[]
}

type ProjectStateResponse = AppState | {
  state?: AppState
}

type AgentsResponse = AgentDefinition[] | {
  agents?: AgentDefinition[]
}

const DEFAULT_GROUP_AGENT_IDS = ['product-manager', 'engineer', 'reviewer']

/**
 * Returns the business project id from a backend project record.
 * Input: backend project summary.
 * Output: project id string.
 */
function projectIdOf(project: BusinessProject): string {
  return project.projectId ?? project.id ?? project.workspaceId ?? ''
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
 * Returns project array from the business backend response shape.
 * Input: project list payload.
 * Output: normalized project list.
 */
function extractProjects(payload: ProjectListResponse): BusinessProject[] {
  return Array.isArray(payload) ? payload : payload.projects ?? []
}

/**
 * Returns AppState from the project state response shape.
 * Input: project state payload.
 * Output: normalized AppState.
 */
function extractProjectState(payload: ProjectStateResponse): AppState {
  if ('workspaces' in payload) {
    return payload
  }

  if (payload.state) {
    return payload.state
  }

  throw new Error('Business backend returned an invalid project state payload.')
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
 * Adds project metadata to workspace records returned by AgentHub Runtime state.
 * Input: project summary and raw state.
 * Output: state with workspace.projectId populated where possible.
 */
function attachProjectMetadata(project: BusinessProject, state: AppState): AppState {
  const projectId = projectIdOf(project)
  const workspaceId = project.workspaceId

  return {
    ...state,
    workspaces: state.workspaces.map(workspace => {
      if (workspaceId && workspace.id !== workspaceId) {
        return workspace
      }

      return {
        ...workspace,
        projectId,
        agentHubPreviewUrl: project.agentHubPreviewUrl,
        agentHubZipUrl: project.agentHubZipUrl,
      }
    }),
  }
}

/**
 * Deduplicates AppState entity arrays by id while preserving newest merged state order.
 * Input: entity array.
 * Output: deduplicated array.
 */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map(item => [item.id, item])).values()]
}

/**
 * Merges per-project states into the frontend workbench state.
 * Input: project-scoped AppState snapshots.
 * Output: one state for the multi-workspace UI.
 */
function mergeProjectStates(states: AppState[]): AppState {
  if (!states.length) {
    return createEmptyWorkbenchState()
  }

  return {
    workspaces: uniqueById(states.flatMap(state => state.workspaces)),
    conversations: uniqueById(states.flatMap(state => state.conversations)),
    messages: uniqueById(states.flatMap(state => state.messages)),
    agents: uniqueById(states.flatMap(state => state.agents)),
    agentSessions: uniqueById(states.flatMap(state => state.agentSessions)),
    agentSessionMessages: uniqueById(states.flatMap(state => state.agentSessionMessages)),
    taskHandoffs: uniqueById(states.flatMap(state => state.taskHandoffs)),
    agentRuns: uniqueById(states.flatMap(state => state.agentRuns)),
    artifacts: uniqueById(states.flatMap(state => state.artifacts)),
    changeSets: uniqueById(states.flatMap(state => state.changeSets)),
    contextSnapshots: uniqueById(states.flatMap(state => state.contextSnapshots)),
    workflowEvents: uniqueById(states.flatMap(state => state.workflowEvents)),
    diagnosticLogs: uniqueById(states.flatMap(state => state.diagnosticLogs)),
  }
}

/**
 * Loads the current business project list.
 * Input: none.
 * Output: normalized project summaries.
 */
async function fetchProjects(): Promise<BusinessProject[]> {
  const response = await fetch('/api/projects')
  const payload = await readJson<ProjectListResponse>(response, 'Load business projects')
  return extractProjects(payload)
}

/**
 * Loads available agent definitions from the business backend.
 * Input: none.
 * Output: agent definition list.
 */
async function fetchAgents(): Promise<AgentDefinition[]> {
  const response = await fetch('/api/agents')
  const payload = await readJson<AgentsResponse>(response, 'Load business agents')
  return extractAgents(payload)
}

/**
 * Loads one project workbench state from the business backend.
 * Input: business project summary.
 * Output: normalized AppState with project metadata attached.
 */
async function fetchProjectState(project: BusinessProject): Promise<AppState> {
  const projectId = projectIdOf(project)

  if (!projectId) {
    throw new Error('Business project is missing projectId.')
  }

  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/state`)
  const payload = await readJson<ProjectStateResponse>(response, 'Load business project state')
  return attachProjectMetadata(project, extractProjectState(payload))
}

/**
 * Fetches the full workbench state through the business backend.
 * Input: none.
 * Output: a Promise that resolves to the current multi-project AppState.
 */
export async function fetchBusinessWorkbenchState(): Promise<AppState> {
  const projects = await fetchProjects()

  if (!projects.length) {
    const agents = await fetchAgents().catch(() => [])
    return createEmptyWorkbenchState(agents)
  }

  const states = await Promise.all(projects.map(project => fetchProjectState(project)))
  return mergeProjectStates(states)
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
 * Creates a new product workspace through the business backend.
 * Input: workspace name, goal, type, and optional direct target agent.
 * Output: a Promise that resolves to the updated workbench state.
 */
export async function createBusinessWorkspace(
  name: string,
  goal: string,
  workspaceType: Workspace['workspaceType'] = 'dev',
  targetAgentId?: string,
): Promise<AppState> {
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
  const project = await readJson<BusinessProject>(response, 'Create business project')

  try {
    return await fetchBusinessWorkbenchState()
  } catch {
    return fetchProjectState(project)
  }
}
