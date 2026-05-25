import { MessagesSquare, Plus, RadioTower, Search, UserRound } from 'lucide-react'
import { workspaceRoomKindLabel, workspaceRoomSignal, type WorkspaceRoom } from '../appModel'
import type { AppState, RuntimeEvent } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { GlassPanel } from './GlassPanel'
import { StatusPill } from './StatusPill'

type WorkspaceRailProps = {
  state: AppState
  rooms: WorkspaceRoom[]
  activeWorkspaceId: string
  events: RuntimeEvent[]
  onSelectWorkspace: (workspaceId: string) => void
  onCreateWorkspace: () => void
}

/**
 * Renders the left workspace navigation rail.
 * Input: app state, active workspace id, runtime events, and selection callbacks.
 * Output: a list of selectable workspaces with live signals.
 */
export function WorkspaceRail({
  state,
  rooms,
  activeWorkspaceId,
  events,
  onSelectWorkspace,
  onCreateWorkspace,
}: WorkspaceRailProps) {
  return (
    <GlassPanel className="workspace-rail">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">Workspaces</p>
          <h2>多工作区</h2>
        </div>
        <button className="icon-button" type="button" onClick={onCreateWorkspace} title="新建工作区">
          <Plus size={17} />
        </button>
      </div>

      <label className="search-box">
        <Search size={15} />
        <input type="search" placeholder="搜索工作区" />
      </label>

      <div className="workspace-list">
        {rooms.map(room => (
          <WorkspaceButton
            key={room.id}
            state={state}
            room={room}
            events={events}
            active={room.id === activeWorkspaceId}
            onSelectWorkspace={onSelectWorkspace}
          />
        ))}
      </div>
    </GlassPanel>
  )
}

type WorkspaceButtonProps = {
  state: AppState
  room: WorkspaceRoom
  events: RuntimeEvent[]
  active: boolean
  onSelectWorkspace: (workspaceId: string) => void
}

/**
 * Renders one workspace button with its derived signal summary.
 * Input: app state, workspace, runtime events, active flag, and select callback.
 * Output: a button for switching workspaces.
 */
function WorkspaceButton({ state, room, events, active, onSelectWorkspace }: WorkspaceButtonProps) {
  const signal = workspaceRoomSignal(state, room, events)
  const status = signal.runningAgents > 0 ? 'running' : room.workspace.runtimeStatus === 'ready' ? 'ready' : 'failed'
  const Icon = room.kind === 'group' ? MessagesSquare : UserRound

  return (
    <button
      className={`workspace-button ${active ? 'is-active' : ''}`}
      type="button"
      onClick={() => onSelectWorkspace(room.id)}
    >
      <span className="workspace-icon">
        <Icon size={17} />
      </span>
      <span className="workspace-copy">
        <span className="workspace-name">{room.title}</span>
        <span className="workspace-goal">{room.subtitle}</span>
        <span className="workspace-agents" aria-label="参与 Agent">
          {room.participantAgentIds.slice(0, 5).map((agentId, index) => (
            <span
              className="workspace-agent-avatar"
              key={agentId}
              style={{ zIndex: room.participantAgentIds.length - index }}
            >
              <AgentAvatar agentId={agentId} size="sm" />
            </span>
          ))}
        </span>
        <span className="workspace-meta">
          <StatusPill status="demo" label={workspaceRoomKindLabel(room.kind)} />
          <StatusPill status={status} label={signal.runningAgents > 0 ? `${signal.runningAgents} running` : 'ready'} />
          <span>
            {signal.artifactCount} 产物 / {signal.messageCount} 消息
          </span>
        </span>
      </span>
    </button>
  )
}

type WorkspaceWatchButtonProps = {
  state: AppState
  room: WorkspaceRoom
  events: RuntimeEvent[]
  active: boolean
  onSelectWorkspace: (workspaceId: string) => void
}

/**
 * Renders one compact workspace watcher item.
 * Input: app state, workspace, runtime events, active flag, and selection callback.
 * Output: a compact button for the watch strip.
 */
export function WorkspaceWatchButton({
  state,
  room,
  events,
  active,
  onSelectWorkspace,
}: WorkspaceWatchButtonProps) {
  const signal = workspaceRoomSignal(state, room, events)

  return (
    <button
      className={`watch-card ${active ? 'is-active' : ''}`}
      type="button"
      onClick={() => onSelectWorkspace(room.id)}
    >
      <span className="watch-card__icon">
        <RadioTower size={16} />
      </span>
      <span>
        <strong>{room.title}</strong>
        <small>{signal.latestEventLabel}</small>
      </span>
      <em>{signal.runningAgents > 0 ? `${signal.runningAgents} 执行中` : `${signal.artifactCount} 产物`}</em>
    </button>
  )
}
