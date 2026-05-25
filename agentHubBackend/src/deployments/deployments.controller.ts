import { Body, Controller, Param, Post } from '@nestjs/common'
import { DeployVersionDto } from './deployments.dto'
import { DeploymentsService } from './deployments.service'

@Controller('api/projects/:projectId/deploy')
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Post()
  deployVersion(
    @Param('projectId') projectId: string,
    @Body() input: DeployVersionDto,
  ) {
    return this.deployments.deployVersion(projectId, input)
  }
}
