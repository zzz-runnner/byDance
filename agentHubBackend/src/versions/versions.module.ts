import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { StorageModule } from '../storage/storage.module'
import { VersionsController } from './versions.controller'
import { VersionsService } from './versions.service'

@Module({
  imports: [ProjectsModule, StorageModule],
  controllers: [VersionsController],
  providers: [VersionsService],
  exports: [VersionsService],
})
export class VersionsModule {}
