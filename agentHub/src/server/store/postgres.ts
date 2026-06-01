import { Pool } from 'pg'
import {
  AgentDefinitionSchema,
  AppStateSchema,
  type AppState,
  type AgentDefinition,
  type AgentRun,
  type AgentSession,
  type AgentSessionMessage,
  type Artifact,
  type ChangeSet,
  type Conversation,
  type ContextSnapshot,
  type DiagnosticLog,
  type Message,
  type TaskHandoff,
  type WorkflowEventRecord,
  type Workspace,
  WorkflowEventRecordSchema,
} from '@shared/contracts'
import { cloneState, type StateMutator, type StateStore } from './types'

const TABLES = {
  workspaces: 'agenthub_workspaces',
  conversations: 'agenthub_conversations',
  messages: 'agenthub_messages',
  agents: 'agenthub_agents',
  agentSessions: 'agenthub_agent_sessions',
  agentSessionMessages: 'agenthub_agent_session_messages',
  taskHandoffs: 'agenthub_task_handoffs',
  agentRuns: 'agenthub_agent_runs',
  artifacts: 'agenthub_artifacts',
  changeSets: 'agenthub_change_sets',
  contextSnapshots: 'agenthub_context_snapshots',
  workflowEvents: 'agenthub_workflow_events',
  diagnosticLogs: 'agenthub_diagnostic_logs',
} as const

const STATE_ROW_ID = 'default'
const STATE_LOCK_ID = 422_024_001

type QueryClient = {
  query: Pool['query']
}

/**
 * Converts optional JSON-compatible data into a database parameter.
 * Input: JSON-compatible value. Output: serialized JSON string or null.
 */
function toJsonParam(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

/**
 * Normalizes a JSONB column into a string array.
 * Input: unknown database value. Output: string array.
 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * Normalizes a JSONB column into an object-like value.
 * Input: unknown database value. Output: object value or empty object.
 */
function asObject<T extends Record<string, unknown>>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as T
  }
  return value as T
}

/**
 * Maps a database row into a workspace entity.
 * Input: raw SQL row. Output: validated workspace entity.
 */
function toWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name),
    goal: String(row.goal),
    workspaceType: row.workspace_type as Workspace['workspaceType'],
    rootPath: String(row.root_path),
    runtimeType: row.runtime_type as Workspace['runtimeType'],
    runtimeStatus: row.runtime_status as Workspace['runtimeStatus'],
    projectBrief: String(row.project_brief),
    pinnedMessageIds: asStringArray(row.pinned_message_ids),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * Maps a database row into a conversation entity.
 * Input: raw SQL row. Output: validated conversation entity.
 */
function toConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    type: row.type as Conversation['type'],
    title: String(row.title),
    participants: asStringArray(row.participants),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * Maps a database row into a message entity.
 * Input: raw SQL row. Output: validated message entity.
 */
function toMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    turnId: row.turn_id === null || row.turn_id === undefined ? undefined : String(row.turn_id),
    senderType: row.sender_type as Message['senderType'],
    senderId: String(row.sender_id),
    content: String(row.content),
    replyTo:
      row.reply_to === null || row.reply_to === undefined
        ? undefined
        : asObject<NonNullable<Message['replyTo']>>(row.reply_to),
    artifacts: (Array.isArray(row.artifacts) ? row.artifacts : []) as Artifact[],
    createdAt: String(row.created_at),
  }
}

/**
 * Maps a database row into an agent definition entity.
 * Input: raw SQL row. Output: validated agent definition entity.
 */
