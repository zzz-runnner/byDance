import type {
  AgentDefinition,
  AgentRunStatus,
  Artifact,
  ChangedFile,
  DeliveryIssueSeverity,
  DeliveryValidationStatus,
  ReviewVerdict,
} from '@shared/contracts'
import type { AgentAdapterResult } from '../../adapters/types'

export type DeliveryRunStatus = Extract<AgentRunStatus, 'success' | 'partial' | 'failed'>

export type DeliveryIssue = {
  severity: DeliveryIssueSeverity
  message: string
  path?: string
}

export type DeliveryValidationResult = {
  status: DeliveryValidationStatus
  summary: string
  issues: DeliveryIssue[]
  requiredFiles?: string[]
  changedFiles?: string[]
  previewReady?: boolean
  changeSetReady?: boolean
}

export type ReviewVerdictResult = {
  verdict: ReviewVerdict
  summary: string
  issues: string[]
}

export type DeliveryAssessment = {
  status: DeliveryRunStatus
  content: string
  artifacts: Artifact[]
  logs: string[]
  validation?: DeliveryValidationResult
  review?: ReviewVerdictResult
  reason: string
}

export type DeliveryAssessmentInput = {
  agent: AgentDefinition
  task: string
  expectedOutput: string
  adapterResult: AgentAdapterResult
  changedFiles: ChangedFile[]
  validation?: DeliveryValidationResult
  review?: ReviewVerdictResult
}
