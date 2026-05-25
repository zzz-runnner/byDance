import { randomUUID } from 'node:crypto'
import type { ChangedFile, Message } from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import type { WorkspaceRuntimeManager } from '../../runtime/workspace'

export type RepoSnapshot = {
  status: string
  patch: string
}

/**
 * Finds an entity by id and throws a clear API error when missing.
 * Input: entity list, id, and label. Output: matched entity.
 */
export function requiredById<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find(candidate => candidate.id === id)
  if (!item) {
    throw new Error(`${label} not found: ${id}`)
  }
  return item
}

/**
 * Clips long text while preserving a readable preview.
 * Input: raw text and maximum length. Output: compacted text.
 */
export function compactText(text: string, maxLength = 360): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}... [truncated]`
}

/**
 * Creates a user or agent message with common timestamp fields.
 * Input: message details and optional artifacts. Output: complete message record.
 */
export function createMessage(input: Omit<Message, 'id' | 'createdAt'>): Message {
  return {
    ...input,
    id: `msg-${randomUUID()}`,
    createdAt: isoNow(),
  }
}

/**
 * Reads the current workspace repository status and patch as a comparable snapshot.
 * Input: runtime manager and repo path. Output: status and patch text.
 */
export async function readRepoSnapshot(runtime: WorkspaceRuntimeManager, repoPath: string): Promise<RepoSnapshot> {
  return {
    status: await runtime.getStatus(repoPath),
    patch: await runtime.getPatch(repoPath),
  }
}

/**
 * Returns only the diff that appeared during the current agent run.
 * Input: repo snapshots before and after a run. Output: patch and changed file list.
 */
export function diffRepoSnapshots(before: RepoSnapshot, after: RepoSnapshot): { patch: string; changedFiles: ChangedFile[] } {
  if (before.status === after.status && before.patch === after.patch) {
    return {
      patch: '',
      changedFiles: [],
    }
  }

  const changedFiles = parseChangedFiles(after.status)
  return {
    patch: after.patch,
    changedFiles,
  }
}

/**
 * Converts git porcelain status rows into AgentHub changed file summaries.
 * Input: git status --short output. Output: changed file records.
 */
function parseChangedFiles(statusText: string): ChangedFile[] {
  return statusText
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => {
      const statusCode = line.slice(0, 2)
      const filePath = line.slice(3).trim() || line.slice(2).trim()
      const status = statusCode.includes('D')
        ? 'deleted'
        : statusCode.includes('R')
          ? 'renamed'
          : statusCode.includes('A') || statusCode.includes('??')
            ? 'added'
            : 'modified'
      return {
        path: filePath,
        status,
        additions: 0,
        deletions: 0,
      }
    })
}