function toAgent(row: Record<string, unknown>): AgentDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    description: String(row.description),
    whenToUse: String(row.when_to_use),
    systemPrompt: String(row.system_prompt),
    modelProvider: row.model_provider as AgentDefinition['modelProvider'],
    model: row.model === null || row.model === undefined ? undefined : String(row.model),
    contextPolicy: asObject<AgentDefinition['contextPolicy']>(row.context_policy),
    tools: asStringArray(row.tools),
    permissions: asObject<AgentDefinition['permissions']>(row.permissions),
    disallowedTools: row.disallowed_tools === null || row.disallowed_tools === undefined
      ? undefined
      : asStringArray(row.disallowed_tools),
    permissionMode: row.permission_mode as AgentDefinition['permissionMode'],
    runtimePolicy: asObject<AgentDefinition['runtimePolicy']>(row.runtime_policy),
    outputSchema: String(row.output_schema),
    isolation: row.isolation as AgentDefinition['isolation'],
    skills: asStringArray(row.skills),
    routingProfile: row.routing_profile === null || row.routing_profile === undefined
      ? undefined
      : asObject<NonNullable<AgentDefinition['routingProfile']>>(row.routing_profile),
    source: row.source as AgentDefinition['source'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function agentParams(agent: AgentDefinition): unknown[] {
  return [
    agent.id,
    agent.name,
    agent.role,
    agent.description,
    agent.whenToUse,
    agent.systemPrompt,
    agent.modelProvider,
    agent.model ?? null,
    toJsonParam(agent.contextPolicy),
    toJsonParam(agent.tools),
    toJsonParam(agent.permissions),
    toJsonParam(agent.disallowedTools),
    agent.permissionMode,
    toJsonParam(agent.runtimePolicy),
    agent.outputSchema,
    agent.isolation,
    toJsonParam(agent.skills),
    toJsonParam(agent.routingProfile),
    agent.source,
    agent.createdAt,
    agent.updatedAt,
  ]
}

async function insertAgentToClient(client: QueryClient, agent: AgentDefinition): Promise<AgentDefinition> {
  const parsed = AgentDefinitionSchema.parse(agent)
  const result = await client.query(
      `
        insert into ${TABLES.agents} (
          id, name, role, description, when_to_use, system_prompt, model_provider, model,
          context_policy, tools, permissions, disallowed_tools, permission_mode, runtime_policy,
          output_schema, isolation, skills, routing_profile, source, created_at, updated_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb,
          $15,$16,$17::jsonb,$18::jsonb,$19,$20,$21
        )
        returning *
      `,
      agentParams(parsed),
  )
  return toAgent(result.rows[0] as Record<string, unknown>)
}

async function updateAgentInClient(client: QueryClient, agent: AgentDefinition): Promise<AgentDefinition> {
  const parsed = AgentDefinitionSchema.parse(agent)
  const params = agentParams(parsed)
  const result = await client.query(
      `
        update ${TABLES.agents}
        set
          name = $2,
          role = $3,
          description = $4,
          when_to_use = $5,
          system_prompt = $6,
          model_provider = $7,
          model = $8,
          context_policy = $9::jsonb,
          tools = $10::jsonb,
          permissions = $11::jsonb,
          disallowed_tools = $12::jsonb,
          permission_mode = $13,
          runtime_policy = $14::jsonb,
          output_schema = $15,
          isolation = $16,
          skills = $17::jsonb,
          routing_profile = $18::jsonb,
          source = $19,
          created_at = $20,
          updated_at = $21
        where id = $1
        returning *
      `,
      params,
  )
  return toAgent(result.rows[0] as Record<string, unknown>)
}

/**
 * Maps a database row into an agent session entity.
 * Input: raw SQL row. Output: validated agent session entity.
 */
function toAgentSession(row: Record<string, unknown>): AgentSession {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    agentId: String(row.agent_id),
    title: String(row.title),
    status: row.status as AgentSession['status'],
    lastHandoffId:
      row.last_handoff_id === null || row.last_handoff_id === undefined ? undefined : String(row.last_handoff_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * Maps a database row into an agent session message entity.
 * Input: raw SQL row. Output: validated session message entity.
 */
function toAgentSessionMessage(row: Record<string, unknown>): AgentSessionMessage {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    agentId: String(row.agent_id),
    senderType: row.sender_type as AgentSessionMessage['senderType'],
    senderId: String(row.sender_id),
    kind: row.kind as AgentSessionMessage['kind'],
    content: String(row.content),
    metadata:
      row.metadata === null || row.metadata === undefined ? undefined : asObject<Record<string, unknown>>(row.metadata),
    createdAt: String(row.created_at),
  }
}

/**
 * Maps a database row into a task handoff entity.
 * Input: raw SQL row. Output: validated task handoff entity.
 */
function toTaskHandoff(row: Record<string, unknown>): TaskHandoff {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    sessionId: String(row.session_id),
    agentId: String(row.agent_id),
    source: row.source as TaskHandoff['source'],
    task: String(row.task),
    requiredContext: asStringArray(row.required_context),
    expectedOutput: String(row.expected_output),
    status: row.status as TaskHandoff['status'],
    resultRunId: row.result_run_id === null || row.result_run_id === undefined ? undefined : String(row.result_run_id),
    resultSummary:
      row.result_summary === null || row.result_summary === undefined ? undefined : String(row.result_summary),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * Maps a database row into an AgentRun entity.
 * Input: raw SQL row. Output: validated agent run entity.
 */
function toAgentRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    agentId: String(row.agent_id),
    sessionId: row.session_id === null || row.session_id === undefined ? undefined : String(row.session_id),
    handoffId: row.handoff_id === null || row.handoff_id === undefined ? undefined : String(row.handoff_id),
    inputContext: String(row.input_context),
    output: String(row.output),
    status: row.status as AgentRun['status'],
    provider: row.provider as AgentRun['provider'],
    logs: asStringArray(row.logs),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at === null || row.finished_at === undefined ? undefined : String(row.finished_at),
    error: row.error === null || row.error === undefined ? undefined : String(row.error),
  }
}

/**
 * Maps a database row into an artifact entity.
 * Input: raw SQL row. Output: validated artifact entity.
 */
function toArtifact(row: Record<string, unknown>): Artifact {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    agentRunId: row.agent_run_id === null || row.agent_run_id === undefined ? undefined : String(row.agent_run_id),
    type: row.type as Artifact['type'],
    title: String(row.title),
    content: String(row.content),
    url: row.url === null || row.url === undefined ? undefined : String(row.url),
    createdByAgentId:
      row.created_by_agent_id === null || row.created_by_agent_id === undefined
        ? undefined
        : String(row.created_by_agent_id),
    metadata: row.metadata === null || row.metadata === undefined ? undefined : asObject<Record<string, unknown>>(row.metadata),
    createdAt: String(row.created_at),
  }
}

