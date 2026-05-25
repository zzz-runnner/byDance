import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ChangedFile } from '@shared/contracts'
import type { DeliveryIssue, DeliveryValidationResult } from './types'

type DeliveryValidatorInput = {
  repoPath: string
  task: string
  expectedOutput: string
  changedFiles: ChangedFile[]
  previewReady?: boolean
}

const TEXT_FILE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.wxml', '.vue'])
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.vite'])
const FILE_REFERENCE_PATTERN = /(?:^|[\s"'`(：:，,。])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:html|css|js|ts|jsx|tsx|json|md|wxml|wxss|vue|py|java|go|rs|txt))/g
const KEY_TEXT_PATTERN = /(?:exact text|contains?|include(?:s)?|包含|文字|标题)\s*[:：]?\s*["'`“”]?([^"'`“”。，.]+)["'`“”]?/gi

/**
 * Returns a repo-relative path normalized for matching and metadata.
 * Input: raw relative path. Output: normalized posix-style path.
 */
function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

/**
 * Resolves a repo-relative path and rejects escapes outside the repo.
 * Input: repository path and relative path. Output: resolved absolute path.
 */
function resolveRepoPath(repoPath: string, relativePath: string): string {
  const root = path.resolve(repoPath)
  const resolved = path.resolve(root, relativePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Delivery validator rejected path outside workspace: ${relativePath}`)
  }
  return resolved
}

/**
 * Returns whether a file or directory exists.
 * Input: absolute path. Output: true when the path is accessible.
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Extracts explicit file names mentioned in the task text.
 * Input: user task and expected output text. Output: unique normalized relative file paths.
 */
function extractRequiredFiles(input: DeliveryValidatorInput): string[] {
  const text = `${input.task}\n${input.expectedOutput}`
  const files = new Set<string>()
  let match = FILE_REFERENCE_PATTERN.exec(text)
  while (match) {
    files.add(normalizeRelativePath(match[1]))
    match = FILE_REFERENCE_PATTERN.exec(text)
  }
  return [...files]
}

/**
 * Extracts simple required text markers from explicit task wording.
 * Input: user task text. Output: short text markers that should appear in changed files.
 */
function extractRequiredTextMarkers(task: string): string[] {
  const markers = new Set<string>()
  let match = KEY_TEXT_PATTERN.exec(task)
  while (match) {
    const marker = match[1].trim()
    if (marker.length >= 4 && marker.length <= 120) {
      markers.add(marker)
    }
    match = KEY_TEXT_PATTERN.exec(task)
  }
  return [...markers]
}

/**
 * Validates that explicitly requested files were produced.
 * Input: repository path and required files. Output: delivery issues for missing files.
 */
async function validateRequiredFiles(repoPath: string, requiredFiles: string[]): Promise<DeliveryIssue[]> {
  const issues: DeliveryIssue[] = []
  for (const requiredFile of requiredFiles) {
    if (!(await exists(resolveRepoPath(repoPath, requiredFile)))) {
      issues.push({ severity: 'blocking', message: `Required file was not delivered: ${requiredFile}`, path: requiredFile })
    }
  }
  return issues
}

/**
 * Validates required marker text against changed text files.
 * Input: repository path, changed files, and marker list. Output: delivery issues for missing marker text.
 */
async function validateRequiredTextMarkers(
  repoPath: string,
  changedFiles: ChangedFile[],
  markers: string[],
): Promise<DeliveryIssue[]> {
  if (!markers.length) {
    return []
  }
  const readableFiles = changedFiles
    .filter(file => file.status !== 'deleted')
    .map(file => normalizeRelativePath(file.path))
    .filter(file => ['.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.md', '.txt'].includes(path.extname(file).toLowerCase()))
  const contents: string[] = []
  for (const file of readableFiles.slice(0, 12)) {
    try {
      contents.push(await readFile(resolveRepoPath(repoPath, file), 'utf8'))
    } catch {
      // Missing changed files are reported by required-file validation when explicit.
    }
  }
  const combined = contents.join('\n')
  return markers
    .filter(marker => !combined.includes(marker))
    .map(marker => ({ severity: 'warning' as const, message: `Required text marker was not found in changed files: ${marker}` }))
}

