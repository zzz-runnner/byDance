import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentRun, AppState, ChangeSet, TaskHandoff, WorkflowEventRecord } from '../../src/shared/contracts'
import prompts from '../fixtures/agent-chain/probe-prompts.json'
import { cleanupRealTestApp, createRealTestApp, realTestsEnabled, type RealTestApp } from '../setup/real-test-app'
import { selectPrimaryGroup } from '../setup/state-selectors'

type ProbePrompts = {
  guardedIntake: string
  approvedMainChain: string
}

type ProbeStage = {
  name: string
  reached: boolean
  detail?: string
}

type ProbeReport = {
  stages: ProbeStage[]
  newRuns: AgentRun[]
  newHandoffs: TaskHandoff[]
  newChangeSets: ChangeSet[]
  recentEvents: WorkflowEventRecord[]
}

const probePrompts = prompts as ProbePrompts

let testApp: RealTestApp | undefined

afterEach(async () => {
  await cleanupRealTestApp(testApp)
  testApp = undefined
})

/**
 * Returns true when a file is present in the temporary runtime repo.
 * Input: absolute file path. Output: true when the file can be accessed.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Filters records created after the initial state snapshot.
 * Input: previous and current state arrays. Output: items that were added during the probe.
 */
function addedById<T extends { id: string }>(before: T[], after: T[]): T[] {
  const existingIds = new Set(before.map(item => item.id))
  return after.filter(item => !existingIds.has(item.id))
}

/**
 * Selects workflow events for one conversation.
 * Input: application state and conversation id. Output: matching workflow events.
 */
function selectConversationEvents(state: AppState, conversationId: string): WorkflowEventRecord[] {
  return state.workflowEvents.filter(record => {
    const event = record.event as Record<string, unknown>
    return event.conversationId === conversationId
  })
}

/**
 * Returns whether one event type appears in a workflow event list.
 * Input: workflow events and an event type. Output: true when present.
 */
function hasEvent(events: WorkflowEventRecord[], type: string): boolean {
  return events.some(record => record.event.type === type)
}

/**
 * Formats one event into a short diagnostic line.
 * Input: workflow event record. Output: compact text for failure messages.
 */
function summarizeEvent(record: WorkflowEventRecord): string {
  const event = record.event as Record<string, unknown>
  const agentId = typeof event.agentId === 'string' ? ` agent=${event.agentId}` : ''
  const status = typeof event.status === 'string' ? ` status=${event.status}` : ''
  const error = typeof event.error === 'string' ? ` error=${event.error.slice(0, 160)}` : ''
  return `${record.event.type}${agentId}${status}${error}`
}

/**
 * Formats one agent run into a compact diagnostic line.
 * Input: agent run. Output: provider, status, error, and short log detail.
 */
function summarizeRun(run: AgentRun): string {
  const error = run.error ? ` error=${run.error.slice(0, 160)}` : ''
  const logs = run.logs.length ? ` logs=${run.logs.slice(-3).join(' | ').slice(0, 220)}` : ''
  return `- ${run.agentId} provider=${run.provider} status=${run.status}${error}${logs}`
}

/**
 * Builds a staged reachability report for a real agent-chain probe.
 * Input: state before the request, state after it, and conversation id. Output: stage report.
 */
function buildProbeReport(before: AppState, after: AppState, conversationId: string): ProbeReport {
  const newRuns = addedById(before.agentRuns, after.agentRuns)
  const newHandoffs = addedById(before.taskHandoffs, after.taskHandoffs)
  const newChangeSets = addedById(before.changeSets, after.changeSets)
  const recentEvents = selectConversationEvents(after, conversationId)

  const runAgents = new Set(newRuns.map(run => run.agentId))
  const handoffAgents = new Set(newHandoffs.map(handoff => handoff.agentId))

  return {
    newRuns,
    newHandoffs,
    newChangeSets,
    recentEvents,
    stages: [
      { name: 'turn_started', reached: hasEvent(recentEvents, 'turn_started') },
      { name: 'task_stage_updated', reached: hasEvent(recentEvents, 'task_stage_updated') },
      { name: 'routing_finished', reached: hasEvent(recentEvents, 'routing_finished') },
      { name: 'product-manager handoff', reached: handoffAgents.has('product-manager') },
      { name: 'engineer handoff', reached: handoffAgents.has('engineer') },
      { name: 'reviewer handoff', reached: handoffAgents.has('reviewer') },
      { name: 'product-manager run', reached: runAgents.has('product-manager') },
      { name: 'engineer run', reached: runAgents.has('engineer') },
      { name: 'reviewer run', reached: runAgents.has('reviewer') },
      { name: 'change_set_created', reached: hasEvent(recentEvents, 'change_set_created') || newChangeSets.length > 0 },
      { name: 'preview_ready', reached: hasEvent(recentEvents, 'preview_ready') },
      { name: 'agent_finished', reached: hasEvent(recentEvents, 'agent_finished') },
      { name: 'synthesis_finished', reached: hasEvent(recentEvents, 'synthesis_finished') },
      { name: 'workflow_finished', reached: hasEvent(recentEvents, 'workflow_finished') },
    ],
  }
}

