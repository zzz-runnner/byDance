import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  AgentHubState,
  CreateAgentHubWorkspaceInput,
  SendAgentHubMessageInput,
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
