import type { AgentDefinition, ChangedFile, DiagnosticLog, RoutingTaskBrief } from '@shared/contracts'
import { parseReviewVerdict } from './verdict'
import { validateDelivery } from './validator'
import type { DeliveryRunStatus, DeliveryValidationResult, ReviewVerdictResult } from './types'

/**
 * Returns whether a child-agent delivery should run lightweight file validation.
 * Input: agent definition. Output: true when file outputs should be checked.
 */
function shouldValidateAgentDelivery(agent: AgentDefinition): boolean {
  return agent.permissions.fileWrite || agent.id === 'engineer'
}

/**
 * Returns whether a child-agent output should be interpreted as a review verdict.
 * Input: agent definition. Output: true when review verdict parsing should run.
 */
function shouldParseReviewVerdict(agent: AgentDefinition): boolean {
  const text = `${agent.id}\n${agent.role}\n${agent.whenToUse}`.toLowerCase()
  return /\breviewer?\b|review|validate|quality/.test(text)
}

/**
 * Safely runs delivery validation without failing the whole workflow.
 * Input: workspace repo path, task brief, changed files, and agent. Output: validation result when applicable.
 */
export async function runDeliveryValidation(
  agent: AgentDefinition,
  repoPath: string,
  brief: RoutingTaskBrief,
  changedFiles: ChangedFile[],
  previewReady?: boolean,
): Promise<DeliveryValidationResult | undefined> {
  if (!shouldValidateAgentDelivery(agent)) {
    return undefined
  }
  try {
    return await validateDelivery({
      repoPath,
      task: brief.task,
      expectedOutput: brief.expectedOutput,
      changedFiles,
      previewReady,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'partial',
      summary: `Delivery validation could not complete: ${message}`,
      issues: [
        {
          severity: 'blocking',
          message,
        },
      ],
    }
  }
}

/**
 * Safely parses reviewer output into a structured verdict.
 * Input: agent definition and output content. Output: review verdict when applicable.
 */
export function runReviewVerdictParsing(agent: AgentDefinition, content: string): ReviewVerdictResult | undefined {
  if (!shouldParseReviewVerdict(agent)) {
    return undefined
  }
  return parseReviewVerdict(content)
}

/**
 * Maps a final delivery status to diagnostic severity.
 * Input: normalized agent run status. Output: diagnostic log level.
 */
export function deliveryDiagnosticLevel(status: DeliveryRunStatus): DiagnosticLog['level'] {
  if (status === 'success') {
    return 'info'
  }
  if (status === 'partial') {
    return 'warn'
  }
  return 'error'
}
