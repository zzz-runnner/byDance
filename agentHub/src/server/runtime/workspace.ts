import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Workspace } from '@shared/contracts'
import { LocalToolGateway } from '../tool-gateway'
import { zipSync } from 'fflate'

export type LocalWorkspaceRuntime = {
  workspaceId: string
  repoPath: string
  previewUrl: string
}

type PreviewAsset = {
  filePath: string
  contentType: string
  stream: NodeJS.ReadableStream
}

type WorkspaceZipBuild = {
  buffer: Buffer
  fileCount: number
  byteLength: number
}

/**
 * Compares two filesystem paths using platform-safe normalization.
 * Input: two path strings. Output: true when both resolve to the same folder.
 */
function sameResolvedPath(left: string, right: string): boolean {
  const normalize = (value: string) => path.resolve(value).replace(/\\/g, '/').toLowerCase()
  return normalize(left) === normalize(right)
}

/**
 * Returns the response MIME type for a preview asset path.
 * Input: resolved file path. Output: HTTP content type string.
 */
function getPreviewContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.ico':
      return 'image/x-icon'
    case '.txt':
    case '.md':
    case '.map':
      return 'text/plain; charset=utf-8'
    case '.xml':
      return 'application/xml; charset=utf-8'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Returns whether a repo-relative path should be excluded from archive output.
 * Input: repo-relative path and directory flag. Output: true when the path is skipped.
 */
function shouldExcludeFromZip(relativePath: string, isDirectory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1] ?? ''
  if (segments.includes('.git') || segments.includes('node_modules')) {
    return true
  }
  if (fileName.startsWith('.env')) {
    return true
  }
  if (fileName === '.DS_Store' || fileName === 'Thumbs.db') {
    return true
  }
  if (/(\.tmp|\.temp|\.swp|~)$/i.test(fileName)) {
    return true
  }
  if (!isDirectory && fileName.endsWith('.zip')) {
    return true
  }
  return false
}

/**
 * Collects archive entries from a workspace repository.
 * Input: repo path and optional relative folder. Output: archive entry map.
 */
async function collectZipEntries(repoPath: string, relativeFolder = ''): Promise<Record<string, Uint8Array>> {
  const currentPath = relativeFolder ? path.join(repoPath, relativeFolder) : repoPath
  const entries = (await readdir(currentPath, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )
  const archiveEntries: Record<string, Uint8Array> = {}

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }
    const relativePath = relativeFolder ? path.posix.join(relativeFolder.replace(/\\/g, '/'), entry.name) : entry.name
    if (shouldExcludeFromZip(relativePath, entry.isDirectory())) {
      continue
    }
    if (entry.isDirectory()) {
      Object.assign(archiveEntries, await collectZipEntries(repoPath, relativePath))
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    const absolutePath = path.join(currentPath, entry.name)
    archiveEntries[relativePath.replace(/\\/g, '/')] = new Uint8Array(await readFile(absolutePath))
  }

  return archiveEntries
}

/**
 * Manages local workspace folders, seed files, git initialization, and preview files.
 * Input: runtime root and tool gateway. Output: runtime manager instance.
 */
export class WorkspaceRuntimeManager {
  private readonly rootPath: string

  constructor(
    runtimeRoot: string,
    private readonly toolGateway: LocalToolGateway,
  ) {
    this.rootPath = path.resolve(runtimeRoot)
  }

  /**
   * Prepares the runtime repo folder for a workspace.
   * Input: workspace metadata. Output: local runtime paths and preview URL.
   */
  async prepareWorkspace(workspace: Workspace): Promise<LocalWorkspaceRuntime> {
    const repoPath = this.repoPathFor(workspace.id)
    await mkdir(repoPath, { recursive: true })
    await this.seedPreviewFile(repoPath, workspace)
    await this.ensureGitRepo(repoPath)

    return {
      workspaceId: workspace.id,
      repoPath,
      previewUrl: `/preview/${workspace.id}/index.html`,
    }
  }

  /**
   * Resolves a workspace preview file while enforcing runtime path boundaries.
   * Input: workspace id and relative preview path. Output: absolute file path.
   */
  async resolvePreviewFile(workspaceId: string, relativeFilePath: string): Promise<string> {
    const repoPath = this.repoPathFor(workspaceId)
    const cleanRelativePath = relativeFilePath || 'index.html'
    const resolvedPath = this.toolGateway.resolveWorkspacePath(repoPath, cleanRelativePath)
    const fileStat = await stat(resolvedPath)
    if (fileStat.isDirectory()) {
      const indexPath = path.join(resolvedPath, 'index.html')
      const indexStat = await stat(indexPath)
      if (!indexStat.isFile()) {
        throw new Error('Preview directory does not contain index.html.')
      }
      return indexPath
    }
    if (!fileStat.isFile()) {
      throw new Error('Preview target is not a file.')
    }
    return resolvedPath
  }

  /**
   * Resolves a preview asset and returns a typed readable stream.
   * Input: workspace id and relative preview path. Output: file path, content type, and readable stream.
   */
  async openPreviewAsset(workspaceId: string, relativeFilePath: string): Promise<PreviewAsset> {
    const filePath = await this.resolvePreviewFile(workspaceId, relativeFilePath)
    return {
      filePath,
      contentType: getPreviewContentType(filePath),
      stream: createReadStream(filePath),
    }
  }

  /**
   * Opens a readable stream for a validated workspace preview file.
   * Input: workspace id and relative preview path. Output: readable file stream.
   */
  async openPreviewStream(workspaceId: string, relativeFilePath: string) {
    return (await this.openPreviewAsset(workspaceId, relativeFilePath)).stream
  }