/**
 * Maps a database row into a change set entity.
 * Input: raw SQL row. Output: validated change set entity.
 */
function toChangeSet(row: Record<string, unknown>): ChangeSet {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    agentRunId: String(row.agent_run_id),
    baseCommit: String(row.base_commit),
    files: (Array.isArray(row.files) ? row.files : []) as ChangeSet['files'],
    summary: String(row.summary),
    patch: row.patch === null || row.patch === undefined ? undefined : String(row.patch),
    createdAt: String(row.created_at),
  }
}

/**
 * Maps a database row into a context snapshot entity.
 * Input: raw SQL row. Output: validated context snapshot entity.
 */
function toContextSnapshot(row: Record<string, unknown>): ContextSnapshot {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    agentRunId: row.agent_run_id === null || row.agent_run_id === undefined ? undefined : String(row.agent_run_id),
    inputContext: String(row.input_context),
    summary: String(row.summary),
    sourceRefs: asStringArray(row.source_refs),
    tokenEstimate: Number(row.token_estimate),
    createdAt: String(row.created_at),
  }
}

/**
 * Maps a database row into a workflow event record.
 * Input: raw SQL row. Output: validated workflow event record.
 */
function toWorkflowEventRecord(row: Record<string, unknown>): WorkflowEventRecord {
  return WorkflowEventRecordSchema.parse({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    conversationId: String(row.conversation_id),
    event: row.event,
    createdAt: String(row.created_at),
  })
}

/**
 * Maps a database row into a diagnostic log entity.
 * Input: raw SQL row. Output: validated diagnostic log entity.
 */
