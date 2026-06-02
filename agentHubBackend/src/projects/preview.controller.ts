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
 * Normalizes one wildcard route param into a slash-delimited relative path.
 * Input: raw Nest wildcard path param.
 * Output: browser-facing relative file path or undefined.
 */
function normalizePreviewPath(requestedPath: string | string[] | undefined): string | undefined {
  if (Array.isArray(requestedPath)) {
    return requestedPath.join('/')
  }
  return requestedPath
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
    await this.projects.sendRuntimePreview(projectId, normalizePreviewPath(requestedPath), query.entry, response)
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
    await this.projects.sendBuiltPreview(projectId, sourceHash, normalizePreviewPath(requestedPath), response)
  }

  @Get('preview/*path')
  async proxyRuntimePreview(
    @Param('path') requestedPath: string | string[],
    @Res() response: Response,
  ): Promise<void> {
    await this.projects.proxyPreview(`/preview/${normalizePreviewPath(requestedPath) ?? ''}`, response)
  }
}
