import { Body, Controller, Get, Param, Post, Query, StreamableFile } from '@nestjs/common'
import { CreateVersionDto, DiffQueryDto, RestoreVersionDto } from './versions.dto'
import { VersionsService } from './versions.service'

@Controller('api/projects/:projectId')
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Post('versions')
  createVersion(
    @Param('projectId') projectId: string,
    @Body() input: CreateVersionDto,
  ) {
    return this.versions.createVersion(projectId, input)
  }

  @Get('versions')
  listVersions(@Param('projectId') projectId: string) {
    return this.versions.listVersions(projectId)
  }

  @Get('version-diff')
  getDiff(
    @Param('projectId') projectId: string,
    @Query() query: DiffQueryDto,
  ) {
    return this.versions.getDiff(projectId, query.v1, query.v2)
  }

  @Post('versions/:versionId/restore')
  restoreVersion(
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() input: RestoreVersionDto,
  ) {
    return this.versions.restoreVersion(projectId, versionId, input)
  }

  @Get('source.zip')
  async downloadSource(
    @Param('projectId') projectId: string,
    @Query('versionId') versionId?: string,
  ): Promise<StreamableFile> {
    const source = await this.versions.openSourceZip(projectId, versionId)
    return new StreamableFile(source.stream, {
      type: 'application/zip',
      disposition: `attachment; filename="${source.fileName}"`,
    })
  }
}