  /**
   * Returns the absolute repo path for a workspace id.
   * Input: workspace id. Output: absolute local repo path.
   */
  repoPathFor(workspaceId: string): string {
    return path.join(this.rootPath, workspaceId, 'repo')
  }

  /**
   * Returns the current git HEAD for a runtime repo.
   * Input: repo path. Output: commit hash or the seed marker when git has no commit.
   */
  async getBaseCommit(repoPath: string): Promise<string> {
    return this.toolGateway.getBaseCommit(repoPath)
  }

  /**
   * Reads the current git diff for a runtime repo.
   * Input: repo path. Output: unified patch text.
   */
  async getPatch(repoPath: string): Promise<string> {
    return this.toolGateway.getPatch(repoPath)
  }

  /**
   * Reads a small status summary for changed files in a runtime repo.
   * Input: repo path. Output: porcelain git status text.
   */
  async getStatus(repoPath: string): Promise<string> {
    return this.toolGateway.getStatus(repoPath)
  }

  /**
   * Builds a zip archive for the current workspace repository.
   * Input: workspace id. Output: archive bytes and basic file counts.
   */
  async buildWorkspaceZip(workspaceId: string): Promise<WorkspaceZipBuild> {
    const repoPath = this.repoPathFor(workspaceId)
    const archiveEntries = await collectZipEntries(repoPath)
    const buffer = Buffer.from(zipSync(archiveEntries, { level: 6 }))
    return {
      buffer,
      fileCount: Object.keys(archiveEntries).length,
      byteLength: buffer.byteLength,
    }
  }

  /**
   * Writes the default preview HTML file when a runtime repo is new.
   * Input: repo path and workspace metadata. Output: promise resolved after seed file is present.
   */
  private async seedPreviewFile(repoPath: string, workspace: Workspace): Promise<void> {
    const target = path.join(repoPath, 'index.html')
    try {
      await access(target)
      return
    } catch {
      const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${workspace.name}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, "Segoe UI", system-ui, sans-serif;
        color: #172033;
        background: #f4f7fb;
        display: grid;
        place-items: center;
      }
      main {
        width: min(840px, calc(100vw - 48px));
        border: 1px solid #d8e0ea;
        border-radius: 8px;
        background: #ffffff;
        padding: 32px;
        box-shadow: 0 18px 50px rgba(37, 51, 84, 0.12);
      }
      h1 { margin: 0 0 12px; font-size: clamp(28px, 5vw, 48px); }
      p { line-height: 1.7; color: #506176; }
      .tag { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: #e5f5ef; color: #0c6b50; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <span class="tag">AgentHub Local Runtime</span>
      <h1>${workspace.name}</h1>
      <p>${workspace.goal}</p>
      <p>This file is the workspace baseline preview. Engineer agents can replace it with real project output.</p>
    </main>
  </body>
</html>`
      await this.toolGateway.writeTextFile(repoPath, 'index.html', html)
    }
  }

  /**
   * Runs a git command and throws when the command does not complete cleanly.
   * Input: repo path, git arguments, and a label. Output: stdout text.
   */
  private async runGitOrThrow(repoPath: string, args: string[], label: string): Promise<string> {
    const result = await this.toolGateway.runCommand({
      workspaceRepoPath: repoPath,
      cwd: repoPath,
      command: 'git',
      args,
      timeoutMs: 15_000,
    })
    if (result.code !== 0 || result.timedOut) {
      const detail = result.stderr || result.stdout || `exitCode=${result.code}`
      throw new Error(`${label} failed: ${detail}`)
    }
    return result.stdout.trim()
  }

  /**
   * Checks whether the runtime folder owns its own git repository.
   * Input: repo path. Output: true when git top-level equals the runtime folder.
   */
  private async isIndependentGitRepo(repoPath: string): Promise<boolean> {
    const topLevel = await this.toolGateway.getGitTopLevel(repoPath)
    return Boolean(topLevel && sameResolvedPath(topLevel, repoPath))
  }

  /**
   * Commits the current runtime files as the workspace baseline when needed.
   * Input: repo path. Output: promise resolved after the baseline commit exists.
   */
  private async ensureBaselineCommit(repoPath: string): Promise<void> {
    if ((await this.toolGateway.getBaseCommit(repoPath)) !== 'seed') {
      return
    }
    await this.runGitOrThrow(repoPath, ['add', '.'], 'git add baseline')
    await this.runGitOrThrow(repoPath, ['commit', '-m', 'Initialize local workspace'], 'git commit baseline')
  }

  /**
   * Initializes and verifies an independent git repository for the runtime folder.
   * Input: repo path. Output: promise resolved after git metadata and baseline commit are available.
   */
  private async ensureGitRepo(repoPath: string): Promise<void> {
    if (!(await this.isIndependentGitRepo(repoPath))) {
      await this.runGitOrThrow(repoPath, ['init'], 'git init workspace')
    }
    await this.runGitOrThrow(repoPath, ['config', 'user.name', 'AgentHub Local'], 'git config user.name')
    await this.runGitOrThrow(
      repoPath,
      ['config', 'user.email', 'agenthub.local@example.invalid'],
      'git config user.email',
    )
    if (!(await this.isIndependentGitRepo(repoPath))) {
      throw new Error(`Workspace git top-level is not isolated: ${repoPath}`)
    }
    await this.ensureBaselineCommit(repoPath)
  }
}

/**
 * Reads a preview file as UTF-8 text for tests and diagnostics.
 * Input: absolute preview file path. Output: UTF-8 file content.
 */
export async function readPreviewFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}
