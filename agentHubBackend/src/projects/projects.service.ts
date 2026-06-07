import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Response as ExpressResponse } from 'express'
import fs from 'fs-extra'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AgentHubClientService } from '../agent-hub/agent-hub.service'
import { AgentHubAgent, AgentHubState, AgentHubWorkspace } from '../agent-hub/agent-hub.types'
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
  ProjectTurnRecoveryResponse,
  ProjectWorkspaceDiff,
  RuntimeAgent,
  RuntimeAppState,
  RuntimeArtifact,
  RuntimeChangeSet,
  RuntimeMessage,
  RuntimeWorkflowEventRecord,
  SortDirection,
  StoredProjectRecord,
  WorkbenchOverviewResponse,
  WorkspaceListStatus,
  WorkspaceSortField,
  WorkspaceType,
} from '../types'
import { ProjectMetadataStore } from './project-metadata.store'
import {
  CreateProjectDto,
  FileContentQueryDto,
  PreviewBuildQueryDto,
  ProjectStateQueryDto,
  ProjectTurnRecoveryQueryDto,
  StreamProjectMessageDto,
  UpdateProjectMetadataDto,
  WorkbenchQueryDto,
  WriteWorkspaceFileDto,
} from './projects.dto'
import { ProjectMetadata, ProjectWorkflowSummary } from './project.types'
import { readWorkspaceDocumentPreview } from './workspace-document-preview'

interface SseParseResult {
  events: Record<string, unknown>[]
  rest: string
}

type ProjectPageCursor = {
  offset: number
}

