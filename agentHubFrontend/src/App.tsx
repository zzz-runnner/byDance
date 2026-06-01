import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Braces, LayoutDashboard, LoaderCircle, PlugZap, RefreshCcw, ServerCrash, Wifi } from 'lucide-react'
import {
  createBusinessAgent,
  createBusinessWorkspace,
  createEmptyWorkbenchState,
  deleteBusinessAgent,
  fetchBusinessProjectState,
  fetchBusinessWorkbenchOverview,
  streamBusinessProjectMessage,
  updateBusinessAgent,
  updateBusinessWorkspaceMetadata,
  type CreateBusinessAgentInput,
  type UpdateBusinessAgentInput,
} from './api/businessBackend'
import {
  directAgentId,
  mergeWorkflowEvents,
  messagesForConversation,
} from './appModel'
import backgroundImage from './asset/background/newBG.png'
import { BackgroundCanvas } from './components/BackgroundCanvas'
import { ChatPane } from './components/ChatPane'
import { AgentManagementDialog } from './components/AgentManagementDialog'
import { CodeWorkspaceDialog } from './components/CodeWorkspaceDialog'
import { CreateWorkspaceDialog, type CreateWorkspaceInput } from './components/CreateWorkspaceDialog'
import { GlassPanel } from './components/GlassPanel'
import { OrbMark } from './components/OrbMark'
import { StatusPill } from './components/StatusPill'
import { WorkspaceRail } from './components/WorkspaceRail'
import type {
  AppState,
  CodeSelectionReference,
  ConnectionStatus,
  LiveWorkflowEvent,
  Message,
  ProjectStatePage,
  ReplyReference,
  SortDirection,
  WorkbenchOverview,
  WorkspaceListStatus,
  WorkspaceRoom,
  WorkspaceSortField,
  WorkflowEvent,
} from './types'

const ACTIVE_WORKSPACE_STORAGE_KEY = 'agenthub.activeWorkspaceId'
const INITIAL_WORKSPACE_PAGE_LIMIT = 20
const WORKSPACE_PAGE_STEP = 20
const WORKSPACE_QUERY_DEBOUNCE_MS = 250
const INITIAL_MESSAGE_PAGE_LIMIT = 40
const MESSAGE_PAGE_STEP = 40

/**
 * Creates a temporary UI message for optimistic chat rendering.
 * Input: workspace id, conversation id, sender metadata, and content.
 * Output: a Message object that only lives in the web client.
 */
function createTemporaryMessage(
  workspaceId: string,
  conversationId: string,
  senderType: Message['senderType'],
  senderId: string,
  content: string,
  replyTo?: Message['replyTo'],
): Message {
  return {
    id: `tmp-${senderId}-${Date.now()}`,
    workspaceId,
    conversationId,
    senderType,
    senderId,
    content,
    replyTo,
    artifacts: [],
    createdAt: new Date().toISOString(),
  }
}

/**
 * Builds the empty workbench overview used before the first backend response arrives.
 * Input: none.
 * Output: empty workbench overview plus pagination metadata.
 */
function emptyWorkbenchOverview(): WorkbenchOverview {
  return {
    agents: [],
    rooms: [],
    page: {
      limit: INITIAL_WORKSPACE_PAGE_LIMIT,
      hasMore: false,
      total: 0,
    },
  }
}

/**
 * Returns the first usable workspace room id from the light workbench overview.
 * Input: overview payload.
 * Output: a valid workspace id or an empty string.
 */
function firstWorkspaceId(overview: WorkbenchOverview): string {
  return overview.rooms[0]?.id ?? ''
}

/**
 * Restores the preferred workspace when it still exists in the next overview.
 * Input: next workbench overview and the preferred workspace id.
 * Output: a valid workspace id or an empty string.
 */
function resolveWorkspaceId(overview: WorkbenchOverview, preferredWorkspaceId: string): string {
  if (preferredWorkspaceId && overview.rooms.some(room => room.id === preferredWorkspaceId)) {
    return preferredWorkspaceId
  }

  return firstWorkspaceId(overview)
}

/**
 * Merges one newly loaded workspace page into the current room list without duplicates.
 * Input: existing rooms and the next paged room slice.
 * Output: one deduplicated room list that keeps the original room order.
 */
function mergeWorkspaceRooms(currentRooms: WorkspaceRoom[], nextRooms: WorkspaceRoom[]): WorkspaceRoom[] {
  const seen = new Set(currentRooms.map(room => room.id))
  return [
    ...currentRooms,
    ...nextRooms.filter(room => {
      if (seen.has(room.id)) {
        return false
      }
      seen.add(room.id)
      return true
    }),
  ]
}

