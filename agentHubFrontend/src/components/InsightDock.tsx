import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  Boxes,
  Braces,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileArchive,
  Files,
  GitPullRequest,
  RadioTower,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { agentDisplayName, buildAgentMap, eventLabel, formatTime, stageLabel, workspaceRoomKindLabel } from '../appModel'
import type { AppState, DiagnosticLog, LiveWorkflowEvent, WorkspaceRoom } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { GlassPanel } from './GlassPanel'
import { StatusPill } from './StatusPill'

type InsightDockProps = {
  state: AppState
  room: WorkspaceRoom | undefined
  events: LiveWorkflowEvent[]
}

type DockTabId = 'artifacts' | 'diffs' | 'review' | 'logs'

const DOCK_TABS: Array<{ id: DockTabId; label: string; icon: ReactNode }> = [
  { id: 'artifacts', label: 'Artifacts', icon: <Boxes size={14} /> },
  { id: 'diffs', label: 'Diff', icon: <Braces size={14} /> },
  { id: 'review', label: 'Review', icon: <ShieldCheck size={14} /> },
  { id: 'logs', label: 'Logs', icon: <ScrollText size={14} /> },
]

/**
 * Renders the right-side workflow, run, and artifact dock.
 * Input: app state, active workspace room, and workflow events.
 * Output: operational details for the selected workspace room.
 */
