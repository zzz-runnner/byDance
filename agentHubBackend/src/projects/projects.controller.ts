import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common'
import { Response } from 'express'
import { toProjectResponse } from '../state-bridge'
import { CreateAgentDto, UpdateAgentDto } from '../agents/agents.dto'
import {
  CreateProjectDto,
  FileContentQueryDto,
  PreviewBuildQueryDto,
  ProjectStateQueryDto,
  StreamProjectMessageDto,
  UpdateProjectMetadataDto,
  WriteWorkspaceFileDto,
} from './projects.dto'
import { ProjectsService } from './projects.service'

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  async createProject(@Body() input: CreateProjectDto) {
    return toProjectResponse(await this.projects.createProject(input))
  }

  @Get()
  async listProjects() {
    return (await this.projects.listProjects()).map(project => toProjectResponse(project))
  }

  @Get(':projectId')
  async getProject(@Param('projectId') projectId: string) {
    return toProjectResponse(await this.projects.getProject(projectId))
  }

  @Get(':projectId/agents')
  getProjectAgents(@Param('projectId') projectId: string) {
    return this.projects.listProjectAgents(projectId)
  }

  @Get(':projectId/agents/:agentId')
  getProjectAgent(
    @Param('projectId') projectId: string,
    @Param('agentId') agentId: string,
  ) {
    return this.projects.getProjectAgent(projectId, agentId)
  }

  @Post(':projectId/agents')
  createProjectAgent(
    @Param('projectId') projectId: string,
    @Body() input: CreateAgentDto,
  ) {
    return this.projects.createProjectAgent(projectId, input)
  }

  @Patch(':projectId/agents/:agentId')
  updateProjectAgent(
    @Param('projectId') projectId: string,
    @Param('agentId') agentId: string,
    @Body() input: UpdateAgentDto,
  ) {
    return this.projects.updateProjectAgent(projectId, agentId, input)
  }

  @Delete(':projectId/agents/:agentId')
  deleteProjectAgent(
    @Param('projectId') projectId: string,
    @Param('agentId') agentId: string,
  ) {
    return this.projects.deleteProjectAgent(projectId, agentId)
  }

  @Patch(':projectId/metadata')
  async updateProjectMetadata(
    @Param('projectId') projectId: string,
    @Body() input: UpdateProjectMetadataDto,
  ) {
    return toProjectResponse(await this.projects.updateProjectMetadata(projectId, input))
  }

  @Put(':projectId/pin')
  async pinProject(@Param('projectId') projectId: string) {
    return toProjectResponse(await this.projects.setProjectPinned(projectId, true))
  }

  @Delete(':projectId/pin')
  async unpinProject(@Param('projectId') projectId: string) {
    return toProjectResponse(await this.projects.setProjectPinned(projectId, false))
  }

  @Put(':projectId/archive')
  async archiveProject(@Param('projectId') projectId: string) {
    return toProjectResponse(await this.projects.setProjectArchived(projectId, true))
  }

  @Delete(':projectId/archive')
  async unarchiveProject(@Param('projectId') projectId: string) {
    return toProjectResponse(await this.projects.setProjectArchived(projectId, false))
  }

  @Get(':projectId/state')
  getProjectState(
    @Param('projectId') projectId: string,
    @Query() query: ProjectStateQueryDto,
  ) {
    return this.projects.getProjectState(projectId, query)
  }

  @Get(':projectId/delivery')
  getProjectDelivery(@Param('projectId') projectId: string) {
    return this.projects.getProjectDeliverySummary(projectId)
  }

  @Get(':projectId/files')
  getProjectFiles(@Param('projectId') projectId: string) {
    return this.projects.getProjectFiles(projectId)
  }

  @Get(':projectId/files/content')
  getProjectFileContent(
    @Param('projectId') projectId: string,
    @Query() query: FileContentQueryDto,
  ) {
    return this.projects.getProjectFileContent(projectId, query)
  }

  @Get(':projectId/files/preview')
  getProjectFilePreview(
    @Param('projectId') projectId: string,
    @Query() query: FileContentQueryDto,
  ) {
    return this.projects.getProjectFilePreview(projectId, query)
  }

  @Get(':projectId/diff')
  getProjectDiff(@Param('projectId') projectId: string) {
    return this.projects.getProjectDiff(projectId)
  }

  @Post(':projectId/change-sets/:changeSetId/apply')
  applyProjectChangeSet(
    @Param('projectId') projectId: string,
    @Param('changeSetId') changeSetId: string,
  ) {
    return this.projects.applyProjectChangeSet(projectId, changeSetId)
  }

  @Get(':projectId/preview-targets')
  getProjectPreviewTargets(@Param('projectId') projectId: string) {
    return this.projects.getProjectPreviewTargets(projectId)
  }

  @Get(':projectId/preview-capability')
  getProjectPreviewCapability(@Param('projectId') projectId: string) {
    return this.projects.getProjectPreviewCapability(projectId)
  }

  @Post(':projectId/preview-build')
  startProjectPreviewBuild(
    @Param('projectId') projectId: string,
    @Query() query: PreviewBuildQueryDto,
  ) {
    return this.projects.startProjectPreviewBuild(projectId, query)
  }

  @Put(':projectId/files')
  writeWorkspaceFile(
    @Param('projectId') projectId: string,
    @Body() input: WriteWorkspaceFileDto,
  ) {
    return this.projects.writeWorkspaceFile(projectId, input)
  }

  @Put(':projectId/messages/:messageId/pin')
  pinProjectMessage(
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.projects.pinProjectMessage(projectId, messageId)
  }

  @Delete(':projectId/messages/:messageId/pin')
  unpinProjectMessage(
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.projects.unpinProjectMessage(projectId, messageId)
  }

  @Post(':projectId/messages/stream')
  async streamMessage(
    @Param('projectId') projectId: string,
    @Body() input: StreamProjectMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.streamProjectMessage(projectId, input, response)
  }
}
