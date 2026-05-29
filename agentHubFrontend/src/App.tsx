import { useEffect, useMemo, useState } from 'react'
import { LayoutDashboard, PlugZap, RefreshCcw, ServerCrash, Wifi, WifiOff } from 'lucide-react'
import {
  createBusinessWorkspace,
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
import { InsightDock } from './components/InsightDock'
import { OrbMark } from './components/OrbMark'
import { StatusPill } from './components/StatusPill'
import { WorkspaceRail } from './components/WorkspaceRail'
import { createDemoState } from './fixtures/demoState'
import type { AppState, ConnectionStatus, LiveWorkflowEvent, Message, WorkflowEvent, Workspace } from './types'

type DataMode = 'auto' | 'live' | 'mock'
const ACTIVE_WORKSPACE_STORAGE_KEY = 'agenthub.activeWorkspaceId'

const INITIAL_DEMO_STATE = createDemoState()

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
 * Creates a local demo workspace when the backend is not available.
 * Input: workspace name and goal.
 * Output: a Workspace object for the in-memory demo state.
 */
function createLocalWorkspace(name: string, goal: string, workspaceType: Workspace['workspaceType']): Workspace {
  const now = new Date().toISOString()
  const id = `ws-local-${Date.now()}`

  return {
    id,
    projectId: id,
    name,
    goal,
    workspaceType,
    rootPath: `data/workspaces/${id}/repo`,
    runtimeType: 'local',
    runtimeStatus: 'ready',
    projectBrief: goal,
    pinnedMessageIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Creates simulated workflow events for the offline demo path.
 * Input: workspace id and conversation id.
 * Output: live workflow events that mirror the backend workflow event shape.
 */
function createDemoWorkflowEvents(workspaceId: string, conversationId: string): LiveWorkflowEvent[] {
  const receivedAt = new Date().toISOString()
  const events: WorkflowEvent[] = [
    {
      type: 'task_stage_updated',
      workspaceId,
      conversationId,
      taskStage: 'execution',
      executionReadiness: 'execution_in_progress',
      needsUserConfirmation: false,
      reason: 'Mock 模式下模拟 Orchestrator 进入执行阶段。',
    },
    {
      type: 'agent_task_dispatched',
      workspaceId,
      conversationId,
      agentId: 'engineer',
      agentName: '工程师 Agent',
      handoffId: `handoff-web-${Date.now()}`,
      sessionId: `session-web-${Date.now()}`,
      source: 'main',
      task: '根据当前聊天上下文生成可预览页面，并输出实现摘要。',
      expectedOutput: '页面代码、预览卡、测试结论',
      requiredContext: ['比赛要求', '当前工作区目标', 'UI 玻璃风约束'],
    },
    {
      type: 'assistant_message_finished',
      workspaceId,
      conversationId,
      scope: 'main_brain',
      messageId: `message-web-${Date.now()}`,
      contentLength: 120,
    },
  ]

  return events.map(event => ({
    ...event,
    receivedAt,
  }))
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
 * Renders the AgentHub web workbench.
 * Input: none.
 * Output: the complete business-backed multi-workspace AI conversation UI.
 */
export function App() {
  const [state, setState] = useState<AppState>(INITIAL_DEMO_STATE)
  const [dataMode, setDataMode] = useState<DataMode>('auto')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') {
      return firstWorkspaceId(INITIAL_DEMO_STATE)
    }
    return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) ?? firstWorkspaceId(INITIAL_DEMO_STATE)
  })
  const [liveWorkflowEvents, setLiveWorkflowEvents] = useState<LiveWorkflowEvent[]>([])
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([])
  const [streamingMessages, setStreamingMessages] = useState<Record<string, Message>>({})
  const [sending, setSending] = useState(false)
  const [loadingState, setLoadingState] = useState(false)
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

  /**
   * Loads real business backend state or falls back to the demo state.
   * Input: selected data mode and preserve-selection flag.
   * Output: updates connection state and current workbench snapshot.
   */
  async function loadWorkbenchState(nextMode: DataMode, preserveSelection = false) {
    setLoadingState(true)
    setCreateWorkspaceError('')

    try {
      if (nextMode === 'mock') {
        const demo = createDemoState()
        setState(demo)
        setConnectionStatus('demo')
        if (!preserveSelection) {
          setActiveWorkspaceId(firstWorkspaceId(demo))
        }
        return
      }

      const nextState = await fetchBusinessWorkbenchState()
      setState(nextState)
      setConnectionStatus('live')
      if (!preserveSelection) {
        setActiveWorkspaceId(firstWorkspaceId(nextState))
      }
    } catch {
      if (nextMode === 'live') {
        setConnectionStatus('error')
        return
      }

      const demo = createDemoState()
      setState(demo)
      setConnectionStatus('demo')
      if (!preserveSelection) {
        setActiveWorkspaceId(firstWorkspaceId(demo))
      }
    } finally {
      setLoadingState(false)
    }
  }

  useEffect(() => {
    void loadWorkbenchState(dataMode)
  }, [dataMode])

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
   * Creates a workspace through the backend or local demo state.
   * Input: workspace form payload.
   * Output: updates the workbench state and selects the new workspace.
   */
  async function handleCreateWorkspace(input: CreateWorkspaceInput) {
    setCreateWorkspaceError('')
    setCreatingWorkspace(true)

    const createDirectRoom = input.roomMode === 'direct'
    const targetAgentId = input.targetAgentId

    try {
      if (connectionStatus === 'live' && dataMode !== 'mock') {
        const nextState = await createBusinessWorkspace(
          input.name,
          input.goal,
          createDirectRoom ? 'chat' : input.workspaceType,
          targetAgentId,
        )
        setState(nextState)
        setActiveWorkspaceId(firstWorkspaceId(nextState))
        setCreateDialogOpen(false)
        return
      }

      const workspace = createLocalWorkspace(input.name, input.goal, createDirectRoom ? 'chat' : input.workspaceType)
      const conversation = {
        id: `${workspace.id}-${createDirectRoom ? targetAgentId : 'group'}`,
        workspaceId: workspace.id,
        type: createDirectRoom ? 'direct' : 'group',
        title: createDirectRoom ? `${targetAgentId ?? 'engineer'} 单聊工作区` : '项目主群聊',
        participants: createDirectRoom
          ? ['user', targetAgentId ?? 'engineer']
          : ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer'],
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      } as const

      setState(previous => ({
        ...previous,
        workspaces: [workspace, ...previous.workspaces],
        conversations: [conversation, ...previous.conversations],
      }))
      setActiveWorkspaceId(workspace.id)
      setCreateDialogOpen(false)
    } catch (error) {
      setCreateWorkspaceError(error instanceof Error ? error.message : '创建工作区失败。')
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
   * Output: streams backend events or simulates a demo response.
   */
  async function handleSend(content: string) {
    if (!activeRoom) {
      return
    }

    const activeWorkspace = activeRoom.workspace
    const activeConversation = activeRoom.conversation
    const agentId = directAgentId(activeConversation)
    const userMessage = createTemporaryMessage(activeWorkspace.id, activeConversation.id, 'user', 'user', content)
    setOptimisticMessages(previous => [...previous, userMessage])
    setSending(true)

    try {
      if (connectionStatus !== 'live' || dataMode === 'mock') {
        const demoEvents = createDemoWorkflowEvents(activeWorkspace.id, activeConversation.id)
        const reply = createTemporaryMessage(
          activeWorkspace.id,
          activeConversation.id,
          'agent',
          activeRoom.kind === 'direct' ? agentId ?? 'orchestrator' : 'orchestrator',
          activeRoom.kind === 'direct'
            ? '收到，这是单聊任务。我会基于当前 Agent 的长期上下文给出可执行建议。'
            : '收到，Orchestrator 已拆解任务：先澄清范围，再派发工程师实现，最后让 Reviewer 验收。',
        )
        setLiveWorkflowEvents(previous => [...previous, ...demoEvents])
        setOptimisticMessages(previous => [...previous, reply])
        return
      }

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
      setOptimisticMessages([])
      setStreamingMessages({})
    } catch (error) {
      setConnectionStatus('error')
      const message = error instanceof Error ? error.message : '未知错误'
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
   * Reloads the current workbench state using the selected mode.
   * Input: none.
   * Output: refreshes state without forcing the user off the current workspace.
   */
  async function handleRefresh() {
    await loadWorkbenchState(dataMode, true)
  }

  /**
   * Updates the active data mode and clears transient chat state.
   * Input: target data mode.
   * Output: switches between auto, live-only, and mock-only sources.
   */
  function handleSwitchDataMode(nextMode: DataMode) {
    if (nextMode === dataMode) {
      return
    }

    setDataMode(nextMode)
    setLiveWorkflowEvents([])
    setOptimisticMessages([])
    setStreamingMessages({})
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

    if (!lastUserMessage || sending) {
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

  const modeLabel = dataMode === 'mock' ? 'mock only' : dataMode === 'live' ? 'live only' : 'auto'
  const connectionPillStatus =
    connectionStatus === 'live' ? 'success' : connectionStatus === 'connecting' ? 'running' : connectionStatus === 'error' ? 'failed' : 'demo'
  const connectionPillLabel =
    connectionStatus === 'live' ? 'backend live' : connectionStatus === 'connecting' ? 'connecting' : connectionStatus === 'error' ? 'backend error' : 'demo mode'
  const sourceTargetLabel = dataMode === 'mock' ? '本地 Mock 数据' : dataMode === 'live' ? '业务后端 API' : '自动探测，失败回退 Mock'
  const ConnectionIcon = connectionStatus === 'live' ? Wifi : connectionStatus === 'error' ? ServerCrash : WifiOff

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
            <GlassPanel compact className="mode-toggle">
              <button
                className={`mode-toggle__button ${dataMode === 'auto' ? 'is-active' : ''}`}
                type="button"
                onClick={() => handleSwitchDataMode('auto')}
              >
                Auto
              </button>
              <button
                className={`mode-toggle__button ${dataMode === 'live' ? 'is-active' : ''}`}
                type="button"
                onClick={() => handleSwitchDataMode('live')}
              >
                Live
              </button>
              <button
                className={`mode-toggle__button ${dataMode === 'mock' ? 'is-active' : ''}`}
                type="button"
                onClick={() => handleSwitchDataMode('mock')}
              >
                Mock
              </button>
            </GlassPanel>
            <GlassPanel compact className="metric-chip">
              <ConnectionIcon size={15} />
              {modeLabel}
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
            <button className="icon-button" type="button" onClick={() => void handleRefresh()} title="刷新工作台">
              <RefreshCcw size={16} />
            </button>
          </div>
        </header>

        <section className="workbench">
          <WorkspaceRail
            state={state}
            rooms={filteredRooms}
            activeWorkspaceId={activeWorkspaceId}
            events={workflowEvents}
            query={workspaceQuery}
            loading={loadingState}
            onSelectWorkspace={handleSelectWorkspace}
            onQueryChange={setWorkspaceQuery}
            onCreateWorkspace={() => setCreateDialogOpen(true)}
          />
          <ChatPane
            state={state}
            room={activeRoom}
            messages={currentMessages}
            streamingMessages={currentStreamingMessages}
            sending={sending}
            activeConversationId={activeConversationId}
            onRegenerate={() => void handleRegenerate()}
            onReplyToMessage={handleReplyToMessage}
            onCopyMessage={content => void handleCopyMessage(content)}
            onSend={handleSend}
          />
          <InsightDock
            state={state}
            room={activeRoom}
            events={workflowEvents}
          />
        </section>
      </div>

      <CreateWorkspaceDialog
        open={createDialogOpen}
        agents={state.agents}
        submitting={creatingWorkspace}
        errorMessage={createWorkspaceError}
        sourceTargetLabel={sourceTargetLabel}
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
