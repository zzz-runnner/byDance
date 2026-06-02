import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Response as ExpressResponse } from 'express'
import fs from 'fs-extra'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AgentHubClientService } from '../agent-hub/agent-hub.service'
import { AgentHubState, AgentHubWorkspace } from '../agent-hub/agent-hub.types'
import { CreateAgentDto, UpdateAgentDto } from '../agents/agents.dto'
import { agentDisplayName, findMentionedAgentId, stripLeadingOrchestratorMention } from '../common/agent-presentation'
import { isoNow } from '../common/time'
import { readConfig } from '../config'
import { PreviewAsset, PreviewService } from '../preview-service'
import {
  buildWorkbenchOverviewPage,
  previewUrlFor,
  selectProjectConversation,
  selectProjectState,
  zipUrlFor,
} from '../state-bridge'
import { LocalStorageService } from '../storage/local-storage.service'
import type {
  ConversationType,
  ProjectDeliverySummaryResponse,
  ProjectStateResponse,
  ProjectWorkspaceDiff,
  StoredProjectRecord,
  WorkbenchOverviewResponse,
  WorkspaceType,
} from '../types'
import { ProjectMetadataStore } from './project-metadata.store'
import {
  CreateProjectDto,
  FileContentQueryDto,
  PreviewBuildQueryDto,
  ProjectStateQueryDto,
  StreamProjectMessageDto,
  UpdateProjectMetadataDto,
  WorkbenchQueryDto,
  WriteWorkspaceFileDto,
} from './projects.dto'
import { ProjectMetadata, ProjectWorkflowSummary } from './project.types'

interface SseParseResult {
  events: Record<string, unknown>[]
  rest: string
}

@Injectable()
export class ProjectsService {
  private readonly previewService = new PreviewService(readConfig())

  constructor(
    private readonly storage: LocalStorageService,
    private readonly projectStore: ProjectMetadataStore,
    private readonly agentHub: AgentHubClientService,
  ) {}

  /**
   * Creates one business project and binds it to a runtime workspace room.
   * Input: workspace goal, room mode, and optional direct target agent.
   * Output: persisted project metadata.
   */
  async createProject(input: CreateProjectDto): Promise<ProjectMetadata> {
    const projectId = `proj-${randomUUID()}`
    const now = isoNow()
    const conversationType = resolveConversationType(input)
    const directAgentId = resolveDirectAgentId(input)
    const binding = input.workspaceId
      ? {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          conversationType,
          targetAgentId: directAgentId,
        }
      : await this.createAgentHubBinding(input, conversationType, directAgentId)

    const project: ProjectMetadata = {
      projectId,
      name: input.name,
      goal: input.goal,
      workspaceId: binding.workspaceId,
      conversationId: binding.conversationId,
      conversationType: binding.conversationType,
      targetAgentId: binding.targetAgentId,
      agentHubPreviewUrl: previewUrlFor(binding.workspaceId),
      agentHubZipUrl: zipUrlFor(binding.workspaceId),
      versions: [],
      deployments: [],
      createdAt: now,
      updatedAt: now,
    }

    await this.saveProject(project)
    return project
  }

  /**
   * Lists persisted business projects in descending update order.
   * Input: none.
   * Output: stored project metadata array.
   */
  async listProjects(): Promise<ProjectMetadata[]> {
    return this.projectStore.listProjects()
  }

  /**
   * Loads one persisted project by business id.
   * Input: project id.
   * Output: stored project metadata.
   */
  async getProject(projectId: string): Promise<ProjectMetadata> {
    const project = await this.projectStore.getProject(projectId)
    if (!project) {
      throw new NotFoundException(`Project not found: ${projectId}`)
    }
    return project
  }

