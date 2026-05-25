import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Response } from 'express'
import fs from 'fs-extra'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AgentHubClientService } from '../agent-hub/agent-hub.service'
import { AgentHubState, AgentHubWorkspace } from '../agent-hub/agent-hub.types'
import { isoNow } from '../common/time'
import { LocalStorageService } from '../storage/local-storage.service'
import { CreateProjectDto, StreamProjectMessageDto, WriteWorkspaceFileDto } from './projects.dto'
import { ProjectMetadata, ProjectWorkflowSummary } from './project.types'

interface SseParseResult {
  events: Record<string, unknown>[]
  rest: string
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly storage: LocalStorageService,
    private readonly agentHub: AgentHubClientService,
  ) {}

  async createProject(input: CreateProjectDto): Promise<ProjectMetadata> {
    const projectId = `proj-${randomUUID()}`
    const now = isoNow()
    const binding = input.workspaceId
      ? {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        previewUrl: this.agentHub.getPreviewUrl(input.workspaceId),
        zipUrl: this.agentHub.getWorkspaceZipUrl(input.workspaceId),
      }
      : await this.createAgentHubBinding(input)

    const project: ProjectMetadata = {
      projectId,
      name: input.name,
      goal: input.goal,
      workspaceId: binding.workspaceId,
      conversationId: binding.conversationId,
      agentHubPreviewUrl: binding.previewUrl,
      agentHubZipUrl: binding.zipUrl,
      versions: [],
      deployments: [],
      createdAt: now,
      updatedAt: now,
    }

    await this.saveProject(project)
    return project
  }

  async listProjects(): Promise<ProjectMetadata[]> {
    await fs.ensureDir(this.storage.projectsRoot)
    const entries = await fs.readdir(this.storage.projectsRoot)
    const projects = await Promise.all(entries.map(async entry => {
      try {
        return await this.getProject(entry)
      } catch {
        return undefined
      }
    }))

    return projects
      .filter((project): project is ProjectMetadata => Boolean(project))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getProject(projectId: string): Promise<ProjectMetadata> {
    const metadataPath = this.storage.projectMetadataPath(projectId)
    if (!(await fs.pathExists(metadataPath))) {
      throw new NotFoundException(`Project not found: ${projectId}`)
    }
    return fs.readJson(metadataPath) as Promise<ProjectMetadata>
  }

  async updateProject(
    projectId: string,
    updater: (project: ProjectMetadata) => void | Promise<void>,
  ): Promise<ProjectMetadata> {
    const project = await this.getProject(projectId)
    await updater(project)
    project.updatedAt = isoNow()
    await this.saveProject(project)
    return project
  }

  async writeWorkspaceFile(projectId: string, input: WriteWorkspaceFileDto): Promise<{ filePath: string; absolutePath: string }> {
    const project = await this.getProject(projectId)
    const targetPath = this.storage.workspaceFilePath(project.workspaceId, input.filePath)
    await fs.ensureDir(path.dirname(targetPath))
    await fs.writeFile(targetPath, input.content, 'utf8')
    return {
      filePath: input.filePath,
      absolutePath: targetPath,
    }
  }

  async streamProjectMessage(projectId: string, input: StreamProjectMessageDto, response: Response): Promise<void> {
    const project = await this.getProject(projectId)
    const conversationId = input.conversationId ?? project.conversationId
    if (!conversationId) {
      throw new BadRequestException('conversationId is required because this project is not bound to a default AgentHub conversation')
    }

    const upstream = await this.agentHub.streamMessage({
      workspaceId: project.workspaceId,
      conversationId,
      content: input.content,
    })

    if (!upstream.ok || !upstream.body) {
      response.status(upstream.status)
      response.type(upstream.headers.get('content-type') ?? 'text/plain')
      response.send(await upstream.text())
      return
    }

    response.status(upstream.status)
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const workflowEvents: Record<string, unknown>[] = []

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        const text = decoder.decode(value, { stream: true })
        response.write(Buffer.from(value))
        const parsed = this.parseSseFrames(buffer + text)
        buffer = parsed.rest
        workflowEvents.push(...parsed.events)
      }
    } finally {
      response.end()
    }

    if (workflowEvents.length > 0) {
      await this.recordWorkflowEvents(projectId, workflowEvents)
    }
  }

  async recordWorkflowEvents(projectId: string, events: Record<string, unknown>[]): Promise<ProjectMetadata> {
    return this.updateProject(projectId, project => {
      const previous = project.latestWorkflow
      const eventTypes = events
        .map(event => typeof event.type === 'string' ? event.type : undefined)
        .filter((type): type is string => Boolean(type))

      const summary: ProjectWorkflowSummary = {
        lastEventTypes: [...(previous?.lastEventTypes ?? []), ...eventTypes].slice(-30),
        latestChangeSetId: previous?.latestChangeSetId,
        latestPreviewUrl: previous?.latestPreviewUrl,
        deliveryValidationStatus: previous?.deliveryValidationStatus,
        reviewVerdict: previous?.reviewVerdict,
        repairBlockedReason: previous?.repairBlockedReason,
        workflowFinishedAt: previous?.workflowFinishedAt,
        updatedAt: isoNow(),
      }

      for (const event of events) {
        if (event.type === 'change_set_created' && typeof event.changeSetId === 'string') {
          summary.latestChangeSetId = event.changeSetId
        }
        if (event.type === 'preview_ready' && typeof event.previewUrl === 'string') {
          summary.latestPreviewUrl = this.agentHub.toAbsoluteUrl(event.previewUrl)
          project.agentHubPreviewUrl = summary.latestPreviewUrl
        }
        if (event.type === 'delivery_validation_finished' && typeof event.status === 'string') {
          summary.deliveryValidationStatus = event.status
        }
        if (event.type === 'review_verdict' && typeof event.verdict === 'string') {
          summary.reviewVerdict = event.verdict
        }
        if (event.type === 'repair_blocked' && typeof event.reason === 'string') {
          summary.repairBlockedReason = event.reason
        }
        if (event.type === 'workflow_finished') {
          summary.workflowFinishedAt = isoNow()
        }
      }

      project.latestWorkflow = summary
    })
  }

  private async createAgentHubBinding(input: CreateProjectDto): Promise<{
    workspaceId: string
    conversationId?: string
    previewUrl: string
    zipUrl: string
  }> {
    const state = await this.agentHub.createWorkspace({
      name: input.name,
      goal: input.goal,
      workspaceType: input.workspaceType ?? 'dev',
    })
    const workspace = this.selectCreatedWorkspace(state, input.name)
    const conversation = state.conversations
      ?.filter(item => item.workspaceId === workspace.id && item.type === 'group')
      .at(-1)

    return {
      workspaceId: workspace.id,
      conversationId: conversation?.id,
      previewUrl: workspace.previewUrl
        ? this.agentHub.toAbsoluteUrl(workspace.previewUrl)
        : this.agentHub.getPreviewUrl(workspace.id),
      zipUrl: this.agentHub.getWorkspaceZipUrl(workspace.id),
    }
  }

  private selectCreatedWorkspace(state: AgentHubState, name: string): AgentHubWorkspace {
    const workspace = state.workspaces
      ?.filter(item => item.name === name)
      .at(-1) ?? state.workspaces?.at(-1)

    if (!workspace) {
      throw new BadRequestException('AgentHub did not return a workspace after creation')
    }
    return workspace
  }

  private async saveProject(project: ProjectMetadata): Promise<void> {
    await fs.ensureDir(this.storage.projectDir(project.projectId))
    await fs.writeJson(this.storage.projectMetadataPath(project.projectId), project, { spaces: 2 })
  }

  private parseSseFrames(input: string): SseParseResult {
    const frames = input.split(/\r?\n\r?\n/)
    const rest = frames.pop() ?? ''
    const events = frames.flatMap(frame => {
      const data = frame
        .split(/\r?\n/)
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice('data: '.length))
        .join('\n')

      if (!data) {
        return []
      }

      try {
        const parsed = JSON.parse(data) as unknown
        return typeof parsed === 'object' && parsed !== null ? [parsed as Record<string, unknown>] : []
      } catch {
        return []
      }
    })

    return { events, rest }
  }
}
