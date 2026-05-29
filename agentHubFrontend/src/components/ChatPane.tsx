import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Braces, Copy, ExternalLink, FileArchive, Globe2, MessageSquareReply, RefreshCcw } from 'lucide-react'
import { buildAgentMap, formatTime, workspaceRoomKindLabel, type WorkspaceRoom } from '../appModel'
import type { AgentDefinition, AppState, Artifact, Message } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { AgentMentionPicker, type AgentMentionOption } from './AgentMentionPicker'
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
  onSend: (content: string) => void
}

type MentionMatch = {
  start: number
  end: number
  query: string
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
  onSend,
}: ChatPaneProps) {
  const agentMap = buildAgentMap(state)
  const activeAgent = room?.targetAgentId ? agentMap.get(room.targetAgentId) : undefined
  const mentionOptions = groupMentionOptions(room, agentMap)
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
        mentionOptions={mentionOptions}
        onSend={onSend}
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
  mentionOptions: AgentMentionOption[]
  onSend: (content: string) => void
}

/**
 * Renders the message composer at the bottom of the chat pane.
 * Input: active workspace room, sending flag, mention options, and send callback.
 * Output: textarea composer with command chips and the group-chat @ picker.
 */
function ChatComposer({ room, sending, mentionOptions, onSend }: ChatComposerProps) {
  const storageKey = room ? `agenthub:draft:${room.conversation.id}` : ''
  const [value, setValue] = useState('')
  const [mentionMatch, setMentionMatch] = useState<MentionMatch | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectionRef = useRef({ start: 0, end: 0 })

  const placeholder =
    room?.kind === 'direct'
      ? `发送给 ${room.targetAgentId ?? 'Agent'}，例如：/run 检查当前产物并给出结论`
      : '给群聊工作区发送任务，例如：@engineer 实现页面并让 @reviewer 验收'
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

  useEffect(() => {
    function handleInsert(event: Event) {
      const customEvent = event as CustomEvent<string>
      const inserted = customEvent.detail ?? ''
      insertTextAtSelection(inserted)
    }

    window.addEventListener('agenthub:composer-insert', handleInsert)
    return () => {
      window.removeEventListener('agenthub:composer-insert', handleInsert)
    }
  }, [value, room?.kind])

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

    if (!content || sending || !room) {
      return
    }

    onSend(content)
    setValue('')
    setMentionMatch(null)
    selectionRef.current = { start: 0, end: 0 }
    window.localStorage.removeItem(storageKey)
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
          disabled={!room || sending}
        />
        <button className="send-button" type="submit" disabled={!room || sending} title="发送消息">
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  )
}
