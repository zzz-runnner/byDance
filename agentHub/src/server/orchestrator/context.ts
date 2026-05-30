import type {
  AgentDefinition,
  AppState,
  Conversation,
  ContextSnapshot,
  MainBrainTurn,
  ReplyReference,
  RoutingTaskBrief,
  Workspace,
} from '@shared/contracts'
import type { DeliveryValidationResult, ReviewVerdictResult } from './delivery/types'
import { buildReplyContextPayload } from './reply-context'

/**
 * Describes a compacted context payload plus its storage summary.
 * Input: assembled state, task, and retrieval slices. Output: model-facing context bundle.
 */
export type ContextAssembly = {
  inputContext: string
  summary: string
  tokenEstimate: number
  sourceRefs: string[]
}

type MessageSlice = {
  senderType: string
  senderId: string
  content: string
  replyTo?: ReplyReference
  createdAt: string
}

type ArtifactSlice = {
  type: string
  title: string
  content?: string
  url?: string
}

type ChangeSetSlice = {
  id: string
  summary: string
  baseCommit: string
  files: { path: string; status: string }[]
}

type SnapshotSlice = {
  id: string
  agentRunId?: string
  summary: string
  tokenEstimate: number
  sourceRefs: string[]
  createdAt: string
}

type AgentRunSlice = {
  id: string
  agentId: string
  status: string
  startedAt: string
  finishedAt?: string
  summary: string
}

type CommonContextInput = {
  state: AppState
  workspace: Workspace
  conversation: Conversation
  task: string
  requiredContext: string[]
  expectedOutput: string
  agentSession?: {
    sessionId: string
    handoffId?: string
  }
  agentScope: {
    id: string
    name: string
    role: string
    description: string
    tools: string[]
    permissions: AgentDefinition['permissions']
    includeSameConversationOnly: boolean
    recentMessageLimit: number
  }
  agentModelProvider?: AgentDefinition['modelProvider']
}

type AgentSessionMemorySlice = {
  sessionId: string
  handoffId?: string
  recentMessages: {
    senderType: string
    senderId: string
    kind: string
    content: string
    createdAt: string
  }[]
  recentHandoffs: {
    id: string
    source: string
    task: string
    expectedOutput: string
    status: string
    resultRunId?: string
    resultSummary?: string
    createdAt: string
  }[]
}

type PlannerContextInput = {
  state: AppState
  workspace: Workspace
  conversation: Conversation
  userMessage: string
  replyTo?: ReplyReference
  agents: AgentDefinition[]
}

export type SynthesisAgentResult = {
  runId: string
  agentId: string
  agentName: string
  status: string
  task: string
  expectedOutput: string
  output: string
  baseCommit: string
  deliveryReason?: string
  validation?: DeliveryValidationResult
  review?: ReviewVerdictResult
}

type SynthesisContextInput = {
  state: AppState
  workspace: Workspace
  conversation: Conversation
  userMessage: string
  routing: MainBrainTurn
  agentResults: SynthesisAgentResult[]
  localSummaries: string[]
}

/**
 * Clips text to a compact length and normalizes whitespace.
 * Input: raw text and maximum length. Output: compact text.
 */
