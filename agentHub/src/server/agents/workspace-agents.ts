import type { AgentDefinition, AppState, Conversation, WorkspaceAgentMember } from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import { normalizeBuiltInAgentPresentation } from './agent-presentation'

export const DEFAULT_WORKSPACE_AGENT_ORDER = [
  'orchestrator',
  'product-manager',
  'engineer',
  'reviewer',
] as const

export const DIRECT_CHAT_AGENT_ORDER = [
  'claude-code-direct',
  'codex-direct',
] as const

const DEFAULT_WORKSPACE_AGENT_ORDER_MAP = new Map<string, number>(
  DEFAULT_WORKSPACE_AGENT_ORDER.map((agentId, index) => [agentId, index] as const),
)

const DIRECT_CHAT_AGENT_ORDER_MAP = new Map<string, number>(
  DIRECT_CHAT_AGENT_ORDER.map((agentId, index) => [agentId, index] as const),
)

type AgentTemplateInput = Omit<AgentDefinition, 'createdAt' | 'updatedAt' | 'workspaceId' | 'conversationId'>

const commonContextPolicy = {
  includeProjectBrief: true,
  includePinnedMessages: true,
  recentMessageLimit: 12,
  includeSameConversationOnly: false,
  includeArtifacts: true,
  includeFileSummaries: true,
  allowReadFilesOnDemand: true,
}

