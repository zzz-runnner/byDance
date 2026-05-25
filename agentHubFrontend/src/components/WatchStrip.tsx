import type { WorkspaceRoom } from '../appModel'
import type { AppState, RuntimeEvent } from '../types'
import { WorkspaceWatchButton } from './WorkspaceRail'

type WatchStripProps = {
  state: AppState
  rooms: WorkspaceRoom[]
  activeWorkspaceId: string
  events: RuntimeEvent[]
  onSelectWorkspace: (workspaceId: string) => void
}

/**
 * Renders the multi-workspace watch strip.
 * Input: app state, active workspace, runtime events, and selection callback.
 * Output: compact watcher cards for up to four workspaces.
 */
export function WatchStrip({ state, rooms, activeWorkspaceId, events, onSelectWorkspace }: WatchStripProps) {
  return (
    <div className="watch-strip" aria-label="多工作区观察区">
      {rooms.slice(0, 4).map(room => (
        <WorkspaceWatchButton
          key={room.id}
          state={state}
          room={room}
          events={events}
          active={room.id === activeWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
        />
      ))}
    </div>
  )
}
