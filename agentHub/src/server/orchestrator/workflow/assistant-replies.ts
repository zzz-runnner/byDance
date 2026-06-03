import { randomUUID } from 'node:crypto'
import type { AgentSessionMessage, CodeSelectionReference, Conversation, MainBrainSynthesis, Message, WorkflowEvent, WorkflowEventRecord, Workspace } from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import type { LocalToolGateway } from '../../tool-gateway'
import type { ServerEnv } from '../../env'
import { createModelGateway, type ModelGatewayRequest } from '../../model-gateway'
import type { StateStore } from '../../store/types'
import {
  buildAgentSessionReplyRequest,
  buildMainBrainReplyRequest,
  buildSynthesisReplyRequest,
} from '../final-response'
import {
  buildAgentSessionContextPackage,
  type AgentReplyPersistenceInput,
} from '../agent-session'
import type { TurnRoute } from '../turn-router'
import { emitWorkflowEvent } from './workflow-events'
import { requiredById } from './workflow-utils'
import { streamAgentModelResponse } from '../agent-model'
import type { WorkspaceRuntimeManager } from '../../runtime/workspace'

type AssistantReplyServices = {
  env: ServerEnv
  store: StateStore
  runtime: WorkspaceRuntimeManager
  toolGateway: LocalToolGateway
  turnId?: string
  workflowEventLog?: WorkflowEventRecord[]
  eventSink?: (event: WorkflowEvent) => void
}

type AssistantMessageScope = Extract<WorkflowEvent, { type: 'assistant_message_started' }>['scope']
type ModelCallScope = Extract<WorkflowEvent, { type: 'model_call_started' }>['scope']

type StreamAssistantContentInput = {
  scope: AssistantMessageScope
  senderId: string
  senderName?: string
  request?: ModelGatewayRequest
  fallbackText?: string
  staticText?: string
  modelScope?: ModelCallScope
  agentId?: string
  agentName?: string
  sessionId?: string
  agentDefinition?: AgentReplyPersistenceInput['agent']
}

/**
 * Splits final assistant text into display-friendly chunks for fallback streaming.
 * Input: full text and chunk size. Output: ordered text chunks.
 */
