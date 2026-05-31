import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { StoredProjectRecord } from './types.js'

type ProjectCursor = {
  updatedAt: string
  projectId: string
}

export type ProjectPageResult = {
  items: StoredProjectRecord[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

/**
 * Sorts projects by descending update time and uses project id as a stable tie-breaker.
 * Input: two project records. Output: standard array sort number.
 */
function compareProjects(left: StoredProjectRecord, right: StoredProjectRecord): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt)
  }
  return right.projectId.localeCompare(left.projectId)
}

/**
 * Encodes one pagination cursor from a project record.
 * Input: project record.
 * Output: opaque cursor string.
 */
function encodeCursor(project: StoredProjectRecord): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: project.updatedAt,
      projectId: project.projectId,
    } satisfies ProjectCursor),
    'utf8',
  ).toString('base64url')
}

/**
 * Decodes one stored pagination cursor into its comparison fields.
 * Input: opaque cursor string.
 * Output: decoded cursor or undefined when invalid.
 */
function decodeCursor(cursor: string | undefined): ProjectCursor | undefined {
  if (!cursor) {
    return undefined
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<ProjectCursor>
    if (typeof parsed.updatedAt === 'string' && typeof parsed.projectId === 'string') {
      return {
        updatedAt: parsed.updatedAt,
        projectId: parsed.projectId,
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

export class ProjectStore {
  constructor(private readonly filePath: string) {}

  /**
   * Loads all stored projects sorted by recent update time.
   * Input: none.
   * Output: project record array.
   */
  async listProjects(): Promise<StoredProjectRecord[]> {
    const projects = await this.readProjects()
    return projects.sort(compareProjects)
  }

  /**
   * Loads one cursor-paged project slice after applying a lightweight search query.
   * Input: requested limit, optional cursor, and optional search query.
   * Output: paged project records plus pagination metadata.
   */
  async listProjectsPage(input: {
    limit: number
    cursor?: string
    query?: string
  }): Promise<ProjectPageResult> {
    const projects = await this.listProjects()
    const normalizedQuery = input.query?.trim().toLowerCase() ?? ''
    const filtered = !normalizedQuery
      ? projects
      : projects.filter(project =>
          [
            project.name,
            project.goal,
            project.workspaceId,
            project.projectId,
            project.conversationType ?? '',
            project.targetAgentId ?? '',
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery),
        )
    const decodedCursor = decodeCursor(input.cursor)
    const pageStartIndex = decodedCursor
      ? filtered.findIndex(project =>
          compareProjects(project, {
            ...project,
            updatedAt: decodedCursor.updatedAt,
            projectId: decodedCursor.projectId,
          }) > 0,
        )
      : -1
    const sliceStart = pageStartIndex >= 0 ? pageStartIndex : decodedCursor ? filtered.length : 0
    const items = filtered.slice(sliceStart, sliceStart + input.limit)
    const hasMore = sliceStart + items.length < filtered.length

    return {
      items,
      total: filtered.length,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : undefined,
    }
  }

  /**
   * Finds one stored project by project id or workspace id.
   * Input: project-like identifier.
   * Output: matching project record or undefined.
   */
  async getProject(id: string): Promise<StoredProjectRecord | undefined> {
    const projects = await this.readProjects()
    return projects.find(project => project.projectId === id || project.workspaceId === id)
  }

  /**
   * Inserts or replaces one stored project record.
   * Input: project record to persist.
   * Output: saved project record.
   */
  async upsertProject(project: StoredProjectRecord): Promise<StoredProjectRecord> {
    const projects = await this.readProjects()
    const index = projects.findIndex(
      entry => entry.projectId === project.projectId || entry.workspaceId === project.workspaceId,
    )

    if (index >= 0) {
      projects[index] = project
    } else {
      projects.push(project)
    }

    await this.writeProjects(projects)
    return project
  }

  /**
   * Reads the JSON project file from disk.
   * Input: none.
   * Output: stored project record array.
   */
  private async readProjects(): Promise<StoredProjectRecord[]> {
    await this.ensureStorage()

    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown
      return Array.isArray(parsed) ? (parsed as StoredProjectRecord[]) : []
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ENOENT')) {
        return []
      }
      throw error
    }
  }

  /**
   * Writes the complete project array back to disk.
   * Input: project record array.
   * Output: file contents updated on disk.
   */
  private async writeProjects(projects: StoredProjectRecord[]): Promise<void> {
    await this.ensureStorage()
    await writeFile(this.filePath, `${JSON.stringify(projects, null, 2)}\n`, 'utf8')
  }

  /**
   * Ensures the storage directory and JSON file exist before reads or writes.
   * Input: none.
   * Output: storage path initialized on disk when missing.
   */
  private async ensureStorage(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })

    try {
      await readFile(this.filePath, 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ENOENT')) {
        await writeFile(this.filePath, '[]\n', 'utf8')
        return
      }
      throw error
    }
  }
}
