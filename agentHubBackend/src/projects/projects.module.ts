import { Module } from '@nestjs/common'
import { AgentHubModule } from '../agent-hub/agent-hub.module'
import { StorageModule } from '../storage/storage.module'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  imports: [AgentHubModule, StorageModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