/**
 * Reads and parses a JSON file when present.
 * Input: repository path and relative path. Output: parsed object or undefined.
 */
async function readJsonFile(repoPath: string, relativePath: string): Promise<Record<string, unknown> | undefined> {
  const filePath = resolveRepoPath(repoPath, relativePath)
  if (!(await exists(filePath))) {
    return undefined
  }
  const content = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(content) as unknown
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
}

/**
 * Recursively collects small source files for lightweight call-reference checks.
 * Input: repository path and optional folder. Output: relative file paths.
 */
async function collectTextFiles(repoPath: string, relativeFolder = '', limit = 200): Promise<string[]> {
  const folderPath = resolveRepoPath(repoPath, relativeFolder)
  if (!(await exists(folderPath))) {
    return []
  }
  const entries = await readdir(folderPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (files.length >= limit || entry.isSymbolicLink()) {
      continue
    }
    const relativePath = normalizeRelativePath(path.join(relativeFolder, entry.name))
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        files.push(...await collectTextFiles(repoPath, relativePath, limit - files.length))
      }
      continue
    }
    if (entry.isFile() && TEXT_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(relativePath)
    }
  }

  return files.slice(0, limit)
}

/**
 * Extracts wx.cloud.callFunction names from source content.
 * Input: source file text. Output: referenced cloud function names.
 */
