import type { ReactNode } from 'react'
import { Activity, Boxes, Braces, CheckCircle2, Clock3, FileArchive, GitPullRequest, RadioTower, ShieldCheck } from 'lucide-react'
import { buildAgentMap, eventLabel, formatTime, stageLabel, workspaceRoomKindLabel, type WorkspaceRoom } from '../appModel'
import type { AppState, RuntimeEvent } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { GlassPanel } from './GlassPanel'
import { StatusPill } from './StatusPill'

type InsightDockProps = {
  state: AppState
  room: WorkspaceRoom | undefined
  events: RuntimeEvent[]
}

/**
 * Renders the right-side workflow, run, and artifact dock.
 * Input: app state, active workspace room, and runtime events.
 * Output: operational details for the selected workspace room.
 */
export function InsightDock({ state, room, events }: InsightDockProps) {
  const agentMap = buildAgentMap(state)
  const workspace = room?.workspace
  const conversation = room?.conversation
  const targetAgent = room?.targetAgentId ? agentMap.get(room.targetAgentId) : undefined
  const workspaceEvents = workspace ? events.filter(event => event.workspaceId === workspace.id).slice(0, 8) : []
  const latestStage = workspaceEvents.find(event => event.type === 'task_stage_updated')
  const taskStage = latestStage?.type === 'task_stage_updated' ? latestStage.taskStage : undefined
  const handoffs = workspace
    ? state.taskHandoffs.filter(handoff => handoff.workspaceId === workspace.id && handoff.conversationId === conversation?.id)
    : []
  const runs = workspace ? state.agentRuns.filter(run => run.workspaceId === workspace.id).slice(-4).reverse() : []
  const artifacts = workspace ? state.artifacts.filter(artifact => artifact.workspaceId === workspace.id) : []

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
          <span>{room?.kind === 'group' ? 'Orchestrator 正在协调群聊工作区' : `${targetAgent?.name ?? room?.targetAgentId ?? 'Agent'} 使用单聊上下文回复`}</span>
        </div>
      </section>

      {room?.kind === 'direct' && targetAgent ? (
        <section className="dock-section agent-profile-card">
          <AgentAvatar agentId={targetAgent.id} name={targetAgent.name} />
          <div>
            <p className="eyebrow">{workspaceRoomKindLabel(room.kind)}</p>
            <h3>{targetAgent.name}</h3>
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
                  <AgentAvatar agentId={handoff.agentId} name={agent?.name} size="sm" />
                  <div>
                    <strong>{agent?.name ?? handoff.agentId}</strong>
                    <p>{handoff.task}</p>
                    <StatusPill
                      status={handoff.status === 'completed' ? 'success' : handoff.status === 'failed' ? 'failed' : 'running'}
                      label={handoff.status}
                    />
                  </div>
                </article>
              )
            })
          ) : (
            <p className="empty-line">当前工作区还没有派发任务包。</p>
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
        <SectionLabel icon={<Boxes size={15} />} label="产物与运行" />
        <div className="artifact-mini-list">
          {artifacts.map(artifact => {
            const Icon = artifact.type === 'zip' ? FileArchive : artifact.type === 'diff' ? Braces : CheckCircle2

            return (
              <a className="artifact-mini" key={artifact.id} href={artifact.url ?? '#'} target="_blank" rel="noreferrer">
                <Icon size={16} />
                <span>
                  <strong>{artifact.title}</strong>
                  <small>{artifact.type}</small>
                </span>
              </a>
            )
          })}
          {runs.map(run => (
            <div className="artifact-mini" key={run.id}>
              <Clock3 size={16} />
              <span>
                <strong>{agentMap.get(run.agentId)?.name ?? run.agentId}</strong>
                <small>{run.status} / {run.provider}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="dock-section">
        <SectionLabel icon={<ShieldCheck size={15} />} label="工作区规则" />
        <div className="rule-list">
          <span>{room?.kind === 'group' ? '不 @ 时由 Orchestrator 统一判断。' : '输入默认发给单聊目标 Agent。'}</span>
          <span>{room?.kind === 'group' ? '@ 单个子 Agent 时，该 Agent 在群聊内定向回复。' : '仍保留工作区产物、上下文和运行记录。'}</span>
        </div>
      </section>
    </GlassPanel>
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
