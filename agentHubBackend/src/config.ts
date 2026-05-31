import path from 'node:path'

export interface AppConfig {
  host: string
  port: number
  agentHubBaseUrl: string
  dataDir: string
  projectsFilePath: string
  agentHubWorkspaceRootPath: string
  previewBuildsDir: string
  previewInstallsDir: string
}

/**
 * Reads backend runtime configuration from environment variables.
 * Input: process environment and current working directory.
 * Output: normalized application config object.
 */
export function readConfig(): AppConfig {
  const cwd = process.cwd()
  const dataDir = path.resolve(
    cwd,
    process.env.AGENTHUB_BACKEND_DATA_DIR ?? process.env.LOCATE_BACKEND_DATA_DIR ?? 'data',
  )
  const agentHubWorkspaceRootPath = path.resolve(
    cwd,
    process.env.AGENTHUB_WORKSPACE_ROOT_PATH ?? '../agentHub/data/workspaces',
  )

  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: parseInteger(process.env.PORT, 8790),
    agentHubBaseUrl: process.env.AGENTHUB_BASE_URL ?? 'http://127.0.0.1:8787',
    dataDir,
    projectsFilePath: path.join(dataDir, 'projects.json'),
    agentHubWorkspaceRootPath,
    previewBuildsDir: path.join(dataDir, 'preview-builds'),
    previewInstallsDir: path.join(dataDir, 'preview-installs'),
  }
}

/**
 * Parses one integer environment variable with a fallback value.
 * Input: raw env value and fallback number.
 * Output: parsed integer or fallback.
 */
function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