/**
 * Converts a probe report into a readable failure payload.
 * Input: probe report. Output: multi-line report text.
 */
function formatProbeReport(report: ProbeReport): string {
  const stages = report.stages.map(stage => `- ${stage.reached ? 'yes' : 'no'} ${stage.name}${stage.detail ? `: ${stage.detail}` : ''}`)
  const runs = report.newRuns.map(run => summarizeRun(run))
  const handoffs = report.newHandoffs.map(handoff => `- ${handoff.agentId} status=${handoff.status}`)
  const changes = report.newChangeSets.map(changeSet =>
    `- ${changeSet.files.map(file => `${file.status}:${file.path}`).join(', ')}`,
  )
  const events = report.recentEvents.slice(-18).map(record => `- ${summarizeEvent(record)}`)

  return [
    'Agent chain probe report:',
    'Stages:',
    ...stages,
    'New runs:',
    ...(runs.length ? runs : ['- none']),
    'New handoffs:',
    ...(handoffs.length ? handoffs : ['- none']),
    'New change sets:',
    ...(changes.length ? changes : ['- none']),
    'Recent events:',
    ...(events.length ? events : ['- none']),
  ].join('\n')
}

/**
 * Throws an assertion error with the probe report attached.
 * Input: condition, message, and report. Output: narrowed truthy condition or thrown error.
 */
function assertProbe(condition: unknown, message: string, report: ProbeReport): asserts condition {
  if (!condition) {
    throw new Error(`${message}\n${formatProbeReport(report)}`)
  }
}

describe.skipIf(!realTestsEnabled())('real main agent chain probe', () => {
  it('keeps an unapproved planning request out of the engineer path', async () => {
    testApp = await createRealTestApp('agenthub-chain-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectPrimaryGroup(initialState)

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: probePrompts.guardedIntake,
      },
    })
    const state = response.json() as AppState
    const report = buildProbeReport(initialState, state, conversation.id)

    expect(response.statusCode).toBe(200)
    assertProbe(report.newHandoffs.some(handoff => handoff.agentId === 'product-manager'), 'Expected product-manager handoff for guarded intake.', report)
    assertProbe(!report.newHandoffs.some(handoff => handoff.agentId === 'engineer'), 'Engineer should not be handed off before implementation approval.', report)
    assertProbe(!report.newRuns.some(run => run.agentId === 'engineer'), 'Engineer should not run before implementation approval.', report)
  }, 360_000)

  it('probes the approved main chain through engineer, reviewer, and synthesis', async () => {
    testApp = await createRealTestApp('agenthub-chain-')
    const initialState = (await testApp.app.inject({ method: 'GET', url: '/api/state' })).json() as AppState
    const { workspace, conversation } = selectPrimaryGroup(initialState)

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/messages',
      payload: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: probePrompts.approvedMainChain,
      },
    })
    const state = response.json() as AppState
    const report = buildProbeReport(initialState, state, conversation.id)
    const repoPath = path.join(testApp.runtimeRoot.path, workspace.id, 'repo')
    const indexPath = path.join(repoPath, 'index.html')
    const stylesPath = path.join(repoPath, 'styles.css')

    console.info(formatProbeReport(report))

    expect(response.statusCode).toBe(200)
    assertProbe(report.newRuns.some(run => run.agentId === 'engineer'), 'Expected engineer to run in the approved chain.', report)
    assertProbe(report.newRuns.some(run => run.agentId === 'reviewer'), 'Expected reviewer to run in the approved chain.', report)
    assertProbe(report.newRuns.every(run => run.provider !== 'mock'), 'Approved chain should not use mock providers when real tests are enabled.', report)
    assertProbe(report.newChangeSets.some(changeSet =>
      changeSet.files.some(file => file.path === 'index.html') &&
      changeSet.files.some(file => file.path === 'styles.css'),
    ), 'Expected engineer change set for index.html and styles.css.', report)
    assertProbe(await fileExists(indexPath), 'Expected real engineer output file index.html.', report)
    assertProbe(await fileExists(stylesPath), 'Expected real engineer output file styles.css.', report)

    const indexContent = await readFile(indexPath, 'utf8')
    assertProbe(indexContent.includes('AgentHub Main Chain Probe'), 'Expected index.html to contain the probe marker text.', report)
    assertProbe(hasEvent(report.recentEvents, 'preview_ready'), 'Expected preview_ready event after engineer file output.', report)
    assertProbe(hasEvent(report.recentEvents, 'synthesis_finished'), 'Expected synthesis_finished event after child-agent runs.', report)
  }, 720_000)
})
