import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createInterface, type Interface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type {
  AgentDefinition,
  AppState,
  Conversation,
  Message,
  SendMessageInput,
  Workspace,
} from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import { readEnv, type ServerEnv } from '../server/env'
import { createStateStore } from '../server/store'
import type { StateStore } from '../server/store/types'
import { createLocalToolGateway, type LocalToolGateway } from '../server/tool-gateway'
import { WorkspaceRuntimeManager } from '../server/runtime/workspace'
import { handleUserMessage, type WorkflowServices } from '../server/orchestrator/workflow'
import {
  compactLine,
  formatAgentRun,
  formatDiagnosticLog,
  formatTaskHandoff,
  formatWorkflowEvent,
} from './event-formatters'
import {
  printAgentOutputStreamEvent,
  printAssistantStreamEvent,
} from './stream-printer'

type ChatArgs = {
  createNewWorkspace: boolean
  createWorkspaceOnly: boolean
  mockAgents: boolean
  once?: string
}

type ChatSession = {
  env: ServerEnv
  store: StateStore
  runtime: WorkspaceRuntimeManager
  toolGateway: LocalToolGateway
  workspace: Workspace
  mainConversation: Conversation
  activeConversation: Conversation
  activeAgentId?: string
}

type ChatTarget =
  | {
      kind: 'main'
      content: string
    }
  | {
      kind: 'agent'
      agent: AgentDefinition
      content: string
    }

/**
 * Parses CLI flags for the local chat runner.
 * Input: raw process arguments. Output: normalized chat arguments.
 */
function parseArgs(argv: string[]): ChatArgs {
  const args: ChatArgs = {
    createNewWorkspace: false,
    createWorkspaceOnly: false,
    mockAgents: false,
  }
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === 'new') {
      args.createNewWorkspace = true
    } else if (arg === '--new-workspace') {
      args.createWorkspaceOnly = true
    } else if (arg === '--mock') {
      args.mockAgents = true
    } else if (arg === '--once') {
      args.once = argv[index + 1]
      index += 1
    } else {
      positionals.push(arg)
    }
  }

  if (args.once === undefined && positionals.length > 0) {
    args.once = positionals.join(' ')
  }

  return args
}

/**
 * Creates a new default CLI workspace and exits without entering chat.
 * Input: chat args. Output: printed workspace summary.
 */
async function createWorkspaceAndExit(args: ChatArgs): Promise<void> {
  const env = readCliEnv(args)
  const store = await createStateStore(env)
  const toolGateway = createLocalToolGateway(env)
  const runtime = new WorkspaceRuntimeManager(env.AGENTHUB_RUNTIME_ROOT, toolGateway)
  const created = await createCliWorkspace(store, runtime)
  console.log(`Created workspace: ${created.workspace.name} (${created.workspace.id})`)
  console.log(`Repo: ${runtime.repoPathFor(created.workspace.id)}`)
  console.log('Run `npm run chat` to enter this workspace.')
}

/**
 * Reads CLI environment and prefers PostgreSQL when DATABASE_URL is available.
 * Input: chat arguments and process environment. Output: validated server environment.
 */
function readCliEnv(args: ChatArgs): ServerEnv {
  const env = readEnv()
  return {
    ...env,
    AGENTHUB_STORAGE: process.env.AGENTHUB_STORAGE ? env.AGENTHUB_STORAGE : env.DATABASE_URL ? 'postgres' : env.AGENTHUB_STORAGE,
    AGENTHUB_REAL_AGENTS: args.mockAgents ? false : env.AGENTHUB_REAL_AGENTS,
  }
}

/**
 * Creates a default workspace record for CLI usage.
 * Input: optional name and goal. Output: workspace record.
 */
