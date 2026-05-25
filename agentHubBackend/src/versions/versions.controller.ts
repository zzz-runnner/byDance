import { Body, Controller, Get, Param, Post, Query, StreamableFile } from '@nestjs/common'
import { CreateVersionDto, DiffQueryDto } from './versions.dto'
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

  @Get('diff')
  getDiff(
    @Param('projectId') projectId: string,
    @Query() query: DiffQueryDto,
  ) {
    return this.versions.getDiff(projectId, query.v1, query.v2)
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
