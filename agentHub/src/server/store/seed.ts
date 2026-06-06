import type { AppState } from '@shared/contracts'
import { isoNow } from '@shared/contracts'
import {
  createDefaultWorkspaceAgentMembers,
  createDirectAgentInstance,
  createGroupAgentInstances,
} from '../agents/workspace-agents'

/**
 * Builds the local demo state used before a PostgreSQL row exists.
 * Input: none. Output: initial application state for the local prototype.
 */
export function createSeedState(): AppState {
  const now = isoNow()
  const workspaceId = 'ws-local-demo'
  const directWorkspaceId = 'ws-local-direct-demo'
  const groupConversationId = 'conv-local-group'
  const directConversationId = 'conv-codex-direct'
  const runId = 'run-seed-engineer'
  const artifactId = 'artifact-seed-preview'
  const groupAgents = createGroupAgentInstances(workspaceId, groupConversationId, now)
  const directAgent = createDirectAgentInstance('codex-direct', directWorkspaceId, directConversationId, now)

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
          '第一版只做 dev 工作区，采用 IM 聊天入口，由主脑调度 Claude Code 与 Codex 子 Agent。',
        pinnedMessageIds: ['msg-seed-system'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: directWorkspaceId,
        name: 'AgentHub Codex Direct Demo',
        goal: 'Talk directly with Codex in a single-agent workspace.',
        workspaceType: 'chat',
        rootPath: 'data/workspaces/ws-local-direct-demo/repo',
        runtimeType: 'local',
        runtimeStatus: 'ready',
        projectBrief: 'A single-chat demo workspace bound to Codex Agent only.',
        pinnedMessageIds: [],
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
        workspaceId: directWorkspaceId,
        type: 'direct',
        title: 'Codex Agent 私聊',
        participants: ['user', 'codex-direct'],
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
        content:
          '本地版已进入最小可运行骨架阶段：工作区、会话、Agent、产物和真实 CLI 适配器会在同一页面串起来。',
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
        content:
          '主脑会先把需求整理为任务包，再按串行方式调用工程与审查 Agent。右侧产物面板会展示预览和运行摘要。',
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
    agents: [...groupAgents, directAgent],
    workspaceAgentMembers: [
      ...createDefaultWorkspaceAgentMembers(groupAgents, workspaceId, now),
      {
        workspaceId: directWorkspaceId,
        agentId: 'codex-direct',
        displayName: directAgent.name,
        modelProviderOverride: directAgent.modelProvider,
        modelOverride: directAgent.model,
        sortOrder: 5,
        locked: true,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
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
