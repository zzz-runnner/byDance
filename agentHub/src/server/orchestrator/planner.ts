import type { AgentDefinition, AppState, Conversation, MainBrainTurn, ReplyReference, TurnFinalizationMode, Workspace } from '@shared/contracts'
import { MainBrainTurnSchema } from '@shared/contracts'
import type { ServerEnv } from '../env'
import { createModelGateway } from '../model-gateway'
import { buildPlannerContextPackage } from './context'
import { decideRouting, type RoutingInput } from './routing'
import { routeAllowsExecution, selectModelForRoute, type TurnRoute } from './turn-router'

export type RoutingDecisionSource = 'model' | 'explicit_rule' | 'rule_fallback'

export type PlannedRoutingDecision = {
  decision: MainBrainTurn
  source: RoutingDecisionSource
  error?: string
  provider?: string
  model?: string
  contextTokenEstimate?: number
  modelElapsedMs?: number
}

type PlannerInput = RoutingInput & {
  env: ServerEnv
  state: AppState
  workspace: Workspace
  route?: TurnRoute
}

/**
 * Builds the main-brain system prompt for schema-bound direct answers and dispatches.
 * Input: none. Output: system prompt text.
 */
function buildPlannerSystemPrompt(route?: TurnRoute): string {
  const routeInstructions = route
    ? [
        '',
        'Current turn route:',
        JSON.stringify({
          interactionMode: route.interactionMode,
          toolPolicy: route.toolPolicy,
          risk: route.risk,
          size: route.size,
          taskStage: route.taskStage,
          executionReadiness: route.executionReadiness,
          needsUserConfirmation: route.needsUserConfirmation,
          constraints: route.constraints,
          reason: route.reason,
        }),
        routeAllowsExecution(route)
          ? 'This route may dispatch agents when execution or deeper role work is truly needed.'
          : 'This route forbids code-writing or shell execution. You may dispatch product-manager for read-only requirement clarification, but MUST NOT dispatch engineer for implementation.',
      ]
    : []
  return [
    'You are AgentHub Main Brain, a model-backed coordinator for a local multi-agent dev workspace.',
    'You are not a pure router. Answer the user directly when you can answer from the supplied workspace state, conversation state, or common reasoning.',
    'Dispatch child agents only when the task benefits from real tool use, implementation, verification, or deeper role-specific work.',
    'The availableAgents payload includes routingProfile metadata. Treat responsibilities, goodAt, preferredStages, exampleRequests, and speakerMode as your primary routing signals.',
    'In group conversations, if one available child agent clearly owns the question by domain responsibility, prefer that child agent as the only visible speaker instead of answering as orchestrator.',
    'If replyContext points to one child agent and the new user message does not clearly switch topics, prefer that same child agent as the visible speaker.',
    'When taskStage is requirements_intake, planning, or awaiting_confirmation, prefer a direct_speaker child agent whose preferredStages include that stage and who does not need file writes for a first response.',
    'Do not let a file-writing implementation agent take first-speaker ownership of a requirement-intake or planning turn unless the user explicitly selected that agent by @mention or direct chat.',
    'When taskStage is review, prefer the best review-focused direct_speaker child agent instead of orchestrator whenever one agent can give the verdict directly.',
    'For vague product requests such as "build an app", "make a mini program", "create a platform", first run requirement intake or ask clarification. Do not start engineering in the same turn.',
    'If taskStage is requirements_intake, ask concise clarification questions or dispatch only product-manager for requirement clarification.',
    'If taskStage is planning or awaiting_confirmation, do not dispatch engineer. Ask the user to confirm the plan before implementation.',
    'Dispatch engineer only when taskStage is execution and executionReadiness is user_confirmed, or when /run was used.',
    'For confirmed implementation tasks, usually dispatch engineer, then reviewer in serial order. Include product-manager first only when scope still needs a short structured task package.',
    'For review-only tasks, usually dispatch reviewer only.',
    'Choose exactly one visible speaker for the turn. If a child agent should be the only visible speaker, set speakerAgentId to that agent and finalizationMode to speaker_direct. If multiple child agents will run and the main brain should show the final answer, set speakerAgentId to orchestrator and finalizationMode to main_synthesis.',
    'Do not let orchestrator answer specialist product, engineering, or review questions in a group room when one child agent can answer directly.',
    'Never expose both a child agent and the orchestrator as visible speakers in the same turn.',
    'For normal chat, status questions, workspace-member questions, explanations, or clarification needs, answer directly or ask a clarification.',
    'Never fabricate child-agent results. If you dispatch agents, only describe what you are launching.',
    'Use only agent ids from availableAgents when dispatching.',
    'Fresh child agents do not see this whole conversation. Every dispatch task must be self-contained with purpose, known context, scope, and expected output.',
    'Read-only or research tasks may run in parallel. File-writing or implementation tasks should usually run serially.',
    'Return ONLY valid JSON. Do not wrap JSON in markdown. Do not include commentary outside JSON.',
    'Required JSON shape:',
    JSON.stringify({
      kind: 'direct_answer | dispatch_agents | ask_clarification',
      finalResponse: 'user-facing answer, clarification question, or short dispatch notice',
      execution: 'serial | parallel',
      targetAgents: ['agent-id'],
      speakerAgentId: 'orchestrator | agent-id',
      finalizationMode: 'speaker_direct | main_synthesis | local_summary | none',
      dispatches: [
        {
          agentId: 'agent-id',
          task: 'self-contained task briefing for that agent',
          requiredContext: ['projectBrief', 'recentMessages'],
          expectedOutput: 'clear expected output',
        },
      ],
      internalNote: 'optional short private reason for logs',
    }),
    'For direct_answer and ask_clarification, dispatches must be [] and targetAgents should be [].',
    'For dispatch_agents, dispatches must contain at least one task and targetAgents must match dispatch agent ids.',
    ...routeInstructions,
  ].join('\n')
}

