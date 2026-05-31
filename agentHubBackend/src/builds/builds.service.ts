import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import extractZip from 'extract-zip'
import fs from 'fs-extra'
import { LocalStorageService } from '../storage/local-storage.service'
import { VersionsService } from '../versions/versions.service'
import { BuildVersionDto } from './builds.dto'

@Injectable()
export class BuildsService {
  constructor(
    private readonly config: ConfigService,
    private readonly storage: LocalStorageService,
    private readonly versions: VersionsService,
  ) {}

  async buildVersion(projectId: string, input: BuildVersionDto): Promise<unknown> {
    const version = await this.versions.resolveVersion(projectId, input.versionId)
    const jobId = `build-${randomUUID()}`
    const jobDir = this.storage.tmpBuildDir(jobId)
    const sourceDir = path.join(jobDir, 'source')
    let buildLog = ''

    try {
      if (!(await fs.pathExists(version.sourceZipPath))) {
        throw new NotFoundException(`Source zip not found: ${version.sourceZipPath}`)
      }

      await this.storage.ensureCleanDir(jobDir)
      await fs.ensureDir(sourceDir)
      await extractZip(version.sourceZipPath, { dir: sourceDir })

      const hasPackageJson = await fs.pathExists(path.join(sourceDir, 'package.json'))
      if (hasPackageJson && !input.skipDocker) {
        buildLog = await this.runDockerBuild(sourceDir, input)
      } else if (!hasPackageJson) {
        buildLog = 'No package.json found; copied static source as build artifact.'
      } else {
        buildLog = 'Docker build skipped by request; copied source as build artifact.'
      }

      const outputDir = await this.selectBuildOutputDir(sourceDir)
      const artifactDir = this.storage.buildArtifactDir(projectId, version.versionId)
      await this.storage.ensureCleanDir(artifactDir)
      await fs.copy(outputDir, artifactDir, {
        filter: (source: string) => !source.includes(`${path.sep}node_modules${path.sep}`),
      })

      return this.versions.patchVersion(projectId, version.versionId, current => {
        current.buildPath = artifactDir
        current.buildPreviewUrl = this.storage.getBuildPreviewUrl(projectId, version.versionId)
        current.buildStatus = 'success'
        current.buildLog = buildLog.slice(-20_000)
      })
    } catch (error) {
      await this.versions.patchVersion(projectId, version.versionId, current => {
        current.buildStatus = 'failed'
        current.buildLog = this.errorMessage(error).slice(-20_000)
      }).catch(() => undefined)
      throw error
    } finally {
      await fs.remove(jobDir).catch(() => undefined)
    }
  }

  private async runDockerBuild(sourceDir: string, input: BuildVersionDto): Promise<string> {
    const image = this.config.get<string>('DOCKER_NODE_IMAGE', 'node:20-alpine')
    const timeoutMs = this.config.get<number>('BUILD_TIMEOUT_MS', 300_000)
    const cpuLimit = this.config.get<string>('BUILD_CPU_LIMIT', '1')
    const memoryLimit = this.config.get<string>('BUILD_MEMORY_LIMIT', '2g')
    const installCommand = input.installCommand ?? 'npm install'
    const buildCommand = input.buildCommand ?? 'npm run build'
    const script = `${installCommand} && ${buildCommand}`

    return new Promise((resolve, reject) => {
      const child = spawn('docker', [
        'run',
        '--rm',
        '--network',
        'bridge',
        '--cpus',
        cpuLimit,
        '-m',
        memoryLimit,
        '-v',
        `${sourceDir}:/workspace`,
        '-w',
        '/workspace',
        image,
        'sh',
        '-lc',
        script,
      ], {
        windowsHide: true,
      })

      let output = ''
      let settled = false
      const append = (chunk: Buffer): void => {
        output += chunk.toString('utf8')
        if (output.length > 40_000) {
          output = output.slice(-40_000)
        }
      }

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          child.kill('SIGKILL')
          reject(new BadRequestException(`Docker build timed out after ${timeoutMs}ms\n${output}`))
        }
      }, timeoutMs)

      child.stdout.on('data', append)
      child.stderr.on('data', append)
      child.on('error', error => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new BadRequestException(`Docker build failed to start: ${error.message}`))
        }
      })
      child.on('close', code => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          if (code === 0) {
            resolve(output)
          } else {
            reject(new BadRequestException(`Docker build exited with code ${code}\n${output}`))
          }
        }
      })
    })
  }

  private async selectBuildOutputDir(sourceDir: string): Promise<string> {
    const candidates = ['dist', 'build', 'out'].map(name => path.join(sourceDir, name))
    for (const candidate of candidates) {
      if (await fs.pathExists(path.join(candidate, 'index.html'))) {
        return candidate
      }
    }

    if (await fs.pathExists(path.join(sourceDir, 'index.html'))) {
      return sourceDir
    }

    throw new BadRequestException('Build did not produce dist/index.html, build/index.html, out/index.html, or root index.html')
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      const response = (error as { response?: unknown }).response
      return typeof response === 'string' ? response : error.message
    }
    return String(error)
  }
}
