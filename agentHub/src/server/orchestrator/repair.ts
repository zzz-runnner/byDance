import type { Conversation, RoutingTaskBrief, Workspace } from '@shared/contracts'
import type { WorkflowServices } from './workflow'
import type { SynthesisAgentResult } from './context'
import { compactText, requiredById } from './workflow/workflow-utils'
import { createTaskHandoff, ensureAgentSession } from './agent-session'
import { emitAgentTaskDispatched, emitWorkflowEvent } from './workflow/workflow-events'
import { logDiagnostic } from './workflow/diagnostics'

export type TaskBriefRunResult = SynthesisAgentResult & {
  summary: string
}

export type TaskRunExecutor = (
  brief: RoutingTaskBrief,
  state: Awaited<ReturnType<WorkflowServices['store']['read']>>,
  sessionScope: {
    session: Awaited<ReturnType<typeof ensureAgentSession>>
    handoff: Awaited<ReturnType<typeof createTaskHandoff>>
  },
) => Promise<TaskBriefRunResult>

type RepairDecision = {
  shouldRepair: boolean
  reason: string
  brief?: RoutingTaskBrief
}

/**
 * Creates a persistent handoff for an automatic repair or repair review task.
 * Input: workflow context, workspace, conversation, state, and task brief. Output: session and handoff scope.
 */
async function createRepairSessionScope(
  services: WorkflowServices,
  workspace: Workspace,
  conversation: Conversation,
  state: Awaited<ReturnType<WorkflowServices['store']['read']>>,
  brief: RoutingTaskBrief,
): Promise<{
  session: Awaited<ReturnType<typeof ensureAgentSession>>
  handoff: Awaited<ReturnType<typeof createTaskHandoff>>
}> {
  const agent = requiredById(state.agents, brief.agentId, 'Agent')
  const session = await ensureAgentSession(services.store, workspace, agent)
  const handoff = await createTaskHandoff({
    store: services.store,
    workspace,
    conversation,
    session,
    agent,
    brief,
    source: 'main',
  })
  emitWorkflowEvent(services, {
    type: 'handoff_created',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    handoffId: handoff.id,
    sessionId: session.id,
    agentId: agent.id,
    agentName: agent.name,
    source: handoff.source,
    status: handoff.status,
  })
  emitAgentTaskDispatched(services, workspace, conversation, agent, session, handoff, brief)
  logDiagnostic(services, {
    level: 'info',
    category: 'handoff',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    sessionId: session.id,
    handoffId: handoff.id,
    agentId: agent.id,
    message: 'Created automatic repair task handoff.',
    data: {
      task: brief.task,
      expectedOutput: brief.expectedOutput,
      requiredContext: brief.requiredContext,
    },
  })
  return { session, handoff }
}

/**
 * Finds whether a completed child-agent batch needs one automatic repair pass.
 * Input: child-agent run results. Output: repair decision and engineer task brief when needed.
 */
function planAutomaticRepair(results: TaskBriefRunResult[]): RepairDecision {
  const engineer = [...results].reverse().find(result => result.agentId === 'engineer')
  if (!engineer) {
    return { shouldRepair: false, reason: 'No engineer result is available for repair.' }
  }
  const reviewer = [...results].reverse().find(result => result.agentId === 'reviewer')
  const reasons = [
    engineer.status !== 'success' ? `engineer status=${engineer.status}: ${engineer.deliveryReason ?? engineer.summary}` : undefined,
    engineer.validation && engineer.validation.status !== 'pass' && engineer.validation.status !== 'skipped'
      ? `delivery validation=${engineer.validation.status}: ${engineer.validation.summary}`
      : undefined,
    reviewer?.status && reviewer.status !== 'success' ? `reviewer status=${reviewer.status}: ${reviewer.deliveryReason ?? reviewer.summary}` : undefined,
    reviewer?.review && ['fail', 'partial'].includes(reviewer.review.verdict)
      ? `review verdict=${reviewer.review.verdict}: ${reviewer.review.summary}`
      : undefined,
  ].filter(Boolean) as string[]

  if (!reasons.length) {
    return { shouldRepair: false, reason: 'No repair trigger was found.' }
  }

  const issueLines = [
    ...reasons,
    ...(engineer.validation?.issues.map(issue => `validation issue: ${issue.message}${issue.path ? ` (${issue.path})` : ''}`) ?? []),
    ...(reviewer?.review?.issues.map(issue => `review issue: ${issue}`) ?? []),
  ]

  return {
    shouldRepair: true,
    reason: issueLines.join('\n'),
    brief: {
      agentId: 'engineer',
      task: [
        'Automatic repair pass. Fix only the issues listed below and do not expand scope.',
        `Original engineering task: ${engineer.task}`,
        `Previous engineer output: ${compactText(engineer.output, 900)}`,
        reviewer ? `Reviewer output: ${compactText(reviewer.output, 900)}` : undefined,
        'Issues to fix:',
        issueLines.map(line => `- ${line}`).join('\n'),
      ]
        .filter(Boolean)
        .join('\n\n'),
      requiredContext: ['projectBrief', 'recentMessages', 'artifacts', 'changeSets', 'agentResults'],
      expectedOutput: 'Return repair summary, changed files, validation evidence, and remaining risks.',
    },
  }
}

