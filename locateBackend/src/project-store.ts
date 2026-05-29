import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { StoredProjectRecord } from './types.js'

export class ProjectStore {
  constructor(private readonly filePath: string) {}

  /**
   * Loads all stored projects sorted by recent update time.
   * Input: none.
   * Output: project record array.
   */
  async listProjects(): Promise<StoredProjectRecord[]> {
    const projects = await this.readProjects()
    return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
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
      const parsed = JSON.parse(raw) as unknown
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
