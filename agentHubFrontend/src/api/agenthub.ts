import type { AppState, StreamMessageInput, Workspace, WorkflowEvent } from '../types'

/**
 * Fetches the full AgentHub application state from the local API.
 * Input: none.
 * Output: a Promise that resolves to the current AppState.
 */
export async function fetchAgentHubState(): Promise<AppState> {
  const response = await fetch('/api/state')

  if (!response.ok) {
    throw new Error(`Failed to load AgentHub state: ${response.status}`)
  }

  return response.json() as Promise<AppState>
}

/**
 * Sends one chat message to the streaming AgentHub API.
 * Input: message payload and a callback for parsed workflow events.
 * Output: a Promise that resolves after the stream closes.
 */
export async function streamAgentHubMessage(
  input: StreamMessageInput,
  onEvent: (event: WorkflowEvent) => void,
): Promise<void> {
  const response = await fetch('/api/messages/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to stream AgentHub message: ${response.status}`)
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
 * Creates a new workspace room through the local API.
 * Input: workspace name, goal, type, and optional direct target agent.
 * Output: a Promise that resolves to the updated AppState.
 */
export async function createWorkspace(
  name: string,
  goal: string,
  workspaceType: Workspace['workspaceType'] = 'dev',
  targetAgentId?: string,
): Promise<AppState> {
  const response = await fetch('/api/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      goal,
      workspaceType,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to create workspace: ${response.status}`)
  }

  const createdState = await response.json() as AppState

  if (!targetAgentId) {
    return createdState
  }

  const workspace = [...createdState.workspaces].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

  if (!workspace) {
    return createdState
  }

  const directResponse = await fetch('/api/conversations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workspaceId: workspace.id,
      type: 'direct',
      title: `${targetAgentId} 单聊工作区`,
      participants: ['user', targetAgentId],
    }),
  })

  if (!directResponse.ok) {
    throw new Error(`Failed to create direct workspace room: ${directResponse.status}`)
  }

  return directResponse.json() as Promise<AppState>
}
