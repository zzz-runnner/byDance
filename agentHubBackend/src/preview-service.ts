import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig } from './config.js'
import type {
  PreviewFramework,
  PreviewMode,
  ProjectPreviewBuildState,
  ProjectPreviewCapabilityResponse,
  ProjectPreviewRenderableTarget,
  StoredProjectRecord,
} from './types.js'

const SOURCE_HIDDEN_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
])
const HTML_PREVIEW_HIDDEN_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
])
const MODULE_ENTRY_CANDIDATES = [
  'index.js',
  'main.js',
  'app.js',
  'index.mjs',
  'main.mjs',
  'src/index.js',
  'src/main.js',
  'src/app.js',
  'src/index.mjs',
  'src/main.mjs',
  'src/app.mjs',
]
const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
]
const BUILD_OUTPUT_LOG_LIMIT = 10_000
const BUILD_POLL_LOG_LINE_LIMIT = 80
const MODULE_SHELL_FILE_NAME = '__module_shell__.html'

type WorkspaceDetection = {
  mode: PreviewMode
  framework: PreviewFramework
  reason: string
  sourceHash: string
  entryPath?: string
  runtimeTargets: string[]
  buildTool?: 'vite'
}

type PreviewBuildRecord = {
  workspaceId: string
  sourceHash: string
  status: 'running' | 'success' | 'failed'
  buildId: string
  summary: string
  startedAt?: string
  finishedAt?: string
  installCommand?: string
  buildCommand?: string
  logOutput: string
  error?: string
}

type PackageManifest = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type PreviewAsset =
  | {
      kind: 'html'
      content: string
      contentType: string
    }
  | {
      kind: 'file'
      filePath: string
      contentType: string
    }

/**
 * Returns whether one filesystem path exists.
 * Input: absolute path.
 * Output: true when the path can be accessed.
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Keeps one log buffer bounded while preserving the newest lines.
 * Input: accumulated log string and the next stdout or stderr chunk.
 * Output: truncated log text suitable for API responses.
 */
function appendBuildLog(current: string, chunk: string): string {
  const next = `${current}${chunk}`
  if (next.length <= BUILD_OUTPUT_LOG_LIMIT) {
    return next
  }
  return next.slice(next.length - BUILD_OUTPUT_LOG_LIMIT)
}

/**
 * Shortens one long build log into a readable tail excerpt.
 * Input: raw build log text.
 * Output: trimmed multi-line excerpt.
 */
function buildLogExcerpt(logOutput: string): string {
  const lines = logOutput
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
  return lines.slice(-BUILD_POLL_LOG_LINE_LIMIT).join('\n')
}

/**
 * Returns a stable route-safe URL for one runtime preview target.
 * Input: project id and repo-relative path.
 * Output: frontend iframe URL.
 */
function runtimePreviewUrl(projectId: string, relativePath: string): string {
  return `/preview/runtime/${encodeURIComponent(projectId)}/${relativePath.replace(/\\/g, '/')}`
}

/**
 * Returns the synthetic module-shell preview URL for one browser-safe JS entry.
 * Input: project id and repo-relative entry path.
 * Output: frontend iframe URL.
 */
function moduleShellUrl(projectId: string, entryPath: string): string {
  const query = new URLSearchParams({ entry: entryPath.replace(/\\/g, '/') })
  return `/preview/runtime/${encodeURIComponent(projectId)}/${MODULE_SHELL_FILE_NAME}?${query.toString()}`
}

/**
 * Returns one build-preview URL under the cached output folder.
 * Input: project id, source hash, and build-relative path.
 * Output: frontend iframe URL.
 */
function buildPreviewUrl(projectId: string, sourceHash: string, relativePath: string): string {
  return `/build-preview/${encodeURIComponent(projectId)}/${encodeURIComponent(sourceHash)}/${relativePath.replace(/\\/g, '/')}`
}

/**
 * Prevents path traversal outside one trusted root directory.
 * Input: absolute root path and repo-relative child path.
 * Output: resolved absolute file path inside the root.
 */
