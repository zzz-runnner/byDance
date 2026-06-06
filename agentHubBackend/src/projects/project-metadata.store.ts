import path from 'node:path'
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import fs from 'fs-extra'
import { Pool } from 'pg'
import { LocalStorageService } from '../storage/local-storage.service'
import type { SortDirection, WorkspaceListStatus, WorkspaceSortField } from '../types'
import { ProjectMetadata } from './project.types'

type MetadataStoreMode = 'local' | 'postgres'

type ProjectRow = {
  metadata: ProjectMetadata
}

type ProjectCursor = {
  offset: number
}

const DEFAULT_DIRECT_CHAT_AGENT_ID = 'codex-direct'
const DIRECT_CHAT_AGENT_IDS = new Set(['claude-code-direct', 'codex-direct'])

type LegacyProjectRecord = {
  projectId: string
  workspaceId: string
  name: string
  goal: string
  conversationId?: string
  conversationType?: 'group' | 'direct'
  targetAgentId?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectPageResult {
  items: ProjectMetadata[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

@Injectable()
export class ProjectMetadataStore implements OnModuleInit, OnModuleDestroy {
  private readonly mode: MetadataStoreMode
  private pool?: Pool

  constructor(
    private readonly config: ConfigService,
    private readonly storage: LocalStorageService,
  ) {
    this.mode = this.config.get<MetadataStoreMode>('APP_METADATA_STORE', 'local')
  }

  async onModuleInit(): Promise<void> {
    if (this.mode === 'local') {
      await fs.ensureDir(this.storage.projectsRoot)
      await this.applyLegacyDirectProjectTargets()
      return
    }

    const databaseUrl = this.config.get<string>('DATABASE_URL')
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required when APP_METADATA_STORE=postgres')
    }

    this.pool = new Pool({ connectionString: databaseUrl })
    await this.ensureSchema()
    await this.applyLegacyDirectProjectTargets()
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end()
  }

  get storeMode(): MetadataStoreMode {
    return this.mode
  }

  async listProjects(): Promise<ProjectMetadata[]> {
    if (this.mode === 'postgres') {
      const result = await this.getPool().query<ProjectRow>(
        'select metadata from business_projects order by updated_at desc',
      )
      return result.rows.map(row => row.metadata)
    }

    const [localProjects, legacyProjects] = await Promise.all([
      this.listLocalProjects(),
      this.listLegacyProjects(),
    ])

    return mergeProjects(localProjects, legacyProjects)
      .sort((a: ProjectMetadata, b: ProjectMetadata) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * Loads one cursor-paged project slice with an optional text search.
   * Input: page size, optional cursor, and optional search query.
   * Output: one page of stored projects plus pagination metadata.
   */
  async listProjectsPage(input: {
    limit: number
    cursor?: string
    query?: string
    status?: WorkspaceListStatus
    pinned?: boolean
    sortBy?: WorkspaceSortField
    sortDirection?: SortDirection
  }): Promise<ProjectPageResult> {
    const projects = await this.listProjects()
    const normalizedQuery = input.query?.trim().toLowerCase() ?? ''
    const status = input.status ?? 'active'
    const sortBy = input.sortBy ?? 'updatedAt'
    const sortDirection = input.sortDirection ?? 'desc'
    const filtered = projects.filter(project =>
      matchesProjectStatus(project, status) &&
      (input.pinned === undefined || Boolean(project.pinnedAt) === input.pinned) &&
      (!normalizedQuery || matchesProjectQuery(project, normalizedQuery)),
    )
    const sorted = filtered
      .slice()
      .sort((left, right) => compareProjectsBySort(left, right, sortBy, sortDirection))
    const decodedCursor = decodeCursor(input.cursor)
    const sliceStart = Math.max(0, Math.min(decodedCursor?.offset ?? 0, sorted.length))
    const items = sorted.slice(sliceStart, sliceStart + input.limit)
    const hasMore = sliceStart + items.length < sorted.length

    return {
      items,
      total: sorted.length,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? encodeCursor(sliceStart + items.length) : undefined,
    }
  }

  async getProject(projectId: string): Promise<ProjectMetadata | undefined> {
    if (this.mode === 'postgres') {
      const result = await this.getPool().query<ProjectRow>(
        'select metadata from business_projects where project_id = $1',
        [projectId],
      )
      return result.rows[0]?.metadata
    }

    const metadataPath = this.storage.projectMetadataPath(projectId)
    if (await fs.pathExists(metadataPath)) {
      return fs.readJson(metadataPath) as Promise<ProjectMetadata>
    }

    const legacyProjects = await this.listLegacyProjects()
    return legacyProjects.find(project => project.projectId === projectId)
  }

  async saveProject(project: ProjectMetadata): Promise<void> {
    if (this.mode === 'postgres') {
      await this.getPool().query(
        `
          insert into business_projects (
            project_id,
            name,
            goal,
            workspace_id,
            conversation_id,
            agent_hub_preview_url,
            agent_hub_zip_url,
            current_version_id,
            latest_workflow,
            versions,
            deployments,
            created_at,
            updated_at,
            metadata
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9::jsonb, $10::jsonb, $11::jsonb,
            $12::timestamptz, $13::timestamptz, $14::jsonb
          )
          on conflict (project_id) do update set
            name = excluded.name,
            goal = excluded.goal,
            workspace_id = excluded.workspace_id,
            conversation_id = excluded.conversation_id,
            agent_hub_preview_url = excluded.agent_hub_preview_url,
            agent_hub_zip_url = excluded.agent_hub_zip_url,
            current_version_id = excluded.current_version_id,
            latest_workflow = excluded.latest_workflow,
            versions = excluded.versions,
            deployments = excluded.deployments,
            updated_at = excluded.updated_at,
            metadata = excluded.metadata
        `,
        [
          project.projectId,
          project.name,
          project.goal,
          project.workspaceId,
          project.conversationId ?? null,
          project.agentHubPreviewUrl,
          project.agentHubZipUrl,
          project.currentVersionId ?? null,
          JSON.stringify(project.latestWorkflow ?? null),
          JSON.stringify(project.versions),
          JSON.stringify(project.deployments),
          project.createdAt,
          project.updatedAt,
          JSON.stringify(project),
        ],
      )
      return
    }

    await fs.ensureDir(this.storage.projectDir(project.projectId))
    await fs.writeJson(this.storage.projectMetadataPath(project.projectId), project, { spaces: 2 })
  }

  async deleteProject(projectId: string): Promise<void> {
    if (this.mode === 'postgres') {
      await this.getPool().query('delete from business_projects where project_id = $1', [projectId])
      return
    }

    await fs.remove(this.storage.projectDir(projectId))
  }

  private getPool(): Pool {
    if (!this.pool) {
      throw new Error('PostgreSQL pool has not been initialized')
    }
    return this.pool
  }

  /**
   * Loads all current local metadata files from the per-project directory structure.
   * Input: none.
   * Output: valid project metadata array.
   */
  private async listLocalProjects(): Promise<ProjectMetadata[]> {
    await fs.ensureDir(this.storage.projectsRoot)
    const entries = await fs.readdir(this.storage.projectsRoot)
    const projects = await Promise.all(entries.map(async (entry: string) => {
      try {
        const metadataPath = this.storage.projectMetadataPath(entry)
        if (!(await fs.pathExists(metadataPath))) {
          return undefined
        }
        return fs.readJson(metadataPath) as Promise<ProjectMetadata>
      } catch {
        return undefined
      }
    }))

    return projects.filter((project): project is ProjectMetadata => Boolean(project))
  }

  /**
   * Loads legacy flat-file project metadata for backward-compatible local reads.
   * Input: none.
   * Output: normalized project metadata array.
   */
  private async listLegacyProjects(): Promise<ProjectMetadata[]> {
    const legacyPath = path.join(this.storage.root, 'projects.json')
    if (!(await fs.pathExists(legacyPath))) {
      return []
    }

    try {
      const records = await fs.readJson(legacyPath) as LegacyProjectRecord[]
      if (!Array.isArray(records)) {
        return []
      }
      return records
        .map(record => normalizeLegacyProject(record))
        .filter((project): project is ProjectMetadata => Boolean(project))
    } catch {
      return []
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.getPool().query(`
      create table if not exists business_projects (
        project_id text primary key,
        name text not null,
        goal text not null,
        workspace_id text not null,
        conversation_id text,
        agent_hub_preview_url text not null,
        agent_hub_zip_url text not null,
        current_version_id text,
        latest_workflow jsonb,
        versions jsonb not null default '[]'::jsonb,
        deployments jsonb not null default '[]'::jsonb,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        metadata jsonb not null
      )
    `)
    await this.getPool().query(`
      create index if not exists business_projects_updated_at_idx
        on business_projects (updated_at desc)
    `)
    await this.getPool().query(`
      create index if not exists business_projects_workspace_id_idx
        on business_projects (workspace_id)
    `)
  }

  /**
   * Moves legacy direct-project metadata to the dedicated Codex direct agent.
   * Input: current metadata store. Output: persisted records updated when needed.
   */
  private async applyLegacyDirectProjectTargets(): Promise<void> {
    const projects = await this.listProjects()
    const legacyDirectProjects = projects.filter(project =>
      project.conversationType === 'direct' &&
      !DIRECT_CHAT_AGENT_IDS.has(project.targetAgentId ?? ''),
    )
    if (legacyDirectProjects.length === 0) {
      return
    }

    for (const project of legacyDirectProjects) {
      await this.saveProject({
        ...project,
        targetAgentId: DEFAULT_DIRECT_CHAT_AGENT_ID,
      })
    }
  }
}

/**
 * Sorts projects by descending update time with project id as a tie-breaker.
 * Input: two project-like records.
 * Output: standard array sort number.
 */
function compareProjects(
  left: Pick<ProjectMetadata, 'updatedAt' | 'projectId'>,
  right: Pick<ProjectMetadata, 'updatedAt' | 'projectId'>,
): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt)
  }
  return right.projectId.localeCompare(left.projectId)
}

/**
 * Encodes one opaque cursor from a project record.
 * Input: project id and updated time.
 * Output: base64url cursor string.
 */
function encodeCursor(offset: number): string {
  return Buffer.from(
    JSON.stringify({
      offset,
    } satisfies ProjectCursor),
    'utf8',
  ).toString('base64url')
}

/**
 * Decodes one stored cursor into its comparison fields.
 * Input: opaque cursor string.
 * Output: decoded cursor or undefined when invalid.
 */
function decodeCursor(cursor: string | undefined): ProjectCursor | undefined {
  if (!cursor) {
    return undefined
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<ProjectCursor>
    if (typeof parsed.offset === 'number' && Number.isInteger(parsed.offset) && parsed.offset >= 0) {
      return {
        offset: parsed.offset,
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

/**
 * Checks whether one project belongs to the requested metadata status bucket.
 * Input: project metadata and status filter.
 * Output: true when the project should be visible in that list.
 */
function matchesProjectStatus(project: ProjectMetadata, status: WorkspaceListStatus): boolean {
  if (status === 'all') {
    return true
  }
  return status === 'archived' ? Boolean(project.archivedAt) : !project.archivedAt
}

/**
 * Sorts projects by the normalized metadata sort fields, keeping pinned projects first.
 * Input: two project records plus sort settings.
 * Output: standard array sort number.
 */
function compareProjectsBySort(
  left: ProjectMetadata,
  right: ProjectMetadata,
  sortBy: WorkspaceSortField,
  sortDirection: SortDirection,
): number {
  if (left.pinnedAt || right.pinnedAt) {
    if (!left.pinnedAt) {
      return 1
    }
    if (!right.pinnedAt) {
      return -1
    }
    const pinnedComparison = right.pinnedAt.localeCompare(left.pinnedAt)
    if (pinnedComparison !== 0) {
      return pinnedComparison
    }
  }

  const direction = sortDirection === 'asc' ? 1 : -1
  const valueComparison = compareStrings(projectSortValue(left, sortBy), projectSortValue(right, sortBy))
  if (valueComparison !== 0) {
    return valueComparison * direction
  }
  return left.projectId.localeCompare(right.projectId)
}

function projectSortValue(project: ProjectMetadata, sortBy: WorkspaceSortField): string {
  if (sortBy === 'name') {
    return project.name.toLowerCase()
  }
  if (sortBy === 'createdAt') {
    return project.createdAt
  }
  return project.updatedAt
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right)
}


/**
 * Checks whether one project matches the current workspace search query.
 * Input: project metadata and normalized lowercase query text.
 * Output: true when the project should stay in the filtered page.
 */
function matchesProjectQuery(project: ProjectMetadata, query: string): boolean {
  return [
    project.name,
    project.goal,
    project.workspaceId,
    project.projectId,
    project.conversationType ?? '',
    project.targetAgentId ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(query)
}

/**
 * Merges new-style and legacy project metadata, preferring new-style records on collisions.
 * Input: current local metadata and fallback legacy metadata.
 * Output: deduplicated project list.
 */
function mergeProjects(
  localProjects: ProjectMetadata[],
  legacyProjects: ProjectMetadata[],
): ProjectMetadata[] {
  const merged = new Map<string, ProjectMetadata>()

  for (const project of legacyProjects) {
    merged.set(project.projectId, project)
  }

  for (const project of localProjects) {
    merged.set(project.projectId, project)
  }

  return [...merged.values()]
}

/**
 * Converts one legacy flat project record into the current metadata shape.
 * Input: pre-migration project JSON record.
 * Output: normalized project metadata or undefined when invalid.
 */
function normalizeLegacyProject(record: LegacyProjectRecord): ProjectMetadata | undefined {
  if (
    !record
    || typeof record.projectId !== 'string'
    || typeof record.workspaceId !== 'string'
    || typeof record.name !== 'string'
    || typeof record.goal !== 'string'
    || typeof record.createdAt !== 'string'
    || typeof record.updatedAt !== 'string'
  ) {
    return undefined
  }

  return {
    projectId: record.projectId,
    workspaceId: record.workspaceId,
    name: record.name,
    goal: record.goal,
    conversationId: record.conversationId,
    conversationType: record.conversationType,
    targetAgentId: record.targetAgentId,
    agentHubPreviewUrl: `/preview/${encodeURIComponent(record.workspaceId)}`,
    agentHubZipUrl: `/api/workspaces/${encodeURIComponent(record.workspaceId)}/zip`,
    versions: [],
    deployments: [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
