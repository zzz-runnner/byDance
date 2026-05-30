import path from 'node:path'
import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import fs from 'fs-extra'

@Injectable()
export class LocalStorageService implements OnModuleInit {
  private readonly storageRoot: string
  private readonly runtimeRoot: string

  constructor(private readonly config: ConfigService) {
    this.storageRoot = path.resolve(process.cwd(), this.config.get<string>('APP_STORAGE_ROOT', 'storage'))
    this.runtimeRoot = path.resolve(process.cwd(), this.config.get<string>('AGENTHUB_RUNTIME_ROOT', '../agentHub/data/workspaces'))
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      fs.ensureDir(this.projectsRoot),
      fs.ensureDir(this.sourceArtifactsRoot),
      fs.ensureDir(this.buildArtifactsRoot),
      fs.ensureDir(this.deployRoot),
      fs.ensureDir(this.tmpBuildsRoot),
    ])
  }

  get root(): string {
    return this.storageRoot
  }

  get projectsRoot(): string {
    return this.resolveInsideStorage('projects')
  }

  get sourceArtifactsRoot(): string {
    return this.resolveInsideStorage('artifacts', 'source')
  }

  get buildArtifactsRoot(): string {
    return this.resolveInsideStorage('artifacts', 'build')
  }

  get deployRoot(): string {
    return this.resolveInsideStorage('deploy')
  }

  get tmpBuildsRoot(): string {
    return this.resolveInsideStorage('tmp', 'builds')
  }

  projectDir(projectId: string): string {
    return this.resolveInsideStorage('projects', this.safeSegment(projectId))
  }

  projectMetadataPath(projectId: string): string {
    return path.join(this.projectDir(projectId), 'metadata.json')
  }

  sourceZipPath(projectId: string, versionId: string): string {
    return this.resolveInsideStorage('artifacts', 'source', this.safeSegment(projectId), `${this.safeSegment(versionId)}.zip`)
  }

  buildArtifactDir(projectId: string, versionId: string): string {
    return this.resolveInsideStorage('artifacts', 'build', this.safeSegment(projectId), this.safeSegment(versionId))
  }

  deployLatestDir(projectId: string): string {
    return this.resolveInsideStorage('deploy', this.safeSegment(projectId), 'latest')
  }

  tmpBuildDir(jobId: string): string {
    return this.resolveInsideStorage('tmp', 'builds', this.safeSegment(jobId))
  }

  workspaceRepoPath(workspaceId: string): string {
    return this.resolveInsideRuntime(this.safeSegment(workspaceId), 'repo')
  }

  workspaceFilePath(workspaceId: string, relativeFilePath: string): string {
    return this.resolveInside(this.workspaceRepoPath(workspaceId), relativeFilePath)
  }

  getBuildPreviewUrl(projectId: string, versionId: string): string {
    return `/build-preview/${encodeURIComponent(projectId)}/${encodeURIComponent(versionId)}/index.html`
  }

  getDeployUrl(projectId: string): string {
    return `/deploy/${encodeURIComponent(projectId)}/latest/index.html`
  }

  async ensureCleanDir(dirPath: string): Promise<void> {
    await fs.remove(dirPath)
    await fs.ensureDir(dirPath)
  }

  private resolveInsideStorage(...segments: string[]): string {
    return this.resolveInside(this.storageRoot, ...segments)
  }

  private resolveInsideRuntime(...segments: string[]): string {
    return this.resolveInside(this.runtimeRoot, ...segments)
  }

  private resolveInside(root: string, ...segments: string[]): string {
    const resolvedRoot = path.resolve(root)
    const resolvedPath = path.resolve(resolvedRoot, ...segments)
    const normalizedRoot = resolvedRoot.toLowerCase()
    const normalizedPath = resolvedPath.toLowerCase()
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
      throw new Error(`Resolved path escapes root: ${resolvedPath}`)
    }
    return resolvedPath
  }

  private safeSegment(segment: string): string {
    if (!/^[a-zA-Z0-9_.-]+$/.test(segment)) {
      throw new Error(`Unsafe path segment: ${segment}`)
    }
    return segment
  }
}