/**
 * Builds the main-brain user prompt from the planning context.
 * Input: serialized context package. Output: user prompt text.
 */
function buildPlannerUserPrompt(contextPackage: string): string {
  return ['Decide the next AgentHub main-brain turn for this context.', 'Context package:', contextPackage].join('\n\n')
}

/**
 * Estimates token count using the local char-to-token heuristic.
 * Input: serialized context text. Output: approximate token count.
 */
function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Extracts the first JSON object from a model response.
 * Input: raw model content. Output: parsed unknown JSON payload.
 */
function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new Error('Orchestrator model did not return a JSON object.')
    }
    return JSON.parse(content.slice(start, end + 1))
  }
}

/**
 * Unwraps common decision envelopes from model output.
 * Input: parsed model payload. Output: raw routing decision payload.
 */
function unwrapDecisionPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload
  }
  const record = payload as Record<string, unknown>
  return record.mainBrainTurn ?? record.turn ?? record.routingDecision ?? record.decision ?? record.plan ?? payload
}

/**
 * Validates that a main-brain turn references only registered agents and has a coherent shape.
 * Input: main-brain turn and available agent list. Output: validated main-brain turn.
 */
function validateKnownAgents(decision: MainBrainTurn, agents: AgentDefinition[], route?: TurnRoute): MainBrainTurn {
  const agentIds = new Set(agents.map(agent => agent.id))
  const referencedAgents = new Set([...decision.targetAgents, ...decision.dispatches.map(brief => brief.agentId)])
  for (const agentId of referencedAgents) {
    if (!agentIds.has(agentId)) {
      throw new Error(`Main brain referenced unknown agent: ${agentId}`)
    }
  }
  if (decision.kind === 'dispatch_agents' && decision.dispatches.length === 0) {
    throw new Error('Main brain returned dispatch_agents without dispatches.')
  }
  if (decision.kind !== 'dispatch_agents' && decision.dispatches.length > 0) {
    throw new Error('Main brain returned direct turn with dispatches.')
  }
  if (decision.kind !== 'dispatch_agents' && !decision.finalResponse?.trim()) {
    throw new Error('Main brain returned a direct turn without finalResponse.')
  }
  const targetAgents = decision.kind === 'dispatch_agents'
    ? decision.dispatches.map(brief => brief.agentId)
    : []
  const providedFinalization = decision.finalizationMode && decision.finalizationMode !== 'none'
    ? (decision.finalizationMode as TurnFinalizationMode)
    : undefined
  const singleDispatchAgentId = targetAgents[0]
  const shouldUseMainSpeaker =
    decision.kind !== 'dispatch_agents' ||
    targetAgents.length > 1 ||
    (providedFinalization !== undefined && providedFinalization !== 'speaker_direct') ||
    decision.speakerAgentId === 'orchestrator'
  const speakerAgentId = shouldUseMainSpeaker
    ? 'orchestrator'
    : decision.speakerAgentId && targetAgents.includes(decision.speakerAgentId)
      ? decision.speakerAgentId
      : singleDispatchAgentId ?? 'orchestrator'
  const finalizationMode: TurnFinalizationMode = decision.kind !== 'dispatch_agents'
    ? providedFinalization ?? 'speaker_direct'
    : speakerAgentId === 'orchestrator'
      ? providedFinalization && providedFinalization !== 'speaker_direct'
        ? providedFinalization
        : 'main_synthesis'
      : 'speaker_direct'
  return {
    ...decision,
    targetAgents,
    speakerAgentId,
    finalizationMode,
    execution: decision.kind === 'dispatch_agents' ? decision.execution : 'serial',
  }
}

