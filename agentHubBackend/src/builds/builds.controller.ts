import { Body, Controller, Param, Post } from '@nestjs/common'
import { BuildVersionDto } from './builds.dto'
import { BuildsService } from './builds.service'

@Controller('api/projects/:projectId/builds')
export class BuildsController {
  constructor(private readonly builds: BuildsService) {}

  @Post()
  buildVersion(
    @Param('projectId') projectId: string,
    @Body() input: BuildVersionDto,
  ) {
    return this.builds.buildVersion(projectId, input)
  }
}