function extractCloudFunctionNames(content: string): string[] {
  const names = new Set<string>()
  const pattern = /wx\.cloud\.callFunction\s*\(\s*\{[\s\S]*?name\s*:\s*['"`]([^'"`]+)['"`]/g
  let match = pattern.exec(content)
  while (match) {
    names.add(match[1])
    match = pattern.exec(content)
  }
  return [...names]
}

/**
 * Validates a basic static site entry point and local asset references.
 * Input: repository path. Output: delivery issues.
 */
async function validateStaticSite(repoPath: string): Promise<DeliveryIssue[]> {
  const issues: DeliveryIssue[] = []
  const indexPath = resolveRepoPath(repoPath, 'index.html')
  if (!(await exists(indexPath))) {
    issues.push({ severity: 'blocking', message: 'Static preview is missing index.html.', path: 'index.html' })
    return issues
  }

  const content = await readFile(indexPath, 'utf8')
  const assetPattern = /(?:src|href)=["']([^"'#]+)["']/g
  let match = assetPattern.exec(content)
  while (match) {
    const asset = match[1]
    if (/^(https?:)?\/\//.test(asset) || asset.startsWith('data:') || asset.startsWith('/')) {
      match = assetPattern.exec(content)
      continue
    }
    const assetPath = resolveRepoPath(repoPath, asset)
    if (!(await exists(assetPath))) {
      issues.push({ severity: 'blocking', message: `Static asset is referenced but missing: ${asset}`, path: asset })
    }
    match = assetPattern.exec(content)
  }
  return issues
}

/**
 * Validates a WeChat miniprogram cloud-function file skeleton.
 * Input: repository path. Output: delivery issues.
 */
async function validateWechatMiniprogram(repoPath: string): Promise<DeliveryIssue[]> {
  const issues: DeliveryIssue[] = []
  const projectConfig = await readJsonFile(repoPath, 'project.config.json')
  if (!projectConfig) {
    issues.push({ severity: 'blocking', message: 'WeChat miniprogram is missing project.config.json.', path: 'project.config.json' })
    return issues
  }

  const root = typeof projectConfig.cloudfunctionRoot === 'string'
    ? normalizeRelativePath(projectConfig.cloudfunctionRoot)
    : 'cloudfunctions'
  const rootPath = resolveRepoPath(repoPath, root)
  if (!(await exists(rootPath))) {
    issues.push({ severity: 'blocking', message: `cloudfunctionRoot does not exist: ${root}`, path: root })
  }

  const sourceFiles = await collectTextFiles(repoPath)
  const calledNames = new Set<string>()
  for (const relativePath of sourceFiles) {
    const content = await readFile(resolveRepoPath(repoPath, relativePath), 'utf8')
    extractCloudFunctionNames(content).forEach(name => calledNames.add(name))
  }

  for (const name of calledNames) {
    const functionDir = resolveRepoPath(repoPath, path.posix.join(root, name))
    const indexFile = resolveRepoPath(repoPath, path.posix.join(root, name, 'index.js'))
    if (!(await exists(functionDir))) {
      issues.push({ severity: 'blocking', message: `Called cloud function is missing: ${name}`, path: path.posix.join(root, name) })
      continue
    }
    const functionStat = await stat(functionDir)
    if (!functionStat.isDirectory() || !(await exists(indexFile))) {
      issues.push({ severity: 'blocking', message: `Cloud function is missing index.js: ${name}`, path: path.posix.join(root, name, 'index.js') })
    }
  }

  return issues
}

/**
 * Returns whether the task or changed files look like a WeChat miniprogram.
 * Input: validation input. Output: true when miniprogram rules apply.
 */
function shouldValidateWechat(input: DeliveryValidatorInput): boolean {
  const text = `${input.task}\n${input.expectedOutput}`.toLowerCase()
  return /wechat|miniprogram|cloudfunction|wx\.cloud|project\.config\.json/.test(text) ||
    input.changedFiles.some(file => /(^|\/)(project\.config\.json|cloudfunctions|app\.json|miniprogram)/.test(normalizeRelativePath(file.path)))
}

/**
 * Returns whether the task or changed files look like a static web delivery.
 * Input: validation input. Output: true when static-site rules apply.
 */
function shouldValidateStaticSite(input: DeliveryValidatorInput): boolean {
  const text = `${input.task}\n${input.expectedOutput}`.toLowerCase()
  return /html|static|web|page|preview|react|vite/.test(text) ||
    input.changedFiles.some(file => /\.(html|css|js|jsx|tsx)$/.test(file.path))
}

/**
 * Runs lightweight delivery validation without build or dependency installation.
 * Input: repository path, task details, and changed files. Output: validation result.
 */
export async function validateDelivery(input: DeliveryValidatorInput): Promise<DeliveryValidationResult> {
  const requiredFiles = extractRequiredFiles(input)
  const changedFilePaths = input.changedFiles.map(file => normalizeRelativePath(file.path))
  if (!input.changedFiles.length) {
    return {
      status: 'skipped',
      summary: 'No changed files to validate.',
      issues: [],
      requiredFiles,
      changedFiles: changedFilePaths,
      previewReady: input.previewReady ?? false,
      changeSetReady: false,
    }
  }

  const issues: DeliveryIssue[] = []
  issues.push(...await validateRequiredFiles(input.repoPath, requiredFiles))
  issues.push(...await validateRequiredTextMarkers(input.repoPath, input.changedFiles, extractRequiredTextMarkers(input.task)))
  if (shouldValidateStaticSite(input)) {
    issues.push(...await validateStaticSite(input.repoPath))
  }
  if (shouldValidateWechat(input)) {
    issues.push(...await validateWechatMiniprogram(input.repoPath))
  }
  if (shouldValidateStaticSite(input) && input.previewReady === false) {
    issues.push({ severity: 'warning', message: 'Static delivery did not produce a preview artifact.' })
  }

  const blockingCount = issues.filter(issue => issue.severity === 'blocking').length
  return {
    status: blockingCount > 0 ? 'partial' : 'pass',
    summary: blockingCount > 0
      ? `Delivery validation found ${blockingCount} blocking issue(s).`
      : 'Delivery validation passed.',
    issues,
    requiredFiles,
    changedFiles: changedFilePaths,
    previewReady: input.previewReady ?? false,
    changeSetReady: input.changedFiles.length > 0,
  }
}
