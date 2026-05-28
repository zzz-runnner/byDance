import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Braces, Copy, ExternalLink, FileArchive, Globe2, MessageSquareReply, RefreshCcw } from 'lucide-react'
import { buildAgentMap, formatTime, workspaceRoomKindLabel, type WorkspaceRoom } from '../appModel'
import type { AppState, Artifact, Message } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { GlassPanel } from './GlassPanel'
import { OrbMark } from './OrbMark'
import { StatusPill } from './StatusPill'

type ChatPaneProps = {
  state: AppState
  room: WorkspaceRoom | undefined
  messages: Message[]
  streamingMessages: Message[]
  sending: boolean
  onRegenerate: () => void
  onReplyToMessage: (content: string) => void
  onCopyMessage: (content: string) => void
  onInsertComposerText: (content: string) => void
  onSend: (content: string) => void
}

/**
 * Renders the central chat surface for direct and group workspace rooms.
 * Input: app state, active workspace room, messages, streaming messages, send state, and send callback.
 * Output: the chat timeline and composer.
 */
export function ChatPane({
  state,
  room,
  messages,
  streamingMessages,
  sending,
  onRegenerate,
  onReplyToMessage,
  onCopyMessage,
  onInsertComposerText,
  onSend,
}: ChatPaneProps) {
  const agentMap = buildAgentMap(state)
  const activeAgent = room?.targetAgentId ? agentMap.get(room.targetAgentId) : undefined
  const allMessages = [...messages, ...streamingMessages]

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
                ? `固定发送给 ${activeAgent?.name ?? room.targetAgentId ?? 'Agent'}`
                : '支持 @ 指定 Agent，也支持让 Orchestrator 自行拆解任务'}
            </span>
          </div>
        </div>
        <div className="chat-header-actions">
          <StatusPill
            status={sending ? 'running' : 'ready'}
            label={sending ? 'streaming' : room?.kind === 'group' ? 'orchestrated' : 'direct'}
          />
          <button className="icon-button" type="button" title="重新生成上一条任务" onClick={onRegenerate} disabled={sending || !room}>
            <RefreshCcw size={16} />
          </button>
        </div>
      </header>

      <div className="chat-scroll">
        {allMessages.length > 0 ? (
          allMessages.map(message => (
            <MessageBubble
              key={message.id}
              message={message}
              senderName={message.senderType === 'agent' ? agentMap.get(message.senderId)?.name : undefined}
              onReply={onReplyToMessage}
              onCopy={onCopyMessage}
            />
          ))
        ) : (
          <EmptyChatState room={room} />
        )}
      </div>

      <ChatComposer
        room={room}
        sending={sending}
        onSend={onSend}
        onInsertComposerText={onInsertComposerText}
      />
    </GlassPanel>
  )
}

type MessageBubbleProps = {
  message: Message
  senderName?: string
  onReply: (content: string) => void
  onCopy: (content: string) => void
}

/**
 * Renders one chat message with optional artifact cards.
 * Input: message record and optional sender display name.
 * Output: a message bubble row.
 */