function chunkAssistantText(text: string, size = 24): string[] {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

/**
 * Emits assistant deltas for already available text.
 * Input: workflow services, message scope, message id, and text. Output: emitted text.
 */
function emitStaticAssistantText(
  services: AssistantReplyServices,
  workspace: Workspace,
  conversation: Conversation,
  scope: AssistantMessageScope,
  messageId: string,
  text: string,
): string {
  for (const delta of chunkAssistantText(text)) {
    emitWorkflowEvent(services, {
      type: 'assistant_delta',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope,
      messageId,
      delta,
    })
  }
  return text
}

/**
 * Streams or replays the final assistant message through workflow events.
 * Input: workflow services, message metadata, and optional model request. Output: final text and message id.
 */
async function streamAssistantContent(
  services: AssistantReplyServices,
  workspace: Workspace,
  conversation: Conversation,
  input: StreamAssistantContentInput,
): Promise<{ messageId: string; content: string }> {
  const messageId = `msg-${randomUUID()}`
  emitWorkflowEvent(services, {
    type: 'assistant_message_started',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    scope: input.scope,
    messageId,
    senderId: input.senderId,
    senderName: input.senderName,
  })

  let content = ''
  if (input.staticText !== undefined) {
    content = emitStaticAssistantText(services, workspace, conversation, input.scope, messageId, input.staticText)
    emitWorkflowEvent(services, {
      type: 'assistant_message_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: input.scope,
      messageId,
      contentLength: content.length,
    })
    return { messageId, content }
  }

  const request = input.request
  if (!request) {
    const fallback = input.fallbackText?.trim() || '已收到。'
    content = emitStaticAssistantText(services, workspace, conversation, input.scope, messageId, fallback)
    emitWorkflowEvent(services, {
      type: 'assistant_message_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: input.scope,
      messageId,
      contentLength: content.length,
    })
    return { messageId, content }
  }

  const startedAt = Date.now()
  const provider = input.agentDefinition?.modelProvider ?? services.env.AGENTHUB_ORCHESTRATOR_PROVIDER
  let assistantFinished = false
  emitWorkflowEvent(services, {
    type: 'model_call_started',
    workspaceId: workspace.id,
    conversationId: conversation.id,
    scope: input.modelScope ?? input.scope,
    provider,
    model: request.model,
    agentId: input.agentId,
    agentName: input.agentName,
    sessionId: input.sessionId,
  })

  try {
    const response = input.agentDefinition
      ? await streamAgentModelResponse(
          {
            env: services.env,
            runtime: services.runtime,
            toolGateway: services.toolGateway,
            workspace,
            conversation,
            agent: input.agentDefinition,
            request,
          },
          {
            onDelta: delta => {
              content += delta
              emitWorkflowEvent(services, {
                type: 'assistant_delta',
                workspaceId: workspace.id,
                conversationId: conversation.id,
                scope: input.scope,
                messageId,
                delta,
              })
            },
          },
        )
      : await createModelGateway(services.env).streamText(request, {
          onDelta: delta => {
            content += delta
            emitWorkflowEvent(services, {
              type: 'assistant_delta',
              workspaceId: workspace.id,
              conversationId: conversation.id,
              scope: input.scope,
              messageId,
              delta,
            })
          },
        })

    if (!content && response.content) {
      content = emitStaticAssistantText(services, workspace, conversation, input.scope, messageId, response.content)
    }

    emitWorkflowEvent(services, {
      type: 'assistant_message_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: input.scope,
      messageId,
      contentLength: (content.trim() || response.content).length,
    })
    assistantFinished = true
    emitWorkflowEvent(services, {
      type: 'model_call_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: input.modelScope ?? input.scope,
      provider: response.provider,
      model: response.model,
      agentId: input.agentId,
      agentName: input.agentName,
      sessionId: input.sessionId,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    const safeError = error instanceof Error ? error.message : String(error)
    emitWorkflowEvent(services, {
      type: 'model_call_failed',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: input.modelScope ?? input.scope,
      provider,
      model: request.model,
      agentId: input.agentId,
      agentName: input.agentName,
      sessionId: input.sessionId,
      elapsedMs: Date.now() - startedAt,
      error: safeError,
    })
    const fallback = input.fallbackText?.trim()
    if (!fallback) {
      emitWorkflowEvent(services, {
        type: 'assistant_message_error',
        workspaceId: workspace.id,
        conversationId: conversation.id,
        scope: input.scope,
        messageId,
        error: safeError,
      })
      throw error
    }
    content = emitStaticAssistantText(services, workspace, conversation, input.scope, messageId, fallback)
    emitWorkflowEvent(services, {
      type: 'assistant_message_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: input.scope,
      messageId,
      contentLength: content.length,
    })
    assistantFinished = true
  }

  const finalContent = content.trim() || input.fallbackText?.trim() || '已收到。'
  if (!assistantFinished) {
    emitWorkflowEvent(services, {
      type: 'assistant_message_finished',
      workspaceId: workspace.id,
      conversationId: conversation.id,
      scope: input.scope,
      messageId,
      contentLength: finalContent.length,
    })
  }
  return { messageId, content: finalContent }
}

/**
 * Persists one conversation-level assistant message.
 * Input: message identity, sender, and content. Output: persisted message.
 */
async function persistConversationAssistantMessage(
  services: AssistantReplyServices,
  workspace: Workspace,
  conversation: Conversation,
  messageId: string,
  senderId: string,
  content: string,
): Promise<Message> {
  const message: Message = {
    id: messageId,
    workspaceId: workspace.id,
    conversationId: conversation.id,
    turnId: services.turnId,
    senderType: 'agent',
    senderId,
    content,
    artifacts: [],
    createdAt: isoNow(),
  }

  await services.store.update(state => {
    state.messages.push(message)
    const targetConversation = requiredById(state.conversations, conversation.id, 'Conversation')
    targetConversation.updatedAt = message.createdAt
    const targetWorkspace = requiredById(state.workspaces, workspace.id, 'Workspace')
    targetWorkspace.updatedAt = message.createdAt
  })

  return message
}

/**
 * Streams and persists a direct Orchestrator reply.
 * Input: workflow context, user message, route, and optional fallback. Output: final content.
 */
export async function streamAndPersistMainBrainReply(
  services: AssistantReplyServices,
  workspace: Workspace,
  conversation: Conversation,
  userMessage: string,
  replyTo?: Message['replyTo'],
  codeSelection?: CodeSelectionReference,
  route?: TurnRoute,
  fallbackText?: string,
): Promise<string> {
  const safeFallback = fallbackText?.trim() || '已收到。'
  const latestState = await services.store.read()
  const request = buildMainBrainReplyRequest({
    env: services.env,
    workspace,
    conversation,
    userMessage,
    replyTo,
    codeSelection,
    agents: latestState.agents,
    route,
    fallbackText: safeFallback,
  })
  const streamed = await streamAssistantContent(services, workspace, conversation, {
    scope: 'main_brain',
    senderId: 'orchestrator',
    senderName: '主脑',
    request,
    fallbackText: safeFallback,
    modelScope: 'main_brain',
  })
  await persistConversationAssistantMessage(services, workspace, conversation, streamed.messageId, 'orchestrator', streamed.content)
  return streamed.content
}

/**
 * Replays and persists already available Orchestrator text through assistant stream events.
 * Input: workflow context, message scope, and content. Output: persisted content.
 */
export async function emitAndPersistStaticAssistantReply(
  services: AssistantReplyServices,
  workspace: Workspace,
  conversation: Conversation,
  scope: AssistantMessageScope,
  content: string,
): Promise<string> {
  const streamed = await streamAssistantContent(services, workspace, conversation, {
    scope,
    senderId: 'orchestrator',
    senderName: scope === 'synthesis' ? '主脑综合' : '主脑',
    staticText: content,
  })
  await persistConversationAssistantMessage(services, workspace, conversation, streamed.messageId, 'orchestrator', streamed.content)
  return streamed.content
}

/**
 * Streams and persists one synthesized main-brain reply.
 * Input: workflow context, synthesis decision, and local summaries. Output: persisted content.
 */
export async function streamAndPersistSynthesisReply(
  services: AssistantReplyServices,
  workspace: Workspace,
  conversation: Conversation,
  userMessage: string,
  synthesis: MainBrainSynthesis,
  localSummaries: string[],
  fallbackText: string,
): Promise<string> {
  const request = buildSynthesisReplyRequest({
    env: services.env,
    workspace,
    conversation,
    userMessage,
    synthesis,
    localSummaries,
  })
  const streamed = await streamAssistantContent(services, workspace, conversation, {
    scope: 'synthesis',
    senderId: 'orchestrator',
    senderName: '主脑综合',
    request,
    fallbackText,
    modelScope: 'synthesis',
  })
  await persistConversationAssistantMessage(services, workspace, conversation, streamed.messageId, 'orchestrator', streamed.content)
  return streamed.content
}

/**
 * Streams and persists one child-agent private chat reply.
 * Input: workflow services and reply persistence details. Output: persisted conversation message.
 */
export async function streamAndPersistAgentReply(
  services: AssistantReplyServices,
  input: AgentReplyPersistenceInput,
): Promise<Message> {
  const latestState = await services.store.read()
  const safeFallback = input.turn.finalResponse?.trim() || `${input.agent.name} 已收到。`
  const sessionContext = buildAgentSessionContextPackage({
    state: latestState,
    workspace: input.workspace,
    conversation: input.conversation,
    agent: input.agent,
    session: input.session,
    userMessage: input.userContent,
    replyTo: input.replyTo,
    codeSelection: input.codeSelection,
    contextProfile: input.route?.contextProfile,
  })
  const request = input.turn.finalResponse?.trim()
    ? undefined
    : buildAgentSessionReplyRequest({
        env: services.env,
        workspace: input.workspace,
      conversation: input.conversation,
      agent: input.agent,
      agents: latestState.agents,
      userMessage: input.userContent,
      replyTo: input.replyTo,
      codeSelection: input.codeSelection,
        sessionContext,
        route: input.route,
        fallbackText: safeFallback,
      })
  const streamed = await streamAssistantContent(services, input.workspace, input.conversation, {
    scope: 'agent_session',
    senderId: input.agent.id,
    senderName: input.agent.name,
    request,
    fallbackText: safeFallback,
    staticText: input.turn.finalResponse?.trim() ? input.turn.finalResponse.trim() : undefined,
    modelScope: 'agent_session',
    agentId: input.agent.id,
    agentName: input.agent.name,
    sessionId: input.session.id,
    agentDefinition: input.agent,
  })

  const now = isoNow()
  const conversationMessage: Message = {
    id: streamed.messageId,
    workspaceId: input.workspace.id,
    conversationId: input.conversation.id,
    turnId: services.turnId,
    senderType: 'agent',
    senderId: input.agent.id,
    content: streamed.content,
    artifacts: [],
    createdAt: now,
  }
  const sessionMessage: AgentSessionMessage = {
    id: `session-msg-${randomUUID()}`,
    workspaceId: input.workspace.id,
    sessionId: input.session.id,
    agentId: input.agent.id,
    senderType: 'agent',
    senderId: input.agent.id,
    kind: 'agent_reply',
    content: streamed.content,
    metadata: input.metadata,
    createdAt: now,
  }

  await services.store.update(state => {
    state.messages.push(conversationMessage)
    state.agentSessionMessages.push(sessionMessage)
    const targetConversation = requiredById(state.conversations, input.conversation.id, 'Conversation')
    targetConversation.updatedAt = now
    const targetWorkspace = requiredById(state.workspaces, input.workspace.id, 'Workspace')
    targetWorkspace.updatedAt = now
    const targetSession = requiredById(state.agentSessions, input.session.id, 'AgentSession')
    targetSession.updatedAt = now
  })

  return conversationMessage
}
