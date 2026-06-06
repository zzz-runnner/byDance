import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Workspace } from '../types'
import { GlassPanel } from './GlassPanel'

type RoomMode = 'group' | 'direct'
type GroupWorkspaceType = Exclude<Workspace['workspaceType'], 'chat'>
type DirectAgentProvider = 'claude' | 'codex'
type DirectAgentOption = {
  id: 'claude-code-direct' | 'codex-direct'
  name: string
  provider: DirectAgentProvider
}
type DirectAgentId = DirectAgentOption['id']

export type CreateWorkspaceInput = {
  name: string
  goal: string
  roomMode: RoomMode
  workspaceType: Workspace['workspaceType']
  targetAgentId?: string
}

type CreateWorkspaceDialogProps = {
  open: boolean
  submitting: boolean
  errorMessage: string
  sourceTargetLabel: string
  onClose: () => void
  onSubmit: (input: CreateWorkspaceInput) => Promise<void> | void
}

const GROUP_WORKSPACE_TYPES: Array<{
  value: GroupWorkspaceType
  label: string
  description: string
}> = [
  {
    value: 'dev',
    label: '开发工作区',
    description: '适合多 Agent 协作实现、联调和交付。',
  },
  {
    value: 'research',
    label: '研究工作区',
    description: '适合资料整理、方案比选和探索任务。',
  },
  {
    value: 'writing',
    label: '文档工作区',
    description: '适合 PRD、总结、说明文档等产物。',
  },
]

function directAgentLabel(option: DirectAgentOption): string {
  return option.name
}

const DIRECT_AGENT_OPTIONS: DirectAgentOption[] = [
  {
    id: 'claude-code-direct',
    name: 'Claude Code Agent',
    provider: 'claude',
  },
  {
    id: 'codex-direct',
    name: 'Codex Agent',
    provider: 'codex',
  },
]

function toDirectAgentId(value: string): DirectAgentId {
  return value === 'claude-code-direct' ? 'claude-code-direct' : 'codex-direct'
}

/**
 * Renders the create-workspace dialog for the live backend flow.
 * Input: dialog state, available agents, submit state, and callbacks.
 * Output: a modal form for creating one workspace.
 */
export function CreateWorkspaceDialog({
  open,
  submitting,
  errorMessage,
  sourceTargetLabel,
  onClose,
  onSubmit,
}: CreateWorkspaceDialogProps) {
  const directAgentOptions = DIRECT_AGENT_OPTIONS
  const preferredDirectAgentId =
    directAgentOptions.find(option => option.provider === 'codex')?.id ??
    directAgentOptions[0]?.id ??
    'codex-direct'

  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [roomMode, setRoomMode] = useState<RoomMode>('group')
  const [workspaceType, setWorkspaceType] = useState<GroupWorkspaceType>('dev')
  const [targetAgentId, setTargetAgentId] = useState(preferredDirectAgentId)

  useEffect(() => {
    if (!open) {
      return
    }

    setName('')
    setGoal('通过多 Agent 协作完成一个可预览产物。')
    setRoomMode('group')
    setWorkspaceType('dev')
    setTargetAgentId(preferredDirectAgentId)
  }, [open, preferredDirectAgentId])

  useEffect(() => {
    if (!open || roomMode !== 'direct' || directAgentOptions.some(option => option.id === targetAgentId)) {
      return
    }
    setTargetAgentId(preferredDirectAgentId)
  }, [directAgentOptions, open, preferredDirectAgentId, roomMode, targetAgentId])

  useEffect(() => {
    if (!open) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open, submitting])

  if (!open) {
    return null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextName = name.trim()
    const nextGoal = goal.trim()
    const selectedDirectAgent = directAgentOptions.find(option => option.id === targetAgentId)

    if (!nextName || !nextGoal || (roomMode === 'direct' && !selectedDirectAgent)) {
      return
    }

    await onSubmit({
      name: nextName,
      goal: nextGoal,
      roomMode,
      workspaceType: roomMode === 'direct' ? 'chat' : workspaceType,
      targetAgentId: roomMode === 'direct' ? selectedDirectAgent?.id : undefined,
    })
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !submitting && onClose()}>
      <div className="dialog-card-shell" role="presentation" onClick={event => event.stopPropagation()}>
        <GlassPanel className="dialog-card">
          <div className="dialog-header">
            <div>
              <p className="eyebrow">Create Workspace</p>
              <h2>新建工作区</h2>
            </div>
            <button className="icon-button" type="button" onClick={onClose} disabled={submitting} title="关闭弹窗">
              <X size={16} />
            </button>
          </div>

          <form className="dialog-form" onSubmit={handleSubmit}>
            <div className="dialog-field">
              <label htmlFor="workspace-name">工作区名称</label>
              <input
                id="workspace-name"
                value={name}
                onChange={event => setName(event.currentTarget.value)}
                placeholder="例如：投票小程序联调"
                autoFocus
                disabled={submitting}
                required
              />
            </div>

            <div className="dialog-field">
              <label htmlFor="workspace-goal">工作区目标</label>
              <textarea
                id="workspace-goal"
                rows={4}
                value={goal}
                onChange={event => setGoal(event.currentTarget.value)}
                placeholder="描述这次工作希望产出的页面、代码或文档。"
                disabled={submitting}
                required
              />
            </div>

            <div className="dialog-field">
              <label>会话模式</label>
              <div className="segmented-control">
                <button
                  className={roomMode === 'group' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setRoomMode('group')}
                  disabled={submitting}
                >
                  群聊工作区
                </button>
                <button
                  className={roomMode === 'direct' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setRoomMode('direct')}
                  disabled={submitting}
                >
                  单聊工作区
                </button>
              </div>
              <p className="field-hint">
                {roomMode === 'group'
                  ? '由主脑协调多个 Agent 协作。'
                  : '固定把消息发送给一个目标 Agent，适合聚焦式调试。'}
              </p>
            </div>

            {roomMode === 'group' ? (
              <div className="dialog-field">
                <label htmlFor="workspace-type">工作区类型</label>
                <select
                  id="workspace-type"
                  value={workspaceType}
                  onChange={event => setWorkspaceType(event.currentTarget.value as GroupWorkspaceType)}
                  disabled={submitting}
                >
                  {GROUP_WORKSPACE_TYPES.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {GROUP_WORKSPACE_TYPES.find(option => option.value === workspaceType)?.description}
                </p>
              </div>
            ) : (
              <div className="dialog-field">
                <label htmlFor="workspace-agent">目标 Agent</label>
                <select
                  id="workspace-agent"
                  value={targetAgentId}
                  onChange={event => setTargetAgentId(toDirectAgentId(event.currentTarget.value))}
                  disabled={submitting}
                >
                  {directAgentOptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {directAgentLabel(option)} · {providerLabel(option.provider)}
                    </option>
                  ))}
                </select>
                <p className="field-hint">单聊只能选择默认 Claude Code 或 Codex Agent，并固定写入 chat 类型工作区。</p>
              </div>
            )}

            <div className="dialog-note">
              当前创建目标：<strong>{sourceTargetLabel}</strong>
            </div>

            {errorMessage ? <div className="field-error">{errorMessage}</div> : null}

            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
                取消
              </button>
              <button className="primary-button" type="submit" disabled={submitting || (roomMode === 'direct' && directAgentOptions.length === 0)}>
                {submitting ? '创建中...' : '创建工作区'}
              </button>
            </div>
          </form>
        </GlassPanel>
      </div>
    </div>
  )
}

function providerLabel(provider: DirectAgentProvider): string {
  return provider === 'claude' ? 'Claude' : 'Codex'
}
