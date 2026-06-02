import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Workspace } from '@shared/contracts'
import { LocalToolGateway } from '../tool-gateway'
import { zipSync } from 'fflate'

export type LocalWorkspaceRuntime = {
  workspaceId: string
  repoPath: string
  previewUrl?: string
}

export type WorkspacePreviewTarget = {
  path: string
  url: string
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

export type WorkspaceFileNode = {
  path: string
  name: string
  kind: 'directory' | 'file'
  byteLength?: number
  language?: string
  isText: boolean
  children?: WorkspaceFileNode[]
}

export type WorkspaceFileContent = {
  path: string
  name: string
  content: string
  language: string
  byteLength: number
  updatedAt: string
  lineCount: number
}

export type WorkspaceDiffSnapshot = {
  baseCommit: string
  status: string
  patch: string
}

const MAX_TEXT_FILE_BYTES = 512 * 1024
const FILE_BROWSER_HIDDEN_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
])
const TEXT_FILE_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.env',
  '.gitignore',
  '.html',
  '.htm',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.mjs',
  '.scss',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
])
const BINARY_FILE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
])
const PREVIEW_SCAN_HIDDEN_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
])

/**
 * Returns whether one repo-relative path should stay hidden during preview-target discovery.
 * Input: repo-relative path and directory flag. Output: true when the preview scan should skip it.
 */
function shouldHideFromPreviewScan(relativePath: string, isDirectory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1] ?? ''
  if (segments.some(segment => PREVIEW_SCAN_HIDDEN_SEGMENTS.has(segment))) {
    return true
  }
  if (isDirectory && fileName.startsWith('.')) {
    return true
  }
  return false
}

/**
 * Assigns a stable preference weight to one repo-relative preview entry.
 * Input: repo-relative preview path. Output: lower numbers mean higher preview priority.
 */
function previewTargetWeight(relativePath: string): number {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  if (/\/dist\/index\.html?$/.test(normalized) || normalized === 'dist/index.html') {
    return 0
  }
  if (/\/build\/index\.html?$/.test(normalized) || normalized === 'build/index.html') {
    return 1
  }
  if (normalized === 'index.html' || normalized === 'index.htm') {
    return 3
  }
  if (/\/index\.html?$/.test(normalized)) {
    return 2
  }
  return 4
}

/**
 * Collects candidate static preview entries from one workspace repository.
 * Input: repo path and optional relative folder. Output: repo-relative HTML entry paths.
 */