function resolveInsideRoot(rootPath: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Preview path escapes the workspace root: ${relativePath}`)
  }
  return resolvedPath
}

/**
 * Returns a content type string for one served preview file.
 * Input: absolute file path.
 * Output: HTTP content type.
 */
function previewContentType(filePath: string): string {
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
    case '.map':
    case '.md':
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
 * Returns whether one repo-relative path should be skipped while scanning source files.
 * Input: repo-relative path and directory flag.
 * Output: true when the path belongs to hidden or generated folders.
 */
function shouldHideSourcePath(relativePath: string, isDirectory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments[segments.length - 1] ?? ''
  if (segments.some(segment => SOURCE_HIDDEN_SEGMENTS.has(segment))) {
    return true
  }
  if (isDirectory && fileName.startsWith('.')) {
    return true
  }
  return false
}

/**
 * Returns whether one repo-relative path should be skipped during static HTML discovery.
 * Input: repo-relative path and directory flag.
 * Output: true when the preview scan should ignore the path.
 */
function shouldHidePreviewTarget(relativePath: string, isDirectory: boolean): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments[segments.length - 1] ?? ''
  if (segments.some(segment => HTML_PREVIEW_HIDDEN_SEGMENTS.has(segment))) {
    return true
  }
  if (isDirectory && fileName.startsWith('.')) {
    return true
  }
  return false
}

/**
 * Gives higher priority to top-level index HTML files during preview selection.
 * Input: repo-relative target path.
 * Output: lower numbers sort earlier.
 */
function previewTargetWeight(relativePath: string): number {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  if (normalized === 'index.html' || normalized === 'index.htm') {
    return 0
  }
  if (/\/index\.html?$/.test(normalized)) {
    return 1
  }
  return 2
}

/**
 * Loads one JSON package manifest when it exists.
 * Input: workspace repo path.
 * Output: parsed package manifest or undefined.
 */
async function readPackageManifest(repoPath: string): Promise<PackageManifest | undefined> {
  const manifestPath = path.join(repoPath, 'package.json')
  if (!(await pathExists(manifestPath))) {
    return undefined
  }
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest
  } catch {
    return undefined
  }
}

/**
 * Recursively collects source file paths that should affect preview detection and build caching.
 * Input: workspace repo path and optional relative folder.
 * Output: repo-relative file paths sorted lexicographically.
 */
async function collectSourceFiles(repoPath: string, relativeFolder = ''): Promise<string[]> {
  const currentPath = relativeFolder ? path.join(repoPath, relativeFolder) : repoPath
  const entries = (await readdir(currentPath, { withFileTypes: true }))
    .filter(entry => !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
  const files: string[] = []

  for (const entry of entries) {
    const relativePath = relativeFolder
      ? path.posix.join(relativeFolder.replace(/\\/g, '/'), entry.name)
      : entry.name

    if (shouldHideSourcePath(relativePath, entry.isDirectory())) {
      continue
    }

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(repoPath, relativePath))
      continue
    }

    if (entry.isFile()) {
      files.push(relativePath.replace(/\\/g, '/'))
    }
  }

  return files
}

/**
 * Computes one stable source hash from repo-relative paths plus file metadata.
 * Input: workspace repo path.
 * Output: short SHA-256 digest used by the preview build cache.
 */
async function hashWorkspaceSource(repoPath: string): Promise<string> {
  const hash = createHash('sha256')
  const files = await collectSourceFiles(repoPath)
  for (const relativePath of files) {
    const filePath = path.join(repoPath, relativePath)
    const fileStat = await stat(filePath)
    hash.update(relativePath)
    hash.update('\0')
    hash.update(String(fileStat.size))
    hash.update('\0')
    hash.update(String(fileStat.mtimeMs))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

/**
 * Recursively collects index HTML candidates from one directory.
 * Input: absolute root path and optional relative folder.
 * Output: repo-relative HTML target paths.
 */
async function collectHtmlTargets(rootPath: string, relativeFolder = ''): Promise<string[]> {
  const currentPath = relativeFolder ? path.join(rootPath, relativeFolder) : rootPath
  const entries = (await readdir(currentPath, { withFileTypes: true }))
    .filter(entry => !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
  const targets: string[] = []

  for (const entry of entries) {
    const relativePath = relativeFolder
      ? path.posix.join(relativeFolder.replace(/\\/g, '/'), entry.name)
      : entry.name

    if (shouldHidePreviewTarget(relativePath, entry.isDirectory())) {
      continue
    }

    if (entry.isDirectory()) {
      targets.push(...await collectHtmlTargets(rootPath, relativePath))
      continue
    }

    const normalized = relativePath.replace(/\\/g, '/')
    const fileName = path.posix.basename(normalized).toLowerCase()
    if (entry.isFile() && (fileName === 'index.html' || fileName === 'index.htm')) {
      targets.push(normalized)
    }
  }

  return targets
}

/**
 * Returns whether one HTML preview entry requires a Vite-style build step first.
 * Input: workspace repo path and repo-relative HTML path.
 * Output: true when the HTML references TS, TSX, JSX, Vue, or Svelte sources.
 */
async function htmlRequiresBuild(repoPath: string, relativePath: string): Promise<boolean> {
  const html = await readFile(path.join(repoPath, relativePath), 'utf8')
  if (/%VITE_[A-Z0-9_]+%/.test(html) || /@vite\/client/.test(html)) {
    return true
  }

  const assetRefs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi)]
    .map(match => match[1] ?? '')

  return assetRefs.some(reference => {
    if (!reference || /^https?:/i.test(reference) || /^\/\//.test(reference) || reference.startsWith('data:')) {
      return false
    }

    const cleanPath = reference.split(/[?#]/)[0]?.toLowerCase() ?? ''
    return /\.(ts|tsx|jsx|vue|svelte)$/.test(cleanPath)
  })
}

/**
 * Collects one lowercased dependency set from package manifest fields.
 * Input: optional package manifest.
 * Output: dependency name set.
 */
function dependencySetOf(manifest: PackageManifest | undefined): Set<string> {
  return new Set(
    [
      ...Object.keys(manifest?.dependencies ?? {}),
      ...Object.keys(manifest?.devDependencies ?? {}),
    ].map(name => name.toLowerCase()),
  )
}

/**
 * Returns the first existing file from one ordered candidate list.
 * Input: absolute repo path and repo-relative candidate paths.
 * Output: repo-relative file path or undefined.
 */
async function findFirstExistingFile(repoPath: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await pathExists(path.join(repoPath, candidate))) {
      return candidate
    }
  }
  return undefined
}

/**
 * Checks whether one repo contains any file with one of the requested extensions.
 * Input: workspace repo path, collected source files, and extension list.
 * Output: true when at least one file matches.
 */
function hasFileExtension(sourceFiles: string[], extensions: string[]): boolean {
  return sourceFiles.some(filePath => extensions.some(extension => filePath.toLowerCase().endsWith(extension)))
}

/**
 * Detects whether one JavaScript entry imports bare package specifiers that require bundling.
 * Input: workspace repo path and repo-relative entry path.
 * Output: true when the module depends on non-relative imports.
 */
async function entryUsesBareImports(repoPath: string, relativePath: string): Promise<boolean> {
  const content = await readFile(path.join(repoPath, relativePath), 'utf8')
  const specifiers = [
    ...content.matchAll(/\bimport\s+(?:[^'"]+from\s*)?["']([^"']+)["']/g),
    ...content.matchAll(/\bexport\s+[^'"]*from\s*["']([^"']+)["']/g),
    ...content.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ]
    .map(match => match[1] ?? '')
    .filter(Boolean)

  return specifiers.some(specifier => !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('http'))
}

/**
 * Detects one plain-browser module entry when the workspace does not require bundling.
 * Input: workspace repo path and collected source files.
 * Output: repo-relative JS entry path or undefined.
 */
async function detectModuleShellEntry(repoPath: string, sourceFiles: string[]): Promise<string | undefined> {
  const byName = new Set(sourceFiles.map(filePath => filePath.replace(/\\/g, '/')))
  for (const candidate of MODULE_ENTRY_CANDIDATES) {
    if (byName.has(candidate)) {
      return candidate
    }
  }

  const fallbackEntries = sourceFiles.filter(filePath => /\.(js|mjs)$/i.test(filePath))
  if (fallbackEntries.length === 1) {
    return fallbackEntries[0]
  }
  return undefined
}

/**
 * Chooses the user-facing framework label for one detected Vite workspace.
 * Input: dependency set and source-file extensions.
 * Output: preview framework identifier.
 */
function detectViteFramework(dependencies: Set<string>, sourceFiles: string[]): PreviewFramework {
  if (
    dependencies.has('react') ||
    dependencies.has('react-dom') ||
    hasFileExtension(sourceFiles, ['.jsx', '.tsx'])
  ) {
    return 'vite-react'
  }
  if (dependencies.has('vue') || hasFileExtension(sourceFiles, ['.vue'])) {
    return 'vite-vue'
  }
  if (dependencies.has('svelte') || hasFileExtension(sourceFiles, ['.svelte'])) {
    return 'vite-svelte'
  }
  return 'vite'
}

/**
 * Scans one workspace repository and returns the preview mode that should drive the UI.
 * Input: workspace repo path.
 * Output: detection result including source hash, framework, and preview entry hints.
 */
async function detectWorkspacePreview(repoPath: string): Promise<WorkspaceDetection> {
  const sourceHash = await hashWorkspaceSource(repoPath)
  const sourceFiles = await collectSourceFiles(repoPath)
  const manifest = await readPackageManifest(repoPath)
  const dependencies = dependencySetOf(manifest)
  const hasViteConfig = Boolean(await findFirstExistingFile(repoPath, VITE_CONFIG_NAMES))
  const htmlTargets = (await collectHtmlTargets(repoPath)).sort((left, right) => {
    const weightDiff = previewTargetWeight(left) - previewTargetWeight(right)
    return weightDiff !== 0 ? weightDiff : left.localeCompare(right)
  })
  const primaryHtmlTarget = htmlTargets[0]
  const primaryHtmlNeedsBuild = primaryHtmlTarget ? await htmlRequiresBuild(repoPath, primaryHtmlTarget) : false
  const hasAngularSignals =
    dependencies.has('@angular/core') ||
    dependencies.has('@angular/cli') ||
    sourceFiles.includes('angular.json')

  if (hasAngularSignals) {
    return {
      mode: 'unsupported',
      framework: 'angular',
      reason: '检测到 Angular 工程。当前本地预览第一期只支持静态页和 Vite 工程。',
      sourceHash,
      runtimeTargets: [],
    }
  }

  const hasViteLikeSignals =
    hasViteConfig ||
    dependencies.has('vite') ||
    dependencies.has('react') ||
    dependencies.has('react-dom') ||
    dependencies.has('vue') ||
    dependencies.has('svelte') ||
    hasFileExtension(sourceFiles, ['.tsx', '.jsx', '.vue', '.svelte']) ||
    primaryHtmlNeedsBuild

  if (primaryHtmlTarget && !primaryHtmlNeedsBuild) {
    return {
      mode: 'static',
      framework: 'static-html',
      reason: '检测到可直接访问的静态 HTML 入口，当前工作区可以直接预览。',
      sourceHash,
      entryPath: primaryHtmlTarget,
      runtimeTargets: htmlTargets,
    }
  }

  if (hasViteLikeSignals) {
    const framework = detectViteFramework(dependencies, sourceFiles)
    const entryPath = await findFirstExistingFile(repoPath, [
      'src/main.tsx',
      'src/main.jsx',
      'src/main.ts',
      'src/main.js',
      'src/App.vue',
      'src/App.svelte',
      primaryHtmlTarget ?? '',
    ].filter(Boolean))
    return {
      mode: 'build',
      framework,
      reason: '检测到 Vite 风格前端工程，需要先构建产物后才能预览页面效果。',
      sourceHash,
      entryPath,
      runtimeTargets: [],
      buildTool: 'vite',
    }
  }

  const moduleEntry = await detectModuleShellEntry(repoPath, sourceFiles)
  if (moduleEntry && !(await entryUsesBareImports(repoPath, moduleEntry))) {
    return {
      mode: 'module-shell',
      framework: 'vanilla-module',
      reason: '检测到浏览器原生模块入口，可以直接套一层预览壳页面运行。',
      sourceHash,
      entryPath: moduleEntry,
      runtimeTargets: [moduleEntry],
    }
  }

  if (moduleEntry) {
    return {
      mode: 'unsupported',
      framework: 'unsupported',
      reason: '检测到 JavaScript 入口，但它依赖裸模块导入。当前本地预览只支持静态页、原生浏览器模块和 Vite 工程。',
      sourceHash,
      entryPath: moduleEntry,
      runtimeTargets: [],
    }
  }

  return {
    mode: 'unsupported',
    framework: 'unsupported',
    reason: '当前工作区没有检测到可直接预览的 HTML 入口、原生浏览器模块入口或受支持的 Vite 工程。',
    sourceHash,
    runtimeTargets: [],
  }
}

/**
 * Builds the HTML wrapper used for browser-native module previews.
 * Input: project id and repo-relative module entry path.
 * Output: standalone HTML document with one module script tag.
 */
function buildModuleShellHtml(projectId: string, entryPath: string): string {
  const scriptUrl = runtimePreviewUrl(projectId, entryPath)
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${entryPath}</title>`,
    '  <style>',
    '    html, body { margin: 0; min-height: 100%; background: #ffffff; }',
    '  </style>',
    '</head>',
    '<body>',
    `  <script type="module" src="${scriptUrl}"></script>`,
    '</body>',
    '</html>',
  ].join('\n')
}

