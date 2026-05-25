import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { StorageModule } from '../storage/storage.module'
import { VersionsModule } from '../versions/versions.module'
import { DeploymentsController } from './deployments.controller'
import { DeploymentsService } from './deployments.service'

@Module({
  imports: [ProjectsModule, StorageModule, VersionsModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService],
})
export class DeploymentsModule {}
