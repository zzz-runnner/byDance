import { z } from 'zod'
import { ExecutionReadinessSchema, WorkflowTaskStageSchema } from '@shared/contracts'
import type { AgentDefinition, Conversation, ExecutionReadiness, ReplyReference, WorkflowTaskStage, Workspace } from '@shared/contracts'
import type { ServerEnv } from '../env'
import { createModelGateway } from '../model-gateway'
import { buildReplyContextPayload, resolveReplyTargetAgentId } from './reply-context'

export const InteractionModeSchema = z.enum(['chat', 'discussion', 'planning', 'awaiting_approval', 'execution'])
export type InteractionMode = z.infer<typeof InteractionModeSchema>

export const ToolPolicySchema = z.enum(['no_tools', 'read_only', 'ask_before_write', 'auto_safe', 'allow_edits'])
export type ToolPolicy = z.infer<typeof ToolPolicySchema>

export const ContextProfileSchema = z.enum(['minimal', 'short', 'task', 'full_review'])
export type ContextProfile = z.infer<typeof ContextProfileSchema>

export const ModelProfileSchema = z.enum(['none', 'router', 'orchestrator', 'thinking'])
export type ModelProfile = z.infer<typeof ModelProfileSchema>

export const ConstraintEffectSchema = z.enum([
  'forbid_code_write',
  'forbid_shell_write',
  'forbid_git_mutation',
  'discussion_only',
  'require_approval_before_execution',
])
export type ConstraintEffect = z.infer<typeof ConstraintEffectSchema>

export const TurnConstraintSchema = z.object({
  source: z.enum(['static_rule', 'current_user_message', 'slash_command', 'model_signal']),
  quote: z.string().optional(),
  scope: z.enum(['turn', 'session_until_cancelled']).default('turn'),
  strength: z.enum(['hard', 'soft']),
  effect: ConstraintEffectSchema,
})
export type TurnConstraint = z.infer<typeof TurnConstraintSchema>

export const TurnRouteSchema = z.object({
  interactionMode: InteractionModeSchema,
  toolPolicy: ToolPolicySchema,
  size: z.enum(['trivial', 'small', 'medium', 'large']),
  risk: z.enum(['low', 'medium', 'high']),
  needsModel: z.boolean(),
  needsThinking: z.boolean(),
  needsCodebaseContext: z.boolean(),
  contextProfile: ContextProfileSchema,
  modelProfile: ModelProfileSchema,
  taskStage: WorkflowTaskStageSchema.default('chat'),
  executionReadiness: ExecutionReadinessSchema.default('not_a_task'),
  needsUserConfirmation: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  source: z.enum(['local_rule', 'slash_command', 'model_router', 'fallback']),
  localResponse: z.string().optional(),
  constraints: z.array(TurnConstraintSchema).default([]),
})
export type TurnRoute = z.infer<typeof TurnRouteSchema>

export type RoutedTurn = {
  route: TurnRoute
  provider?: string
  model?: string
  elapsedMs?: number
  error?: string
}

type LocalRouteInput = {
  content: string
  conversation?: Conversation
  workspace?: Workspace
  agent?: AgentDefinition
  replyTo?: ReplyReference
}

type ModelRouteInput = LocalRouteInput & {
  env: ServerEnv
}

const RUN_COMMAND_PATTERN = /^\/run(?:\s+|$)/i
const GREETING_PATTERN = /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|早上好|晚上好|下午好)[!！。.\s]*$/i
const THANKS_PATTERN = /^(谢谢|多谢|谢了|感谢|thanks|thank you|thx)[!！。.\s]*$/i
const HELP_PATTERN = /^(help|\/help|帮助|怎么用|使用帮助)[!！。.\s]*$/i
const IDENTITY_PATTERN = /^(你是谁|你是什么|介绍一下你自己|who are you|what are you)[?？!！。.\s]*$/i
const CAPABILITY_PATTERN = /^(你能做什么|你可以做什么|你会什么|能帮我什么|what can you do)[?？!！。.\s]*$/i
const DISCUSSION_ONLY_PATTERN =
  /不要改代码|别改代码|不要动代码|别动代码|不要改动任何代码|先别改|先不改|只分析|只讨论|只读|先聊聊|先讨论|我们聊聊|先确认|不执行|别执行|不要执行/i