export const AGENT_TEMPLATES: Record<string, AgentTemplateInput> = {
  orchestrator: {
    id: 'orchestrator',
    name: '项目经理 Agent',
    role: '负责理解用户请求、拆任务、调度子 Agent 并汇总结果。',
    description: 'AgentHub 主脑，借鉴 Claude Code 的主循环、工具权限和上下文包范式。',
    whenToUse: '群聊任务、跨 Agent 协作、任务拆解和结果汇总时调用。',
    systemPrompt:
      'You are AgentHub Orchestrator. Route tasks, keep context compact, call the right agents, and summarize results clearly.',
    modelProvider: 'claude',
    model: 'default',
    contextPolicy: commonContextPolicy,
    tools: ['callAgent', 'searchWorkspaceContext', 'updateProjectBrief', 'createArtifact', 'pinMessage'],
    permissions: {
      fileRead: true,
      fileWrite: false,
      shell: false,
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    disallowedTools: ['writeFile', 'runCommand', 'deploy'],
    permissionMode: 'readonly',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: false,
      maxRunSeconds: 90,
    },
    outputSchema: 'Return a routing decision, child-agent summaries, and a final user-facing answer.',
    isolation: 'shared',
    skills: ['routing', 'context-building', 'summarization'],
    routingProfile: {
      routingSummary: 'Coordinate cross-agent work, answer system-level questions, and summarize multi-agent results.',
      responsibilities: [
        'Coordinate multiple child agents in one turn',
        'Answer system status and workspace state questions',
        'Summarize results when more than one agent participates',
      ],
      goodAt: [
        'Cross-role coordination',
        'System and workflow status',
        'Multi-agent synthesis',
      ],
      notFor: [
        'Owning deep specialist answers when one child agent can reply directly',
        'Pretending to be a domain specialist for a single-domain business question',
      ],
      preferredStages: ['chat', 'planning', 'awaiting_confirmation', 'execution', 'review'],
      exampleRequests: [
        '现在服务正常吗',
        '接下来应该先谁做什么',
        '把几个子 agent 的结果汇总一下',
      ],
      speakerMode: 'either',
    },
    source: 'built-in',
  },
  'product-manager': {
    id: 'product-manager',
    name: '产品经理 Agent',
    role: '负责澄清需求、定义范围和验收标准。',
    description: '把用户输入整理成可执行的产品任务包。',
    whenToUse: '需求模糊、需要拆功能、需要验收标准时调用。',
    systemPrompt:
      'You are a product manager agent. Clarify scope, acceptance criteria, and risks for a dev workspace task.',
    modelProvider: 'claude',
    model: 'default',
    contextPolicy: commonContextPolicy,
    tools: ['readContext'],
    permissions: {
      fileRead: true,
      fileWrite: false,
      shell: false,
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    disallowedTools: ['writeFile', 'runCommand', 'deploy'],
    permissionMode: 'readonly',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: false,
      maxRunSeconds: 300,
    },
    outputSchema: 'Return task scope, acceptance criteria, and known risks.',
    isolation: 'shared',
    skills: ['requirements', 'acceptance-criteria'],
    routingProfile: {
      routingSummary: 'Handle requirement clarification, product planning, scope framing, and acceptance design.',
      responsibilities: [
        'Clarify user goals and scope',
        'Translate rough requests into structured task packages',
        'Define acceptance criteria and product risks',
      ],
      goodAt: [
        'Requirement intake',
        'Feature planning',
        'Page and module scoping',
        'PRD-style responses',
      ],
      notFor: [
        'Concrete code implementation',
        'Technical bug fixing',
        'Final QA verdicts',
      ],
      preferredStages: ['requirements_intake', 'planning', 'awaiting_confirmation'],
      exampleRequests: [
        '给我一个完整方案',
        '帮我梳理下页面模块',
        '先和我对接需求',
      ],
      speakerMode: 'direct_speaker',
    },
    source: 'built-in',
  },
  engineer: {
    id: 'engineer',
    name: '工程师 Agent',
    role: '负责实现代码、生成 Diff 和产物预览。',
    description: '默认由 Codex 执行工程任务，后续可切换 Claude Code 或 OpenClaw。',
    whenToUse: '需要实现、修改、修复、生成代码或构建预览时调用。',
    systemPrompt:
      'You are an engineer agent. Implement narrowly scoped changes and report changed files, tests, and preview status.',
    modelProvider: 'codex',
    model: 'default',
    contextPolicy: commonContextPolicy,
    tools: ['readFile', 'writeFile', 'applyDiff', 'runCommand'],
    permissions: {
      fileRead: true,
      fileWrite: true,
      shell: true,
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    disallowedTools: ['deploy'],
    permissionMode: 'acceptEdits',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: true,
      maxRunSeconds: 600,
    },
    outputSchema: 'Return implementation summary, changed files, tests, and preview artifacts.',
    isolation: 'worktree',
    skills: ['typescript', 'runtime', 'diff'],
    routingProfile: {
      routingSummary: 'Handle implementation, technical tradeoffs, bug fixing, and execution-focused engineering work.',
      responsibilities: [
        'Implement scoped code changes',
        'Explain technical solutions and tradeoffs',
        'Fix bugs and validate execution details',
      ],
      goodAt: [
        'Frontend and backend implementation',
        'Code-level debugging',
        'Tech stack decisions',
        'Preview and build issues',
      ],
      notFor: [
        'Owning requirement intake from scratch',
        'Issuing final QA verdicts',
      ],
      preferredStages: ['execution', 'planning'],
      exampleRequests: [
        '这个页面怎么实现',
        '帮我修一下这个 bug',
        '这个报错为什么会出现',
      ],
      speakerMode: 'direct_speaker',
    },
    source: 'built-in',
  },
  reviewer: {
    id: 'reviewer',
    name: '测试审查 Agent',
    role: '负责质量检查、风险发现和验收结论。',
    description: '默认由 Claude Code 执行审查任务，输出 PASS / FAIL / PARTIAL。',
    whenToUse: '实现完成后、需要检查质量或验收时调用。',
    systemPrompt:
      'You are a reviewer agent. Verify the result against requirements and return PASS, PARTIAL, or FAIL with findings.',
    modelProvider: 'claude',
    model: 'default',
    contextPolicy: commonContextPolicy,
    tools: ['readFile', 'runCommand'],
    permissions: {
      fileRead: true,
      fileWrite: false,
      shell: true,
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    disallowedTools: ['writeFile', 'deploy'],
    permissionMode: 'readonly',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: true,
      maxRunSeconds: 300,
    },
    outputSchema: 'Return findings, severity, suggested fixes, and PASS/PARTIAL/FAIL.',
    isolation: 'shared',
    skills: ['review', 'testing'],
    routingProfile: {
      routingSummary: 'Handle review, validation, testing, risk detection, and final verdict-style responses.',
      responsibilities: [
        'Review outcomes against stated requirements',
        'Find risks and missing checks',
        'Return validation verdicts with findings',
      ],
      goodAt: [
        'Acceptance review',
        'Risk spotting',
        'Testing conclusions',
        'PASS/PARTIAL/FAIL judgments',
      ],
      notFor: [
        'Owning implementation work',
        'Leading requirement discovery from scratch',
      ],
      preferredStages: ['review', 'execution'],
      exampleRequests: [
        '帮我验收一下',
        '这版有什么风险',
        '测试结果怎么样',
      ],
      speakerMode: 'direct_speaker',
    },
    source: 'built-in',
  },
  'claude-code-direct': {
    id: 'claude-code-direct',
    name: 'Claude Code Agent',
    role: '用于单聊模式的 Claude Code 工程 Agent。',
    description: '固定作为单聊入口，直接调用 Claude Code 处理代码、解释、修改和调试任务。',
    whenToUse: '用户创建 Claude 单聊工作区，或希望直接与 Claude Code Agent 对话时使用。',
    systemPrompt:
      'You are Claude Code Agent in a direct chat workspace. Help the user with software engineering tasks, explain tradeoffs clearly, and make scoped code changes when execution is requested.',
    modelProvider: 'claude',
    model: 'default',
    contextPolicy: commonContextPolicy,
    tools: ['readFile', 'writeFile', 'applyDiff', 'runCommand'],
    permissions: {
      fileRead: true,
      fileWrite: true,
      shell: true,
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    disallowedTools: ['deploy'],
    permissionMode: 'acceptEdits',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: true,
      maxRunSeconds: 600,
    },
    outputSchema: 'Return a direct Claude Code response with changed files, tests, or next steps when relevant.',
    isolation: 'worktree',
    skills: ['claude-code', 'typescript', 'debugging', 'diff'],
    routingProfile: {
      routingSummary: 'Direct Claude Code chat for implementation, debugging, and code explanation tasks.',
      responsibilities: [
        'Answer software engineering questions in a direct chat',
        'Implement scoped code changes when asked',
        'Explain files, tradeoffs, and next steps clearly',
      ],
      goodAt: [
        'Code understanding',
        'Implementation',
        'Debugging',
        'Developer guidance',
      ],
      notFor: [
        'Multi-agent orchestration',
        'Cross-agent synthesis',
      ],
      preferredStages: ['chat', 'planning', 'execution', 'review'],
      exampleRequests: [
        '用 Claude Code 帮我改这个组件',
        '解释这个报错',
        '直接和 Claude Code 对话',
      ],
      speakerMode: 'direct_speaker',
    },
    source: 'built-in',
  },
  'codex-direct': {
    id: 'codex-direct',
    name: 'Codex Agent',
    role: '用于单聊模式的 Codex 工程 Agent。',
    description: '固定作为单聊入口，直接调用 Codex 处理实现、修改、调试和代码审查辅助任务。',
    whenToUse: '用户创建 Codex 单聊工作区，或希望直接与 Codex Agent 对话时使用。',
    systemPrompt:
      'You are Codex Agent in a direct chat workspace. Work pragmatically with the repository context, make scoped edits when requested, and report verification clearly.',
    modelProvider: 'codex',
    model: 'default',
    contextPolicy: commonContextPolicy,
    tools: ['readFile', 'writeFile', 'applyDiff', 'runCommand'],
    permissions: {
      fileRead: true,
      fileWrite: true,
      shell: true,
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    disallowedTools: ['deploy'],
    permissionMode: 'acceptEdits',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: true,
      maxRunSeconds: 600,
    },
    outputSchema: 'Return a direct Codex response with implementation summary, changed files, tests, or next steps when relevant.',
    isolation: 'worktree',
    skills: ['codex', 'typescript', 'debugging', 'diff'],
    routingProfile: {
      routingSummary: 'Direct Codex chat for implementation, debugging, and repository editing tasks.',
      responsibilities: [
        'Answer engineering questions in a direct chat',
        'Implement focused code changes',
        'Report changed files and validation results',
      ],
      goodAt: [
        'Repository editing',
        'Bug fixing',
        'Implementation detail',
        'Verification reporting',
      ],
      notFor: [
        'Multi-agent orchestration',
        'Product requirement ownership',
      ],
      preferredStages: ['chat', 'planning', 'execution', 'review'],
      exampleRequests: [
        '用 Codex 实现这个页面',
        '帮我修这个 bug',
        '直接和 Codex 对话',
      ],
      speakerMode: 'direct_speaker',
    },
    source: 'built-in',
  },
}

