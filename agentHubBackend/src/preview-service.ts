import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig } from './config'
import type {
  PreviewFramework,
  PreviewMode,
  ProjectPreviewBuildState,
  ProjectPreviewCapabilityResponse,
  ProjectPreviewRenderableTarget,
  StoredProjectRecord,
} from './types'

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
const MANIFEST_HASH_FILE_NAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  '.npmrc',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'jsconfig.json',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  'postcss.config.ts',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.ts',
  'babel.config.js',
  'babel.config.cjs',
  'babel.config.mjs',
  'babel.config.ts',
  '.browserslistrc',
  ...VITE_CONFIG_NAMES,
])
const BUILD_OUTPUT_LOG_LIMIT = 10_000
const BUILD_POLL_LOG_LINE_LIMIT = 80
const MODULE_SHELL_FILE_NAME = '__module_shell__.html'
const RUNTIME_MARKER_FILE_NAME = '.preview-runtime.json'
const SANDBOX_INSTALL_MARKER_FILE_NAME = '.preview-install.json'
const SANDBOX_RETENTION_MS = 24 * 60 * 60 * 1000
const OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000
const MAX_CONCURRENT_BUILDS = 2
const PRESERVED_SANDBOX_ENTRIES = new Set([
  'node_modules',
  RUNTIME_MARKER_FILE_NAME,
  SANDBOX_INSTALL_MARKER_FILE_NAME,
])

