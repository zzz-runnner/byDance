import { Controller, Get } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Param, Query, Res } from '@nestjs/common'
import { Response } from 'express'
import { WorkbenchQueryDto } from './projects/projects.dto'
import { ProjectsService } from './projects/projects.service'

@Controller('api')
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly projects: ProjectsService,
  ) {}

  @Get('health')
  health(): Record<string, unknown> {
    return {
      ok: true,
      service: 'agenthub-backend',
      agentHubBaseUrl: this.config.get<string>('AGENTHUB_BASE_URL'),
      storageRoot: this.config.get<string>('APP_STORAGE_ROOT'),
    }
  }

  @Get('agents')
  listAgents() {
    return this.projects.listAgents()
  }

  @Get('workbench')
  getWorkbenchOverview(@Query() query: WorkbenchQueryDto) {
    return this.projects.getWorkbenchOverview(query)
  }

  @Get('workspaces/:workspaceId/zip')
  async proxyWorkspaceZip(
    @Param('workspaceId') workspaceId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.proxyWorkspaceZip(workspaceId, response)
  }
}
