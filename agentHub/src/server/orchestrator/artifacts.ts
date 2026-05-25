import { randomUUID } from 'node:crypto'
import type {
  Artifact,
  ChangeSet,
  ChangedFile,
  WorkflowEvent,
} from '@shared/contracts'
import { isoNow } from '@shared/contracts'

/**
 * Creates a workflow artifact record with common timestamp fields.
 * Input: artifact details without id and timestamp. Output: complete artifact record.
 */
function createArtifactBase(input: Omit<Artifact, 'id' | 'createdAt'>): Artifact {
  return {
    ...input,
    id: `artifact-${randomUUID()}`,
    createdAt: isoNow(),
  }
}

/**
 * Creates a text artifact for an adapter output.
 * Input: workspace id, agent id, run id, and content. Output: artifact record.
 */
export function createTextArtifact(workspaceId: string, agentId: string, runId: string, content: string): Artifact {
  return createArtifactBase({
    workspaceId,
    agentRunId: runId,
    type: 'text',
    title: `${agentId} 运行摘要`,
    content,
    createdByAgentId: agentId,
  })
}

/**
 * Creates a local preview artifact that points at the runtime preview URL.
 * Input: workspace id, agent id, run id, and preview URL. Output: artifact record.
 */
export function createPreviewArtifact(workspaceId: string, agentId: string, runId: string, previewUrl: string): Artifact {
  return createArtifactBase({
    workspaceId,
    agentRunId: runId,
    type: 'web-preview',
    title: '本地预览 URL',
    content: '由本地 Workspace Runtime 提供的静态预览入口。',
    url: previewUrl,
    createdByAgentId: agentId,
  })
}

/**
 * Creates a zip artifact for a workspace download route.
 * Input: workspace id, zip URL, and file counts. Output: artifact record.
 */
export function createZipArtifact(
  workspaceId: string,
  zipUrl: string,
  fileCount: number,
  byteLength: number,
): Artifact {
  return createArtifactBase({
    workspaceId,
    type: 'zip',
    title: '工作区打包文件',
    content: `Workspace archive with ${fileCount} file(s), ${byteLength} byte(s).`,
    url: zipUrl,
    metadata: {
      fileCount,
      byteLength,
    },
  })
}

/**
 * Creates a generic artifact-created workflow event.
 * Input: workspace and conversation ids plus artifact metadata. Output: workflow event payload.
 */
export function createArtifactCreatedEvent(
  workspaceId: string,
  conversationId: string,
  artifact: Artifact,
  input?: {
    runId?: string
    agentId?: string
  },
): WorkflowEvent {
  return {
    type: 'artifact_created',
    workspaceId,
    conversationId,
    artifactId: artifact.id,
    artifactType: artifact.type,
    title: artifact.title,
    url: artifact.url,
    runId: input?.runId,
    agentId: input?.agentId,
  }
}

/**
 * Creates a change-set-created workflow event.
 * Input: workspace and conversation ids plus change-set details. Output: workflow event payload.
 */
export function createChangeSetCreatedEvent(
  workspaceId: string,
  conversationId: string,
  changeSet: ChangeSet,
): WorkflowEvent {
  return {
    type: 'change_set_created',
    workspaceId,
    conversationId,
    changeSetId: changeSet.id,
    runId: changeSet.agentRunId,
    baseCommit: changeSet.baseCommit,
    summary: changeSet.summary,
    files: changeSet.files,
  }
}

/**
 * Creates a preview-ready workflow event.
 * Input: workspace and conversation ids plus preview artifact metadata. Output: workflow event payload.
 */
export function createPreviewReadyEvent(
  workspaceId: string,
  conversationId: string,
  artifact: Artifact,
  input?: {
    runId?: string
    agentId?: string
  },
): WorkflowEvent {
  return {
    type: 'preview_ready',
    workspaceId,
    conversationId,
    artifactId: artifact.id,
    previewUrl: artifact.url ?? '',
    runId: input?.runId,
    agentId: input?.agentId,
  }
}

/**
 * Creates a zip-ready workflow event.
 * Input: workspace and conversation ids plus zip artifact metadata. Output: workflow event payload.
 */
export function createZipReadyEvent(
  workspaceId: string,
  conversationId: string,
  artifact: Artifact,
  fileCount: number,
  byteLength: number,
): WorkflowEvent {
  return {
    type: 'zip_ready',
    workspaceId,
    conversationId,
    artifactId: artifact.id,
    zipUrl: artifact.url ?? '',
    fileCount,
    byteLength,
  }
}

/**
 * Finds a compact change-set summary from a list of changed files.
 * Input: file list and optional limit. Output: compact changed-file slice.
 */
export function sliceChangedFiles(files: ChangedFile[], limit = 8): ChangedFile[] {
  return files.slice(0, limit)
}