  /**
   * Loads the lightweight workbench page used by the left workspace list.
   * Input: page size, optional cursor, and optional query string.
   * Output: room summaries plus agent definitions.
   */
  async getWorkbenchOverview(query: WorkbenchQueryDto): Promise<WorkbenchOverviewResponse> {
    const limit = query.pageSize ?? query.limit
    const searchQuery = query.query ?? query.q
    const projectPage = await this.projectStore.listProjectsPage({
      limit,
      cursor: query.cursor,
      query: searchQuery,
      status: query.status,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
    })
    const [agents, roomBatch] = await Promise.all([
      this.agentHub.fetchAgents(),
      projectPage.items.length > 0
        ? this.agentHub.fetchWorkspaceOverviewBatch({
            items: projectPage.items.map(project => ({
              workspaceId: project.workspaceId,
              conversationType: project.conversationType,
              targetAgentId: project.targetAgentId,
            })),
          })
        : Promise.resolve({ rooms: [] }),
    ])

    return buildWorkbenchOverviewPage(
      agents,
      projectPage.items.map(project => this.toStoredProject(project)),
      roomBatch.rooms,
      {
        limit,
        nextCursor: projectPage.nextCursor,
        hasMore: projectPage.hasMore,
        total: projectPage.total,
        status: query.status,
        sortBy: query.sortBy,
        sortDirection: query.sortDirection,
        query: searchQuery,
      },
    )
  }

  /**
   * Loads the runtime agent definitions visible to the frontend.
   * Input: none.
   * Output: agent definition array from AgentHub.
   */
  async listAgents() {
    return this.agentHub.fetchAgents()
  }

  async listProjectAgents(projectId: string) {
    const project = await this.getProject(projectId)
    return this.agentHub.fetchWorkspaceAgents(project.workspaceId)
  }

