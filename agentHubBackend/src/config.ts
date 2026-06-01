import path from 'node:path'

export interface AppConfig {
  dataDir: string
  agentHubWorkspaceRootPath: string
  pnpmStoreDir: string
  previewSandboxesDir: string
  previewOutputsDir: string
}

/**
 * Reads preview-runtime configuration from environment variables.
 * Input: current process environment.
 * Output: normalized local preview path settings.
 */
export function readConfig(): AppConfig {
  const cwd = process.cwd()
  const dataDir = path.resolve(
    cwd,
    process.env.APP_STORAGE_ROOT
      ?? process.env.AGENTHUB_BACKEND_DATA_DIR
      ?? 'data',
  )
  const agentHubWorkspaceRootPath = path.resolve(
    cwd,
    process.env.AGENTHUB_RUNTIME_ROOT
      ?? process.env.AGENTHUB_WORKSPACE_ROOT_PATH
      ?? '../agentHub/data/workspaces',
  )

  return {
    dataDir,
    agentHubWorkspaceRootPath,
    pnpmStoreDir: path.join(dataDir, 'pnpm-store'),
    previewSandboxesDir: path.join(dataDir, 'build-sandboxes'),
    previewOutputsDir: path.join(dataDir, 'preview-outputs'),
  }
}
