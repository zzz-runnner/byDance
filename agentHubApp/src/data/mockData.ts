import type { ComponentProps } from 'react'
import type { MaterialCommunityIcons } from '@expo/vector-icons'

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name']

export type Agent = {
  id: string
  name: string
  role: string
  provider: 'claude' | 'codex' | 'mock'
  status: 'idle' | 'running' | 'reviewing'
  color: string
  skills: string[]
}

export type Workspace = {
  id: string
  name: string
  goal: string
  kind: 'group' | 'direct'
  type: 'dev' | 'research' | 'writing' | 'chat'
  status: 'ready' | 'running' | 'failed'
  pinned: boolean
  archived: boolean
  agents: string[]
  runningAgents: number
  artifactCount: number
  messageCount: number
  latestEventLabel: string
  updatedAt: string
}

export type ProcessStep = {
  title: string
  summary: string
  status: 'done' | 'running' | 'waiting' | 'failed'
  icon: IconName
}

export type Artifact = {
  id: string
  type: 'preview' | 'diff' | 'review' | 'text'
  title: string
  summary: string
  metric: string
  icon: IconName
}

export type ChatMessage = {
  id: string
  sender: 'user' | 'agent'
  agentId?: string
  text: string
  time: string
  quote?: string
  process?: ProcessStep[]
  artifacts?: Artifact[]
}

export type CodeFile = {
  path: string
  language: string
  changed: 'added' | 'modified' | 'deleted' | 'clean'
  lines: number
}

export const agents: Agent[] = [
  {
    id: 'orchestrator',
    name: '协调 Agent',
    role: '理解需求、路由任务、汇总结果',
    provider: 'claude',
    status: 'running',
    color: '#7c3aed',
    skills: ['调度', '上下文', '总结'],
  },
  {
    id: 'product-manager',
    name: '产品经理',
    role: '澄清需求、拆任务、定义验收标准',
    provider: 'mock',
    status: 'idle',
    color: '#f59e0b',
    skills: ['需求', '优先级', '验收'],
  },
  {
    id: 'engineer',
    name: '工程师',
    role: '修改代码、生成 diff、整理预览摘要',
    provider: 'codex',
    status: 'running',
    color: '#2563eb',
    skills: ['代码', '文件', 'Diff'],
  },
  {
    id: 'reviewer',
    name: '审查员',
    role: '检查质量、风险、移动端适配',
    provider: 'codex',
    status: 'reviewing',
    color: '#10b981',
    skills: ['Review', '测试', '风险'],
  },
]

export const workspaces: Workspace[] = [
  {
    id: 'ws-campus',
    name: '校园 AI 助手 App',
    goal: '把课程、活动、咨询和任务提醒整合进一个多 Agent 助手',
    kind: 'group',
    type: 'dev',
    status: 'running',
    pinned: true,
    archived: false,
    agents: ['orchestrator', 'product-manager', 'engineer', 'reviewer'],
    runningAgents: 2,
    artifactCount: 8,
    messageCount: 42,
    latestEventLabel: '工程师正在调整 RN 首页布局',
    updatedAt: '09:41',
  },
  {
    id: 'ws-vote',
    name: '投票小程序',
    goal: '候选人投票、实时榜单、后台审核和一键发布',
    kind: 'group',
    type: 'dev',
    status: 'ready',
    pinned: false,
    archived: false,
    agents: ['orchestrator', 'engineer', 'reviewer'],
    runningAgents: 0,
    artifactCount: 5,
    messageCount: 31,
    latestEventLabel: '预览摘要已更新',
    updatedAt: '昨天',
  },
  {
    id: 'ws-review',
    name: 'Reviewer 单聊',
    goal: '只让审查员检查当前交付物的质量和风险',
    kind: 'direct',
    type: 'chat',
    status: 'ready',
    pinned: false,
    archived: false,
    agents: ['reviewer'],
    runningAgents: 0,
    artifactCount: 2,
    messageCount: 18,
    latestEventLabel: '无阻塞问题',
    updatedAt: '周一',
  },
]

export const processSteps: ProcessStep[] = [
  {
    title: '路由完成',
    summary: 'Orchestrator 判断需要产品、工程、审查串行协作。',
    status: 'done',
    icon: 'source-branch',
  },
  {
    title: '工程执行中',
    summary: '读取工作区文件，修改 RN 组件和 mock 数据。',
    status: 'running',
    icon: 'console-line',
  },
  {
    title: '等待审查',
    summary: 'diff 生成后交给 Reviewer 做移动端适配检查。',
    status: 'waiting',
    icon: 'shield-check-outline',
  },
]

export const artifacts: Artifact[] = [
  {
    id: 'art-preview',
    type: 'preview',
    title: '移动首页预览',
    summary: '半透明卡片叠在柔和彩色背景上，底部保留 AI 主入口。',
    metric: 'ready',
    icon: 'cellphone-screenshot',
  },
  {
    id: 'art-diff',
    type: 'diff',
    title: '代码变更',
    summary: 'App.tsx、mockData.ts、玻璃组件样式已生成。',
    metric: '+428 / -0',
    icon: 'file-code-outline',
  },
  {
    id: 'art-review',
    type: 'review',
    title: '审查结论',
    summary: '布局适合 iPhone 竖屏，代码查看入口降级为文件摘要。',
    metric: 'pass',
    icon: 'shield-check-outline',
  },
  {
    id: 'art-note',
    type: 'text',
    title: '实现摘要',
    summary: '移动端首版聚焦工作区、对话、过程、产物和 Agent 状态。',
    metric: 'summary',
    icon: 'text-box-outline',
  },
]

export const messages: ChatMessage[] = [
  {
    id: 'm1',
    sender: 'user',
    text: '@engineer 先把移动端 app 的主 UI 做出来，按 web 端功能做 mock。',
    time: '09:28',
  },
  {
    id: 'm2',
    sender: 'agent',
    agentId: 'orchestrator',
    text: '我先快速梳理目标：移动端要保留工作区、群聊、Agent 管理、代码/产物查看和交付状态，但交互要压缩到手机底部导航里。',
    time: '09:29',
    process: processSteps,
  },
  {
    id: 'm3',
    sender: 'agent',
    agentId: 'engineer',
    text: '可以。我会把复杂的 Monaco 和 iframe 能力先转成移动端摘要卡：文件树、diff、预览和 review 都能快速查看，版本、构建、部署保留在 Web 端。',
    time: '09:31',
    artifacts,
  },
]

export const codeFiles: CodeFile[] = [
  { path: 'src/App.tsx', language: 'tsx', changed: 'modified', lines: 248 },
  { path: 'src/data/mockData.ts', language: 'ts', changed: 'added', lines: 186 },
  { path: 'src/components/GlassCard.tsx', language: 'tsx', changed: 'added', lines: 54 },
  { path: 'assets/background/newBG.png', language: 'png', changed: 'clean', lines: 0 },
]
