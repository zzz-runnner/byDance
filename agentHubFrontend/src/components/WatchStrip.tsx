import type { WorkspaceRoom } from '../types'
import { WorkspaceWatchButton } from './WorkspaceRail'

type WatchStripProps = {
  rooms: WorkspaceRoom[]
  activeWorkspaceId: string
  onSelectWorkspace: (workspaceId: string) => void
}

/**
 * Renders the multi-workspace watch strip.
 * Input: app state, active workspace, workflow events, and selection callback.
 * Output: compact watcher cards for up to four workspaces.
 */
export function WatchStrip({ rooms, activeWorkspaceId, onSelectWorkspace }: WatchStripProps) {
  return (
    <div className="watch-strip" aria-label="多工作区观察区">
      {rooms.slice(0, 4).map(room => (
        <WorkspaceWatchButton
          key={room.id}
          room={room}
          active={room.id === activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
        />
      ))}
    </div>
  )
}