  async getProjectAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId)
    return this.agentHub.fetchWorkspaceAgent(project.workspaceId, agentId)
  }

  async createProjectAgent(projectId: string, input: CreateAgentDto) {
    const project = await this.getProject(projectId)
    return this.agentHub.createWorkspaceAgent(project.workspaceId, input)
  }

  async updateProjectAgent(projectId: string, agentId: string, input: UpdateAgentDto) {
    const project = await this.getProject(projectId)
    return this.agentHub.updateWorkspaceAgent(project.workspaceId, agentId, input)
  }

  async deleteProjectAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId)
    return this.agentHub.deleteWorkspaceAgent(project.workspaceId, agentId)
  }

  /**
   * Loads one project-scoped runtime state page for the active chat pane.
   * Input: project id and recent-message page options.
   * Output: filtered runtime state plus message-page metadata.
   */
  async getProjectState(
    projectId: string,
    query: ProjectStateQueryDto,
  ): Promise<ProjectStateResponse> {
    const project = await this.getProject(projectId)
    const state = await this.agentHub.fetchState()
    return selectProjectState(state, project, {
      messageLimit: query.messageLimit,
    })
  }

  /**
   * Summarizes the latest source archive, build artifact, and local deployment status.
   * Input: project id.
   * Output: frontend-ready delivery summary for the current project workspace.
   */
  async getProjectDeliverySummary(projectId: string): Promise<ProjectDeliverySummaryResponse> {
    const project = await this.getProject(projectId)
    const currentVersion = project.currentVersionId
      ? project.versions.find(version => version.versionId === project.currentVersionId)
      : undefined
    const latestDeployment = project.deployments
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

    return {
      projectId: project.projectId,
      currentVersion: currentVersion
        ? {
            versionId: currentVersion.versionId,
            createdAt: currentVersion.createdAt,
            updatedAt: currentVersion.updatedAt,
          }
        : undefined,
      sourceArchive: currentVersion
        ? {
            status: 'ready',
            summary: `源码快照 ${currentVersion.versionId} 已可下载`,
            versionId: currentVersion.versionId,
            url: currentVersion.sourceZipUrl,
            createdAt: currentVersion.createdAt,
            updatedAt: currentVersion.updatedAt,
          }
        : {
            status: 'idle',
            summary: '当前还没有保存源码快照',
          },
      build: currentVersion?.buildStatus === 'success'
        ? {
            status: 'ready',
            summary: `交付构建 ${currentVersion.versionId} 已完成`,
            versionId: currentVersion.versionId,
            url: currentVersion.buildPreviewUrl,
            createdAt: currentVersion.createdAt,
            updatedAt: currentVersion.updatedAt,
            log: currentVersion.buildLog,
          }
        : currentVersion?.buildStatus === 'failed'
          ? {
              status: 'failed',
              summary: `交付构建 ${currentVersion.versionId} 失败`,
              versionId: currentVersion.versionId,
              createdAt: currentVersion.createdAt,
              updatedAt: currentVersion.updatedAt,
              log: currentVersion.buildLog,
            }
          : currentVersion
            ? {
                status: 'idle',
                summary: `版本 ${currentVersion.versionId} 还没有生成交付构建`,
                versionId: currentVersion.versionId,
                createdAt: currentVersion.createdAt,
                updatedAt: currentVersion.updatedAt,
              }
            : {
                status: 'idle',
                summary: '当前还没有可构建的源码版本',
              },
      deployment: latestDeployment
        ? {
            status: 'ready',
            summary: `本地部署已更新到 ${latestDeployment.versionId}`,
            versionId: latestDeployment.versionId,
            url: latestDeployment.deployUrl,
            createdAt: latestDeployment.createdAt,
          }
        : {
            status: 'idle',
            summary: '当前还没有本地部署结果',
          },
    }
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

  async updateProjectMetadata(
    projectId: string,
    input: UpdateProjectMetadataDto,
  ): Promise<ProjectMetadata> {
    return this.updateProject(projectId, project => {
      if (input.pinned !== undefined) {
        project.pinnedAt = input.pinned ? isoNow() : undefined
      }
      if (input.archived !== undefined) {
        project.archivedAt = input.archived ? isoNow() : undefined
      }
    })
  }

  async setProjectPinned(projectId: string, pinned: boolean): Promise<ProjectMetadata> {
    return this.updateProjectMetadata(projectId, { pinned })
  }

  async setProjectArchived(projectId: string, archived: boolean): Promise<ProjectMetadata> {
    return this.updateProjectMetadata(projectId, { archived })
  }

  /**
   * Loads the current workspace file tree for the selected project.
   * Input: project id.
   * Output: repo-root label plus nested file entries.
   */
  async getProjectFiles(projectId: string): Promise<{ rootLabel: string; entries: Awaited<ReturnType<AgentHubClientService['fetchWorkspaceFiles']>>['entries'] }> {
    const project = await this.getProject(projectId)
    const fileTree = await this.agentHub.fetchWorkspaceFiles(project.workspaceId)
    return {
      rootLabel: `${project.name} / repo`,
      entries: fileTree.entries,
    }
  }

  /**
   * Loads one UTF-8 repo file from the selected project workspace.
   * Input: project id and repo-relative file path.
   * Output: file content plus editor metadata.
   */
  async getProjectFileContent(projectId: string, query: FileContentQueryDto) {
    const project = await this.getProject(projectId)
    return this.agentHub.fetchWorkspaceFileContent(project.workspaceId, query.path)
  }

  /**
   * Loads the current git diff snapshot for the selected workspace repo.
   * Input: project id.
   * Output: repo status summary and unified patch.
   */
  async getProjectDiff(projectId: string): Promise<ProjectWorkspaceDiff> {
    const project = await this.getProject(projectId)
    return this.agentHub.fetchWorkspaceDiff(project.workspaceId)
  }

  /**
   * Loads the static preview targets discovered inside one workspace repo.
   * Input: project id.
   * Output: ordered preview targets plus the default target.
   */
  async getProjectPreviewTargets(projectId: string) {
    const project = await this.getProject(projectId)
    return this.agentHub.fetchWorkspacePreviewTargets(project.workspaceId)
  }

  /**
   * Detects the current preview capability for one workspace repo.
   * Input: project id.
   * Output: preview mode, targets, and optional build state.
   */
  async getProjectPreviewCapability(projectId: string) {
    const project = await this.getProject(projectId)
    return this.previewService.getPreviewCapability(this.toStoredProject(project))
  }

  /**
   * Starts or retries one local preview build for the selected workspace repo.
   * Input: project id and optional force flag.
   * Output: refreshed preview capability payload.
   */
  async startProjectPreviewBuild(projectId: string, query: PreviewBuildQueryDto) {
    const project = await this.getProject(projectId)
    return this.previewService.startPreviewBuild(this.toStoredProject(project), {
      force: query.force,
    })
  }

  /**
   * Streams the runtime zip archive proxy for one workspace.
   * Input: workspace id and downstream Express response.
   * Output: buffered zip payload sent to the browser.
   */
  async proxyWorkspaceZip(workspaceId: string, response: ExpressResponse): Promise<void> {
    const upstream = await this.agentHub.proxy(`/api/workspaces/${encodeURIComponent(workspaceId)}/zip`)
    await this.sendBufferedResponse(response, upstream)
  }

  /**
   * Buffers and forwards one runtime preview response from AgentHub.
   * Input: downstream pathname and Express response.
   * Output: proxied response body sent to the browser.
   */
  async proxyPreview(pathname: string, response: ExpressResponse): Promise<void> {
    const upstream = await this.agentHub.proxy(pathname)
    await this.sendBufferedResponse(response, upstream)
  }

  /**
   * Serves one runtime preview asset detected from the local workspace repo.
   * Input: project id, optional asset path, optional module-shell entry, and response.
   * Output: streamed or inline preview asset response.
   */
  async sendRuntimePreview(
    projectId: string,
    requestedPath: string | undefined,
    entry: string | undefined,
    response: ExpressResponse,
  ): Promise<void> {
    const project = await this.getProject(projectId)
    const previewAsset = await this.previewService.openRuntimePreviewAsset(
      this.toStoredProject(project),
      requestedPath,
      entry,
    )
    await this.sendPreviewAsset(response, previewAsset)
  }

  /**
   * Serves one built preview asset from the shared local preview cache.
   * Input: project id, source hash, optional asset path, and response.
   * Output: streamed or inline built preview response.
   */
  async sendBuiltPreview(
    projectId: string,
    sourceHash: string,
    requestedPath: string | undefined,
    response: ExpressResponse,
  ): Promise<void> {
    const project = await this.getProject(projectId)
    const previewAsset = await this.previewService.openBuiltPreviewAsset(
      this.toStoredProject(project),
      sourceHash,
      requestedPath,
    )
    await this.sendPreviewAsset(response, previewAsset)
  }

  /**
   * Sends one preview asset as inline HTML or a local file response.
   * Input: downstream Express response and one resolved preview asset.
   * Output: preview body written to the browser.
   */
  private async sendPreviewAsset(
    response: ExpressResponse,
    asset: PreviewAsset,
  ): Promise<void> {
    response.type(asset.contentType)
    response.setHeader('Cache-Control', 'no-cache')

    if (asset.kind === 'html') {
      response.send(asset.content)
      return
    }

    await new Promise<void>((resolve, reject) => {
      response.sendFile(asset.filePath, error => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  /**
   * Writes one manual file edit back to the workspace repo on disk.
   * Input: project id and file write payload.
   * Output: written repo-relative path and absolute file location.
   */
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

  /**
   * Proxies one project message stream to AgentHub while recording workflow events.
   * Input: project id, stream payload, and downstream Express response.
   * Output: forwarded SSE response body and persisted workflow summary fields.
   */
  async streamProjectMessage(projectId: string, input: StreamProjectMessageDto, response: ExpressResponse): Promise<void> {
    const project = await this.getProject(projectId)
    const conversationId = input.conversationId ?? project.conversationId
    if (!conversationId) {
      throw new BadRequestException('conversationId is required because this project is not bound to a default AgentHub conversation')
    }

    const [state, workspaceAgents] = await Promise.all([
      this.agentHub.fetchState(),
      this.agentHub.fetchWorkspaceAgents(project.workspaceId),
    ])
    const conversation = resolveStreamConversation(
      state.conversations,
      this.toStoredProject(project),
      input.conversationId,
    )
    const targetAgentId = this.resolveStreamTargetAgentId(project, input, state, workspaceAgents)
    const normalizedContent =
      conversation?.type === 'group' && !targetAgentId
        ? stripLeadingOrchestratorMention(input.content, workspaceAgents) || input.content.trim()
        : input.content
    const upstream = await this.agentHub.streamMessage({
      workspaceId: project.workspaceId,
      conversationId,
      content: normalizedContent,
      ...(targetAgentId ? { agentId: targetAgentId } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.codeSelection ? { codeSelection: input.codeSelection } : {}),
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
          summary.latestPreviewUrl = event.previewUrl
          project.agentHubPreviewUrl = previewUrlFor(project.workspaceId)
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

  /**
   * Creates the runtime workspace and selected room for one new business project.
   * Input: create-project payload, normalized room mode, and optional direct agent id.
   * Output: workspace and conversation binding details.
   */
  private async createAgentHubBinding(
    input: CreateProjectDto,
    conversationType: ConversationType,
    directAgentId?: string,
  ): Promise<{
    workspaceId: string
    conversationId?: string
    conversationType: ConversationType
    targetAgentId?: string
  }> {
    const state = await this.agentHub.createWorkspace({
      name: input.name,
      goal: input.goal,
      workspaceType: normalizeWorkspaceType(input.workspaceType ?? 'dev', conversationType),
    })
    const workspace = this.selectCreatedWorkspace(state, input.name)

    let nextState = state
    if (conversationType === 'direct' && directAgentId) {
      const directAgent = requireAgent(state, directAgentId)
      nextState = await this.agentHub.createConversation(
        buildDirectConversationInput(workspace.id, directAgent),
      )
    }

    const conversation = selectProjectConversation(
      nextState.conversations,
      workspace.id,
      conversationType,
      directAgentId,
    )
    if (!conversation) {
      throw new BadRequestException(`AgentHub did not create a conversation for workspace ${workspace.id}`)
    }

    return {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      conversationType,
      targetAgentId: directAgentId,
    }
  }

  /**
   * Chooses the newest created workspace from one runtime state snapshot.
   * Input: runtime state and requested workspace name.
   * Output: matching runtime workspace or the newest fallback.
   */
  private selectCreatedWorkspace(state: AgentHubState, name: string): AgentHubWorkspace {
    const workspace = state.workspaces
      ?.filter(item => item.name === name)
      .at(-1) ?? state.workspaces?.at(-1)

    if (!workspace) {
      throw new BadRequestException('AgentHub did not return a workspace after creation')
    }
    return workspace
  }

  /**
   * Converts project metadata into the lightweight record shape used by local adapters.
   * Input: stored project metadata.
   * Output: frontend-oriented stored project record.
   */
  private toStoredProject(project: ProjectMetadata): StoredProjectRecord {
    return {
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      name: project.name,
      goal: project.goal,
      conversationId: project.conversationId ?? '',
      conversationType: project.conversationType,
      targetAgentId: project.targetAgentId,
      pinnedAt: project.pinnedAt,
      archivedAt: project.archivedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }
  }

  /**
   * Persists one updated project record into the configured metadata store.
   * Input: full project metadata payload.
   * Output: project metadata written to disk or PostgreSQL.
   */
  private async saveProject(project: ProjectMetadata): Promise<void> {
    await this.projectStore.saveProject(project)
  }

  /**
   * Resolves the current target agent for one streamed message request.
   * Input: stored project binding, stream payload, and current runtime state.
   * Output: one explicit target agent id or undefined for default routing.
   */
  private resolveStreamTargetAgentId(
    project: ProjectMetadata,
    input: StreamProjectMessageDto,
    state: AgentHubState,
    workspaceAgents: AgentHubState['agents'],
  ): string | undefined {
    if (input.agentId?.trim()) {
      return input.agentId.trim()
    }

    const conversation = resolveStreamConversation(
      state.conversations,
      this.toStoredProject(project),
      input.conversationId,
    )
    if (!conversation) {
      return project.targetAgentId
    }

    if (conversation.type === 'direct') {
      return conversation.participants.find(participant => participant !== 'user') ?? project.targetAgentId
    }

    const candidateAgents = workspaceAgents.filter(agent => conversation.participants.includes(agent.id))
    const mentionedAgentId = resolveMentionTargetAgentId(input.content, candidateAgents)
    if (mentionedAgentId) {
      return mentionedAgentId
    }
    if (input.codeSelection) {
      return candidateAgents.some(agent => agent.id === 'engineer') ? 'engineer' : undefined
    }
    return undefined
  }

  /**
   * Forwards safe upstream headers and response bytes to the browser.
   * Input: downstream Express response and upstream fetch response.
   * Output: buffered response body written to the client.
   */
  private async sendBufferedResponse(response: ExpressResponse, upstream: globalThis.Response): Promise<void> {
    response.status(upstream.status)
    for (const [name, value] of upstream.headers.entries()) {
      if (!BLOCKED_FORWARD_HEADERS.has(name.toLowerCase())) {
        response.setHeader(name, value)
      }
    }
    response.send(Buffer.from(await upstream.arrayBuffer()))
  }

  /**
   * Parses complete SSE frames out of one partial text buffer.
   * Input: accumulated UTF-8 text.
   * Output: parsed JSON events plus the unread remainder.
   */
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

const BLOCKED_FORWARD_HEADERS = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'transfer-encoding',
])

/**
 * Resolves the preferred room type for one project creation request.
 * Input: raw create-project payload.
 * Output: normalized group or direct conversation type.
 */
function resolveConversationType(input: CreateProjectDto): ConversationType {
  return input.conversationType === 'direct' ? 'direct' : 'group'
}

/**
 * Resolves the direct target agent requested by the user.
 * Input: raw create-project payload.
 * Output: direct agent id or undefined for group rooms.
 */
function resolveDirectAgentId(input: CreateProjectDto): string | undefined {
  if (input.conversationType !== 'direct') {
    return undefined
  }

  return input.agentIds?.find(Boolean) ?? 'engineer'
}

/**
 * Normalizes the runtime workspace type for direct-chat rooms.
 * Input: requested workspace type and normalized room mode.
 * Output: runtime workspace type accepted by AgentHub.
 */
function normalizeWorkspaceType(
  workspaceType: WorkspaceType,
  conversationType: ConversationType,
): WorkspaceType {
  return conversationType === 'direct' ? 'chat' : workspaceType
}

/**
 * Ensures one requested direct agent exists in the runtime state snapshot.
 * Input: runtime state and requested agent id.
 * Output: matching runtime agent definition.
 */
function requireAgent(state: AgentHubState, agentId: string) {
  const agent = state.agents.find(candidate => candidate.id === agentId)
  if (!agent) {
    throw new BadRequestException(`Unknown direct agent: ${agentId}`)
  }
  return agent
}

/**
 * Builds the runtime direct-room payload for one selected agent.
 * Input: workspace id and target agent.
 * Output: AgentHub conversation creation payload.
 */
function buildDirectConversationInput(workspaceId: string, agent: AgentHubState['agents'][number]) {
  return {
    workspaceId,
    type: 'direct' as const,
    title: `${agentDisplayName(agent)} 私聊`,
    participants: ['user', agent.id],
  }
}

/**
 * Resolves the current runtime conversation for one stream request.
 * Input: runtime conversation list, stored project binding, and optional conversation override.
 * Output: matching conversation or undefined when unavailable.
 */
function resolveStreamConversation(
  conversations: AgentHubState['conversations'],
  project: StoredProjectRecord,
  conversationId?: string,
) {
  const targetConversationId = conversationId ?? project.conversationId
  return conversations.find(conversation => conversation.id === targetConversationId)
}

/**
 * Detects one unique explicit @mention target inside a group message.
 * Input: raw message content and candidate room agents.
 * Output: one mentioned agent id or undefined when ambiguous.
 */
function resolveMentionTargetAgentId(
  content: string,
  agents: AgentHubState['agents'],
): string | undefined {
  return findMentionedAgentId(content, agents, { includeOrchestrator: false })
}
