import { randomUUID } from 'node:crypto'
import type {
  AgentDefinition,
  AgentRunStatus,
  AgentSession,
  AgentSessionMessage,
  AgentSessionTurn,
  AppState,
  CodeSelectionReference,
  Conversation,
  Message,
  ReplyReference,
  RoutingTaskBrief,
  SenderType,
  TaskHandoff,
  Workspace,
} from '@shared/contracts'
import { AgentSessionTurnSchema, isoNow } from '@shared/contracts'
import type { ServerEnv } from '../env'
import type { StateStore } from '../store/types'
import {
  routeAllowsExecution,
  routeTurnWithModel,
  selectModelForRoute,
  type ContextProfile,
  type RoutedTurn,
  type TurnRoute,
} from './turn-router'
import { buildReplyContextPayload } from './reply-context'
import { resolveConversationAgents } from '../agents/workspace-agents'
import { generateAgentModelResponse, resolveAgentConfiguredModel } from './agent-model'
import type { WorkspaceRuntimeManager } from '../runtime/workspace'
import type { LocalToolGateway } from '../tool-gateway'

export type PlannedAgentSessionTurn = {
  session: AgentSession
  turn: AgentSessionTurn
  source: 'model' | 'forced_run' | 'local_rule' | 'local_fallback'
  provider?: string
  model?: string
  error?: string
  handoff?: TaskHandoff
  contextTokenEstimate?: number
  modelElapsedMs?: number
  route?: TurnRoute
  routeProvider?: string
  routeModel?: string
  routeElapsedMs?: number
  routeError?: string
}

export type AgentReplyPersistenceInput = {
  workspace: Workspace
  conversation: Conversation
  agent: AgentDefinition
  session: AgentSession
  turn: AgentSessionTurn
  userContent: string
  replyTo?: ReplyReference
  codeSelection?: CodeSelectionReference
  route?: TurnRoute
  metadata: Record<string, unknown>
}

type AgentSessionServices = {
  env: ServerEnv
  store: StateStore
  runtime: WorkspaceRuntimeManager
  toolGateway: LocalToolGateway
  streamAgentReply?: (input: AgentReplyPersistenceInput) => Promise<Message>
}

type AgentSessionTurnInput = {
  services: AgentSessionServices
  state: AppState
  workspace: Workspace
  conversation: Conversation
  agent: AgentDefinition
  session: AgentSession
  content: string
  replyTo?: ReplyReference
  codeSelection?: CodeSelectionReference
}

type TaskHandoffInput = {
  store: StateStore
  workspace: Workspace
  conversation: Conversation
  session: AgentSession
  agent: AgentDefinition
  brief: RoutingTaskBrief
  source: TaskHandoff['source']
}

type AgentSessionContextInput = {
  state: AppState
  workspace: Workspace
  conversation: Conversation
  agent: AgentDefinition
  session: AgentSession
  userMessage: string
  replyTo?: ReplyReference
  codeSelection?: CodeSelectionReference
  contextProfile?: ContextProfile
}

const RUN_COMMAND_PATTERN = /^\/run(?:\s+|$)/i

/**
 * Finds an entity by id and throws a clear orchestration error when absent.
 * Input: entity list, id, and label. Output: matched entity.
 */
function requiredById<T extends { id: string }>(items: T[], id: string, label: string): T {
  const item = items.find(candidate => candidate.id === id)
  if (!item) {
    throw new Error(`${label} not found: ${id}`)
  }
  return item
}

/**
 * Clips long text for compact session context packages.
 * Input: raw text and maximum length. Output: compact text.
 */