/**
 * Runs one command in a workspace directory and captures a bounded combined log.
 * Input: executable path, command arguments, workspace cwd, and optional environment overrides.
 * Output: stdout and stderr tail plus exit metadata.
 */
async function runWorkspaceCommand(input: {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}): Promise<{ code: number; logOutput: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
      },
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    let logOutput = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill()
      reject(new Error(`Command timed out after ${input.timeoutMs ?? 300_000}ms.`))
    }, input.timeoutMs ?? 300_000)

    child.stdout.on('data', chunk => {
      logOutput = appendBuildLog(logOutput, String(chunk))
    })
    child.stderr.on('data', chunk => {
      logOutput = appendBuildLog(logOutput, String(chunk))
    })
    child.on('error', error => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', code => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve({
        code: code ?? 1,
        logOutput,
      })
    })
  })
}

/**
 * Resolves the local Vite executable path inside one workspace repository.
 * Input: workspace repo path.
 * Output: absolute executable path used for the build command.
 */
function viteExecutablePath(repoPath: string): string {
  return process.platform === 'win32'
    ? path.join(repoPath, 'node_modules', '.bin', 'vite.cmd')
    : path.join(repoPath, 'node_modules', '.bin', 'vite')
}

/**
 * Resolves the npm executable name for the current platform.
 * Input: none.
 * Output: platform-aware npm command.
 */
function npmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * Manages preview detection, cached Vite builds, and workspace-bound preview file serving.
 * Input: application config.
 * Output: project preview capability and asset access helpers.
 */
export class PreviewService {
  private readonly buildRecords = new Map<string, PreviewBuildRecord>()
  private readonly runningBuilds = new Map<string, Promise<void>>()

  constructor(private readonly config: AppConfig) {}

  /**
   * Detects the current preview capability for one project workspace.
   * Input: stored project record.
   * Output: frontend-ready preview capability payload.
   */
  async getPreviewCapability(project: StoredProjectRecord): Promise<ProjectPreviewCapabilityResponse> {
    const repoPath = this.repoPathFor(project.workspaceId)
    await mkdir(repoPath, { recursive: true })
    const detection = await detectWorkspacePreview(repoPath)

    if (detection.mode === 'static') {
      const targets = detection.runtimeTargets.map(targetPath => ({
        path: targetPath,
        url: runtimePreviewUrl(project.projectId, targetPath),
        source: 'runtime' as const,
      }))
      return {
        mode: 'static',
        framework: detection.framework,
        reason: detection.reason,
        sourceHash: detection.sourceHash,
        entryPath: detection.entryPath,
        defaultTargetPath: targets[0]?.path,
        targets,
      }
    }

    if (detection.mode === 'module-shell' && detection.entryPath) {
      return {
        mode: 'module-shell',
        framework: detection.framework,
        reason: detection.reason,
        sourceHash: detection.sourceHash,
        entryPath: detection.entryPath,
        defaultTargetPath: detection.entryPath,
        targets: [{
          path: detection.entryPath,
          url: moduleShellUrl(project.projectId, detection.entryPath),
          source: 'module-shell',
        }],
      }
    }

    if (detection.mode === 'build') {
      const buildState = await this.readBuildState(project, detection)
      const targets = buildState.status === 'success'
        ? await this.listBuildTargets(project.projectId, project.workspaceId, detection.sourceHash)
        : []
      return {
        mode: 'build',
        framework: detection.framework,
        reason: detection.reason,
        sourceHash: detection.sourceHash,
        entryPath: detection.entryPath,
        defaultTargetPath: targets[0]?.path,
        targets,
        build: buildState,
      }
    }

    return {
      mode: detection.mode,
      framework: detection.framework,
      reason: detection.reason,
      sourceHash: detection.sourceHash,
      entryPath: detection.entryPath,
      targets: [],
    }
  }