async function collectPreviewTargetPaths(repoPath: string, relativeFolder = ''): Promise<string[]> {
  const currentPath = relativeFolder ? path.join(repoPath, relativeFolder) : repoPath
  const entries = (await readdir(currentPath, { withFileTypes: true }))
    .filter(entry => !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
  const previewPaths: string[] = []

  for (const entry of entries) {
    const relativePath = relativeFolder
      ? path.posix.join(relativeFolder.replace(/\\/g, '/'), entry.name)
      : entry.name

    if (shouldHideFromPreviewScan(relativePath, entry.isDirectory())) {
      continue
    }

    if (entry.isDirectory()) {
      previewPaths.push(...await collectPreviewTargetPaths(repoPath, relativePath))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const normalized = relativePath.replace(/\\/g, '/')
    const fileName = path.posix.basename(normalized).toLowerCase()
    if (fileName === 'index.html' || fileName === 'index.htm') {
      previewPaths.push(normalized)
    }
  }

  return previewPaths
}

/**
 * Builds one workspace-scoped preview URL from a repo-relative target path.
 * Input: workspace id and repo-relative path. Output: browser preview URL.
 */
function previewUrlFor(workspaceId: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  return `/preview/${encodeURIComponent(workspaceId)}/${normalized}`
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
    case '.pdf':
      return 'application/pdf'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
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
 * Returns whether one repo-relative path should stay hidden in the code browser.
 * Input: repo-relative path and directory flag. Output: true when the browser should skip it.
 */
function shouldHideFromFileBrowser(relativePath: string, isDirectory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1] ?? ''
  if (segments.some(segment => FILE_BROWSER_HIDDEN_SEGMENTS.has(segment))) {
    return true
  }
  if (fileName === '.DS_Store' || fileName === 'Thumbs.db') {
    return true
  }
  if (fileName.startsWith('.env')) {
    return true
  }
  if (isDirectory && fileName.startsWith('.')) {
    return true
  }
  return false
}

/**
 * Returns the editor language id inferred from one repo-relative file path.
 * Input: repo-relative file path. Output: Monaco-friendly language id.
 */
function detectFileLanguage(relativePath: string): string {
  const fileName = path.posix.basename(relativePath).toLowerCase()
  const ext = path.posix.extname(fileName)
  if (fileName === 'dockerfile') {
    return 'dockerfile'
  }
  if (fileName === '.gitignore') {
    return 'plaintext'
  }
  switch (ext) {
    case '.css':
    case '.less':
    case '.scss':
      return 'css'
    case '.html':
    case '.htm':
      return 'html'
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript'
    case '.json':
      return 'json'
    case '.jsx':
      return 'javascript'
    case '.md':
      return 'markdown'
    case '.sql':
      return 'sql'
    case '.svg':
    case '.xml':
      return 'xml'
    case '.ts':
      return 'typescript'
    case '.tsx':
      return 'typescript'
    case '.vue':
      return 'vue'
    case '.yaml':
    case '.yml':
      return 'yaml'
    default:
      return 'plaintext'
  }
}

/**
 * Returns whether one repo-relative file path is likely text before reading content.
 * Input: repo-relative file path. Output: true when the extension is text-like.
 */
function isTextLikePath(relativePath: string): boolean {
  const ext = path.posix.extname(relativePath.toLowerCase())
  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    return true
  }
  if (BINARY_FILE_EXTENSIONS.has(ext)) {
    return false
  }
  return !path.posix.basename(relativePath).startsWith('.')
}

/**
 * Detects whether a buffer likely contains binary bytes.
 * Input: file bytes. Output: true when the file should not be opened as UTF-8 text.
 */
function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true
  }
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 1024))
  let suspiciousBytes = 0
  for (const byte of sample) {
    const isTabOrNewLine = byte === 9 || byte === 10 || byte === 13
    const isPrintableAscii = byte >= 32 && byte <= 126
    if (!isTabOrNewLine && !isPrintableAscii && byte < 128) {
      suspiciousBytes += 1
    }
  }
  return sample.byteLength > 0 && suspiciousBytes / sample.byteLength > 0.2
}

/**
 * Collects one nested workspace file tree while keeping heavy folders hidden.
 * Input: repo path and optional relative folder. Output: nested file tree nodes.
 */
