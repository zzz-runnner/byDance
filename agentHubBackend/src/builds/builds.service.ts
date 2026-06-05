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
const ROOT_RELATIVE_ASSET_ATTR_PATTERN = /\b(src|href|poster)=("|')\/(?!\/)([^"'?#]+)([^"']*)\2/gi

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
      const portabilityResult = await this.rewritePortableHtmlAssetUrls(outputDir)
      if (portabilityResult.rewrittenReferences > 0) {
        buildLog = appendBuildLog(
          buildLog,
          `Adjusted ${portabilityResult.rewrittenReferences} root-relative asset reference(s) across ${portabilityResult.rewrittenFiles} HTML file(s) for portable nested previews.\n`,
        )
      }
      const portabilityIssues = await this.findPortableHtmlAssetIssues(outputDir)
      if (portabilityIssues.length > 0) {
        throw new BadRequestException(
          `Build output still contains root-relative asset references that would break nested preview routes:\n${portabilityIssues.join('\n')}`,
        )
      }
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
    const script = `corepack enable >/dev/null 2>&1 || true; ${installCommand} && ${buildCommand}`

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

  /**
   * Rewrites root-relative HTML asset URLs into portable relative URLs when the target exists in the build output.
   * Input: final build output directory.
   * Output: rewritten HTML file and reference counts.
   */
  private async rewritePortableHtmlAssetUrls(outputDir: string): Promise<{
    rewrittenFiles: number
    rewrittenReferences: number
  }> {
    const htmlFiles = await this.listHtmlFiles(outputDir)
    let rewrittenFiles = 0
    let rewrittenReferences = 0

    for (const htmlFilePath of htmlFiles) {
      const relativeHtmlPath = path.relative(outputDir, htmlFilePath).replace(/\\/g, '/')
      const currentHtml = await fs.readFile(htmlFilePath, 'utf8')
      let fileRewriteCount = 0

      const nextHtml = currentHtml.replace(
        ROOT_RELATIVE_ASSET_ATTR_PATTERN,
        (match, attributeName: string, quote: string, assetPath: string, suffix = '') => {
          const portableUrl = this.tryBuildPortableAssetUrl(outputDir, relativeHtmlPath, assetPath)
          if (!portableUrl) {
            return match
          }

          fileRewriteCount += 1
          return `${attributeName}=${quote}${portableUrl}${suffix}${quote}`
        },
      )

      if (fileRewriteCount === 0) {
        continue
      }

      rewrittenFiles += 1
      rewrittenReferences += fileRewriteCount
      await fs.writeFile(htmlFilePath, nextHtml, 'utf8')
    }

    return {
      rewrittenFiles,
      rewrittenReferences,
    }
  }

  /**
   * Collects any remaining root-relative HTML asset URLs that still point to files inside the build output.
   * Input: final build output directory.
   * Output: one issue string per unresolved HTML asset reference.
   */
  private async findPortableHtmlAssetIssues(outputDir: string): Promise<string[]> {
    const htmlFiles = await this.listHtmlFiles(outputDir)
    const issues: string[] = []

    for (const htmlFilePath of htmlFiles) {
      const relativeHtmlPath = path.relative(outputDir, htmlFilePath).replace(/\\/g, '/')
      const html = await fs.readFile(htmlFilePath, 'utf8')

      for (const match of html.matchAll(ROOT_RELATIVE_ASSET_ATTR_PATTERN)) {
        const assetPath = match[3]
        if (!this.tryBuildPortableAssetUrl(outputDir, relativeHtmlPath, assetPath)) {
          continue
        }

        issues.push(`${relativeHtmlPath} -> /${assetPath}`)
      }
    }

    return issues
  }

  /**
   * Returns one portable relative asset URL when the referenced file exists inside the build output.
   * Input: output directory, current HTML file path, and root-relative asset path.
   * Output: relative asset URL or undefined when the reference should stay untouched.
   */
  private tryBuildPortableAssetUrl(
    outputDir: string,
    relativeHtmlPath: string,
    assetPath: string,
  ): string | undefined {
    const normalizedAssetPath = assetPath.replace(/^\/+/, '').replace(/\\/g, '/')
    if (!normalizedAssetPath) {
      return undefined
    }

    const resolvedAssetPath = path.resolve(outputDir, normalizedAssetPath)
    if (!this.isInsideDirectory(outputDir, resolvedAssetPath) || !fs.existsSync(resolvedAssetPath)) {
      return undefined
    }

    const htmlDirectory = path.posix.dirname(relativeHtmlPath)
    const relativeAssetPath = path.posix.relative(
      htmlDirectory === '.' ? '' : htmlDirectory,
      normalizedAssetPath,
    )

    return relativeAssetPath.startsWith('.') ? relativeAssetPath : `./${relativeAssetPath}`
  }

  /**
   * Lists every HTML file beneath the build output directory.
   * Input: final build output directory.
   * Output: absolute HTML file paths.
   */
  private async listHtmlFiles(outputDir: string): Promise<string[]> {
    const htmlFiles: string[] = []

    const visit = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        const nextPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await visit(nextPath)
          continue
        }

        if (entry.isFile() && /\.(html?)$/i.test(entry.name)) {
          htmlFiles.push(nextPath)
        }
      }
    }

    await visit(outputDir)
    return htmlFiles
  }

  /**
   * Checks whether one path stays inside the expected parent directory after normalization.
   * Input: parent directory and candidate path.
   * Output: true when the candidate does not escape the parent directory.
   */
  private isInsideDirectory(parentDir: string, candidatePath: string): boolean {
    const resolvedParentDir = path.resolve(parentDir)
    const resolvedCandidatePath = path.resolve(candidatePath)
    return resolvedCandidatePath === resolvedParentDir || resolvedCandidatePath.startsWith(`${resolvedParentDir}${path.sep}`)
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      const response = (error as { response?: unknown }).response
      return typeof response === 'string' ? response : error.message
    }
    return String(error)
  }
}