function createWorkspaceRecord(name?: string, goal?: string): Workspace {
  const now = isoNow()
  const id = `ws-${randomUUID()}`
  return {
    id,
    name: name?.trim() || `AgentHub CLI Workspace ${now.slice(0, 10)}`,
    goal: goal?.trim() || '通过本地 CLI 验证 AgentHub 主脑、上下文和子 Agent 私聊链路。',
    workspaceType: 'dev',
    rootPath: `data/workspaces/${id}/repo`,
    runtimeType: 'local',
    runtimeStatus: 'ready',
    projectBrief: goal?.trim() || '本工作区用于本地 CLI 验证。',
    pinnedMessageIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Creates a group or direct conversation record.
 * Input: workspace id, type, title, and participants. Output: conversation record.
 */
function createConversationRecord(
  workspaceId: string,
  type: Conversation['type'],
  title: string,
  participants: string[],
): Conversation {
  const now = isoNow()
  return {
    id: `conv-${randomUUID()}`,
    workspaceId,
    type,
    title,
    participants,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Selects the most recently active workspace from state.
 * Input: current application state. Output: latest workspace or undefined.
 */
function latestWorkspace(state: AppState): Workspace | undefined {
  return [...state.workspaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

/**
 * Finds the main group conversation for a workspace.
 * Input: current state and workspace id. Output: group conversation or undefined.
 */
function findGroupConversation(state: AppState, workspaceId: string): Conversation | undefined {
  return state.conversations
    .filter(conversation => conversation.workspaceId === workspaceId && conversation.type === 'group')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

/**
 * Finds a direct conversation between the user and one agent.
 * Input: state, workspace id, and agent id. Output: direct conversation or undefined.
 */
function findDirectConversation(state: AppState, workspaceId: string, agentId: string): Conversation | undefined {
  return state.conversations.find(
    conversation =>
      conversation.workspaceId === workspaceId &&
      conversation.type === 'direct' &&
      conversation.participants.includes('user') &&
      conversation.participants.includes(agentId),
  )
}

/**
 * Creates and persists a new CLI workspace plus its default group conversation.
 * Input: store, runtime, optional readline, and default flag. Output: created workspace and group conversation.
 */
async function createCliWorkspace(
  store: StateStore,
  runtime: WorkspaceRuntimeManager,
  rl?: Interface,
): Promise<{ workspace: Workspace; conversation: Conversation }> {
  const name = rl ? await rl.question('Workspace name (Enter for default): ') : undefined
  const goal = rl ? await rl.question('Workspace goal (Enter for default): ') : undefined
  const workspace = createWorkspaceRecord(name, goal)
  const conversation = createConversationRecord(workspace.id, 'group', '项目主群聊', [
    'user',
    'orchestrator',
    'product-manager',
    'engineer',
    'reviewer',
  ])

  await runtime.prepareWorkspace(workspace)
  await store.update(state => {
    state.workspaces.push(workspace)
    state.conversations.push(conversation)
  })

  return { workspace, conversation }
}

/**
 * Ensures a workspace has a main group conversation.
 * Input: store and workspace. Output: existing or newly created group conversation.
 */
async function ensureGroupConversation(store: StateStore, workspace: Workspace): Promise<Conversation> {
  const state = await store.read()
  const existing = findGroupConversation(state, workspace.id)
  if (existing) {
    return existing
  }

  const conversation = createConversationRecord(workspace.id, 'group', '项目主群聊', [
    'user',
    'orchestrator',
    'product-manager',
    'engineer',
    'reviewer',
  ])
  await store.update(nextState => {
    nextState.conversations.push(conversation)
  })
  return conversation
}

/**
 * Ensures a direct conversation exists for a child agent.
 * Input: store, workspace, and agent. Output: existing or new direct conversation.
 */
async function ensureDirectConversation(
  store: StateStore,
  workspace: Workspace,
  agent: AgentDefinition,
): Promise<Conversation> {
  const state = await store.read()
  const existing = findDirectConversation(state, workspace.id, agent.id)
  if (existing) {
    return existing
  }

  const conversation = createConversationRecord(workspace.id, 'direct', `${agent.name} 私聊`, ['user', agent.id])
  await store.update(nextState => {
    nextState.conversations.push(conversation)
  })
  return conversation
}

/**
 * Creates the starting chat session from storage and runtime state.
 * Input: chat args and optional readline. Output: ready chat session.
 */
async function createChatSession(args: ChatArgs, rl?: Interface): Promise<ChatSession> {
  const env = readCliEnv(args)
  const store = await createStateStore(env)
  const toolGateway = createLocalToolGateway(env)
  const runtime = new WorkspaceRuntimeManager(env.AGENTHUB_RUNTIME_ROOT, toolGateway)

  if (args.createNewWorkspace) {
    const created = await createCliWorkspace(store, runtime, rl)
    return {
      env,
      store,
      runtime,
      toolGateway,
      workspace: created.workspace,
      mainConversation: created.conversation,
      activeConversation: created.conversation,
    }
  }

  const state = await store.read()
  const existingWorkspace = latestWorkspace(state)
  if (!existingWorkspace) {
    const created = await createCliWorkspace(store, runtime, rl)
    return {
      env,
      store,
      runtime,
      toolGateway,
      workspace: created.workspace,
      mainConversation: created.conversation,
      activeConversation: created.conversation,
    }
  }

  await runtime.prepareWorkspace(existingWorkspace)
  const conversation = await ensureGroupConversation(store, existingWorkspace)
  return {
    env,
    store,
    runtime,
    toolGateway,
    workspace: existingWorkspace,
    mainConversation: conversation,
    activeConversation: conversation,
  }
}

/**
 * Prints the initial CLI session banner.
 * Input: chat session. Output: text written to stdout.
 */
function printBanner(session: ChatSession): void {
  console.log('')
  console.log(`AgentHub CLI chat`)
  console.log(`Workspace: ${session.workspace.name} (${session.workspace.id})`)
  console.log(`Conversation: ${session.activeConversation.title} (${activeModuleName(session)})`)
  console.log(`Storage: ${session.store.mode}`)
  console.log(`Real agents: ${session.env.AGENTHUB_REAL_AGENTS}`)
  console.log(`Orchestrator: ${session.env.AGENTHUB_ORCHESTRATOR_PROVIDER}/${session.env.AGENTHUB_ORCHESTRATOR_MODEL ?? 'unset'}`)
  console.log(`Router: ${session.env.AGENTHUB_ORCHESTRATOR_PROVIDER}/${session.env.AGENTHUB_ROUTER_MODEL}`)
  console.log('')
  console.log('Commands: /agents /workspace /where /convs /logs /runs /handoffs /sessions /session /main /new /exit')
  console.log('Switch modules with @main, @engineer, @product-manager, or @reviewer.')
  console.log('Inside @agent modules, use /run <task> to start a real Claude Code or Codex run.')
  console.log('')
}

/**
 * Returns the active chat module label used by prompts and status lines.
 * Input: chat session. Output: @main or @agent id label.
 */
function activeModuleName(session: ChatSession): string {
  return session.activeAgentId ? `@${session.activeAgentId}` : '@main'
}

/**
 * Builds the interactive prompt for the active workspace and module.
 * Input: chat session. Output: prompt text.
 */
function buildPrompt(session: ChatSession): string {
  return `agenthub:${session.workspace.name}/${activeModuleName(session)}> `
}

/**
 * Prints available agents in the current state.
 * Input: application state. Output: text written to stdout.
 */
function printAgents(state: AppState): void {
  for (const agent of state.agents) {
    console.log(`- ${agent.id} | ${agent.name} | provider=${agent.modelProvider} | mode=${agent.permissionMode}`)
  }
}

/**
 * Prints conversations for the active workspace.
 * Input: application state and workspace id. Output: text written to stdout.
 */
function printConversations(state: AppState, workspaceId: string): void {
  const conversations = state.conversations.filter(conversation => conversation.workspaceId === workspaceId)
  for (const conversation of conversations) {
    console.log(`- ${conversation.id} | ${conversation.type} | ${conversation.title} | updated=${conversation.updatedAt}`)
  }
}

/**
 * Prints persisted workflow events for the active workspace.
 * Input: application state and workspace identity. Output: text written to stdout.
 */
function printWorkflowEvents(state: AppState, workspaceId: string, conversationId?: string): void {
  const events = state.workflowEvents
    .filter(record => record.workspaceId === workspaceId)
    .filter(record => !conversationId || record.conversationId === conversationId)
    .slice(-20)

  if (!events.length) {
    console.log('- no workflow events recorded')
    return
  }

  for (const record of events) {
    console.log(`[${record.createdAt}] ${formatWorkflowEvent(record.event)}`)
  }
}

/**
 * Prints persisted diagnostic logs for the active workspace.
 * Input: application state, workspace id, and optional conversation id. Output: text written to stdout.
 */
function printDiagnosticLogs(state: AppState, workspaceId: string, conversationId?: string): void {
  const logs = state.diagnosticLogs
    .filter(log => log.workspaceId === workspaceId)
    .filter(log => !conversationId || log.conversationId === conversationId)
    .slice(-24)

  if (!logs.length) {
    console.log('- no diagnostic logs recorded')
    return
  }

  for (const log of logs) {
    console.log(`[${log.createdAt}] ${formatDiagnosticLog(log)}`)
  }
}

/**
 * Prints a compact turn replay for the latest turn in the current conversation.
 * Input: state, workspace id, and conversation id. Output: text written to stdout.
 */
function printLatestTurnLogs(state: AppState, workspaceId: string, conversationId: string): void {
  const latestTurnId = [...state.workflowEvents]
    .filter(record => record.workspaceId === workspaceId && record.conversationId === conversationId)
    .map(record => record.event.turnId)
    .filter((turnId): turnId is string => Boolean(turnId))
    .at(-1)

  if (!latestTurnId) {
    console.log('- no turn id recorded')
    return
  }

  const events = state.workflowEvents.filter(record => record.event.turnId === latestTurnId)
  console.log(`turn: ${latestTurnId}`)
  for (const record of events) {
    console.log(`[${record.createdAt}] ${formatWorkflowEvent(record.event)}`)
  }
}

/**
 * Prints recent agent runs for the active workspace.
 * Input: state and workspace id. Output: text written to stdout.
 */
function printAgentRuns(state: AppState, workspaceId: string): void {
  const runs = state.agentRuns
    .filter(run => run.workspaceId === workspaceId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 12)

  if (!runs.length) {
    console.log('- no agent runs recorded')
    return
  }

  for (const run of runs) {
    console.log(formatAgentRun(state, run))
  }
}

/**
 * Prints recent handoffs for the active workspace.
 * Input: state and workspace id. Output: text written to stdout.
 */
function printTaskHandoffs(state: AppState, workspaceId: string): void {
  const handoffs = state.taskHandoffs
    .filter(handoff => handoff.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)

  if (!handoffs.length) {
    console.log('- no task handoffs recorded')
    return
  }

  for (const handoff of handoffs) {
    console.log(formatTaskHandoff(state, handoff))
  }
}

/**
 * Prints agent sessions for the active workspace.
 * Input: state and workspace id. Output: text written to stdout.
 */
function printAgentSessions(state: AppState, workspaceId: string): void {
  const sessions = state.agentSessions
    .filter(session => session.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  if (!sessions.length) {
    console.log('- no agent sessions recorded')
    return
  }

  for (const session of sessions) {
    const agentName = state.agents.find(agent => agent.id === session.agentId)?.name ?? session.agentId
    const messageCount = state.agentSessionMessages.filter(message => message.sessionId === session.id).length
    console.log(`- ${session.id} | ${agentName} | ${session.status} | messages=${messageCount} | lastHandoff=${session.lastHandoffId ?? 'none'} | updated=${session.updatedAt}`)
  }
}

/**
 * Prints the active agent session history.
 * Input: state, workspace id, and active agent id. Output: text written to stdout.
 */
function printActiveAgentSession(state: AppState, workspaceId: string, agentId?: string): void {
  if (!agentId) {
    console.log('- switch to @agent before using /session')
    return
  }

  const session = [...state.agentSessions]
    .filter(candidate => candidate.workspaceId === workspaceId && candidate.agentId === agentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!session) {
    console.log(`- no session recorded for ${agentId}`)
    return
  }

  console.log(`${session.id} | ${agentId} | ${session.status} | lastHandoff=${session.lastHandoffId ?? 'none'}`)
  const messages = state.agentSessionMessages
    .filter(message => message.sessionId === session.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-16)
  for (const message of messages) {
    console.log(`[${message.createdAt}] ${message.kind} ${message.senderId}: ${compactLine(message.content, 180)}`)
  }
}

/**
 * Builds alias strings for matching @mentions.
 * Input: agent definition. Output: lowercase aliases.
 */
function agentAliases(agent: AgentDefinition): string[] {
  return [agent.id, agent.name, agent.name.split(/\s+/)[0]].map(alias => alias.toLowerCase())
}

/**
 * Parses an optional @main or @agent target from a user input line.
 * Input: raw input and available agents. Output: matched target and remaining task text.
 */
function parseChatTarget(line: string, agents: AgentDefinition[]): ChatTarget | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('@')) {
    return undefined
  }

  const body = trimmed.slice(1).trim()
  const lowerBody = body.toLowerCase()
  if (lowerBody === 'main' || lowerBody.startsWith('main ')) {
    return {
      kind: 'main',
      content: body.slice('main'.length).trim(),
    }
  }

  const matches = agents
    .flatMap(agent => agentAliases(agent).map(alias => ({ agent, alias })))
    .sort((a, b) => b.alias.length - a.alias.length)
  const matched = matches.find(match => lowerBody.startsWith(match.alias))
  if (!matched) {
    return undefined
  }

  return {
    kind: 'agent',
    agent: matched.agent,
    content: body.slice(matched.alias.length).trim(),
  }
}

/**
 * Finds the active child agent definition for the current session.
 * Input: application state and chat session. Output: active agent or undefined for @main.
 */
function activeAgent(state: AppState, session: ChatSession): AgentDefinition | undefined {
  return session.activeAgentId ? state.agents.find(agent => agent.id === session.activeAgentId) : undefined
}

/**
 * Converts a preview URL into a local runtime file path when possible.
 * Input: runtime manager and artifact URL. Output: local path or original URL.
 */
function resolveArtifactLocation(runtime: WorkspaceRuntimeManager, url: string): string {
  const match = url.match(/^\/preview\/([^/]+)\/(.+)$/)
  if (!match) {
    return url
  }
  return path.join(runtime.repoPathFor(match[1]), match[2])
}

/**
 * Prints new non-user messages and their artifact locations.
 * Input: runtime manager, agents, and new messages. Output: text written to stdout.
 */
function printNewMessages(
  runtime: WorkspaceRuntimeManager,
  agents: AgentDefinition[],
  messages: Message[],
  streamedMessageIds: Set<string>,
): void {
  const printableMessages = messages.filter(candidate => candidate.senderType !== 'user' && !streamedMessageIds.has(candidate.id))
  for (const message of printableMessages) {
    const sender = agents.find(agent => agent.id === message.senderId)?.name ?? message.senderId
    console.log('')
    console.log(`[${sender}]`)
    console.log(message.content)
    for (const artifact of message.artifacts) {
      const location = artifact.url ? resolveArtifactLocation(runtime, artifact.url) : artifact.content
      console.log(`  artifact: ${artifact.type} | ${artifact.title} | ${location}`)
    }
  }
  if (printableMessages.length) {
    console.log('')
  }
}

/**
 * Switches the active module without sending a task.
 * Input: chat session, target, and application state. Output: updated chat session.
 */
async function switchChatTarget(session: ChatSession, target: ChatTarget, state: AppState): Promise<ChatSession> {
  if (target.kind === 'main') {
    console.log('Switched to @main.')
    return {
      ...session,
      activeConversation: session.mainConversation,
      activeAgentId: undefined,
    }
  }

  const agent = state.agents.find(candidate => candidate.id === target.agent.id) ?? target.agent
  const conversation = await ensureDirectConversation(session.store, session.workspace, agent)
  console.log(`Switched to @${agent.id}.`)
  return {
    ...session,
    activeConversation: conversation,
    activeAgentId: agent.id,
  }
}

/**
 * Resolves the conversation and direct-agent id for a target message.
 * Input: session, target, and state. Output: conversation and optional agent id.
 */
async function resolveMessageRoute(
  session: ChatSession,
  target: ChatTarget,
  state: AppState,
): Promise<{ conversation: Conversation; agentId?: string }> {
  if (target.kind === 'main') {
    return {
      conversation: session.mainConversation,
    }
  }

  const agent = state.agents.find(candidate => candidate.id === target.agent.id) ?? target.agent
  return {
    conversation: await ensureDirectConversation(session.store, session.workspace, agent),
    agentId: agent.id,
  }
}

/**
 * Builds the active target when a line does not contain an inline @target.
 * Input: current application state, session, and content. Output: active chat target.
 */
function currentChatTarget(state: AppState, session: ChatSession, content: string): ChatTarget {
  const agent = activeAgent(state, session)
  if (agent) {
    return {
      kind: 'agent',
      agent,
      content,
    }
  }
  return {
    kind: 'main',
    content,
  }
}

/**
 * Sends one line of chat input through the active module or an inline @target.
 * Input: chat session and raw user line. Output: updated chat session.
 */
async function sendChatLine(session: ChatSession, line: string): Promise<ChatSession> {
  const beforeState = await session.store.read()
  const beforeIds = new Set(beforeState.messages.map(message => message.id))
  const parsedTarget = parseChatTarget(line, beforeState.agents)
  const target = parsedTarget ?? currentChatTarget(beforeState, session, line.trim())
  const switchedSession = parsedTarget ? await switchChatTarget(session, parsedTarget, beforeState) : session
  const content = target.content.trim()

  if (!content) {
    return switchedSession
  }

  const { conversation, agentId } = await resolveMessageRoute(switchedSession, target, beforeState)
  const inputPayload: SendMessageInput = {
    workspaceId: switchedSession.workspace.id,
    conversationId: conversation.id,
    content,
    agentId,
  }
  const streamedMessageIds = new Set<string>()

  const services: WorkflowServices = {
    env: switchedSession.env,
    store: switchedSession.store,
    runtime: switchedSession.runtime,
    toolGateway: switchedSession.toolGateway,
    eventSink: event => {
      if (printAssistantStreamEvent(event, streamedMessageIds)) {
        return
      }
      if (printAgentOutputStreamEvent(event)) {
        return
      }
      console.log(formatWorkflowEvent(event))
    },
  }
  const nextState = await handleUserMessage(inputPayload, services)
  const newMessages = nextState.messages.filter(message => !beforeIds.has(message.id))
  printNewMessages(switchedSession.runtime, nextState.agents, newMessages, streamedMessageIds)
  return {
    ...switchedSession,
    activeConversation: conversation,
    activeAgentId: agentId,
  }
}

/**
 * Handles built-in slash commands for the CLI REPL.
 * Input: chat session, current line, and readline. Output: updated session or exit signal.
 */
async function handleCommand(
  session: ChatSession,
  line: string,
  rl: Interface,
): Promise<{ session: ChatSession; shouldExit: boolean }> {
  const state = await session.store.read()
  if (line === '/exit') {
    return { session, shouldExit: true }
  }
  if (line === '/agents') {
    printAgents(state)
    return { session, shouldExit: false }
  }
  if (line === '/workspace') {
    console.log(`${session.workspace.name} | ${session.workspace.id} | ${session.workspace.goal}`)
    return { session, shouldExit: false }
  }
  if (line === '/where') {
    console.log(`${session.workspace.name} | ${session.workspace.id} | ${activeModuleName(session)} | ${session.activeConversation.title}`)
    return { session, shouldExit: false }
  }
  if (line === '/convs') {
    printConversations(state, session.workspace.id)
    return { session, shouldExit: false }
  }
  if (line === '/logs') {
    printWorkflowEvents(state, session.workspace.id, session.activeConversation.id)
    return { session, shouldExit: false }
  }
  if (line === '/logs --debug') {
    printDiagnosticLogs(state, session.workspace.id, session.activeConversation.id)
    return { session, shouldExit: false }
  }
  if (line === '/logs --turn') {
    printLatestTurnLogs(state, session.workspace.id, session.activeConversation.id)
    return { session, shouldExit: false }
  }
  if (line === '/runs') {
    printAgentRuns(state, session.workspace.id)
    return { session, shouldExit: false }
  }
  if (line === '/handoffs') {
    printTaskHandoffs(state, session.workspace.id)
    return { session, shouldExit: false }
  }
  if (line === '/sessions') {
    printAgentSessions(state, session.workspace.id)
    return { session, shouldExit: false }
  }
  if (line === '/session') {
    printActiveAgentSession(state, session.workspace.id, session.activeAgentId)
    return { session, shouldExit: false }
  }
  if (line === '/main' || line === '/group') {
    console.log('Switched to @main.')
    return {
      session: {
        ...session,
        activeConversation: session.mainConversation,
        activeAgentId: undefined,
      },
      shouldExit: false,
    }
  }
  if (line === '/new') {
    const created = await createCliWorkspace(session.store, session.runtime, rl)
    console.log(`Created workspace ${created.workspace.name}.`)
    return {
      session: {
        ...session,
        workspace: created.workspace,
        mainConversation: created.conversation,
        activeConversation: created.conversation,
        activeAgentId: undefined,
      },
      shouldExit: false,
    }
  }

  console.log('Unknown command. Use /agents /workspace /where /convs /logs /runs /handoffs /sessions /session /main /new /exit.')
  return { session, shouldExit: false }
}

/**
 * Runs a single non-interactive chat line for smoke tests.
 * Input: chat args. Output: process exit code through thrown errors.
 */
async function runOnce(args: ChatArgs): Promise<void> {
  const session = await createChatSession(args)
  printBanner(session)
  await sendChatLine(session, args.once ?? '')
}

/**
 * Runs the interactive AgentHub CLI chat loop.
 * Input: chat args. Output: promise resolved after the user exits.
 */
async function runInteractive(args: ChatArgs): Promise<void> {
  const rl = createInterface({ input, output })
  try {
    let session = await createChatSession(args, args.createNewWorkspace ? rl : undefined)
    printBanner(session)

    while (true) {
      const line = (await rl.question(buildPrompt(session))).trim()
      if (!line) {
        continue
      }

      if (line.startsWith('/') && !(session.activeAgentId && line.toLowerCase().startsWith('/run'))) {
        const result = await handleCommand(session, line, rl)
        session = result.session
        if (result.shouldExit) {
          break
        }
        continue
      }

      session = await sendChatLine(session, line)
    }
  } finally {
    rl.close()
  }
}

/**
 * Starts the CLI entrypoint.
 * Input: process arguments. Output: completed CLI session.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.createWorkspaceOnly) {
    await createWorkspaceAndExit(args)
    return
  }
  if (args.once !== undefined) {
    await runOnce(args)
    return
  }
  if (!process.stdin.isTTY) {
    throw new Error('Interactive chat requires a TTY. Pass a one-shot message argument for non-interactive use.')
  }
  await runInteractive(args)
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