/**
 * Creates one scoped agent instance from a built-in template.
 * Input: template id, workspace id, optional conversation id, and timestamp. Output: scoped agent row.
 */
export function createBuiltInAgentInstance(
  agentId: keyof typeof AGENT_TEMPLATES | string,
  workspaceId: string,
  conversationId: string | undefined,
  createdAt = isoNow(),
): AgentDefinition {
  const template = AGENT_TEMPLATES[agentId]
  if (!template) {
    throw new Error(`Unknown built-in agent template: ${agentId}`)
  }
  return normalizeBuiltInAgentPresentation({
    ...template,
    workspaceId,
    conversationId,
    createdAt,
    updatedAt: createdAt,
  })
}

export function createGroupAgentInstances(
  workspaceId: string,
  conversationId: string,
  createdAt = isoNow(),
): AgentDefinition[] {
  return DEFAULT_WORKSPACE_AGENT_ORDER.map(agentId =>
    createBuiltInAgentInstance(agentId, workspaceId, conversationId, createdAt),
  )
}

export function createDirectAgentInstance(
  agentId: typeof DIRECT_CHAT_AGENT_ORDER[number],
  workspaceId: string,
  conversationId: string,
  createdAt = isoNow(),
): AgentDefinition {
  return createBuiltInAgentInstance(agentId, workspaceId, conversationId, createdAt)
}

