import { Archive, ArchiveRestore, LoaderCircle, MessagesSquare, Pin, PinOff, Plus, RadioTower, Search, Trash2, UserRound } from 'lucide-react'
import { workspaceRoomKindLabel } from '../appModel'
import type { SortDirection, WorkspaceListStatus, WorkspaceRoom, WorkspaceSortField } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { GlassPanel } from './GlassPanel'
import { StatusPill } from './StatusPill'

type WorkspaceRailProps = {
  rooms: WorkspaceRoom[]
  activeWorkspaceId: string
  query: string
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  total: number
  visibleCount: number
  createDisabled: boolean
  statusFilter: WorkspaceListStatus
  sortBy: WorkspaceSortField
  sortDirection: SortDirection
  updatingWorkspaceId?: string
  onSelectWorkspace: (workspaceId: string) => void
  onQueryChange: (value: string) => void
  onStatusFilterChange: (value: WorkspaceListStatus) => void
  onSortByChange: (value: WorkspaceSortField) => void
  onSortDirectionChange: (value: SortDirection) => void
  onTogglePin: (room: WorkspaceRoom) => void
  onToggleArchive: (room: WorkspaceRoom) => void
  onDeleteWorkspace: (room: WorkspaceRoom) => void
  onLoadMore: () => void
  onCreateWorkspace: () => void
}

/**
 * Renders the left workspace navigation rail.
 * Input: room list, active workspace id, pagination state, and selection callbacks.
 * Output: a list of selectable workspaces with live signals.
 */
export function WorkspaceRail({
  rooms,
  activeWorkspaceId,
  query,
  loading,
  loadingMore,
  hasMore,
  total,
  visibleCount,
  createDisabled,
  statusFilter,
  sortBy,
  sortDirection,
  updatingWorkspaceId,
  onSelectWorkspace,
  onQueryChange,
  onStatusFilterChange,
  onSortByChange,
  onSortDirectionChange,
  onTogglePin,
  onToggleArchive,
  onDeleteWorkspace,
  onLoadMore,
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

      <div className="workspace-controls">
        <select
          aria-label="Workspace status filter"
          value={statusFilter}
          onChange={event => onStatusFilterChange(event.currentTarget.value as WorkspaceListStatus)}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <select
          aria-label="Workspace sort field"
          value={sortBy}
          onChange={event => onSortByChange(event.currentTarget.value as WorkspaceSortField)}
        >
          <option value="updatedAt">Updated</option>
          <option value="createdAt">Created</option>
          <option value="name">Name</option>
        </select>
        <select
          aria-label="Workspace sort direction"
          value={sortDirection}
          onChange={event => onSortDirectionChange(event.currentTarget.value as SortDirection)}
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
      </div>

      <div className="workspace-list">
        {rooms.length > 0 ? (
          rooms.map(room => (
            <WorkspaceButton
              key={room.id}
              room={room}
              active={room.id === activeWorkspaceId}
              updating={updatingWorkspaceId === room.id}
              onSelectWorkspace={onSelectWorkspace}
              onTogglePin={onTogglePin}
              onToggleArchive={onToggleArchive}
              onDeleteWorkspace={onDeleteWorkspace}
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

      <div className="workspace-rail__footer">
        <span className="workspace-rail__summary">
          已加载 {visibleCount} / {total}
        </span>
        {hasMore ? (
          <button
            className="secondary-button workspace-rail__load-more"
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <LoaderCircle className="icon-spin" size={14} />
                加载中
              </>
            ) : (
              '加载更多'
            )}
          </button>
        ) : null}
      </div>
    </GlassPanel>
  )
}

type WorkspaceButtonProps = {
  room: WorkspaceRoom
  active: boolean
  updating: boolean
  onSelectWorkspace: (workspaceId: string) => void
  onTogglePin: (room: WorkspaceRoom) => void
  onToggleArchive: (room: WorkspaceRoom) => void
  onDeleteWorkspace: (room: WorkspaceRoom) => void
}

/**
 * Renders one workspace button with its derived signal summary.
 * Input: workspace room, active flag, and select callback.
 * Output: a button for switching workspaces.
 */
function WorkspaceButton({
  room,
  active,
  updating,
  onSelectWorkspace,
  onTogglePin,
  onToggleArchive,
  onDeleteWorkspace,
}: WorkspaceButtonProps) {
  const signal = room.signal
  const status = signal.runningAgents > 0 ? 'running' : room.workspace.runtimeStatus === 'ready' ? 'ready' : 'failed'
  const Icon = room.kind === 'group' ? MessagesSquare : UserRound
  const pinned = Boolean(room.workspace.pinnedAt)
  const archived = Boolean(room.workspace.archivedAt)

  return (
    <div className={`workspace-row ${active ? 'is-active' : ''}`}>
      <button
      className="workspace-button"
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
          {pinned ? <StatusPill status="success" label="pinned" /> : null}
          {archived ? <StatusPill status="muted" label="archived" /> : null}
          <span>
            {signal.artifactCount} 产物 / {signal.messageCount} 消息
          </span>
        </span>
      </span>
      </button>
      <div className="workspace-actions">
        <button
          className="icon-button"
          type="button"
          onClick={() => onTogglePin(room)}
          disabled={updating}
          title={pinned ? 'Unpin workspace' : 'Pin workspace'}
        >
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => onToggleArchive(room)}
          disabled={updating}
          title={archived ? 'Unarchive workspace' : 'Archive workspace'}
        >
          {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => onDeleteWorkspace(room)}
          disabled={updating}
          title="Delete workspace"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

type WorkspaceWatchButtonProps = {
  room: WorkspaceRoom
  active: boolean
  onSelectWorkspace: (workspaceId: string) => void
}

/**
 * Renders one compact workspace watcher item.
 * Input: workspace room, active flag, and selection callback.
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
