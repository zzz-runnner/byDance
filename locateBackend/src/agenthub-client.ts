import { z } from 'zod'
import type {
  CodeSelectionReference,
  ConversationType,
  ProjectFileContent,
  ProjectFileNode,
  ProjectWorkspaceDiff,
  RuntimeAppState,
  WorkspaceType,
} from './types.js'

const RuntimeAppStateSchema = z.object({
  workspaces: z.array(z.record(z.string(), z.unknown())),
  conversations: z.array(z.record(z.string(), z.unknown())),
  messages: z.array(z.record(z.string(), z.unknown())),
  agents: z.array(z.record(z.string(), z.unknown())),
  agentSessions: z.array(z.record(z.string(), z.unknown())),
  agentSessionMessages: z.array(z.record(z.string(), z.unknown())),
  taskHandoffs: z.array(z.record(z.string(), z.unknown())),
  agentRuns: z.array(z.record(z.string(), z.unknown())),
  artifacts: z.array(z.record(z.string(), z.unknown())),
  changeSets: z.array(z.record(z.string(), z.unknown())),
  contextSnapshots: z.array(z.record(z.string(), z.unknown())),
  workflowEvents: z.array(z.record(z.string(), z.unknown())),
  diagnosticLogs: z.array(z.record(z.string(), z.unknown())),
})

export class AgentHubClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Loads the AgentHub health payload.
   * Input: none.
   * Output: upstream health response JSON.
   */
  async health(): Promise<unknown> {
    return this.fetchJson('/api/health')
  }

  /**
   * Loads the full AgentHub runtime state.
   * Input: none.
   * Output: validated runtime state snapshot.
   */
  async fetchState(): Promise<RuntimeAppState> {
    const state = await this.fetchJson('/api/state')
    return RuntimeAppStateSchema.parse(state) as RuntimeAppState
  }

  /**
   * Creates one runtime workspace through AgentHub.
   * Input: workspace name, goal, and type.
   * Output: updated runtime state after workspace creation.
   */
  async createWorkspace(input: {
    name: string
    goal: string
    workspaceType: WorkspaceType
  }): Promise<RuntimeAppState> {
    const state = await this.fetchJson('/api/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })

    return RuntimeAppStateSchema.parse(state) as RuntimeAppState
  }

  /**
   * Creates one runtime conversation through AgentHub.
   * Input: workspace id, conversation type, title, and participants.
   * Output: updated runtime state after conversation creation.
   */
  async createConversation(input: {
    workspaceId: string
    type: ConversationType
    title: string
    participants: string[]
  }): Promise<RuntimeAppState> {
    const state = await this.fetchJson('/api/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })

    return RuntimeAppStateSchema.parse(state) as RuntimeAppState
  }

  /**
   * Opens one upstream SSE message stream against AgentHub.
   * Input: workspace id, conversation id, content, and optional direct agent id.
   * Output: raw upstream HTTP response.
   */
  async streamMessage(input: {
    workspaceId: string
    conversationId: string
    content: string
    agentId?: string
    replyTo?: {
      messageId: string
      senderId: string
      senderName?: string
      excerpt: string
    }
    codeSelection?: CodeSelectionReference
  }): Promise<Response> {
    return fetch(this.url('/api/messages/stream'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  }

  /**
   * Loads the visible workspace file tree from AgentHub.
   * Input: workspace id. Output: nested file nodes for the browser panel.
   */
  async fetchWorkspaceFiles(workspaceId: string): Promise<{ entries: ProjectFileNode[] }> {
    return this.fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`) as Promise<{ entries: ProjectFileNode[] }>
  }

  /**
   * Loads one UTF-8 workspace file from AgentHub.
   * Input: workspace id and repo-relative path. Output: file content plus metadata.
   */
  async fetchWorkspaceFileContent(workspaceId: string, filePath: string): Promise<ProjectFileContent> {
    const query = new URLSearchParams({ path: filePath })
    return this.fetchJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/content?${query.toString()}`,
    ) as Promise<ProjectFileContent>
  }

  /**
   * Loads the current git diff snapshot for one workspace.
   * Input: workspace id. Output: status summary and unified patch.
   */
  async fetchWorkspaceDiff(workspaceId: string): Promise<ProjectWorkspaceDiff> {
    return this.fetchJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/diff`) as Promise<ProjectWorkspaceDiff>
  }

  /**
   * Proxies one arbitrary GET-like request to AgentHub.
   * Input: upstream pathname and optional fetch init.
   * Output: raw upstream HTTP response.
   */
  async proxy(pathname: string, init?: RequestInit): Promise<Response> {
    return fetch(this.url(pathname), init)
  }

  /**
   * Fetches JSON from AgentHub and raises a useful error on failure.
   * Input: upstream pathname and optional fetch init.
   * Output: parsed JSON payload.
   */
  private async fetchJson(pathname: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(this.url(pathname), init)

    if (!response.ok) {
      throw new Error(`AgentHub request failed: ${response.status} ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Resolves one AgentHub-relative pathname into an absolute URL.
   * Input: upstream pathname.
   * Output: absolute upstream URL string.
   */
  private url(pathname: string): string {
    return new URL(pathname, this.baseUrl).toString()
  }
}
