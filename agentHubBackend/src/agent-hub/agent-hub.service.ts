import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  AgentHubAgent,
  AgentHubState,
  CreateAgentHubConversationInput,
  CreateAgentHubWorkspaceInput,
  SendAgentHubMessageInput,
  WorkspaceDiffResponse,
  WorkspaceFileContentResponse,
  WorkspaceFileTreeResponse,
  WorkspaceOverviewBatchInput,
  WorkspaceOverviewBatchResponse,
  WorkspacePreviewTargetsResponse,
} from './agent-hub.types'

@Injectable()
export class AgentHubClientService {
  private readonly baseUrl: string

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('AGENTHUB_BASE_URL', 'http://127.0.0.1:8787')
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  toAbsoluteUrl(url: string): string {
    return new URL(url, this.baseUrl).toString()
  }

  getPreviewUrl(workspaceId: string): string {
    return this.toAbsoluteUrl(`/preview/${encodeURIComponent(workspaceId)}/index.html`)
  }

  getWorkspaceZipUrl(workspaceId: string): string {
    return this.toAbsoluteUrl(`/api/workspaces/${encodeURIComponent(workspaceId)}/zip`)
  }

  async health(): Promise<unknown> {
    return this.getJson('/api/health')
  }

  async createWorkspace(input: CreateAgentHubWorkspaceInput): Promise<AgentHubState> {
    return this.postJson('/api/workspaces', {
      name: input.name,
      goal: input.goal,
      workspaceType: input.workspaceType ?? 'dev',
    })
  }

  /**
   * Loads the full runtime state snapshot from AgentHub.
   * Input: none.
   * Output: runtime entity collections for one current backend poll.
   */
  async fetchState(): Promise<AgentHubState> {
    return this.getJson('/api/state')
  }

  /**
   * Loads the registered runtime agent definitions from AgentHub.
   * Input: none.
   * Output: lightweight runtime agent list.
   */
  async fetchAgents(): Promise<AgentHubAgent[]> {
    return this.getJson('/api/agents')
  }

  /**
   * Creates one runtime conversation for a workspace.
   * Input: workspace id, room type, title, and participants.
   * Output: updated runtime state after the conversation is created.
   */
  async createConversation(input: CreateAgentHubConversationInput): Promise<AgentHubState> {
    return this.postJson('/api/conversations', input)
  }

  async streamMessage(input: SendAgentHubMessageInput): Promise<Response> {
    try {
      return await fetch(this.url('/api/messages/stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    } catch (error) {
      throw new ServiceUnavailableException(`AgentHub stream request failed: ${this.errorMessage(error)}`)
    }
  }

  /**
   * Loads the browser-visible workspace file tree.
   * Input: runtime workspace id.
   * Output: nested file-tree payload for the code dialog.
   */
  async fetchWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileTreeResponse> {
    return this.getJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`)
  }

  /**
   * Loads one UTF-8 file from the runtime workspace repo.
   * Input: workspace id and repo-relative file path.
   * Output: file content plus editor metadata.
   */
  async fetchWorkspaceFileContent(
    workspaceId: string,
    filePath: string,
  ): Promise<WorkspaceFileContentResponse> {
    const query = new URLSearchParams({ path: filePath })
    return this.getJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/files/content?${query.toString()}`)
  }

  /**
   * Loads the current git diff snapshot for a workspace repo.
   * Input: runtime workspace id.
   * Output: status summary plus unified patch.
   */
  async fetchWorkspaceDiff(workspaceId: string): Promise<WorkspaceDiffResponse> {
    return this.getJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/diff`)
  }

  /**
   * Loads lightweight room summaries for one paged workspace slice.
   * Input: workspace ids plus frontend binding hints.
   * Output: room summary array for the left workspace rail.
   */
  async fetchWorkspaceOverviewBatch(
    input: WorkspaceOverviewBatchInput,
  ): Promise<WorkspaceOverviewBatchResponse> {
    return this.postJson('/api/workspaces/overview-batch', input)
  }

  /**
   * Loads the static preview targets available inside one workspace repo.
   * Input: runtime workspace id.
   * Output: ordered preview targets plus the default target.
   */
  async fetchWorkspacePreviewTargets(workspaceId: string): Promise<WorkspacePreviewTargetsResponse> {
    return this.getJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/preview-targets`)
  }

  /**
   * Proxies one arbitrary runtime request without JSON decoding.
   * Input: runtime-relative pathname and optional fetch init.
   * Output: raw upstream HTTP response.
   */
  async proxy(pathname: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(this.url(pathname), init)
    } catch (error) {
      throw new ServiceUnavailableException(`AgentHub request failed: ${this.errorMessage(error)}`)
    }
  }

  private async getJson<T>(pathname: string): Promise<T> {
    try {
      const response = await fetch(this.url(pathname))
      return this.parseJsonResponse<T>(response)
    } catch (error) {
      throw new ServiceUnavailableException(`AgentHub request failed: ${this.errorMessage(error)}`)
    }
  }

  private async postJson<T>(pathname: string, body: unknown): Promise<T> {
    try {
      const response = await fetch(this.url(pathname), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return this.parseJsonResponse<T>(response)
    } catch (error) {
      throw new ServiceUnavailableException(`AgentHub request failed: ${this.errorMessage(error)}`)
    }
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw new ServiceUnavailableException(`AgentHub returned ${response.status}: ${await response.text()}`)
    }
    return response.json() as Promise<T>
  }

  private url(pathname: string): string {
    return new URL(pathname, this.baseUrl).toString()
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
