import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import extractZip from 'extract-zip'
import fs from 'fs-extra'
import { LocalStorageService } from '../storage/local-storage.service'
import { VersionsService } from '../versions/versions.service'
import { resolveWorkspaceAppRoot } from '../workspace-app-root'
import { BuildVersionDto } from './builds.dto'

const BUILD_LOG_LIMIT = 40_000

/**
 * Appends one stdout or stderr chunk while keeping the newest tail only.
 * Input: current buffered log and one new chunk.
 * Output: bounded log string suitable for API responses.
 */
function appendBuildLog(current: string, chunk: string): string {
  const next = `${current}${chunk}`
  if (next.length <= BUILD_LOG_LIMIT) {
    return next
  }
  return next.slice(next.length - BUILD_LOG_LIMIT)
}

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

      const appRoot = await resolveWorkspaceAppRoot(sourceDir) ?? {
        appRootPath: sourceDir,
        appRelativePath: '',
        appDisplayPath: 'repo',
      }
      const buildRoot = appRoot.appRootPath
      const hasPackageJson = await fs.pathExists(path.join(buildRoot, 'package.json'))
      if (hasPackageJson && !input.skipDocker) {
        if (await this.hasDockerCli()) {
          buildLog = await this.runDockerBuild(buildRoot, input)
        } else {
          buildLog = appendBuildLog(
            buildLog,
            `Docker CLI not found. Falling back to host build in ${appRoot.appDisplayPath}.\n`,
          )
          buildLog = appendBuildLog(buildLog, await this.runHostBuild(buildRoot, input))
        }
      } else if (!hasPackageJson) {
        buildLog = `No package.json found in ${appRoot.appDisplayPath}; copied static source as build artifact.`
      } else {
        buildLog = appendBuildLog(
          buildLog,
          `Docker build skipped by request. Running host build in ${appRoot.appDisplayPath}.\n`,
        )
        buildLog = appendBuildLog(buildLog, await this.runHostBuild(buildRoot, input))
      }

      const outputDir = await this.selectBuildOutputDir(buildRoot)
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

  /**
   * Checks whether Docker CLI is available for containerized frontend builds.
   * Input: none.
   * Output: true when `docker --version` can run locally.
   */
  private async hasDockerCli(): Promise<boolean> {
    return new Promise(resolve => {
      const child = spawn('docker', ['--version'], {
        windowsHide: true,
      })
      let settled = false

      child.on('error', () => {
        if (!settled) {
          settled = true
          resolve(false)
        }
      })
      child.on('close', code => {
        if (!settled) {
          settled = true
          resolve(code === 0)
        }
      })
    })
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

  /**
   * Runs one host-side dependency install plus build command inside the detected app root.
   * Input: app-root directory and optional command overrides.
   * Output: bounded combined stdout and stderr log.
   */
  private async runHostBuild(appRootDir: string, input: BuildVersionDto): Promise<string> {
    const timeoutMs = this.config.get<number>('BUILD_TIMEOUT_MS', 300_000)
    const installCommand = input.installCommand ?? await this.defaultInstallCommand(appRootDir)
    const buildCommand = input.buildCommand ?? 'npm run build'
    const script = `${installCommand} && ${buildCommand}`

    return new Promise((resolve, reject) => {
      const child = spawn(
        process.platform === 'win32' ? 'cmd.exe' : 'sh',
        process.platform === 'win32'
          ? ['/d', '/s', '/c', script]
          : ['-lc', script],
        {
          cwd: appRootDir,
          env: {
            ...process.env,
            npm_config_fund: 'false',
            npm_config_audit: 'false',
          },
          windowsHide: true,
        },
      )

      let output = ''
      let settled = false
      const append = (chunk: Buffer): void => {
        output = appendBuildLog(output, chunk.toString('utf8'))
      }

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          child.kill('SIGKILL')
          reject(new BadRequestException(`Host build timed out after ${timeoutMs}ms\n${output}`))
        }
      }, timeoutMs)

      child.stdout.on('data', append)
      child.stderr.on('data', append)
      child.on('error', error => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new BadRequestException(`Host build failed to start: ${error.message}`))
        }
      })
      child.on('close', code => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          if (code === 0) {
            resolve(output)
          } else {
            reject(new BadRequestException(`Host build exited with code ${code}\n${output}`))
          }
        }
      })
    })
  }

  /**
   * Selects one default host install command from the lockfile state.
   * Input: detected app-root directory.
   * Output: shell-ready dependency install command.
   */
  private async defaultInstallCommand(appRootDir: string): Promise<string> {
    if (await fs.pathExists(path.join(appRootDir, 'pnpm-lock.yaml'))) {
      return 'pnpm install --frozen-lockfile --prefer-offline'
    }
    if (await fs.pathExists(path.join(appRootDir, 'package-lock.json'))) {
      return 'npm ci'
    }
    if (await fs.pathExists(path.join(appRootDir, 'yarn.lock'))) {
      return 'yarn install --frozen-lockfile'
    }
    return 'npm install'
  }

  /**
   * Picks the build artifact directory from the detected app root after build completion.
   * Input: detected app-root directory.
   * Output: absolute output directory that contains the final index HTML.
   */
  private async selectBuildOutputDir(appRootDir: string): Promise<string> {
    const candidates = ['dist', 'build', 'out'].map(name => path.join(appRootDir, name))
    for (const candidate of candidates) {
      if (await fs.pathExists(path.join(candidate, 'index.html'))) {
        return candidate
      }
    }

    if (await fs.pathExists(path.join(appRootDir, 'index.html'))) {
      return appRootDir
    }

    throw new BadRequestException('Build did not produce dist/index.html, build/index.html, out/index.html, or app-root index.html')
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      const response = (error as { response?: unknown }).response
      return typeof response === 'string' ? response : error.message
    }
    return String(error)
  }
}