  /**
   * Starts or reuses one cached preview build for the requested project.
   * Input: stored project record and optional force flag.
   * Output: refreshed preview capability snapshot after the build request is accepted.
   */
  async startPreviewBuild(
    project: StoredProjectRecord,
    options?: { force?: boolean },
  ): Promise<ProjectPreviewCapabilityResponse> {
    const repoPath = this.repoPathFor(project.workspaceId)
    await mkdir(repoPath, { recursive: true })
    const detection = await detectWorkspacePreview(repoPath)
    if (detection.mode !== 'build' || detection.buildTool !== 'vite') {
      return this.getPreviewCapability(project)
    }

    const currentState = await this.readBuildState(project, detection)
    if (!options?.force && (currentState.status === 'running' || currentState.status === 'success')) {
      return this.getPreviewCapability(project)
    }
    if (this.runningBuilds.has(project.workspaceId)) {
      return this.getPreviewCapability(project)
    }

    const record: PreviewBuildRecord = {
      workspaceId: project.workspaceId,
      sourceHash: detection.sourceHash,
      status: 'running',
      buildId: `build-${randomUUID()}`,
      summary: '正在安装依赖并构建前端预览产物。',
      startedAt: new Date().toISOString(),
      installCommand: await this.installCommandFor(repoPath),
      buildCommand: this.viteBuildCommand(project, detection.sourceHash),
      logOutput: '',
    }
    this.buildRecords.set(project.workspaceId, record)

    const runPromise = this.runPreviewBuild(project, detection, record)
      .finally(() => {
        this.runningBuilds.delete(project.workspaceId)
      })
    this.runningBuilds.set(project.workspaceId, runPromise)
    void runPromise

    return this.getPreviewCapability(project)
  }

