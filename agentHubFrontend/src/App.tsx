import { useEffect, useMemo, useState } from 'react'
import { LayoutDashboard, LoaderCircle, PlugZap, RefreshCcw, ServerCrash, Wifi } from 'lucide-react'
import {
  createBusinessWorkspace,
  createEmptyWorkbenchState,
  fetchBusinessWorkbenchState,
  streamBusinessProjectMessage,
} from './api/businessBackend'
import {
  directAgentId,
  firstWorkspaceRoomId,
  mergeWorkflowEvents,
  messagesForConversation,
  workspaceRooms,
} from './appModel'
import backgroundImage from './asset/background/newBG.png'
import { BackgroundCanvas } from './components/BackgroundCanvas'
import { ChatPane } from './components/ChatPane'
import { CreateWorkspaceDialog, type CreateWorkspaceInput } from './components/CreateWorkspaceDialog'
import { GlassPanel } from './components/GlassPanel'
import { OrbMark } from './components/OrbMark'
import { StatusPill } from './components/StatusPill'
import { WorkspaceRail } from './components/WorkspaceRail'
import type { AppState, ConnectionStatus, LiveWorkflowEvent, Message, WorkflowEvent } from './types'

const ACTIVE_WORKSPACE_STORAGE_KEY = 'agenthub.activeWorkspaceId'

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
): Message {
  return {
    id: `tmp-${senderId}-${Date.now()}`,
    workspaceId,
    conversationId,
    senderType,
    senderId,
    content,
    artifacts: [],
    createdAt: new Date().toISOString(),
  }
}

/**
 * Returns the first usable workspace room id from state.
 * Input: AppState.
 * Output: workspace id or an empty string.
 */
function firstWorkspaceId(state: AppState): string {
  return firstWorkspaceRoomId(state)
}

/**
 * Restores the preferred workspace when it still exists in the next snapshot.
 * Input: next AppState snapshot and the preferred workspace id.
 * Output: a valid workspace id or an empty string.
 */
