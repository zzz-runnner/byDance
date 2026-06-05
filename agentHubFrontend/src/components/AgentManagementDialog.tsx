import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Bot, Clock, Plus, Save, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import type { CreateBusinessAgentInput, UpdateBusinessAgentInput } from '../api/businessBackend'
import type { AgentDefinition, AgentProvider } from '../types'
import { AgentAvatar } from './AgentAvatar'
import { GlassPanel } from './GlassPanel'

type AgentDraft = {
  name: string
  role: string
  description: string
  whenToUse: string
  systemPrompt: string
  modelProvider: AgentProvider
  model: string
  maxRunSeconds: number
}

type AgentManagementDialogProps = {
  open: boolean
  agents: AgentDefinition[]
  saving: boolean
  deletingAgentId?: string
  errorMessage: string
  onClose: () => void
  onCreate: (input: CreateBusinessAgentInput) => Promise<AgentDefinition | void> | AgentDefinition | void
  onUpdate: (agentId: string, input: UpdateBusinessAgentInput) => Promise<AgentDefinition | void> | AgentDefinition | void
  onDelete: (agentId: string) => Promise<void> | void
}

const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'mock']
const DEFAULT_RUNTIME_SECONDS = 300
const DEFAULT_SYSTEM_PROMPT = 'You are a focused custom Agent. Follow the workspace context and return concise, actionable results.'

function createEmptyDraft(): AgentDraft {
  return {
    name: '',
    role: 'Custom Agent',
    description: 'User-created Agent',
    whenToUse: 'Use when the user explicitly selects or mentions this Agent.',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    modelProvider: 'claude',
    model: 'default',
    maxRunSeconds: DEFAULT_RUNTIME_SECONDS,
  }
}

function draftFromAgent(agent: AgentDefinition): AgentDraft {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    whenToUse: agent.whenToUse,
    systemPrompt: agent.systemPrompt,
    modelProvider: agent.modelProvider,
    model: agent.model ?? 'default',
    maxRunSeconds: agent.runtimePolicy.maxRunSeconds,
  }
}

function providerLabel(provider: AgentProvider): string {
  if (provider === 'claude') {
    return 'Claude'
  }
  if (provider === 'codex') {
    return 'Codex'
  }
  return 'Mock'
}

function agentSearchText(agent: AgentDefinition): string {
  return [
    agent.id,
    agent.name,
    agent.role,
    agent.description,
    agent.whenToUse,
    agent.modelProvider,
    agent.model,
  ].filter(Boolean).join(' ').toLowerCase()
}

function formatRunSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} 分钟`
  }
  return `${seconds} 秒`
}

function policyLabel(enabled: boolean, activeLabel: string, inactiveLabel: string): string {
  return enabled ? activeLabel : inactiveLabel
}

function runtimePolicyFor(agent: AgentDefinition | undefined, maxRunSeconds: number): AgentDefinition['runtimePolicy'] {
  return {
    workspaceOnly: agent?.runtimePolicy.workspaceOnly ?? true,
    allowNetwork: agent?.runtimePolicy.allowNetwork ?? false,
    allowShell: agent?.runtimePolicy.allowShell ?? false,
    maxRunSeconds,
  }
}

function toCreateInput(draft: AgentDraft): CreateBusinessAgentInput {
  return {
    name: draft.name.trim(),
    role: draft.role.trim(),
    description: draft.description.trim(),
    whenToUse: draft.whenToUse.trim(),
    systemPrompt: draft.systemPrompt.trim(),
    modelProvider: draft.modelProvider,
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    runtimePolicy: runtimePolicyFor(undefined, draft.maxRunSeconds),
  }
}

function toUpdateInput(agent: AgentDefinition, draft: AgentDraft): UpdateBusinessAgentInput {
  if (agent.source === 'built-in') {
    return {
      name: draft.name.trim(),
      modelProvider: draft.modelProvider,
      ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    }
  }

  return {
    name: draft.name.trim(),
    role: draft.role.trim(),
    description: draft.description.trim(),
    whenToUse: draft.whenToUse.trim(),
    systemPrompt: draft.systemPrompt.trim(),
    modelProvider: draft.modelProvider,
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    runtimePolicy: runtimePolicyFor(agent, draft.maxRunSeconds),
  }
}

/**
 * Renders the Agent management surface backed by business Agent APIs.
 * Input: current agent definitions and mutation callbacks.
 * Output: modal UI for creating, editing, deleting, and provider switching.
 */
export function AgentManagementDialog({
  open,
  agents,
  saving,
  deletingAgentId,
  errorMessage,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: AgentManagementDialogProps) {
  const builtInAgents = useMemo(
    () => agents.filter(agent => agent.source === 'built-in'),
    [agents],
  )
  const customAgents = useMemo(
    () => [...agents.filter(agent => agent.source !== 'built-in')].sort((left, right) => left.id.localeCompare(right.id)),
    [agents],
  )
  const sortedAgents = useMemo(
    () => [...builtInAgents, ...customAgents],
    [builtInAgents, customAgents],
  )
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [creating, setCreating] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [draft, setDraft] = useState<AgentDraft>(() => createEmptyDraft())

  const selectedAgent = creating ? undefined : sortedAgents.find(agent => agent.id === selectedAgentId)
  const isBuiltIn = selectedAgent?.source === 'built-in'
  const deleteDisabled = saving || !selectedAgent || isBuiltIn || deletingAgentId === selectedAgent?.id
  const normalizedSearch = searchText.trim().toLowerCase()
  const visibleBuiltInAgents = useMemo(
    () => builtInAgents.filter(agent => !normalizedSearch || agentSearchText(agent).includes(normalizedSearch)),
    [builtInAgents, normalizedSearch],
  )
  const visibleCustomAgents = useMemo(
    () => customAgents.filter(agent => !normalizedSearch || agentSearchText(agent).includes(normalizedSearch)),
    [customAgents, normalizedSearch],
  )
  const visibleAgentCount = visibleBuiltInAgents.length + visibleCustomAgents.length
  const editorAgentId = creating ? 'new-agent' : selectedAgent?.id ?? 'new-agent'
  const editorAgentName = draft.name.trim() || (creating ? '新建 Agent' : selectedAgent?.name ?? 'Agent')
  const editorPolicy = runtimePolicyFor(selectedAgent, draft.maxRunSeconds)

  useEffect(() => {
    if (!open) {
      return
    }
    if (creating) {
      return
    }
    const firstAgent = sortedAgents[0]
    if (!selectedAgentId && firstAgent) {
      setSelectedAgentId(firstAgent.id)
      setDraft(draftFromAgent(firstAgent))
      setCreating(false)
    }
  }, [creating, open, selectedAgentId, sortedAgents])

  useEffect(() => {
    if (!open || creating || !selectedAgentId) {
      return
    }
    const nextAgent = sortedAgents.find(agent => agent.id === selectedAgentId)
    if (nextAgent) {
      setDraft(draftFromAgent(nextAgent))
    }
  }, [creating, open, selectedAgentId, sortedAgents])

  useEffect(() => {
    if (!open) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open, saving])

  useEffect(() => {
    if (open) {
      setSearchText('')
    }
  }, [open])

  if (!open) {
    return null
  }

  function updateDraft<T extends keyof AgentDraft>(field: T, value: AgentDraft[T]) {
    setDraft(previous => ({
      ...previous,
      [field]: value,
    }))
  }

  function startCreate() {
    setCreating(true)
    setSelectedAgentId('')
    setDraft(createEmptyDraft())
  }

  function selectAgent(agent: AgentDefinition) {
    setCreating(false)
    setSelectedAgentId(agent.id)
    setDraft(draftFromAgent(agent))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.name.trim() || !draft.systemPrompt.trim()) {
      return
    }

    if (creating) {
      const created = await onCreate(toCreateInput(draft))
      if (created?.id) {
        setCreating(false)
        setSelectedAgentId(created.id)
        setDraft(draftFromAgent(created))
      }
      return
    }

    if (selectedAgent) {
      const updated = await onUpdate(selectedAgent.id, toUpdateInput(selectedAgent, draft))
      if (updated?.id) {
        setDraft(draftFromAgent(updated))
      }
    }
  }

  async function handleDelete() {
    if (!selectedAgent || deleteDisabled) {
      return
    }
    await onDelete(selectedAgent.id)
    const nextAgent = sortedAgents.find(agent => agent.id !== selectedAgent.id)
    if (nextAgent) {
      setSelectedAgentId(nextAgent.id)
      setDraft(draftFromAgent(nextAgent))
    } else {
      startCreate()
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !saving && onClose()}>
      <div className="dialog-card-shell agent-dialog-shell" role="presentation" onClick={event => event.stopPropagation()}>
        <GlassPanel className="dialog-card agent-dialog">
          <div className="dialog-header">
            <div className="agent-dialog__title">
              <p className="eyebrow">智能体配置</p>
              <h2>Agent 管理</h2>
              <span>{builtInAgents.length} 个默认 / {customAgents.length} 个自定义</span>
            </div>
            <button className="icon-button" type="button" onClick={onClose} disabled={saving} title="关闭">
              <X size={16} />
            </button>
          </div>

          <div className="agent-dialog__body">
            <aside className="agent-dialog__list">
              <div className="agent-dialog__list-tools">
                <label className="agent-dialog__search" htmlFor="agent-search">
                  <Search size={14} />
                  <input
                    id="agent-search"
                    value={searchText}
                    onChange={event => setSearchText(event.currentTarget.value)}
                    placeholder="搜索 Agent"
                  />
                </label>
                <button className={`agent-list-item agent-list-item--new ${creating ? 'is-active' : ''}`} type="button" onClick={startCreate} disabled={saving}>
                  <Plus size={15} />
                  <span>新建 Agent</span>
                </button>
              </div>
              <div className="agent-dialog__stats" aria-label="Agent 数量">
                <span>{visibleAgentCount} 个显示</span>
                <span>{builtInAgents.length} 个默认</span>
                <span>{customAgents.length} 个自定义</span>
              </div>
              {visibleBuiltInAgents.length ? <p className="agent-dialog__section-label">默认 Agent</p> : null}
              {visibleBuiltInAgents.map(agent => (
                <button
                  className={`agent-list-item ${!creating && agent.id === selectedAgentId ? 'is-active' : ''}`}
                  key={agent.id}
                  type="button"
                  onClick={() => selectAgent(agent)}
                  disabled={saving}
                >
                  <AgentAvatar agentId={agent.id} name={agent.name} size="sm" />
                  <span className="agent-list-item__copy">
                    <strong>{agent.name}</strong>
                    <small>{agent.id}</small>
                  </span>
                  <span className="agent-list-item__badge">{providerLabel(agent.modelProvider)}</span>
                </button>
              ))}
              {visibleCustomAgents.length ? <p className="agent-dialog__section-label">自定义 Agent</p> : null}
              {visibleCustomAgents.map(agent => (
                <button
                  className={`agent-list-item ${!creating && agent.id === selectedAgentId ? 'is-active' : ''}`}
                  key={agent.id}
                  type="button"
                  onClick={() => selectAgent(agent)}
                  disabled={saving}
                >
                  <AgentAvatar agentId={agent.id} name={agent.name} size="sm" />
                  <span className="agent-list-item__copy">
                    <strong>{agent.name}</strong>
                    <small>{agent.id}</small>
                  </span>
                  <span className="agent-list-item__badge">{providerLabel(agent.modelProvider)}</span>
                </button>
              ))}
              {searchText && visibleAgentCount === 0 ? (
                <div className="agent-dialog__empty">
                  <Bot size={16} />
                  <span>没有匹配的 Agent</span>
                </div>
              ) : null}
            </aside>

            <form className="dialog-form agent-dialog__form" onSubmit={handleSubmit}>
              <div className="agent-dialog__form-scroll">
                <div className="agent-editor-summary">
                  <AgentAvatar agentId={editorAgentId} name={editorAgentName} size="lg" />
                  <div className="agent-editor-summary__copy">
                    <p>{creating ? '新建草稿' : isBuiltIn ? '默认 Agent' : '自定义 Agent'}</p>
                    <h3>{editorAgentName}</h3>
                    <div className="agent-editor-summary__meta">
                      <span>{providerLabel(draft.modelProvider)}</span>
                      <span>{draft.model.trim() || '默认模型'}</span>
                      <span>{formatRunSeconds(draft.maxRunSeconds)}</span>
                    </div>
                  </div>
                  {isBuiltIn ? (
                    <span className="agent-editor-summary__lock">
                      <ShieldCheck size={14} />
                      已锁定
                    </span>
                  ) : null}
                </div>

                <div className="agent-policy-strip">
                  <span>
                    <Clock size={14} />
                    {formatRunSeconds(draft.maxRunSeconds)}
                  </span>
                  <span>{policyLabel(editorPolicy.workspaceOnly, '仅当前工作区', '共享运行时')}</span>
                  <span>{policyLabel(editorPolicy.allowShell, '允许 Shell', '禁用 Shell')}</span>
                  <span>{policyLabel(editorPolicy.allowNetwork, '允许网络', '禁用网络')}</span>
                </div>

                <div className="agent-form-grid">
                  <div className="dialog-field">
                    <label htmlFor="agent-name">名称</label>
                    <input
                      id="agent-name"
                      value={draft.name}
                      onChange={event => updateDraft('name', event.currentTarget.value)}
                      disabled={saving}
                      required
                    />
                  </div>
                  <div className="dialog-field">
                    <label htmlFor="agent-role">角色</label>
                    <input
                      id="agent-role"
                      value={draft.role}
                      onChange={event => updateDraft('role', event.currentTarget.value)}
                      disabled={saving || isBuiltIn}
                    />
                  </div>
                  <div className="dialog-field">
                    <label htmlFor="agent-provider">模型提供方</label>
                    <select
                      id="agent-provider"
                      value={draft.modelProvider}
                      onChange={event => updateDraft('modelProvider', event.currentTarget.value as AgentProvider)}
                      disabled={saving}
                    >
                      {PROVIDERS.map(provider => (
                        <option key={provider} value={provider}>{providerLabel(provider)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="dialog-field">
                    <label htmlFor="agent-model">模型</label>
                    <input
                      id="agent-model"
                      value={draft.model}
                      onChange={event => updateDraft('model', event.currentTarget.value)}
                      disabled={saving}
                      placeholder="默认模型"
                    />
                  </div>
                  <div className="dialog-field">
                    <label htmlFor="agent-runtime">最大运行时间（秒）</label>
                    <input
                      id="agent-runtime"
                      type="number"
                      min={1}
                      value={draft.maxRunSeconds}
                      onChange={event => updateDraft('maxRunSeconds', Number(event.currentTarget.value) || DEFAULT_RUNTIME_SECONDS)}
                      disabled={saving}
                    />
                  </div>
                </div>

                {!isBuiltIn ? (
                  <div className="dialog-field">
                    <label htmlFor="agent-description">简介</label>
                    <textarea
                      id="agent-description"
                      rows={2}
                      value={draft.description}
                      onChange={event => updateDraft('description', event.currentTarget.value)}
                      disabled={saving}
                    />
                  </div>
                ) : null}

                {!isBuiltIn ? (
                  <div className="dialog-field">
                    <label htmlFor="agent-when">适用场景</label>
                    <textarea
                      id="agent-when"
                      rows={2}
                      value={draft.whenToUse}
                      onChange={event => updateDraft('whenToUse', event.currentTarget.value)}
                      disabled={saving}
                    />
                  </div>
                ) : null}

                {!isBuiltIn ? (
                  <div className="dialog-field">
                    <label htmlFor="agent-system-prompt">系统提示词</label>
                    <textarea
                      id="agent-system-prompt"
                      rows={6}
                      value={draft.systemPrompt}
                      onChange={event => updateDraft('systemPrompt', event.currentTarget.value)}
                      disabled={saving}
                      required
                    />
                  </div>
                ) : null}

                {isBuiltIn ? (
                  <div className="dialog-note agent-dialog__locked-note">
                    <ShieldCheck size={15} />
                    <span>默认 Agent 已锁定，仅支持调整名称、模型提供方和模型。</span>
                  </div>
                ) : null}
                {errorMessage ? <div className="field-error">{errorMessage}</div> : null}
              </div>

              <div className="dialog-actions agent-dialog__actions">
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleteDisabled}
                >
                  <Trash2 size={15} />
                  {deletingAgentId === selectedAgent?.id ? '删除中' : '删除'}
                </button>
                <button className="primary-button" type="submit" disabled={saving || !draft.name.trim() || !draft.systemPrompt.trim()}>
                  <Save size={15} />
                  {saving ? '保存中' : creating ? '创建 Agent' : '保存 Agent'}
                </button>
              </div>
            </form>
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}