  /**
   * Resolves one runtime preview request against workspace source files or the synthetic module shell.
   * Input: stored project record, repo-relative path suffix, and optional module-shell entry override.
   * Output: preview asset descriptor for the HTTP layer.
   */
  async openRuntimePreviewAsset(
    project: StoredProjectRecord,
    relativePath?: string,
    shellEntryPath?: string,
  ): Promise<PreviewAsset> {
    const repoPath = this.repoPathFor(project.workspaceId)
    const capability = await this.getPreviewCapability(project)
    const requestedPath = relativePath?.replace(/\\/g, '/')

    if (
      capability.mode === 'module-shell' &&
      (requestedPath === undefined || requestedPath === MODULE_SHELL_FILE_NAME)
    ) {
      const entryPath = shellEntryPath || capability.entryPath
      if (!entryPath) {
        throw new Error('Workspace module-shell preview does not have a browser entry file.')
      }
      return {
        kind: 'html',
        contentType: 'text/html; charset=utf-8',
        content: buildModuleShellHtml(project.projectId, entryPath),
      }
    }

    const fallbackPath =
      requestedPath ||
      capability.defaultTargetPath ||
      capability.entryPath
    if (!fallbackPath) {
      throw new Error('Workspace does not have a runtime preview target yet.')
    }

    const filePath = resolveInsideRoot(repoPath, fallbackPath)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error(`Preview target is not a file: ${fallbackPath}`)
    }