function resolveWorkspaceId(state: AppState, preferredWorkspaceId: string): string {
  if (preferredWorkspaceId && state.workspaces.some(workspace => workspace.id === preferredWorkspaceId)) {
    return preferredWorkspaceId
  }

  return firstWorkspaceId(state)
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
  const [sending, setSending] = useState(false)
  const [loadingState, setLoadingState] = useState(true)
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [createWorkspaceError, setCreateWorkspaceError] = useState('')

  const workflowEvents = useMemo(
    () => mergeWorkflowEvents(state.workflowEvents, liveWorkflowEvents),
    [liveWorkflowEvents, state.workflowEvents],
  )
  const rooms = useMemo(() => workspaceRooms(state), [state])
  const filteredRooms = useMemo(() => {
    const query = workspaceQuery.trim().toLowerCase()

    if (!query) {
      return rooms
    }

    return rooms.filter(room => {
      const searchText = [room.title, room.subtitle, room.targetAgentId ?? '', ...room.participantAgentIds]
        .join(' ')
        .toLowerCase()
      return searchText.includes(query)
    })
  }, [rooms, workspaceQuery])
  const activeRoom = filteredRooms.find(room => room.id === activeWorkspaceId) ?? filteredRooms[0] ?? rooms[0]
  const activeConversationId = activeRoom?.conversation.id ?? ''
  const currentMessages = [
    ...messagesForConversation(state, activeConversationId),
    ...optimisticMessages.filter(message => message.conversationId === activeConversationId),
  ]
  const currentStreamingMessages = Object.values(streamingMessages).filter(
    message => message.conversationId === activeConversationId,
  )
  const showBlockingState = !rooms.length && (loadingState || connectionStatus === 'error')
  const canCreateWorkspace = connectionStatus === 'live' && !loadingState && !creatingWorkspace
  const composerDisabledReason =
    connectionStatus === 'error'
      ? '后端连接失败，请先点击刷新重试。'
      : loadingState
        ? '正在连接后端，请稍候。'
        : ''

  /**
   * Loads the live workbench state from the business backend.
   * Input: none.
   * Output: updates connection state, snapshot, and workspace selection.
   */
  async function loadWorkbenchState() {
    setLoadingState(true)
    setCreateWorkspaceError('')
    setLiveWorkflowEvents([])
    setStreamingMessages({})
    const preferredWorkspaceId = activeWorkspaceId

    try {
      const nextState = await fetchBusinessWorkbenchState()
      setState(nextState)
      setConnectionStatus('live')
      setConnectionErrorMessage('')
      setOptimisticMessages([])
      setActiveWorkspaceId(resolveWorkspaceId(nextState, preferredWorkspaceId))
    } catch (error) {
      setConnectionStatus('error')
      setConnectionErrorMessage(errorMessageOf(error))
    } finally {
      setLoadingState(false)
    }
  }

  useEffect(() => {
    void loadWorkbenchState()
  }, [])

  useEffect(() => {
    if (activeRoom) {
      return
    }

    const nextRoom = filteredRooms[0] ?? rooms[0]
    if (nextRoom) {
      setActiveWorkspaceId(nextRoom.id)
    }
  }, [activeRoom, filteredRooms, rooms])

  useEffect(() => {
    if (!activeWorkspaceId || typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspaceId)
  }, [activeWorkspaceId])

  /**
   * Switches the active workspace room.
   * Input: workspace id.
   * Output: updates active workspace state.
   */
  function handleSelectWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId)
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
      const nextState = await createBusinessWorkspace(
        input.name,
        input.goal,
        createDirectRoom ? 'chat' : input.workspaceType,
        targetAgentId,
      )
      setState(nextState)
      setConnectionStatus('live')
      setConnectionErrorMessage('')
      setActiveWorkspaceId(firstWorkspaceId(nextState))
      setCreateDialogOpen(false)
    } catch (error) {
      const message = errorMessageOf(error)
      setCreateWorkspaceError(message)
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
  async function handleSend(content: string) {
    if (!activeRoom || connectionStatus !== 'live') {
      return
    }

    const activeWorkspace = activeRoom.workspace
    const activeConversation = activeRoom.conversation
    const agentId = directAgentId(activeConversation)
    const userMessage = createTemporaryMessage(activeWorkspace.id, activeConversation.id, 'user', 'user', content)
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
        },
        handleStreamEvent,
      )

      const nextState = await fetchBusinessWorkbenchState()
      setState(nextState)
      setConnectionStatus('live')
      setConnectionErrorMessage('')
      setOptimisticMessages([])
      setStreamingMessages({})
    } catch (error) {
      const message = errorMessageOf(error)
      setConnectionStatus('error')
      setConnectionErrorMessage(message)
      setStreamingMessages({})
      const errorMessage = createTemporaryMessage(
        activeWorkspace.id,
        activeConversation.id,
        'system',
        'system',
        `发送失败：${message}`,
      )
      setOptimisticMessages(previous => [...previous, errorMessage])
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
    await loadWorkbenchState()
  }

  /**
   * Broadcasts text insertion requests to the chat composer.
   * Input: string to insert into the composer.
   * Output: dispatches a window event consumed by the chat composer.
   */
  function handleInsertComposerText(value: string) {
    window.dispatchEvent(new CustomEvent<string>('agenthub:composer-insert', { detail: value }))
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

    await handleSend(lastUserMessage.content)
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
   * Prefills the composer with a quoted message stub.
   * Input: message content.
   * Output: inserts a short reply scaffold in the composer.
   */
  function handleReplyToMessage(content: string) {
    handleInsertComposerText(`引用上一条消息：\n${content}\n\n`)
  }

  const connectionPillStatus =
    connectionStatus === 'live' ? 'success' : loadingState || connectionStatus === 'connecting' ? 'running' : 'failed'
  const connectionPillLabel =
    connectionStatus === 'live' ? 'backend live' : loadingState || connectionStatus === 'connecting' ? 'connecting' : 'backend error'
  const connectionTargetLabel = '业务后端 API · 127.0.0.1:8790'
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
              {state.workspaces.length} 工作区
            </GlassPanel>
            <GlassPanel compact className="metric-chip">
              <PlugZap size={15} />
              {state.agents.length} Agents
            </GlassPanel>
            <button
              className="icon-button"
              type="button"
              onClick={() => void handleRefresh()}
              title="刷新工作台"
              disabled={loadingState || creatingWorkspace || sending}
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
              state={state}
              rooms={filteredRooms}
              activeWorkspaceId={activeWorkspaceId}
              events={workflowEvents}
              query={workspaceQuery}
              loading={loadingState}
              createDisabled={!canCreateWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              onQueryChange={setWorkspaceQuery}
              onCreateWorkspace={() => setCreateDialogOpen(true)}
            />
            <ChatPane
              state={state}
              room={activeRoom}
              messages={currentMessages}
              streamingMessages={currentStreamingMessages}
              workflowEvents={workflowEvents}
              loading={loadingState}
              connectionStatus={connectionStatus}
              composerDisabledReason={composerDisabledReason}
              sending={sending}
              activeConversationId={activeConversationId}
              onRegenerate={() => void handleRegenerate()}
              onReplyToMessage={handleReplyToMessage}
              onCopyMessage={content => void handleCopyMessage(content)}
              onSend={handleSend}
            />
          </section>
        )}
      </div>

      <CreateWorkspaceDialog
        open={createDialogOpen}
        agents={state.agents}
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
    </main>
  )
}