/**
 * Returns whether one agent definition is a locked default room agent.
 * Input: one agent definition. Output: true for default room agents.
 */
export function isBuiltInAgent(agent: AgentDefinition): boolean {
  return agent.source === 'built-in'
}

/**
 * Returns whether one agent definition belongs to one workspace only.
 * Input: one agent definition. Output: true for workspace-scoped custom agents.
 */
export function isWorkspaceScopedAgent(agent: AgentDefinition): boolean {
  return agent.source !== 'built-in'
}

/**
 * Returns scoped built-in agents for one workspace.
 * Input: full application state and optional workspace id. Output: normalized room-scoped built-in agents.
 */
export function listBuiltInAgents(state: AppState, workspaceId?: string): AgentDefinition[] {
  return state.agents
    .filter(isBuiltInAgent)
    .filter(agent => !workspaceId || agent.workspaceId === workspaceId)
    .map(agent => normalizeBuiltInAgentPresentation(agent))
    .sort((left, right) => compareAgentOrder(left.id, right.id) || left.createdAt.localeCompare(right.createdAt))
}

/**
 * Returns whether one built-in agent should be auto-added to group workspace membership.
 * Input: agent id. Output: true for default group members.
 */
function isDefaultGroupAgent(agentId: string): boolean {
  return DEFAULT_WORKSPACE_AGENT_ORDER_MAP.has(agentId)
}

export function isDirectChatAgentId(agentId: string): agentId is typeof DIRECT_CHAT_AGENT_ORDER[number] {
  return DIRECT_CHAT_AGENT_ORDER.includes(agentId as typeof DIRECT_CHAT_AGENT_ORDER[number])
}

/**
 * Returns workspace-scoped custom agents for one workspace.
 * Input: full state and workspace id. Output: custom agents in stable order.
 */
export function listWorkspaceCustomAgents(state: AppState, workspaceId: string): AgentDefinition[] {
  return state.agents
    .filter(agent => isWorkspaceScopedAgent(agent) && agent.workspaceId === workspaceId)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
}

/**
 * Returns the primary group conversation id for one workspace.
 * Input: full state and workspace id. Output: group conversation id or undefined.
 */
function primaryGroupConversationId(state: AppState, workspaceId: string): string | undefined {
  return state.conversations
    .filter(conversation => conversation.workspaceId === workspaceId && conversation.type === 'group')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]?.id
}

/**
 * Returns whether one workspace should use direct-chat membership rules.
 * Input: full state and workspace id. Output: true for single-chat workspaces.
 */
function isDirectChatWorkspace(state: AppState, workspaceId: string): boolean {
  return state.workspaces.find(workspace => workspace.id === workspaceId)?.workspaceType === 'chat'
}