    return {
      kind: 'file',
      filePath,
      contentType: previewContentType(filePath),
    }
  }

  /**
   * Resolves one cached build-preview asset inside the preview build output folder.
   * Input: stored project record, source hash, and optional build-relative path.
   * Output: preview asset descriptor for the HTTP layer.
   */
  async openBuiltPreviewAsset(
    project: StoredProjectRecord,
    sourceHash: string,
    relativePath?: string,
  ): Promise<PreviewAsset> {
    const outputDir = this.buildOutputDir(project.workspaceId, sourceHash)
    const targets = await this.listHtmlTargetsForDirectory(outputDir, false)
    const targetPath = relativePath?.replace(/\\/g, '/') || targets[0]
    if (!targetPath) {
      throw new Error('Cached preview build does not contain an index HTML entry.')
    }

    const filePath = resolveInsideRoot(outputDir, targetPath)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error(`Build preview target is not a file: ${targetPath}`)
    }

    return {
      kind: 'file',
      filePath,
      contentType: previewContentType(filePath),
    }
  }

  /**
   * Reads the cached build-state snapshot for the current workspace source hash.
   * Input: stored project record and detection result.
   * Output: build-state payload exposed to the frontend.
   */
  private async readBuildState(
    project: StoredProjectRecord,
    detection: WorkspaceDetection,
  ): Promise<ProjectPreviewBuildState> {
    const liveRecord = this.buildRecords.get(project.workspaceId)
    if (liveRecord && liveRecord.sourceHash === detection.sourceHash) {
      return this.serializeBuildRecord(liveRecord)
    }

    const outputDir = this.buildOutputDir(project.workspaceId, detection.sourceHash)
    const targets = await this.listHtmlTargetsForDirectory(outputDir, false).catch(() => [])
    if (targets.length > 0) {
      return {
        status: 'success',
        sourceHash: detection.sourceHash,
        summary: '检测到可复用的本地构建缓存，预览将直接读取上一次成功产物。',
      }
    }

    return {
      status: 'idle',
      sourceHash: detection.sourceHash,
      summary: '当前源码需要先构建预览产物，才能在右侧 iframe 中查看页面效果。',
    }
  }

  /**
   * Converts one in-memory build record into the public API shape.
   * Input: running, successful, or failed build record.
   * Output: frontend-safe build-state payload.
   */
  private serializeBuildRecord(record: PreviewBuildRecord): ProjectPreviewBuildState {
    return {
      status: record.status,
      sourceHash: record.sourceHash,
      buildId: record.buildId,
      summary: record.summary,
      installCommand: record.installCommand,
      buildCommand: record.buildCommand,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      logExcerpt: buildLogExcerpt(record.logOutput),
      error: record.error,
    }
  }

  /**
   * Executes the local Vite build pipeline for one workspace and updates the cached build record.
   * Input: stored project record, detection result, and mutable build record.
   * Output: promise resolved after the build finishes or fails.
   */
  private async runPreviewBuild(
    project: StoredProjectRecord,
    detection: WorkspaceDetection,
    record: PreviewBuildRecord,
  ): Promise<void> {
    const repoPath = this.repoPathFor(project.workspaceId)
    const outputDir = this.buildOutputDir(project.workspaceId, detection.sourceHash)

    try {
      await mkdir(outputDir, { recursive: true })
      await rm(outputDir, { recursive: true, force: true })
      await mkdir(outputDir, { recursive: true })

      await this.ensureInstalledDependencies(repoPath, project.workspaceId, record)

      const viteBinary = viteExecutablePath(repoPath)
      if (!(await pathExists(viteBinary))) {
        throw new Error('当前工作区缺少本地 vite 可执行文件，无法构建预览产物。')
      }

      const buildArgs = [
        'build',
        '--outDir',
        outputDir,
        '--emptyOutDir',
        '--base',
        `/build-preview/${encodeURIComponent(project.projectId)}/${encodeURIComponent(detection.sourceHash)}/`,
      ]
      const buildResult = await runWorkspaceCommand({
        command: viteBinary,
        args: buildArgs,
        cwd: repoPath,
        timeoutMs: 300_000,
      })
      record.logOutput = appendBuildLog(record.logOutput, buildResult.logOutput)
      if (buildResult.code !== 0) {
        throw new Error(`Vite build failed with exit code ${buildResult.code}.`)
      }

      const builtTargets = await this.listHtmlTargetsForDirectory(outputDir, false)
      if (builtTargets.length === 0) {
        throw new Error('构建完成了，但产物目录里没有找到可预览的 index.html 入口。')
      }

      record.status = 'success'
      record.summary = '构建完成，预览面板现在展示的是当前源码编译后的页面产物。'
      record.finishedAt = new Date().toISOString()
      record.error = undefined
    } catch (error) {
      record.status = 'failed'
      record.summary = '构建失败，当前工作区暂时没有生成可访问的页面产物。'
      record.finishedAt = new Date().toISOString()
      record.error = error instanceof Error ? error.message : String(error)
      record.logOutput = appendBuildLog(record.logOutput, `\n${record.error}\n`)
    }
  }

  /**
   * Ensures npm dependencies exist for the current workspace before running Vite.
   * Input: workspace repo path, workspace id, and mutable build record.
   * Output: installs packages when the manifest hash changed.
   */
  private async ensureInstalledDependencies(
    repoPath: string,
    workspaceId: string,
    record: PreviewBuildRecord,
  ): Promise<void> {
    const manifestPath = path.join(repoPath, 'package.json')
    if (!(await pathExists(manifestPath))) {
      throw new Error('当前工作区没有 package.json，无法执行前端构建。')
    }

    const manifestHash = await this.installationHashFor(repoPath)
    const stampPath = path.join(this.config.previewInstallsDir, `${workspaceId}.json`)
    const nodeModulesPath = path.join(repoPath, 'node_modules')
    const installRequired =
      !(await pathExists(nodeModulesPath)) ||
      !(await this.installStampMatches(stampPath, manifestHash))

    if (!installRequired) {
      record.logOutput = appendBuildLog(record.logOutput, 'Reusing existing node_modules cache.\n')
      return
    }

    await mkdir(this.config.previewInstallsDir, { recursive: true })
    const installCommand = record.installCommand ?? await this.installCommandFor(repoPath)
    const hasPackageLock = await pathExists(path.join(repoPath, 'package-lock.json'))
    const installArgs = hasPackageLock
      ? ['ci', '--no-fund', '--no-audit']
      : ['install', '--no-package-lock', '--no-fund', '--no-audit']
    const installResult = await runWorkspaceCommand({
      command: npmExecutable(),
      args: installArgs,
      cwd: repoPath,
      timeoutMs: 300_000,
      env: {
        npm_config_fund: 'false',
        npm_config_audit: 'false',
        npm_config_package_lock: hasPackageLock ? undefined : 'false',
      },
    })
    record.installCommand = installCommand
    record.logOutput = appendBuildLog(record.logOutput, installResult.logOutput)
    if (installResult.code !== 0) {
      throw new Error(`Dependency install failed with exit code ${installResult.code}.`)
    }

    await writeFile(stampPath, `${JSON.stringify({ manifestHash }, null, 2)}\n`, 'utf8')
  }

  /**
   * Computes the hash used to decide whether npm dependencies need reinstalling.
   * Input: workspace repo path.
   * Output: short SHA-256 digest of package manifest files.
   */
  private async installationHashFor(repoPath: string): Promise<string> {
    const hash = createHash('sha256')
    for (const fileName of ['package.json', 'package-lock.json']) {
      const filePath = path.join(repoPath, fileName)
      if (await pathExists(filePath)) {
        hash.update(fileName)
        hash.update('\0')
        hash.update(await readFile(filePath))
        hash.update('\0')
      }
    }
    return hash.digest('hex').slice(0, 16)
  }

  /**
   * Checks whether one stored install stamp still matches the current manifest hash.
   * Input: stamp file path and current manifest hash.
   * Output: true when dependency installation can be reused.
   */
  private async installStampMatches(stampPath: string, manifestHash: string): Promise<boolean> {
    if (!(await pathExists(stampPath))) {
      return false
    }
    try {
      const parsed = JSON.parse(await readFile(stampPath, 'utf8')) as { manifestHash?: string }
      return parsed.manifestHash === manifestHash
    } catch {
      return false
    }
  }

  /**
   * Returns the user-visible npm install command string for logs and UI status.
   * Input: workspace repo path.
   * Output: human-readable install command.
   */
  private async installCommandFor(repoPath: string): Promise<string> {
    return (await pathExists(path.join(repoPath, 'package-lock.json')))
      ? 'npm ci --no-fund --no-audit'
      : 'npm install --no-package-lock --no-fund --no-audit'
  }

  /**
   * Returns the user-visible Vite build command string for logs and UI status.
   * Input: stored project record and source hash.
   * Output: human-readable build command.
   */
  private viteBuildCommand(project: StoredProjectRecord, sourceHash: string): string {
    return `vite build --outDir <cache> --emptyOutDir --base /build-preview/${project.projectId}/${sourceHash}/`
  }

  /**
   * Lists previewable HTML entries from one cached build output folder.
   * Input: project id, workspace id, and source hash.
   * Output: iframe target list with build-preview URLs.
   */
  private async listBuildTargets(
    projectId: string,
    workspaceId: string,
    sourceHash: string,
  ): Promise<ProjectPreviewRenderableTarget[]> {
    const outputDir = this.buildOutputDir(workspaceId, sourceHash)
    const targets = await this.listHtmlTargetsForDirectory(outputDir, false)
    return targets.map(targetPath => ({
      path: targetPath,
      url: buildPreviewUrl(projectId, sourceHash, targetPath),
      source: 'build' as const,
    }))
  }

  /**
   * Collects HTML preview entries from one arbitrary directory.
   * Input: absolute directory path and whether source-hide rules should apply.
   * Output: sorted relative HTML paths.
   */
  private async listHtmlTargetsForDirectory(directoryPath: string, applySourceHideRules: boolean): Promise<string[]> {
    if (!(await pathExists(directoryPath))) {
      return []
    }

    const hiddenPredicate = applySourceHideRules ? shouldHidePreviewTarget : () => false
    const visit = async (relativeFolder = ''): Promise<string[]> => {
      const currentPath = relativeFolder ? path.join(directoryPath, relativeFolder) : directoryPath
      const entries = (await readdir(currentPath, { withFileTypes: true }))
        .filter(entry => !entry.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(right.name))
      const results: string[] = []

      for (const entry of entries) {
        const relativePath = relativeFolder
          ? path.posix.join(relativeFolder.replace(/\\/g, '/'), entry.name)
          : entry.name
        if (hiddenPredicate(relativePath, entry.isDirectory())) {
          continue
        }
        if (entry.isDirectory()) {
          results.push(...await visit(relativePath))
          continue
        }
        const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
        if (entry.isFile() && (normalized === 'index.html' || normalized === 'index.htm' || /\/index\.html?$/.test(normalized))) {
          results.push(relativePath.replace(/\\/g, '/'))
        }
      }

      return results
    }

    return (await visit()).sort((left, right) => {
      const weightDiff = previewTargetWeight(left) - previewTargetWeight(right)
      return weightDiff !== 0 ? weightDiff : left.localeCompare(right)
    })
  }

  /**
   * Resolves the workspace repository root for one runtime workspace id.
   * Input: workspace id.
   * Output: absolute repo path inside the AgentHub runtime data folder.
   */
  private repoPathFor(workspaceId: string): string {
    return path.join(this.config.agentHubWorkspaceRootPath, workspaceId, 'repo')
  }

  /**
   * Resolves the cached Vite output folder for one workspace source hash.
   * Input: workspace id and source hash.
   * Output: absolute preview build output path.
   */
  private buildOutputDir(workspaceId: string, sourceHash: string): string {
    return path.join(this.config.previewBuildsDir, workspaceId, sourceHash)
  }
}

/**
 * Converts one preview asset into a file stream or inline HTML payload for the HTTP layer.
 * Input: resolved preview asset descriptor.
 * Output: content type plus either HTML text or readable file stream.
 */
export function previewAssetResponse(asset: PreviewAsset): {
  contentType: string
  body: string | NodeJS.ReadableStream
} {
  if (asset.kind === 'html') {
    return {
      contentType: asset.contentType,
      body: asset.content,
    }
  }

  return {
    contentType: asset.contentType,
    body: createReadStream(asset.filePath),
  }
}
