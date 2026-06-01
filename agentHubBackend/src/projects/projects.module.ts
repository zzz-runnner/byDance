import { Module } from '@nestjs/common'
import { AgentHubModule } from '../agent-hub/agent-hub.module'
import { StorageModule } from '../storage/storage.module'
import { ProjectMetadataStore } from './project-metadata.store'
import { PreviewController } from './preview.controller'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  imports: [AgentHubModule, StorageModule],
  controllers: [ProjectsController, PreviewController],
  providers: [ProjectMetadataStore, ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