/**
 * Parses and validates a model response into a MainBrainTurn.
 * Input: model content and available agents. Output: schema-validated main-brain turn.
 */
function parseRoutingDecision(content: string, agents: AgentDefinition[], route?: TurnRoute): MainBrainTurn {
  const payload = unwrapDecisionPayload(parseJsonObject(content))
  const decision = MainBrainTurnSchema.parse(payload)
  return validateKnownAgents(decision, agents, route)
}

/**
 * Returns true when explicit user routing should bypass the model planner.
 * Input: routing request. Output: whether deterministic routing should run immediately.
 */
function shouldBypassPlanner(input: PlannerInput): boolean {
  return Boolean(input.targetAgentId) || input.conversation.type === 'direct'
}

/**
 * Plans routing through the configured Orchestrator model with deterministic fallback.
 * Input: planner request. Output: routing decision plus routing source metadata.
 */
export async function decideRoutingWithPlanner(input: PlannerInput): Promise<PlannedRoutingDecision> {
  if (shouldBypassPlanner(input)) {
    const decision = decideRouting(input)
    return {
      decision:
        decision.kind === 'dispatch_agents' && !routeAllowsExecution(input.route)
          ? {
              kind: 'direct_answer',
              finalResponse:
                '我会保持只读讨论模式，不会派发子 Agent 执行任务。你可以继续让我分析方案；需要执行时请明确说可以开始执行。',
              execution: 'serial',
              dispatches: [],
              targetAgents: [],
              speakerAgentId: 'orchestrator',
              finalizationMode: 'speaker_direct',
            }
          : decision,
      source: 'explicit_rule',
    }
  }

  let contextTokenEstimate: number | undefined
  let modelStartedAt: number | undefined
  try {
    const gateway = createModelGateway(input.env)
    const contextPackage = buildPlannerContextPackage({
      state: input.state,
      workspace: input.workspace,
      conversation: input.conversation,
      userMessage: input.content,
      replyTo: input.replyTo,
      agents: input.agents,
    })
    contextTokenEstimate = estimateTokenCount(contextPackage)
    modelStartedAt = Date.now()
    const modelSelection = selectModelForRoute(input.env, input.route)
    const response = await gateway.generate({
      systemPrompt: buildPlannerSystemPrompt(input.route),
      userPrompt: buildPlannerUserPrompt(contextPackage),
      model: modelSelection.model,
      thinking: modelSelection.thinking,
      timeoutMs:
        input.route?.modelProfile === 'router'
          ? input.env.AGENTHUB_ROUTER_TIMEOUT_MS
          : input.env.AGENTHUB_ORCHESTRATOR_TIMEOUT_MS,
      maxTokens:
        input.route?.modelProfile === 'router'
          ? Math.max(input.env.AGENTHUB_ROUTER_MAX_TOKENS, 900)
          : input.env.AGENTHUB_ORCHESTRATOR_MAX_TOKENS,
      temperature: 0.1,
      responseFormat: 'json_object',
    })

    return {
      decision: parseRoutingDecision(response.content, input.agents, input.route),
      source: 'model',
      provider: response.provider,
      model: response.model,
      contextTokenEstimate,
      modelElapsedMs: Date.now() - modelStartedAt,
    }
  } catch (error) {
    const fallbackDecision = decideRouting(input)
    return {
      decision:
        fallbackDecision.kind === 'dispatch_agents' && !routeAllowsExecution(input.route)
          ? {
              kind: 'direct_answer',
              finalResponse:
                '我会保持只读讨论模式，不会派发子 Agent 执行任务。你可以继续让我分析方案；需要执行时请明确说可以开始执行。',
              execution: 'serial',
              dispatches: [],
              targetAgents: [],
              speakerAgentId: 'orchestrator',
              finalizationMode: 'speaker_direct',
            }
          : fallbackDecision,
      source: 'rule_fallback',
      error: error instanceof Error ? error.message : String(error),
      contextTokenEstimate,
      modelElapsedMs: modelStartedAt ? Date.now() - modelStartedAt : undefined,
    }
  }
}
