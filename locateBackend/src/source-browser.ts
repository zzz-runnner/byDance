import path from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'
import type { ProjectFileContent, ProjectFileNode } from './types.js'

const MAX_TEXT_FILE_BYTES = 512 * 1024
const HIDDEN_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
])
const HIDDEN_PREFIXES = ['agentHub/data/workspaces', 'locateBackend/data']
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

/**
 * Lists and reads the configured real source workspace under one guarded root.
 * Input: configured local source root path.
 * Output: recursive file listings and UTF-8 file reads for the browser code panel.
 */
export class SourceBrowser {
  constructor(private readonly rootPath: string) {}

  /**
   * Returns the display path for the configured source root.
   * Input: none.
   * Output: absolute source root path string.
   */
  getRootLabel(): string {
    return this.rootPath
  }

  /**
   * Collects the visible source file tree while hiding generated and runtime folders.
   * Input: none.
   * Output: recursive source tree for the frontend code panel.
   */
  async listFiles(): Promise<ProjectFileNode[]> {
    return collectSourceEntries(this.rootPath)
  }

  /**
   * Reads one text file from the configured source root.
   * Input: repo-relative path under the configured source root.
   * Output: UTF-8 content and editor metadata.
   */
  async readTextFile(relativePath: string): Promise<ProjectFileContent> {
    const normalizedRelativePath = normalizeRelativePath(relativePath)
    const resolvedPath = resolveWithinRoot(this.rootPath, normalizedRelativePath)
    const fileStat = await stat(resolvedPath)

    if (!fileStat.isFile()) {
      throw new Error('Source file target is not a regular file.')
    }
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(`Source file is too large to open in the browser (${fileStat.size} bytes).`)
    }

    const buffer = await readFile(resolvedPath)
    if (!isTextLikePath(normalizedRelativePath) || looksBinary(buffer)) {
      throw new Error('Source file is not a supported UTF-8 text file.')
    }

    const content = buffer.toString('utf8')
    return {
      path: normalizedRelativePath,
      name: path.basename(resolvedPath),
      content,
      language: detectFileLanguage(normalizedRelativePath),
      byteLength: buffer.byteLength,
      updatedAt: fileStat.mtime.toISOString(),
      lineCount: content ? content.split(/\r?\n/).length : 0,
    }
  }
}

/**
 * Normalizes one root-relative path to the slash format used by the frontend.
 * Input: raw relative path string.
 * Output: normalized slash-separated relative path.
 */
function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

/**
 * Resolves one requested file path and ensures it stays inside the configured source root.
 * Input: absolute root path and one relative child path.
 * Output: absolute validated filesystem path.
 */
function resolveWithinRoot(rootPath: string, relativePath: string): string {
  const resolvedPath = path.resolve(rootPath, relativePath)
  const normalizedRoot = normalizeForCompare(rootPath)
  const normalizedTarget = normalizeForCompare(resolvedPath)

  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    throw new Error('Source path escapes the configured root.')
  }

  return resolvedPath
}

/**
 * Normalizes one path for case-insensitive containment checks on Windows.
 * Input: any filesystem path.
 * Output: lowercased slash-separated absolute path.
 */
function normalizeForCompare(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase()
}

/**
 * Returns whether one visible source path should stay hidden in the browser tree.
 * Input: root-relative path and directory flag.
 * Output: true when the entry should not be shown.
 */
function shouldHideFromBrowser(relativePath: string, isDirectory: boolean): boolean {
  const normalized = normalizeRelativePath(relativePath)
  const lowercased = normalized.toLowerCase()
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1] ?? ''

  if (HIDDEN_PREFIXES.some(prefix => lowercased === prefix.toLowerCase() || lowercased.startsWith(`${prefix.toLowerCase()}/`))) {
    return true
  }
  if (segments.some(segment => HIDDEN_SEGMENTS.has(segment))) {
    return true
  }
  if (fileName === '.DS_Store' || fileName === 'Thumbs.db') {
    return true
  }
  if (/^\.agent-/i.test(fileName)) {
    return true
  }
  if (/^_.*\.(log|out|err|pid|jobid)$/i.test(fileName)) {
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
 * Infers one Monaco language id from a root-relative path.
 * Input: source-relative file path.
 * Output: Monaco-friendly language id.
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
    case '.jsx':
      return 'javascript'
    case '.json':
      return 'json'
    case '.md':
      return 'markdown'
    case '.sql':
      return 'sql'
    case '.svg':
    case '.xml':
      return 'xml'
    case '.ts':
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
 * Returns whether one path looks text-like before the file bytes are opened.
 * Input: source-relative path.
 * Output: true when the extension is likely safe for the browser editor.
 */
function isTextLikePath(relativePath: string): boolean {
  const fileName = path.posix.basename(relativePath.toLowerCase())
  const ext = path.posix.extname(relativePath.toLowerCase())
  if (fileName === '.gitignore' || fileName === '.gitattributes' || fileName === 'dockerfile') {
    return true
  }
  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    return true
  }
  if (BINARY_FILE_EXTENSIONS.has(ext)) {
    return false
  }
  return !fileName.startsWith('.')
}

/**
 * Detects whether one file buffer is likely binary data.
 * Input: file bytes.
 * Output: true when the browser editor should refuse the file.
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
 * Recursively collects one source file tree under the guarded root.
 * Input: absolute source root path and optional relative folder.
 * Output: nested source tree entries with directories first.
 */
async function collectSourceEntries(rootPath: string, relativeFolder = ''): Promise<ProjectFileNode[]> {
  const currentPath = relativeFolder ? resolveWithinRoot(rootPath, relativeFolder) : rootPath
  const entries = (await readdir(currentPath, { withFileTypes: true }))
    .filter(entry => !entry.isSymbolicLink())
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
  const nodes: ProjectFileNode[] = []

  for (const entry of entries) {
    const relativePath = relativeFolder
      ? path.posix.join(normalizeRelativePath(relativeFolder), entry.name)
      : entry.name
    if (shouldHideFromBrowser(relativePath, entry.isDirectory())) {
      continue
    }

    if (entry.isDirectory()) {
      nodes.push({
        path: relativePath,
        name: entry.name,
        kind: 'directory',
        isText: false,
        children: await collectSourceEntries(rootPath, relativePath),
      })
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const filePath = resolveWithinRoot(rootPath, relativePath)
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
