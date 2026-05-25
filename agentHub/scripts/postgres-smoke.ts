import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isoNow, type AppState } from '../src/shared/contracts'
import { readEnv } from '../src/server/env'
import { createSeedState } from '../src/server/store/seed'
import { createPostgresStateStore } from '../src/server/store/postgres'
import { cloneState } from '../src/server/store/types'

const ArgsSchema = z.object({
  databaseUrl: z.string().min(1),
})

type SmokeArgs = z.infer<typeof ArgsSchema>

/**
 * Parses CLI flags for the PostgreSQL smoke script.
 * Input: raw process arguments and optional env fallback. Output: validated smoke arguments.
 */
function parseArgs(argv: string[], fallbackDatabaseUrl?: string): SmokeArgs {
  let databaseUrl: string | undefined = fallbackDatabaseUrl
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--database-url=')) {
      databaseUrl = arg.slice('--database-url='.length)
    } else if (arg === '--database-url') {
      databaseUrl = argv[index + 1]
      index += 1
    } else if (!arg.startsWith('--') && !databaseUrl) {
      databaseUrl = arg
    }
  }

  return ArgsSchema.parse({ databaseUrl })
}

/**
 * Assigns a deep-cloned state onto the mutable store snapshot.
 * Input: target state and source state. Output: none.
 */
function replaceState(target: AppState, source: AppState): void {
  Object.assign(target, cloneState(source))
}

/**
 * Builds a disposable smoke state that exercises every normalized table.
 * Input: current database baseline. Output: augmented state for verification.
 */
