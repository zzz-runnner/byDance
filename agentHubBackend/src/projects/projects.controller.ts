import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common'
import { Response } from 'express'
import { CreateProjectDto, StreamProjectMessageDto, WriteWorkspaceFileDto } from './projects.dto'
import { ProjectsService } from './projects.service'

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  createProject(@Body() input: CreateProjectDto) {
    return this.projects.createProject(input)
  }

  @Get()
  listProjects() {
    return this.projects.listProjects()
  }

  @Get(':projectId')
  getProject(@Param('projectId') projectId: string) {
    return this.projects.getProject(projectId)
  }

  @Put(':projectId/files')
  writeWorkspaceFile(
    @Param('projectId') projectId: string,
    @Body() input: WriteWorkspaceFileDto,
  ) {
    return this.projects.writeWorkspaceFile(projectId, input)
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
