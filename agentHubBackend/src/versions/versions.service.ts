import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import archiver, { Archiver } from 'archiver'
import fs from 'fs-extra'
import simpleGit from 'simple-git'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createVersionId, isoNow } from '../common/time'
import { ProjectsService } from '../projects/projects.service'
import { ProjectMetadata, VersionMetadata } from '../projects/project.types'
import { LocalStorageService } from '../storage/local-storage.service'
import { CreateVersionDto } from './versions.dto'

interface ZipResult {
  fileCount: number
  byteLength: number
}

@Injectable()
export class VersionsService {
  private readonly zipSkipNames = new Set(['.git', 'node_modules', 'dist', 'build'])

  constructor(
    private readonly projects: ProjectsService,
    private readonly storage: LocalStorageService,
  ) {}

  async createVersion(projectId: string, input: CreateVersionDto): Promise<VersionMetadata> {
    const project = await this.projects.getProject(projectId)
    if (input.requireAgentGate) {
      this.assertAgentGate(project)
    }

    const repoPath = this.storage.workspaceRepoPath(project.workspaceId)
    if (!(await fs.pathExists(repoPath))) {
      throw new NotFoundException(`Workspace repo not found: ${repoPath}`)
    }

    const git = simpleGit(repoPath)
    if (!(await git.checkIsRepo())) {
      throw new BadRequestException(`Workspace path is not a Git repo: ${repoPath}`)
    }

    const versionId = input.versionId ?? createVersionId()
    const tag = versionId
    await this.ensureTagDoesNotExist(git, tag)
    await this.ensureCommittedVersion(git, input.message ?? `Save product version ${versionId}`)
    await git.raw(['tag', tag])

    const commitSha = (await git.revparse(['HEAD'])).trim()
    const sourceZipPath = this.storage.sourceZipPath(projectId, versionId)
    await this.zipDirectory(repoPath, sourceZipPath)

    const now = isoNow()
    const version: VersionMetadata = {
      versionId,
      tag,
      commitSha,
      sourceZipPath,
      sourceZipUrl: `/api/projects/${encodeURIComponent(projectId)}/source.zip?versionId=${encodeURIComponent(versionId)}`,
      createdAt: now,
      updatedAt: now,
    }

    await this.projects.updateProject(projectId, current => {
      current.currentVersionId = versionId
      current.versions.push(version)
    })

    return version
  }

  async listVersions(projectId: string): Promise<VersionMetadata[]> {
    const project = await this.projects.getProject(projectId)
    return [...project.versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getDiff(projectId: string, v1: string, v2: string): Promise<{ v1: string; v2: string; diff: string }> {
    const project = await this.projects.getProject(projectId)
    const from = this.findVersion(project, v1)
    const to = this.findVersion(project, v2)
    const repoPath = this.storage.workspaceRepoPath(project.workspaceId)
    const git = simpleGit(repoPath)
    const diff = await git.diff([from.tag, to.tag])

    return {
      v1: from.versionId,
      v2: to.versionId,
      diff,
    }
  }

  async openSourceZip(projectId: string, versionId?: string): Promise<{ stream: Readable; fileName: string }> {
    const project = await this.projects.getProject(projectId)
    const version = this.findVersion(project, versionId ?? project.currentVersionId)
    if (!(await fs.pathExists(version.sourceZipPath))) {
      throw new NotFoundException(`Source zip not found for version: ${version.versionId}`)
    }

    return {
      stream: createReadStream(version.sourceZipPath),
      fileName: `${project.projectId}-${version.versionId}.zip`,
    }
  }

  async resolveVersion(projectId: string, versionId?: string): Promise<VersionMetadata> {
    const project = await this.projects.getProject(projectId)
    return this.findVersion(project, versionId ?? project.currentVersionId)
  }

  async patchVersion(projectId: string, versionId: string, patcher: (version: VersionMetadata) => void): Promise<VersionMetadata> {
    let patched: VersionMetadata | undefined
    await this.projects.updateProject(projectId, project => {
      const index = project.versions.findIndex(version => version.versionId === versionId)
      if (index === -1) {
        throw new NotFoundException(`Version not found: ${versionId}`)
      }
      patcher(project.versions[index])
      project.versions[index].updatedAt = isoNow()
      patched = project.versions[index]
    })

    if (!patched) {
      throw new NotFoundException(`Version not found: ${versionId}`)
    }
    return patched
  }

  private assertAgentGate(project: ProjectMetadata): void {
    const workflow = project.latestWorkflow
    if (!workflow) {
      throw new BadRequestException('No AgentHub workflow has been recorded for this project')
    }
    if (workflow.repairBlockedReason) {
      throw new BadRequestException(`AgentHub repair is blocked: ${workflow.repairBlockedReason}`)
    }
    if (workflow.deliveryValidationStatus && workflow.deliveryValidationStatus !== 'pass') {
      throw new BadRequestException(`Delivery validation is not pass: ${workflow.deliveryValidationStatus}`)
    }
    if (workflow.reviewVerdict && workflow.reviewVerdict !== 'pass') {
      throw new BadRequestException(`Review verdict is not pass: ${workflow.reviewVerdict}`)
    }
  }

  private findVersion(project: ProjectMetadata, versionRef?: string): VersionMetadata {
    if (!versionRef) {
      throw new BadRequestException('versionId is required because the project has no current version')
    }
    const version = project.versions.find(item => item.versionId === versionRef || item.tag === versionRef)
    if (!version) {
      throw new NotFoundException(`Version not found: ${versionRef}`)
    }
    return version
  }

  private async ensureTagDoesNotExist(git: ReturnType<typeof simpleGit>, tag: string): Promise<void> {
    const tags = await git.tags()
    if (tags.all.includes(tag)) {
      throw new BadRequestException(`Version tag already exists: ${tag}`)
    }
  }

  private async ensureCommittedVersion(git: ReturnType<typeof simpleGit>, message: string): Promise<void> {
    let hasHead = true
    try {
      await git.revparse(['--verify', 'HEAD'])
    } catch {
      hasHead = false
    }

    const status = await git.status()
    if (!hasHead || !status.isClean()) {
      await git.add('.')
      await git.raw([
        '-c',
        'user.name=AgentHub Backend',
        '-c',
        'user.email=agenthub-backend@example.local',
        'commit',
        '-m',
        message,
      ])
    }
  }

  private async zipDirectory(sourceDir: string, outputPath: string): Promise<ZipResult> {
    await fs.ensureDir(path.dirname(outputPath))
    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    let fileCount = 0

    const done = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
    })

    archive.pipe(output)
    fileCount = await this.addDirectoryToArchive(archive, sourceDir, sourceDir)
    await archive.finalize()
    await done

    const stat = await fs.stat(outputPath)
    return {
      fileCount,
      byteLength: stat.size,
    }
  }

  private async addDirectoryToArchive(archive: Archiver, rootDir: string, currentDir: string): Promise<number> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    let fileCount = 0

    for (const entry of entries) {
      if (this.zipSkipNames.has(entry.name)) {
        continue
      }

      const absolutePath = path.join(currentDir, entry.name)
      const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        fileCount += await this.addDirectoryToArchive(archive, rootDir, absolutePath)
      } else if (entry.isFile()) {
        archive.file(absolutePath, { name: relativePath })
        fileCount += 1
      }
    }

    return fileCount
  }
}