function buildSmokeState(baseline: AppState): AppState {
  const now = isoNow()
  const workspaceId = `ws-smoke-${randomUUID()}`
  const conversationId = `conv-smoke-${randomUUID()}`
  const runId = `run-smoke-${randomUUID()}`
  const sessionId = `session-smoke-${randomUUID()}`
  const sessionMessageId = `session-msg-smoke-${randomUUID()}`
  const handoffId = `handoff-smoke-${randomUUID()}`
  const artifactId = `artifact-smoke-${randomUUID()}`
  const changeSetId = `changeset-smoke-${randomUUID()}`
  const snapshotId = `snapshot-smoke-${randomUUID()}`
  const workflowEventId = `workflow-event-smoke-${randomUUID()}`
  const diagnosticLogId = `diag-smoke-${randomUUID()}`

  return {
    ...cloneState(baseline),
    workspaces: [
      ...baseline.workspaces,
      {
        id: workspaceId,
        name: 'PostgreSQL Smoke Workspace',
        goal: '验证 AgentHub PostgreSQL 正规化存储的完整读写链路。',
        workspaceType: 'dev',
        rootPath: `data/workspaces/${workspaceId}/repo`,
        runtimeType: 'local',
        runtimeStatus: 'ready',
        projectBrief: '这是一个用于数据库 smoke 的临时工作区。',
        pinnedMessageIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    conversations: [
      ...baseline.conversations,
      {
        id: conversationId,
        workspaceId,
        type: 'group',
        title: 'PostgreSQL Smoke Conversation',
        participants: ['user', 'orchestrator'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    messages: [
      ...baseline.messages,
      {
        id: `msg-smoke-${randomUUID()}`,
        workspaceId,
        conversationId,
        senderType: 'system',
        senderId: 'system',
        content: 'PostgreSQL smoke message.',
        artifacts: [],
        createdAt: now,
      },
    ],
    agents: baseline.agents,
    agentSessions: [
      ...baseline.agentSessions,
      {
        id: sessionId,
        workspaceId,
        agentId: 'orchestrator',
        title: 'PostgreSQL Smoke Agent Session',
        status: 'active',
        lastHandoffId: handoffId,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentSessionMessages: [
      ...baseline.agentSessionMessages,
      {
        id: sessionMessageId,
        workspaceId,
        sessionId,
        agentId: 'orchestrator',
        senderType: 'system',
        senderId: 'system',
        kind: 'task_handoff',
        content: 'PostgreSQL smoke session message.',
        metadata: { smoke: true },
        createdAt: now,
      },
    ],
    taskHandoffs: [
      ...baseline.taskHandoffs,
      {
        id: handoffId,
        workspaceId,
        conversationId,
        sessionId,
        agentId: 'orchestrator',
        source: 'main',
        task: 'PostgreSQL smoke handoff.',
        requiredContext: ['smoke'],
        expectedOutput: 'Round-trip handoff row.',
        status: 'completed',
        resultRunId: runId,
        resultSummary: 'PostgreSQL smoke handoff completed.',
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentRuns: [
      ...baseline.agentRuns,
      {
        id: runId,
        workspaceId,
        conversationId,
        agentId: 'orchestrator',
        sessionId,
        handoffId,
        inputContext: 'PostgreSQL smoke input context.',
        output: 'PostgreSQL smoke output.',
        status: 'success',
        provider: 'claude',
        logs: ['postgres smoke'],
        startedAt: now,
        finishedAt: now,
      },
    ],
    artifacts: [
      ...baseline.artifacts,
      {
        id: artifactId,
        workspaceId,
        agentRunId: runId,
        type: 'text',
        title: 'PostgreSQL smoke artifact',
        content: 'artifact payload',
        createdByAgentId: 'orchestrator',
        createdAt: now,
      },
    ],
    changeSets: [
      ...baseline.changeSets,
      {
        id: changeSetId,
        workspaceId,
        agentRunId: runId,
        baseCommit: 'seed',
        files: [{ path: 'smoke.txt', status: 'added', additions: 1, deletions: 0 }],
        summary: 'PostgreSQL smoke change set.',
        patch: '+ smoke',
        createdAt: now,
      },
    ],
    contextSnapshots: [
      ...baseline.contextSnapshots,
      {
        id: snapshotId,
        workspaceId,
        conversationId,
        agentRunId: runId,
        inputContext: 'PostgreSQL smoke context package.',
        summary: 'PostgreSQL smoke summary.',
        sourceRefs: [`workspace:${workspaceId}`, `conversation:${conversationId}`, `agent:orchestrator`],
        tokenEstimate: 8,
        createdAt: now,
      },
    ],
    workflowEvents: [
      ...baseline.workflowEvents,
      {
        id: workflowEventId,
        workspaceId,
        conversationId,
        event: {
          type: 'workflow_finished',
          workspaceId,
          conversationId,
          summary: 'PostgreSQL smoke workflow event.',
        },
        createdAt: now,
      },
    ],
    diagnosticLogs: [
      ...baseline.diagnosticLogs,
      {
        id: diagnosticLogId,
        level: 'info',
        category: 'workflow',
        workspaceId,
        conversationId,
        turnId: `turn-smoke-${randomUUID()}`,
        message: 'PostgreSQL smoke diagnostic log.',
        data: { smoke: true },
        createdAt: now,
      },
    ],
  }
}

/**
 * Asserts that a smoke state round-trips through PostgreSQL.
 * Input: restored state and smoke identifiers. Output: none.
 */
function assertSmokeState(state: AppState, smokeState: AppState): void {
  const workspace = smokeState.workspaces.at(-1)
  const conversation = smokeState.conversations.at(-1)
  const run = smokeState.agentRuns.at(-1)
  const session = smokeState.agentSessions.at(-1)
  const sessionMessage = smokeState.agentSessionMessages.at(-1)
  const handoff = smokeState.taskHandoffs.at(-1)
  const artifact = smokeState.artifacts.at(-1)
  const changeSet = smokeState.changeSets.at(-1)
  const snapshot = smokeState.contextSnapshots.at(-1)
  const workflowEvent = smokeState.workflowEvents.at(-1)
  const diagnosticLog = smokeState.diagnosticLogs.at(-1)
  const message = smokeState.messages.at(-1)

  if (
    !workspace ||
    !conversation ||
    !run ||
    !session ||
    !sessionMessage ||
    !handoff ||
    !artifact ||
    !changeSet ||
    !snapshot ||
    !workflowEvent ||
    !diagnosticLog ||
    !message
  ) {
    throw new Error('Smoke state was not constructed correctly.')
  }

  const workspaceFound = state.workspaces.some(item => item.id === workspace.id)
  const conversationFound = state.conversations.some(item => item.id === conversation.id)
  const runFound = state.agentRuns.some(item => item.id === run.id)
  const sessionFound = state.agentSessions.some(item => item.id === session.id)
  const sessionMessageFound = state.agentSessionMessages.some(item => item.id === sessionMessage.id)
  const handoffFound = state.taskHandoffs.some(item => item.id === handoff.id)
  const artifactFound = state.artifacts.some(item => item.id === artifact.id)
  const changeSetFound = state.changeSets.some(item => item.id === changeSet.id)
  const snapshotFound = state.contextSnapshots.some(item => item.id === snapshot.id)
  const workflowEventFound = state.workflowEvents.some(item => item.id === workflowEvent.id)
  const diagnosticLogFound = state.diagnosticLogs.some(item => item.id === diagnosticLog.id)
  const messageFound = state.messages.some(item => item.id === message.id)

  if (
    !workspaceFound ||
    !conversationFound ||
    !runFound ||
    !sessionFound ||
    !sessionMessageFound ||
    !handoffFound ||
    !artifactFound ||
    !changeSetFound ||
    !snapshotFound ||
    !workflowEventFound ||
    !diagnosticLogFound ||
    !messageFound
  ) {
    throw new Error('PostgreSQL smoke round-trip verification failed.')
  }
}

/**
 * Runs the PostgreSQL smoke test against an explicit database URL.
 * Input: CLI arguments. Output: process exit code through thrown errors.
 */
async function main(): Promise<void> {
  const env = readEnv()
  const args = parseArgs(process.argv.slice(2), env.DATABASE_URL)
  const store = await createPostgresStateStore(args.databaseUrl, createSeedState())

  const baseline = cloneState(await store.read())
  const smokeState = buildSmokeState(baseline)

  try {
    await store.update(state => {
      replaceState(state, smokeState)
    })

    const roundTrip = await store.read()
    assertSmokeState(roundTrip, smokeState)
  } finally {
    await store.update(state => {
      replaceState(state, baseline)
    })
  }

  const restored = await store.read()
  if (
    restored.workspaces.length !== baseline.workspaces.length ||
    restored.conversations.length !== baseline.conversations.length ||
    restored.messages.length !== baseline.messages.length ||
    restored.agentSessions.length !== baseline.agentSessions.length ||
    restored.agentSessionMessages.length !== baseline.agentSessionMessages.length ||
    restored.taskHandoffs.length !== baseline.taskHandoffs.length ||
    restored.agentRuns.length !== baseline.agentRuns.length ||
    restored.artifacts.length !== baseline.artifacts.length ||
    restored.changeSets.length !== baseline.changeSets.length ||
    restored.contextSnapshots.length !== baseline.contextSnapshots.length ||
    restored.workflowEvents.length !== baseline.workflowEvents.length ||
    restored.diagnosticLogs.length !== baseline.diagnosticLogs.length
  ) {
    throw new Error('PostgreSQL smoke restore verification failed.')
  }

  console.log('PostgreSQL smoke PASS.')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
