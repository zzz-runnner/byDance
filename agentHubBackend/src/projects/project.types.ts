import type { ConversationType } from '../types'

export interface ProjectWorkflowSummary {
  lastEventTypes: string[]
  latestChangeSetId?: string
  latestPreviewUrl?: string
  deliveryValidationStatus?: string
  reviewVerdict?: string
  repairBlockedReason?: string
  workflowFinishedAt?: string
  updatedAt: string
}

export interface VersionMetadata {
  versionId: string
  tag: string
  commitSha: string
  sourceZipPath: string
  sourceZipUrl: string
  buildPath?: string
  buildPreviewUrl?: string
  buildStatus?: 'pending' | 'success' | 'failed'
  buildLog?: string
  createdAt: string
  updatedAt: string
}

export interface DeploymentMetadata {
  deploymentId: string
  versionId: string
  deployPath: string
  deployUrl: string
  createdAt: string
}

export interface ProjectMetadata {
  projectId: string
  name: string
  goal: string
  workspaceId: string
  conversationId?: string
  conversationType?: ConversationType
  targetAgentId?: string
  agentHubPreviewUrl: string
  agentHubZipUrl: string
  currentVersionId?: string
  latestWorkflow?: ProjectWorkflowSummary
  versions: VersionMetadata[]
  deployments: DeploymentMetadata[]
  createdAt: string
  updatedAt: string
}
