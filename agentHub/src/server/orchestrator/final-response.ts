import type { AgentDefinition, CodeSelectionReference, Conversation, MainBrainSynthesis, ReplyReference, Workspace } from '@shared/contracts'
import type { ServerEnv } from '../env'
import type { ModelGatewayRequest } from '../model-gateway'
import { selectModelForRoute, type TurnRoute } from './turn-router'
import { buildReplyContextPayload } from './reply-context'
import { resolveAgentConfiguredModel } from './agent-model'

type MainBrainReplyInput = {
  env: ServerEnv
  workspace: Workspace
  conversation: Conversation
  userMessage: string
  replyTo?: ReplyReference
  codeSelection?: CodeSelectionReference
  agents?: AgentDefinition[]
  route?: TurnRoute
  fallbackText?: string
}

type AgentSessionReplyInput = {
  env: ServerEnv
  workspace: Workspace
  conversation: Conversation
  agent: AgentDefinition
  agents?: AgentDefinition[]
  userMessage: string
  replyTo?: ReplyReference
  codeSelection?: CodeSelectionReference
  sessionContext: string
  route?: TurnRoute
  fallbackText?: string
}

type SynthesisReplyInput = {
  env: ServerEnv
  workspace: Workspace
  conversation: Conversation
  userMessage: string
  synthesis: MainBrainSynthesis
  localSummaries: string[]
}

/**
 * Builds a compact JSON payload for final-response prompts.
 * Input: arbitrary serializable data. Output: pretty JSON prompt section.
 */
function jsonBlock(input: unknown): string {
  return JSON.stringify(input, null, 2)
}

/**
 * Compacts one browser-selected code reference for final-response prompts.
 * Input: optional code selection. Output: compact prompt payload.
 */
function buildCodeSelectionPayload(selection: CodeSelectionReference | undefined): Record<string, unknown> | undefined {
  if (!selection) {
    return undefined
  }

  return {
    filePath: selection.filePath,
    language: selection.language,
    startLine: selection.startLine,
    startColumn: selection.startColumn,
    endLine: selection.endLine,
    endColumn: selection.endColumn,
    selectedText: selection.selectedText.slice(0, 1_200),
    beforeContext: selection.beforeContext?.slice(0, 600),
    afterContext: selection.afterContext?.slice(0, 600),
  }
}

/**
 * Builds the model request for a direct main-brain final answer.
 * Input: workspace, conversation, user message, route, and fallback text. Output: text-generation request.
 */
export function buildMainBrainReplyRequest(input: MainBrainReplyInput): ModelGatewayRequest {
  const modelSelection = selectModelForRoute(input.env, input.route)
  return {
    systemPrompt: [
      'You are AgentHub final text responder.',
      'Write the final user-facing answer in Chinese.',
      'Do not return JSON.',
      'Do not claim that files were read, commands were run, agents executed, or code changed unless the supplied context explicitly says so.',
      'For ordinary chat, answer naturally and briefly.',
      'For discussion or planning turns, be concrete and concise.',
    ].join('\n'),
    userPrompt: jsonBlock({
      userMessage: input.userMessage,
      replyContext: buildReplyContextPayload(input.replyTo, input.agents ?? []),
      codeSelection: buildCodeSelectionPayload(input.codeSelection),
      workspace: {
        id: input.workspace.id,
        name: input.workspace.name,
        goal: input.workspace.goal,
        projectBrief: input.workspace.projectBrief,
      },
      conversation: {
        id: input.conversation.id,
        type: input.conversation.type,
        title: input.conversation.title,
      },
      route: input.route
        ? {
            interactionMode: input.route.interactionMode,
            toolPolicy: input.route.toolPolicy,
            contextProfile: input.route.contextProfile,
            constraints: input.route.constraints,
            reason: input.route.reason,
          }
        : undefined,
      fallbackText: input.fallbackText,
    }),
    model: modelSelection.model ?? input.env.AGENTHUB_ROUTER_MODEL,
    thinking: modelSelection.thinking ?? 'disabled',
    timeoutMs:
      input.route?.modelProfile === 'orchestrator' || input.route?.modelProfile === 'thinking'
        ? Math.min(input.env.AGENTHUB_ORCHESTRATOR_TIMEOUT_MS, 30_000)
        : input.env.AGENTHUB_ROUTER_TIMEOUT_MS,
    maxTokens:
      input.route?.modelProfile === 'orchestrator' || input.route?.modelProfile === 'thinking'
        ? Math.min(input.env.AGENTHUB_ORCHESTRATOR_MAX_TOKENS, 1_200)
        : Math.max(input.env.AGENTHUB_ROUTER_MAX_TOKENS, 500),
    temperature: 0.2,
  }
}

