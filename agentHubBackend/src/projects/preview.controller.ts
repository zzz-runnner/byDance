import { Controller, Get, Param, Query, Res } from '@nestjs/common'
import { IsOptional, IsString } from 'class-validator'
import { Response } from 'express'
import { ProjectsService } from './projects.service'

class RuntimePreviewQueryDto {
  @IsOptional()
  @IsString()
  entry?: string
}

/**
 * Exposes runtime and built preview routes for the local frontend iframe.
 * Input: project-scoped preview paths and optional module entry query.
 * Output: proxied or locally-built preview assets.
 */
@Controller()
export class PreviewController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('preview/runtime/:projectId')
  async openRuntimePreviewRoot(
    @Param('projectId') projectId: string,
    @Query() query: RuntimePreviewQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.sendRuntimePreview(projectId, undefined, query.entry, response)
  }

  @Get('preview/runtime/:projectId/*path')
  async openRuntimePreviewPath(
    @Param('projectId') projectId: string,
    @Param('path') requestedPath: string | string[],
    @Query() query: RuntimePreviewQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.sendRuntimePreview(projectId, normalizeWildcardPath(requestedPath), query.entry, response)
  }

  @Get('build-preview/:projectId/:sourceHash')
  async openBuiltPreviewRoot(
    @Param('projectId') projectId: string,
    @Param('sourceHash') sourceHash: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.sendBuiltPreview(projectId, sourceHash, undefined, response)
  }

  @Get('build-preview/:projectId/:sourceHash/*path')
  async openBuiltPreviewPath(
    @Param('projectId') projectId: string,
    @Param('sourceHash') sourceHash: string,
    @Param('path') requestedPath: string | string[],
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.sendBuiltPreview(projectId, sourceHash, normalizeWildcardPath(requestedPath), response)
  }

  @Get('preview/*path')
  async proxyRuntimePreview(
    @Param('path') requestedPath: string | string[],
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.proxyPreview(`/preview/${normalizeWildcardPath(requestedPath)}`, response)
  }
}

function normalizeWildcardPath(pathParam: string | string[]): string {
  return Array.isArray(pathParam) ? pathParam.join('/') : pathParam
}
