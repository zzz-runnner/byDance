import type {
  AgentDefinition,
  AgentRun,
  AgentSession,
  AgentSessionMessage,
  AppState,
  Artifact,
  ChangeSet,
  ContextSnapshot,
  Conversation,
  DiagnosticLog,
  Message,
  TaskHandoff,
  Workspace,
  WorkflowEventRecord,
} from '../types'

const now = Date.now()

function iso(offsetMinutes: number): string {
  return new Date(now + offsetMinutes * 60_000).toISOString()
}

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
    createdAt: iso(-420),
    updatedAt: iso(-30),
  }
}

/**
 * Creates a demo workspace record for the web fallback state.
 * Input: workspace identity and display metadata.
 * Output: a Workspace object.
 */
function createDemoWorkspace(
  id: string,
  name: string,
  goal: string,
  type: Workspace['workspaceType'],
  updatedOffsetMinutes: number,
): Workspace {
  return {
    id,
    projectId: id.replace(/^ws-/, 'proj-'),
    name,
    goal,
    workspaceType: type,
    rootPath: `data/workspaces/${id}/repo`,
    runtimeType: 'local',
    runtimeStatus: 'ready',
    projectBrief: goal,
    pinnedMessageIds: [],
    createdAt: iso(-480),
    updatedAt: iso(updatedOffsetMinutes),
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
  updatedOffsetMinutes: number,
): Conversation {
  return {
    id,
    workspaceId,
    type,
    title,
    participants,
    createdAt: iso(-460),
    updatedAt: iso(updatedOffsetMinutes),
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
  offsetMinutes: number,
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
    createdAt: iso(offsetMinutes),
  }
}

function createArtifact(
  id: string,
  workspaceId: string,
  type: Artifact['type'],
  title: string,
  content: string,
  offsetMinutes: number,
  url?: string,
  metadata?: Record<string, unknown>,
  createdByAgentId?: string,
): Artifact {
  return {
    id,
    workspaceId,
    type,
    title,
    content,
    url,
    metadata,
    createdByAgentId,
    createdAt: iso(offsetMinutes),
  }
}

function createChangeSet(
  id: string,
  workspaceId: string,
  agentRunId: string,
  summary: string,
  offsetMinutes: number,
  patch: string,
): ChangeSet {
  return {
    id,
    workspaceId,
    agentRunId,
    baseCommit: 'c14c29f',
    summary,
    patch,
    createdAt: iso(offsetMinutes),
    files: [
      {
        path: 'src/pages/Vote/index.tsx',
        status: 'modified',
        additions: 82,
        deletions: 14,
      },
      {
        path: 'src/components/BallotCard.tsx',
        status: 'added',
        additions: 46,
        deletions: 0,
      },
      {
        path: 'src/styles/vote.css',
        status: 'modified',
        additions: 64,
        deletions: 11,
      },
    ],
  }
}

function createContextSnapshot(
  id: string,
  workspaceId: string,
  conversationId: string,
  summary: string,
  offsetMinutes: number,
  sourceRefs: string[],
): ContextSnapshot {
  return {
    id,
    workspaceId,
    conversationId,
    inputContext: 'MVP requirement summary, current repo structure, vote page interaction flow, and acceptance checklist.',
    summary,
    sourceRefs,
    tokenEstimate: 2380,
    createdAt: iso(offsetMinutes),
  }
}

function createDiagnosticLog(
  id: string,
  level: DiagnosticLog['level'],
  category: string,
  workspaceId: string,
  message: string,
  offsetMinutes: number,
  data?: Record<string, unknown>,
): DiagnosticLog {
  return {
    id,
    level,
    category,
    workspaceId,
    message,
    createdAt: iso(offsetMinutes),
    data,
  }
}

function createTaskHandoff(input: TaskHandoff): TaskHandoff {
  return input
}

function createWorkflowEventRecord(record: WorkflowEventRecord): WorkflowEventRecord {
  return record
}

function createAgentSession(input: AgentSession): AgentSession {
  return input
}

function createAgentSessionMessage(input: AgentSessionMessage): AgentSessionMessage {
  return input
}

/**
 * Creates the multi-workspace demo state used when the API is offline.
 * Input: none.
 * Output: a complete AppState for the first web demo.
 */
export function createDemoState(): AppState {
  const workspaces = [
    createDemoWorkspace(
      'ws-demo-vote',
      '候选人投票小程序',
      '完成需求澄清、页面实现、Reviewer 验收和预览打包。',
      'dev',
      -2,
    ),
    createDemoWorkspace(
      'ws-demo-engineer-direct',
      '工程师单聊复查',
      '固定由工程师 Agent 检查当前产物结构并定位下一步实现风险。',
      'chat',
      -7,
    ),
    createDemoWorkspace(
      'ws-demo-landing',
      'AI 产品官网重构',
      '让 Orchestrator 同时推进设计、工程、审查三条链路。',
      'dev',
      -18,
    ),
    createDemoWorkspace(
      'ws-demo-docs',
      '技术文档整理',
      '沉淀比赛答辩用架构说明和 AI 协作记录。',
      'writing',
      -34,
    ),
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
      role: '澄清需求、验收标准、范围控制',
      description: '适合需求模糊或需要 PRD 的任务。',
      modelProvider: 'claude',
      skills: ['requirements', 'acceptance'],
    }),
    createDemoAgent({
      id: 'engineer',
      name: '工程师 Agent',
      role: '实现代码、输出 diff、构建预览',
      description: '适合明确的实现、修复和构建任务。',
      modelProvider: 'codex',
      skills: ['typescript', 'diff', 'preview'],
    }),
    createDemoAgent({
      id: 'reviewer',
      name: '测试审查 Agent',
      role: '质量检查、风险发现、给出验收结论',
      description: '适合实现后的 PASS / PARTIAL / FAIL 审查。',
      modelProvider: 'claude',
      skills: ['review', 'testing'],
    }),
  ]

  const conversations = [
    createDemoConversation(
      'ws-demo-vote',
      'ws-demo-vote-group',
      'group',
      '项目主群聊',
      ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer'],
      -2,
    ),
    createDemoConversation(
      'ws-demo-vote',
      'ws-demo-vote-engineer',
      'direct',
      '工程师 Agent 私聊',
      ['user', 'engineer'],
      -6,
    ),
    createDemoConversation(
      'ws-demo-vote',
      'ws-demo-vote-reviewer',
      'direct',
      'Reviewer 验收私聊',
      ['user', 'reviewer'],
      -8,
    ),
    createDemoConversation(
      'ws-demo-engineer-direct',
      'ws-demo-engineer-direct-engineer',
      'direct',
      '工程师 Agent 单聊工作区',
      ['user', 'engineer'],
      -7,
    ),
    createDemoConversation(
      'ws-demo-landing',
      'ws-demo-landing-group',
      'group',
      '项目主群聊',
      ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer'],
      -18,
    ),
    createDemoConversation(
      'ws-demo-docs',
      'ws-demo-docs-group',
      'group',
      '项目主群聊',
      ['user', 'orchestrator', 'product-manager', 'engineer', 'reviewer'],
      -34,
    ),
  ]

  const previewArtifact = createArtifact(
    'artifact-demo-preview',
    'ws-demo-vote',
    'web-preview',
    '投票小程序 Web 预览',
    '工程师已经输出可点击预览，Reviewer 正在检查关键主流程。',
    -5,
    '/preview/ws-demo-vote/index.html',
    { viewport: 'mobile', route: '/vote' },
    'engineer',
  )

  const zipArtifact = createArtifact(
    'artifact-demo-zip',
    'ws-demo-vote',
    'zip',
    '候选人投票小程序源码包',
    '当前工作区的可交付代码包，包含页面、样式和说明文档。',
    -4,
    '/api/projects/proj-demo-vote/workspace.zip',
    { fileCount: 24, byteLength: 481920 },
    'orchestrator',
  )

  const diffArtifact = createArtifact(
    'artifact-demo-diff',
    'ws-demo-vote',
    'diff',
    '投票页结构调整 Diff',
    '新增候选人卡片、票数确认弹层和移动端底部操作条。',
    -6,
    undefined,
    { changeSetId: 'changeset-demo-vote' },
    'engineer',
  )

  const deployArtifact = createArtifact(
    'artifact-demo-deploy',
    'ws-demo-landing',
    'deploy-status',
    '官网测试环境部署状态',
    '测试环境已完成静态资源上传，等待 smoke test 结果。',
    -22,
    '/deploy/ws-demo-landing',
    { environment: 'staging', status: 'pending_smoke_test' },
    'orchestrator',
  )

  const notesArtifact = createArtifact(
    'artifact-demo-notes',
    'ws-demo-docs',
    'text',
    '答辩材料结构草稿',
    '沉淀了 IM 核心体验、多 Agent 调度、交付闭环三个章节。',
    -36,
    undefined,
    { sections: 3 },
    'product-manager',
  )

  const messages = [
    createDemoMessage(
      'msg-demo-user',
      'ws-demo-vote',
      'ws-demo-vote-group',
      'user',
      'user',
      '帮我做一个候选人投票小程序，先梳理需求，再让工程师实现，并让 Reviewer 验收。',
      -16,
    ),
    createDemoMessage(
      'msg-demo-orchestrator',
      'ws-demo-vote',
      'ws-demo-vote-group',
      'agent',
      'orchestrator',
      '我会按产品经理 -> 工程师 -> Reviewer 的顺序推进。当前任务包已经下发，工程师正在准备可预览版本。',
      -14,
      [previewArtifact, zipArtifact],
    ),
    createDemoMessage(
      'msg-demo-pm',
      'ws-demo-vote',
      'ws-demo-vote-group',
      'agent',
      'product-manager',
      'MVP 先覆盖候选人列表、投票确认、结果查看和管理员入口，不做复杂权限系统。',
      -11,
    ),
    createDemoMessage(
      'msg-demo-engineer',
      'ws-demo-vote',
      'ws-demo-vote-group',
      'agent',
      'engineer',
      '页面骨架已经完成，正在补投票确认弹层和列表状态联动。接下来会输出 diff 与预览。',
      -8,
      [diffArtifact],
    ),
    createDemoMessage(
      'msg-demo-engineer-direct',
      'ws-demo-engineer-direct',
      'ws-demo-engineer-direct-engineer',
      'agent',
      'engineer',
      '我会基于这个单聊工作区复查实现风险：先看状态流、再看组件边界，最后整理 Reviewer 需要重点关注的点。',
      -9,
    ),
    createDemoMessage(
      'msg-demo-landing',
      'ws-demo-landing',
      'ws-demo-landing-group',
      'agent',
      'orchestrator',
      '官网重构已切成三条并行链路：信息架构、视觉探索、落地代码验证。当前正在等待测试环境回归。',
      -21,
      [deployArtifact],
    ),
    createDemoMessage(
      'msg-demo-docs',
      'ws-demo-docs',
      'ws-demo-docs-group',
      'agent',
      'product-manager',
      '已经把答辩材料拆成“问题背景、Agent 协作流程、交付与验证”三部分，后面补现场演示脚本。',
      -35,
      [notesArtifact],
    ),
  ]

  const taskHandoffs = [
    createTaskHandoff({
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
      resultSummary: '确认 MVP 覆盖候选人列表、投票确认、结果查看和管理员入口。',
      createdAt: iso(-15),
      updatedAt: iso(-13),
    }),
    createTaskHandoff({
      id: 'handoff-demo-engineer',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      sessionId: 'session-demo-engineer',
      agentId: 'engineer',
      source: 'main',
      task: '实现可预览的投票小程序页面，并输出变更说明。',
      requiredContext: ['PRD', 'UI 风格约束', '当前 workspace'],
      expectedOutput: '代码变更、预览地址、测试说明',
      status: 'running',
      createdAt: iso(-12),
      updatedAt: iso(-4),
    }),
    createTaskHandoff({
      id: 'handoff-demo-reviewer',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      sessionId: 'session-demo-reviewer',
      agentId: 'reviewer',
      source: 'main',
      task: '对预览流程进行功能验收，输出 PASS / PARTIAL / FAIL 结论。',
      requiredContext: ['预览链接', '验收清单', '变更摘要'],
      expectedOutput: '验收结论、风险说明、建议动作',
      status: 'pending',
      createdAt: iso(-3),
      updatedAt: iso(-3),
    }),
  ]

  const agentRuns: AgentRun[] = [
    {
      id: 'run-demo-engineer',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      agentId: 'engineer',
      sessionId: 'session-demo-engineer',
      handoffId: 'handoff-demo-engineer',
      inputContext: '投票小程序实现任务，要求移动端优先，并保留管理员入口。',
      output: '正在生成页面、预览和变更说明。',
      status: 'running',
      provider: 'codex',
      logs: ['npm run build', 'preview artifact pending', 'review checklist prepared'],
      startedAt: iso(-9),
    },
    {
      id: 'run-demo-landing-review',
      workspaceId: 'ws-demo-landing',
      conversationId: 'ws-demo-landing-group',
      agentId: 'reviewer',
      inputContext: '官网测试环境 smoke test 和转化路径检查。',
      output: '发现首屏 CTA 与 pricing section 的移动端间距仍需调整。',
      status: 'partial',
      provider: 'claude',
      logs: ['preview opened', 'hero spacing issue noted'],
      startedAt: iso(-28),
      finishedAt: iso(-20),
    },
  ]

  const changeSets = [
    createChangeSet(
      'changeset-demo-vote',
      'ws-demo-vote',
      'run-demo-engineer',
      '新增候选人卡片和投票确认流，补齐移动端底部操作条。',
      -6,
      [
        'diff --git a/src/pages/Vote/index.tsx b/src/pages/Vote/index.tsx',
        '+ const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)',
        '+ <VoteConfirmSheet candidateId={selectedCandidate} onClose={resetSelection} />',
        'diff --git a/src/components/BallotCard.tsx b/src/components/BallotCard.tsx',
        '+ export function BallotCard() { /* ... */ }',
      ].join('\n'),
    ),
  ]

  const contextSnapshots = [
    createContextSnapshot(
      'snapshot-demo-vote',
      'ws-demo-vote',
      'ws-demo-vote-group',
      '当前上下文已经稳定，工程师可以直接进入页面实现与联调阶段。',
      -10,
      ['PRD v0.2', 'vote-flow.png', 'acceptance-checklist.md'],
    ),
    createContextSnapshot(
      'snapshot-demo-docs',
      'ws-demo-docs',
      'ws-demo-docs-group',
      '文档工作区以比赛答辩材料为主，重点突出 Agent 协作闭环和交付可验证性。',
      -38,
      ['brief.md', 'judging-rubric.md'],
    ),
  ]

  const workflowEvents = [
    createWorkflowEventRecord({
      id: 'event-demo-turn-started',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      createdAt: iso(-16),
      event: {
        type: 'turn_started',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        content: '帮我做一个候选人投票小程序。',
      },
    }),
    createWorkflowEventRecord({
      id: 'event-demo-stage',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      createdAt: iso(-12),
      event: {
        type: 'task_stage_updated',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        taskStage: 'execution',
        executionReadiness: 'execution_in_progress',
        needsUserConfirmation: false,
        reason: '用户已确认 MVP，工程师开始执行页面实现与预览构建。',
      },
    }),
    createWorkflowEventRecord({
      id: 'event-demo-dispatch',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      createdAt: iso(-11),
      event: {
        type: 'agent_task_dispatched',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        handoffId: 'handoff-demo-engineer',
        sessionId: 'session-demo-engineer',
        agentId: 'engineer',
        agentName: '工程师 Agent',
        source: 'main',
        task: '实现投票列表、投票确认弹层和结果反馈。',
        expectedOutput: '页面代码、预览链接、变更摘要',
        requiredContext: ['PRD', '移动端优先', '当前 repo 结构'],
      },
    }),
    createWorkflowEventRecord({
      id: 'event-demo-progress',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      createdAt: iso(-8),
      event: {
        type: 'agent_progress',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        runId: 'run-demo-engineer',
        agentId: 'engineer',
        agentName: '工程师 Agent',
        message: '列表交互完成，正在串联确认弹层和票数反馈。',
      },
    }),
    createWorkflowEventRecord({
      id: 'event-demo-preview',
      workspaceId: 'ws-demo-vote',
      conversationId: 'ws-demo-vote-group',
      createdAt: iso(-5),
      event: {
        type: 'preview_ready',
        workspaceId: 'ws-demo-vote',
        conversationId: 'ws-demo-vote-group',
        artifactId: 'artifact-demo-preview',
        previewUrl: '/preview/ws-demo-vote/index.html',
        runId: 'run-demo-engineer',
        agentId: 'engineer',
      },
    }),
    createWorkflowEventRecord({
      id: 'event-demo-review-verdict',
      workspaceId: 'ws-demo-landing',
      conversationId: 'ws-demo-landing-group',
      createdAt: iso(-20),
      event: {
        type: 'review_verdict',
        workspaceId: 'ws-demo-landing',
        conversationId: 'ws-demo-landing-group',
        runId: 'run-demo-landing-review',
        agentId: 'reviewer',
        verdict: 'partial',
        summary: '首屏 CTA 已清晰，但 pricing section 的移动端节奏仍然偏紧。',
        issues: ['Pricing section 顶部留白不足', '移动端 CTA 与 testimonials 视觉层级偏近'],
      },
    }),
    createWorkflowEventRecord({
      id: 'event-demo-docs-finished',
      workspaceId: 'ws-demo-docs',
      conversationId: 'ws-demo-docs-group',
      createdAt: iso(-34),
      event: {
        type: 'workflow_finished',
        workspaceId: 'ws-demo-docs',
        conversationId: 'ws-demo-docs-group',
        summary: '文档结构已稳定，可以进入润色和答辩脚本补全。',
      },
    }),
  ]

  const agentSessions = [
    createAgentSession({
      id: 'session-demo-engineer',
      workspaceId: 'ws-demo-vote',
      agentId: 'engineer',
      title: '投票小程序实现会话',
      status: 'active',
      lastHandoffId: 'handoff-demo-engineer',
      createdAt: iso(-12),
      updatedAt: iso(-4),
    }),
    createAgentSession({
      id: 'session-demo-reviewer',
      workspaceId: 'ws-demo-landing',
      agentId: 'reviewer',
      title: '官网测试环境验收',
      status: 'archived',
      lastHandoffId: 'handoff-demo-reviewer-landing',
      createdAt: iso(-31),
      updatedAt: iso(-20),
    }),
  ]

  const agentSessionMessages = [
    createAgentSessionMessage({
      id: 'session-message-demo-engineer-1',
      workspaceId: 'ws-demo-vote',
      sessionId: 'session-demo-engineer',
      agentId: 'engineer',
      senderType: 'system',
      senderId: 'system',
      kind: 'task_handoff',
      content: '任务重点：移动端优先、票数操作清晰、保留管理员入口。',
      createdAt: iso(-12),
    }),
    createAgentSessionMessage({
      id: 'session-message-demo-engineer-2',
      workspaceId: 'ws-demo-vote',
      sessionId: 'session-demo-engineer',
      agentId: 'engineer',
      senderType: 'agent',
      senderId: 'engineer',
      kind: 'agent_reply',
      content: '已确认页面结构，先搭列表和确认弹层，再补结果页过渡。',
      createdAt: iso(-9),
    }),
  ]

  const diagnosticLogs = [
    createDiagnosticLog(
      'log-demo-vote-1',
      'info',
      'preview',
      'ws-demo-vote',
      'Preview build completed, waiting for reviewer handoff.',
      -5,
      { artifactId: 'artifact-demo-preview' },
    ),
    createDiagnosticLog(
      'log-demo-vote-2',
      'warn',
      'ux',
      'ws-demo-vote',
      'Vote confirm sheet exceeds 2 lines on 360px width, should tighten copy.',
      -4,
      { width: 360 },
    ),
    createDiagnosticLog(
      'log-demo-landing-1',
      'error',
      'review',
      'ws-demo-landing',
      'Pricing section failed one spacing assertion on mobile breakpoint.',
      -20,
      { breakpoint: '390x844', selector: '.pricing-grid' },
    ),
  ]

  return {
    workspaces,
    conversations,
    messages,
    agents,
    agentSessions,
    agentSessionMessages,
    taskHandoffs,
    agentRuns,
    artifacts: [previewArtifact, zipArtifact, diffArtifact, deployArtifact, notesArtifact],
    changeSets,
    contextSnapshots,
    workflowEvents,
    diagnosticLogs,
  }
}