/**
 * Creates the default locked built-in members for one workspace.
 * Input: built-in templates, workspace id, and timestamp. Output: default membership rows.
 */
export function createDefaultWorkspaceAgentMembers(
  agents: AgentDefinition[],
  workspaceId: string,
  createdAt = isoNow(),
): WorkspaceAgentMember[] {
  return agents
    .filter(isBuiltInAgent)
    .filter(agent => isDefaultGroupAgent(agent.id))
    .map(agent => normalizeBuiltInAgentPresentation(agent))
    .sort((left, right) => compareAgentOrder(left.id, right.id) || left.createdAt.localeCompare(right.createdAt))
    .map((agent, index) => ({
      workspaceId,
      agentId: agent.id,
      displayName: agent.name,
      sortOrder: DEFAULT_WORKSPACE_AGENT_ORDER_MAP.get(agent.id) ?? index + DEFAULT_WORKSPACE_AGENT_ORDER.length,
      locked: true,
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    }))
}

/**
 * Creates locked workspace member rows for built-in agents used by direct conversations.
 * Input: full state, workspace id, and timestamp. Output: direct-only built-in membership rows.
 */
function createDirectWorkspaceAgentMembers(
  state: AppState,
  workspaceId: string,
  createdAt = isoNow(),
): WorkspaceAgentMember[] {
  const builtInAgents = new Map(listBuiltInAgents(state, workspaceId).map(agent => [agent.id, agent]))
  const directAgentIds = Array.from(new Set(
    state.conversations
      .filter(conversation => conversation.workspaceId === workspaceId && conversation.type === 'direct')
      .flatMap(conversation => conversation.participants)
      .filter(participant => participant !== 'user' && builtInAgents.has(participant)),
  ))

  return directAgentIds.flatMap((agentId, index) => {
    const agent = builtInAgents.get(agentId)
    if (!agent || isDefaultGroupAgent(agent.id)) {
      return []
    }

    return [{
      workspaceId,
      agentId: agent.id,
      displayName: agent.name,
      sortOrder: DEFAULT_WORKSPACE_AGENT_ORDER.length + (DIRECT_CHAT_AGENT_ORDER_MAP.get(agent.id) ?? index),
      locked: true,
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    }]
  })
}

/**
 * Creates the built-in member rows expected for one workspace shape.
 * Input: full state, workspace id, and timestamp. Output: default group or direct members.
 */
function createWorkspaceBuiltInMembers(
  state: AppState,
  workspaceId: string,
  createdAt = isoNow(),
): WorkspaceAgentMember[] {
  if (isDirectChatWorkspace(state, workspaceId)) {
    return createDirectWorkspaceAgentMembers(state, workspaceId, createdAt)
  }
  return createDefaultWorkspaceAgentMembers(listBuiltInAgents(state, workspaceId), workspaceId, createdAt)
}

function isWorkspaceBuiltInMemberId(agentId: string): boolean {
  return isDefaultGroupAgent(agentId) || isDirectChatAgentId(agentId)
}

/**
 * Returns whether a built-in member id belongs to the current workspace shape.
 * Input: full state, workspace id, and member id. Output: true when the member is allowed.
 */
function isAllowedWorkspaceBuiltInMember(state: AppState, workspaceId: string, agentId: string): boolean {
  return isDirectChatWorkspace(state, workspaceId)
    ? isDirectChatAgentId(agentId)
    : isDefaultGroupAgent(agentId)
}

/**
 * Collapses duplicate rows and removes built-in members that do not match the workspace shape.
 * Input: mutable state and workspace id. Output: whether membership rows changed.
 */
function normalizeWorkspaceAgentMembers(state: AppState, workspaceId: string): boolean {
  const seen = new Set<string>()
  const nextMembers: WorkspaceAgentMember[] = []
  let changed = false

  for (const member of state.workspaceAgentMembers) {
    if (member.workspaceId !== workspaceId) {
      nextMembers.push(member)
      continue
    }

    if (
      isWorkspaceBuiltInMemberId(member.agentId) &&
      !isAllowedWorkspaceBuiltInMember(state, workspaceId, member.agentId)
    ) {
      changed = true
      continue
    }

    if (seen.has(member.agentId)) {
      changed = true
      continue
    }

    seen.add(member.agentId)
    nextMembers.push(member)
  }

  if (changed) {
    state.workspaceAgentMembers = nextMembers
  }

  return changed
}

