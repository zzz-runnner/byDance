import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Globe2,
  LoaderCircle,
  MessageSquareReply,
  RefreshCcw,
  ShieldCheck,
  TerminalSquare,
  X,
} from 'lucide-react'
import {
  buildAgentMap,
  formatTime,
  workspaceRoomKindLabel,
  type WorkspaceRoom,
} from '../appModel'
import {
  buildChatTimeline,
  type ChatProcessTone,
  type ChatTimelineItem,
  type ChatTurn,
  type ChatTurnArtifact,
  type ChatTurnProcessEntry,
} from '../chatTimeline'
import type { AgentDefinition, AppState, Artifact, ConnectionStatus, LiveWorkflowEvent, Message, ReplyReference } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { AgentMentionPicker, type AgentMentionOption } from './AgentMentionPicker'
import { GlassPanel } from './GlassPanel'
import { MarkdownRenderer } from './MarkdownRenderer'
import { OrbMark } from './OrbMark'
import { StatusPill } from './StatusPill'

type ChatPaneProps = {
  state: AppState
  room: WorkspaceRoom | undefined
  messages: Message[]
  streamingMessages: Message[]
  workflowEvents: LiveWorkflowEvent[]
  loading: boolean
  connectionStatus: ConnectionStatus
  composerDisabledReason: string
  sending: boolean
  activeConversationId: string
  replyTarget?: ReplyReference
  onRegenerate: () => void
  onReplyToMessage: (replyTo: ReplyReference) => void
  onCancelReply: () => void
  onCopyMessage: (content: string) => void
  onSend: (content: string, replyTo?: ReplyReference) => void
}

type MentionMatch = {
  start: number
  end: number
  query: string
}

type PreviewFrameStatus = 'loading' | 'slow' | 'ready' | 'error'

/**
 * Clips one quoted message into a single-line excerpt for reply previews.
 * Input: raw message text and an optional max length. Output: compact preview text.
 */