const PLANNING_PATTERN = /方案|计划|规划|设计一下|怎么改|怎么做|架构|实现思路|实施计划|plan|approach|architecture/i
const SCOPE_REFINEMENT_PATTERN =
  /只保留|只做|先做一个简单版|简化一点|跟之前一样|同用之前的技术栈|不用响应式|不需要响应式|去掉|去掉.*模块|keep only|just keep|same stack|no responsive|non-responsive|simplify the scope|simple demo/i
const EXECUTION_APPROVAL_PATTERN =
  /开始实现|开始开发|开始执行|按.*(方案|计划|范围).*做|按.*实现|可以执行|可以开始|确认.*(执行|实现|开发)|直接实现|直接开发|不用再问|进入开发|go ahead|start implementation|start coding/i
const EXECUTION_PATTERN =
  /\/run|修改|修复|删除|提交|推送|部署|安装|运行|执行|重构|fix|delete|commit|push|deploy|install|run|execute|refactor/i
const HIGH_RISK_PATTERN = /删除|清空|覆盖|提交|推送|部署|安装|rm\s+-rf|git\s+push|git\s+reset|deploy|delete|remove|overwrite|commit|push|install/i

/**
 * Chooses a default execution-readiness value for a task stage.
 * Input: task stage. Output: matching readiness value.
 */
function defaultExecutionReadiness(taskStage: WorkflowTaskStage): ExecutionReadiness {
  if (taskStage === 'execution') {
    return 'user_confirmed'
  }
  if (taskStage === 'awaiting_confirmation' || taskStage === 'planning') {
    return 'plan_ready'
  }
  if (taskStage === 'requirements_intake') {
    return 'unclear_requirements'
  }
  return 'not_a_task'
}

/**
 * Returns a compact role label for local direct replies.
 * Input: optional agent definition. Output: user-facing label.
 */
function actorLabel(agent?: AgentDefinition): string {
  return agent?.name ?? 'AgentHub 主脑'
}

/**
 * Removes trailing punctuation before embedding metadata in local templates.
 * Input: raw metadata text. Output: compact text without duplicate sentence punctuation.
 */
function trimSentence(text: string): string {
  return text.trim().replace(/[。.!！\s]+$/u, '')
}

/**
 * Builds a local greeting reply from static role metadata.
 * Input: optional agent definition. Output: direct reply.
 */
function buildGreeting(agent?: AgentDefinition): string {
  if (!agent) {
    return '你好，我是 AgentHub 主脑，可以帮你讨论方案、拆分任务、调度子 Agent，或在你明确要求时执行工作区任务。'
  }
  const role = trimSentence(agent.role || agent.description || '处理当前工作区里的专业任务')
  return `你好，我是 ${agent.name}。我的职责是：${role}。需要真实执行任务时，请用 /run 明确触发。`
}

/**
 * Builds a local capability reply from agent metadata.
 * Input: optional agent definition. Output: direct reply.
 */
function buildCapability(agent?: AgentDefinition): string {
  if (!agent) {
    return '我可以处理普通讨论、需求澄清、任务拆解、子 Agent 调度和结果汇总。涉及改文件、运行命令或推送部署时，会走执行链路。'
  }
  const tools = agent.tools.length ? `可用能力：${agent.tools.join('、')}。` : ''
  return `我是 ${agent.name}。${trimSentence(agent.description || agent.role)}。${tools ? `\n${tools}` : ''}\n普通讨论会保持轻量回复；真实执行请使用 /run。`
}

/**
 * Creates a route object with conservative defaults.
 * Input: route overrides. Output: complete route.
 */
function route(overrides: Partial<TurnRoute> & Pick<TurnRoute, 'interactionMode' | 'toolPolicy' | 'reason' | 'source'>): TurnRoute {
  const taskStage = overrides.taskStage ?? (overrides.interactionMode === 'execution' ? 'execution' : overrides.interactionMode === 'planning' ? 'planning' : 'chat')
  return TurnRouteSchema.parse({
    size: 'small',
    risk: 'low',
    needsModel: true,
    needsThinking: false,
    needsCodebaseContext: false,
    contextProfile: 'short',
    modelProfile: 'router',
    taskStage,
    executionReadiness: overrides.executionReadiness ?? defaultExecutionReadiness(taskStage),
    needsUserConfirmation: overrides.needsUserConfirmation ?? ['requirements_intake', 'planning', 'awaiting_confirmation'].includes(taskStage),
    confidence: 0.9,
    constraints: [],
    ...overrides,
  })
}

