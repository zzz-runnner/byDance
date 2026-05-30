import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import fs from 'fs-extra'
import { Pool } from 'pg'
import { LocalStorageService } from '../storage/local-storage.service'
import { ProjectMetadata } from './project.types'

type MetadataStoreMode = 'local' | 'postgres'

type ProjectRow = {
  metadata: ProjectMetadata
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
      return
    }

    const databaseUrl = this.config.get<string>('DATABASE_URL')
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required when APP_METADATA_STORE=postgres')
    }

    this.pool = new Pool({ connectionString: databaseUrl })
    await this.ensureSchema()
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

    await fs.ensureDir(this.storage.projectsRoot)
    const entries = await fs.readdir(this.storage.projectsRoot)
    const projects = await Promise.all(entries.map(async entry => {
      try {
        return await this.getProject(entry)
      } catch {
        return undefined
      }
    }))

    return projects
      .filter((project): project is ProjectMetadata => Boolean(project))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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
    if (!(await fs.pathExists(metadataPath))) {
      return undefined
    }
    return fs.readJson(metadataPath) as Promise<ProjectMetadata>
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

  private getPool(): Pool {
    if (!this.pool) {
      throw new Error('PostgreSQL pool has not been initialized')
    }
    return this.pool
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
}
