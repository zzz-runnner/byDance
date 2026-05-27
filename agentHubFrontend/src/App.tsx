import { useEffect, useMemo, useState } from 'react'
import { LayoutDashboard, PlugZap } from 'lucide-react'
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
import { GlassPanel } from './components/GlassPanel'
import { InsightDock } from './components/InsightDock'
import { OrbMark } from './components/OrbMark'
import { StatusPill } from './components/StatusPill'
import { WatchStrip } from './components/WatchStrip'
import { WorkspaceRail } from './components/WorkspaceRail'
import { createDemoState } from './fixtures/demoState'
import type { AppState, ConnectionStatus, LiveWorkflowEvent, Message, WorkflowEvent, Workspace } from './types'

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
      reason: 'Web Demo 模式下模拟 Orchestrator 进入执行阶段。',
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
  const [state, setState] = useState<AppState>(() => createDemoState())
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => firstWorkspaceId(createDemoState()))
  const [liveWorkflowEvents, setLiveWorkflowEvents] = useState<LiveWorkflowEvent[]>([])
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([])
  const [streamingMessages, setStreamingMessages] = useState<Record<string, Message>>({})
  const [sending, setSending] = useState(false)

  const workflowEvents = useMemo(
    () => mergeWorkflowEvents(state.workflowEvents, liveWorkflowEvents),
    [liveWorkflowEvents, state.workflowEvents],
  )
  const rooms = useMemo(() => workspaceRooms(state), [state])
  const activeRoom = rooms.find(room => room.id === activeWorkspaceId) ?? rooms[0]
  const activeConversationId = activeRoom?.conversation.id ?? ''
  const currentMessages = [
    ...messagesForConversation(state, activeConversationId),
    ...optimisticMessages.filter(message => message.conversationId === activeConversationId),
  ]
  const currentStreamingMessages = Object.values(streamingMessages).filter(
    message => message.conversationId === activeConversationId,
  )

  useEffect(() => {
    let cancelled = false

    /**
     * Loads real business backend state when the API is available.
     * Input: none.
     * Output: updates the page state or switches to demo mode.
     */
    async function loadState() {
      try {
        const nextState = await fetchBusinessWorkbenchState()

        if (cancelled) {
          return
        }

        setState(nextState)
        setConnectionStatus('live')
        setActiveWorkspaceId(firstWorkspaceId(nextState))
      } catch {
        if (!cancelled) {
          setConnectionStatus('demo')
          const demo = createDemoState()
          setState(demo)
          setActiveWorkspaceId(firstWorkspaceId(demo))
        }
      }
    }

    void loadState()

    return () => {
      cancelled = true
    }
  }, [])

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
   * Input: none.
   * Output: prompts for workspace details and updates state.
   */
  async function handleCreateWorkspace() {
    const name = window.prompt('新工作区名称', '新 AgentHub 工作区')?.trim()

    if (!name) {
      return
    }

    const goal = window.prompt('工作区目标', '通过多 Agent 协作完成一个可预览产物。')?.trim() || '通过多 Agent 协作完成一个可预览产物。'
    const createDirectRoom = window.confirm('是否创建单聊工作区？选择“取消”会创建群聊工作区。')
    const targetAgentId = createDirectRoom
      ? window.prompt('单聊目标 Agent', 'engineer')?.trim() || 'engineer'
      : undefined

    if (connectionStatus === 'live') {
      const nextState = await createBusinessWorkspace(name, goal, createDirectRoom ? 'chat' : 'dev', targetAgentId)
      setState(nextState)
      setActiveWorkspaceId(firstWorkspaceId(nextState))
      return
    }

    const workspace = createLocalWorkspace(name, goal, createDirectRoom ? 'chat' : 'dev')
    const conversation = {
      id: `${workspace.id}-${createDirectRoom ? targetAgentId : 'group'}`,
      workspaceId: workspace.id,
      type: createDirectRoom ? 'direct' : 'group',
      title: createDirectRoom ? `${targetAgentId} 单聊工作区` : '项目主群聊',
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
  }

  /**
   * Appends a streamed workflow event and updates draft assistant messages.
   * Input: workflow event from the SSE stream.
   * Output: updates event timeline and streaming message drafts.
   */
  function handleStreamEvent(event: WorkflowEvent) {
    const receivedAt = new Date().toISOString()
    setLiveWorkflowEvents(previous => [...previous, { ...event, receivedAt }])

    if (event.type === 'assistant_message_started') {
      setStreamingMessages(previous => ({
        ...previous,
        [event.messageId]: createTemporaryMessage(
          event.workspaceId,
          event.conversationId,
          'agent',
          event.senderId,
          '',
        ),
      }))
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
      if (connectionStatus !== 'live') {
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
          <WatchStrip
            state={state}
            rooms={rooms}
            activeWorkspaceId={activeWorkspaceId}
            events={workflowEvents}
            onSelectWorkspace={handleSelectWorkspace}
          />
          <div className="topbar-actions">
            <StatusPill
              status={connectionStatus === 'live' ? 'success' : connectionStatus === 'connecting' ? 'running' : 'demo'}
              label={connectionStatus === 'live' ? 'backend live' : connectionStatus === 'connecting' ? 'connecting' : 'demo mode'}
            />
            <GlassPanel compact className="metric-chip">
              <LayoutDashboard size={15} />
              {state.workspaces.length} 工作区
            </GlassPanel>
            <GlassPanel compact className="metric-chip">
              <PlugZap size={15} />
              {state.agents.length} Agents
            </GlassPanel>
          </div>
        </header>

        <section className="workbench">
          <WorkspaceRail
            state={state}
            rooms={rooms}
            activeWorkspaceId={activeWorkspaceId}
            events={workflowEvents}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
          />
          <ChatPane
            state={state}
            room={activeRoom}
            messages={currentMessages}
            streamingMessages={currentStreamingMessages}
            sending={sending}
            onSend={handleSend}
          />
          <InsightDock
            state={state}
            room={activeRoom}
            events={workflowEvents}
          />
        </section>
      </div>
    </main>
  )
}