/**
 * Extracts hard constraints from explicit user wording.
 * Input: raw user message. Output: constraints that must be enforced.
 */
function discussionConstraints(content: string): TurnConstraint[] {
  const match = content.match(DISCUSSION_ONLY_PATTERN)
  if (!match) {
    return []
  }
  return [
    {
      source: 'current_user_message',
      quote: match[0],
      scope: 'turn',
      strength: 'hard',
      effect: 'discussion_only',
    },
    {
      source: 'current_user_message',
      quote: match[0],
      scope: 'turn',
      strength: 'hard',
      effect: 'forbid_code_write',
    },
    {
      source: 'current_user_message',
      quote: match[0],
      scope: 'turn',
      strength: 'hard',
      effect: 'forbid_shell_write',
    },
    {
      source: 'current_user_message',
      quote: match[0],
      scope: 'turn',
      strength: 'hard',
      effect: 'forbid_git_mutation',
    },
  ]
}

/**
 * Runs deterministic local routing for high-confidence inputs.
 * Input: user message plus optional workspace/agent context. Output: route when local rules are enough.
 */
export function routeTurnLocally(input: LocalRouteInput): TurnRoute | undefined {
  const content = input.content.trim()
  if (!content) {
    return route({
      interactionMode: 'chat',
      toolPolicy: 'no_tools',
      source: 'local_rule',
      reason: 'Empty or whitespace-only input.',
      needsModel: false,
      modelProfile: 'none',
      contextProfile: 'minimal',
      localResponse: '请补充你想讨论或执行的内容。',
    })
  }

  if (RUN_COMMAND_PATTERN.test(content)) {
    const taskText = content.replace(RUN_COMMAND_PATTERN, '').trim()
    return route({
      interactionMode: 'execution',
      toolPolicy: HIGH_RISK_PATTERN.test(taskText) ? 'ask_before_write' : 'auto_safe',
      source: 'slash_command',
      reason: '/run explicitly requests a real execution turn.',
      size: taskText.length > 120 ? 'medium' : 'small',
      risk: HIGH_RISK_PATTERN.test(taskText) ? 'high' : 'medium',
      needsModel: false,
      needsCodebaseContext: true,
      contextProfile: 'task',
      modelProfile: 'none',
      taskStage: 'execution',
      executionReadiness: 'user_confirmed',
      needsUserConfirmation: false,
      confidence: 1,
      constraints: [
        {
          source: 'slash_command',
          quote: '/run',
          scope: 'turn',
          strength: 'hard',
          effect: 'require_approval_before_execution',
        },
      ],
    })
  }

  if (GREETING_PATTERN.test(content)) {
    return route({
      interactionMode: 'chat',
      toolPolicy: 'no_tools',
      source: 'local_rule',
      reason: 'Simple greeting.',
      size: 'trivial',
      needsModel: true,
      modelProfile: 'router',
      contextProfile: 'minimal',
    })
  }

  if (THANKS_PATTERN.test(content)) {
    return route({
      interactionMode: 'chat',
      toolPolicy: 'no_tools',
      source: 'local_rule',
      reason: 'Simple thanks.',
      size: 'trivial',
      needsModel: true,
      modelProfile: 'router',
      contextProfile: 'minimal',
    })
  }

  if (HELP_PATTERN.test(content)) {
    return route({
      interactionMode: 'chat',
      toolPolicy: 'no_tools',
      source: 'local_rule',
      reason: 'Help request.',
      size: 'trivial',
      needsModel: false,
      modelProfile: 'none',
      contextProfile: 'minimal',
      localResponse: '可以直接聊天讨论；需要指定子 Agent 时用 @agent；需要真实执行时在子 Agent 私聊里使用 /run <任务>。',
    })
  }

  if (IDENTITY_PATTERN.test(content)) {
    return route({
      interactionMode: 'chat',
      toolPolicy: 'no_tools',
      source: 'local_rule',
      reason: 'Identity question.',
      size: 'trivial',
      needsModel: true,
      modelProfile: 'router',
      contextProfile: 'minimal',
    })
  }

  if (CAPABILITY_PATTERN.test(content)) {
    return route({
      interactionMode: 'chat',
      toolPolicy: 'no_tools',
      source: 'local_rule',
      reason: 'Capability question.',
      size: 'trivial',
      needsModel: true,
      modelProfile: 'router',
      contextProfile: 'minimal',
    })
  }

  const constraints = discussionConstraints(content)
  if (constraints.length) {
    const remainingText = content.replace(DISCUSSION_ONLY_PATTERN, '').replace(/[，,。.!！?？\s]/g, '')
    const onlyConstraint = remainingText.length === 0
    return route({
      interactionMode: PLANNING_PATTERN.test(content) ? 'planning' : 'discussion',
      toolPolicy: 'read_only',
      source: 'local_rule',
      reason: 'User explicitly constrained the turn to discussion/read-only work.',
      size: content.length > 160 ? 'medium' : 'small',
      risk: 'low',
      needsModel: !onlyConstraint,
      needsCodebaseContext: /代码|项目|架构|文件|链路|实现|code|repo|architecture/i.test(content),
      contextProfile: /代码|项目|架构|文件|链路|实现|code|repo|architecture/i.test(content) ? 'short' : 'minimal',
      modelProfile: onlyConstraint ? 'none' : 'router',
      taskStage: PLANNING_PATTERN.test(content) ? 'planning' : 'requirements_intake',
      executionReadiness: onlyConstraint ? 'not_a_task' : 'unclear_requirements',
      needsUserConfirmation: !onlyConstraint,
      confidence: 0.98,
      constraints,
      localResponse: onlyConstraint ? '可以，我们先保持讨论模式，不改代码、不执行命令。' : undefined,
    })
  }

  if (SCOPE_REFINEMENT_PATTERN.test(content)) {
    return route({
      interactionMode: 'planning',
      toolPolicy: 'read_only',
      source: 'local_rule',
      reason: 'User is refining scope or simplifying the plan before approving implementation.',
      size: content.length > 180 ? 'medium' : 'small',
      risk: 'low',
      needsModel: true,
      needsCodebaseContext: false,
      contextProfile: 'short',
      modelProfile: 'router',
      taskStage: 'planning',
      executionReadiness: 'plan_ready',
      needsUserConfirmation: true,
      confidence: 0.92,
    })
  }

  if (EXECUTION_APPROVAL_PATTERN.test(content)) {
    return route({
      interactionMode: 'execution',
      toolPolicy: HIGH_RISK_PATTERN.test(content) ? 'ask_before_write' : 'auto_safe',
      source: 'local_rule',
      reason: 'User explicitly approved implementation or execution.',
      size: content.length > 240 ? 'large' : content.length > 100 ? 'medium' : 'small',
      risk: HIGH_RISK_PATTERN.test(content) ? 'high' : 'medium',
      needsModel: true,
      needsThinking: HIGH_RISK_PATTERN.test(content),
      needsCodebaseContext: true,
      contextProfile: 'task',
      modelProfile: HIGH_RISK_PATTERN.test(content) ? 'thinking' : 'orchestrator',
      taskStage: 'execution',
      executionReadiness: 'user_confirmed',
      needsUserConfirmation: false,
      confidence: 0.9,
    })
  }

  if (HIGH_RISK_PATTERN.test(content)) {
    return route({
      interactionMode: 'awaiting_approval',
      toolPolicy: 'ask_before_write',
      source: 'local_rule',
      reason: 'Message includes high-risk execution wording that requires explicit confirmation.',
      size: content.length > 180 ? 'medium' : 'small',
      risk: 'high',
      needsModel: true,
      needsThinking: true,
      needsCodebaseContext: true,
      contextProfile: 'task',
      modelProfile: 'thinking',
      taskStage: 'awaiting_confirmation',
      executionReadiness: 'plan_ready',
      needsUserConfirmation: true,
      confidence: 0.86,
    })
  }

  if (EXECUTION_PATTERN.test(content)) {
    return route({
      interactionMode: 'execution',
      toolPolicy: 'auto_safe',
      source: 'local_rule',
      reason: 'Message contains explicit execution wording.',
      size: content.length > 240 ? 'large' : content.length > 100 ? 'medium' : 'small',
      risk: 'medium',
      needsModel: true,
      needsThinking: false,
      needsCodebaseContext: true,
      contextProfile: 'task',
      modelProfile: 'orchestrator',
      taskStage: 'execution',
      executionReadiness: 'user_confirmed',
      needsUserConfirmation: false,
      confidence: 0.82,
    })
  }

  return undefined
}

