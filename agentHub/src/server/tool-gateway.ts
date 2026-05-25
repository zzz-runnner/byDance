import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ServerEnv } from './env'
import { resolveCliCommand } from './adapters/command'
import { runProcess, type ProcessResult } from './runtime/process'

/**
 * Ensures a resolved path stays inside the workspace root.
 * Input: workspace root and candidate path. Output: validated absolute path.
 */
function assertWorkspaceBoundary(workspaceRoot: string, candidatePath: string): string {
  const root = path.resolve(workspaceRoot)
  const resolved = path.resolve(candidatePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('ToolGateway rejected a path outside the workspace boundary.')
  }
  return resolved
}

/**
 * Normalizes command names so Windows .cmd shims are allowed explicitly.
 * Input: configured command name. Output: executable command string.
 */
function normalizeCommandName(command: string): string {
  return resolveCliCommand(command)
}

export type RunCommandInput = {
  workspaceRepoPath: string
  cwd: string
  command: string
  args: string[]
  stdin?: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

/**
 * Provides a single local execution boundary for shell, git, and workspace files.
 * Input: validated server environment. Output: guarded file and command operations.
 */
export class LocalToolGateway {
  private readonly allowedCommands: Set<string>

  constructor(private readonly env: ServerEnv) {
    this.allowedCommands = new Set([
      'git',
      normalizeCommandName('git'),
      normalizeCommandName(env.CLAUDE_CODE_BIN),
      normalizeCommandName(env.CODEX_BIN),
    ])
  }

  /**
   * Resolves a workspace-relative path and rejects escapes above the repo root.
   * Input: workspace repo path and relative path. Output: validated absolute path.
   */
  resolveWorkspacePath(workspaceRepoPath: string, relativePath: string): string {
    return assertWorkspaceBoundary(workspaceRepoPath, path.join(workspaceRepoPath, relativePath))
  }

  /**
   * Reads a UTF-8 file inside the workspace boundary.
   * Input: workspace repo path and relative file path. Output: file content.
   */
  async readTextFile(workspaceRepoPath: string, relativePath: string): Promise<string> {
    const filePath = this.resolveWorkspacePath(workspaceRepoPath, relativePath)
    return readFile(filePath, 'utf8')
  }

  /**
   * Writes a UTF-8 file inside the workspace boundary, creating parent folders when needed.
   * Input: workspace repo path, relative file path, and content. Output: promise resolved after write.
   */
  async writeTextFile(workspaceRepoPath: string, relativePath: string, content: string): Promise<void> {
    const filePath = this.resolveWorkspacePath(workspaceRepoPath, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
  }

  /**
   * Runs a whitelisted command inside a workspace-bound working directory.
   * Input: command request and workspace repo path. Output: collected process result.
   */
  async runCommand(input: RunCommandInput): Promise<ProcessResult> {
    const command = normalizeCommandName(input.command)
    if (!this.allowedCommands.has(command)) {
      throw new Error(`ToolGateway rejected command: ${input.command}`)
    }
    const cwd = assertWorkspaceBoundary(input.workspaceRepoPath, input.cwd)
    return runProcess(command, input.args, {
      cwd,
      env: input.env,
      stdin: input.stdin,
      timeoutMs: input.timeoutMs,
      onStdout: input.onStdout,
      onStderr: input.onStderr,
    })
  }

  /**
   * Reads the current git commit for a workspace repo.
   * Input: workspace repo path. Output: commit hash or the seed marker.
   */
  async getBaseCommit(workspaceRepoPath: string): Promise<string> {
    const result = await this.runCommand({
      workspaceRepoPath,
      cwd: workspaceRepoPath,
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      timeoutMs: 10_000,
    })
    return result.code === 0 ? result.stdout.trim() || 'seed' : 'seed'
  }

  /**
   * Reads the git repository top-level folder for workspace isolation checks.
   * Input: workspace repo path. Output: top-level path or undefined when unavailable.
   */
  async getGitTopLevel(workspaceRepoPath: string): Promise<string | undefined> {
    const result = await this.runCommand({
      workspaceRepoPath,
      cwd: workspaceRepoPath,
      command: 'git',
      args: ['rev-parse', '--show-toplevel'],
      timeoutMs: 10_000,
    })
    return result.code === 0 ? result.stdout.trim() || undefined : undefined
  }

  /**
   * Reads the current git diff for tracked and untracked workspace files.
   * Input: workspace repo path. Output: unified diff text.
   */
  async getPatch(workspaceRepoPath: string): Promise<string> {
    const tracked = await this.runCommand({
      workspaceRepoPath,
      cwd: workspaceRepoPath,
      command: 'git',
      args: ['diff', '--no-color'],
      timeoutMs: 10_000,
    })
    const untracked = await this.runCommand({
      workspaceRepoPath,
      cwd: workspaceRepoPath,
      command: 'git',
      args: ['ls-files', '--others', '--exclude-standard'],
      timeoutMs: 10_000,
    })
    const untrackedPatches: string[] = []
    for (const filePath of untracked.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      this.resolveWorkspacePath(workspaceRepoPath, filePath)
      const result = await this.runCommand({
        workspaceRepoPath,
        cwd: workspaceRepoPath,
        command: 'git',
        args: ['diff', '--no-color', '--no-index', '--', '/dev/null', filePath],
        timeoutMs: 10_000,
      })
      if (result.stdout) {
        untrackedPatches.push(result.stdout)
      }
    }
    return [tracked.code === 0 ? tracked.stdout : '', ...untrackedPatches].filter(Boolean).join('\n')
  }

  /**
   * Reads a short git status summary for a workspace repo.
   * Input: workspace repo path. Output: porcelain status text.
   */
  async getStatus(workspaceRepoPath: string): Promise<string> {
    const result = await this.runCommand({
      workspaceRepoPath,
      cwd: workspaceRepoPath,
      command: 'git',
      args: ['status', '--short', '--untracked-files=all'],
      timeoutMs: 10_000,
    })
    return result.code === 0 ? result.stdout : ''
  }
}

/**
 * Creates a local tool gateway for runtime and adapter execution.
 * Input: validated server environment. Output: guarded tool gateway instance.
 */
export function createLocalToolGateway(env: ServerEnv): LocalToolGateway {
  return new LocalToolGateway(env)
}