async function collectWorkspaceEntries(repoPath: string, relativeFolder = ''): Promise<WorkspaceFileNode[]> {
  const currentPath = relativeFolder ? path.join(repoPath, relativeFolder) : repoPath
  const entries = (await readdir(currentPath, { withFileTypes: true }))
    .filter(entry => !entry.isSymbolicLink())
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
  const nodes: WorkspaceFileNode[] = []

  for (const entry of entries) {
    const relativePath = relativeFolder
      ? path.posix.join(relativeFolder.replace(/\\/g, '/'), entry.name)
      : entry.name
    if (shouldHideFromFileBrowser(relativePath, entry.isDirectory())) {
      continue
    }

    if (entry.isDirectory()) {
      nodes.push({
        path: relativePath,
        name: entry.name,
        kind: 'directory',
        isText: false,
        children: await collectWorkspaceEntries(repoPath, relativePath),
      })
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const filePath = path.join(currentPath, entry.name)
    const fileStat = await stat(filePath)
    nodes.push({
      path: relativePath,
      name: entry.name,
      kind: 'file',
      byteLength: fileStat.size,
      language: detectFileLanguage(relativePath),
      isText: isTextLikePath(relativePath),
    })
  }

  return nodes
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
 * Manages local workspace folders, preview discovery, and git initialization.
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
   * Input: workspace metadata. Output: local runtime paths and the current default preview URL when available.
   */
  async prepareWorkspace(workspace: Workspace): Promise<LocalWorkspaceRuntime> {
    const repoPath = this.repoPathFor(workspace.id)
    await mkdir(repoPath, { recursive: true })
    await this.ensureGitRepo(repoPath)
    const previewUrl = await this.getDefaultPreviewUrl(workspace.id)

    return {
      workspaceId: workspace.id,
      repoPath,
      previewUrl,
    }
  }

  /**
   * Lists the current preview targets that can be rendered as static pages.
   * Input: workspace id. Output: ordered preview targets plus URLs.
   */
  async listPreviewTargets(workspaceId: string): Promise<WorkspacePreviewTarget[]> {
    const repoPath = this.repoPathFor(workspaceId)
    await mkdir(repoPath, { recursive: true })
    const previewPaths = await collectPreviewTargetPaths(repoPath)
    return previewPaths
      .sort((left, right) => {
        const weightDiff = previewTargetWeight(left) - previewTargetWeight(right)
        return weightDiff !== 0 ? weightDiff : left.localeCompare(right)
      })
      .slice(0, 24)
      .map(targetPath => ({
        path: targetPath,
        url: previewUrlFor(workspaceId, targetPath),
      }))
  }

  /**
   * Returns the current default preview URL for one workspace when a static page exists.
   * Input: workspace id. Output: preview URL or undefined.
   */
  async getDefaultPreviewUrl(workspaceId: string): Promise<string | undefined> {
    const targets = await this.listPreviewTargets(workspaceId)
    return targets[0]?.url
  }

  /**
   * Resolves a workspace preview file while enforcing runtime path boundaries.
   * Input: workspace id and optional relative preview path. Output: absolute file path.
   */
  async resolvePreviewFile(workspaceId: string, relativeFilePath?: string): Promise<string> {
    const repoPath = this.repoPathFor(workspaceId)
    const defaultTargetPath = relativeFilePath
      ? undefined
      : (await this.listPreviewTargets(workspaceId))[0]?.path
    const cleanRelativePath = relativeFilePath || defaultTargetPath
    if (!cleanRelativePath) {
      throw new Error('Workspace does not have a static preview target yet.')
    }
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
   * Input: workspace id and optional relative preview path. Output: file path, content type, and readable stream.
   */
  async openPreviewAsset(workspaceId: string, relativeFilePath?: string): Promise<PreviewAsset> {
    const filePath = await this.resolvePreviewFile(workspaceId, relativeFilePath)
    return {
      filePath,
      contentType: getPreviewContentType(filePath),
      stream: createReadStream(filePath),
    }
  }

  /**
   * Opens a readable stream for a validated workspace preview file.
   * Input: workspace id and optional relative preview path. Output: readable file stream.
   */
  async openPreviewStream(workspaceId: string, relativeFilePath?: string) {
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
   * Reads the visible workspace file tree for the browser code panel.
   * Input: workspace id. Output: nested file nodes rooted at the workspace repo.
   */
  async listWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileNode[]> {
    const repoPath = this.repoPathFor(workspaceId)
    await mkdir(repoPath, { recursive: true })
    return collectWorkspaceEntries(repoPath)
  }

  /**
   * Reads one UTF-8 workspace file for the browser code panel.
   * Input: workspace id and repo-relative path. Output: text file payload plus metadata.
   */
  async readWorkspaceTextFile(workspaceId: string, relativePath: string): Promise<WorkspaceFileContent> {
    const repoPath = this.repoPathFor(workspaceId)
    const resolvedPath = this.toolGateway.resolveWorkspacePath(repoPath, relativePath)
    const fileStat = await stat(resolvedPath)

    if (!fileStat.isFile()) {
      throw new Error('Workspace file target is not a regular file.')
    }
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(`Workspace file is too large to open in the browser (${fileStat.size} bytes).`)
    }

    const buffer = await readFile(resolvedPath)
    if (!isTextLikePath(relativePath) || looksBinary(buffer)) {
      throw new Error('Workspace file is not a supported UTF-8 text file.')
    }

    const content = buffer.toString('utf8')
    return {
      path: relativePath.replace(/\\/g, '/'),
      name: path.basename(resolvedPath),
      content,
      language: detectFileLanguage(relativePath),
      byteLength: buffer.byteLength,
      updatedAt: fileStat.mtime.toISOString(),
      lineCount: content ? content.split(/\r?\n/).length : 0,
    }
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
   * Reads the current diff snapshot for one workspace repository.
   * Input: workspace id. Output: git base commit, status summary, and patch text.
   */
  async getWorkspaceDiff(workspaceId: string): Promise<WorkspaceDiffSnapshot> {
    const repoPath = this.repoPathFor(workspaceId)
    return {
      baseCommit: await this.getBaseCommit(repoPath),
      status: await this.getStatus(repoPath),
      patch: await this.getPatch(repoPath),
    }
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
    await this.runGitOrThrow(
      repoPath,
      ['commit', '--allow-empty', '-m', 'Initialize local workspace'],
      'git commit baseline',
    )
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