function clipReplyExcerpt(content: string, maxLength = 120): string {
  const normalized = content
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^[#>\-\*\d.\s|]+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) {
    return '无内容'
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

/**
 * Resolves the visible sender label for one chat bubble.
 * Input: message plus optional agent display name. Output: readable sender label.
 */
function messageSenderLabel(message: Message, senderName?: string): string {
  if (message.senderType === 'user') {
    return '你'
  }
  return senderName ?? message.senderId
}

/**
 * Builds the persisted reply reference from one visible message bubble.
 * Input: message plus its visible sender label. Output: structured reply payload.
 */
function buildMessageReplyReference(message: Message, senderName?: string): ReplyReference {
  return {
    messageId: message.id,
    senderId: message.senderId,
    senderName: messageSenderLabel(message, senderName),
    excerpt: clipReplyExcerpt(message.content),
  }
}

/**
 * Resolves the label displayed inside quote bars and quoted bubble headers.
 * Input: reply reference. Output: readable sender label.
 */
function replySenderLabel(replyTo: ReplyReference): string {
  return replyTo.senderName?.trim() || replyTo.senderId
}

/**
 * Builds the available child-agent options for one group room.
 * Input: active room and the agent lookup table.
 * Output: unique agent options used by the @ mention popup.
 */
function groupMentionOptions(room: WorkspaceRoom | undefined, agentMap: Map<string, AgentDefinition>): AgentMentionOption[] {
  if (!room || room.kind !== 'group') {
    return []
  }

  return [...new Set(room.participantAgentIds)]
    .filter(agentId => agentId !== 'orchestrator')
    .map(agentId => ({
      id: agentId,
      name: agentMap.get(agentId)?.name ?? agentId,
    }))
}

/**
 * Detects the active @ mention token around the current textarea caret.
 * Input: composer text and the current selection bounds.
 * Output: the mention range with query text, or null when no mention is active.
 */
function findActiveMention(value: string, selectionStart: number | null, selectionEnd: number | null): MentionMatch | null {
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) {
    return null
  }

  let start = selectionStart
  while (start > 0 && !/\s/.test(value[start - 1] ?? '')) {
    start -= 1
  }

  if (value[start] !== '@') {
    return null
  }

  let end = selectionStart
  while (end < value.length && !/\s/.test(value[end] ?? '')) {
    end += 1
  }

  const query = value.slice(start + 1, end)

  if (query.includes('@')) {
    return null
  }

  return {
    start,
    end,
    query,
  }
}

/**
 * Returns the default expansion state for one turn process panel.
 * Input: one chat turn.
 * Output: true when the process should stay open by default.
 */
function shouldDefaultExpandTurn(turn: ChatTurn): boolean {
  return turn.status === 'running' || turn.status === 'failed' || turn.status === 'partial'
}

/**
 * Returns a readable status label for the process header.
 * Input: one chat turn.
 * Output: short Chinese label.
 */
function processStatusLabel(turn: ChatTurn): string {
  if (turn.status === 'failed') {
    return '失败'
  }
  if (turn.status === 'partial') {
    return '部分完成'
  }
  if (turn.status === 'completed') {
    return '已完成'
  }
  return '进行中'
}

/**
 * Renders the central chat surface for direct and group workspace rooms.
 * Input: app state, active workspace room, messages, streaming messages, workflow events, and send state.
 * Output: the chat timeline and composer.
 */
export function ChatPane({
  state,
  room,
  messages,
  streamingMessages,
  workflowEvents,
  loading,
  connectionStatus,
  composerDisabledReason,
  sending,
  activeConversationId,
  replyTarget,
  onRegenerate,
  onReplyToMessage,
  onCancelReply,
  onCopyMessage,
  onSend,
}: ChatPaneProps) {
  const agentMap = buildAgentMap(state)
  const activeAgent = room?.targetAgentId ? agentMap.get(room.targetAgentId) : undefined
  const mentionOptions = groupMentionOptions(room, agentMap)
  const timelineItems = useMemo(
    () =>
      room
        ? buildChatTimeline({
            state,
            workspaceId: room.workspace.id,
            conversationId: room.conversation.id,
            messages,
            streamingMessages,
            workflowEvents,
          })
        : [],
    [messages, room, state, streamingMessages, workflowEvents],
  )
  const scrollSignature = useMemo(
    () =>
      timelineItems
        .map(item => item.kind === 'message'
          ? `${item.message.id}:${item.message.createdAt}`
          : `${item.turn.id}:${item.turn.updatedAt}:${item.turn.processEntries.length}:${item.turn.artifacts.length}`)
        .join('|'),
    [timelineItems],
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [artifactDialog, setArtifactDialog] = useState<ChatTurnArtifact | null>(null)
  const [turnExpandOverrides, setTurnExpandOverrides] = useState<Record<string, boolean>>({})
  const composerDisabled = connectionStatus !== 'live' || loading
  const headerStatus =
    sending ? 'running' : connectionStatus === 'error' ? 'failed' : loading ? 'running' : 'ready'
  const headerStatusLabel =
    sending
      ? 'streaming'
      : connectionStatus === 'error'
        ? 'backend offline'
        : loading
          ? 'connecting'
          : room?.kind === 'group'
            ? 'orchestrated'
            : 'direct'

  /**
   * Scrolls the chat list to the latest message.
   * Input: desired browser scroll behavior. Output: none.
   */
  function scrollToBottom(behavior: ScrollBehavior = 'auto') {
    const container = scrollRef.current
    if (!container) {
      return
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    })
  }

  useEffect(() => {
    scrollToBottom('auto')
    setIsNearBottom(true)
  }, [activeConversationId])

  useEffect(() => {
    if (!timelineItems.length || !isNearBottom) {
      return
    }
    scrollToBottom(messages.length > 0 ? 'smooth' : 'auto')
  }, [isNearBottom, messages.length, scrollSignature, timelineItems.length])

  useEffect(() => {
    const activeTurnIds = new Set(
      timelineItems
        .filter((item): item is Extract<ChatTimelineItem, { kind: 'turn' }> => item.kind === 'turn')
        .map(item => item.turn.id),
    )

    setTurnExpandOverrides(previous => {
      const nextEntries = Object.entries(previous).filter(([turnId]) => activeTurnIds.has(turnId))
      return Object.fromEntries(nextEntries)
    })
  }, [timelineItems])

  /**
   * Tracks whether the user is still close enough to the latest message.
   * Input: scroll event from the chat container. Output: updates follow-scroll state.
   */
  function handleScroll() {
    const container = scrollRef.current
    if (!container) {
      return
    }
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setIsNearBottom(distanceToBottom <= 96)
  }

  /**
   * Returns whether one turn process panel is currently expanded.
   * Input: one chat turn.
   * Output: expanded state after user overrides and defaults.
   */
  function isTurnExpanded(turn: ChatTurn): boolean {
    return turnExpandOverrides[turn.id] ?? shouldDefaultExpandTurn(turn)
  }

  /**
   * Toggles one turn process panel while preserving the default auto-collapse behavior.
   * Input: one chat turn.
   * Output: updates the local expansion override table.
   */
  function toggleTurn(turn: ChatTurn) {
    const defaultExpanded = shouldDefaultExpandTurn(turn)
    const currentExpanded = turnExpandOverrides[turn.id] ?? defaultExpanded
    const nextExpanded = !currentExpanded

    setTurnExpandOverrides(previous => {
      const next = { ...previous }
      if (nextExpanded === defaultExpanded) {
        delete next[turn.id]
      } else {
        next[turn.id] = nextExpanded
      }
      return next
    })
  }

  return (
    <GlassPanel className="chat-pane">
      <header className="chat-header">
        <div className="chat-title-block">
          <div className="chat-title-icon">
            {room?.kind === 'group' ? <OrbMark size="sm" pulse /> : <AgentAvatar agentId={room?.targetAgentId ?? 'orchestrator'} size="sm" />}
          </div>
          <div>
            <p className="eyebrow">{room ? workspaceRoomKindLabel(room.kind) : 'Workspace Room'}</p>
            <h1>{room?.title ?? '选择一个工作区'}</h1>
            <span className="chat-subtitle">
              {room?.kind === 'direct'
                ? `固定发给 ${activeAgent?.name ?? room.targetAgentId ?? 'Agent'}`
                : '支持 @ 指定子 Agent，执行过程、产物和最终结果都会直接落在聊天记录里'}
            </span>
          </div>
        </div>
        <div className="chat-header-actions">
          <StatusPill
            status={headerStatus}
            label={headerStatusLabel}
          />
          <button
            className="icon-button"
            type="button"
            title="重新生成上一条任务"
            onClick={onRegenerate}
            disabled={sending || !room || composerDisabled}
          >
            <RefreshCcw size={16} />
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        {timelineItems.length > 0 ? (
          timelineItems.map(item =>
            item.kind === 'message' ? (
              <MessageBubble
                key={item.id}
                message={item.message}
                senderName={item.message.senderType === 'agent' ? agentMap.get(item.message.senderId)?.name : undefined}
                onReply={onReplyToMessage}
                onCopy={onCopyMessage}
              />
            ) : (
              <TurnBlock
                key={item.id}
                turn={item.turn}
                agentMap={agentMap}
                expanded={isTurnExpanded(item.turn)}
                onToggle={() => toggleTurn(item.turn)}
                onReply={onReplyToMessage}
                onCopy={onCopyMessage}
                onOpenArtifact={setArtifactDialog}
              />
            ),
          )
        ) : (
          <EmptyChatState room={room} loading={loading} />
        )}
      </div>
      {!isNearBottom && timelineItems.length > 0 ? (
        <button className="chat-jump-button" type="button" onClick={() => scrollToBottom('smooth')}>
          <ArrowDown size={14} />
          回到底部
        </button>
      ) : null}

      <ChatComposer
        room={room}
        sending={sending}
        mentionOptions={mentionOptions}
        replyTarget={replyTarget}
        disabledReason={composerDisabledReason}
        onCancelReply={onCancelReply}
        onSend={onSend}
      />

      {artifactDialog ? (
        <ArtifactDialog
          artifact={artifactDialog}
          onClose={() => setArtifactDialog(null)}
        />
      ) : null}
    </GlassPanel>
  )
}

type TurnBlockProps = {
  turn: ChatTurn
  agentMap: Map<string, AgentDefinition>
  expanded: boolean
  onToggle: () => void
  onReply: (replyTo: ReplyReference) => void
  onCopy: (content: string) => void
  onOpenArtifact: (artifact: ChatTurnArtifact) => void
}

/**
 * Renders one complete chat turn with user input, process, artifacts, and the final result.
 * Input: one grouped turn plus UI callbacks.
 * Output: a turn block inside the chat timeline.
 */
function TurnBlock({
  turn,
  agentMap,
  expanded,
  onToggle,
  onReply,
  onCopy,
  onOpenArtifact,
}: TurnBlockProps) {
  const finalMessage = turn.finalMessage ?? turn.streamingMessage
  const finalSpeakerName = finalMessage?.senderType === 'agent' ? agentMap.get(finalMessage.senderId)?.name : undefined

  return (
    <article className="turn-block">
      <MessageBubble
        message={turn.userMessage}
        onReply={onReply}
        onCopy={onCopy}
      />

      {(turn.processEntries.length > 0 || turn.status === 'running') ? (
        <section className={`turn-process turn-process--${turn.status}`}>
          <button className="turn-process__header" type="button" onClick={onToggle}>
            <span className="turn-process__title">
              <TerminalSquare size={15} />
              本轮过程
            </span>
            <span className="turn-process__meta">
              <StatusPill status={turnStatusPillStatus(turn)} label={processStatusLabel(turn)} />
              <em>{turn.processEntries.length} 条</em>
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          </button>

          {expanded ? (
            <div className="turn-process__body">
              {turn.processEntries.length > 0 ? (
                turn.processEntries.map(entry => (
                  <ProcessEntryCard
                    key={entry.id}
                    entry={entry}
                    agentName={entry.agentId ? agentMap.get(entry.agentId)?.name : undefined}
                  />
                ))
              ) : (
                <div className="turn-process__empty">
                  <LoaderCircle size={15} />
                  <span>正在等待更多过程事件...</span>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {turn.artifacts.length > 0 ? (
        <div className="turn-artifact-grid">
          {turn.artifacts.map(artifact => (
            <TurnArtifactCard
              key={artifact.id}
              artifact={artifact}
              agentName={artifact.agentId ? agentMap.get(artifact.agentId)?.name : undefined}
              onOpenArtifact={onOpenArtifact}
            />
          ))}
        </div>
      ) : null}

      {finalMessage ? (
        <MessageBubble
          message={finalMessage}
          senderName={finalSpeakerName}
          onReply={onReply}
          onCopy={onCopy}
          renderArtifacts={false}
          forceStreaming={Boolean(turn.streamingMessage && !turn.finalMessage)}
        />
      ) : turn.status === 'running' ? (
        <PendingResultBubble />
      ) : null}
    </article>
  )
}

type ProcessEntryCardProps = {
  entry: ChatTurnProcessEntry
  agentName?: string
}

/**
 * Renders one structured process card inside the turn process panel.
 * Input: process entry and optional agent display name.
 * Output: one process card.
 */
function ProcessEntryCard({ entry, agentName }: ProcessEntryCardProps) {
  const Icon = processEntryIcon(entry)

  return (
    <article className={`process-card process-card--${entry.kind} process-card--${entry.tone}`}>
      <div className="process-card__top">
        <span className="process-card__icon">
          <Icon size={14} />
        </span>
        <div className="process-card__content">
          <div className="process-card__headline">
            <strong>{entry.title}</strong>
            <time>{formatTime(entry.time)}</time>
          </div>
          <div className="process-card__meta">
            {entry.badge ? <span className={`process-card__badge process-card__badge--${entry.kind}`}>{entry.badge}</span> : null}
            {agentName ? <span className="process-card__agent">{agentName}</span> : null}
            {entry.meta ? <span className="process-card__meta-text">{entry.meta}</span> : null}
          </div>
        </div>
      </div>
      {entry.summary ? (
        <MarkdownRenderer content={entry.summary} mode="process" className="markdown-content--process-body" />
      ) : null}
      {entry.logExcerpt ? <ProcessLogBlock entry={entry} /> : null}
      {entry.detail ? (
        <MarkdownRenderer content={entry.detail} mode="process" className="markdown-content--process-detail" />
      ) : null}
    </article>
  )
}

type ProcessLogBlockProps = {
  entry: ChatTurnProcessEntry
}

/**
 * Renders one expandable execution log excerpt inside a process card.
 * Input: process entry with aggregated log text.
 * Output: one log block with collapse and expand behavior.
 */
function ProcessLogBlock({ entry }: ProcessLogBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const logText = entry.logExcerpt ?? ''
  const logLines = logText.split('\n').filter(Boolean)
  const canExpand = logLines.length > 6 || logText.length > 360
  const visibleText = canExpand && !expanded ? logLines.slice(-6).join('\n') : logText

  return (
    <div className={`process-log process-log--${entry.logStream ?? 'stdout'}`}>
      <div className="process-log__header">
        <span>{entry.logStream ?? 'log'}</span>
        {canExpand ? (
          <button
            className="process-log__toggle"
            type="button"
            onClick={() => setExpanded(previous => !previous)}
          >
            {expanded ? '收起日志' : '展开日志'}
          </button>
        ) : null}
      </div>
      <pre className="process-log__body">{visibleText}</pre>
    </div>
  )
}

type MessageBubbleProps = {
  message: Message
  senderName?: string
  onReply: (replyTo: ReplyReference) => void
  onCopy: (content: string) => void
  renderArtifacts?: boolean
  forceStreaming?: boolean
}

/**
 * Renders one chat message with optional inline artifacts.
 * Input: message record and optional sender display name.
 * Output: one chat bubble row.
 */
function MessageBubble({
  message,
  senderName,
  onReply,
  onCopy,
  renderArtifacts = true,
  forceStreaming = false,
}: MessageBubbleProps) {
  const isUser = message.senderType === 'user'
  const isStreamingPlaceholder = forceStreaming || (!isUser && message.content.trim().length === 0)
  const senderLabel = messageSenderLabel(message, senderName)
  const canReply = message.content.trim().length > 0

  return (
    <article className={`message-row ${isUser ? 'message-row--user' : ''}`}>
      {!isUser ? <AgentAvatar agentId={message.senderId} name={senderName} /> : null}
      <div className="message-stack">
        <div className="message-meta">
          <strong>{senderLabel}</strong>
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <div className={`message-bubble ${isUser ? 'message-bubble--user' : 'message-bubble--agent'}`}>
          {message.replyTo ? (
            <div className="message-quote">
              <strong>{replySenderLabel(message.replyTo)}</strong>
              <span>{message.replyTo.excerpt}</span>
            </div>
          ) : null}
          {message.content ? (
            isUser ? (
              <p>{message.content}</p>
            ) : (
              <MarkdownRenderer content={message.content} mode="bubble" className="markdown-content--bubble" />
            )
          ) : (
            <p>正在生成回复...</p>
          )}
          {isStreamingPlaceholder ? (
            <div className="message-typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {renderArtifacts && message.artifacts.length > 0 ? (
            <div className="artifact-grid">
              {message.artifacts.map(artifact => (
                <InlineArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          ) : null}
          <div className="message-actions">
            {canReply ? (
              <button type="button" onClick={() => onReply(buildMessageReplyReference(message, senderName))}>
                <MessageSquareReply size={14} />
                引用
              </button>
            ) : null}
            <button type="button" onClick={() => onCopy(message.content)}>
              <Copy size={14} />
              复制
            </button>
          </div>
        </div>
      </div>
      {isUser ? <AgentAvatar agentId="user" /> : null}
    </article>
  )
}

type InlineArtifactCardProps = {
  artifact: Artifact
}

/**
 * Renders inline artifacts for standalone messages that still carry embedded cards.
 * Input: raw artifact metadata.
 * Output: one inline artifact card.
 */
function InlineArtifactCard({ artifact }: InlineArtifactCardProps) {
  const Icon = artifact.type === 'zip' ? FileArchive : artifact.type === 'web-preview' ? Globe2 : Braces
  const actionLabel = artifact.type === 'web-preview' ? '打开预览' : artifact.type === 'zip' ? '下载' : '查看'
  const summary = buildInlineArtifactCardSummary(artifact)
  const content = (
    <>
      <span className="artifact-icon">
        <Icon size={18} />
      </span>
      <div className="artifact-card__copy">
        <strong>{artifact.title}</strong>
        <ArtifactCardSummary preview={summary} />
      </div>
      <em>
        {actionLabel}
        <ExternalLink size={13} />
      </em>
    </>
  )

  if (!artifact.url) {
    return <div className="artifact-card">{content}</div>
  }

  return (
    <a className="artifact-card" href={artifact.url} target="_blank" rel="noreferrer">
      {content}
    </a>
  )
}

type TurnArtifactCardProps = {
  artifact: ChatTurnArtifact
  agentName?: string
  onOpenArtifact: (artifact: ChatTurnArtifact) => void
}

/**
 * Renders one artifact card that lives between the process panel and the final result.
 * Input: turn artifact, optional agent name, and open callback.
 * Output: one chat-stream artifact card.
 */
function TurnArtifactCard({ artifact, agentName, onOpenArtifact }: TurnArtifactCardProps) {
  const Icon = artifactIcon(artifact.kind)
  const preview = buildTurnArtifactCardPreview(artifact)
  const actionLabel = artifact.kind === 'zip'
    ? '下载源码'
    : artifact.kind === 'preview'
      ? '打开预览'
      : '查看详情'
  const isExternalOnly = artifact.kind === 'zip' && Boolean(artifact.url)

  const content = (
    <>
      <span className={`artifact-icon artifact-icon--${artifact.kind}`}>
        <Icon size={18} />
      </span>
      <div className="artifact-card__copy">
        <strong>{artifact.title}</strong>
        <ArtifactCardSummary preview={preview} />
        {artifact.verdict ? <b className={`artifact-verdict artifact-verdict--${artifactVerdictTone(artifact.verdict)}`}>{artifact.verdict}</b> : null}
        {agentName ? <i>{agentName}</i> : null}
      </div>
      <em>
        {actionLabel}
        {isExternalOnly ? <Download size={13} /> : <ExternalLink size={13} />}
      </em>
    </>
  )

  if (isExternalOnly && artifact.url) {
    return (
      <a className="artifact-card artifact-card--turn" href={artifact.url} target="_blank" rel="noreferrer">
        {content}
      </a>
    )
  }

  return (
    <button className="artifact-card artifact-card--turn" type="button" onClick={() => onOpenArtifact(artifact)}>
      {content}
    </button>
  )
}

type ArtifactCardPreview = {
  summary?: string
  metaItems: string[]
  peekItems: string[]
}

type ArtifactCardSummaryProps = {
  preview: ArtifactCardPreview
}

/**
 * Renders the compact summary block used by artifact cards in the chat stream.
 * Input: precomputed artifact preview text, meta items, and peek rows.
 * Output: one compact artifact summary body.
 */
function ArtifactCardSummary({ preview }: ArtifactCardSummaryProps) {
  return (
    <>
      {preview.summary ? (
        <div className="artifact-card__summary">
          <MarkdownRenderer content={preview.summary} mode="compact" className="markdown-content--compact" />
        </div>
      ) : null}
      {preview.metaItems.length ? (
        <div className="artifact-card__meta-row">
          {preview.metaItems.map((item, index) => (
            <span className="artifact-card__meta-chip" key={`${item}-${index}`}>
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {preview.peekItems.length ? (
        <div className="artifact-card__peek-list">
          {preview.peekItems.map((item, index) => (
            <span className="artifact-card__peek-item" key={`${item}-${index}`}>
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </>
  )
}

/**
 * Builds a compact summary for standalone inline artifacts.
 * Input: raw artifact payload attached to one message.
 * Output: compact summary text plus light metadata for the card body.
 */
function buildInlineArtifactCardSummary(artifact: Artifact): ArtifactCardPreview {
  const fullContent = artifact.content.trim()
  const isFullTextVisible = shouldShowFullArtifactText(fullContent)
  const fileCount = readArtifactMetadataNumber(artifact.metadata, 'fileCount')
  const byteLength = readArtifactMetadataNumber(artifact.metadata, 'byteLength')
  const metaItems = [
    artifact.type === 'web-preview' ? (artifact.url ? 'preview ready' : 'preview unavailable') : undefined,
    artifact.type === 'zip' && fileCount !== undefined ? `${fileCount} files` : undefined,
    artifact.type === 'zip' && byteLength !== undefined ? formatArtifactByteLength(byteLength) : undefined,
    !isFullTextVisible && fullContent ? 'summary only' : undefined,
  ].filter(Boolean) as string[]

  return {
    summary: isFullTextVisible ? fullContent : buildArtifactExcerpt(fullContent, 180),
    metaItems,
    peekItems: [],
  }
}

/**
 * Builds one compact artifact preview tuned for the chat-stream card.
 * Input: turn artifact payload.
 * Output: condensed summary, metrics, and short peek rows.
 */
function buildTurnArtifactCardPreview(artifact: ChatTurnArtifact): ArtifactCardPreview {
  if (artifact.kind === 'preview') {
    return {
      summary: buildArtifactExcerpt(artifact.summary, 160) || 'Preview generated.',
      metaItems: [artifact.url ? 'preview ready' : 'preview unavailable'],
      peekItems: artifact.url ? ['Open the card to inspect the page preview.'] : [],
    }
  }

  if (artifact.kind === 'diff') {
    const files = artifact.files ?? []
    const totals = summarizeArtifactDiff(files)
    return {
      summary: buildArtifactExcerpt(artifact.summary, 180) || 'Diff ready.',
      metaItems: [
        files.length ? `${files.length} files` : undefined,
        files.length ? `+${totals.additions} / -${totals.deletions}` : undefined,
      ].filter(Boolean) as string[],
      peekItems: files.slice(0, 3).map(file =>
        clipArtifactText(`${file.status} ${file.path} (+${file.additions} / -${file.deletions})`, 110),
      ),
    }
  }

  if (artifact.kind === 'review') {
    const issues = artifact.issues ?? []
    return {
      summary: buildArtifactExcerpt(artifact.summary, 180) || 'Review verdict ready.',
      metaItems: [
        artifact.verdict ?? 'review',
        `${issues.length} issues`,
      ],
      peekItems: issues.slice(0, 2).map(issue => clipArtifactText(issue, 110)),
    }
  }

  if (artifact.kind === 'zip') {
    return {
      summary: buildArtifactExcerpt(artifact.summary, 160) || 'Source archive ready.',
      metaItems: [
        artifact.fileCount !== undefined ? `${artifact.fileCount} files` : undefined,
        artifact.byteLength !== undefined ? formatArtifactByteLength(artifact.byteLength) : undefined,
        artifact.url ? 'download ready' : undefined,
      ].filter(Boolean) as string[],
      peekItems: [],
    }
  }

  const fullContent = (artifact.detailText ?? artifact.summary).trim()
  const isFullTextVisible = shouldShowFullArtifactText(fullContent)

  return {
    summary: isFullTextVisible ? fullContent : buildArtifactExcerpt(fullContent, 220),
    metaItems: !isFullTextVisible && fullContent ? ['summary only'] : [],
    peekItems: [],
  }
}

type ArtifactDialogProps = {
  artifact: ChatTurnArtifact
  onClose: () => void
}

/**
 * Renders the preview, diff, review, or text artifact dialog above the chat pane.
 * Input: selected artifact and close callback.
 * Output: modal dialog.
 */
function ArtifactDialog({ artifact, onClose }: ArtifactDialogProps) {
  const isPreview = artifact.kind === 'preview'
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [previewStatus, setPreviewStatus] = useState<PreviewFrameStatus>(
    isPreview ? (artifact.url ? 'loading' : 'error') : 'ready',
  )

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  useEffect(() => {
    if (!isPreview) {
      setPreviewStatus('ready')
      return
    }

    if (!artifact.url) {
      setPreviewStatus('error')
      return
    }

    setPreviewStatus('loading')
    const slowTimer = window.setTimeout(() => {
      setPreviewStatus(previous => (previous === 'loading' ? 'slow' : previous))
    }, 2500)
    const errorTimer = window.setTimeout(() => {
      setPreviewStatus(previous => (previous === 'ready' ? previous : 'error'))
    }, 10000)

    return () => {
      window.clearTimeout(slowTimer)
      window.clearTimeout(errorTimer)
    }
  }, [artifact.id, artifact.url, isPreview, previewAttempt])

  /**
   * Restarts the preview iframe load sequence after a timeout or iframe error.
   * Input: none.
   * Output: remounts the iframe and resets the preview status.
   */
  function handleRetryPreview() {
    setPreviewAttempt(previous => previous + 1)
  }

  const previewTitle =
    previewStatus === 'error'
      ? '预览加载失败'
      : previewStatus === 'slow'
        ? '预览生成较慢'
        : '正在加载页面预览'
  const previewDescription = !artifact.url
    ? '当前预览地址不可用，请稍后重试。'
    : previewStatus === 'error'
      ? '可以重试预览，或直接在新窗口打开当前页面。'
      : previewStatus === 'slow'
        ? '页面构建或传输较慢，请再等一下。'
        : '正在拉取当前工作区的页面预览资源。'

  return (
    <div className="artifact-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="artifact-dialog" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
        <div className="artifact-dialog__header">
          <div>
            <p className="eyebrow">Artifact</p>
            <h3>{artifact.title}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭">
            <ChevronDown size={16} />
          </button>
        </div>

        <div className={`artifact-dialog__body ${isPreview ? 'artifact-dialog__body--preview' : ''}`}>
          {isPreview ? (
            <div className="artifact-preview-shell">
              {artifact.url ? (
                <iframe
                  key={`${artifact.id}-${previewAttempt}`}
                  className="artifact-preview-frame"
                  src={artifact.url}
                  title={artifact.title}
                  onLoad={() => setPreviewStatus('ready')}
                  onError={() => setPreviewStatus('error')}
                />
              ) : null}

              {previewStatus !== 'ready' ? (
                <div className="artifact-preview-overlay">
                  <div className={`artifact-preview-status artifact-preview-status--${previewStatus}`}>
                    {previewStatus === 'error' ? (
                      <AlertTriangle size={18} />
                    ) : (
                      <LoaderCircle className="icon-spin" size={18} />
                    )}
                    <strong>{previewTitle}</strong>
                    <p>{previewDescription}</p>
                    {previewStatus === 'error' ? (
                      <div className="artifact-preview-actions">
                        <button className="primary-button" type="button" onClick={handleRetryPreview}>
                          重试预览
                        </button>
                        {artifact.url ? (
                          <a className="secondary-button" href={artifact.url} target="_blank" rel="noreferrer">
                            新窗口打开
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {artifact.kind === 'diff' ? (
            <div className="artifact-detail-stack">
              <MarkdownRenderer content={artifact.summary} mode="panel" className="markdown-content--panel" />
              {artifact.files?.length ? (
                <div className="diff-file-list">
                  {artifact.files.map(file => (
                    <div className="diff-file-row" key={file.path}>
                      <span className={`diff-file-badge diff-file-badge--${file.status}`}>{file.status}</span>
                      <code>{file.path}</code>
                      <em>
                        +{file.additions} / -{file.deletions}
                      </em>
                    </div>
                  ))}
                </div>
              ) : null}
              <pre className="artifact-code-block">{artifact.patch || 'No patch text available.'}</pre>
            </div>
          ) : null}

          {artifact.kind === 'review' ? (
            <div className="artifact-detail-stack">
              {artifact.verdict ? <StatusPill status={artifactVerdictPillStatus(artifact.verdict)} label={artifact.verdict} /> : null}
              <MarkdownRenderer content={artifact.summary} mode="panel" className="markdown-content--panel" />
              {artifact.issues?.length ? (
                <ul className="artifact-issue-list">
                  {artifact.issues.map((issue, index) => (
                    <li key={`${artifact.id}-${index}`}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p className="artifact-dialog__empty">这一轮没有额外问题。</p>
              )}
            </div>
          ) : null}

          {(artifact.kind === 'text' || artifact.kind === 'artifact') ? (
            <div className="artifact-detail-stack">
              <MarkdownRenderer content={artifact.summary} mode="panel" className="markdown-content--panel" />
              {artifact.detailText ? (
                <MarkdownRenderer content={artifact.detailText} mode="document" className="markdown-content--document markdown-content--panel" />
              ) : null}
            </div>
          ) : null}
        </div>

        {artifact.url ? (
          <div className="artifact-dialog__footer">
            <a className="artifact-dialog__link" href={artifact.url} target="_blank" rel="noreferrer">
              在新窗口打开
              <ExternalLink size={14} />
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Renders one placeholder result bubble while the final answer is still streaming.
 * Input: none.
 * Output: pending result bubble.
 */
function PendingResultBubble() {
  return (
    <article className="message-row">
      <AgentAvatar agentId="orchestrator" />
      <div className="message-stack">
        <div className="message-meta">
          <strong>正在等待结果</strong>
        </div>
        <div className="message-bubble message-bubble--agent">
          <p>过程还在继续，最终结果会显示在这里。</p>
          <div className="message-typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </article>
  )
}

type EmptyChatStateProps = {
  room: WorkspaceRoom | undefined
  loading: boolean
}

/**
 * Renders the empty chat state with the AI Core mark.
 * Input: active workspace room.
 * Output: an empty-state panel for first messages.
 */
function EmptyChatState({ room, loading }: EmptyChatStateProps) {
  return (
    <div className="empty-chat">
      <OrbMark size="lg" pulse />
      <h2>{loading && !room ? '正在连接工作区' : room ? '开始这一轮协作' : '先选择一个工作区'}</h2>
      <p>
        {loading && !room
          ? '前端正在加载真实工作区和会话数据，完成后会直接进入当前列表。'
          : '群聊工作区支持 @ 指向 Agent，执行过程、预览、Diff 和审查结果都会直接进入聊天记录。'}
      </p>
    </div>
  )
}

type ChatComposerProps = {
  room: WorkspaceRoom | undefined
  sending: boolean
  mentionOptions: AgentMentionOption[]
  replyTarget?: ReplyReference
  disabledReason: string
  onCancelReply: () => void
  onSend: (content: string, replyTo?: ReplyReference) => void
}

/**
 * Renders the message composer at the bottom of the chat pane.
 * Input: active workspace room, sending flag, mention options, and send callback.
 * Output: textarea composer with command chips and the group-chat @ picker.
 */
function ChatComposer({ room, sending, mentionOptions, replyTarget, disabledReason, onCancelReply, onSend }: ChatComposerProps) {
  const storageKey = room ? `agenthub:draft:${room.conversation.id}` : ''
  const [value, setValue] = useState('')
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectionRef = useRef({ start: 0, end: 0 })
  const composerLocked = sending || !room || disabledReason.length > 0

  const placeholder =
    disabledReason ||
    (room?.kind === 'direct'
      ? `发送给 ${room.targetAgentId ?? 'Agent'}，例如：/run 检查当前产物并给出结论`
      : '给群聊工作区发送任务，例如：@engineer 实现页面，并让 @reviewer 验收')
  const filteredMentionOptions =
    room?.kind === 'group' && mentionMatch
      ? mentionOptions.filter(option => {
          const query = mentionMatch.query.trim().toLowerCase()

          if (!query) {
            return true
          }

          return `${option.id} ${option.name}`.toLowerCase().includes(query)
        })
      : []
  const showMentionPicker = room?.kind === 'group' && !isComposing && filteredMentionOptions.length > 0 && Boolean(mentionMatch)

  useEffect(() => {
    if (!room) {
      setValue('')
      setMentionMatch(null)
      selectionRef.current = { start: 0, end: 0 }
      return
    }

    const draft = window.localStorage.getItem(storageKey) ?? ''
    setValue(draft)
    setMentionMatch(null)
    setActiveMentionIndex(0)
    selectionRef.current = { start: draft.length, end: draft.length }
  }, [room, storageKey])

  useEffect(() => {
    if (!storageKey) {
      return
    }

    window.localStorage.setItem(storageKey, value)
  }, [storageKey, value])

  useEffect(() => {
    if (room?.kind !== 'group') {
      setMentionMatch(null)
    }
  }, [room?.kind])

  useEffect(() => {
    setActiveMentionIndex(0)
  }, [mentionMatch?.query, mentionMatch?.start, room?.id])

  /**
   * Recomputes the active @ mention token for the current caret location.
   * Input: textarea value and selection bounds.
   * Output: updates the local mention popup state.
   */
  function syncMentionState(nextValue: string, selectionStart: number | null, selectionEnd: number | null) {
    if (room?.kind !== 'group') {
      setMentionMatch(null)
      return
    }

    setMentionMatch(findActiveMention(nextValue, selectionStart, selectionEnd))
  }

  /**
   * Writes the next draft value and restores the caret after React updates.
   * Input: next draft string and the desired caret position.
   * Output: updates the textarea value, caret, and mention state.
   */
  function applyComposerValue(nextValue: string, caretPosition: number) {
    setValue(nextValue)
    selectionRef.current = { start: caretPosition, end: caretPosition }
    requestAnimationFrame(() => {
      const textarea = textareaRef.current

      if (!textarea) {
        return
      }

      textarea.focus()
      textarea.setSelectionRange(caretPosition, caretPosition)
      syncMentionState(nextValue, caretPosition, caretPosition)
    })
  }

  /**
   * Inserts plain text at the current caret instead of always appending to the end.
   * Input: content to insert into the composer.
   * Output: updates the draft and places the caret after the inserted text.
   */
  function insertTextAtSelection(content: string) {
    const textarea = textareaRef.current
    const selectionStart =
      document.activeElement === textarea ? textarea?.selectionStart ?? selectionRef.current.start : selectionRef.current.start
    const selectionEnd =
      document.activeElement === textarea ? textarea?.selectionEnd ?? selectionRef.current.end : selectionRef.current.end
    const nextValue = `${value.slice(0, selectionStart)}${content}${value.slice(selectionEnd)}`
    setMentionMatch(null)
    applyComposerValue(nextValue, selectionStart + content.length)
  }

  /**
   * Replaces the active @ token with one concrete child-agent mention.
   * Input: the agent option selected from the mention popup.
   * Output: inserts a normalized @agent-id token and closes the popup.
   */
  function insertMention(option: AgentMentionOption) {
    if (!mentionMatch) {
      return
    }

    const replacement = `@${option.id} `
    const nextValue = `${value.slice(0, mentionMatch.start)}${replacement}${value.slice(mentionMatch.end)}`
    setMentionMatch(null)
    applyComposerValue(nextValue, mentionMatch.start + replacement.length)
  }

  /**
   * Submits composer content when the form is sent.
   * Input: none.
   * Output: calls onSend and clears the textarea.
   */
  function handleSubmit() {
    const content = value.trim()

    if (!content || composerLocked) {
      return
    }

    onSend(content, replyTarget)
    setValue('')
    setMentionMatch(null)
    selectionRef.current = { start: 0, end: 0 }
    window.localStorage.removeItem(storageKey)
    onCancelReply()
  }

  /**
   * Handles keyboard shortcuts for submit while preserving multiline input.
   * Input: textarea keydown event.
   * Output: navigates the mention popup or submits on Enter without Shift.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || isComposing) {
      return
    }

    if (showMentionPicker) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveMentionIndex(previous => (previous + 1) % filteredMentionOptions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveMentionIndex(previous => (previous - 1 + filteredMentionOptions.length) % filteredMentionOptions.length)
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        insertMention(filteredMentionOptions[activeMentionIndex] ?? filteredMentionOptions[0])
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionMatch(null)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  /**
   * Refreshes mention parsing after caret movement or direct text edits.
   * Input: current textarea element.
   * Output: syncs the popup state with the current caret position.
   */
  function handleCursorChange(textarea: HTMLTextAreaElement) {
    selectionRef.current = {
      start: textarea.selectionStart ?? textarea.value.length,
      end: textarea.selectionEnd ?? textarea.value.length,
    }
    syncMentionState(textarea.value, textarea.selectionStart, textarea.selectionEnd)
  }

  function insertChip(valueToInsert: string) {
    insertTextAtSelection(valueToInsert)
  }

  return (
    <form
      className="composer"
      onSubmit={event => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      {room?.kind === 'group' ? (
        <div className="composer-chips">
          <button type="button" onClick={() => insertChip('@product-manager ')} disabled={composerLocked}>
            @product-manager
          </button>
          <button type="button" onClick={() => insertChip('@engineer ')} disabled={composerLocked}>
            @engineer
          </button>
          <button type="button" onClick={() => insertChip('@reviewer ')} disabled={composerLocked}>
            @reviewer
          </button>
          <button type="button" onClick={() => insertChip('/run ')} disabled={composerLocked}>
            /run
          </button>
        </div>
      ) : (
        <div className="composer-chips">
          <button type="button" onClick={() => insertChip(`@${room?.targetAgentId ?? 'agent'} `)} disabled={composerLocked}>
            @{room?.targetAgentId ?? 'agent'}
          </button>
          <button type="button" onClick={() => insertChip('/run ')} disabled={composerLocked}>
            /run
          </button>
        </div>
      )}
      <div className="composer-box">
        {replyTarget ? (
          <div className="composer-reply-bar">
            <div className="composer-reply-bar__copy">
              <strong>引用 {replySenderLabel(replyTarget)}</strong>
              <span>{replyTarget.excerpt}</span>
            </div>
            <button type="button" onClick={onCancelReply} disabled={composerLocked} title="取消引用">
              <X size={14} />
            </button>
          </div>
        ) : null}
        {showMentionPicker ? (
          <AgentMentionPicker
            options={filteredMentionOptions}
            activeIndex={activeMentionIndex}
            onSelect={insertMention}
          />
        ) : null}
        <textarea
          ref={textareaRef}
          name="message"
          rows={2}
          value={value}
          onChange={event => {
            const nextValue = event.currentTarget.value
            setValue(nextValue)
            handleCursorChange(event.currentTarget)
          }}
          onClick={event => handleCursorChange(event.currentTarget)}
          onKeyUp={event => handleCursorChange(event.currentTarget)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={event => {
            setIsComposing(false)
            handleCursorChange(event.currentTarget)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={composerLocked}
        />
        <button className="send-button" type="submit" disabled={composerLocked} title="发送消息">
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  )
}

/**
 * Chooses the artifact icon for one card kind.
 * Input: artifact kind.
 * Output: matching Lucide icon component.
 */
function artifactIcon(kind: ChatTurnArtifact['kind']) {
  if (kind === 'preview') {
    return Globe2
  }
  if (kind === 'diff') {
    return Braces
  }
  if (kind === 'review') {
    return ShieldCheck
  }
  if (kind === 'zip') {
    return FileArchive
  }
  return FileText
}

/**
 * Converts one turn status into the shared status-pill variant.
 * Input: one chat turn.
 * Output: pill status keyword.
 */
function turnStatusPillStatus(turn: ChatTurn): 'running' | 'success' | 'failed' | 'ready' {
  if (turn.status === 'failed') {
    return 'failed'
  }
  if (turn.status === 'running') {
    return 'running'
  }
  return 'success'
}

/**
 * Picks one icon based on process-card kind and tone.
 * Input: process entry.
 * Output: icon component.
 */
function processEntryIcon(entry: ChatTurnProcessEntry) {
  if (entry.kind === 'review' || entry.kind === 'validation') {
    return ShieldCheck
  }
  if (entry.kind === 'artifact' && /preview/i.test(entry.badge ?? '')) {
    return Globe2
  }
  if (entry.kind === 'artifact' && /diff/i.test(entry.badge ?? '')) {
    return Braces
  }
  if (entry.kind === 'log' || entry.kind === 'dispatch' || entry.kind === 'progress') {
    return TerminalSquare
  }
  if (entry.kind === 'reply') {
    return MessageSquareReply
  }
  if (entry.tone === 'danger') {
    return AlertTriangle
  }
  if (entry.tone === 'success') {
    return CheckCircle2
  }
  return LoaderCircle
}

/**
 * Picks one icon based on process tone and row label.
 * Input: tone and label text.
 * Output: icon component.
 */
function toneIcon(entry: ChatTurnProcessEntry) {
  const label = entry.title
  const tone = entry.tone
  if (/审查|校验|结论/i.test(label)) {
    return ShieldCheck
  }
  if (/预览/i.test(label)) {
    return Globe2
  }
  if (/Diff|代码/i.test(label)) {
    return Braces
  }
  if (/输出|日志/i.test(label)) {
    return TerminalSquare
  }
  if (tone === 'danger') {
    return AlertTriangle
  }
  if (tone === 'success') {
    return CheckCircle2
  }
  return LoaderCircle
}

/**
 * Maps artifact verdict text into one display tone suffix.
 * Input: verdict text.
 * Output: visual tone name.
 */
function artifactVerdictTone(verdict: string): 'success' | 'warning' | 'danger' {
  const normalized = verdict.toLowerCase()
  if (normalized === 'fail' || normalized === 'failed') {
    return 'danger'
  }
  if (normalized === 'partial') {
    return 'warning'
  }
  return 'success'
}

/**
 * Maps artifact verdict text into one status-pill variant.
 * Input: verdict text.
 * Output: status pill keyword.
 */
function artifactVerdictPillStatus(verdict: string): 'success' | 'failed' | 'running' | 'ready' {
  const tone = artifactVerdictTone(verdict)
  if (tone === 'danger') {
    return 'failed'
  }
  if (tone === 'warning') {
    return 'running'
  }
  return 'success'
}

/**
 * Sums additions and deletions across one diff artifact file list.
 * Input: changed files attached to the artifact.
 * Output: aggregate additions and deletions for compact card metrics.
 */
function summarizeArtifactDiff(files: ChatTurnArtifact['files']): { additions: number; deletions: number } {
  return (files ?? []).reduce(
    (totals, file) => ({
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
}

/**
 * Chooses whether one text artifact is short enough to remain fully visible in the chat card.
 * Input: raw artifact text.
 * Output: true when the compact card can safely show the full text.
 */
function shouldShowFullArtifactText(content: string): boolean {
  if (!content.trim()) {
    return false
  }

  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0)
  return lines.length <= 8 && content.length <= 300
}

/**
 * Converts long Markdown-ish artifact text into a short readable excerpt for the chat card.
 * Input: raw artifact text and an optional max length.
 * Output: compact plain-text excerpt.
 */
function buildArtifactExcerpt(content: string, maxLength = 180): string {
  return clipArtifactText(
    content
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/^[#>\-\*\d.\s|]+/gm, ' ')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    maxLength,
  )
}

/**
 * Clips one plain text fragment for narrow artifact cards.
 * Input: raw text and the desired max length.
 * Output: compact text that keeps the card height stable.
 */
function clipArtifactText(content: string, maxLength = 180): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

/**
 * Reads one numeric artifact metadata field when it exists on a runtime artifact.
 * Input: generic artifact metadata and the desired key.
 * Output: numeric metadata value or undefined.
 */
function readArtifactMetadataNumber(
  metadata: Artifact['metadata'] | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Formats one artifact byte count into a compact KB or MB label.
 * Input: raw byte length.
 * Output: human-readable size text.
 */
function formatArtifactByteLength(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`
  }
  if (byteLength < 1024 * 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}
