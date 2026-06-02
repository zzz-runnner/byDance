import { access, readdir } from 'node:fs/promises'
import path from 'node:path'

const APP_ROOT_IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
])

const APP_ROOT_ENTRY_CANDIDATES = [
  'src/main.tsx',
  'src/main.jsx',
  'src/main.ts',
  'src/main.js',
  'src/app.tsx',
  'src/app.jsx',
  'src/app.ts',
  'src/app.js',
  'src/App.vue',
  'src/App.svelte',
]

const APP_ROOT_CONFIG_CANDIDATES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'angular.json',
]

/**
 * Describes one detected frontend app root inside a workspace repo.
 * Input: none.
 * Output: absolute path plus repo-relative location metadata.
 */
export interface WorkspaceAppRootResolution {
  appRootPath: string
  appRelativePath: string
  appDisplayPath: string
}

/**
 * Checks whether one absolute path exists on disk.
 * Input: absolute path.
 * Output: true when the path is accessible.
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
 * Returns whether one repo-relative directory should be skipped during app-root scanning.
 * Input: repo-relative directory path.
 * Output: true when the directory is never a user-facing app root candidate.
 */
function shouldSkipAppRootDirectory(relativePath: string): boolean {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .some(segment => APP_ROOT_IGNORED_SEGMENTS.has(segment.toLowerCase()))
}

/**
 * Prefixes one repo-relative file path with the detected app-root folder when needed.
 * Input: app-root relative folder and local file path.
 * Output: repo-relative path visible to the frontend.
 */
export function prefixWorkspaceRelativePath(
  appRelativePath: string,
  relativePath: string | undefined,
): string | undefined {
  if (!relativePath) {
    return undefined
  }

  const normalizedPath = relativePath.replace(/\\/g, '/')
  if (!appRelativePath) {
    return normalizedPath
  }

  return path.posix.join(appRelativePath.replace(/\\/g, '/'), normalizedPath)
}

/**
 * Builds one deterministic score for a frontend app-root candidate.
 * Input: workspace repo root and candidate repo-relative folder.
 * Output: higher scores mean the directory is more likely to be the primary frontend app.
 */
async function scoreAppRootCandidate(workspaceRootPath: string, relativeFolder: string): Promise<number> {
  const candidateRoot = relativeFolder ? path.join(workspaceRootPath, relativeFolder) : workspaceRootPath
  let score = 0

  if (await pathExists(path.join(candidateRoot, 'package.json'))) {
    score += 100
  }

  for (const configName of APP_ROOT_CONFIG_CANDIDATES) {
    if (await pathExists(path.join(candidateRoot, configName))) {
      score += 60
      break
    }
  }

  for (const entryPath of APP_ROOT_ENTRY_CANDIDATES) {
    if (await pathExists(path.join(candidateRoot, entryPath))) {
      score += 40
      break
    }
  }

  if (
    await pathExists(path.join(candidateRoot, 'index.html'))
    || await pathExists(path.join(candidateRoot, 'index.htm'))
  ) {
    score += 30
  }

  if (await pathExists(path.join(candidateRoot, 'public'))) {
    score += 10
  }

  if (!relativeFolder) {
    score += 1
  }

  return score
}

/**
 * Collects repo-relative directories that are allowed to compete as app-root candidates.
 * Input: workspace repo root, current relative folder, and remaining scan depth.
 * Output: repo-relative directory paths including the root directory.
 */
async function collectAppRootCandidates(
  workspaceRootPath: string,
  relativeFolder = '',
  depth = 0,
  maxDepth = 2,
): Promise<string[]> {
  const currentPath = relativeFolder ? path.join(workspaceRootPath, relativeFolder) : workspaceRootPath
  const candidates = [relativeFolder]

  if (depth >= maxDepth) {
    return candidates
  }

  const entries = (await readdir(currentPath, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const nextRelativePath = relativeFolder
      ? path.posix.join(relativeFolder.replace(/\\/g, '/'), entry.name)
      : entry.name
    if (shouldSkipAppRootDirectory(nextRelativePath)) {
      continue
    }

    candidates.push(...await collectAppRootCandidates(workspaceRootPath, nextRelativePath, depth + 1, maxDepth))
  }

  return candidates
}

/**
 * Detects the most likely frontend app root inside one workspace repository.
 * Input: workspace repo root and optional maximum nested scan depth.
 * Output: the best candidate or undefined when no frontend-like folder exists.
 */
export async function resolveWorkspaceAppRoot(
  workspaceRootPath: string,
  options?: { maxDepth?: number },
): Promise<WorkspaceAppRootResolution | undefined> {
  const candidateFolders = await collectAppRootCandidates(
    workspaceRootPath,
    '',
    0,
    options?.maxDepth ?? 2,
  )

  let bestCandidate: { relativePath: string; score: number } | undefined
  for (const relativePath of candidateFolders) {
    const score = await scoreAppRootCandidate(workspaceRootPath, relativePath)
    if (score <= 0) {
      continue
    }

    if (!bestCandidate) {
      bestCandidate = { relativePath, score }
      continue
    }

    const bestDepth = bestCandidate.relativePath ? bestCandidate.relativePath.split('/').length : 0
    const currentDepth = relativePath ? relativePath.split('/').length : 0

    if (
      score > bestCandidate.score
      || (score === bestCandidate.score && currentDepth < bestDepth)
      || (score === bestCandidate.score && currentDepth === bestDepth && relativePath.localeCompare(bestCandidate.relativePath) < 0)
    ) {
      bestCandidate = { relativePath, score }
    }
  }

  if (!bestCandidate) {
    return undefined
  }

  return {
    appRootPath: bestCandidate.relativePath
      ? path.join(workspaceRootPath, bestCandidate.relativePath)
      : workspaceRootPath,
    appRelativePath: bestCandidate.relativePath,
    appDisplayPath: bestCandidate.relativePath || 'repo',
  }
}