/**
 * Returns whether a route allows real execution to be dispatched.
 * Input: turn route. Output: false for hard discussion/read-only routes.
 */
export function routeAllowsExecution(routeValue: TurnRoute | undefined): boolean {
  if (!routeValue) {
    return true
  }
  if (routeValue.toolPolicy === 'no_tools' || routeValue.toolPolicy === 'read_only') {
    return false
  }
  return !routeValue.constraints.some(
    constraint =>
      constraint.strength === 'hard' &&
      ['discussion_only', 'forbid_code_write', 'forbid_shell_write', 'forbid_git_mutation'].includes(constraint.effect),
  )
}

/**
 * Selects model settings for a route.
 * Input: env and route. Output: gateway model/thinking fields.
 */
export function selectModelForRoute(
  env: ServerEnv,
  routeValue: TurnRoute | undefined,
): { model?: string; thinking?: 'enabled' | 'disabled' } {
  if (!routeValue) {
    return {}
  }
  if (routeValue.modelProfile === 'none') {
    return {}
  }
  if (routeValue.modelProfile === 'router') {
    return {
      model: env.AGENTHUB_ROUTER_MODEL,
      thinking: 'disabled',
    }
  }
  if (routeValue.modelProfile === 'thinking' || routeValue.needsThinking) {
    return {
      model: env.AGENTHUB_ORCHESTRATOR_MODEL,
      thinking: 'enabled',
    }
  }
  return {
    model: env.AGENTHUB_ORCHESTRATOR_MODEL,
    thinking: 'disabled',
  }
}