function compactText(text: string, maxLength = 500): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}... [truncated]`
}

/**
 * Estimates token count using the local char-to-token heuristic.
 * Input: serialized context text. Output: approximate token count.
 */
function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Removes the direct-run command prefix from a private agent message.
 * Input: raw user content. Output: task text without the /run prefix.
 */
export function stripRunCommand(content: string): string {
  return content.replace(RUN_COMMAND_PATTERN, '').trim()
}

/**
 * Returns whether a private agent message explicitly asks for a real run.
 * Input: raw user content. Output: true when /run is present.
 */
export function isForcedAgentRun(content: string): boolean {
  return RUN_COMMAND_PATTERN.test(content.trim())
}

/**
 * Detects obvious execution intent for conservative direct-agent auto runs.
 * Input: raw user content. Output: true when a real agent run is appropriate.
 */
function hasObviousExecutionIntent(content: string): boolean {
  return /实现|修改|修复|生成|创建|写(一个|一份|代码|文件|页面|prd)?|输出|检查|审查|验收|测试|运行|执行|重构|新增|删除|改(一下|成)?|做(一个|一份|个|下)|implement|create|write|fix|test|run|review|validate|check|build|preview|diff/i.test(
    content,
  )
}

/**
 * Creates a standard direct-agent task brief.
 * Input: agent id, task text, and expected output. Output: routing task brief.
 */
function createDirectTaskBrief(agentId: string, task: string, expectedOutput?: string): RoutingTaskBrief {
  return {
    agentId,
    task,
    requiredContext: ['projectBrief', 'agentSessionHistory', 'recentMessages', 'artifacts'],
    expectedOutput: expectedOutput ?? 'Return a concise direct-agent result with evidence, files, tests, or next steps.',
  }
}

/**
 * Creates a session-scoped message record.
 * Input: message fields without id and createdAt. Output: complete session message.
 */
function createAgentSessionMessage(input: Omit<AgentSessionMessage, 'id' | 'createdAt'>): AgentSessionMessage {
  return {
    ...input,
    id: `session-msg-${randomUUID()}`,
    createdAt: isoNow(),
  }
}

/**
 * Creates a conversation message for lightweight direct-agent replies.
 * Input: message fields without id and createdAt. Output: complete conversation message.
 */
function createConversationMessage(input: Omit<Message, 'id' | 'createdAt'>): Message {
  return {
    ...input,
    id: `msg-${randomUUID()}`,
    createdAt: isoNow(),
  }
}

/**
 * Returns the active session for an agent or creates one.
 * Input: store, workspace, and agent definition. Output: active agent session.
 */
export async function ensureAgentSession(
  store: StateStore,
  workspace: Workspace,
  agent: AgentDefinition,
): Promise<AgentSession> {
  const state = await store.read()
  const existing = [...state.agentSessions]
    .filter(session => session.workspaceId === workspace.id && session.agentId === agent.id && session.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (existing) {
    return existing
  }

  const now = isoNow()
  const session: AgentSession = {
    id: `agent-session-${randomUUID()}`,
    workspaceId: workspace.id,
    agentId: agent.id,
    title: `${agent.name} 会话`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  await store.update(nextState => {
    nextState.agentSessions.push(session)
  })

  return session
}

/**
 * Appends one message to a child-agent persistent session.
 * Input: store and session message fields. Output: persisted session message.
 */
export async function appendAgentSessionMessage(
  store: StateStore,
  input: Omit<AgentSessionMessage, 'id' | 'createdAt'>,
): Promise<AgentSessionMessage> {
  const message = createAgentSessionMessage(input)
  await store.update(state => {
    state.agentSessionMessages.push(message)
    const session = requiredById(state.agentSessions, message.sessionId, 'AgentSession')
    session.updatedAt = message.createdAt
  })
  return message
}

/**
 * Builds compact private-session context for a child-agent model call.
 * Input: workspace, agent, session, user message, and state. Output: serialized context package.
 */
export function buildAgentSessionContextPackage(input: AgentSessionContextInput): string {
  const contextProfile = input.contextProfile ?? 'short'
  const sessionLimit = contextProfile === 'minimal' ? 0 : contextProfile === 'short' ? 6 : 14
  const handoffLimit = contextProfile === 'task' || contextProfile === 'full_review' ? 5 : 1
  const conversationLimit = contextProfile === 'minimal' ? 0 : contextProfile === 'short' ? 4 : 8
  const sessionMessages = input.state.agentSessionMessages
    .filter(message => message.workspaceId === input.workspace.id && message.sessionId === input.session.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(sessionLimit > 0 ? -sessionLimit : 0, sessionLimit > 0 ? undefined : 0)
    .map(message => ({
      senderType: message.senderType,
      senderId: message.senderId,
      kind: message.kind,
      content: compactText(message.content, 520),
      createdAt: message.createdAt,
    }))

  const handoffs = input.state.taskHandoffs
    .filter(handoff => handoff.workspaceId === input.workspace.id && handoff.sessionId === input.session.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, handoffLimit)
    .map(handoff => ({
      id: handoff.id,
      source: handoff.source,
      task: compactText(handoff.task, 420),
      expectedOutput: compactText(handoff.expectedOutput, 260),
      status: handoff.status,
      resultRunId: handoff.resultRunId,
      resultSummary: handoff.resultSummary ? compactText(handoff.resultSummary, 360) : undefined,
      createdAt: handoff.createdAt,
    }))

  const directConversationMessages = input.state.messages
    .filter(message => message.workspaceId === input.workspace.id && message.conversationId === input.conversation.id)
    .slice(conversationLimit > 0 ? -conversationLimit : 0, conversationLimit > 0 ? undefined : 0)
    .map(message => ({
      senderType: message.senderType,
      senderId: message.senderId,
      content: compactText(message.content, 420),
      replyTo: message.replyTo,
      createdAt: message.createdAt,
    }))

  return JSON.stringify(
    {
      userMessage: input.userMessage,
      replyContext: buildReplyContextPayload(
        input.replyTo,
        resolveConversationAgents(input.state, input.workspace.id, input.conversation.id),
      ),
      codeSelection: input.codeSelection
        ? {
            filePath: input.codeSelection.filePath,
            language: input.codeSelection.language,
            startLine: input.codeSelection.startLine,
            startColumn: input.codeSelection.startColumn,
            endLine: input.codeSelection.endLine,
            endColumn: input.codeSelection.endColumn,
            selectedText: compactText(input.codeSelection.selectedText, 1_200),
            beforeContext: input.codeSelection.beforeContext ? compactText(input.codeSelection.beforeContext, 600) : undefined,
            afterContext: input.codeSelection.afterContext ? compactText(input.codeSelection.afterContext, 600) : undefined,
          }
        : undefined,
      workspace: {
        id: input.workspace.id,
        name: input.workspace.name,
        goal: input.workspace.goal,
        projectBrief: input.workspace.projectBrief,
        runtimeStatus: input.workspace.runtimeStatus,
      },
      conversation: {
        id: input.conversation.id,
        type: input.conversation.type,
        title: input.conversation.title,
        participants: input.conversation.participants,
      },
      agent: {
        id: input.agent.id,
        name: input.agent.name,
        role: input.agent.role,
        description: input.agent.description,
        whenToUse: input.agent.whenToUse,
        tools: input.agent.tools,
        permissions: input.agent.permissions,
        modelProvider: input.agent.modelProvider,
      },
      session: {
        id: input.session.id,
        title: input.session.title,
        status: input.session.status,
        lastHandoffId: input.session.lastHandoffId,
      },
      routeContext: {
        profile: contextProfile,
      },
      memory: {
        sessionMessages,
        handoffs,
        directConversationMessages,
      },
    },
    null,
    2,
  )
}

/**
 * Builds the child-agent session system prompt.
 * Input: agent definition. Output: schema-oriented system prompt.
 */
function buildAgentSessionSystemPrompt(agent: AgentDefinition, route?: TurnRoute): string {
  const routeInstructions = route
    ? [
        '',
        'Current turn route:',
        JSON.stringify({
          interactionMode: route.interactionMode,
          toolPolicy: route.toolPolicy,
          risk: route.risk,
          size: route.size,
          constraints: route.constraints,
          reason: route.reason,
        }),
        routeAllowsExecution(route)
          ? 'If the user asks for real execution, you may choose run_task with a self-contained task brief.'
          : 'This route forbids real execution. You MUST NOT choose run_task. Reply in chat or ask a clarification while keeping the turn read-only.',
      ]
    : []
  return [
    agent.systemPrompt,
    '',
    'You are now running inside an AgentHub persistent child-agent session.',
    'Answer lightweight chat directly using your role and the supplied session memory.',
    'Choose run_task only when the user clearly asks you to execute a real workspace task, inspect files, modify files, run commands, generate deliverables, or when the message was explicitly forced with /run.',
    'Do not claim that files were read, written, tested, or changed unless you choose run_task and a real run happens later.',
    'For unclear execution requests, ask a concise clarification question.',
    ...routeInstructions,
    'Return ONLY valid JSON. Do not wrap JSON in markdown.',
    'Required JSON shape:',
    JSON.stringify({
      kind: 'chat_reply | run_task | ask_clarification',
      finalResponse: 'reply or clarification text for chat_reply/ask_clarification',
      taskBrief: {
        agentId: agent.id,
        task: 'self-contained task for a real run',
        requiredContext: ['projectBrief', 'agentSessionHistory', 'recentMessages'],
        expectedOutput: 'clear expected output',
      },
      internalNote: 'optional short private reason',
    }),
  ].join('\n')
}

/**
 * Builds the child-agent session user prompt.
 * Input: serialized session context. Output: user prompt text.
 */
function buildAgentSessionUserPrompt(contextPackage: string): string {
  return ['Decide this child-agent session turn.', 'Context package:', contextPackage].join('\n\n')
}

/**
 * Extracts the first JSON object from a model response.
 * Input: raw model content. Output: parsed JSON payload.
 */
function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new Error('Agent session model did not return a JSON object.')
    }
    return JSON.parse(content.slice(start, end + 1))
  }
}

/**
 * Unwraps common model envelopes around an agent-session turn.
 * Input: parsed model payload. Output: raw turn payload.
 */
function unwrapTurnPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload
  }
  const record = payload as Record<string, unknown>
  return record.agentSessionTurn ?? record.turn ?? record.decision ?? record.plan ?? payload
}

/**
 * Validates and normalizes a child-agent session turn.
 * Input: parsed turn, agent, original content, and force flag. Output: coherent session turn.
 */
function validateAgentSessionTurn(
  turn: AgentSessionTurn,
  agent: AgentDefinition,
  content: string,
  forceRun: boolean,
  route?: TurnRoute,
): AgentSessionTurn {
  if (turn.kind === 'run_task') {
    if (!forceRun && !routeAllowsExecution(route)) {
      return {
        kind: 'chat_reply',
        finalResponse: `我会保持当前只读讨论模式，不会执行任务或改动文件。你可以继续描述要分析的点，或明确说“可以开始执行”后再进入执行链路。`,
        internalNote: 'Downgraded run_task because the current route forbids execution.',
      }
    }
    if (!forceRun && !hasObviousExecutionIntent(content)) {
      return {
        kind: 'chat_reply',
        finalResponse: `我先按${agent.name}的私聊会话处理这条消息。需要真实执行工作区任务时，请用 /run 明确触发。`,
        internalNote: 'Downgraded non-obvious run_task to chat_reply.',
      }
    }

    const taskText = turn.taskBrief?.task?.trim() || stripRunCommand(content) || content.trim()
    return {
      ...turn,
      taskBrief: {
        ...(turn.taskBrief ?? createDirectTaskBrief(agent.id, taskText)),
        agentId: agent.id,
        task: taskText,
        requiredContext: turn.taskBrief?.requiredContext?.length
          ? turn.taskBrief.requiredContext
          : ['projectBrief', 'agentSessionHistory', 'recentMessages'],
        expectedOutput: turn.taskBrief?.expectedOutput?.trim() || 'Return a concise direct-agent execution result.',
      },
    }
  }

  if (!turn.finalResponse?.trim()) {
    return {
      kind: 'chat_reply',
      finalResponse: `${agent.name} 已收到。你可以继续描述需求，或用 /run 让我执行一次真实任务。`,
      internalNote: 'Filled missing lightweight response.',
    }
  }

  return {
    ...turn,
    taskBrief: undefined,
  }
}

/**
 * Parses a model response into a validated child-agent session turn.
 * Input: raw response content, agent, user content, and force flag. Output: normalized turn.
 */
function parseAgentSessionTurn(
  content: string,
  agent: AgentDefinition,
  userContent: string,
  forceRun: boolean,
  route?: TurnRoute,
): AgentSessionTurn {
  const payload = unwrapTurnPayload(parseJsonObject(content))
  const turn = AgentSessionTurnSchema.parse(payload)
  return validateAgentSessionTurn(turn, agent, userContent, forceRun, route)
}

/**
 * Builds a local fallback turn when the model is unavailable or invalid.
 * Input: agent, user content, and force flag. Output: safe session turn.
 */
function buildFallbackTurn(agent: AgentDefinition, content: string, forceRun: boolean): AgentSessionTurn {
  const taskText = forceRun ? stripRunCommand(content) : content.trim()
  if (!taskText) {
    return {
      kind: 'ask_clarification',
      finalResponse: '请在 /run 后面补充要执行的具体任务。',
    }
  }
  if (forceRun || hasObviousExecutionIntent(content)) {
    return {
      kind: 'run_task',
      taskBrief: createDirectTaskBrief(agent.id, taskText),
    }
  }
  return {
    kind: 'chat_reply',
    finalResponse: `你好，我是${agent.name}。我会在这个私聊会话里保留上下文；需要真实执行任务时可以使用 /run。`,
  }
}

/**
 * Builds a model-free turn for local fast-path routes.
 * Input: agent and local route. Output: lightweight session turn.
 */
function buildLocalRouteTurn(agent: AgentDefinition, route: TurnRoute): AgentSessionTurn {
  if (route.localResponse?.trim()) {
    return {
      kind: route.interactionMode === 'awaiting_approval' ? 'ask_clarification' : 'chat_reply',
      finalResponse: route.localResponse.trim(),
      internalNote: route.reason,
    }
  }

  return {
    kind: 'chat_reply',
    finalResponse: `${agent.name} 已进入${route.interactionMode === 'planning' ? '规划' : '讨论'}模式。本轮不会执行任务或改动文件。`,
    internalNote: route.reason,
  }
}

/**
 * Returns whether a route can be answered as streamed lightweight chat.
 * Input: turn route. Output: true when no structured task decision is needed.
 */
function canStreamLightweightAgentReply(routeValue: TurnRoute): boolean {
  return !routeAllowsExecution(routeValue) && routeValue.modelProfile === 'router'
}

/**
 * Decides the next child-agent session turn with model backing and local fallback.
 * Input: session turn request. Output: planned turn with source metadata.
 */
export async function decideAgentSessionTurn(input: AgentSessionTurnInput): Promise<Omit<PlannedAgentSessionTurn, 'session' | 'handoff'>> {
  const forceRun = isForcedAgentRun(input.content)
  let routed: RoutedTurn | undefined
  if (forceRun) {
    routed = await routeTurnWithModel({
      env: input.services.env,
      content: input.content,
      workspace: input.workspace,
      conversation: input.conversation,
      agent: input.agent,
      replyTo: input.replyTo,
      codeSelection: input.codeSelection,
    })
    return {
      turn: buildFallbackTurn(input.agent, input.content, true),
      source: 'forced_run',
      route: routed.route,
    }
  }

  let contextTokenEstimate: number | undefined
  let modelStartedAt: number | undefined
  try {
    routed = await routeTurnWithModel({
      env: input.services.env,
      content: input.content,
      workspace: input.workspace,
      conversation: input.conversation,
      agent: input.agent,
      replyTo: input.replyTo,
      codeSelection: input.codeSelection,
    })

    if (!routed.route.needsModel && routed.route.localResponse) {
      return {
        turn: buildLocalRouteTurn(input.agent, routed.route),
        source: 'local_rule',
        route: routed.route,
        routeProvider: routed.provider,
        routeModel: routed.model,
        routeElapsedMs: routed.elapsedMs,
        routeError: routed.error,
      }
    }

    if (canStreamLightweightAgentReply(routed.route)) {
      return {
        turn: {
          kind: routed.route.interactionMode === 'awaiting_approval' ? 'ask_clarification' : 'chat_reply',
          internalNote: 'Lightweight agent reply will be generated as final streamed text.',
        },
        source: 'model',
        route: routed.route,
        routeProvider: routed.provider,
        routeModel: routed.model,
        routeElapsedMs: routed.elapsedMs,
        routeError: routed.error,
      }
    }

    const contextPackage = buildAgentSessionContextPackage({
      state: input.state,
      workspace: input.workspace,
      conversation: input.conversation,
      agent: input.agent,
      session: input.session,
      userMessage: input.content,
      replyTo: input.replyTo,
      codeSelection: input.codeSelection,
      contextProfile: routed.route.contextProfile,
    })
    contextTokenEstimate = estimateTokenCount(contextPackage)
    modelStartedAt = Date.now()
    const modelSelection = selectModelForRoute(input.services.env, routed.route)
    const response = await generateAgentModelResponse({
      env: input.services.env,
      runtime: input.services.runtime,
      toolGateway: input.services.toolGateway,
      workspace: input.workspace,
      conversation: input.conversation,
      agent: input.agent,
      request: {
        systemPrompt: buildAgentSessionSystemPrompt(input.agent, routed.route),
        userPrompt: buildAgentSessionUserPrompt(contextPackage),
        model: resolveAgentConfiguredModel(input.agent, modelSelection.model),
        thinking: modelSelection.thinking,
        timeoutMs:
          routed.route.modelProfile === 'router'
            ? input.services.env.AGENTHUB_ROUTER_TIMEOUT_MS
            : Math.min(input.services.env.AGENTHUB_ORCHESTRATOR_TIMEOUT_MS, 30_000),
        maxTokens:
          routed.route.modelProfile === 'router'
            ? Math.max(input.services.env.AGENTHUB_ROUTER_MAX_TOKENS, 900)
            : Math.min(input.services.env.AGENTHUB_ORCHESTRATOR_MAX_TOKENS, 1_200),
        temperature: 0.2,
        responseFormat: 'json_object',
      },
    })

    return {
      turn: parseAgentSessionTurn(response.content, input.agent, input.content, false, routed.route),
      source: 'model',
      provider: response.provider,
      model: response.model,
      contextTokenEstimate,
      modelElapsedMs: Date.now() - modelStartedAt,
      route: routed.route,
      routeProvider: routed.provider,
      routeModel: routed.model,
      routeElapsedMs: routed.elapsedMs,
      routeError: routed.error,
    }
  } catch (error) {
    return {
      turn:
        routed?.route && !routeAllowsExecution(routed.route)
          ? buildLocalRouteTurn(input.agent, routed.route)
          : buildFallbackTurn(input.agent, input.content, false),
      source: 'local_fallback',
      error: error instanceof Error ? error.message : String(error),
      contextTokenEstimate,
      modelElapsedMs: modelStartedAt ? Date.now() - modelStartedAt : undefined,
      route: routed?.route,
      routeProvider: routed?.provider,
      routeModel: routed?.model,
      routeElapsedMs: routed?.elapsedMs,
      routeError: routed?.error,
    }
  }
}

/**
 * Creates a task handoff and stores it in the target agent session.
 * Input: store, workspace, conversation, session, agent, task brief, and source. Output: persisted handoff.
 */
export async function createTaskHandoff(input: TaskHandoffInput): Promise<TaskHandoff> {
  const now = isoNow()
  const handoff: TaskHandoff = {
    id: `handoff-${randomUUID()}`,
    workspaceId: input.workspace.id,
    conversationId: input.conversation.id,
    sessionId: input.session.id,
    agentId: input.agent.id,
    source: input.source,
    task: input.brief.task,
    requiredContext: input.brief.requiredContext,
    expectedOutput: input.brief.expectedOutput,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  const message = createAgentSessionMessage({
    workspaceId: input.workspace.id,
    sessionId: input.session.id,
    agentId: input.agent.id,
    senderType: 'system',
    senderId: input.source === 'main' ? 'orchestrator' : 'user',
    kind: 'task_handoff',
    content: [
      `Task handoff from ${input.source}.`,
      `Task: ${input.brief.task}`,
      `Expected output: ${input.brief.expectedOutput}`,
      `Required context: ${input.brief.requiredContext.join(', ') || 'none'}`,
    ].join('\n'),
    metadata: {
      handoffId: handoff.id,
      sourceConversationId: input.conversation.id,
    },
  })

  await input.store.update(state => {
    state.taskHandoffs.push(handoff)
    state.agentSessionMessages.push(message)
    const session = requiredById(state.agentSessions, input.session.id, 'AgentSession')
    session.lastHandoffId = handoff.id
    session.updatedAt = now
  })

  return handoff
}

/**
 * Marks a task handoff as running before invoking a real agent adapter.
 * Input: store and handoff id. Output: promise resolved after persistence.
 */
export async function markTaskHandoffRunning(store: StateStore, handoffId: string): Promise<void> {
  const now = isoNow()
  await store.update(state => {
    const handoff = requiredById(state.taskHandoffs, handoffId, 'TaskHandoff')
    handoff.status = 'running'
    handoff.updatedAt = now
  })
}

/**
 * Completes a task handoff and appends the result into the agent session.
 * Input: store, handoff id, run id, status, and summary. Output: promise resolved after persistence.
 */
export async function completeTaskHandoff(
  store: StateStore,
  handoffId: string,
  runId: string,
  status: AgentRunStatus,
  summary: string,
): Promise<void> {
  const now = isoNow()
  await store.update(state => {
    const handoff = requiredById(state.taskHandoffs, handoffId, 'TaskHandoff')
    handoff.status = status === 'success' ? 'completed' : status === 'partial' ? 'partial' : 'failed'
    handoff.resultRunId = runId
    handoff.resultSummary = compactText(summary, 1200)
    handoff.updatedAt = now
    const message = createAgentSessionMessage({
      workspaceId: handoff.workspaceId,
      sessionId: handoff.sessionId,
      agentId: handoff.agentId,
      senderType: 'agent',
      senderId: handoff.agentId,
      kind: 'task_result',
      content: summary,
      metadata: {
        handoffId,
        runId,
        status,
      },
    })
    state.agentSessionMessages.push(message)
    const session = requiredById(state.agentSessions, handoff.sessionId, 'AgentSession')
    session.updatedAt = now
  })
}

/**
 * Persists a lightweight direct-agent reply into both conversation and session history.
 * Input: store, workspace, conversation, agent, session, turn, and source metadata. Output: reply message.
 */
async function persistLightweightAgentReply(
  store: StateStore,
  workspace: Workspace,
  conversation: Conversation,
  agent: AgentDefinition,
  session: AgentSession,
  turn: AgentSessionTurn,
  metadata: Record<string, unknown>,
): Promise<Message> {
  const response = turn.finalResponse?.trim() || `${agent.name} 已收到。`
  const conversationMessage = createConversationMessage({
    workspaceId: workspace.id,
    conversationId: conversation.id,
    senderType: 'agent',
    senderId: agent.id,
    content: response,
    artifacts: [],
  })
  const sessionMessage = createAgentSessionMessage({
    workspaceId: workspace.id,
    sessionId: session.id,
    agentId: agent.id,
    senderType: 'agent',
    senderId: agent.id,
    kind: turn.kind === 'ask_clarification' ? 'agent_reply' : 'agent_reply',
    content: response,
    metadata,
  })

  await store.update(state => {
    state.messages.push(conversationMessage)
    state.agentSessionMessages.push(sessionMessage)
    const targetConversation = requiredById(state.conversations, conversation.id, 'Conversation')
    targetConversation.updatedAt = conversationMessage.createdAt
    const targetWorkspace = requiredById(state.workspaces, workspace.id, 'Workspace')
    targetWorkspace.updatedAt = conversationMessage.createdAt
    const targetSession = requiredById(state.agentSessions, session.id, 'AgentSession')
    targetSession.updatedAt = conversationMessage.createdAt
  })

  return conversationMessage
}

/**
 * Runs one private child-agent session turn without invoking heavy adapters unless requested.
 * Input: direct-agent session turn request. Output: planned turn plus optional handoff.
 */
export async function runAgentSessionTurn(input: AgentSessionTurnInput): Promise<PlannedAgentSessionTurn> {
  const userContent = isForcedAgentRun(input.content) ? stripRunCommand(input.content) : input.content.trim()
  await appendAgentSessionMessage(input.services.store, {
    workspaceId: input.workspace.id,
    sessionId: input.session.id,
    agentId: input.agent.id,
    senderType: 'user' as SenderType,
    senderId: 'user',
    kind: 'user_message',
    content: userContent || input.content.trim(),
    metadata: {
      conversationId: input.conversation.id,
      forcedRun: isForcedAgentRun(input.content),
      replyTo: input.replyTo,
    },
  })

  const planned = await decideAgentSessionTurn({
    ...input,
    content: input.content,
  })

  if (planned.turn.kind === 'run_task') {
    const brief = planned.turn.taskBrief ?? createDirectTaskBrief(input.agent.id, userContent || input.content.trim())
    const handoff = await createTaskHandoff({
      store: input.services.store,
      workspace: input.workspace,
      conversation: input.conversation,
      session: input.session,
      agent: input.agent,
      brief,
      source: 'user_direct',
    })
    return {
      ...planned,
      session: input.session,
      turn: {
        ...planned.turn,
        taskBrief: brief,
      },
      handoff,
    }
  }

  const metadata = {
    source: planned.source,
    provider: planned.provider,
    model: planned.model,
    error: planned.error,
    route: planned.route
      ? {
          interactionMode: planned.route.interactionMode,
          toolPolicy: planned.route.toolPolicy,
          modelProfile: planned.route.modelProfile,
          contextProfile: planned.route.contextProfile,
          source: planned.route.source,
          reason: planned.route.reason,
          confidence: planned.route.confidence,
          constraints: planned.route.constraints,
        }
      : undefined,
    routeProvider: planned.routeProvider,
    routeModel: planned.routeModel,
    routeError: planned.routeError,
  }

  if (input.services.streamAgentReply) {
    await input.services.streamAgentReply({
      workspace: input.workspace,
      conversation: input.conversation,
      agent: input.agent,
      session: input.session,
      turn: planned.turn,
      userContent,
      replyTo: input.replyTo,
      codeSelection: input.codeSelection,
      route: planned.route,
      metadata,
    })
  } else {
    await persistLightweightAgentReply(
      input.services.store,
      input.workspace,
      input.conversation,
      input.agent,
      input.session,
      planned.turn,
      metadata,
    )
  }

  return {
    ...planned,
    session: input.session,
  }
}
