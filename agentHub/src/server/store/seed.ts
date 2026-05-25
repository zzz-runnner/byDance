import type { AgentDefinition, AppState } from '@shared/contracts'
import { isoNow } from '@shared/contracts'

/**
 * Creates a built-in agent definition with the shared AgentHub defaults.
 * Input: partial agent fields. Output: complete validated-ready agent object.
 */
function createAgent(agent: Omit<AgentDefinition, 'createdAt' | 'updatedAt'>): AgentDefinition {
  const now = isoNow()
  return {
    ...agent,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Builds the local demo state used before a PostgreSQL row exists.
 * Input: none. Output: initial application state for the local prototype.
 */
export function createSeedState(): AppState {
  const now = isoNow()
  const workspaceId = 'ws-local-demo'
  const groupConversationId = 'conv-local-group'
  const directConversationId = 'conv-engineer-direct'
  const runId = 'run-seed-engineer'
  const artifactId = 'artifact-seed-preview'

  const commonContextPolicy = {
    includeProjectBrief: true,
    includePinnedMessages: true,
    recentMessageLimit: 12,
    includeSameConversationOnly: false,
    includeArtifacts: true,
    includeFileSummaries: true,
    allowReadFilesOnDemand: true,
  }

  return {
    workspaces: [
      {
        id: workspaceId,
        name: 'AgentHub Local Demo',
        goal: '本地验证 AgentHub 主脑、子 Agent、任务流编排和产物展示。',
        workspaceType: 'dev',
        rootPath: 'data/workspaces/ws-local-demo/repo',
        runtimeType: 'local',
        runtimeStatus: 'ready',
        projectBrief:
          '第一版只做 dev 工作区，采用 IM 聊天入口，由 Orchestrator 调度 Claude Code 与 Codex 子 Agent。',
        pinnedMessageIds: ['msg-seed-system'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    conversations: [
      {
        id: groupConversationId,
        workspaceId,
        type: 'group',
        title: '项目主群聊',
        participants: ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: directConversationId,
        workspaceId,
        type: 'direct',
        title: '工程师 Agent 私聊',
        participants: ['user', 'engineer'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    messages: [
      {
        id: 'msg-seed-system',
        workspaceId,
        conversationId: groupConversationId,
        senderType: 'system',
        senderId: 'system',
        content: '本地版已进入最小可运行骨架阶段：工作区、会话、Agent、产物和真实 CLI 适配器会在同一页面串起来。',
        artifacts: [],
        createdAt: now,
      },
      {
        id: 'msg-seed-user',
        workspaceId,
        conversationId: groupConversationId,
        senderType: 'user',
        senderId: 'user',
        content: '请用主脑分派产品、工程和审查 Agent，先把 AgentHub 的本地 demo 主链路跑通。',
        artifacts: [],
        createdAt: now,
      },
      {
        id: 'msg-seed-agent',
        workspaceId,
        conversationId: groupConversationId,
        senderType: 'agent',
        senderId: 'orchestrator',
        content: 'Orchestrator 会先把需求整理为任务包，再按串行方式调用工程与审查 Agent。右侧产物面板会展示预览和运行摘要。',
        artifacts: [
          {
            id: artifactId,
            workspaceId,
            agentRunId: runId,
            type: 'web-preview',
            title: '本地预览占位页',
            content: '当前预览来自本地 runtime 工作区的 index.html。',
            url: `/preview/${workspaceId}/index.html`,
            createdByAgentId: 'orchestrator',
            createdAt: now,
          },
        ],
        createdAt: now,
      },
    ],
    agents: [
      createAgent({
        id: 'orchestrator',
        name: '项目协调 Agent',
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
        source: 'built-in',
      }),
      createAgent({
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
        source: 'built-in',
      }),
      createAgent({
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
        source: 'built-in',
      }),
      createAgent({
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
        source: 'built-in',
      }),
    ],
    agentSessions: [],
    agentSessionMessages: [],
    taskHandoffs: [],
    agentRuns: [
      {
        id: runId,
        workspaceId,
        conversationId: groupConversationId,
        agentId: 'orchestrator',
        inputContext: 'Seed run for local demo.',
        output: 'Seed preview artifact created.',
        status: 'success',
        provider: 'claude',
        logs: ['seed run created'],
        startedAt: now,
        finishedAt: now,
      },
    ],
    artifacts: [
      {
        id: artifactId,
        workspaceId,
        agentRunId: runId,
        type: 'web-preview',
        title: '本地预览占位页',
        content: '当前预览来自本地 runtime 工作区的 index.html。',
        url: `/preview/${workspaceId}/index.html`,
        createdByAgentId: 'orchestrator',
        createdAt: now,
      },
    ],
    changeSets: [],
    contextSnapshots: [],
    workflowEvents: [],
    diagnosticLogs: [],
  }
}