function MessageBubble({ message, senderName, onReply, onCopy }: MessageBubbleProps) {
  const isUser = message.senderType === 'user'
  const senderLabel = isUser ? '你' : senderName ?? message.senderId

  return (
    <article className={`message-row ${isUser ? 'message-row--user' : ''}`}>
      {!isUser ? <AgentAvatar agentId={message.senderId} name={senderName} /> : null}
      <div className="message-stack">
        <div className="message-meta">
          <strong>{senderLabel}</strong>
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <div className={`message-bubble ${isUser ? 'message-bubble--user' : 'message-bubble--agent'}`}>
          <p>{message.content || '正在生成回复...'}</p>
          {message.artifacts.length > 0 ? (
            <div className="artifact-grid">
              {message.artifacts.map(artifact => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          ) : null}
          <div className="message-actions">
            <button type="button" onClick={() => onReply(message.content)}>
              <MessageSquareReply size={14} />
              回复
            </button>
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

type ArtifactCardProps = {
  artifact: Artifact
}

/**
 * Renders a compact card for code, preview, zip, diff, and file artifacts.
 * Input: artifact metadata.
 * Output: a clickable artifact card when the artifact has a URL.
 */
function ArtifactCard({ artifact }: ArtifactCardProps) {
  const Icon = artifact.type === 'zip' ? FileArchive : artifact.type === 'web-preview' ? Globe2 : Braces
  const actionLabel = artifact.type === 'web-preview' ? '打开预览' : artifact.type === 'zip' ? '下载' : '查看'
  const content = (
    <>
      <span className="artifact-icon">
        <Icon size={18} />
      </span>
      <span>
        <strong>{artifact.title}</strong>
        <small>{artifact.content}</small>
      </span>
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

type EmptyChatStateProps = {
  room: WorkspaceRoom | undefined
}

/**
 * Renders the empty chat state with the AI Core mark.
 * Input: active workspace room.
 * Output: an empty-state panel for first messages.
 */
function EmptyChatState({ room }: EmptyChatStateProps) {
  return (
    <div className="empty-chat">
      <OrbMark size="lg" pulse />
      <h2>{room ? '开始这一轮协作' : '先选择一个工作区'}</h2>
      <p>群聊工作区支持 @ 指向 Agent；单聊工作区会把上下文固定发送给目标 Agent。</p>
    </div>
  )
}

type ChatComposerProps = {
  room: WorkspaceRoom | undefined
  sending: boolean
  onInsertComposerText: (content: string) => void
  onSend: (content: string) => void
}

/**
 * Renders the message composer at the bottom of the chat pane.
 * Input: active workspace room, sending flag, and send callback.
 * Output: textarea composer with command chips.
 */
function ChatComposer({ room, sending, onInsertComposerText, onSend }: ChatComposerProps) {
  const storageKey = room ? `agenthub:draft:${room.conversation.id}` : ''
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const placeholder =
    room?.kind === 'direct'
      ? `发送给 ${room.targetAgentId ?? 'Agent'}，例如：/run 检查当前产物并给出结论`
      : '给群聊工作区发送任务，例如：@engineer 实现页面并让 @reviewer 验收'

  useEffect(() => {
    if (!room) {
      setValue('')
      return
    }

    const draft = window.localStorage.getItem(storageKey) ?? ''
    setValue(draft)
  }, [room, storageKey])

  useEffect(() => {
    if (!storageKey) {
      return
    }

    window.localStorage.setItem(storageKey, value)
  }, [storageKey, value])

  useEffect(() => {
    function handleInsert(event: Event) {
      const customEvent = event as CustomEvent<string>
      const inserted = customEvent.detail ?? ''
      setValue(previous => `${previous}${inserted}`)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }

    window.addEventListener('agenthub:composer-insert', handleInsert)
    return () => {
      window.removeEventListener('agenthub:composer-insert', handleInsert)
    }
  }, [])

  /**
   * Submits composer content when the form is sent.
   * Input: none.
   * Output: calls onSend and clears the textarea.
   */
  function handleSubmit() {
    const content = value.trim()

    if (!content || sending || !room) {
      return
    }

    onSend(content)
    setValue('')
    window.localStorage.removeItem(storageKey)
  }

  /**
   * Handles keyboard shortcuts for submit while preserving multiline input.
   * Input: textarea keydown event.
   * Output: submits on Enter without Shift.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  function insertChip(valueToInsert: string) {
    onInsertComposerText(valueToInsert)
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
          <button type="button" onClick={() => insertChip('@product-manager ')}>
            @product-manager
          </button>
          <button type="button" onClick={() => insertChip('@engineer ')}>
            @engineer
          </button>
          <button type="button" onClick={() => insertChip('@reviewer ')}>
            @reviewer
          </button>
          <button type="button" onClick={() => insertChip('/run ')}>
            /run
          </button>
        </div>
      ) : (
        <div className="composer-chips">
          <button type="button" onClick={() => insertChip(`@${room?.targetAgentId ?? 'agent'} `)}>
            @{room?.targetAgentId ?? 'agent'}
          </button>
          <button type="button" onClick={() => insertChip('/run ')}>
            /run
          </button>
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          name="message"
          rows={2}
          value={value}
          onChange={event => setValue(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={!room || sending}
        />
        <button className="send-button" type="submit" disabled={!room || sending} title="发送消息">
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  )
}
