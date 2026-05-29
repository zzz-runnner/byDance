import path from 'node:path'

export interface AppConfig {
  host: string
  port: number
  agentHubBaseUrl: string
  dataDir: string
  projectsFilePath: string
}

/**
 * Reads locateBackend runtime configuration from environment variables.
 * Input: process environment and current working directory.
 * Output: normalized application config object.
 */
export function readConfig(): AppConfig {
  const cwd = process.cwd()
  const dataDir = path.resolve(cwd, process.env.LOCATE_BACKEND_DATA_DIR ?? 'data')

  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: parseInteger(process.env.PORT, 8790),
    agentHubBaseUrl: process.env.AGENTHUB_BASE_URL ?? 'http://127.0.0.1:8787',
    dataDir,
    projectsFilePath: path.join(dataDir, 'projects.json'),
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
