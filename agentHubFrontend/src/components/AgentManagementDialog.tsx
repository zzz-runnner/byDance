import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Bot, Plus, Save, Trash2, X } from 'lucide-react'
import type { CreateBusinessAgentInput, UpdateBusinessAgentInput } from '../api/businessBackend'
import type { AgentDefinition, AgentProvider } from '../types'
import { GlassPanel } from './GlassPanel'

type AgentDraft = {
  id: string
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
    id: '',
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
    id: agent.id,
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
    ...(draft.id.trim() ? { id: draft.id.trim() } : {}),
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
  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => left.id.localeCompare(right.id)),
    [agents],
  )
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<AgentDraft>(() => createEmptyDraft())

  const selectedAgent = creating ? undefined : sortedAgents.find(agent => agent.id === selectedAgentId)
  const isBuiltIn = selectedAgent?.source === 'built-in'
  const deleteDisabled = saving || !selectedAgent || isBuiltIn || deletingAgentId === selectedAgent?.id

  useEffect(() => {
    if (!open) {
      return
    }
    const firstAgent = sortedAgents[0]
    if (!selectedAgentId && firstAgent) {
      setSelectedAgentId(firstAgent.id)
      setDraft(draftFromAgent(firstAgent))
      setCreating(false)
    }
  }, [open, selectedAgentId, sortedAgents])

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
            <div>
              <p className="eyebrow">Agent Management</p>
              <h2>Agents</h2>
            </div>
            <button className="icon-button" type="button" onClick={onClose} disabled={saving} title="Close">
              <X size={16} />
            </button>
          </div>

          <div className="agent-dialog__body">
            <aside className="agent-dialog__list">
              <button className={`agent-list-item ${creating ? 'is-active' : ''}`} type="button" onClick={startCreate}>
                <Plus size={15} />
                <span>New Agent</span>
              </button>
              {sortedAgents.map(agent => (
                <button
                  className={`agent-list-item ${!creating && agent.id === selectedAgentId ? 'is-active' : ''}`}
                  key={agent.id}
                  type="button"
                  onClick={() => selectAgent(agent)}
                >
                  <Bot size={15} />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.id} / {providerLabel(agent.modelProvider)}</small>
                  </span>
                </button>
              ))}
            </aside>

            <form className="dialog-form agent-dialog__form" onSubmit={handleSubmit}>
              <div className="agent-form-grid">
                <div className="dialog-field">
                  <label htmlFor="agent-id">Agent ID</label>
                  <input
                    id="agent-id"
                    value={draft.id}
                    onChange={event => updateDraft('id', event.currentTarget.value)}
                    disabled={!creating || saving}
                    placeholder="agent-id"
                  />
                </div>
                <div className="dialog-field">
                  <label htmlFor="agent-provider">Provider</label>
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
                  <label htmlFor="agent-name">Name</label>
                  <input
                    id="agent-name"
                    value={draft.name}
                    onChange={event => updateDraft('name', event.currentTarget.value)}
                    disabled={saving}
                    required
                  />
                </div>
                <div className="dialog-field">
                  <label htmlFor="agent-model">Model</label>
                  <input
                    id="agent-model"
                    value={draft.model}
                    onChange={event => updateDraft('model', event.currentTarget.value)}
                    disabled={saving}
                    placeholder="default"
                  />
                </div>
                <div className="dialog-field">
                  <label htmlFor="agent-role">Role</label>
                  <input
                    id="agent-role"
                    value={draft.role}
                    onChange={event => updateDraft('role', event.currentTarget.value)}
                    disabled={saving}
                  />
                </div>
                <div className="dialog-field">
                  <label htmlFor="agent-runtime">Max Run Seconds</label>
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

              <div className="dialog-field">
                <label htmlFor="agent-description">Description</label>
                <textarea
                  id="agent-description"
                  rows={2}
                  value={draft.description}
                  onChange={event => updateDraft('description', event.currentTarget.value)}
                  disabled={saving}
                />
              </div>

              <div className="dialog-field">
                <label htmlFor="agent-when">When To Use</label>
                <textarea
                  id="agent-when"
                  rows={2}
                  value={draft.whenToUse}
                  onChange={event => updateDraft('whenToUse', event.currentTarget.value)}
                  disabled={saving}
                />
              </div>

              <div className="dialog-field">
                <label htmlFor="agent-system-prompt">System Prompt</label>
                <textarea
                  id="agent-system-prompt"
                  rows={6}
                  value={draft.systemPrompt}
                  onChange={event => updateDraft('systemPrompt', event.currentTarget.value)}
                  disabled={saving}
                  required
                />
              </div>

              {isBuiltIn ? (
                <div className="dialog-note">Built-in agents can change profile, prompt, provider, model, and runtime limit. They cannot be deleted.</div>
              ) : null}
              {errorMessage ? <div className="field-error">{errorMessage}</div> : null}

              <div className="dialog-actions">
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleteDisabled}
                >
                  <Trash2 size={15} />
                  {deletingAgentId === selectedAgent?.id ? 'Deleting' : 'Delete'}
                </button>
                <button className="primary-button" type="submit" disabled={saving || !draft.name.trim() || !draft.systemPrompt.trim()}>
                  <Save size={15} />
                  {saving ? 'Saving' : creating ? 'Create Agent' : 'Save Agent'}
                </button>
              </div>
            </form>
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}
