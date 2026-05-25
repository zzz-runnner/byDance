import type { AgentDefinition, AppState, Artifact, Conversation, Message, Workspace } from '../types'

const now = new Date().toISOString()

/**
 * Creates a demo agent definition for the web fallback state.
 * Input: basic display and runtime fields.
 * Output: a complete AgentDefinition object.
 */
function createDemoAgent(input: Pick<AgentDefinition, 'id' | 'name' | 'role' | 'description' | 'modelProvider' | 'skills'>): AgentDefinition {
  return {
    ...input,
    whenToUse: input.description,
    systemPrompt: `You are ${input.name}.`,
    model: 'default',
    contextPolicy: {
      includeProjectBrief: true,
      includePinnedMessages: true,
      recentMessageLimit: 12,
      includeSameConversationOnly: false,
      includeArtifacts: true,
      includeFileSummaries: true,
      allowReadFilesOnDemand: true,
    },
    tools: ['readContext'],
    permissions: {
      fileRead: true,
      fileWrite: input.id === 'engineer',
      shell: input.id === 'engineer' || input.id === 'reviewer',
      webSearch: false,
      webFetch: false,
      deploy: false,
    },
    permissionMode: input.id === 'engineer' ? 'acceptEdits' : 'readonly',
    runtimePolicy: {
      workspaceOnly: true,
      allowNetwork: false,
      allowShell: input.id === 'engineer' || input.id === 'reviewer',
      maxRunSeconds: input.id === 'engineer' ? 600 : 180,
    },
    outputSchema: 'Return concise progress and actionable result.',
    isolation: input.id === 'engineer' ? 'worktree' : 'shared',
    source: 'built-in',
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Creates a demo workspace record for the web fallback state.
 * Input: workspace identity and display metadata.
 * Output: a Workspace object.
 */
function createDemoWorkspace(id: string, name: string, goal: string, type: Workspace['workspaceType']): Workspace {
  return {
    id,
    name,
    goal,
    workspaceType: type,
    rootPath: `data/workspaces/${id}/repo`,
    runtimeType: 'local',
    runtimeStatus: 'ready',
    projectBrief: goal,
    pinnedMessageIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Creates a demo conversation record for the web fallback state.
 * Input: workspace, conversation id, type, title, and participants.
 * Output: a Conversation object.
 */
function createDemoConversation(
  workspaceId: string,
  id: string,
  type: Conversation['type'],
  title: string,
  participants: string[],
): Conversation {
  return {
    id,
    workspaceId,
    type,
    title,
    participants,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Creates a demo message record for the web fallback state.
 * Input: message identity, sender, content, and optional artifacts.
 * Output: a Message object.
 */
function createDemoMessage(
  id: string,
  workspaceId: string,
  conversationId: string,
  senderType: Message['senderType'],
  senderId: string,
  content: string,
  artifacts: Artifact[] = [],
): Message {
  return {
    id,
    workspaceId,
    conversationId,
    senderType,
    senderId,
    content,
    artifacts,
    createdAt: now,
  }
}

/**
 * Creates the multi-workspace demo state used when the API is offline.
 * Input: none.
 * Output: a complete AppState for the first web demo.
 */
export function createDemoState(): AppState {
  const workspaces = [
    createDemoWorkspace('ws-demo-vote', '候选人投票小程序', '完成需求澄清、页面生成、Reviewer 验收和预览打包。', 'dev'),
    createDemoWorkspace('ws-demo-engineer-direct', '工程师单聊复查', '固定由工程师 Agent 检查当前产物结构和下一步实现风险。', 'chat'),
    createDemoWorkspace('ws-demo-landing', 'AI 产品官网重构', '让 Orchestrator 同时跟进设计、工程、审查三条链路。', 'dev'),
    createDemoWorkspace('ws-demo-docs', '技术文档整理', '沉淀比赛答辩用架构说明和 AI 协作记录。', 'writing'),
  ]

  const agents = [
    createDemoAgent({
      id: 'orchestrator',
      name: '项目协调 Agent',
      role: '拆解任务、调度子 Agent、综合产出',
      description: '适合群聊任务和跨 Agent 协作。',
      modelProvider: 'claude',
      skills: ['routing', 'handoff', 'synthesis'],
    }),
    createDemoAgent({
      id: 'product-manager',
      name: '产品经理 Agent',
      role: '澄清需求、验收标准、范围管理',
      description: '适合需求模糊或需要 PRD 的任务。',
      modelProvider: 'claude',
      skills: ['requirements', 'acceptance'],
    }),
    createDemoAgent({
      id: 'engineer',
      name: '工程师 Agent',
      role: '实现代码、生成 Diff、构建预览',
      description: '适合明确的实现、修复和构建任务。',
      modelProvider: 'codex',
      skills: ['typescript', 'diff', 'preview'],
    }),
    createDemoAgent({
      id: 'reviewer',
      name: '测试审查 Agent',
      role: '质量检查、风险发现、验收结论',
      description: '适合实现后的 PASS / PARTIAL / FAIL 审查。',
      modelProvider: 'claude',
      skills: ['review', 'testing'],
    }),
  ]

  const conversations = workspaces.flatMap(workspace => {
    if (workspace.workspaceType === 'chat') {
      return [
        createDemoConversation(workspace.id, `${workspace.id}-engineer`, 'direct', '工程师 Agent 单聊工作区', [
          'user',
          'engineer',
        ]),
      ]
    }

    return [
      createDemoConversation(workspace.id, `${workspace.id}-group`, 'group', '项目主群聊', [
        'user',
        'orchestrator',
        'product-manager',
        'engineer',
        'reviewer',
      ]),
      createDemoConversation(workspace.id, `${workspace.id}-engineer`, 'direct', '工程师 Agent 私聊', ['user', 'engineer']),
      createDemoConversation(workspace.id, `${workspace.id}-reviewer`, 'direct', 'Reviewer 验收私聊', ['user', 'reviewer']),
    ]
  })

  const previewArtifact: Artifact = {
    id: 'artifact-demo-preview',
    workspaceId: 'ws-demo-vote',
    type: 'web-preview',
    title: '投票小程序 Web 预览',
    content: 'Reviewer 正在检查页面主流程，预览卡可展开查看。',
    url: '/preview/ws-demo-vote/index.html',
    createdByAgentId: 'engineer',
    createdAt: now,
  }

  const zipArtifact: Artifact = {
    id: 'artifact-demo-zip',
    workspaceId: 'ws-demo-vote',
    type: 'zip',
    title: '候选人投票小程序源码包',
    content: '一键下载当前 workspace 代码和产物。',
    url: '/api/workspaces/ws-demo-vote/zip',
    createdByAgentId: 'orchestrator',
    createdAt: now,
  }

  return {
    workspaces,
    conversations,
    messages: [
      createDemoMessage(
        'msg-demo-user',
        'ws-demo-vote',
        'ws-demo-vote-group',
        'user',
        'user',
        '帮我做一个候选人投票小程序，先梳理需求，再让工程师实现并让 Reviewer 验收。',
      ),
      createDemoMessage(
        'msg-demo-orchestrator',
        'ws-demo-vote',
        'ws-demo-vote-group',
        'agent',
        'orchestrator',
        '我会按产品经理 -> 工程师 -> Reviewer 的顺序串行推进。当前已生成任务包，工程师正在准备可预览版本。',
        [previewArtifact, zipArtifact],
      ),
      createDemoMessage(
        'msg-demo-engineer',
        'ws-demo-engineer-direct',
        'ws-demo-engineer-direct-engineer',
        'agent',
        'engineer',
        '我会只基于这个单聊工作区检查实现风险：先看页面结构、再看状态流转，最后列出需要 Reviewer 复核的点。',
      ),
      createDemoMessage(
        'msg-demo-docs',
        'ws-demo-docs',
        'ws-demo-docs-group',
        'agent',
        'product-manager',
        '已把比赛要求拆成 IM 核心体验、多 Agent 调度、产物预览和交付材料四个验收维度。',
      ),
    ],
    agents,
    agentSessions: [],
    agentSessionMessages: [],
    taskHandoffs: [
      {
        id: 'handoff-demo-pm',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        sessionId: 'session-demo-pm',
        agentId: 'product-manager',
        source: 'main',
        task: '整理候选人投票小程序 MVP 范围和验收标准。',
        requiredContext: ['比赛要求', '用户原始需求'],
        expectedOutput: 'PRD、功能范围、验收清单',
        status: 'completed',
        resultSummary: '已确认 MVP 需要候选人列表、投票确认、结果展示和基础管理入口。',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'handoff-demo-engineer',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        sessionId: 'session-demo-engineer',
        agentId: 'engineer',
        source: 'main',
        task: '实现可预览的投票小程序页面并输出变更说明。',
        requiredContext: ['PRD', 'UI 风格约束', '本地 workspace'],
        expectedOutput: '代码变更、预览地址、测试说明',
        status: 'running',
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentRuns: [
      {
        id: 'run-demo-engineer',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        agentId: 'engineer',
        inputContext: '投票小程序实现任务',
        output: '正在生成页面和预览产物。',
        status: 'running',
        provider: 'codex',
        logs: ['npm run build', 'preview artifact pending'],
        startedAt: now,
      },
    ],
    artifacts: [previewArtifact, zipArtifact],
    changeSets: [],
    contextSnapshots: [],
    workflowEvents: [
      {
        id: 'event-demo-stage',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        createdAt: now,
        event: {
          type: 'task_stage_updated',
          workspaceId: 'ws-demo-vote',
          conversationId: 'ws-demo-vote-group',
          taskStage: 'execution',
          executionReadiness: 'execution_in_progress',
          needsUserConfirmation: false,
          reason: '用户已确认进入实现阶段，工程师 Agent 正在执行。',
        },
      },
    ],
    diagnosticLogs: [],
  }
}