type WorkspaceDetection = {
  mode: PreviewMode
  framework: PreviewFramework
  reason: string
  sourceHash: string
  cacheKey: string
  manifestHash?: string
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

type RuntimeDirectoryMarker = {
  kind: 'sandbox' | 'output'
  workspaceId: string
  manifestHash?: string
  sourceHash?: string
  updatedAt: string
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
 * Removes one UTF-8 BOM prefix from text content.
 * Input: raw UTF-8 text.
 * Output: BOM-free text string.
 */
function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
}

/**
 * Reads one UTF-8 text file while tolerating BOM-prefixed content.
 * Input: absolute file path.
 * Output: decoded text content.
 */
async function readUtf8Text(filePath: string): Promise<string> {
  return stripUtf8Bom(await readFile(filePath, 'utf8'))
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
 * Input: project id, build cache key, and build-relative path.
 * Output: frontend iframe URL.
 */
function buildPreviewUrl(projectId: string, cacheKey: string, relativePath: string): string {
  return `/build-preview/${encodeURIComponent(projectId)}/${encodeURIComponent(cacheKey)}/${relativePath.replace(/\\/g, '/')}`
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
 * Checks whether one root-level file contributes to dependency or build-config hashing.
 * Input: repo-relative file path.
 * Output: true when the file affects dependency installation or build config.
 */
function isManifestHashFile(relativePath: string): boolean {
  return !relativePath.includes('/') && MANIFEST_HASH_FILE_NAMES.has(relativePath.toLowerCase())
}

/**
 * Computes one short hash from string parts.
 * Input: ordered string fragments.
 * Output: short SHA-256 digest.
 */
function hashStrings(parts: string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
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
    return JSON.parse(await readUtf8Text(manifestPath)) as PackageManifest
  } catch {
    return undefined
  }
}

/**
 * Recursively collects source file paths that should affect preview detection.
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
 * Computes one stable file-content hash from repo-relative paths.
 * Input: workspace repo path and ordered repo-relative file paths.
 * Output: short SHA-256 digest used by cache keys.
 */
async function hashWorkspaceFiles(repoPath: string, relativePaths: string[]): Promise<string> {
  const hash = createHash('sha256')
  for (const relativePath of relativePaths) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(await readFile(path.join(repoPath, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

/**
 * Computes the hashes used by preview detection and build caching.
 * Input: workspace repo path and collected source files.
 * Output: full-source hash, source-only hash, and manifest hash.
 */
async function computeWorkspaceHashes(repoPath: string, sourceFiles: string[]): Promise<{
  fullSourceHash: string
  sourceHash: string
  manifestHash: string
}> {
  const fullSourceHash = sourceFiles.length > 0
    ? await hashWorkspaceFiles(repoPath, sourceFiles)
    : hashStrings(['empty-workspace'])
  const manifestFiles = sourceFiles.filter(isManifestHashFile)
  const sourceOnlyFiles = sourceFiles.filter(relativePath => !isManifestHashFile(relativePath))
  const sourceHash = (sourceOnlyFiles.length > 0 ? await hashWorkspaceFiles(repoPath, sourceOnlyFiles) : fullSourceHash)
  const manifestHash = manifestFiles.length > 0
    ? await hashWorkspaceFiles(repoPath, manifestFiles)
    : hashStrings(['no-manifest'])

  return {
    fullSourceHash,
    sourceHash,
    manifestHash,
  }
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
  const html = await readUtf8Text(path.join(repoPath, relativePath))
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
 * Input: collected source files and extension list.
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
  const content = await readUtf8Text(path.join(repoPath, relativePath))
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
 * Input: collected source files.
 * Output: repo-relative JS entry path or undefined.
 */
async function detectModuleShellEntry(sourceFiles: string[]): Promise<string | undefined> {
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
 * Output: detection result including cache keys, framework, and preview entry hints.
 */
async function detectWorkspacePreview(repoPath: string): Promise<WorkspaceDetection> {
  const sourceFiles = await collectSourceFiles(repoPath)
  const hashes = await computeWorkspaceHashes(repoPath, sourceFiles)
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
      reason: '检测到 Angular 工程。当前本地预览第一期只支持静态页面、原生模块和 Vite 工程。',
      sourceHash: hashes.fullSourceHash,
      cacheKey: hashes.fullSourceHash,
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
      sourceHash: hashes.fullSourceHash,
      cacheKey: hashes.fullSourceHash,
      entryPath: primaryHtmlTarget,
      runtimeTargets: htmlTargets,
    }
  }

  if (hasViteLikeSignals) {
    if (!(await pathExists(path.join(repoPath, 'package.json')))) {
      return {
        mode: 'unsupported',
        framework: 'unsupported',
        reason: '检测到需要构建的前端工程，但当前工作区缺少 package.json，无法准备本地预览环境。',
        sourceHash: hashes.fullSourceHash,
        cacheKey: hashes.fullSourceHash,
        runtimeTargets: [],
      }
    }

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
    const cacheKey = hashStrings([hashes.manifestHash, hashes.sourceHash])

    return {
      mode: 'build',
      framework,
      reason: '检测到 Vite 风格前端工程，后端会在独立沙箱里准备依赖并构建预览产物。',
      sourceHash: hashes.sourceHash,
      cacheKey,
      manifestHash: hashes.manifestHash,
      entryPath,
      runtimeTargets: [],
      buildTool: 'vite',
    }
  }

  const moduleEntry = await detectModuleShellEntry(sourceFiles)
  if (moduleEntry && !(await entryUsesBareImports(repoPath, moduleEntry))) {
    return {
      mode: 'module-shell',
      framework: 'vanilla-module',
      reason: '检测到浏览器原生模块入口，可以直接套一层预览壳页面运行。',
      sourceHash: hashes.fullSourceHash,
      cacheKey: hashes.fullSourceHash,
      entryPath: moduleEntry,
      runtimeTargets: [moduleEntry],
    }
  }

  if (moduleEntry) {
    return {
      mode: 'unsupported',
      framework: 'unsupported',
      reason: '检测到 JavaScript 入口，但它依赖裸模块导入。当前本地预览只支持静态页面、原生浏览器模块和 Vite 工程。',
      sourceHash: hashes.fullSourceHash,
      cacheKey: hashes.fullSourceHash,
      entryPath: moduleEntry,
      runtimeTargets: [],
    }
  }

  return {
    mode: 'unsupported',
    framework: 'unsupported',
    reason: '当前工作区没有检测到可直接预览的 HTML 入口、原生浏览器模块入口或受支持的 Vite 工程。',
    sourceHash: hashes.fullSourceHash,
    cacheKey: hashes.fullSourceHash,
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
 * Resolves the pnpm executable name for the current platform.
 * Input: none.
 * Output: platform-aware pnpm command.
 */
function pnpmExecutable(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Manages preview detection, shared pnpm installs, sandbox builds, and preview file serving.
 * Input: application config.
 * Output: project preview capability and asset access helpers.
 */
export class PreviewService {
  private readonly buildRecords = new Map<string, PreviewBuildRecord>()
  private readonly runningBuilds = new Map<string, Promise<void>>()
  private readonly buildWaiters: Array<() => void> = []
  private activeBuildCount = 0
  private cleanupPromise?: Promise<void>
  private lastCleanupStartedAt = 0

  constructor(private readonly config: AppConfig) {}

  /**
   * Detects the current preview capability for one project workspace.
   * Input: stored project record.
   * Output: frontend-ready preview capability payload.
   */
  async getPreviewCapability(project: StoredProjectRecord): Promise<ProjectPreviewCapabilityResponse> {
    this.scheduleRuntimeCleanup()
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
        sourceHash: detection.cacheKey,
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
        sourceHash: detection.cacheKey,
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
        ? await this.listBuildTargets(project.projectId, project.workspaceId, detection.cacheKey)
        : []
      return {
        mode: 'build',
        framework: detection.framework,
        reason: detection.reason,
        sourceHash: detection.cacheKey,
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
      sourceHash: detection.cacheKey,
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
    this.scheduleRuntimeCleanup()
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
      sourceHash: detection.cacheKey,
      status: 'running',
      buildId: `build-${randomUUID()}`,
      summary: '正在等待本地预览构建槽。',
      startedAt: new Date().toISOString(),
      installCommand: await this.installCommandFor(repoPath),
      buildCommand: this.viteBuildCommand(project, detection.cacheKey),
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
   * Resolves one cached build-preview asset inside the preview output folder.
   * Input: stored project record, build cache key, and optional build-relative path.
   * Output: preview asset descriptor for the HTTP layer.
   */
  async openBuiltPreviewAsset(
    project: StoredProjectRecord,
    cacheKey: string,
    relativePath?: string,
  ): Promise<PreviewAsset> {
    const outputDir = this.outputDirFor(project.workspaceId, cacheKey)
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

    await this.touchRuntimeDirectory(outputDir, {
      kind: 'output',
      workspaceId: project.workspaceId,
      sourceHash: cacheKey,
      updatedAt: new Date().toISOString(),
    })

    return {
      kind: 'file',
      filePath,
      contentType: previewContentType(filePath),
    }
  }

  /**
   * Reads the cached build-state snapshot for the current workspace preview key.
   * Input: stored project record and detection result.
   * Output: build-state payload exposed to the frontend.
   */
  private async readBuildState(
    project: StoredProjectRecord,
    detection: WorkspaceDetection,
  ): Promise<ProjectPreviewBuildState> {
    const liveRecord = this.buildRecords.get(project.workspaceId)
    if (liveRecord && liveRecord.sourceHash === detection.cacheKey) {
      return this.serializeBuildRecord(liveRecord)
    }

    const outputDir = this.outputDirFor(project.workspaceId, detection.cacheKey)
    const targets = await this.listHtmlTargetsForDirectory(outputDir, false).catch(() => [])
    if (targets.length > 0) {
      await this.touchRuntimeDirectory(outputDir, {
        kind: 'output',
        workspaceId: project.workspaceId,
        manifestHash: detection.manifestHash,
        sourceHash: detection.cacheKey,
        updatedAt: new Date().toISOString(),
      })
      return {
        status: 'success',
        sourceHash: detection.cacheKey,
        summary: '检测到可复用的本地预览产物缓存，预览将直接读取上一次成功构建结果。',
      }
    }

    return {
      status: 'idle',
      sourceHash: detection.cacheKey,
      summary: '当前源码需要先由后端准备预览环境并构建产物，才能在右侧 iframe 中查看页面效果。',
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
   * Executes the shared-store Vite build pipeline for one workspace.
   * Input: stored project record, detection result, and mutable build record.
   * Output: promise resolved after the build finishes or fails.
   */
  private async runPreviewBuild(
    project: StoredProjectRecord,
    detection: WorkspaceDetection,
    record: PreviewBuildRecord,
  ): Promise<void> {
    if (!detection.manifestHash) {
      record.status = 'failed'
      record.summary = '当前工作区缺少可用的依赖描述，无法准备本地预览环境。'
      record.finishedAt = new Date().toISOString()
      record.error = 'Preview build requires a manifest hash.'
      return
    }

    const releaseBuildSlot = await this.acquireBuildSlot(record)
    try {
      const outputDir = this.outputDirFor(project.workspaceId, detection.cacheKey)
      const sandboxDir = await this.prepareBuildSandbox(project.workspaceId, detection, record)

      await mkdir(outputDir, { recursive: true })
      await rm(outputDir, { recursive: true, force: true })
      await mkdir(outputDir, { recursive: true })

      record.summary = '正在构建当前源码对应的页面预览产物。'
      record.buildCommand = this.viteBuildCommand(project, detection.cacheKey)
      const buildArgs = [
        'exec',
        'vite',
        'build',
        '--outDir',
        outputDir,
        '--emptyOutDir',
        '--base',
        `/build-preview/${encodeURIComponent(project.projectId)}/${encodeURIComponent(detection.cacheKey)}/`,
      ]
      const buildResult = await runWorkspaceCommand({
        command: pnpmExecutable(),
        args: buildArgs,
        cwd: sandboxDir,
        timeoutMs: 300_000,
        env: {
          npm_config_fund: 'false',
          npm_config_audit: 'false',
          pnpm_config_store_dir: this.config.pnpmStoreDir,
        },
      })
      record.logOutput = appendBuildLog(record.logOutput, buildResult.logOutput)
      if (buildResult.code !== 0) {
        throw new Error(`Vite build failed with exit code ${buildResult.code}.`)
      }

      const builtTargets = await this.listHtmlTargetsForDirectory(outputDir, false)
      if (builtTargets.length === 0) {
        throw new Error('构建完成了，但产物目录里没有找到可预览的 index.html 入口。')
      }

      await this.touchRuntimeDirectory(outputDir, {
        kind: 'output',
        workspaceId: project.workspaceId,
        manifestHash: detection.manifestHash,
        sourceHash: detection.cacheKey,
        updatedAt: new Date().toISOString(),
      })

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
    } finally {
      releaseBuildSlot()
    }
  }

  /**
   * Prepares one clean build sandbox without polluting the user workspace repo.
   * Input: workspace id, detection result, and mutable build record.
   * Output: absolute sandbox directory path.
   */
  private async prepareBuildSandbox(
    workspaceId: string,
    detection: WorkspaceDetection,
    record: PreviewBuildRecord,
  ): Promise<string> {
    if (!detection.manifestHash) {
      throw new Error('Preview build sandbox requires a manifest hash.')
    }

    const repoPath = this.repoPathFor(workspaceId)
    const sandboxDir = this.sandboxDirFor(workspaceId, detection.manifestHash)

    record.summary = '正在同步源码到独立构建沙箱。'
    await this.syncSandboxSource(repoPath, sandboxDir)
    await this.touchRuntimeDirectory(sandboxDir, {
      kind: 'sandbox',
      workspaceId,
      manifestHash: detection.manifestHash,
      sourceHash: detection.cacheKey,
      updatedAt: new Date().toISOString(),
    })

    record.summary = '正在准备共享依赖环境。'
    await this.ensureSandboxDependencies(sandboxDir, repoPath, record)
    return sandboxDir
  }

  /**
   * Mirrors one workspace repo into a clean sandbox while preserving sandbox node_modules.
   * Input: repo path and sandbox path.
   * Output: sandbox contains a fresh source snapshot only.
   */
  private async syncSandboxSource(repoPath: string, sandboxDir: string): Promise<void> {
    await mkdir(sandboxDir, { recursive: true })

    const existingEntries = (await readdir(sandboxDir, { withFileTypes: true }))
      .filter(entry => !PRESERVED_SANDBOX_ENTRIES.has(entry.name))
    for (const entry of existingEntries) {
      await rm(path.join(sandboxDir, entry.name), { recursive: true, force: true })
    }

    const sourceFiles = await collectSourceFiles(repoPath)
    for (const relativePath of sourceFiles) {
      const sourcePath = path.join(repoPath, relativePath)
      const targetPath = resolveInsideRoot(sandboxDir, relativePath)
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath)
    }
  }

  /**
   * Ensures pnpm dependencies exist inside the sandbox and reuse the shared store.
   * Input: sandbox path, repo path, and mutable build record.
   * Output: sandbox node_modules ready for Vite build.
   */
  private async ensureSandboxDependencies(
    sandboxDir: string,
    repoPath: string,
    record: PreviewBuildRecord,
  ): Promise<void> {
    const manifestPath = path.join(sandboxDir, 'package.json')
    if (!(await pathExists(manifestPath))) {
      throw new Error('当前工作区没有 package.json，无法执行前端构建。')
    }

    const nodeModulesPath = path.join(sandboxDir, 'node_modules')
    const installMarkerPath = path.join(sandboxDir, SANDBOX_INSTALL_MARKER_FILE_NAME)
    if ((await pathExists(nodeModulesPath)) && (await pathExists(installMarkerPath))) {
      record.logOutput = appendBuildLog(record.logOutput, 'Reusing sandbox node_modules with shared pnpm store.\n')
      return
    }
    if (await pathExists(nodeModulesPath)) {
      await rm(nodeModulesPath, { recursive: true, force: true })
    }
    await rm(installMarkerPath, { force: true })

    await mkdir(this.config.pnpmStoreDir, { recursive: true })
    const installArgs = await this.installArgsFor(repoPath)
    record.installCommand = this.installCommandDisplay(installArgs)
    let installResult = await runWorkspaceCommand({
      command: pnpmExecutable(),
      args: installArgs,
      cwd: sandboxDir,
      timeoutMs: 300_000,
      env: {
        npm_config_fund: 'false',
        npm_config_audit: 'false',
        pnpm_config_store_dir: this.config.pnpmStoreDir,
      },
    })
    record.logOutput = appendBuildLog(record.logOutput, installResult.logOutput)
    if (installResult.code !== 0 && /ERR_PNPM_IGNORED_BUILDS/.test(installResult.logOutput)) {
      record.summary = '正在批准沙箱依赖构建脚本。'
      const approvalResult = await runWorkspaceCommand({
        command: pnpmExecutable(),
        args: ['approve-builds', '--all'],
        cwd: sandboxDir,
        timeoutMs: 120_000,
        env: {
          npm_config_fund: 'false',
          npm_config_audit: 'false',
          pnpm_config_store_dir: this.config.pnpmStoreDir,
        },
      })
      record.logOutput = appendBuildLog(record.logOutput, approvalResult.logOutput)
      if (approvalResult.code !== 0) {
        await rm(nodeModulesPath, { recursive: true, force: true })
        await rm(installMarkerPath, { force: true })
        throw new Error(`Dependency approval failed with exit code ${approvalResult.code}.`)
      }

      record.summary = '正在重新安装共享依赖。'
      installResult = await runWorkspaceCommand({
        command: pnpmExecutable(),
        args: installArgs,
        cwd: sandboxDir,
        timeoutMs: 300_000,
        env: {
          npm_config_fund: 'false',
          npm_config_audit: 'false',
          pnpm_config_store_dir: this.config.pnpmStoreDir,
        },
      })
      record.logOutput = appendBuildLog(record.logOutput, installResult.logOutput)
    }
    if (installResult.code !== 0) {
      await rm(nodeModulesPath, { recursive: true, force: true })
      await rm(installMarkerPath, { force: true })
      throw new Error(`Dependency install failed with exit code ${installResult.code}.`)
    }

    await writeFile(
      installMarkerPath,
      `${JSON.stringify({ installedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    )
  }

  /**
   * Computes the pnpm install arguments for one repo manifest state.
   * Input: source repo path.
   * Output: pnpm install argument list with shared-store settings.
   */
  private async installArgsFor(repoPath: string): Promise<string[]> {
    const hasPnpmLock = await pathExists(path.join(repoPath, 'pnpm-lock.yaml'))
    return [
      'install',
      '--store-dir',
      this.config.pnpmStoreDir,
      hasPnpmLock ? '--frozen-lockfile' : '--no-frozen-lockfile',
      '--prefer-offline',
      '--reporter=append-only',
    ]
  }

  /**
   * Returns the user-visible pnpm install command string for logs and UI status.
   * Input: install argument list.
   * Output: human-readable install command.
   */
  private installCommandDisplay(args: string[]): string {
    return ['pnpm', ...args.map(arg => arg === this.config.pnpmStoreDir ? '<shared-store>' : arg)].join(' ')
  }

  /**
   * Returns the user-visible preview build command string for logs and UI status.
   * Input: stored project record and preview cache key.
   * Output: human-readable build command.
   */
  private viteBuildCommand(project: StoredProjectRecord, cacheKey: string): string {
    return `pnpm exec vite build --outDir <preview-output> --emptyOutDir --base /build-preview/${project.projectId}/${cacheKey}/`
  }

  /**
   * Lists previewable HTML entries from one cached build output folder.
   * Input: project id, workspace id, and preview cache key.
   * Output: iframe target list with build-preview URLs.
   */
  private async listBuildTargets(
    projectId: string,
    workspaceId: string,
    cacheKey: string,
  ): Promise<ProjectPreviewRenderableTarget[]> {
    const outputDir = this.outputDirFor(workspaceId, cacheKey)
    const targets = await this.listHtmlTargetsForDirectory(outputDir, false)
    return targets.map(targetPath => ({
      path: targetPath,
      url: buildPreviewUrl(projectId, cacheKey, targetPath),
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
   * Acquires one global build slot so local preview builds do not saturate the machine.
   * Input: mutable build record.
   * Output: release callback invoked after the build finishes.
   */
  private async acquireBuildSlot(record: PreviewBuildRecord): Promise<() => void> {
    if (this.activeBuildCount < MAX_CONCURRENT_BUILDS) {
      this.activeBuildCount += 1
      record.summary = '正在准备后端预览环境。'
      return () => this.releaseBuildSlot()
    }

    record.summary = '本地预览构建排队中，正在等待空闲构建槽。'
    await new Promise<void>(resolve => {
      this.buildWaiters.push(() => {
        this.activeBuildCount += 1
        record.summary = '正在准备后端预览环境。'
        resolve()
      })
    })
    return () => this.releaseBuildSlot()
  }

  /**
   * Releases one global build slot and wakes the next waiting build if present.
   * Input: none.
   * Output: one queued build resumes when a slot becomes free.
   */
  private releaseBuildSlot(): void {
    this.activeBuildCount = Math.max(0, this.activeBuildCount - 1)
    const next = this.buildWaiters.shift()
    next?.()
  }

  /**
   * Starts one periodic cleanup pass for stale sandboxes and preview outputs.
   * Input: none.
   * Output: cleanup is scheduled in the background when due.
   */
  private scheduleRuntimeCleanup(): void {
    const now = Date.now()
    if (this.cleanupPromise || now - this.lastCleanupStartedAt < CLEANUP_INTERVAL_MS) {
      return
    }

    this.lastCleanupStartedAt = now
    this.cleanupPromise = this.cleanupRuntimeDirectories()
      .catch(() => undefined)
      .finally(() => {
        this.cleanupPromise = undefined
      })
  }

  /**
   * Removes stale runtime directories that no longer need to be retained locally.
   * Input: none.
   * Output: outdated sandbox and preview-output folders removed.
   */
  private async cleanupRuntimeDirectories(): Promise<void> {
    await this.cleanupWorkspaceScopedDirectory(this.config.previewSandboxesDir, SANDBOX_RETENTION_MS)
    await this.cleanupWorkspaceScopedDirectory(this.config.previewOutputsDir, OUTPUT_RETENTION_MS)
  }

  /**
   * Removes stale child directories inside one workspace-scoped runtime root.
   * Input: root directory and retention duration in milliseconds.
   * Output: child directories older than the retention window removed.
   */
  private async cleanupWorkspaceScopedDirectory(rootDir: string, retentionMs: number): Promise<void> {
    if (!(await pathExists(rootDir))) {
      return
    }

    const workspaceEntries = (await readdir(rootDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const workspaceEntry of workspaceEntries) {
      if (this.runningBuilds.has(workspaceEntry.name)) {
        continue
      }

      const workspaceDir = path.join(rootDir, workspaceEntry.name)
      const runtimeEntries = (await readdir(workspaceDir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))

      for (const runtimeEntry of runtimeEntries) {
        const runtimeDir = path.join(workspaceDir, runtimeEntry.name)
        const lastUsedAt = await this.runtimeDirectoryLastUsedAt(runtimeDir)
        if (Date.now() - lastUsedAt > retentionMs) {
          await rm(runtimeDir, { recursive: true, force: true })
        }
      }

      const remainingEntries = await readdir(workspaceDir).catch(() => [])
      if (remainingEntries.length === 0) {
        await rm(workspaceDir, { recursive: true, force: true })
      }
    }
  }

  /**
   * Reads the last-used timestamp for one runtime directory from its marker or file stats.
   * Input: runtime directory path.
   * Output: unix timestamp in milliseconds.
   */
  private async runtimeDirectoryLastUsedAt(directoryPath: string): Promise<number> {
    const markerPath = path.join(directoryPath, RUNTIME_MARKER_FILE_NAME)
    if (await pathExists(markerPath)) {
      try {
        const marker = JSON.parse(await readUtf8Text(markerPath)) as RuntimeDirectoryMarker
        const parsed = Date.parse(marker.updatedAt)
        if (Number.isFinite(parsed)) {
          return parsed
        }
      } catch {
        // Fall back to directory stats when the marker is unreadable.
      }
    }

    return (await stat(directoryPath)).mtimeMs
  }

  /**
   * Writes one runtime marker used for cleanup and debugging.
   * Input: runtime directory path and marker payload.
   * Output: marker file updated on disk.
   */
  private async touchRuntimeDirectory(directoryPath: string, marker: RuntimeDirectoryMarker): Promise<void> {
    await mkdir(directoryPath, { recursive: true })
    const markerPath = path.join(directoryPath, RUNTIME_MARKER_FILE_NAME)
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
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
   * Resolves the sandbox root for one workspace manifest hash.
   * Input: workspace id and manifest hash.
   * Output: absolute sandbox directory path.
   */
  private sandboxDirFor(workspaceId: string, manifestHash: string): string {
    return path.join(this.config.previewSandboxesDir, workspaceId, manifestHash)
  }

  /**
   * Resolves the cached preview output folder for one workspace preview cache key.
   * Input: workspace id and preview cache key.
   * Output: absolute preview output path.
   */
  private outputDirFor(workspaceId: string, cacheKey: string): string {
    return path.join(this.config.previewOutputsDir, workspaceId, cacheKey)
  }

  /**
   * Returns the user-visible pnpm install command for one workspace repo.
   * Input: source repo path.
   * Output: human-readable command string.
   */
  private async installCommandFor(repoPath: string): Promise<string> {
    return this.installCommandDisplay(await this.installArgsFor(repoPath))
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
