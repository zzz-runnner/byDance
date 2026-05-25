import type { DeliveryAssessment, DeliveryAssessmentInput, DeliveryIssue, DeliveryRunStatus } from './types'

/**
 * Returns whether an implementation task should normally produce file changes.
 * Input: child-agent task details and permissions. Output: true when changed files are required.
 */
function expectsFileChanges(input: DeliveryAssessmentInput): boolean {
  if (!input.agent.permissions.fileWrite) {
    return false
  }
  const text = `${input.task}\n${input.expectedOutput}`.toLowerCase()
  if (/do not (write|modify|create).*file|no file changes|read-only/.test(text)) {
    return false
  }
  return /(implement|create|write|fix|page|project|file|code|html|react|miniprogram|cloudfunction)/i.test(text)
}

/**
 * Detects process-level warnings that should downgrade a result.
 * Input: adapter logs and output content. Output: delivery issues.
 */
function detectProcessIssues(input: DeliveryAssessmentInput): DeliveryIssue[] {
  const text = [...input.adapterResult.logs, input.adapterResult.content].join('\n')
  const issues: DeliveryIssue[] = []
  if (/timed out|timeout/i.test(text)) {
    issues.push({ severity: 'blocking', message: 'Child agent process timed out.' })
  }
  if (/exited with code\s*[1-9]|exitCode=[1-9]|non-zero/i.test(text)) {
    issues.push({ severity: 'blocking', message: 'Child agent process exited with a non-zero code.' })
  }
  if (/read-only|readonly|unable to write|cannot write|permission denied/i.test(text)) {
    issues.push({ severity: 'blocking', message: 'Child agent reported that it could not write files.' })
  }
  return issues
}

/**
 * Maps validation and review outcomes into a run status.
 * Input: current status and assessment input. Output: gated final run status.
 */
function applyDeliveryGates(status: DeliveryRunStatus, input: DeliveryAssessmentInput): DeliveryRunStatus {
  if (input.validation?.status === 'fail' || input.review?.verdict === 'fail') {
    return 'failed'
  }
  if (input.validation?.status === 'partial' || input.review?.verdict === 'partial') {
    return status === 'failed' ? 'failed' : 'partial'
  }
  return status
}

/**
 * Builds the final run status from adapter, file, validation, and review evidence.
 * Input: delivery assessment input. Output: normalized delivery assessment.
 */
export function assessDelivery(input: DeliveryAssessmentInput): DeliveryAssessment {
  const issues = detectProcessIssues(input)
  let status: DeliveryRunStatus = input.adapterResult.status

  if (status === 'success' && issues.some(issue => issue.severity === 'blocking')) {
    status = 'partial'
  }

  if (status === 'success' && expectsFileChanges(input) && input.changedFiles.length === 0) {
    status = 'partial'
    issues.push({ severity: 'blocking', message: 'The task expected file changes, but this run produced no changed files.' })
  }

  status = applyDeliveryGates(status, input)
  const gateIssues = [
    ...(input.validation?.issues ?? []),
    ...(input.review?.issues.map(message => ({ severity: 'blocking' as const, message })) ?? []),
  ]
  const allIssues = [...issues, ...gateIssues]
  const reason = allIssues.length
    ? allIssues.map(issue => issue.message).join('; ')
    : status === 'success'
      ? 'Process and delivery checks passed.'
      : 'Child agent did not return a confirmed complete delivery.'

  return {
    status,
    content: input.adapterResult.content,
    artifacts: input.adapterResult.artifacts,
    logs: [
      ...input.adapterResult.logs,
      `delivery_status=${status}`,
      `delivery_reason=${reason}`,
    ],
    validation: input.validation,
    review: input.review,
    reason,
  }
}

/**
 * Converts a run status into the matching handoff status.
 * Input: normalized run status. Output: persisted handoff status.
 */
export function toHandoffStatus(status: DeliveryRunStatus): 'completed' | 'partial' | 'failed' {
  if (status === 'success') {
    return 'completed'
  }
  if (status === 'partial') {
    return 'partial'
  }
  return 'failed'
}

/**
 * Returns a short status label for summaries.
 * Input: normalized run status. Output: human-readable label.
 */
export function formatRunStatus(status: DeliveryRunStatus): string {
  if (status === 'success') {
    return 'completed'
  }
  if (status === 'partial') {
    return 'partially completed'
  }
  return 'failed'
}
