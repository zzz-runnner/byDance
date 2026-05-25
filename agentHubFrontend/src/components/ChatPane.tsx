import type { FormEvent } from 'react'
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
  onSend: (content: string) => void
}

/**
 * Renders the central chat surface for direct and group workspace rooms.
 * Input: app state, active workspace room, messages, streaming messages, send state, and send callback.
 * Output: the chat timeline and composer.
 */
export function ChatPane({ state, room, messages, streamingMessages, sending, onSend }: ChatPaneProps) {
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
                : '不 @ 时由 Orchestrator 判断，@ 子 Agent 时在群聊内定向回复'}
            </span>
          </div>
        </div>
        <div className="chat-header-actions">
          <StatusPill
            status={sending ? 'running' : 'ready'}
            label={sending ? 'streaming' : room?.kind === 'group' ? 'orchestrated' : 'direct'}
          />
          <button className="icon-button" type="button" title="重新生成">
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
            />
          ))
        ) : (
          <EmptyChatState room={room} />
        )}
      </div>

      <ChatComposer room={room} sending={sending} onSend={onSend} />
    </GlassPanel>
  )
}

type MessageBubbleProps = {
  message: Message
  senderName?: string
}

/**
 * Renders one chat message with optional artifact cards.
 * Input: message record and optional sender display name.
 * Output: a message bubble row.
 */
function MessageBubble({ message, senderName }: MessageBubbleProps) {
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
            <button type="button">
              <MessageSquareReply size={14} />
              回复
            </button>
            <button type="button">
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
      <h2>{room ? '开启这一轮协作' : '先选择一个工作区'}</h2>
      <p>群聊工作区支持 @ 子 Agent 定向回复；单聊工作区会把上下文固定发给目标 Agent。</p>
    </div>
  )
}

type ChatComposerProps = {
  room: WorkspaceRoom | undefined
  sending: boolean
  onSend: (content: string) => void
}

/**
 * Renders the message composer at the bottom of the chat pane.
 * Input: active workspace room, sending flag, and send callback.
 * Output: textarea composer with command chips.
 */
function ChatComposer({ room, sending, onSend }: ChatComposerProps) {
  const placeholder =
    room?.kind === 'direct'
      ? `发送给 ${room.targetAgentId ?? 'Agent'}，例如：/run 检查当前产物并给出结论`
      : '给群聊工作区发送任务，例如：@engineer 实现页面并让 @reviewer 验收'

  /**
   * Submits composer content when the form is sent.
   * Input: form submit event.
   * Output: calls onSend and clears the textarea.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const content = String(formData.get('message') ?? '').trim()

    if (!content || sending || !room) {
      return
    }

    onSend(content)
    form.reset()
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {room?.kind === 'group' ? (
        <div className="composer-chips">
          <button type="button">@product-manager</button>
          <button type="button">@engineer</button>
          <button type="button">@reviewer</button>
          <button type="button">/run</button>
        </div>
      ) : (
        <div className="composer-chips">
          <button type="button">@{room?.targetAgentId ?? 'agent'}</button>
          <button type="button">/run</button>
        </div>
      )}
      <div className="composer-box">
        <textarea name="message" rows={2} placeholder={placeholder} disabled={!room || sending} />
        <button className="send-button" type="submit" disabled={!room || sending} title="发送">
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  )
}
