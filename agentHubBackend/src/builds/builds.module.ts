import { Module } from '@nestjs/common'
import { StorageModule } from '../storage/storage.module'
import { VersionsModule } from '../versions/versions.module'
import { BuildsController } from './builds.controller'
import { BuildsService } from './builds.service'

@Module({
  imports: [StorageModule, VersionsModule],
  controllers: [BuildsController],
  providers: [BuildsService],
})
export class BuildsModule {}