const DIRECT_CHAT_AGENT_IDS = new Set(['claude-code-direct', 'codex-direct'])
const DEFAULT_GROUP_AGENT_IDS = new Set(['orchestrator', 'product-manager', 'engineer', 'reviewer'])

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
    assertProjectRoomShape(input)
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
    if (input.workspaceId && conversationType === 'direct' && directAgentId) {
      await this.assertExistingDirectAgentAllowed(directAgentId)
    }

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
   * Checks an existing runtime direct-agent binding before saving project metadata.
   * Input: requested agent id.
   * Output: throws when the target is not a built-in direct-chat agent.
   */
  private async assertExistingDirectAgentAllowed(agentId: string): Promise<void> {
    assertDirectConversationAgentId(agentId)
  }

  /**
   * Lists persisted business projects in descending update order.
   * Input: none.
   * Output: stored project metadata array.
   */
  async listProjects(): Promise<ProjectMetadata[]> {
    const [state, projects] = await Promise.all([
      this.agentHub.fetchState(),
      this.projectStore.listProjects(),
    ])
    return mergeRuntimeProjects(state, projects)
  }

  /**
   * Loads one persisted project by business id.
   * Input: project id.
   * Output: stored project metadata.
   */
  async getProject(projectId: string): Promise<ProjectMetadata> {
    const project = await this.projectStore.getProject(projectId)
    if (project) {
      return this.hydrateProjectFromRuntime(project)
    }

    const [state, projects] = await Promise.all([
      this.agentHub.fetchState(),
      this.projectStore.listProjects(),
    ])
    const runtimeProject = runtimeProjectById(state, projectId, projects)
    if (!runtimeProject) {
      throw new NotFoundException(`Project not found: ${projectId}`)
    }
    return runtimeProject
  }

  async deleteProject(projectId: string): Promise<{ deleted: boolean; projectId: string; workspaceId: string }> {
    const project = await this.getProject(projectId)
    const allProjects = await this.projectStore.listProjects()
    const workspaceStillReferenced = allProjects.some(candidate =>
      candidate.projectId !== project.projectId && candidate.workspaceId === project.workspaceId,
    )

    await this.projectStore.deleteProject(project.projectId)
    await Promise.all([
      fs.remove(this.storage.sourceArtifactsRootForProject(project.projectId)).catch(() => undefined),
      fs.remove(this.storage.buildArtifactsRootForProject(project.projectId)).catch(() => undefined),
      fs.remove(this.storage.deployProjectRoot(project.projectId)).catch(() => undefined),
      !workspaceStillReferenced
        ? this.agentHub.deleteWorkspace(project.workspaceId).catch(() => undefined)
        : Promise.resolve(),
    ])

    return {
      deleted: true,
      projectId: project.projectId,
      workspaceId: project.workspaceId,
    }
  }

  /**
   * Loads the lightweight workbench page used by the left workspace list.
   * Input: page size, optional cursor, and optional query string.
   * Output: room summaries plus agent definitions.
   */
  async getWorkbenchOverview(query: WorkbenchQueryDto): Promise<WorkbenchOverviewResponse> {
    const limit = query.pageSize ?? query.limit
    const searchQuery = query.query ?? query.q
    const [state, storedProjects] = await Promise.all([
      this.agentHub.fetchState(),
      this.projectStore.listProjects(),
    ])
    const projectPage = pageRuntimeProjects(mergeRuntimeProjects(state, storedProjects), {
      limit,
      cursor: query.cursor,
      query: searchQuery,
      status: query.status,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
    })
    const [roomBatch] = await Promise.all([
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
      [],
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
    throw new BadRequestException('Global agents are not supported. Use /api/projects/:projectId/agents.')
  }

  async listProjectAgents(projectId: string) {
    const project = await this.getProject(projectId)
    return this.agentHub.fetchWorkspaceAgents(project.workspaceId)
  }

  async getProjectAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId)
    await this.assertProjectAgentVisible(project, agentId)
    return this.agentHub.fetchWorkspaceAgent(project.workspaceId, agentId)
  }

  async createProjectAgent(projectId: string, input: CreateAgentDto) {
    const project = await this.getProject(projectId)
    if ((project.conversationType ?? 'group') !== 'group') {
      throw new BadRequestException('Custom agents can only be added to group workspaces.')
    }
    return this.agentHub.createWorkspaceAgent(project.workspaceId, input)
  }

  async updateProjectAgent(projectId: string, agentId: string, input: UpdateAgentDto) {
    const project = await this.getProject(projectId)
    await this.assertProjectAgentVisible(project, agentId)
    return this.agentHub.updateWorkspaceAgent(project.workspaceId, agentId, input)
  }

  async deleteProjectAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId)
    await this.assertProjectAgentVisible(project, agentId)
    return this.agentHub.deleteWorkspaceAgent(project.workspaceId, agentId)
  }

  /**
   * Ensures one agent belongs to the current project room before mutation.
   * Input: project metadata and agent id.
   * Output: throws when the agent belongs to a different room in the same workspace.
   */
  private async assertProjectAgentVisible(project: ProjectMetadata, agentId: string): Promise<void> {
    const agents = await this.agentHub.fetchWorkspaceAgents(project.workspaceId)
    if (!agents.some(agent => agent.id === agentId)) {
      throw new NotFoundException(`Agent not found in project workspace room: ${agentId}`)
    }
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
      messagePageSize: query.messagePageSize,
      messageCursor: query.messageCursor,
    })
  }

  async getProjectTurnRecovery(
    projectId: string,
    turnId: string,
    query: ProjectTurnRecoveryQueryDto,
  ): Promise<ProjectTurnRecoveryResponse> {
    const project = await this.getProject(projectId)
    const state = await this.agentHub.fetchState()
    const conversationIds = new Set(
      state.conversations
        .filter(conversation => conversation.workspaceId === project.workspaceId)
        .map(conversation => conversation.id),
    )
    const workspaceAgents = this.resolveRecoveryAgents(state, project.workspaceId, project.conversationId)
    const scopedMessages = state.messages.filter(message =>
      message.workspaceId === project.workspaceId || conversationIds.has(message.conversationId),
    )
    const scopedEvents = state.workflowEvents.filter(event =>
      event.workspaceId === project.workspaceId || conversationIds.has(event.conversationId),
    )
    const matchingMessages = scopedMessages
      .filter(message => this.readTurnId(message) === turnId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    const matchingEvents = scopedEvents
      .filter(record => this.readTurnId(record.event) === turnId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

    if (matchingMessages.length === 0 && matchingEvents.length === 0) {
      return {
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        conversationId: project.conversationId,
        turnId,
        status: 'not_found',
        hasAssistantReply: false,
        messages: [],
        workflowEvents: [],
        artifacts: [],
        changeSets: [],
        agents: workspaceAgents,
      }
    }

    const artifactIds = new Set(
      matchingEvents
        .map(record => typeof record.event.artifactId === 'string' ? record.event.artifactId : undefined)
        .filter((value): value is string => Boolean(value)),
    )
    const changeSetIds = new Set(
      matchingEvents
        .map(record => typeof record.event.changeSetId === 'string' ? record.event.changeSetId : undefined)
        .filter((value): value is string => Boolean(value)),
    )
    const runIds = new Set(
      matchingEvents
        .map(record => typeof record.event.runId === 'string' ? record.event.runId : undefined)
        .filter((value): value is string => Boolean(value)),
    )
    const artifacts = state.artifacts
      .filter(artifact =>
        artifact.workspaceId === project.workspaceId &&
        (artifactIds.has(artifact.id) || (artifact.agentRunId ? runIds.has(artifact.agentRunId) : false)),
      )
      .sort((left, right) => readComparableTimestamp(left.createdAt).localeCompare(readComparableTimestamp(right.createdAt)))
    const changeSets = state.changeSets
      .filter(changeSet =>
        changeSet.workspaceId === project.workspaceId &&
        (changeSetIds.has(changeSet.id) || runIds.has(changeSet.agentRunId)),
      )
      .sort((left, right) => readComparableTimestamp(left.createdAt).localeCompare(readComparableTimestamp(right.createdAt)))
    const hasAssistantReply = matchingMessages.some(message => this.readSenderType(message) === 'agent')
    const lastEvent = matchingEvents.at(-1)

    return {
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      conversationId: project.conversationId,
      turnId,
      status: this.resolveTurnRecoveryStatus(matchingMessages, matchingEvents),
      hasAssistantReply,
      lastEventType: typeof lastEvent?.event.type === 'string' ? lastEvent.event.type : undefined,
      latestMessageCreatedAt: matchingMessages.at(-1)?.createdAt,
      latestEventCreatedAt: lastEvent?.createdAt,
      messages: limitTail(matchingMessages, query.messageLimit),
      workflowEvents: matchingEvents,
      artifacts,
      changeSets,
      agents: workspaceAgents,
    }
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
   * Loads one local document preview payload for PDF, Word, or PowerPoint workspace files.
   * Input: project id and repo-relative file path.
   * Output: lightweight preview data for the code dialog.
   */
  async getProjectFilePreview(projectId: string, query: FileContentQueryDto) {
    const project = await this.getProject(projectId)
    return readWorkspaceDocumentPreview(
      this.storage.workspaceFilePath(project.workspaceId, query.path),
      query.path,
      `/preview/runtime/${encodeURIComponent(project.projectId)}/${query.path.replace(/\\/g, '/')}`,
    )
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
   * Applies one recorded AgentHub change-set patch onto the current workspace repo.
   * Input: project id and runtime change-set id.
   * Output: apply status plus a concise user-facing summary.
   */
  async applyProjectChangeSet(
    projectId: string,
    changeSetId: string,
  ): Promise<{ status: 'applied' | 'already_applied'; changeSetId: string; summary: string }> {
    const project = await this.getProject(projectId)
    const state = await this.agentHub.fetchState()
    const changeSet = state.changeSets.find(item => item.workspaceId === project.workspaceId && item.id === changeSetId)
    if (!changeSet) {
      throw new NotFoundException(`Change set not found in project workspace: ${changeSetId}`)
    }

    const patch = typeof changeSet.patch === 'string' ? changeSet.patch.trim() : ''
    if (!patch) {
      throw new BadRequestException('This change set does not include an applyable text patch.')
    }

    const result = await applyWorkspacePatchFromFile(this.storage.workspaceRepoPath(project.workspaceId), patch)
    if (result.status === 'applied') {
      await this.updateProject(projectId, () => undefined)
    }

    return {
      status: result.status,
      changeSetId,
      summary: result.summary,
    }
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
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Expires', '0')
    response.setHeader('Surrogate-Control', 'no-store')
    response.setHeader('Last-Modified', new Date(0).toUTCString())
    response.removeHeader('ETag')

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
   * Pins one project message so AgentHub will always include it in workspace context.
   * Input: project id and persisted runtime message id.
   * Output: updated workspace pin payload.
   */
  async pinProjectMessage(projectId: string, messageId: string) {
    const project = await this.getProject(projectId)
    return this.agentHub.pinWorkspaceMessage(project.workspaceId, messageId)
  }

  /**
   * Removes one project message from the workspace pinned-context list.
   * Input: project id and persisted runtime message id.
   * Output: updated workspace pin payload.
   */
  async unpinProjectMessage(projectId: string, messageId: string) {
    const project = await this.getProject(projectId)
    return this.agentHub.unpinWorkspaceMessage(project.workspaceId, messageId)
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
    const heartbeat = setInterval(() => {
      response.write(': keepalive\n\n')
    }, 15_000)

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
      clearInterval(heartbeat)
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

  private resolveRecoveryAgents(
    state: RuntimeAppState,
    workspaceId: string,
    conversationId?: string,
  ): RuntimeAgent[] {
    return state.agents.filter(agent => {
      if (agent.workspaceId !== workspaceId) {
        return false
      }
      if (!conversationId || !agent.conversationId) {
        return true
      }
      return agent.conversationId === conversationId
    })
  }

  private readTurnId(value: Record<string, unknown> | undefined): string | undefined {
    return typeof value?.turnId === 'string' ? value.turnId : undefined
  }

  private readSenderType(message: RuntimeMessage): string | undefined {
    return typeof message.senderType === 'string' ? message.senderType : undefined
  }

  private resolveTurnRecoveryStatus(
    messages: RuntimeMessage[],
    workflowEvents: RuntimeWorkflowEventRecord[],
  ): ProjectTurnRecoveryResponse['status'] {
    if (messages.length === 0 && workflowEvents.length === 0) {
      return 'not_found'
    }

    const hasFailedEvent = workflowEvents.some(record => {
      const type = typeof record.event.type === 'string' ? record.event.type : ''
      const status = typeof record.event.status === 'string' ? record.event.status : ''
      return type === 'assistant_message_error' || type === 'model_call_failed' || status === 'failed' || status === 'error'
    })
    if (hasFailedEvent) {
      return 'failed'
    }

    const hasFinishedEvent = workflowEvents.some(record => {
      const type = typeof record.event.type === 'string' ? record.event.type : ''
      return type === 'workflow_finished' || type === 'assistant_message_finished'
    })
    if (hasFinishedEvent) {
      return 'finished'
    }

    const hasAssistantReply = messages.some(message => this.readSenderType(message) === 'agent')
    return hasAssistantReply ? 'finished' : 'running'
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
      assertDirectConversationAgentId(directAgentId)
      nextState = await this.agentHub.createConversation(
        buildDirectConversationInput(workspace.id, directAgentId),
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

  private async hydrateProjectFromRuntime(project: ProjectMetadata): Promise<ProjectMetadata> {
    const state = await this.agentHub.fetchState()
    const runtimeWorkspace = state.workspaces.find(workspace => workspace.id === project.workspaceId)
    if (!runtimeWorkspace) {
      return project
    }

    return mergeProjectWithRuntime(state, project, runtimeWorkspace)
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

const RUNTIME_PROJECT_ID_PREFIX = 'runtime-'
const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

type RuntimeProjectPageInput = {
  limit?: number
  cursor?: string
  query?: string
  status?: WorkspaceListStatus
  sortBy?: WorkspaceSortField
  sortDirection?: SortDirection
}

type RuntimeProjectPage = {
  items: ProjectMetadata[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

/**
 * Projects AgentHub runtime workspaces into business-project metadata.
 * Input: runtime state plus optional locally persisted metadata.
 * Output: one project per runtime workspace, enriched with business fields.
 */
function mergeRuntimeProjects(
  state: AgentHubState,
  storedProjects: ProjectMetadata[],
): ProjectMetadata[] {
  const projectByWorkspaceId = latestProjectByWorkspaceId(storedProjects)

  return state.workspaces
    .map(workspace => {
      const storedProject = projectByWorkspaceId.get(workspace.id)
      return storedProject
        ? mergeProjectWithRuntime(state, storedProject, workspace)
        : projectFromRuntimeWorkspace(state, workspace)
    })
    .sort((left, right) => compareProjectsBySort(left, right, 'updatedAt', 'desc'))
}

/**
 * Resolves a project id, virtual runtime project id, or raw workspace id.
 * Input: runtime state, requested id, and optional stored project metadata.
 * Output: merged project metadata when the workspace still exists.
 */
function runtimeProjectById(
  state: AgentHubState,
  projectId: string,
  storedProjects: ProjectMetadata[] = [],
): ProjectMetadata | undefined {
  const storedProject = storedProjects.find(project => project.projectId === projectId)
  if (storedProject) {
    const workspace = state.workspaces.find(candidate => candidate.id === storedProject.workspaceId)
    return workspace ? mergeProjectWithRuntime(state, storedProject, workspace) : storedProject
  }

  const workspace = state.workspaces.find(candidate =>
    candidate.id === projectId || runtimeProjectId(candidate.id) === projectId,
  )
  if (!workspace) {
    return undefined
  }

  const storedProjectForWorkspace = latestProjectByWorkspaceId(storedProjects).get(workspace.id)
  return storedProjectForWorkspace
    ? mergeProjectWithRuntime(state, storedProjectForWorkspace, workspace)
    : projectFromRuntimeWorkspace(state, workspace)
}

/**
 * Merges one stored business record with the current runtime workspace snapshot.
 * Input: runtime state, stored project, and matching runtime workspace.
 * Output: runtime-sourced project metadata with stored delivery fields preserved.
 */
function mergeProjectWithRuntime(
  state: AgentHubState,
  project: ProjectMetadata,
  workspace: AgentHubWorkspace,
): ProjectMetadata {
  const storedConversation = project.conversationId
    ? state.conversations.find(conversation =>
        conversation.workspaceId === workspace.id && conversation.id === project.conversationId,
      )
    : undefined
  const selectedConversation = storedConversation ?? selectProjectConversation(
    state.conversations,
    workspace.id,
    project.conversationType ?? 'group',
    project.targetAgentId,
  )
  const lastActivityAt = runtimeLastActivityAt(state, workspace, selectedConversation)

  return {
    ...project,
    name: nonEmptyString(workspace.name, project.name),
    goal: nonEmptyString(workspace.goal, project.goal),
    workspaceId: workspace.id,
    conversationId: selectedConversation?.id ?? project.conversationId,
    conversationType: project.conversationType ?? selectedConversation?.type ?? 'group',
    targetAgentId: project.targetAgentId ?? directConversationAgentId(selectedConversation),
    agentHubPreviewUrl: previewUrlFor(workspace.id),
    agentHubZipUrl: zipUrlFor(workspace.id),
    versions: project.versions ?? [],
    deployments: project.deployments ?? [],
    createdAt: nonEmptyString(project.createdAt, nonEmptyString(workspace.createdAt, FALLBACK_TIMESTAMP)),
    updatedAt: latestTimestamp(project.updatedAt, lastActivityAt),
  }
}

/**
 * Creates virtual business metadata for a runtime workspace with no stored record.
 * Input: runtime state and workspace.
 * Output: stable project metadata derived from AgentHub.
 */
function projectFromRuntimeWorkspace(
  state: AgentHubState,
  workspace: AgentHubWorkspace,
): ProjectMetadata {
  const conversation = selectProjectConversation(state.conversations, workspace.id, 'group')
  const lastActivityAt = runtimeLastActivityAt(state, workspace, conversation)

  return {
    projectId: runtimeProjectId(workspace.id),
    name: nonEmptyString(workspace.name, workspace.id),
    goal: nonEmptyString(workspace.goal, ''),
    workspaceId: workspace.id,
    conversationId: conversation?.id,
    conversationType: conversation?.type ?? 'group',
    targetAgentId: directConversationAgentId(conversation),
    agentHubPreviewUrl: previewUrlFor(workspace.id),
    agentHubZipUrl: zipUrlFor(workspace.id),
    versions: [],
    deployments: [],
    createdAt: nonEmptyString(workspace.createdAt, lastActivityAt),
    updatedAt: lastActivityAt,
  }
}

/**
 * Pages the runtime-first project list after applying business filters.
 * Input: merged projects plus page, search, status, and sort options.
 * Output: one page of project metadata.
 */
function pageRuntimeProjects(
  projects: ProjectMetadata[],
  input: RuntimeProjectPageInput,
): RuntimeProjectPage {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
  const normalizedQuery = input.query?.trim().toLowerCase() ?? ''
  const status = input.status ?? 'active'
  const sortBy = input.sortBy ?? 'updatedAt'
  const sortDirection = input.sortDirection ?? 'desc'
  const filtered = projects.filter(project =>
    matchesProjectStatus(project, status) &&
    (!normalizedQuery || matchesProjectQuery(project, normalizedQuery)),
  )
  const sorted = filtered
    .slice()
    .sort((left, right) => compareProjectsBySort(left, right, sortBy, sortDirection))
  const decodedCursor = decodeProjectCursor(input.cursor)
  const sliceStart = Math.max(0, Math.min(decodedCursor?.offset ?? 0, sorted.length))
  const items = sorted.slice(sliceStart, sliceStart + limit)
  const hasMore = sliceStart + items.length < sorted.length

  return {
    items,
    total: sorted.length,
    hasMore,
    nextCursor: hasMore && items.length > 0 ? encodeProjectCursor(sliceStart + items.length) : undefined,
  }
}

function runtimeProjectId(workspaceId: string): string {
  return `${RUNTIME_PROJECT_ID_PREFIX}${workspaceId}`
}

function latestProjectByWorkspaceId(projects: ProjectMetadata[]): Map<string, ProjectMetadata> {
  const result = new Map<string, ProjectMetadata>()

  for (const project of projects) {
    const current = result.get(project.workspaceId)
    if (!current || project.updatedAt.localeCompare(current.updatedAt) > 0) {
      result.set(project.workspaceId, project)
    }
  }

  return result
}

function runtimeLastActivityAt(
  state: AgentHubState,
  workspace: AgentHubWorkspace,
  selectedConversation: AgentHubState['conversations'][number] | undefined,
): string {
  const workspaceConversations = state.conversations.filter(conversation => conversation.workspaceId === workspace.id)
  const conversationIds = new Set(workspaceConversations.map(conversation => conversation.id))
  const latestConversationAt = latestTimestamp(...workspaceConversations.map(conversation => conversation.updatedAt))
  const latestMessageAt = latestTimestamp(
    ...state.messages
      .filter(message => message.workspaceId === workspace.id || conversationIds.has(message.conversationId))
      .map(message => message.createdAt),
  )
  const latestWorkflowEventAt = latestTimestamp(
    ...state.workflowEvents
      .filter(record => record.workspaceId === workspace.id || conversationIds.has(record.conversationId))
      .map(record => record.createdAt),
  )

  return latestTimestamp(
    workspace.updatedAt,
    workspace.createdAt,
    selectedConversation?.updatedAt,
    latestConversationAt,
    latestMessageAt,
    latestWorkflowEventAt,
  )
}

function latestTimestamp(...values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? FALLBACK_TIMESTAMP
}

function readComparableTimestamp(value: unknown): string {
  return typeof value === 'string' && value ? value : FALLBACK_TIMESTAMP
}

function limitTail<T>(items: T[], limit?: number): T[] {
  if (!limit || limit >= items.length) {
    return items
  }
  return items.slice(-limit)
}

function directConversationAgentId(
  conversation: AgentHubState['conversations'][number] | undefined,
): string | undefined {
  return conversation?.type === 'direct'
    ? conversation.participants.find(participant => participant !== 'user')
    : undefined
}

/**
 * Filters workspace agents down to the project-bound room.
 * Input: workspace-level agents and project room metadata.
 * Output: agents that should be visible in that project's Agent management dialog.
 */
function filterProjectAgents(agents: AgentHubAgent[], project: Pick<ProjectMetadata, 'conversationId' | 'conversationType' | 'targetAgentId'>): AgentHubAgent[] {
  if ((project.conversationType ?? 'group') === 'direct') {
    const targetAgentId = project.targetAgentId
    return agents.filter(agent =>
      targetAgentId
        ? agent.id === targetAgentId && (!project.conversationId || !agent.conversationId || agent.conversationId === project.conversationId)
        : DIRECT_CHAT_AGENT_IDS.has(agent.id) && (!project.conversationId || agent.conversationId === project.conversationId),
    )
  }

  return agents.filter(agent => {
    if (DIRECT_CHAT_AGENT_IDS.has(agent.id)) {
      return false
    }
    if (agent.source === 'built-in') {
      return DEFAULT_GROUP_AGENT_IDS.has(agent.id)
    }
    return !project.conversationId || !agent.conversationId || agent.conversationId === project.conversationId
  })
}

function nonEmptyString(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback
}

function matchesProjectStatus(project: ProjectMetadata, status: WorkspaceListStatus): boolean {
  if (status === 'all') {
    return true
  }
  return status === 'archived' ? Boolean(project.archivedAt) : !project.archivedAt
}

function matchesProjectQuery(project: ProjectMetadata, query: string): boolean {
  return [
    project.name,
    project.goal,
    project.workspaceId,
    project.projectId,
    project.conversationType ?? '',
    project.targetAgentId ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

function compareProjectsBySort(
  left: ProjectMetadata,
  right: ProjectMetadata,
  sortBy: WorkspaceSortField,
  sortDirection: SortDirection,
): number {
  const direction = sortDirection === 'asc' ? 1 : -1
  const valueComparison = projectSortValue(left, sortBy).localeCompare(projectSortValue(right, sortBy))
  if (valueComparison !== 0) {
    return valueComparison * direction
  }
  return left.projectId.localeCompare(right.projectId)
}

function projectSortValue(project: ProjectMetadata, sortBy: WorkspaceSortField): string {
  if (sortBy === 'name') {
    return project.name.toLowerCase()
  }
  if (sortBy === 'createdAt') {
    return project.createdAt
  }
  return project.updatedAt
}

function encodeProjectCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({
      offset,
    } satisfies ProjectPageCursor),
    'utf8',
  ).toString('base64url')
}

function decodeProjectCursor(cursor: string | undefined): ProjectPageCursor | undefined {
  if (!cursor) {
    return undefined
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<ProjectPageCursor>
    if (typeof parsed.offset === 'number' && Number.isInteger(parsed.offset) && parsed.offset >= 0) {
      return {
        offset: parsed.offset,
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

type GitPatchCommandResult = {
  code: number
  stdout: string
  stderr: string
}

/**
 * Shortens git command output so API errors stay readable.
 * Input: stdout and stderr text from one git process.
 * Output: bounded diagnostic text for thrown HTTP errors.
 */
function summarizeGitOutput(stdout: string, stderr: string): string {
  const normalized = [stderr, stdout]
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized ? normalized.slice(0, 500) : 'git apply returned no diagnostic output.'
}

/**
 * Runs one git command in the workspace repo.
 * Input: repo path and git arguments.
 * Output: exit code plus captured stdout and stderr text.
 */
async function runGitPatchCommand(
  repoPath: string,
  args: string[],
  _patch?: string,
): Promise<GitPatchCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoPath,
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      })
    })

  })
}

/**
 * Applies one unified patch to the workspace repo or reports when it is already present.
 * Input: repo path and unified patch text.
 * Output: apply status and a concise summary for the frontend.
 */
async function applyWorkspacePatch(
  repoPath: string,
  patch: string,
): Promise<{ status: 'applied' | 'already_applied'; summary: string }> {
  const check = await runGitPatchCommand(repoPath, ['apply', '--check', '--whitespace=nowarn', '-'], patch)
  if (check.code === 0) {
    const apply = await runGitPatchCommand(repoPath, ['apply', '--whitespace=nowarn', '-'], patch)
    if (apply.code !== 0) {
      throw new BadRequestException(`Change set apply failed: ${summarizeGitOutput(apply.stdout, apply.stderr)}`)
    }
    return {
      status: 'applied',
      summary: '已将该轮 Diff 应用到当前工作区。',
    }
  }

  const reverseCheck = await runGitPatchCommand(repoPath, ['apply', '--reverse', '--check', '--whitespace=nowarn', '-'], patch)
  if (reverseCheck.code === 0) {
    return {
      status: 'already_applied',
      summary: '该轮 Diff 已经在当前工作区生效，无需重复应用。',
    }
  }

  throw new BadRequestException(`Change set patch cannot be applied: ${summarizeGitOutput(check.stdout, check.stderr)}`)
}

/**
 * Applies one unified patch using a temporary patch file so Windows git can
 * reliably distinguish "applied" from "already applied" on large change-sets.
 * Input: repo path and unified patch text.
 * Output: apply status and a concise summary for the frontend.
 */
async function applyWorkspacePatchFromFile(
  repoPath: string,
  patch: string,
): Promise<{ status: 'applied' | 'already_applied'; summary: string }> {
  const normalizedPatch = patch.endsWith('\n') ? patch : `${patch}\n`
  const patchFilePath = path.join(tmpdir(), `agenthub-changeset-${randomUUID()}.patch`)
  await writeFile(patchFilePath, normalizedPatch, 'utf8')

  try {
    const check = await runGitPatchCommand(repoPath, ['apply', '--check', '--whitespace=nowarn', patchFilePath])
    if (check.code === 0) {
      const apply = await runGitPatchCommand(repoPath, ['apply', '--whitespace=nowarn', patchFilePath])
      if (apply.code !== 0) {
        throw new BadRequestException(`Change set apply failed: ${summarizeGitOutput(apply.stdout, apply.stderr)}`)
      }
      return {
        status: 'applied',
        summary: 'Applied this change-set diff to the current workspace.',
      }
    }

    const reverseCheck = await runGitPatchCommand(
      repoPath,
      ['apply', '--reverse', '--check', '--whitespace=nowarn', patchFilePath],
    )
    if (reverseCheck.code === 0) {
      return {
        status: 'already_applied',
        summary: 'This change-set diff is already present in the current workspace.',
      }
    }

    throw new BadRequestException(`Change set patch cannot be applied: ${summarizeGitOutput(check.stdout, check.stderr)}`)
  } finally {
    await unlink(patchFilePath).catch(() => undefined)
  }
}

/**
 * Resolves the preferred room type for one project creation request.
 * Input: raw create-project payload.
 * Output: normalized group or direct conversation type.
 */
function resolveConversationType(input: CreateProjectDto): ConversationType {
  return input.conversationType === 'direct' ? 'direct' : 'group'
}

/**
 * Ensures project creation uses one supported workspace/chat shape.
 * Input: raw create-project payload. Output: throws when room mode and workspace type disagree.
 */
function assertProjectRoomShape(input: CreateProjectDto): void {
  const conversationType = resolveConversationType(input)
  const workspaceType = input.workspaceType ?? (conversationType === 'direct' ? 'chat' : 'dev')

  if (conversationType === 'direct') {
    assertDirectConversationAgentId(resolveDirectAgentId(input) ?? 'codex-direct')
    if (workspaceType !== 'chat') {
      throw new BadRequestException('Direct workspaces must use workspaceType=chat.')
    }
    return
  }

  if (workspaceType === 'chat') {
    throw new BadRequestException('Group workspaces must use dev, research, or writing workspace types.')
  }
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

  return input.agentIds?.find(Boolean) ?? 'codex-direct'
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
 * Ensures direct chat is bound only to the dedicated direct-chat agent ids.
 * Input: requested direct agent id.
 * Output: throws when the requested direct agent is not allowed.
 */
function assertDirectConversationAgentId(agentId: string) {
  if (!DIRECT_CHAT_AGENT_IDS.has(agentId)) {
    throw new BadRequestException('Direct workspaces can only talk to built-in Claude Code or Codex direct agents.')
  }
}

/**
 * Builds the runtime direct-room payload for one selected agent.
 * Input: workspace id and target direct agent id.
 * Output: AgentHub conversation creation payload.
 */
function buildDirectConversationInput(workspaceId: string, agentId: string) {
  return {
    workspaceId,
    type: 'direct' as const,
    title: `${agentDisplayName({ id: agentId, name: directAgentDisplayName(agentId) })} 私聊`,
    participants: ['user', agentId],
  }
}

function directAgentDisplayName(agentId: string): string {
  return agentId === 'claude-code-direct' ? 'Claude Code Agent' : 'Codex Agent'
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