/**
 * Builds the model request for a child-agent private chat final answer.
 * Input: agent metadata, user message, session context, and route. Output: text-generation request.
 */
export function buildAgentSessionReplyRequest(input: AgentSessionReplyInput): ModelGatewayRequest {
  const modelSelection = selectModelForRoute(input.env, input.route)
  return {
    systemPrompt: [
      input.agent.systemPrompt,
      '',
      'You are AgentHub child-agent final responder.',
      'Write the final user-facing reply in Chinese for this private agent session.',
      'Do not return JSON.',
      'Do not claim execution, file reads, file writes, tests, or command results unless the session context explicitly includes them.',
      'If the user wants real execution, tell them to use /run with a concrete task.',
    ].join('\n'),
    userPrompt: jsonBlock({
      userMessage: input.userMessage,
      replyContext: buildReplyContextPayload(input.replyTo, input.agents ?? [input.agent]),
      codeSelection: buildCodeSelectionPayload(input.codeSelection),
      workspace: {
        id: input.workspace.id,
        name: input.workspace.name,
        goal: input.workspace.goal,
      },
      conversation: {
        id: input.conversation.id,
        type: input.conversation.type,
        title: input.conversation.title,
      },
      agent: {
        id: input.agent.id,
        name: input.agent.name,
        role: input.agent.role,
        description: input.agent.description,
      },
      route: input.route
        ? {
            interactionMode: input.route.interactionMode,
            toolPolicy: input.route.toolPolicy,
            constraints: input.route.constraints,
            reason: input.route.reason,
          }
        : undefined,
      sessionContext: input.sessionContext,
      fallbackText: input.fallbackText,
    }),
    model: resolveAgentConfiguredModel(input.agent, modelSelection.model ?? input.env.AGENTHUB_ROUTER_MODEL),
    thinking: modelSelection.thinking ?? 'disabled',
    timeoutMs: input.env.AGENTHUB_ROUTER_TIMEOUT_MS,
    maxTokens: Math.max(input.env.AGENTHUB_ROUTER_MAX_TOKENS, 700),
    temperature: 0.25,
  }
}

/**
 * Builds the model request for the final synthesis text after child-agent runs.
 * Input: synthesis decision, summaries, and original message. Output: text-generation request.
 */
export function buildSynthesisReplyRequest(input: SynthesisReplyInput): ModelGatewayRequest {
  return {
    systemPrompt: [
      'You are AgentHub synthesis final responder.',
      'Write the final user-facing delivery summary in Chinese.',
      'Do not return JSON.',
      'Use only the supplied synthesis and local summaries.',
      'Mention validation, changed files, artifacts, risks, or next steps only when supplied.',
    ].join('\n'),
    userPrompt: jsonBlock({
      userMessage: input.userMessage,
      workspace: {
        id: input.workspace.id,
        name: input.workspace.name,
        goal: input.workspace.goal,
      },
      conversation: {
        id: input.conversation.id,
        type: input.conversation.type,
        title: input.conversation.title,
      },
      synthesis: input.synthesis,
      localSummaries: input.localSummaries,
    }),
    model: input.env.AGENTHUB_ORCHESTRATOR_MODEL,
    thinking: 'disabled',
    timeoutMs: Math.min(input.env.AGENTHUB_ORCHESTRATOR_TIMEOUT_MS, 30_000),
    maxTokens: Math.min(input.env.AGENTHUB_ORCHESTRATOR_MAX_TOKENS, 1_500),
    temperature: 0.2,
  }
}