function compactText(text: string, maxLength = 280): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}... [truncated]`
}

/**
 * Estimates token count using the local char-to-token heuristic.
 * Input: serialized text. Output: approximate token count.
 */
function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Splits searchable text into lowercase terms.
 * Input: free-form text. Output: normalized search terms.
 */
function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9_]+|[\u4e00-\u9fa5]{2,}/g)
        ?.filter(token => token.length >= 2) ?? [],
    ),
  )
}

/**
 * Builds a relevance score for a text field against a set of query terms.
 * Input: candidate text, query terms, and recency bonus. Output: numeric score.
 */
function scoreText(text: string, terms: string[], recencyBonus = 0): number {
  if (!terms.length) {
    return recencyBonus
  }
  const haystack = text.toLowerCase()
  let score = recencyBonus
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += Math.max(2, Math.ceil(term.length / 2))
    }
  }
  return score
}

/**
 * Builds shared retrieval terms from a task and workspace metadata.
 * Input: workspace, conversation, task, and output hint. Output: searchable terms.
 */
function buildSearchTerms(parts: string[]): string[] {
  return tokenize(parts.join(' '))
}

/**
 * Finds the latest snapshot boundary for a workspace conversation.
 * Input: state and conversation identity. Output: latest snapshot or undefined.
 */
function findLatestSnapshot(
  state: AppState,
  workspaceId: string,
  conversationId: string,
): ContextSnapshot | undefined {
  return [...state.contextSnapshots]
    .filter(snapshot => snapshot.workspaceId === workspaceId && snapshot.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

/**
 * Selects compact messages after the latest boundary plus a few relevant older messages.
 * Input: state, workspace, conversation, and ranking terms. Output: compact message slices.
 */
function selectMessages(
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  terms: string[],
  includeSameConversationOnly: boolean,
  recentLimit: number,
): { boundaryAt?: string; recentMessages: MessageSlice[]; retrievedMessages: MessageSlice[] } {
  const latestSnapshot = findLatestSnapshot(state, workspace.id, conversation.id)
  const boundaryAt = latestSnapshot?.createdAt
  const conversationMessages = state.messages
    .filter(message => message.workspaceId === workspace.id)
    .filter(message => !includeSameConversationOnly || message.conversationId === conversation.id)

  const recentMessages = conversationMessages
    .filter(message => !boundaryAt || message.createdAt > boundaryAt)
    .slice(-Math.max(1, recentLimit))
    .map(message => ({
      senderType: message.senderType,
      senderId: message.senderId,
      content: compactText(message.content, 360),
      replyTo: message.replyTo,
      createdAt: message.createdAt,
    }))

  const recentIds = new Set(
    conversationMessages
      .filter(message => !boundaryAt || message.createdAt > boundaryAt)
      .slice(-Math.max(1, recentLimit))
      .map(message => message.id),
  )

  const retrievedMessages = conversationMessages
    .filter(message => !recentIds.has(message.id))
    .map(message => ({
      message,
      score:
        scoreText(message.content, terms, 0) +
        (message.conversationId === conversation.id ? 6 : 0) +
        (message.senderId === 'orchestrator' ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.message.createdAt.localeCompare(a.message.createdAt))
    .slice(0, 4)
    .map(({ message }) => ({
      senderType: message.senderType,
      senderId: message.senderId,
      content: compactText(message.content, 280),
      replyTo: message.replyTo,
      createdAt: message.createdAt,
    }))

  return {
    boundaryAt,
    recentMessages,
    retrievedMessages,
  }
}

/**
 * Selects pinned messages with compact content.
 * Input: state and workspace. Output: compact pinned messages.
 */
function selectPinnedMessages(state: AppState, workspace: Workspace): MessageSlice[] {
  return state.messages
    .filter(message => workspace.pinnedMessageIds.includes(message.id))
    .slice(0, 8)
    .map(message => ({
      senderType: message.senderType,
      senderId: message.senderId,
      content: compactText(message.content, 280),
      replyTo: message.replyTo,
      createdAt: message.createdAt,
    }))
}

/**
 * Selects relevant artifacts with compact payloads.
 * Input: state, workspace, and query terms. Output: compact artifact slices.
 */
function selectArtifacts(state: AppState, workspace: Workspace, terms: string[]): ArtifactSlice[] {
  return state.artifacts
    .filter(artifact => artifact.workspaceId === workspace.id)
    .map(artifact => ({
      artifact,
      score:
        scoreText(artifact.title, terms, 2) +
        scoreText(artifact.content, terms, 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ artifact }) => ({
      type: artifact.type,
      title: artifact.title,
      content: artifact.content ? compactText(artifact.content, 300) : undefined,
      url: artifact.url,
    }))
}

/**
 * Selects recent change sets and keeps only compact summaries.
 * Input: state, workspace, and query terms. Output: compact change set slices.
 */
function selectChangeSets(state: AppState, workspace: Workspace, terms: string[]): ChangeSetSlice[] {
  return state.changeSets
    .filter(changeSet => changeSet.workspaceId === workspace.id)
    .map(changeSet => ({
      changeSet,
      score:
        scoreText(changeSet.summary, terms, 1) +
        scoreText(changeSet.patch ?? '', terms, 0),
    }))
    .sort((a, b) => b.score - a.score || b.changeSet.createdAt.localeCompare(a.changeSet.createdAt))
    .slice(0, 3)
    .map(({ changeSet }) => ({
      id: changeSet.id,
      summary: compactText(changeSet.summary, 240),
      baseCommit: changeSet.baseCommit,
      files: changeSet.files.slice(0, 5).map(file => ({
        path: file.path,
        status: file.status,
      })),
    }))
}

/**
 * Selects recent context snapshots for retrieval.
 * Input: state, workspace, conversation, and query terms. Output: compact snapshot slices.
 */
function selectSnapshots(
  state: AppState,
  workspace: Workspace,
  conversation: Conversation,
  terms: string[],
  includeSameConversationOnly: boolean,
): SnapshotSlice[] {
  return state.contextSnapshots
    .filter(snapshot => snapshot.workspaceId === workspace.id)
    .filter(snapshot => !includeSameConversationOnly || snapshot.conversationId === conversation.id)
    .map(snapshot => ({
      snapshot,
      score:
        scoreText(snapshot.summary ?? snapshot.inputContext, terms, 1) +
        (snapshot.conversationId === conversation.id ? 5 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.snapshot.createdAt.localeCompare(a.snapshot.createdAt))
    .slice(0, 3)
    .map(({ snapshot }) => ({
      id: snapshot.id,
      agentRunId: snapshot.agentRunId,
      summary: compactText(snapshot.summary ?? snapshot.inputContext, 280),
      tokenEstimate: snapshot.tokenEstimate,
      sourceRefs: snapshot.sourceRefs,
      createdAt: snapshot.createdAt,
    }))
}

/**
 * Selects recent agent runs for workspace status questions.
 * Input: state and workspace. Output: compact recent agent run slices.
 */
function selectRecentAgentRuns(state: AppState, workspace: Workspace): AgentRunSlice[] {
  return state.agentRuns
    .filter(run => run.workspaceId === workspace.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 6)
    .map(run => ({
      id: run.id,
      agentId: run.agentId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      summary: compactText(run.output || run.error || 'No output yet.', 240),
    }))
}

/**
 * Selects compact persistent session memory for a child agent run.
 * Input: state, workspace id, and optional session identity. Output: compact session memory or undefined.
 */
function selectAgentSessionMemory(
  state: AppState,
  workspace: Workspace,
  session?: { sessionId: string; handoffId?: string },
): AgentSessionMemorySlice | undefined {
  if (!session) {
    return undefined
  }

  const recentMessages = state.agentSessionMessages
    .filter(message => message.workspaceId === workspace.id && message.sessionId === session.sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-12)
    .map(message => ({
      senderType: message.senderType,
      senderId: message.senderId,
      kind: message.kind,
      content: compactText(message.content, 420),
      createdAt: message.createdAt,
    }))

  const recentHandoffs = state.taskHandoffs
    .filter(handoff => handoff.workspaceId === workspace.id && handoff.sessionId === session.sessionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)
    .map(handoff => ({
      id: handoff.id,
      source: handoff.source,
      task: compactText(handoff.task, 360),
      expectedOutput: compactText(handoff.expectedOutput, 220),
      status: handoff.status,
      resultRunId: handoff.resultRunId,
      resultSummary: handoff.resultSummary ? compactText(handoff.resultSummary, 300) : undefined,
      createdAt: handoff.createdAt,
    }))

  return {
    sessionId: session.sessionId,
    handoffId: session.handoffId,
    recentMessages,
    recentHandoffs,
  }
}

/**
 * Builds the final JSON payload for agent context delivery.
 * Input: shared context inputs. Output: serialized prompt payload and storage summary.
 */
export function buildAgentContextAssembly(input: CommonContextInput): ContextAssembly {
  const searchTerms = buildSearchTerms([
    input.workspace.goal,
    input.workspace.projectBrief,
    input.conversation.title,
    input.task,
    input.expectedOutput,
    input.requiredContext.join(' '),
    input.agentScope.role,
    input.agentScope.name,
    input.agentScope.id,
  ])
  const pinnedMessages = selectPinnedMessages(input.state, input.workspace)
  const { boundaryAt, recentMessages, retrievedMessages } = selectMessages(
    input.state,
    input.workspace,
    input.conversation,
    searchTerms,
    input.agentScope.includeSameConversationOnly,
    input.agentScope.recentMessageLimit,
  )
  const artifacts = selectArtifacts(input.state, input.workspace, searchTerms)
  const changeSets = selectChangeSets(input.state, input.workspace, searchTerms)
  const snapshots = selectSnapshots(
    input.state,
    input.workspace,
    input.conversation,
    searchTerms,
    input.agentScope.includeSameConversationOnly,
  )
  const agentSession = selectAgentSessionMemory(input.state, input.workspace, input.agentSession)

  const payload = {
    workspace: {
      id: input.workspace.id,
      name: input.workspace.name,
      goal: input.workspace.goal,
      projectBrief: input.workspace.projectBrief,
      runtimeType: input.workspace.runtimeType,
      runtimeStatus: input.workspace.runtimeStatus,
    },
    conversation: {
      id: input.conversation.id,
      type: input.conversation.type,
      title: input.conversation.title,
      participants: input.conversation.participants,
      compactBoundary: boundaryAt ?? null,
    },
    agent: {
      id: input.agentScope.id,
      name: input.agentScope.name,
      role: input.agentScope.role,
      description: input.agentScope.description,
      tools: input.agentScope.tools,
      permissions: input.agentScope.permissions,
      modelProvider: input.agentModelProvider ?? 'mock',
    },
    task: {
      brief: input.task,
      requiredContext: input.requiredContext,
      expectedOutput: input.expectedOutput,
    },
    memory: {
      pinnedMessages,
      recentMessages,
      retrievedMessages,
      agentSession,
      snapshots,
      artifacts,
      changeSets,
    },
  }

  const inputContext = JSON.stringify(payload, null, 2)
  const summary = [
    `workspace: ${input.workspace.name} (${input.workspace.id})`,
    `task: ${compactText(input.task, 140)}`,
    boundaryAt ? `compact boundary: ${boundaryAt}` : 'compact boundary: none',
    `pinned: ${pinnedMessages.length}`,
    `recent: ${recentMessages.length}`,
    `retrieved: ${retrievedMessages.length}`,
    agentSession ? `agentSessionMessages: ${agentSession.recentMessages.length}` : 'agentSessionMessages: none',
    `snapshots: ${snapshots.length}`,
    `artifacts: ${artifacts.length}`,
    `changeSets: ${changeSets.length}`,
  ].join('\n')

  return {
    inputContext,
    summary,
    tokenEstimate: estimateTokenCount(inputContext),
    sourceRefs: [
      `workspace:${input.workspace.id}`,
      `conversation:${input.conversation.id}`,
      `agent:${input.agentScope.id}`,
      ...(input.agentSession ? [`agentSession:${input.agentSession.sessionId}`] : []),
      ...(input.agentSession?.handoffId ? [`handoff:${input.agentSession.handoffId}`] : []),
      ...input.requiredContext.map(item => `required:${item}`),
      ...(boundaryAt ? [`boundary:${boundaryAt}`] : []),
    ],
  }
}

/**
 * Builds the compact planner context for the orchestrator model.
 * Input: state, workspace, conversation, user message, and available agents. Output: serialized planner payload.
 */
export function buildPlannerContextPackage(input: PlannerContextInput): string {
  const searchTerms = buildSearchTerms([
    input.workspace.goal,
    input.workspace.projectBrief,
    input.conversation.title,
    input.userMessage,
  ])
  const pinnedMessages = selectPinnedMessages(input.state, input.workspace)
  const { boundaryAt, recentMessages, retrievedMessages } = selectMessages(
    input.state,
    input.workspace,
    input.conversation,
    searchTerms,
    false,
    8,
  )
  const artifacts = selectArtifacts(input.state, input.workspace, searchTerms)
  const changeSets = selectChangeSets(input.state, input.workspace, searchTerms)
  const snapshots = selectSnapshots(input.state, input.workspace, input.conversation, searchTerms, false)
  const recentAgentRuns = selectRecentAgentRuns(input.state, input.workspace)

  const agentRegistry = input.agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    description: agent.description,
    whenToUse: agent.whenToUse,
    routingProfile: agent.routingProfile
      ? {
          routingSummary: agent.routingProfile.routingSummary,
          responsibilities: agent.routingProfile.responsibilities,
          goodAt: agent.routingProfile.goodAt,
          notFor: agent.routingProfile.notFor,
          preferredStages: agent.routingProfile.preferredStages,
          exampleRequests: agent.routingProfile.exampleRequests,
          speakerMode: agent.routingProfile.speakerMode,
        }
      : undefined,
    modelProvider: agent.modelProvider,
    tools: agent.tools,
    permissions: agent.permissions,
  }))
  const childAgentIds = input.agents.map(agent => agent.id)
  const mainConversationMembers = Array.from(new Set(input.conversation.participants))
  const workspaceMembers = Array.from(new Set(['user', 'orchestrator', ...childAgentIds]))
  const activeModule = input.conversation.type === 'direct'
    ? `@${input.conversation.participants.find(participant => participant !== 'user') ?? 'unknown'}`
    : '@main'

  return JSON.stringify(
    {
      userMessage: input.userMessage,
      replyContext: buildReplyContextPayload(input.replyTo, input.agents),
      workspace: {
        id: input.workspace.id,
        name: input.workspace.name,
        goal: input.workspace.goal,
        projectBrief: input.workspace.projectBrief,
        runtimeStatus: input.workspace.runtimeStatus,
        memberCount: workspaceMembers.length,
        members: workspaceMembers,
      },
      conversation: {
        id: input.conversation.id,
        type: input.conversation.type,
        title: input.conversation.title,
        participants: input.conversation.participants,
        activeModule,
        participantCount: mainConversationMembers.length,
        participantFacts: {
          mainGroupMembers: workspaceMembers,
          childAgents: childAgentIds,
          userId: 'user',
          mainBrainId: 'orchestrator',
        },
        compactBoundary: boundaryAt ?? null,
      },
      availableAgents: agentRegistry,
      memory: {
        pinnedMessages,
        recentMessages,
        retrievedMessages,
        snapshots,
        artifacts,
        changeSets,
        recentAgentRuns,
      },
    },
    null,
    2,
  )
}

/**
 * Builds the synthesis context used after child agents complete.
 * Input: workspace state, original user request, routing turn, and child results. Output: serialized synthesis payload.
 */
export function buildSynthesisContextPackage(input: SynthesisContextInput): string {
  const searchTerms = buildSearchTerms([
    input.workspace.goal,
    input.workspace.projectBrief,
    input.conversation.title,
    input.userMessage,
    input.agentResults.map(result => result.output).join(' '),
  ])
  const artifacts = selectArtifacts(input.state, input.workspace, searchTerms)
  const changeSets = selectChangeSets(input.state, input.workspace, searchTerms)
  const snapshots = selectSnapshots(input.state, input.workspace, input.conversation, searchTerms, false)
  const recentAgentRuns = selectRecentAgentRuns(input.state, input.workspace)
  const workflowEvents = input.state.workflowEvents
    .filter(record => record.workspaceId === input.workspace.id && record.conversationId === input.conversation.id)
    .slice(-16)
    .map(record => ({
      type: record.event.type,
      createdAt: record.createdAt,
      summary:
        'summary' in record.event
          ? compactText(String(record.event.summary), 220)
          : 'message' in record.event
            ? compactText(String(record.event.message), 220)
            : undefined,
    }))

  return JSON.stringify(
    {
      userMessage: input.userMessage,
      workspace: {
        id: input.workspace.id,
        name: input.workspace.name,
        goal: input.workspace.goal,
        projectBrief: input.workspace.projectBrief,
        rootPath: input.workspace.rootPath,
        runtimeStatus: input.workspace.runtimeStatus,
      },
      conversation: {
        id: input.conversation.id,
        type: input.conversation.type,
        title: input.conversation.title,
        participants: input.conversation.participants,
      },
      initialMainBrainTurn: {
        kind: input.routing.kind,
        execution: input.routing.execution,
        finalResponse: input.routing.finalResponse,
        dispatches: input.routing.dispatches,
      },
      childAgentResults: input.agentResults.map(result => ({
        ...result,
        output: compactText(result.output, 1600),
      })),
      localSummaries: input.localSummaries,
      evidence: {
        artifacts,
        changeSets,
        snapshots,
        recentAgentRuns,
        workflowEvents,
      },
      policy: {
        allowFollowUpDispatchSchema: true,
        executeFollowUpDispatchesThisVersion: false,
        finalAnswerStyle: 'project-manager delivery summary for project tasks',
      },
    },
    null,
    2,
  )
}