/**
 * Builds the Flash router system prompt.
 * Input: none. Output: JSON-only classifier prompt.
 */
function buildRouterSystemPrompt(): string {
  return [
    'You are AgentHub Turn Router. Classify one user message for a local multi-agent workspace.',
    'Return ONLY valid JSON. Do not answer the user.',
    'Hard rules:',
    '- If the user explicitly says not to edit code, not to execute, only discuss, only analyze, or first chat, toolPolicy must be read_only and constraints must include hard discussion_only plus write/shell/git forbids.',
    '- /run means execution.',
    '- Destructive, git mutation, deploy, install, delete, or push requests are high risk and should normally be awaiting_confirmation unless the user explicitly approved this exact action.',
    '- Phrases like build/create/generate/make an app, page, mini program, or platform are NOT automatically execution. Classify vague product requests as requirements_intake.',
    '- Only classify execution when the user explicitly approves implementation, uses /run, or asks for a concrete low-ambiguity change to an existing artifact.',
    '- If replyContext shows that the user is replying to one child agent and the new message is short or ambiguous, keep that specialist as the likely visible speaker unless the new content clearly requires orchestration or another role.',
    '- Simple chat should use no_tools or read_only, router model, thinking disabled.',
    'JSON shape:',
    JSON.stringify({
      interactionMode: 'chat | discussion | planning | awaiting_approval | execution',
      toolPolicy: 'no_tools | read_only | ask_before_write | auto_safe | allow_edits',
      size: 'trivial | small | medium | large',
      risk: 'low | medium | high',
      needsModel: true,
      needsThinking: false,
      needsCodebaseContext: false,
      contextProfile: 'minimal | short | task | full_review',
      modelProfile: 'none | router | orchestrator | thinking',
      taskStage: 'chat | requirements_intake | planning | awaiting_confirmation | execution | review',
      executionReadiness: 'not_a_task | unclear_requirements | plan_ready | user_confirmed | execution_in_progress',
      needsUserConfirmation: false,
      confidence: 0.9,
      reason: 'short reason',
      constraints: [
        {
          source: 'current_user_message',
          quote: 'exact user phrase if any',
          scope: 'turn',
          strength: 'hard',
          effect: 'discussion_only',
        },
      ],
    }),
  ].join('\n')
}

/**
 * Builds a small router prompt without full session history.
 * Input: route context. Output: prompt text.
 */