/**
 * Normalizes unknown runtime errors into one readable message.
 * Input: thrown error value.
 * Output: frontend-safe error message text.
 */
function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown backend error.'
}

type BlockingWorkbenchStateProps = {
  kind: 'loading' | 'error'
  message: string
  onRetry?: () => void
}

/**
 * Renders the blocking first-load state before any real workspace exists.
 * Input: state kind, message, and optional retry callback.
 * Output: a full-width loading or error panel.
 */
function BlockingWorkbenchState({ kind, message, onRetry }: BlockingWorkbenchStateProps) {
  return (
    <GlassPanel className="state-screen">
      {kind === 'loading' ? (
        <>
          <OrbMark size="lg" pulse />
          <div className="state-screen__copy">
            <p className="eyebrow">Connecting</p>
            <h2>正在连接本地后端</h2>
            <p>{message}</p>
          </div>
          <div className="state-screen__status">
            <LoaderCircle className="icon-spin" size={18} />
            正在加载工作区和会话数据
          </div>
        </>
      ) : (
        <>
          <div className="state-screen__badge state-screen__badge--error">
            <ServerCrash size={28} />
          </div>
          <div className="state-screen__copy">
            <p className="eyebrow">Backend Error</p>
            <h2>无法连接本地后端</h2>
            <p>{message}</p>
          </div>
          <div className="state-screen__actions">
            <button className="primary-button" type="button" onClick={onRetry}>
              重试连接
            </button>
          </div>
        </>
      )}
    </GlassPanel>
  )
}

/**
 * Renders the AgentHub web workbench.
 * Input: none.
 * Output: the complete business-backed multi-workspace AI conversation UI.
 */