export function InsightDock({ state, room, events }: InsightDockProps) {
  const [activeTab, setActiveTab] = useState<DockTabId>('artifacts')
  const agentMap = buildAgentMap(state)
  const workspace = room?.workspace
  const conversation = room?.conversation
  const targetAgent = room?.targetAgentId ? agentMap.get(room.targetAgentId) : undefined
  const targetAgentName = agentDisplayName(targetAgent, room?.targetAgentId)

  const workspaceEvents = useMemo(
    () => (workspace ? events.filter(event => event.workspaceId === workspace.id).slice(0, 10) : []),
    [events, workspace],
  )
  const latestStage = workspaceEvents.find(event => event.type === 'task_stage_updated')
  const taskStage = latestStage?.type === 'task_stage_updated' ? latestStage.taskStage : undefined
  const handoffs = workspace
    ? state.taskHandoffs.filter(handoff => handoff.workspaceId === workspace.id && handoff.conversationId === conversation?.id)
    : []
  const runs = workspace ? state.agentRuns.filter(run => run.workspaceId === workspace.id).slice(-4).reverse() : []
  const artifacts = workspace ? state.artifacts.filter(artifact => artifact.workspaceId === workspace.id) : []
  const changeSets = workspace ? state.changeSets.filter(changeSet => changeSet.workspaceId === workspace.id) : []
  const contextSnapshots = workspace ? state.contextSnapshots.filter(snapshot => snapshot.workspaceId === workspace.id) : []
  const diagnosticLogs = workspace ? state.diagnosticLogs.filter(log => log.workspaceId === workspace.id).slice().reverse() : []
  const sessions = workspace ? state.agentSessions.filter(session => session.workspaceId === workspace.id) : []
  const sessionMessages = workspace ? state.agentSessionMessages.filter(message => message.workspaceId === workspace.id) : []
  const reviewEvents = workspaceEvents.filter(
    event => event.type === 'review_verdict' || event.type === 'delivery_validation_finished',
  )

  const statCards = [
    {
      label: '运行中 Agent',
      value: String(runs.filter(run => run.status === 'running').length),
      tone: 'blue',
      icon: <Wrench size={15} />,
    },
    {
      label: '当前产物',
      value: String(artifacts.length),
      tone: 'green',
      icon: <Boxes size={15} />,
    },
    {
      label: '上下文快照',
      value: String(contextSnapshots.length),
      tone: 'amber',
      icon: <Sparkles size={15} />,
    },
  ]

  return (
    <GlassPanel className="insight-dock">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2>任务链路</h2>
        </div>
        <StatusPill status={runs.some(run => run.status === 'running') ? 'running' : 'ready'} label={stageLabel(taskStage)} />
      </div>

      <section className="dock-section stage-card">
        <div className="stage-orbit">
          <RadioTower size={20} />
        </div>
        <div>
          <p className="eyebrow">当前阶段</p>
          <h3>{stageLabel(taskStage)}</h3>
          <span>
            {room?.kind === 'group'
              ? '主脑正在协调群聊工作区，工程和审查可以并行推进。'
              : `${targetAgentName} 会使用单聊上下文持续跟进这条任务线。`}
          </span>
        </div>
      </section>

      <div className="insight-stat-grid">
        {statCards.map(card => (
          <div className={`insight-stat-card insight-stat-card--${card.tone}`} key={card.label}>
            <span className="insight-stat-card__icon">{card.icon}</span>
            <strong>{card.value}</strong>
            <small>{card.label}</small>
          </div>
        ))}
      </div>

      {room?.kind === 'direct' && targetAgent ? (
        <section className="dock-section agent-profile-card">
          <AgentAvatar agentId={targetAgent.id} name={targetAgentName} />
          <div>
            <p className="eyebrow">{workspaceRoomKindLabel(room.kind)}</p>
            <h3>{targetAgentName}</h3>
            <span>{targetAgent.role}</span>
            <div className="agent-skill-row">
              {targetAgent.skills.slice(0, 4).map(skill => (
                <em key={skill}>{skill}</em>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="dock-section">
        <SectionLabel icon={<GitPullRequest size={15} />} label="派发任务包" />
        <div className="handoff-list">
          {handoffs.length > 0 ? (
            handoffs.map(handoff => {
              const agent = agentMap.get(handoff.agentId)

              return (
                <article className="handoff-item" key={handoff.id}>
                  <AgentAvatar agentId={handoff.agentId} name={agentDisplayName(agent, handoff.agentId)} size="sm" />
                  <div>
                    <div className="handoff-item__topline">
                      <strong>{agentDisplayName(agent, handoff.agentId)}</strong>
                      <small>{formatTime(handoff.updatedAt)}</small>
                    </div>
                    <p>{handoff.task}</p>
                    <StatusPill
                      status={handoff.status === 'completed' ? 'success' : handoff.status === 'failed' ? 'failed' : 'running'}
                      label={handoff.status}
                    />
                    {handoff.resultSummary ? <span className="handoff-item__summary">{handoff.resultSummary}</span> : null}
                  </div>
                </article>
              )
            })
          ) : (
            <p className="empty-line">当前工作区还没有派发中的任务包。</p>
          )}
        </div>
      </section>

      <section className="dock-section">
        <SectionLabel icon={<Activity size={15} />} label="实时事件" />
        <div className="event-list">
          {workspaceEvents.length > 0 ? (
            workspaceEvents.map((event, index) => (
              <article className="event-item" key={`${event.type}-${event.receivedAt}-${index}`}>
                <span />
                <div>
                  <strong>{eventLabel(event)}</strong>
                  <small>{formatTime(event.receivedAt)}</small>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-line">等待下一次 workflow event。</p>
          )}
        </div>
      </section>

      <section className="dock-section">
        <div className="insight-tabs" role="tablist" aria-label="洞察详情切换">
          {DOCK_TABS.map(tab => (
            <button
              key={tab.id}
              className={`insight-tab ${activeTab === tab.id ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'artifacts' ? (
          <div className="artifact-mini-list">
            {artifacts.map(artifact => {
              const Icon = artifact.type === 'zip' ? FileArchive : artifact.type === 'diff' ? Braces : CheckCircle2

              return (
                <a className="artifact-mini artifact-mini--rich" key={artifact.id} href={artifact.url} target="_blank" rel="noreferrer">
                  <Icon size={16} />
                  <span>
                    <strong>{artifact.title}</strong>
                    <small>{artifact.content}</small>
                  </span>
                </a>
              )
            })}
            {artifacts.length === 0 ? <p className="empty-line">当前工作区还没有产物。</p> : null}
          </div>
        ) : null}

        {activeTab === 'diffs' ? (
          <div className="dock-panel-list">
            {changeSets.length > 0 ? (
              changeSets.map(changeSet => (
                <article className="dock-note-card" key={changeSet.id}>
                  <div className="dock-note-card__header">
                    <strong>{changeSet.summary}</strong>
                    <small>{formatTime(changeSet.createdAt)}</small>
                  </div>
                  <div className="diff-file-list">
                    {changeSet.files.map(file => (
                      <div className="diff-file-row" key={file.path}>
                        <span className={`diff-file-badge diff-file-badge--${file.status}`}>{file.status}</span>
                        <code>{file.path}</code>
                        <em>
                          +{file.additions} / -{file.deletions}
                        </em>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="empty-line">当前工作区还没有变更集。</p>
            )}
          </div>
        ) : null}

        {activeTab === 'review' ? (
          <div className="dock-panel-list">
            {reviewEvents.length > 0 ? (
              reviewEvents.map((event, index) => (
                <article className="dock-note-card" key={`${event.type}-${index}`}>
                  {'verdict' in event ? (
                    <>
                      <div className="dock-note-card__header">
                        <strong>Reviewer 结论：{event.verdict}</strong>
                        <small>{formatTime(event.receivedAt)}</small>
                      </div>
                      <p>{event.summary}</p>
                      <div className="issue-chip-row">
                        {event.issues.map(issue => (
                          <span key={issue}>{issue}</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="dock-note-card__header">
                        <strong>交付验证：{event.status}</strong>
                        <small>{formatTime(event.receivedAt)}</small>
                      </div>
                      <p>{event.summary}</p>
                      <div className="issue-chip-row">
                        {event.issues.map(issue => (
                          <span key={`${issue.severity}-${issue.message}`}>
                            {issue.severity}: {issue.message}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </article>
              ))
            ) : (
              <p className="empty-line">当前还没有审查结论，适合先看运行日志和派发任务。</p>
            )}
          </div>
        ) : null}

        {activeTab === 'logs' ? (
          <div className="dock-panel-list">
            {contextSnapshots.length > 0 ? (
              contextSnapshots.map(snapshot => (
                <article className="dock-note-card" key={snapshot.id}>
                  <div className="dock-note-card__header">
                    <strong>上下文快照</strong>
                    <small>{snapshot.tokenEstimate} tokens</small>
                  </div>
                  <p>{snapshot.summary}</p>
                  <div className="issue-chip-row">
                    {snapshot.sourceRefs.map(ref => (
                      <span key={ref}>{ref}</span>
                    ))}
                  </div>
                </article>
              ))
            ) : null}

            {sessions.length > 0 ? (
              sessions.map(session => {
                const agent = agentMap.get(session.agentId)
                const sessionMessageCount = sessionMessages.filter(message => message.sessionId === session.id).length

                return (
                  <article className="dock-note-card" key={session.id}>
                    <div className="dock-note-card__header">
                      <strong>{session.title}</strong>
                      <small>{agentDisplayName(agent, session.agentId)}</small>
                    </div>
                    <p>
                      {session.status === 'active' ? '会话仍在持续更新。' : '会话已归档，可回看执行上下文。'}
                      当前累计 {sessionMessageCount} 条 session 消息。
                    </p>
                  </article>
                )
              })
            ) : null}

            {diagnosticLogs.length > 0 ? (
              diagnosticLogs.map(log => <DiagnosticLogCard key={log.id} log={log} />)
            ) : (
              <p className="empty-line">当前工作区还没有日志。</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="dock-section">
        <SectionLabel icon={<ShieldCheck size={15} />} label="工作区规则" />
        <div className="rule-list">
          <span>{room?.kind === 'group' ? '不 @ 时由主脑统一判断任务走向。' : '输入默认发给单聊目标 Agent。'}</span>
          <span>{room?.kind === 'group' ? '@ 单个 Agent 时，会在群聊上下文中定向回复。' : '依然保留工作区产物、上下文和运行记录。'}</span>
        </div>
      </section>
    </GlassPanel>
  )
}

type DiagnosticLogCardProps = {
  log: DiagnosticLog
}

function DiagnosticLogCard({ log }: DiagnosticLogCardProps) {
  return (
    <article className={`dock-note-card dock-note-card--${log.level}`}>
      <div className="dock-note-card__header">
        <strong>{log.category}</strong>
        <small>{formatTime(log.createdAt)}</small>
      </div>
      <p>{log.message}</p>
      {log.data ? (
        <div className="issue-chip-row">
          {Object.entries(log.data).map(([key, value]) => (
            <span key={key}>
              {key}: {String(value)}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

type SectionLabelProps = {
  icon: ReactNode
  label: string
}

/**
 * Renders a titled subsection label in the insight dock.
 * Input: icon node and label text.
 * Output: compact subsection heading.
 */
function SectionLabel({ icon, label }: SectionLabelProps) {
  return (
    <div className="section-title">
      {icon}
      {label}
    </div>
  )
}