function buildRouterUserPrompt(input: LocalRouteInput): string {
  return JSON.stringify(
    {
      userMessage: input.content,
      replyContext: buildReplyContextPayload(input.replyTo, input.agent ? [input.agent] : []),
      workspace: input.workspace
        ? {
            id: input.workspace.id,
            name: input.workspace.name,
            goal: input.workspace.goal,
          }
        : undefined,
      conversation: input.conversation
        ? {
            id: input.conversation.id,
            type: input.conversation.type,
            title: input.conversation.title,
            participants: input.conversation.participants,
          }
        : undefined,
      activeAgent: input.agent
        ? {
            id: input.agent.id,
            name: input.agent.name,
            role: input.agent.role,
            permissions: input.agent.permissions,
          }
        : undefined,
    },
    null,
    2,
  )
}

/**
 * Parses the router model output into a complete route.
 * Input: raw model content. Output: normalized turn route.
 */
function parseRouterResponse(content: string): TurnRoute {
  const parsed = JSON.parse(content) as unknown
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const payload = record.route ?? record.turnRoute ?? record
  return TurnRouteSchema.parse({
    ...payload,
    source: 'model_router',
  })
}

/**
 * Conservative fallback when the router model is unavailable.
 * Input: raw message. Output: safe route.
 */
function fallbackRoute(content: string, replyTo?: ReplyReference): TurnRoute {
  const highRisk = HIGH_RISK_PATTERN.test(content)
  const explicitExecution = EXECUTION_PATTERN.test(content) || EXECUTION_APPROVAL_PATTERN.test(content)
  const repliedAgentId =
    replyTo && replyTo.senderId !== 'orchestrator' && replyTo.senderId !== 'user'
      ? replyTo.senderId
      : undefined

  if (repliedAgentId && !explicitExecution && !highRisk) {
    return route({
      interactionMode: 'discussion',
      toolPolicy: 'read_only',
      source: 'fallback',
      reason: 'Router model unavailable; preserved replied specialist context for a short discussion turn.',
      size: content.length > 180 ? 'medium' : 'small',
      risk: 'low',
      needsModel: true,
      needsThinking: false,
      needsCodebaseContext: false,
      contextProfile: 'short',
      modelProfile: 'router',
      taskStage: 'chat',
      executionReadiness: 'not_a_task',
      needsUserConfirmation: false,
      confidence: 0.42,
    })
  }

  return route({
    interactionMode: explicitExecution && !highRisk ? 'execution' : highRisk ? 'awaiting_approval' : 'discussion',
    toolPolicy: explicitExecution && !highRisk ? 'auto_safe' : highRisk ? 'ask_before_write' : 'read_only',
    source: 'fallback',
    reason: 'Router model unavailable; used conservative local fallback.',
    size: content.length > 180 ? 'medium' : 'small',
    risk: highRisk ? 'high' : 'medium',
    needsModel: true,
    needsThinking: highRisk,
    needsCodebaseContext: explicitExecution || highRisk,
    contextProfile: explicitExecution || highRisk ? 'task' : 'short',
    modelProfile: highRisk ? 'thinking' : explicitExecution ? 'orchestrator' : 'router',
    taskStage: explicitExecution && !highRisk ? 'execution' : highRisk ? 'awaiting_confirmation' : 'requirements_intake',
    executionReadiness: explicitExecution && !highRisk ? 'user_confirmed' : highRisk ? 'plan_ready' : 'unclear_requirements',
    needsUserConfirmation: !explicitExecution || highRisk,
    confidence: 0.45,
  })
}

/**
 * Uses the Flash router model for ambiguous turns.
 * Input: env plus minimal route context. Output: routed turn with diagnostics.
 */
export async function routeTurnWithModel(input: ModelRouteInput): Promise<RoutedTurn> {
  const localRoute = routeTurnLocally(input)
  if (localRoute) {
    return {
      route: localRoute,
    }
  }

  const startedAt = Date.now()
  try {
    const gateway = createModelGateway(input.env)
    const response = await gateway.generate({
      systemPrompt: buildRouterSystemPrompt(),
      userPrompt: buildRouterUserPrompt(input),
      model: input.env.AGENTHUB_ROUTER_MODEL,
      thinking: 'disabled',
      timeoutMs: input.env.AGENTHUB_ROUTER_TIMEOUT_MS,
      maxTokens: input.env.AGENTHUB_ROUTER_MAX_TOKENS,
      temperature: 0,
      responseFormat: 'json_object',
    })
    return {
      route: parseRouterResponse(response.content),
      provider: response.provider,
      model: response.model,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      route: fallbackRoute(input.content, input.replyTo),
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