/**
 * Builds a reviewer task for the automatic repair result.
 * Input: original reviewer task and repair result. Output: reviewer task brief for re-checking repair.
 */
function buildRepairReviewBrief(originalReviewer: RoutingTaskBrief | undefined, repairResult: TaskBriefRunResult): RoutingTaskBrief {
  return {
    agentId: 'reviewer',
    task: [
      'Review the automatic repair pass against the original requirements and prior review findings.',
      originalReviewer ? `Original review task: ${originalReviewer.task}` : undefined,
      `Repair result: ${compactText(repairResult.output, 1000)}`,
      'Return PASS, PARTIAL, or FAIL with concrete evidence from files, validation, preview, or change sets.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    requiredContext: ['projectBrief', 'recentMessages', 'artifacts', 'changeSets', 'agentResults', 'reviewEvidence'],
    expectedOutput: 'PASS/PARTIAL/FAIL verdict with concrete findings and remaining risks.',
  }
}

/**
 * Executes at most one automatic engineer repair and reviewer re-check.
 * Input: workflow context, workspace, conversation, current results, dispatches, and run executor. Output: appended results.
 */
export async function runAutomaticRepairIfNeeded(
  services: WorkflowServices,
  workspace: Workspace,
  conversation: Conversation,
  results: TaskBriefRunResult[],
  dispatches: RoutingTaskBrief[],
  runTask: TaskRunExecutor,
): Promise<TaskBriefRunResult[]> {
  const repair = planAutomaticRepair(results)
  if (!repair.shouldRepair || !repair.brief) {
    return results
  }

  emitWorkflowEvent(services, {
    type: 'repair_suggested',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    reason: repair.reason,
    targetAgentId: repair.brief.agentId,
    issueCount: repair.reason.split(/\n/).filter(Boolean).length,
  })
  emitWorkflowEvent(services, {
    type: 'repair_started',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    targetAgentId: repair.brief.agentId,
    attempt: 1,
    task: repair.brief.task,
  })

  const repairState = await services.store.read()
  const repairScope = await createRepairSessionScope(services, workspace, conversation, repairState, repair.brief)
  const repairRunState = await services.store.read()
  const repairResult = await runTask(repair.brief, repairRunState, repairScope)
  const reviewerBrief = buildRepairReviewBrief(dispatches.find(brief => brief.agentId === 'reviewer'), repairResult)
  const reviewState = await services.store.read()
  const reviewScope = await createRepairSessionScope(services, workspace, conversation, reviewState, reviewerBrief)
  const reviewRunState = await services.store.read()
  const reviewResult = await runTask(reviewerBrief, reviewRunState, reviewScope)

  emitWorkflowEvent(services, {
    type: 'repair_finished',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    targetAgentId: repair.brief.agentId,
    attempt: 1,
    status: repairResult.status as 'success' | 'partial' | 'failed',
    reviewerStatus: reviewResult.status as 'success' | 'partial' | 'failed',
  })

  if (repairResult.status !== 'success' || reviewResult.status !== 'success') {
    emitWorkflowEvent(services, {
      type: 'repair_blocked',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      reason: 'Automatic repair attempt limit reached after one pass.',
      maxAttempts: 1,
    })
  }

  return [...results, repairResult, reviewResult]
}