/**
 * Ensures one workspace has locked built-in membership rows.
 * Input: mutable application state, workspace id, and timestamp. Output: workspace members after backfill.
 */
export function ensureWorkspaceAgentMembers(
  state: AppState,
  workspaceId: string,
  createdAt = isoNow(),
): WorkspaceAgentMember[] {
  const normalized = normalizeWorkspaceAgentMembers(state, workspaceId)
  const existingMembers = state.workspaceAgentMembers.filter(member => member.workspaceId === workspaceId)
  const memberByAgentId = new Map(existingMembers.map(member => [member.agentId, member]))
  let changed = normalized

  const missingBuiltInMembers = createWorkspaceBuiltInMembers(state, workspaceId, createdAt)

  for (const member of missingBuiltInMembers) {
    if (memberByAgentId.has(member.agentId)) {
      continue
    }
    state.workspaceAgentMembers.push(member)
    memberByAgentId.set(member.agentId, member)
    changed = true
  }

  return changed
    ? state.workspaceAgentMembers.filter(member => member.workspaceId === workspaceId).sort(compareWorkspaceMembers)
    : existingMembers.sort(compareWorkspaceMembers)
}

/**
 * Upserts one workspace member row without changing its stable agent id.
 * Input: mutable state and partial member payload. Output: stored workspace member row.
 */
export function upsertWorkspaceAgentMember(
  state: AppState,
  input: Omit<WorkspaceAgentMember, 'createdAt' | 'updatedAt'> & {
    createdAt?: string
    updatedAt?: string
  },
): WorkspaceAgentMember {
  const existing = state.workspaceAgentMembers.find(
    member => member.workspaceId === input.workspaceId && member.agentId === input.agentId,
  )
  const now = input.updatedAt ?? isoNow()

  if (existing) {
    existing.displayName = input.displayName
    existing.modelProviderOverride = input.modelProviderOverride
    existing.modelOverride = input.modelOverride
    existing.sortOrder = input.sortOrder
    existing.locked = input.locked
    existing.enabled = input.enabled
    existing.updatedAt = now
    return existing
  }

  const created: WorkspaceAgentMember = {
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    displayName: input.displayName,
    modelProviderOverride: input.modelProviderOverride,
    modelOverride: input.modelOverride,
    sortOrder: input.sortOrder,
    locked: input.locked,
    enabled: input.enabled,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  }
  state.workspaceAgentMembers.push(created)
  return created
}

/**
 * Resolves the effective agent list visible inside one workspace.
 * Input: full state and workspace id. Output: built-in members plus workspace custom agents.
 */
export function resolveWorkspaceAgents(state: AppState, workspaceId: string): AgentDefinition[] {
  const builtInTemplates = new Map(listBuiltInAgents(state, workspaceId).map(agent => [agent.id, agent]))
  const persistedMembers = state.workspaceAgentMembers.filter(member => member.workspaceId === workspaceId)
  const persistedMemberIds = new Set<string>()
  const members = [
    ...persistedMembers.filter(member => {
      if (persistedMemberIds.has(member.agentId)) {
        return false
      }
      if (
        isWorkspaceBuiltInMemberId(member.agentId) &&
        !isAllowedWorkspaceBuiltInMember(state, workspaceId, member.agentId)
      ) {
        return false
      }
      persistedMemberIds.add(member.agentId)
      return true
    }),
    ...createWorkspaceBuiltInMembers(state, workspaceId).filter(member => !persistedMemberIds.has(member.agentId)),
  ]
    .filter(member => member.enabled)
    .sort(compareWorkspaceMembers)

  const builtInAgents = members.flatMap(member => {
    const template = builtInTemplates.get(member.agentId)
    if (!template) {
      return []
    }

    const updatedAt =
      member.updatedAt.localeCompare(template.updatedAt) > 0
        ? member.updatedAt
        : template.updatedAt

    return [{
      ...template,
      name: member.displayName.trim() || template.name,
      modelProvider: member.modelProviderOverride ?? template.modelProvider,
      model: member.modelOverride ?? template.model,
      updatedAt,
    }]
  })

  const customAgents = listWorkspaceCustomAgents(state, workspaceId)
  return [...builtInAgents, ...customAgents]
}