function toDiagnosticLog(row: Record<string, unknown>): DiagnosticLog {
  return {
    id: String(row.id),
    level: row.level as DiagnosticLog['level'],
    category: row.category as DiagnosticLog['category'],
    workspaceId: String(row.workspace_id),
    conversationId: row.conversation_id === null || row.conversation_id === undefined ? undefined : String(row.conversation_id),
    sessionId: row.session_id === null || row.session_id === undefined ? undefined : String(row.session_id),
    handoffId: row.handoff_id === null || row.handoff_id === undefined ? undefined : String(row.handoff_id),
    runId: row.run_id === null || row.run_id === undefined ? undefined : String(row.run_id),
    agentId: row.agent_id === null || row.agent_id === undefined ? undefined : String(row.agent_id),
    turnId: row.turn_id === null || row.turn_id === undefined ? undefined : String(row.turn_id),
    message: String(row.message),
    data: row.data === null || row.data === undefined ? undefined : asObject<Record<string, unknown>>(row.data),
    createdAt: String(row.created_at),
  }
}

/**
 * Creates the normalized PostgreSQL schema used by the local prototype.
 * Input: none. Output: promise resolved after schema creation.
 */
async function createSchema(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists ${TABLES.workspaces} (
      id text primary key,
      name text not null,
      goal text not null,
      workspace_type text not null,
      root_path text not null,
      runtime_type text not null,
      runtime_status text not null,
      project_brief text not null,
      pinned_message_ids jsonb not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists ${TABLES.conversations} (
      id text primary key,
      workspace_id text not null,
      type text not null,
      title text not null,
      participants jsonb not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists ${TABLES.messages} (
      id text primary key,
      workspace_id text not null,
      conversation_id text not null,
      turn_id text,
      sender_type text not null,
      sender_id text not null,
      content text not null,
      reply_to jsonb,
      artifacts jsonb not null,
      created_at text not null
    );

    create table if not exists ${TABLES.agents} (
      id text primary key,
      name text not null,
      role text not null,
      description text not null,
      when_to_use text not null,
      system_prompt text not null,
      model_provider text not null,
      model text,
      context_policy jsonb not null,
      tools jsonb not null,
      permissions jsonb not null,
      disallowed_tools jsonb,
      permission_mode text not null,
      runtime_policy jsonb not null,
      output_schema text not null,
      isolation text not null,
      skills jsonb not null,
      routing_profile jsonb,
      source text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists ${TABLES.agentSessions} (
      id text primary key,
      workspace_id text not null,
      agent_id text not null,
      title text not null,
      status text not null,
      last_handoff_id text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists ${TABLES.agentSessionMessages} (
      id text primary key,
      workspace_id text not null,
      session_id text not null,
      agent_id text not null,
      sender_type text not null,
      sender_id text not null,
      kind text not null,
      content text not null,
      metadata jsonb,
      created_at text not null
    );

    create table if not exists ${TABLES.taskHandoffs} (
      id text primary key,
      workspace_id text not null,
      conversation_id text not null,
      session_id text not null,
      agent_id text not null,
      source text not null,
      task text not null,
      required_context jsonb not null,
      expected_output text not null,
      status text not null,
      result_run_id text,
      result_summary text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists ${TABLES.agentRuns} (
      id text primary key,
      workspace_id text not null,
      conversation_id text not null,
      agent_id text not null,
      session_id text,
      handoff_id text,
      input_context text not null,
      output text not null,
      status text not null,
      provider text not null,
      logs jsonb not null,
      started_at text not null,
      finished_at text,
      error text
    );

    create table if not exists ${TABLES.artifacts} (
      id text primary key,
      workspace_id text not null,
      agent_run_id text,
      type text not null,
      title text not null,
      content text not null,
      url text,
      created_by_agent_id text,
      metadata jsonb,
      created_at text not null
    );

    create table if not exists ${TABLES.changeSets} (
      id text primary key,
      workspace_id text not null,
      agent_run_id text not null,
      base_commit text not null,
      files jsonb not null,
      summary text not null,
      patch text,
      created_at text not null
    );

    create table if not exists ${TABLES.contextSnapshots} (
      id text primary key,
      workspace_id text not null,
      conversation_id text not null,
      agent_run_id text,
      input_context text not null,
      summary text not null,
      source_refs jsonb not null,
      token_estimate integer not null,
      created_at text not null
    );

    create table if not exists ${TABLES.workflowEvents} (
      id text primary key,
      workspace_id text not null,
      conversation_id text not null,
      type text not null,
      event jsonb not null,
      created_at text not null
    );

    create table if not exists ${TABLES.diagnosticLogs} (
      id text primary key,
      level text not null,
      category text not null,
      workspace_id text not null,
      conversation_id text,
      session_id text,
      handoff_id text,
      run_id text,
      agent_id text,
      turn_id text,
      message text not null,
      data jsonb,
      created_at text not null
    );
  `)

  await pool.query(`
    alter table ${TABLES.messages}
    add column if not exists reply_to jsonb;
  `)
  await pool.query(`
    alter table ${TABLES.messages}
    add column if not exists turn_id text;
  `)

  await pool.query(`alter table ${TABLES.agentRuns} add column if not exists session_id text`)
  await pool.query(`alter table ${TABLES.agentRuns} add column if not exists handoff_id text`)
  await pool.query(`alter table ${TABLES.agents} add column if not exists routing_profile jsonb`)
}

/**
 * Reads the entire normalized application state from PostgreSQL.
 * Input: database client. Output: validated application state.
 */
async function readStateFromDatabase(client: QueryClient): Promise<AppState> {
  const workspaces = await client.query(`select * from ${TABLES.workspaces} order by created_at asc`)
  const conversations = await client.query(`select * from ${TABLES.conversations} order by created_at asc`)
  const messages = await client.query(`select * from ${TABLES.messages} order by created_at asc`)
  const agents = await client.query(`select * from ${TABLES.agents} order by created_at asc`)
  const agentSessions = await client.query(`select * from ${TABLES.agentSessions} order by created_at asc`)
  const agentSessionMessages = await client.query(`select * from ${TABLES.agentSessionMessages} order by created_at asc`)
  const taskHandoffs = await client.query(`select * from ${TABLES.taskHandoffs} order by created_at asc`)
  const agentRuns = await client.query(`select * from ${TABLES.agentRuns} order by started_at asc`)
  const artifacts = await client.query(`select * from ${TABLES.artifacts} order by created_at asc`)
  const changeSets = await client.query(`select * from ${TABLES.changeSets} order by created_at asc`)
  const contextSnapshots = await client.query(`select * from ${TABLES.contextSnapshots} order by created_at asc`)
  const workflowEvents = await client.query(`select * from ${TABLES.workflowEvents} order by created_at asc`)
  const diagnosticLogs = await client.query(`select * from ${TABLES.diagnosticLogs} order by created_at asc`)

  return AppStateSchema.parse({
    workspaces: workspaces.rows.map(row => toWorkspace(row as Record<string, unknown>)),
    conversations: conversations.rows.map(row => toConversation(row as Record<string, unknown>)),
    messages: messages.rows.map(row => toMessage(row as Record<string, unknown>)),
    agents: agents.rows.map(row => toAgent(row as Record<string, unknown>)),
    agentSessions: agentSessions.rows.map(row => toAgentSession(row as Record<string, unknown>)),
    agentSessionMessages: agentSessionMessages.rows.map(row => toAgentSessionMessage(row as Record<string, unknown>)),
    taskHandoffs: taskHandoffs.rows.map(row => toTaskHandoff(row as Record<string, unknown>)),
    agentRuns: agentRuns.rows.map(row => toAgentRun(row as Record<string, unknown>)),
    artifacts: artifacts.rows.map(row => toArtifact(row as Record<string, unknown>)),
    changeSets: changeSets.rows.map(row => toChangeSet(row as Record<string, unknown>)),
    contextSnapshots: contextSnapshots.rows.map(row => toContextSnapshot(row as Record<string, unknown>)),
    workflowEvents: workflowEvents.rows.map(row => toWorkflowEventRecord(row as Record<string, unknown>)),
    diagnosticLogs: diagnosticLogs.rows.map(row => toDiagnosticLog(row as Record<string, unknown>)),
  })
}

/**
 * Replaces the full normalized state in PostgreSQL inside one transaction.
 * Input: transaction client and application state. Output: promise resolved after write.
 */
async function writeStateToDatabase(pool: Pool, state: AppState): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock($1)', [STATE_LOCK_ID])
    await writeStateToClient(client, state)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Replaces the full normalized state in PostgreSQL inside one transaction.
 * Input: transaction client and application state. Output: promise resolved after write.
 */
async function writeStateToClient(client: QueryClient, state: AppState): Promise<void> {
  await client.query(`delete from ${TABLES.diagnosticLogs}`)
  await client.query(`delete from ${TABLES.workflowEvents}`)
  await client.query(`delete from ${TABLES.contextSnapshots}`)
  await client.query(`delete from ${TABLES.changeSets}`)
  await client.query(`delete from ${TABLES.artifacts}`)
  await client.query(`delete from ${TABLES.agentRuns}`)
  await client.query(`delete from ${TABLES.taskHandoffs}`)
  await client.query(`delete from ${TABLES.agentSessionMessages}`)
  await client.query(`delete from ${TABLES.agentSessions}`)
  await client.query(`delete from ${TABLES.messages}`)
  await client.query(`delete from ${TABLES.conversations}`)
  await client.query(`delete from ${TABLES.agents}`)
  await client.query(`delete from ${TABLES.workspaces}`)

  for (const workspace of state.workspaces) {
    await client.query(
        `
          insert into ${TABLES.workspaces} (
            id, name, goal, workspace_type, root_path, runtime_type, runtime_status,
            project_brief, pinned_message_ids, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        `,
        [
          workspace.id,
          workspace.name,
          workspace.goal,
          workspace.workspaceType,
          workspace.rootPath,
          workspace.runtimeType,
          workspace.runtimeStatus,
          workspace.projectBrief,
          toJsonParam(workspace.pinnedMessageIds),
          workspace.createdAt,
          workspace.updatedAt,
        ],
    )
  }

  for (const conversation of state.conversations) {
    await client.query(
        `
          insert into ${TABLES.conversations} (
            id, workspace_id, type, title, participants, created_at, updated_at
          ) values ($1,$2,$3,$4,$5::jsonb,$6,$7)
        `,
        [
          conversation.id,
          conversation.workspaceId,
          conversation.type,
          conversation.title,
          toJsonParam(conversation.participants),
          conversation.createdAt,
          conversation.updatedAt,
        ],
    )
  }

  for (const message of state.messages) {
    await client.query(
        `
          insert into ${TABLES.messages} (
            id, workspace_id, conversation_id, turn_id, sender_type, sender_id, content, reply_to, artifacts, created_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
        `,
        [
          message.id,
          message.workspaceId,
          message.conversationId,
          message.turnId ?? null,
          message.senderType,
          message.senderId,
          message.content,
          toJsonParam(message.replyTo),
          toJsonParam(message.artifacts),
          message.createdAt,
        ],
    )
  }

  for (const agent of state.agents) {
    await insertAgentToClient(client, agent)
  }

  for (const session of state.agentSessions) {
    await client.query(
        `
          insert into ${TABLES.agentSessions} (
            id, workspace_id, agent_id, title, status, last_handoff_id, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          session.id,
          session.workspaceId,
          session.agentId,
          session.title,
          session.status,
          session.lastHandoffId ?? null,
          session.createdAt,
          session.updatedAt,
        ],
    )
  }

  for (const sessionMessage of state.agentSessionMessages) {
    await client.query(
        `
          insert into ${TABLES.agentSessionMessages} (
            id, workspace_id, session_id, agent_id, sender_type, sender_id, kind, content, metadata, created_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        `,
        [
          sessionMessage.id,
          sessionMessage.workspaceId,
          sessionMessage.sessionId,
          sessionMessage.agentId,
          sessionMessage.senderType,
          sessionMessage.senderId,
          sessionMessage.kind,
          sessionMessage.content,
          toJsonParam(sessionMessage.metadata),
          sessionMessage.createdAt,
        ],
    )
  }

  for (const handoff of state.taskHandoffs) {
    await client.query(
        `
          insert into ${TABLES.taskHandoffs} (
            id, workspace_id, conversation_id, session_id, agent_id, source, task, required_context,
            expected_output, status, result_run_id, result_summary, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)
        `,
        [
          handoff.id,
          handoff.workspaceId,
          handoff.conversationId,
          handoff.sessionId,
          handoff.agentId,
          handoff.source,
          handoff.task,
          toJsonParam(handoff.requiredContext),
          handoff.expectedOutput,
          handoff.status,
          handoff.resultRunId ?? null,
          handoff.resultSummary ?? null,
          handoff.createdAt,
          handoff.updatedAt,
        ],
    )
  }

  for (const run of state.agentRuns) {
    await client.query(
        `
          insert into ${TABLES.agentRuns} (
            id, workspace_id, conversation_id, agent_id, session_id, handoff_id, input_context, output, status,
            provider, logs, started_at, finished_at, error
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
        `,
        [
          run.id,
          run.workspaceId,
          run.conversationId,
          run.agentId,
          run.sessionId ?? null,
          run.handoffId ?? null,
          run.inputContext,
          run.output,
          run.status,
          run.provider,
          toJsonParam(run.logs),
          run.startedAt,
          run.finishedAt ?? null,
          run.error ?? null,
        ],
    )
  }

  for (const artifact of state.artifacts) {
    await client.query(
        `
          insert into ${TABLES.artifacts} (
            id, workspace_id, agent_run_id, type, title, content, url, created_by_agent_id,
            metadata, created_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        `,
        [
          artifact.id,
          artifact.workspaceId,
          artifact.agentRunId ?? null,
          artifact.type,
          artifact.title,
          artifact.content,
          artifact.url ?? null,
          artifact.createdByAgentId ?? null,
          toJsonParam(artifact.metadata),
          artifact.createdAt,
        ],
    )
  }

  for (const changeSet of state.changeSets) {
    await client.query(
        `
          insert into ${TABLES.changeSets} (
            id, workspace_id, agent_run_id, base_commit, files, summary, patch, created_at
          ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
        `,
        [
          changeSet.id,
          changeSet.workspaceId,
          changeSet.agentRunId,
          changeSet.baseCommit,
          toJsonParam(changeSet.files),
          changeSet.summary,
          changeSet.patch ?? null,
          changeSet.createdAt,
        ],
    )
  }

  for (const workflowEvent of state.workflowEvents) {
    await client.query(
        `
          insert into ${TABLES.workflowEvents} (
            id, workspace_id, conversation_id, type, event, created_at
          ) values ($1,$2,$3,$4,$5::jsonb,$6)
        `,
        [
          workflowEvent.id,
          workflowEvent.workspaceId,
          workflowEvent.conversationId,
          workflowEvent.event.type,
          toJsonParam(workflowEvent.event),
          workflowEvent.createdAt,
        ],
    )
  }

  for (const snapshot of state.contextSnapshots) {
    await client.query(
        `
          insert into ${TABLES.contextSnapshots} (
            id, workspace_id, conversation_id, agent_run_id, input_context, summary, source_refs,
            token_estimate, created_at
          ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
        `,
        [
          snapshot.id,
          snapshot.workspaceId,
          snapshot.conversationId,
          snapshot.agentRunId ?? null,
          snapshot.inputContext,
          snapshot.summary,
          toJsonParam(snapshot.sourceRefs),
          snapshot.tokenEstimate,
          snapshot.createdAt,
        ],
    )
  }

  for (const log of state.diagnosticLogs) {
    await client.query(
        `
          insert into ${TABLES.diagnosticLogs} (
            id, level, category, workspace_id, conversation_id, session_id, handoff_id, run_id,
            agent_id, turn_id, message, data, created_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
        `,
        [
          log.id,
          log.level,
          log.category,
          log.workspaceId,
          log.conversationId ?? null,
          log.sessionId ?? null,
          log.handoffId ?? null,
          log.runId ?? null,
          log.agentId ?? null,
          log.turnId ?? null,
          log.message,
          toJsonParam(log.data),
          log.createdAt,
        ],
    )
  }

}

export class PostgresStateStore implements StateStore {
  mode = 'postgres' as const
  private updateQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly pool: Pool,
    private readonly seed: AppState,
  ) {}

  /**
   * Ensures the normalized schema exists and the seed row is present.
   * Input: none. Output: promise resolved after schema and seed setup.
   */
  async init(): Promise<void> {
    await createSchema(this.pool)
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock($1)', [STATE_LOCK_ID])
      const result = await client.query(`select count(*)::int as count from ${TABLES.workspaces}`)
      if ((result.rows[0]?.count ?? 0) === 0) {
        await writeStateToClient(client, AppStateSchema.parse(this.seed))
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Reads the validated application state from PostgreSQL.
   * Input: none. Output: detached application state copy.
   */
  async read(): Promise<AppState> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock($1)', [STATE_LOCK_ID])
      const result = await client.query(`select count(*)::int as count from ${TABLES.workspaces}`)
      if ((result.rows[0]?.count ?? 0) === 0) {
        await client.query('commit')
        return cloneState(this.seed)
      }
      const state = await readStateFromDatabase(client)
      await client.query('commit')
      return state
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Mutates the application state row inside a transaction.
   * Input: mutation callback. Output: callback return value.
   */
  async update<T>(mutator: StateMutator<T>): Promise<T> {
    return this.enqueueUpdate(() => this.applyUpdate(mutator))
  }

  async createAgent(agent: AgentDefinition): Promise<AgentDefinition> {
    return this.enqueueUpdate(() => this.applyCreateAgent(agent))
  }

  async updateAgent(
    agentId: string,
    updater: (agent: AgentDefinition) => AgentDefinition,
  ): Promise<AgentDefinition | undefined> {
    return this.enqueueUpdate(() => this.applyAgentUpdate(agentId, updater))
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    return this.enqueueUpdate(() => this.applyAgentDelete(agentId))
  }

  private enqueueUpdate<T>(operationFactory: () => Promise<T>): Promise<T> {
    const operation = this.updateQueue.then(operationFactory, operationFactory)
    this.updateQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  /**
   * Mutates the application state row inside a queued transaction.
   * Input: mutation callback. Output: callback return value.
   */
  private async applyUpdate<T>(mutator: StateMutator<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock($1)', [STATE_LOCK_ID])
      const current = await readStateFromDatabase(client)
      const draft = cloneState(current)
      const value = mutator(draft)
      const next = AppStateSchema.parse(draft)
      await writeStateToClient(client, next)
      await client.query('commit')
      return value
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  private async applyCreateAgent(agent: AgentDefinition): Promise<AgentDefinition> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock($1)', [STATE_LOCK_ID])
      const existing = await client.query(`select id from ${TABLES.agents} where id = $1`, [agent.id])
      if (existing.rowCount && existing.rowCount > 0) {
        throw new Error(`Agent already exists: ${agent.id}`)
      }
      const created = await insertAgentToClient(client, agent)
      await client.query('commit')
      return created
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  private async applyAgentUpdate(
    agentId: string,
    updater: (agent: AgentDefinition) => AgentDefinition,
  ): Promise<AgentDefinition | undefined> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock($1)', [STATE_LOCK_ID])
      const existing = await client.query(`select * from ${TABLES.agents} where id = $1`, [agentId])
      const current = existing.rows[0] ? toAgent(existing.rows[0] as Record<string, unknown>) : undefined
      if (!current) {
        await client.query('commit')
        return undefined
      }
      const updated = await updateAgentInClient(client, updater(current))
      await client.query('commit')
      return updated
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  private async applyAgentDelete(agentId: string): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock($1)', [STATE_LOCK_ID])
      const result = await client.query(`delete from ${TABLES.agents} where id = $1`, [agentId])
      await client.query('commit')
      return Boolean(result.rowCount && result.rowCount > 0)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }
}

/**
 * Creates a pooled PostgreSQL-backed state store.
 * Input: database URL and initial state. Output: initialized state store.
 */
export async function createPostgresStateStore(databaseUrl: string, seed: AppState): Promise<PostgresStateStore> {
  const store = new PostgresStateStore(new Pool({ connectionString: databaseUrl }), seed)
  await store.init()
  return store
}