export function App() {
  const [state, setState] = useState<AppState>(() => createEmptyWorkbenchState())
  const [overview, setOverview] = useState<WorkbenchOverview>(() => emptyWorkbenchOverview())
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [connectionErrorMessage, setConnectionErrorMessage] = useState('')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') {
      return ''
    }
    return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) ?? ''
  })
  const [liveWorkflowEvents, setLiveWorkflowEvents] = useState<LiveWorkflowEvent[]>([])
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([])
  const [streamingMessages, setStreamingMessages] = useState<Record<string, Message>>({})
  const [pendingReplyTo, setPendingReplyTo] = useState<ReplyReference>()
  const [pendingCodeSelection, setPendingCodeSelection] = useState<CodeSelectionReference>()
  const [sending, setSending] = useState(false)
  const [loadingState, setLoadingState] = useState(true)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [loadingMoreWorkspaces, setLoadingMoreWorkspaces] = useState(false)
  const [messagePage, setMessagePage] = useState<ProjectStatePage>({
    limit: INITIAL_MESSAGE_PAGE_LIMIT,
    total: 0,
    hasMore: false,
  })
  const [messageLimitByWorkspace, setMessageLimitByWorkspace] = useState<Record<string, number>>({})
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const [appliedWorkspaceQuery, setAppliedWorkspaceQuery] = useState('')
  const [workspaceStatusFilter, setWorkspaceStatusFilter] = useState<WorkspaceListStatus>('active')
  const [workspaceSortBy, setWorkspaceSortBy] = useState<WorkspaceSortField>('updatedAt')
  const [workspaceSortDirection, setWorkspaceSortDirection] = useState<SortDirection>('desc')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [codeDialogOpen, setCodeDialogOpen] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [createWorkspaceError, setCreateWorkspaceError] = useState('')
  const [agentMutationSaving, setAgentMutationSaving] = useState(false)
  const [agentMutationError, setAgentMutationError] = useState('')
  const [deletingAgentId, setDeletingAgentId] = useState<string>()
  const [metadataUpdatingWorkspaceId, setMetadataUpdatingWorkspaceId] = useState<string>()
  const overviewRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const overviewRef = useRef<WorkbenchOverview>(emptyWorkbenchOverview())
  const loadedWorkspaceCountRef = useRef(INITIAL_WORKSPACE_PAGE_LIMIT)
  const workbenchReadyRef = useRef(false)
  const skipNextQueryReloadRef = useRef(false)

  const workflowEvents = useMemo(
    () => mergeWorkflowEvents(state.workflowEvents, liveWorkflowEvents),
    [liveWorkflowEvents, state.workflowEvents],
  )
  const rooms = overview.rooms
  const activeRoom = rooms.find(room => room.id === activeWorkspaceId) ?? rooms[0]
  const activeProjectId = activeRoom?.workspace.projectId ?? activeRoom?.workspace.id
  const activeConversationId = activeRoom?.conversation.id ?? ''
  const currentMessages = [
    ...messagesForConversation(state, activeConversationId),
    ...optimisticMessages.filter(message => message.conversationId === activeConversationId),
  ]
  const currentStreamingMessages = Object.values(streamingMessages).filter(
    message => message.conversationId === activeConversationId,
  )
  const showBlockingState = rooms.length === 0 && (loadingState || connectionStatus === 'error')
  const canCreateWorkspace = connectionStatus === 'live' && !loadingState && !creatingWorkspace
  const composerDisabledReason =
    connectionStatus === 'error'
      ? '后端连接失败，请先点击刷新重试。'
      : loadingState || workspaceLoading
        ? '正在加载当前工作区，请稍候。'
        : ''

  useEffect(() => {
    overviewRef.current = overview
  }, [overview])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = workspaceQuery.trim()
      setAppliedWorkspaceQuery(previous => (previous === nextQuery ? previous : nextQuery))
    }, WORKSPACE_QUERY_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [workspaceQuery])

  /**
   * Loads the lightweight workbench overview from the business backend.
   * Input: optional page size, cursor, query, and merge mode.
   * Output: updates the left-rail summary snapshot when the request is current.
   */
  async function loadWorkbenchOverviewSnapshot(input?: {
    limit?: number
    cursor?: string
    query?: string
    status?: WorkspaceListStatus
    sortBy?: WorkspaceSortField
    sortDirection?: SortDirection
    merge?: boolean
  }): Promise<WorkbenchOverview | undefined> {
    const requestId = ++overviewRequestRef.current
    const nextOverview = await fetchBusinessWorkbenchOverview({
      limit: input?.limit,
      cursor: input?.cursor,
      query: input?.query,
      status: input?.status ?? workspaceStatusFilter,
      sortBy: input?.sortBy ?? workspaceSortBy,
      sortDirection: input?.sortDirection ?? workspaceSortDirection,
    })

    if (requestId !== overviewRequestRef.current) {
      return undefined
    }

    const resolvedOverview = input?.merge
      ? {
          agents: nextOverview.agents,
          rooms: mergeWorkspaceRooms(overviewRef.current.rooms, nextOverview.rooms),
          page: {
            limit: mergeWorkspaceRooms(overviewRef.current.rooms, nextOverview.rooms).length,
            nextCursor: nextOverview.page.nextCursor,
            hasMore: nextOverview.page.hasMore,
            total: nextOverview.page.total,
          },
        }
      : nextOverview

    loadedWorkspaceCountRef.current = Math.max(
      resolvedOverview.rooms.length,
      input?.merge ? loadedWorkspaceCountRef.current : (input?.limit ?? INITIAL_WORKSPACE_PAGE_LIMIT),
    )
    overviewRef.current = resolvedOverview
    setOverview(resolvedOverview)
    setConnectionStatus('live')
    setConnectionErrorMessage('')
    return resolvedOverview
  }

  /**
   * Loads one active workspace state page for the chat pane.
   * Input: selected room, message limit, and loading mode.
   * Output: updates the active AppState only when the request is still current.
   */
  async function loadProjectRoomState(
    room: WorkspaceRoom,
    messageLimit: number,
    mode: 'initial' | 'select' | 'refresh' | 'older',
  ) {
    const requestId = ++detailRequestRef.current
    if (mode === 'older') {
      setLoadingOlderMessages(true)
    } else {
      setWorkspaceLoading(true)
    }

    try {
      const nextEnvelope = await fetchBusinessProjectState(
        room.workspace.projectId ?? room.workspace.id,
        messageLimit,
      )

      if (requestId !== detailRequestRef.current) {
        return
      }

      setState(nextEnvelope.state)
      setMessagePage(nextEnvelope.messagePage)
      setMessageLimitByWorkspace(previous => ({
        ...previous,
        [room.id]: nextEnvelope.messagePage.limit,
      }))
      setConnectionStatus('live')
      setConnectionErrorMessage('')
    } catch (error) {
      if (requestId !== detailRequestRef.current) {
        return
      }

      setConnectionStatus('error')
      setConnectionErrorMessage(errorMessageOf(error))
      if (mode !== 'older') {
        setState(createEmptyWorkbenchState(overviewRef.current.agents))
      }
    } finally {
      if (requestId === detailRequestRef.current) {
        setWorkspaceLoading(false)
        setLoadingOlderMessages(false)
      }
    }
  }

  /**
   * Reloads the overview and the currently selected workspace detail together.
   * Input: preferred workspace id, refresh mode, and optional overview query settings.
   * Output: keeps the UI on one stable active workspace after refresh.
   */
  async function reloadWorkbench(
    preferredWorkspaceId = activeWorkspaceId,
    mode: 'initial' | 'refresh' = 'refresh',
    options?: {
      query?: string
      limit?: number
      status?: WorkspaceListStatus
      sortBy?: WorkspaceSortField
      sortDirection?: SortDirection
    },
  ) {
    setLoadingState(true)
    setCreateWorkspaceError('')

    try {
      const nextOverview = await loadWorkbenchOverviewSnapshot({
        limit: options?.limit ?? (mode === 'initial'
          ? INITIAL_WORKSPACE_PAGE_LIMIT
          : Math.max(loadedWorkspaceCountRef.current, INITIAL_WORKSPACE_PAGE_LIMIT)),
        query: options?.query ?? appliedWorkspaceQuery,
        status: options?.status ?? workspaceStatusFilter,
        sortBy: options?.sortBy ?? workspaceSortBy,
        sortDirection: options?.sortDirection ?? workspaceSortDirection,
      })
      if (!nextOverview) {
        return
      }

      if (!nextOverview.rooms.length) {
        setState(createEmptyWorkbenchState(nextOverview.agents))
        setActiveWorkspaceId('')
        setMessagePage({
          limit: INITIAL_MESSAGE_PAGE_LIMIT,
          total: 0,
          hasMore: false,
        })
        setOptimisticMessages([])
        setStreamingMessages({})
        setLiveWorkflowEvents([])
        return
      }

      const nextWorkspaceId = resolveWorkspaceId(nextOverview, preferredWorkspaceId)
      const nextRoom = nextOverview.rooms.find(room => room.id === nextWorkspaceId) ?? nextOverview.rooms[0]

      if (!nextRoom) {
        return
      }

      const shouldResetActiveState =
        mode === 'initial' ||
        nextWorkspaceId !== activeWorkspaceId ||
        state.workspaces[0]?.id !== nextWorkspaceId

      setActiveWorkspaceId(nextWorkspaceId)
      if (shouldResetActiveState) {
        setOptimisticMessages([])
        setStreamingMessages({})
        setLiveWorkflowEvents([])
        setState(createEmptyWorkbenchState(nextOverview.agents))
        setMessagePage({
          limit: messageLimitByWorkspace[nextWorkspaceId] ?? INITIAL_MESSAGE_PAGE_LIMIT,
          total: 0,
          hasMore: false,
        })
      }

      await loadProjectRoomState(
        nextRoom,
        messageLimitByWorkspace[nextWorkspaceId] ?? INITIAL_MESSAGE_PAGE_LIMIT,
        shouldResetActiveState ? 'initial' : 'refresh',
      )
    } catch (error) {
      setConnectionStatus('error')
      setConnectionErrorMessage(errorMessageOf(error))
    } finally {
      workbenchReadyRef.current = true
      setLoadingState(false)
    }
  }

  useEffect(() => {
    void reloadWorkbench(activeWorkspaceId, 'initial', {
      limit: INITIAL_WORKSPACE_PAGE_LIMIT,
      query: appliedWorkspaceQuery,
      status: workspaceStatusFilter,
      sortBy: workspaceSortBy,
      sortDirection: workspaceSortDirection,
    })
  }, [])

  useEffect(() => {
    if (!rooms.length) {
      if (activeWorkspaceId) {
        setActiveWorkspaceId('')
      }
      return
    }

    if (!rooms.some(room => room.id === activeWorkspaceId)) {
      setActiveWorkspaceId(rooms[0]?.id ?? '')
    }
  }, [activeWorkspaceId, rooms])

  useEffect(() => {
    if (!activeWorkspaceId || typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspaceId)
  }, [activeWorkspaceId])

  useEffect(() => {
    setPendingReplyTo(undefined)
    setPendingCodeSelection(undefined)
  }, [activeConversationId])

  useEffect(() => {
    if (!workbenchReadyRef.current) {
      return
    }
    if (skipNextQueryReloadRef.current) {
      skipNextQueryReloadRef.current = false
      return
    }

    loadedWorkspaceCountRef.current = INITIAL_WORKSPACE_PAGE_LIMIT
    void reloadWorkbench(activeWorkspaceId, 'refresh', {
      limit: INITIAL_WORKSPACE_PAGE_LIMIT,
      query: appliedWorkspaceQuery,
      status: workspaceStatusFilter,
      sortBy: workspaceSortBy,
      sortDirection: workspaceSortDirection,
    })
  }, [appliedWorkspaceQuery, workspaceSortBy, workspaceSortDirection, workspaceStatusFilter])

  /**
   * Switches the active workspace room.
   * Input: workspace id.
   * Output: updates active workspace state.
   */
  async function handleSelectWorkspace(workspaceId: string) {
    const nextRoom = rooms.find(room => room.id === workspaceId)
    if (!nextRoom) {
      return
    }

    setActiveWorkspaceId(workspaceId)
    setPendingReplyTo(undefined)
    setPendingCodeSelection(undefined)
    setOptimisticMessages([])
    setStreamingMessages({})
    setLiveWorkflowEvents([])
    setState(createEmptyWorkbenchState(overview.agents))
    setMessagePage({
      limit: messageLimitByWorkspace[workspaceId] ?? INITIAL_MESSAGE_PAGE_LIMIT,
      total: 0,
      hasMore: false,
    })
    await loadProjectRoomState(
      nextRoom,
      messageLimitByWorkspace[workspaceId] ?? INITIAL_MESSAGE_PAGE_LIMIT,
      'select',
    )
  }

  /**
   * Creates a workspace through the business backend.
   * Input: workspace form payload.
   * Output: updates the workbench state and selects the new workspace.
   */
  async function handleCreateWorkspace(input: CreateWorkspaceInput) {
    setCreateWorkspaceError('')
    setCreatingWorkspace(true)

    const createDirectRoom = input.roomMode === 'direct'
    const targetAgentId = input.targetAgentId

    try {
      const project = await createBusinessWorkspace(
        input.name,
        input.goal,
        createDirectRoom ? 'chat' : input.workspaceType,
        targetAgentId,
      )

      loadedWorkspaceCountRef.current = INITIAL_WORKSPACE_PAGE_LIMIT
      setWorkspaceQuery('')
      skipNextQueryReloadRef.current = true
      setAppliedWorkspaceQuery('')
      await reloadWorkbench(project.workspaceId ?? activeWorkspaceId, 'refresh', {
        limit: INITIAL_WORKSPACE_PAGE_LIMIT,
        query: '',
        status: workspaceStatusFilter,
        sortBy: workspaceSortBy,
        sortDirection: workspaceSortDirection,
      })
      setCreateDialogOpen(false)
    } catch (error) {
      setCreateWorkspaceError(errorMessageOf(error))
    } finally {
      setCreatingWorkspace(false)
    }
  }

  /**
   * Appends a streamed workflow event and updates draft assistant messages.
   * Input: workflow event from the SSE stream.
   * Output: updates event timeline and streaming message drafts.
   */
  function handleStreamEvent(event: WorkflowEvent) {
    const receivedAt = new Date().toISOString()
    setLiveWorkflowEvents(previous => [...previous, { ...event, receivedAt }])

    if (event.type === 'workflow_received') {
      setStreamingMessages(previous => ({
        ...previous,
        [`routing-${event.conversationId}`]: createTemporaryMessage(
          event.workspaceId,
          event.conversationId,
          'agent',
          'orchestrator',
          '主脑正在判断由谁回复...',
        ),
      }))
    }

    if (event.type === 'routing_finished') {
      const speakerId = event.speakerAgentId ?? (event.targetAgents.length === 1 ? event.targetAgents[0] : 'orchestrator')
      setStreamingMessages(previous => ({
        ...previous,
        [`routing-${event.conversationId}`]: createTemporaryMessage(
          event.workspaceId,
          event.conversationId,
          'agent',
          speakerId,
          speakerId === 'orchestrator' ? '主脑正在整理回复...' : '正在整理回复...',
        ),
      }))
    }

    if (event.type === 'assistant_message_started') {
      setStreamingMessages(previous => {
        const next = { ...previous }
        delete next[`routing-${event.conversationId}`]
        next[event.messageId] = createTemporaryMessage(
          event.workspaceId,
          event.conversationId,
          'agent',
          event.senderId,
          '',
        )
        return next
      })
    }

    if (event.type === 'assistant_delta') {
      setStreamingMessages(previous => {
        const current =
          previous[event.messageId] ??
          createTemporaryMessage(event.workspaceId, event.conversationId, 'agent', 'orchestrator', '')

        return {
          ...previous,
          [event.messageId]: {
            ...current,
            content: `${current.content}${event.delta}`,
          },
        }
      })
    }

    if (event.type === 'assistant_message_finished' || event.type === 'assistant_message_error') {
      setStreamingMessages(previous => {
        const next = { ...previous }
        delete next[event.messageId]
        return next
      })
    }

    if (event.type === 'workflow_finished') {
      setStreamingMessages(previous => {
        const next = { ...previous }
        delete next[`routing-${event.conversationId}`]
        return next
      })
    }
  }

  /**
   * Sends a chat message to the active direct or group workspace room through the business backend.
   * Input: message content.
   * Output: streams backend events and refreshes the current workbench snapshot.
   */
  async function handleSend(content: string, replyTo?: ReplyReference, codeSelection?: CodeSelectionReference) {
    if (!activeRoom || connectionStatus !== 'live') {
      return
    }

    const activeWorkspace = activeRoom.workspace
    const activeConversation = activeRoom.conversation
    const agentId = directAgentId(activeConversation)
    const userMessage = createTemporaryMessage(activeWorkspace.id, activeConversation.id, 'user', 'user', content, replyTo)
    setOptimisticMessages(previous => [...previous, userMessage])
    setSending(true)

    try {
      await streamBusinessProjectMessage(
        {
          projectId: activeWorkspace.projectId ?? activeWorkspace.id,
          workspaceId: activeWorkspace.id,
          conversationId: activeConversation.id,
          content,
          agentId,
          replyTo,
          codeSelection,
        },
        handleStreamEvent,
      )

      await reloadWorkbench(activeWorkspace.id, 'refresh')
      setLiveWorkflowEvents([])
      setOptimisticMessages([])
      setStreamingMessages({})
    } catch (error) {
      const message = errorMessageOf(error)
      setConnectionStatus('error')
      setConnectionErrorMessage(message)
      setStreamingMessages({})
      setOptimisticMessages(previous => [
        ...previous,
        createTemporaryMessage(
          activeWorkspace.id,
          activeConversation.id,
          'system',
          'system',
          `发送失败：${message}`,
        ),
      ])
    } finally {
      setSending(false)
    }
  }

  /**
   * Reloads the current live workbench state.
   * Input: none.
   * Output: refreshes state without forcing the user off the current workspace.
   */
  async function handleRefresh() {
    await reloadWorkbench(activeWorkspaceId, 'refresh')
    setLiveWorkflowEvents([])
  }

  /**
   * Loads one more workbench page into the left workspace rail.
   * Input: none.
   * Output: appends the next room slice without replacing the active room.
   */
  async function handleLoadMoreWorkspaces() {
    if (
      loadingMoreWorkspaces ||
      loadingState ||
      !overview.page.hasMore ||
      !overview.page.nextCursor
    ) {
      return
    }

    setLoadingMoreWorkspaces(true)
    try {
      await loadWorkbenchOverviewSnapshot({
        limit: WORKSPACE_PAGE_STEP,
        cursor: overview.page.nextCursor,
        query: appliedWorkspaceQuery,
        status: workspaceStatusFilter,
        sortBy: workspaceSortBy,
        sortDirection: workspaceSortDirection,
        merge: true,
      })
    } catch (error) {
      setConnectionStatus('error')
      setConnectionErrorMessage(errorMessageOf(error))
    } finally {
      setLoadingMoreWorkspaces(false)
    }
  }

  async function handleToggleWorkspacePin(room: WorkspaceRoom) {
    const projectId = room.workspace.projectId ?? room.workspace.id
    setMetadataUpdatingWorkspaceId(room.id)
    try {
      await updateBusinessWorkspaceMetadata(projectId, {
        pinned: !room.workspace.pinnedAt,
      })
      await reloadWorkbench(activeWorkspaceId, 'refresh')
    } catch (error) {
      setConnectionStatus('error')
      setConnectionErrorMessage(errorMessageOf(error))
    } finally {
      setMetadataUpdatingWorkspaceId(undefined)
    }
  }

  async function handleToggleWorkspaceArchive(room: WorkspaceRoom) {
    const projectId = room.workspace.projectId ?? room.workspace.id
    const nextArchived = !room.workspace.archivedAt
    setMetadataUpdatingWorkspaceId(room.id)
    try {
      await updateBusinessWorkspaceMetadata(projectId, {
        archived: nextArchived,
      })
      await reloadWorkbench(nextArchived && room.id === activeWorkspaceId ? '' : activeWorkspaceId, 'refresh')
    } catch (error) {
      setConnectionStatus('error')
      setConnectionErrorMessage(errorMessageOf(error))
    } finally {
      setMetadataUpdatingWorkspaceId(undefined)
    }
  }

  async function handleCreateAgent(input: CreateBusinessAgentInput) {
    setAgentMutationError('')
    setAgentMutationSaving(true)
    try {
      const agent = await createBusinessAgent(input)
      await reloadWorkbench(activeWorkspaceId, 'refresh')
      return agent
    } catch (error) {
      setAgentMutationError(errorMessageOf(error))
      return undefined
    } finally {
      setAgentMutationSaving(false)
    }
  }

  async function handleUpdateAgent(agentId: string, input: UpdateBusinessAgentInput) {
    setAgentMutationError('')
    setAgentMutationSaving(true)
    try {
      const agent = await updateBusinessAgent(agentId, input)
      await reloadWorkbench(activeWorkspaceId, 'refresh')
      return agent
    } catch (error) {
      setAgentMutationError(errorMessageOf(error))
      return undefined
    } finally {
      setAgentMutationSaving(false)
    }
  }

  async function handleDeleteAgent(agentId: string) {
    setAgentMutationError('')
    setDeletingAgentId(agentId)
    try {
      await deleteBusinessAgent(agentId)
      await reloadWorkbench(activeWorkspaceId, 'refresh')
    } catch (error) {
      setAgentMutationError(errorMessageOf(error))
    } finally {
      setDeletingAgentId(undefined)
    }
  }

  /**
   * Loads one older message page for the active workspace by widening the recent message window.
   * Input: none.
   * Output: refreshes only the current workspace state with a larger message page.
   */
  async function handleLoadOlderMessages() {
    if (!activeRoom || loadingOlderMessages || workspaceLoading || !messagePage.hasMore) {
      return
    }

    const nextLimit = (messageLimitByWorkspace[activeRoom.id] ?? messagePage.limit ?? INITIAL_MESSAGE_PAGE_LIMIT) + MESSAGE_PAGE_STEP
    await loadProjectRoomState(activeRoom, nextLimit, 'older')
  }

  /**
   * Resends the latest user message for the active conversation.
   * Input: none.
   * Output: triggers the same send path as a normal submission.
   */
  async function handleRegenerate() {
    const lastUserMessage = [...currentMessages].reverse().find(message => message.senderType === 'user')

    if (!lastUserMessage || sending || connectionStatus !== 'live') {
      return
    }

    await handleSend(lastUserMessage.content, lastUserMessage.replyTo)
  }

  /**
   * Copies one message body into the system clipboard when supported.
   * Input: message content.
   * Output: writes to clipboard and silently ignores unsupported environments.
   */
  async function handleCopyMessage(content: string) {
    if (!navigator.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(content)
    } catch {
      // Ignore clipboard errors in unsupported or restricted contexts.
    }
  }

  /**
   * Stores one quoted message reference for the next outgoing user message.
   * Input: reply reference from the selected message bubble.
   * Output: updates the quote bar state in the composer.
   */
  function handleReplyToMessage(replyTo: ReplyReference) {
    setPendingReplyTo(replyTo)
  }

  /**
   * Stores one quoted code selection for the next outgoing user message.
   * Input: file path, line range, and selected code payload.
   * Output: updates the code quote bar in the composer.
   */
  function handleQuoteCodeSelection(selection: CodeSelectionReference) {
    setPendingCodeSelection(selection)
    setCodeDialogOpen(false)
  }

  const connectionPillStatus =
    connectionStatus === 'live' ? 'success' : loadingState || connectionStatus === 'connecting' ? 'running' : 'failed'
  const connectionPillLabel =
    connectionStatus === 'live' ? 'backend live' : loadingState || connectionStatus === 'connecting' ? 'connecting' : 'backend error'
  const connectionTargetLabel = '业务后端 API / 127.0.0.1:8790'
  const ConnectionIcon = connectionStatus === 'error' ? ServerCrash : Wifi

  return (
    <main className="app-shell" style={{ backgroundImage: `url(${backgroundImage})` }}>
      <BackgroundCanvas />
      <div className="app-overlay" />
      <div className="app-content">
        <header className="topbar">
          <div className="brand-block">
            <OrbMark size="md" pulse />
            <div>
              <p className="eyebrow">AgentHub</p>
              <h1>多 Agent 协作工作台</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <GlassPanel compact className="metric-chip">
              <ConnectionIcon size={15} />
              {connectionTargetLabel}
            </GlassPanel>
            <StatusPill status={connectionPillStatus} label={connectionPillLabel} />
            <GlassPanel compact className="metric-chip">
              <LayoutDashboard size={15} />
              {overview.page.total} 工作区
            </GlassPanel>
            <GlassPanel compact className="metric-chip">
              <PlugZap size={15} />
              {overview.agents.length || state.agents.length} Agents
            </GlassPanel>
            <button
              className="secondary-button topbar-agent-button"
              type="button"
              onClick={() => {
                setAgentMutationError('')
                setAgentDialogOpen(true)
              }}
              disabled={loadingState || creatingWorkspace}
            >
              <Bot size={15} />
              Agents
            </button>
            <button
              className="secondary-button topbar-code-button"
              type="button"
              onClick={() => setCodeDialogOpen(true)}
              disabled={!activeProjectId || loadingState || creatingWorkspace}
            >
              <Braces size={15} />
              代码
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void handleRefresh()}
              title="刷新工作台"
              disabled={loadingState || creatingWorkspace || sending || loadingMoreWorkspaces}
            >
              <RefreshCcw className={loadingState ? 'icon-spin' : ''} size={16} />
            </button>
          </div>
        </header>

        {showBlockingState ? (
          <section className="workbench workbench--single">
            {loadingState ? (
              <BlockingWorkbenchState
                kind="loading"
                message="正在获取真实工作区、会话和 Agent 配置。"
              />
            ) : (
              <BlockingWorkbenchState
                kind="error"
                message={connectionErrorMessage || '本地后端暂时不可用，请确认 127.0.0.1:8790 已启动。'}
                onRetry={() => void handleRefresh()}
              />
            )}
          </section>
        ) : (
          <section className="workbench">
            <WorkspaceRail
              rooms={rooms}
              activeWorkspaceId={activeWorkspaceId}
              query={workspaceQuery}
              loading={loadingState && rooms.length === 0}
              loadingMore={loadingMoreWorkspaces}
              hasMore={overview.page.hasMore}
              total={overview.page.total}
              visibleCount={rooms.length}
              createDisabled={!canCreateWorkspace}
              statusFilter={workspaceStatusFilter}
              sortBy={workspaceSortBy}
              sortDirection={workspaceSortDirection}
              updatingWorkspaceId={metadataUpdatingWorkspaceId}
              onSelectWorkspace={workspaceId => void handleSelectWorkspace(workspaceId)}
              onQueryChange={setWorkspaceQuery}
              onStatusFilterChange={setWorkspaceStatusFilter}
              onSortByChange={setWorkspaceSortBy}
              onSortDirectionChange={setWorkspaceSortDirection}
              onTogglePin={room => void handleToggleWorkspacePin(room)}
              onToggleArchive={room => void handleToggleWorkspaceArchive(room)}
              onLoadMore={() => void handleLoadMoreWorkspaces()}
              onCreateWorkspace={() => setCreateDialogOpen(true)}
            />
            <ChatPane
              state={state}
              room={activeRoom}
              messages={currentMessages}
              streamingMessages={currentStreamingMessages}
              workflowEvents={workflowEvents}
              loading={workspaceLoading}
              connectionStatus={connectionStatus}
              composerDisabledReason={composerDisabledReason}
              sending={sending}
              activeConversationId={activeConversationId}
              replyTarget={pendingReplyTo}
              codeSelectionTarget={pendingCodeSelection}
              hasOlderMessages={messagePage.hasMore}
              loadingOlderMessages={loadingOlderMessages}
              onRegenerate={() => void handleRegenerate()}
              onLoadOlderMessages={() => void handleLoadOlderMessages()}
              onReplyToMessage={handleReplyToMessage}
              onCancelReply={() => setPendingReplyTo(undefined)}
              onCancelCodeSelection={() => setPendingCodeSelection(undefined)}
              onCopyMessage={content => void handleCopyMessage(content)}
              onSend={handleSend}
            />
          </section>
        )}
      </div>

      <CreateWorkspaceDialog
        open={createDialogOpen}
        agents={overview.agents.length > 0 ? overview.agents : state.agents}
        submitting={creatingWorkspace}
        errorMessage={createWorkspaceError}
        sourceTargetLabel={connectionTargetLabel}
        onClose={() => {
          if (!creatingWorkspace) {
            setCreateDialogOpen(false)
          }
        }}
        onSubmit={handleCreateWorkspace}
      />
      <AgentManagementDialog
        open={agentDialogOpen}
        agents={overview.agents.length > 0 ? overview.agents : state.agents}
        saving={agentMutationSaving}
        deletingAgentId={deletingAgentId}
        errorMessage={agentMutationError}
        onClose={() => {
          if (!agentMutationSaving && !deletingAgentId) {
            setAgentDialogOpen(false)
          }
        }}
        onCreate={handleCreateAgent}
        onUpdate={handleUpdateAgent}
        onDelete={handleDeleteAgent}
      />
      <CodeWorkspaceDialog
        open={codeDialogOpen}
        projectId={activeProjectId}
        workspaceName={activeRoom?.workspace.name}
        onClose={() => setCodeDialogOpen(false)}
        onQuoteSelection={handleQuoteCodeSelection}
      />
    </main>
  )
}
