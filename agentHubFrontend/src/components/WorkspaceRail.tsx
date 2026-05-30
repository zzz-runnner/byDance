import { MessagesSquare, Plus, RadioTower, Search, UserRound } from 'lucide-react'
import { workspaceRoomKindLabel } from '../appModel'
import type { WorkspaceRoom } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { GlassPanel } from './GlassPanel'
import { StatusPill } from './StatusPill'

type WorkspaceRailProps = {
  rooms: WorkspaceRoom[]
  activeWorkspaceId: string
  query: string
  loading: boolean
  createDisabled: boolean
  onSelectWorkspace: (workspaceId: string) => void
  onQueryChange: (value: string) => void
  onCreateWorkspace: () => void
}

/**
 * Renders the left workspace navigation rail.
 * Input: app state, active workspace id, workflow events, and selection callbacks.
 * Output: a list of selectable workspaces with live signals.
 */
export function WorkspaceRail({
  rooms,
  activeWorkspaceId,
  query,
  loading,
  createDisabled,
  onSelectWorkspace,
  onQueryChange,
  onCreateWorkspace,
}: WorkspaceRailProps) {
  const isEmptyWorkspaceList = rooms.length === 0 && query.trim().length === 0

  return (
    <GlassPanel className="workspace-rail">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">Workspaces</p>
          <h2>多工作区</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onCreateWorkspace}
          title="新建工作区"
          disabled={createDisabled}
        >
          <Plus size={17} />
        </button>
      </div>

      <label className="search-box">
        <Search size={15} />
        <input
          type="search"
          placeholder="搜索工作区"
          value={query}
          onChange={event => onQueryChange(event.currentTarget.value)}
        />
      </label>

      <div className="workspace-list">
        {rooms.length > 0 ? (
          rooms.map(room => (
            <WorkspaceButton
              key={room.id}
              room={room}
              active={room.id === activeWorkspaceId}
              onSelectWorkspace={onSelectWorkspace}
            />
          ))
        ) : (
          <div className="workspace-empty-state">
            <strong>{loading ? '正在加载工作区...' : isEmptyWorkspaceList ? '还没有工作区' : '没有匹配的工作区'}</strong>
            <span>
              {loading
                ? '列表会在后端连接成功后自动更新。'
                : isEmptyWorkspaceList
                  ? '可以直接点击右上角创建一个真实工作区。'
                  : '调整搜索关键词，或直接创建一个新工作区。'}
            </span>
          </div>
        )}
      </div>
    </GlassPanel>
  )
}

type WorkspaceButtonProps = {
  room: WorkspaceRoom
  active: boolean
  onSelectWorkspace: (workspaceId: string) => void
}

/**
 * Renders one workspace button with its derived signal summary.
 * Input: app state, workspace, workflow events, active flag, and select callback.
 * Output: a button for switching workspaces.
 */
function WorkspaceButton({ room, active, onSelectWorkspace }: WorkspaceButtonProps) {
  const signal = room.signal
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
          <StatusPill status="muted" label={workspaceRoomKindLabel(room.kind)} />
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
  room: WorkspaceRoom
  active: boolean
  onSelectWorkspace: (workspaceId: string) => void
}

/**
 * Renders one compact workspace watcher item.
 * Input: app state, workspace, workflow events, active flag, and selection callback.
 * Output: a compact button for the watch strip.
 */
export function WorkspaceWatchButton({
  room,
  active,
  onSelectWorkspace,
}: WorkspaceWatchButtonProps) {
  const signal = room.signal

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