/**
 * Resolves one effective agent view inside one workspace.
 * Input: full state, workspace id, and stable agent id. Output: display-ready agent or undefined.
 */
export function resolveWorkspaceAgent(
  state: AppState,
  workspaceId: string,
  agentId: string,
): AgentDefinition | undefined {
  return resolveWorkspaceAgents(state, workspaceId).find(agent => agent.id === agentId)
}

/**
 * Resolves the agents that belong to one concrete conversation.
 * Input: full state, workspace id, and conversation id. Output: participant-scoped agent list.
 */
export function resolveConversationAgents(
  state: AppState,
  workspaceId: string,
  conversationId: string,
): AgentDefinition[] {
  const conversation = state.conversations.find(candidate =>
    candidate.workspaceId === workspaceId && candidate.id === conversationId,
  )
  if (!conversation) {
    return resolveWorkspaceAgents(state, workspaceId)
  }

  const participantIds = new Set(conversation.participants.filter(participant => participant !== 'user'))
  const memberByAgentId = new Map(
    state.workspaceAgentMembers
      .filter(member => member.workspaceId === workspaceId && member.enabled)
      .map(member => [member.agentId, member]),
  )

  return state.agents
    .filter(agent => agent.workspaceId === workspaceId)
    .filter(agent => agent.conversationId === conversation.id)
    .filter(agent => participantIds.has(agent.id))
    .map(agent => {
      if (agent.source !== 'built-in') {
        return agent
      }
      const member = memberByAgentId.get(agent.id)
      if (!member) {
        return normalizeBuiltInAgentPresentation(agent)
      }
      const updatedAt =
        member.updatedAt.localeCompare(agent.updatedAt) > 0
          ? member.updatedAt
          : agent.updatedAt
      return normalizeBuiltInAgentPresentation({
        ...agent,
        name: member.displayName.trim() || agent.name,
        modelProvider: member.modelProviderOverride ?? agent.modelProvider,
        model: member.modelOverride ?? agent.model,
        updatedAt,
      })
    })
    .sort((left, right) => compareAgentOrder(left.id, right.id) || left.createdAt.localeCompare(right.createdAt))
}

/**
 * Synchronizes group-conversation participants with workspace-available agents.
 * Input: mutable state, workspace id, and timestamp. Output: whether any group conversation changed.
 */
export function syncWorkspaceGroupParticipants(
  state: AppState,
  workspaceId: string,
  updatedAt = isoNow(),
): boolean {
  const groupConversationId = primaryGroupConversationId(state, workspaceId)
  const nextParticipants = [
    'user',
    ...resolveWorkspaceAgents(state, workspaceId)
      .filter(agent =>
        (agent.source === 'built-in' && isDefaultGroupAgent(agent.id)) ||
        (
          agent.source !== 'built-in' &&
          (!groupConversationId || !agent.conversationId || agent.conversationId === groupConversationId)
        ),
      )
      .map(agent => agent.id),
  ]
  let changed = false

  for (const conversation of state.conversations) {
    if (conversation.workspaceId !== workspaceId || conversation.type !== 'group') {
      continue
    }

    const currentParticipants = conversation.participants.join('\u0000')
    const targetParticipants = nextParticipants.join('\u0000')
    if (currentParticipants === targetParticipants) {
      continue
    }

    conversation.participants = [...nextParticipants]
    conversation.updatedAt = updatedAt
    changed = true
  }

  return changed
}

function compareAgentOrder(leftId: string, rightId: string): number {
  const leftOrder = DEFAULT_WORKSPACE_AGENT_ORDER_MAP.get(leftId) ?? Number.MAX_SAFE_INTEGER
  const rightOrder = DEFAULT_WORKSPACE_AGENT_ORDER_MAP.get(rightId) ?? Number.MAX_SAFE_INTEGER
  return leftOrder - rightOrder || leftId.localeCompare(rightId)
}

function compareWorkspaceMembers(left: WorkspaceAgentMember, right: WorkspaceAgentMember): number {
  return (
    left.sortOrder - right.sortOrder ||
    compareAgentOrder(left.agentId, right.agentId) ||
    left.createdAt.localeCompare(right.createdAt)
  )
}
