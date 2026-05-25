import type { AgentRun, AppState, DiagnosticLog, TaskHandoff, WorkflowEvent } from '@shared/contracts'

/**
 * Clips one-line CLI summaries without leaking large payloads.
 * Input: raw text and max length. Output: compact single-line text.
 */
export function compactLine(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

/**
 * Formats workflow progress events for the CLI terminal.
 * Input: structured workflow event. Output: printable status line.
 */
export function formatWorkflowEvent(event: WorkflowEvent): string {
  switch (event.type) {
    case 'turn_started':
      return `[turn] ${event.turnId ?? 'unknown'} 接收消息${event.activeAgentId ? ` -> @${event.activeAgentId}` : ' -> @main'}`
    case 'workflow_received':
      return `[主脑] 已接收任务：${event.content}`
    case 'routing_started':
      return '[主脑] 正在思考本轮回复或调度...'
    case 'routing_finished':
      return `[主脑] 回合决策：${event.source}${event.provider ? ` (${event.provider}/${event.model ?? 'unset'})` : ''}${event.error ? ' | 模型输出异常，已兜底' : ''} | speaker=${event.speakerAgentId ?? 'orchestrator'} | finalization=${event.finalizationMode ?? 'speaker_direct'} | ${event.taskStage ?? 'unknown'}/${event.brainKind ?? event.mode}/${event.execution} -> ${event.targetAgents.length ? event.targetAgents.join(', ') : 'direct'}`
    case 'task_stage_updated':
      return `[主脑] 任务阶段：${event.taskStage} | readiness=${event.executionReadiness}${event.needsUserConfirmation ? ' | 等待用户确认' : ''}`
    case 'context_started':
      return formatContextStarted(event)
    case 'context_finished':
      return formatContextFinished(event)
    case 'model_call_started':
      return formatModelCallStarted(event)
    case 'model_call_finished':
      return formatModelCallFinished(event)
    case 'model_call_failed':
      return formatModelCallFailed(event)
    case 'artifact_created':
      return `[artifact] ${event.artifactType} | ${event.title}${event.url ? ` | ${event.url}` : ''}`
    case 'change_set_created':
      return `[changes] ${event.summary} | baseCommit=${event.baseCommit} | files=${event.files.length}`
    case 'preview_ready':
      return `[preview] ${event.previewUrl}${event.artifactId ? ` | artifact=${event.artifactId}` : ''}`
    case 'zip_ready':
      return `[zip] ${event.zipUrl} | files=${event.fileCount} | bytes=${event.byteLength}`
    case 'handoff_created':
      return `[handoff] ${event.agentName} <- ${event.source} | ${event.status} | ${event.handoffId}`
    case 'agent_task_dispatched':
      return `[dispatch] 主脑 -> ${event.agentName} | ${compactLine(event.task, 120)}`
    case 'handoff_updated':
      return `[handoff] ${event.agentName} | ${event.status}${event.runId ? ` | run=${event.runId}` : ''}`
    case 'agent_started':
      return `[${event.agentName}] 开始执行，context ≈ ${event.contextTokens} tokens`
    case 'agent_progress':
      return `[${event.agentName}] ${event.message}`
    case 'agent_output_started':
      return `[${event.agentName} ${event.stream}] 输出开始`
    case 'agent_stdout_delta':
      return `[${event.agentName} stdout] ${compactLine(event.delta, 120)}`
    case 'agent_stderr_delta':
      return `[${event.agentName} stderr] ${compactLine(event.delta, 120)}`
    case 'agent_output_finished':
      return `[${event.agentName} ${event.stream}] 输出结束：${event.byteLength} bytes, ${event.chunkCount} chunks`
    case 'agent_finished':
      return `[${event.agentName}] 已完成：${event.status} | baseCommit=${event.baseCommit}`
    case 'repair_suggested':
      return `[repair] auto repair suggested -> @${event.targetAgentId} | issues=${event.issueCount}`
    case 'repair_started':
      return `[repair] auto repair attempt ${event.attempt} -> @${event.targetAgentId}`
    case 'repair_finished':
      return `[repair] auto repair finished: ${event.status}${event.reviewerStatus ? ` | reviewer=${event.reviewerStatus}` : ''}`
    case 'repair_blocked':
      return `[repair] stopped: ${event.reason}`
    case 'agent_session_started':
      return `[${event.agentName}] 私聊会话已接收：${event.content}`
    case 'agent_session_finished':
      return `[${event.agentName}] 私聊决策：${event.source}${event.provider ? ` (${event.provider}/${event.model ?? 'unset'})` : ''}${event.error ? ' | 会话模型异常，已兜底' : ''} | ${event.turnKind}`
    case 'synthesis_started':
      return `[主脑] 正在综合 ${event.runCount} 个子 Agent 结果...`
    case 'synthesis_finished':
      return `[主脑] 综合完成：${event.source}${event.provider ? ` (${event.provider}/${event.model ?? 'unset'})` : ''}${event.error ? ' | 综合异常，已兜底' : ''} | ${event.synthesisKind}/${event.verdict}${event.followUpAgents.length ? ` | 建议后续：${event.followUpAgents.join(', ')}` : ''}`
    case 'workflow_finished':
      return `[主脑] 本轮结束：${compactLine(event.summary, 120)}`
    default:
      return '[workflow] 状态更新'
  }
}

/**
 * Formats a context-started workflow event for CLI output.
 * Input: context-start event. Output: printable status line.
 */
function formatContextStarted(event: Extract<WorkflowEvent, { type: 'context_started' }>): string {
  if (event.scope === 'agent_session') {
    return `[${event.agentName ?? event.agentId ?? 'Agent'}] 构建 session context...`
  }
  if (event.scope === 'agent_run') {
    return `[${event.agentName ?? event.agentId ?? 'Agent'}] 构建 run context...`
  }
  if (event.scope === 'synthesis') {
    return '[主脑] 构建综合 context...'
  }
  return '[主脑] 构建调度 context...'
}

/**
 * Formats a context-finished workflow event for CLI output.
 * Input: context-finished event. Output: printable status line.
 */
function formatContextFinished(event: Extract<WorkflowEvent, { type: 'context_finished' }>): string {
  if (event.scope === 'agent_session') {
    return `[${event.agentName ?? event.agentId ?? 'Agent'}] session context≈${event.tokenEstimate} tokens`
  }
  if (event.scope === 'agent_run') {
    return `[${event.agentName ?? event.agentId ?? 'Agent'}] run context≈${event.tokenEstimate} tokens`
  }
  if (event.scope === 'synthesis') {
    return `[主脑] 综合 context≈${event.tokenEstimate} tokens`
  }
  return `[主脑] 调度 context≈${event.tokenEstimate} tokens`
}

/**
 * Formats a model-call-started workflow event for CLI output.
 * Input: model-call-started event. Output: printable status line.
 */
function formatModelCallStarted(event: Extract<WorkflowEvent, { type: 'model_call_started' }>): string {
  const model = `${event.provider}/${event.model ?? 'unset'}`
  if (event.scope === 'agent_session') {
    return `[${event.agentName ?? event.agentId ?? 'Agent'}] 调用轻量模型 ${model}...`
  }
  if (event.scope === 'synthesis') {
    return `[主脑] 调用综合模型 ${model}...`
  }
  return `[主脑] 调用调度模型 ${model}...`
}

/**
 * Formats a successful model-call workflow event for CLI output.
 * Input: model-call-finished event. Output: printable status line.
 */
function formatModelCallFinished(event: Extract<WorkflowEvent, { type: 'model_call_finished' }>): string {
  const seconds = (event.elapsedMs / 1000).toFixed(1)
  if (event.scope === 'agent_session') {
    return `[${event.agentName ?? event.agentId ?? 'Agent'}] 轻量模型完成 ${seconds}s`
  }
  if (event.scope === 'synthesis') {
    return `[主脑] 综合模型完成 ${seconds}s`
  }
  return `[主脑] 调度模型完成 ${seconds}s`
}

/**
 * Formats a failed model-call workflow event for CLI output.
 * Input: model-call-failed event. Output: printable status line.
 */
function formatModelCallFailed(event: Extract<WorkflowEvent, { type: 'model_call_failed' }>): string {
  const suffix = event.elapsedMs === undefined ? '' : ` ${(event.elapsedMs / 1000).toFixed(1)}s`
  if (event.scope === 'agent_session') {
    return `[${event.agentName ?? event.agentId ?? 'Agent'}] 轻量模型异常${suffix}，已兜底`
  }
  if (event.scope === 'synthesis') {
    return `[主脑] 综合模型异常${suffix}，已兜底`
  }
  return `[主脑] 调度模型异常${suffix}，已兜底`
}

/**
 * Formats a diagnostic log for CLI output.
 * Input: diagnostic log. Output: printable diagnostic line.
 */
export function formatDiagnosticLog(log: DiagnosticLog): string {
  const refs = [
    log.turnId ? `turn=${log.turnId}` : undefined,
    log.agentId ? `agent=${log.agentId}` : undefined,
    log.sessionId ? `session=${log.sessionId}` : undefined,
    log.handoffId ? `handoff=${log.handoffId}` : undefined,
    log.runId ? `run=${log.runId}` : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  return `${log.level}/${log.category}${refs ? ` ${refs}` : ''} | ${log.message}`
}

/**
 * Formats a recent agent run row for CLI output.
 * Input: state and run. Output: printable agent run summary.
 */
export function formatAgentRun(state: AppState, run: AgentRun): string {
  const agentName = state.agents.find(agent => agent.id === run.agentId)?.name ?? run.agentId
  return `- ${run.id} | ${agentName} | ${run.status} | session=${run.sessionId ?? 'none'} | handoff=${run.handoffId ?? 'none'} | started=${run.startedAt}`
}

/**
 * Formats a task handoff row for CLI output.
 * Input: state and handoff. Output: printable handoff summary.
 */
export function formatTaskHandoff(state: AppState, handoff: TaskHandoff): string {
  const agentName = state.agents.find(agent => agent.id === handoff.agentId)?.name ?? handoff.agentId
  return `- ${handoff.id} | ${agentName} <- ${handoff.source} | ${handoff.status} | run=${handoff.resultRunId ?? 'none'} | ${compactLine(handoff.task, 100)}`
}
