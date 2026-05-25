# AgentHub 架构设计文档

## 1. 项目定位

AgentHub 是一个多 Agent 协作平台，核心形态是“项目工作区 + IM 聊天式协作”。

平台面向希望通过对话生成网页、Workflow、文档、代码等产物的用户。用户不需要理解底层模型或 Agent 平台差异，只需要在一个项目工作区中，通过群聊或私聊的方式让多个 Agent 协作完成任务。

一句话定义：

> AgentHub 以工作区作为项目上下文容器，以群聊和私聊作为交互入口，以 Orchestrator 调度多个子 Agent，以产物卡片承接最终交付结果。

## 2. 产品形态

### 2.1 工作区

一个工作区对应一个项目。

工作区不是只有开发项目一种形态，还可以根据业务分成不同类型。

工作区中保存：

- 项目目标
- 项目上下文
- 群聊会话
- Agent 私聊会话
- Agent 成员
- 文件和代码仓库
- 任务运行记录
- 产物和预览卡片

结构示意：

```text
工作区 / Project Workspace
├── 项目主群聊
├── Agent 私聊会话
├── 项目上下文
├── 文件 / 代码仓库
├── Agent 成员
├── 任务记录
└── 产物预览
```

### 2.1.1 工作区类型

建议把工作区类型做成统一模型，而不是拆成多套系统。

```ts
type WorkspaceType = 'dev' | 'research' | 'writing' | 'chat'
```

不同类型只是在默认配置上不同：

| 类型 | 面向场景 | 默认 Agent | 默认工具 | 主要产物 |
|---|---|---|---|---|
| `dev` | 开发者 / 产品原型 / Web 应用 | 产品、工程、审查 | 文件、shell、构建、预览 | Diff、代码、预览、zip |
| `research` | 论文检索 / 信息搜集 / 对比分析 | 检索、总结、审稿 | WebSearch、WebFetch、引用整理 | 文献卡、摘要、引用表 |
| `writing` | 写作 / 文档 / 报告 | 大纲、写手、编辑 | 文档编辑、检索、引用 | 草稿、修订稿、章节结构 |
| `chat` | 闲聊 / 轻量助手 / 记忆型对话 | 通用助手 | 少量工具或无工具 | 对话记录、便签、轻量记忆 |

每种工作区本质上还是同一个容器，只是 `template`、Agent 默认组合、工具边界和 UI 面板不同。

### 2.2 群聊

群聊是项目主协作现场。

用户可以在群聊中：

- 描述项目目标
- 发起任务
- @ 一个或多个 Agent
- 查看多个 Agent 的协作过程
- 接收 Orchestrator 的汇总结果
- 预览 Agent 产出的代码、页面、Diff、文件和部署状态

群聊不是普通聊天记录，而是项目主上下文的重要来源。

### 2.3 私聊

私聊是用户与单个 Agent 的独立会话。

典型场景：

- 单独问产品经理 Agent 澄清需求
- 单独让设计师 Agent 调整页面风格
- 单独让工程师 Agent 修改一个功能
- 单独让测试审查 Agent 验收某个产物

私聊结果仍然属于同一个工作区，会回写到工作区上下文、任务记录和产物列表中。

### 2.4 共享上下文原则

同一个工作区内，群聊和私聊共享项目级上下文。

也就是说：

- 群聊中确认的项目目标，私聊 Agent 时仍然可见
- 私聊中完成的产物，可以回到群聊中展示
- pinned 关键消息和项目摘要对所有会话生效
- 不同工作区之间上下文隔离

## 3. 总体架构

```text
Frontend Web
├── Workspace UI
├── Chat UI
├── Agent Member UI
├── Artifact Preview UI
└── Task Status UI

Backend
├── Workspace Service
├── Conversation Service
├── Message Service
├── Agent Registry
├── Orchestrator Agent
├── Context Builder
├── Tool Gateway
├── Agent Runner
├── Artifact Parser
├── Adapter Layer
└── Workspace Runtime Service

External / Runtime
├── Cloud Workspace Runtime
├── Claude Code Adapter
├── Codex Adapter
├── OpenClaw Adapter
├── Mock Agent Adapter
├── Web Search / Web Fetch Tool
├── File System / Git Worktree
├── Zip Export Service
└── Preview / Deploy Service
```

### 3.1 Web 与 Runtime 边界

AgentHub 的主链路采用云端 Workspace Runtime，不依赖用户本地安装 Claude Code、Codex 或 OpenClaw。

原因是纯 Web 浏览器不能默认操作用户本地文件夹，也不能直接启动本地 shell、git、Claude Code CLI 等本地进程。浏览器可以在用户主动授权后通过 File System Access API 访问部分本地文件，但这不适合作为 MVP 主链路。

因此，推荐架构是：

```text
Web 前端
  负责聊天、预览、展示 Diff、下载产物、连接账号

云端后端
  负责创建项目目录、运行 Agent、读写文件、执行命令、构建预览

Workspace Runtime
  每个工作区对应一个隔离项目环境
```

### 3.2 工作区项目来源

用户创建工作区时，项目可以来自三种来源：

| 来源 | 是否需要 GitHub | 说明 | MVP 优先级 |
|---|---:|---|---|
| 云端模板项目 | 否 | 平台生成 Vite / React / Next 等模板 | 必做 |
| 上传 zip | 否 | 用户上传本地项目压缩包，后端解压 | 可选 |
| 导入 GitHub | 是 | 用户授权 GitHub 后 clone 仓库 | 可选增强 |

默认情况下，不要求用户必须有 GitHub 账号。

平台应该先提供自己的 Workspace Storage。GitHub 作为可选导入和导出渠道，而不是登录前置条件。

### 3.3 云端存储结构

推荐每个用户、每个工作区在云端拥有独立项目目录。

```text
/workspaces
  /{userId}
    /{workspaceId}
      /repo
      /artifacts
      /logs
      /preview
```

其中：

- `repo` 保存项目源码，可初始化为 git 仓库
- `artifacts` 保存产物、Diff、附件、构建结果
- `logs` 保存 Agent 调用日志和命令输出
- `preview` 保存可预览的静态产物或预览服务配置

### 3.4 交付方式

AgentHub 最终可以向用户返回多种交付结果：

| 交付方式 | MVP 是否推荐 | 说明 |
|---|---:|---|
| 在线预览 URL | 是 | 最有产品感，适合 Demo |
| 源码 zip 包 | 是 | 不依赖 GitHub，最稳 |
| GitHub 仓库地址 | 可选 | 需要用户 OAuth 授权 |
| Diff / 文件列表 | 是 | 聊天流中展示过程产物 |
| 部署链接 | 可选 | 后续可接 Vercel / Netlify / 自建静态服务 |

推荐主流程：

```text
用户创建工作区
-> 后端创建云端项目目录
-> 从模板 / GitHub / zip 初始化项目
-> Agent 在云端 Runtime 中修改代码
-> 后端生成 Diff 和预览
-> 用户确认
-> 后端打包 zip
-> 可选推送到 GitHub
```

## 4. 核心模块

### 4.1 Workspace Service

负责工作区的创建、读取、更新和删除。

核心职责：

- 创建项目工作区
- 保存项目目标
- 维护项目摘要
- 绑定本地或远程代码仓库路径
- 管理 pinned 消息

### 4.2 Conversation Service

负责群聊和私聊会话。

核心职责：

- 创建群聊会话
- 创建 Agent 私聊会话
- 维护会话参与者
- 按工作区归档会话
- 支持会话搜索、置顶、归档

### 4.3 Message Service

负责消息流。

核心职责：

- 保存用户消息
- 保存 Agent 回复
- 保存系统消息
- 关联消息中的产物卡片
- 支持引用、回复、重新生成、pin

### 4.4 Agent Registry

负责注册和管理所有子 Agent。

每个 Agent 都必须按统一标准定义，不能只写一个 prompt。

Agent Registry 负责：

- 读取内置 Agent
- 读取用户自建 Agent
- 校验 Agent 定义
- 向 Orchestrator 提供可用 Agent 列表
- 管理 Agent 能力标签和工具权限

### 4.5 Orchestrator Agent

Orchestrator 是主 Agent，也是整个多 Agent 协作的调度中心。

它的职责不是亲自完成所有任务，而是：

- 理解用户意图
- 判断当前是群聊任务还是私聊任务
- 选择要调用哪些子 Agent
- 判断串行还是并行执行
- 为每个子 Agent 生成任务上下文包
- 调用 Agent Runner
- 汇总子 Agent 结果
- 写回工作区上下文
- 生成聊天流中的最终回复
- 触发产物卡片生成

### 4.6 Context Builder

负责给 Agent 组装上下文。

它解决的问题是：群聊历史会越来越长，不能全部塞给子 Agent。

Context Builder 根据 Agent 的 `contextPolicy` 生成当前任务所需的上下文包。

上下文包包含：

- 项目目标
- 项目摘要
- pinned 关键消息
- 当前用户请求
- 当前任务摘要
- 最近相关消息
- 相关文件摘要
- 相关产物摘要
- 期望输出格式

### 4.7 Tool Gateway

负责管理工具和权限。

Agent 不能直接访问所有工具，必须经过 Tool Gateway。

工具类型包括：

- 文件读取
- 文件写入
- 运行命令
- 搜索网页
- 抓取网页
- 生成 Diff
- 应用 Diff
- 生成预览
- 部署发布

Tool Gateway 根据 AgentDefinition 中的权限配置决定是否允许调用。

### 4.8 Agent Runner

负责真正执行 Agent。

Agent Runner 不关心业务角色，只负责按统一接口调用不同底层能力。

支持：

- Claude Code Adapter
- Codex Adapter
- Mock Agent Adapter
- 后续扩展 OpenCode Adapter

### 4.9 Artifact Parser

负责把 Agent 输出解析成可展示产物。

支持产物类型：

- 文本说明
- 代码块
- Diff 卡片
- 文件附件
- 网页预览卡片
- 部署状态卡片
- 任务状态卡片

代码变更也应该被解析成单独的产物和事件流。

建议在每个 AgentRun 开始时记录一个 `baseCommit`，结束时用 `git diff` 生成 `ChangeSet`：

```text
AgentRun 开始
  ↓
记录 baseCommit
  ↓
Agent 修改文件
  ↓
生成文件列表、行数统计、patch、摘要
  ↓
Artifact Parser 产出 Diff 卡片
  ↓
通过 SSE / WebSocket 推送到 Web 前端
```

这样前端可以实时看到：

- 哪个 Agent 改了哪些文件
- 每个文件增加了多少行、删除了多少行
- 完整 diff 内容
- 当前任务是否已经产出可预览版本

### 4.10 Workspace Runtime Service

负责为每个工作区提供云端执行环境。

核心职责：

- 为工作区创建隔离项目目录
- 从模板初始化项目
- clone GitHub 仓库或解压用户上传 zip
- 初始化本地 git 仓库
- 记录每个 AgentRun 的 baseCommit 和变更范围
- 为 AgentRun 提供工作目录
- 支持 git worktree 隔离
- 执行构建、测试、预览命令
- 生成在线预览 URL
- 打包源码 zip
- 在用户授权后推送到 GitHub

Runtime 不直接暴露给用户，用户通过 Web 聊天界面间接使用。

### 4.11 Local Connector 后续增强

如果用户希望 Agent 操作自己电脑上的真实项目，可以在后续版本提供 Local Connector。

Local Connector 可以是：

- 桌面客户端
- VS Code 插件
- 本地命令行守护进程

它负责：

- 让用户选择本地项目目录
- 在本地启动 Claude Code / Codex / OpenClaw
- 暴露 localhost HTTP 或 WebSocket 接口
- 将本地文件变更和日志同步给 AgentHub Web

MVP 不依赖 Local Connector。主链路优先采用云端 Runtime。

## 5. 主 Agent 架构

主 Agent 可以学习 Claude Code 的主循环和 AgentTool 调度范式。

Claude Code 的主 Agent 本质上是：

```text
主循环 + 工具系统 + 上下文管理器 + 调度器
```

AgentHub 中对应为 Orchestrator Agent。

### 5.1 主 Agent 执行流程

```text
用户消息
  ↓
Orchestrator Agent
  ↓
Intent Parser
  ↓
Routing Policy
  ↓
Context Builder
  ↓
Agent Runner
  ↓
Artifact Parser
  ↓
Workspace Memory Updater
  ↓
Final Response
```

### 5.2 主 Agent 可用工具

```ts
type OrchestratorAgent = {
  id: 'orchestrator'
  name: '项目协调 Agent'
  role: '负责理解用户请求、调度子 Agent、汇总结果'
  tools: [
    'callAgent',
    'searchWorkspaceContext',
    'updateProjectBrief',
    'createArtifact',
    'pinMessage'
  ]
}
```

### 5.3 调度决策结构

```ts
type RoutingDecision = {
  mode: 'answer_directly' | 'single_agent' | 'multi_agent'
  targetAgents: string[]
  execution: 'serial' | 'parallel'
  taskBriefs: {
    agentId: string
    task: string
    requiredContext: string[]
    expectedOutput: string
  }[]
}
```

示例：

```json
{
  "mode": "multi_agent",
  "targetAgents": ["product-manager", "designer", "engineer", "reviewer"],
  "execution": "serial",
  "taskBriefs": [
    {
      "agentId": "product-manager",
      "task": "澄清并整理活动页需求，输出功能清单和验收标准",
      "requiredContext": ["projectBrief", "userMessage"],
      "expectedOutput": "需求列表和验收标准"
    },
    {
      "agentId": "designer",
      "task": "根据需求输出页面结构、视觉风格和交互说明",
      "requiredContext": ["projectBrief", "productRequirement"],
      "expectedOutput": "页面结构和设计说明"
    },
    {
      "agentId": "engineer",
      "task": "根据需求和设计实现活动页，并返回预览产物",
      "requiredContext": ["projectBrief", "designSpec", "fileSummary"],
      "expectedOutput": "代码变更和预览卡片"
    },
    {
      "agentId": "reviewer",
      "task": "检查页面实现质量、移动端适配和明显问题",
      "requiredContext": ["originalTask", "changedFiles", "previewArtifact"],
      "expectedOutput": "验收结论和问题列表"
    }
  ]
}
```

## 6. 子 Agent 标准定义规范

子 Agent 不是简单 prompt，而是标准化能力单元。

每个子 Agent 都由以下部分组成：

- 身份信息
- 使用时机
- 系统 Prompt
- 模型或底层平台
- 上下文策略
- 工具列表
- 权限边界
- 输出格式
- 执行隔离策略

### 6.1 AgentDefinition

```ts
type AgentDefinition = {
  id: string
  name: string
  role: string
  description: string
  whenToUse: string

  systemPrompt: string

  modelProvider: 'claude' | 'codex' | 'mock'
  model?: string

  contextPolicy: {
    includeProjectBrief: boolean
    includePinnedMessages: boolean
    recentMessageLimit: number
    includeSameConversationOnly: boolean
    includeArtifacts: boolean
    includeFileSummaries: boolean
    allowReadFilesOnDemand: boolean
  }

  tools: string[]

  permissions: {
    fileRead: boolean
    fileWrite: boolean
    shell: boolean
    webSearch: boolean
    webFetch: boolean
    deploy: boolean
  }

  disallowedTools?: string[]
  permissionMode?: 'readonly' | 'ask' | 'acceptEdits' | 'dangerous'

  runtimePolicy?: {
    workspaceOnly: boolean
    allowNetwork: boolean
    allowShell: boolean
    maxRunSeconds: number
  }

  outputSchema: string
  isolation: 'shared' | 'worktree'
}
```

### 6.2 推荐基础 Agent

第一版建议内置 5 个 Agent：

```text
product-manager
designer
engineer
reviewer
publisher
```

### 6.3 产品经理 Agent

职责：

- 澄清用户需求
- 拆解任务
- 定义功能范围
- 生成验收标准
- 维护项目目标和约束

适合场景：

- 用户需求模糊
- 需要拆功能
- 需要确定优先级
- 需要生成产品方案

建议权限：

- 可读取项目上下文
- 可使用 WebSearch / WebFetch
- 不允许写代码
- 不允许部署

### 6.4 设计师 Agent

职责：

- 页面结构设计
- 交互设计
- 视觉风格建议
- 生成设计说明
- 优化用户体验

适合场景：

- 创建网页、活动页、工具界面
- 调整视觉风格
- 优化布局和交互

建议权限：

- 可读取需求和已有产物
- 可使用 WebSearch / WebFetch 查参考
- 默认不直接写文件

### 6.5 工程师 Agent

职责：

- 写代码
- 修改文件
- 生成 Diff
- 实现网页或 Workflow
- 返回可预览产物

适合场景：

- 用户要求实现功能
- 修改页面
- 修复 bug
- 生成代码产物

建议权限：

- 可读文件
- 可写文件
- 可运行必要命令
- 可使用 worktree 隔离

示例定义：

```ts
const engineerAgent: AgentDefinition = {
  id: 'engineer',
  name: '工程师 Agent',
  role: '负责实现代码和生成可预览产物',
  description: '根据需求实现页面、组件、接口或 Workflow',
  whenToUse: '当用户要求实现、修改、生成代码、修复 bug 时调用',
  systemPrompt: '你是工程师 Agent，负责根据任务上下文完成代码实现，并输出修改说明、文件列表和可预览产物。',
  modelProvider: 'codex',
  contextPolicy: {
    includeProjectBrief: true,
    includePinnedMessages: true,
    recentMessageLimit: 20,
    includeSameConversationOnly: false,
    includeArtifacts: true,
    includeFileSummaries: true,
    allowReadFilesOnDemand: true
  },
  tools: ['readFile', 'writeFile', 'applyDiff', 'runCommand'],
  permissions: {
    fileRead: true,
    fileWrite: true,
    shell: true,
    webSearch: false,
    webFetch: true,
    deploy: false
  },
  outputSchema: '返回实现说明、修改文件列表、Diff 或代码片段、预览产物信息。',
  isolation: 'worktree'
}
```

### 6.6 测试审查 Agent

职责：

- 检查代码质量
- 运行测试
- 发现体验问题
- 验证边界情况
- 输出 PASS / FAIL / PARTIAL

适合场景：

- 功能完成后验收
- 检查移动端适配
- 查找明显 bug
- 评估产物是否满足需求

建议权限：

- 可读文件
- 可运行测试命令
- 默认不可写项目文件

示例定义：

```ts
const reviewerAgent: AgentDefinition = {
  id: 'reviewer',
  name: '测试审查 Agent',
  role: '负责检查质量、发现问题、提出修改建议',
  description: '对实现结果进行测试、审查和验收',
  whenToUse: '当代码完成后、用户要求检查、测试、验收时调用',
  systemPrompt: '你是测试审查 Agent，负责基于原始需求和实现结果进行验证，必须给出明确结论。',
  modelProvider: 'claude',
  contextPolicy: {
    includeProjectBrief: true,
    includePinnedMessages: true,
    recentMessageLimit: 10,
    includeSameConversationOnly: false,
    includeArtifacts: true,
    includeFileSummaries: true,
    allowReadFilesOnDemand: true
  },
  tools: ['readFile', 'runCommand'],
  permissions: {
    fileRead: true,
    fileWrite: false,
    shell: true,
    webSearch: false,
    webFetch: false,
    deploy: false
  },
  outputSchema: '返回检查项、发现的问题、严重级别、建议修复方式、PASS/FAIL/PARTIAL 结论。',
  isolation: 'shared'
}
```

### 6.7 发布助手 Agent

职责：

- 构建项目
- 生成预览链接
- 生成部署状态卡片
- 打包源码
- 生成演示说明

适合场景：

- 用户说“部署”
- 准备演示
- 准备交付版本

建议权限：

- 可运行构建命令
- 可调用部署工具
- 可生成部署状态卡片

## 7. 上下文策略

### 7.1 为什么不能全部塞给子 Agent

群聊是项目主上下文来源，但群聊历史会越来越长。

如果每次都把完整群聊记录、所有私聊记录、所有文件内容都塞给子 Agent，会导致：

- 上下文窗口爆炸
- 成本升高
- 回复变慢
- 模型注意力分散
- 更容易引用过期信息

因此，AgentHub 采用“项目保存完整上下文，调用时组装任务上下文包”的策略。

### 7.2 上下文分层

```text
1. Agent 系统 Prompt
2. 项目固定上下文 Project Brief
3. pinned 关键消息
4. 当前任务摘要
5. 最近相关消息
6. 相关文件摘要
7. 相关产物摘要
```

### 7.3 Task Context Package

每次调用子 Agent 前，Context Builder 生成一个任务上下文包。

```text
Task Context Package
├── 项目目标
├── 当前用户请求
├── 相关历史决策
├── 当前任务摘要
├── 相关文件路径 / 摘要
├── 相关产物
└── 期望输出格式
```

### 7.4 不同 Agent 的上下文需求

| Agent | 需要的上下文 |
|---|---|
| 产品经理 | 项目目标、用户需求、历史决策 |
| 设计师 | 需求、风格约束、页面结构、已有预览 |
| 工程师 | 需求、技术栈、文件路径、设计结果、验收标准 |
| 测试审查 | 原始任务、变更文件、预期行为、测试命令 |
| 发布助手 | 产物路径、构建命令、部署配置、版本说明 |

### 7.5 与 Claude Code 的对比

Claude Code 的普通子 Agent 通常不会默认继承完整主会话，而是由主 Agent 给它一个明确任务说明。

特殊 fork 模式才会继承父上下文，但它用于临时分叉、并行研究或隔离任务。

AgentHub 可以借鉴这个设计：

```text
普通 Agent 调用 = 精准任务包
特殊并行任务 = 可选 fork / worktree 隔离
```

## 8. 工具与权限设计

### 8.1 工具列表

```ts
type ToolName =
  | 'readFile'
  | 'writeFile'
  | 'applyDiff'
  | 'runCommand'
  | 'webSearch'
  | 'webFetch'
  | 'createPreview'
  | 'deploy'
  | 'createArtifact'
```

### 8.2 权限原则

不同 Agent 权限必须不同。

示例：

| Agent | 读文件 | 写文件 | 命令 | 搜索 | 部署 |
|---|---|---|---|---|---|
| 产品经理 | 否 | 否 | 否 | 是 | 否 |
| 设计师 | 可选 | 否 | 否 | 是 | 否 |
| 工程师 | 是 | 是 | 是 | 可选 | 否 |
| 测试审查 | 是 | 否 | 是 | 可选 | 否 |
| 发布助手 | 是 | 可选 | 是 | 是 | 是 |

### 8.3 借鉴 Claude Code 的工具权限范式

Claude Code 的子 Agent 设计在本地 CLI 场景中已经比较成熟，值得学习。

它的核心做法不是只靠 prompt，而是通过 Agent 定义和运行时共同限制工具：

```text
Agent frontmatter
├── tools
├── disallowedTools
└── permissionMode

运行时
├── resolveAgentTools
├── canUseTool
└── worktree isolation
```

可以学习的点：

- `tools`：声明该 Agent 允许看到和调用哪些工具
- `disallowedTools`：从可用工具中明确排除危险工具
- `permissionMode`：定义工具执行是否需要确认、是否只读、是否自动接受编辑
- `worktree`：工程类 Agent 并行工作时创建独立 git worktree，降低文件冲突
- 普通子 Agent 不默认继承完整主上下文，而是由主 Agent 提供明确任务包
- fork 类子 Agent 可以继承父上下文，用于并行研究或临时分叉

AgentHub 可以采用类似范式，但需要调整默认策略。

Claude Code 面向的是：

```text
单用户
本地电脑
开发者自己的项目
CLI 环境
```

AgentHub 面向的是：

```text
多用户
Web 端
云服务器执行
用户项目托管在平台 workspace 中
```

因此，AgentHub 不能把 Claude Code 的权限模型原样照搬。尤其不能默认 `tools: ['*']` 就开放全部工具。

AgentHub 的默认策略应该是：

```text
默认不给危险工具
需要什么工具就显式开放什么工具
所有工具调用必须经过 Tool Gateway
工程执行必须受 Runtime 沙箱限制
```

建议权限链路：

```text
AgentDefinition 权限声明
  ↓
Tool Gateway 校验
  ↓
Runtime Policy 校验
  ↓
Docker / 文件系统 / 命令执行边界
  ↓
执行工具
  ↓
记录审计日志
```

### 8.4 Tool Gateway 执行校验

Agent 只能请求工具，不能直接执行工具。

每次工具调用都必须经过 Tool Gateway：

```text
Agent 请求 readFile / writeFile / runCommand
  ↓
Tool Gateway 检查 AgentDefinition
  ↓
检查 workspace 路径边界
  ↓
检查 Runtime Policy
  ↓
允许执行或返回 Permission denied
```

需要检查的内容包括：

- 当前 Agent 是否拥有该工具
- 该工具是否在 `disallowedTools` 中
- 当前 `permissionMode` 是否允许执行
- 文件路径是否仍在当前 workspace 内
- 是否访问 `.env`、SSH key、云厂商密钥等敏感文件
- shell 命令是否在允许范围内
- 网络访问是否被允许
- 单次运行是否超过时间限制

建议的 `permissionMode`：

| 模式 | 含义 | 适合 Agent |
|---|---|---|
| `readonly` | 只能读，不能写，不能执行危险命令 | 产品经理、设计师、研究类 Agent |
| `ask` | 写文件、运行命令、部署前需要用户或主 Agent 确认 | 默认安全模式 |
| `acceptEdits` | 允许写入项目文件，但仍限制路径和命令 | 工程师 Agent |
| `dangerous` | 高权限模式，只能内部调试使用 | 不作为普通用户功能 |

### 8.5 Runtime 沙箱限制

Tool Gateway 是平台逻辑限制，Runtime 沙箱是底层硬限制。

工程师 Agent、发布 Agent 这类可以写文件或运行命令的 Agent，必须放在受控执行环境中：

```text
Runtime Sandbox
├── 只挂载当前 workspace
├── 禁止访问其他用户目录
├── 默认不注入平台密钥
├── 限制 CPU / 内存 / 运行时间
├── 限制 shell 命令
├── 可限制网络访问
└── 记录命令、文件变更和构建日志
```

这样即使模型试图绕过 prompt，也只能得到工具层或沙箱层的拒绝结果。

### 8.6 WebSearch 与 WebFetch

联网能力不应该设计成独立 Agent，而应该设计成工具。

```text
WebSearch = 搜索有哪些网页
WebFetch = 抓取指定网页内容
```

搜索策略：

- 默认由 Agent 生成搜索词
- 技术文档类任务优先限制官方域名
- 搜索结果必须记录来源
- 抓取页面后生成摘要再进入上下文

### 8.7 文件隔离

默认情况下，多个 Agent 可以共享同一个项目文件夹。

当工程师 Agent 需要并行改代码时，建议使用 git worktree 做隔离。

```text
shared   = 共享当前项目目录
worktree = 创建独立工作副本，避免冲突
```

## 9. 数据模型草案

```ts
type Workspace = {
  id: string
  name: string
  goal: string
  workspaceType: 'dev' | 'research' | 'writing' | 'chat'
  templateId?: string
  rootPath?: string
  runtimeType: 'cloud' | 'local'
  runtimeStatus: 'creating' | 'ready' | 'error'
  projectBrief: string
  pinnedMessageIds: string[]
  remoteProvider?: 'github'
  remoteUrl?: string
  createdAt: string
  updatedAt: string
}

type Conversation = {
  id: string
  workspaceId: string
  type: 'group' | 'direct'
  title: string
  participants: string[]
  createdAt: string
  updatedAt: string
}

type Message = {
  id: string
  workspaceId: string
  conversationId: string
  senderType: 'user' | 'agent' | 'system'
  senderId: string
  content: string
  artifacts: Artifact[]
  createdAt: string
}

type AgentRun = {
  id: string
  workspaceId: string
  conversationId: string
  agentId: string
  inputContext: string
  output: string
  status: 'pending' | 'running' | 'success' | 'failed'
  createdAt: string
  finishedAt?: string
}

type ChangedFile = {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

type ChangeSet = {
  id: string
  workspaceId: string
  agentRunId: string
  baseCommit: string
  files: ChangedFile[]
  summary: string
  patch?: string
  createdAt: string
}

type Artifact = {
  id: string
  workspaceId: string
  type: 'code' | 'diff' | 'web-preview' | 'file' | 'deploy-status' | 'zip'
  title: string
  content: string
  url?: string
  createdByAgentId: string
}

type WorkspaceEvent =
  | { type: 'agent_run_started'; workspaceId: string; agentRunId: string }
  | { type: 'file_changed'; workspaceId: string; agentRunId: string; path: string; status: ChangedFile['status'] }
  | { type: 'diff_ready'; workspaceId: string; agentRunId: string; changeSetId: string }
  | { type: 'build_started'; workspaceId: string; agentRunId: string }
  | { type: 'preview_ready'; workspaceId: string; agentRunId: string; previewUrl: string }
  | { type: 'agent_run_finished'; workspaceId: string; agentRunId: string }

type WorkspaceRuntime = {
  id: string
  workspaceId: string
  userId: string
  type: 'cloud' | 'local'
  repoPath: string
  artifactPath: string
  logPath: string
  previewUrl?: string
  gitInitialized: boolean
  remoteProvider?: 'github'
  remoteUrl?: string
  status: 'creating' | 'ready' | 'error'
  createdAt: string
  updatedAt: string
}
```

## 10. Adapter Layer

### 10.1 为什么需要 Adapter

不同底层 Agent 平台的 API 和运行方式不同。

例如：

- Claude Code 偏项目目录和工具调用
- Codex 偏代码任务执行
- OpenCode 或其他工具有自己的接口
- Mock Agent 用于 Demo 和离线演示

AgentHub 不能让业务逻辑直接依赖某个具体平台，因此需要统一适配器层。

用户看到的 Agent 是角色模板，底层运行引擎可以切换。

```text
工程师 Agent
├── 可以用 Claude Code 跑
├── 可以用 Codex 跑
└── 可以用 OpenClaw 跑
```

因此需要区分：

```text
AgentDefinition = 角色模板
AgentRun = 某次任务运行
Adapter = 底层 Agent 平台适配器
Workspace Runtime = 实际文件和命令执行环境
```

### 10.2 Adapter 接口

```ts
type AgentAdapter = {
  provider: 'claude-code' | 'codex' | 'openclaw' | 'mock'
  run(input: AgentRunInput): Promise<AgentRunResult>
}

type AgentRunInput = {
  workspaceId: string
  runtime: WorkspaceRuntime
  agent: AgentDefinition
  task: string
  contextPackage: string
  tools: ToolName[]
  isolation: 'shared' | 'worktree'
}

type AgentRunResult = {
  status: 'success' | 'failed'
  content: string
  artifacts: Artifact[]
  logs?: string[]
}
```

## 11. 部署策略与费用估算

### 11.1 MVP 部署策略

比赛周期短，MVP 不建议一开始上 Kubernetes、Serverless 编排或复杂微服务。

推荐采用：

```text
Web Client
  ↓
Nginx / HTTPS
  ↓
API Server
  ↓
Task Queue
  ↓
Agent Worker
  ↓
Cloud Workspace Runtime
  ↓
Object Storage / Preview / Zip
```

第一版可以先部署在一台云服务器上：

```text
单台 VM
├── API Server
├── Agent Worker
├── Task Queue
├── Docker Runtime
├── Nginx
├── PostgreSQL / SQLite
└── Workspace 目录

对象存储 OSS / COS
├── zip 包
├── 构建产物
├── 附件
└── 长期日志
```

### 11.2 云端构建与预览机制

这里的“本地构建”指的是在云服务器的 Workspace Runtime 中构建，不是在用户电脑本地构建。

用户通过浏览器发起任务后，完整预览链路是：

```text
用户在 Web 端发任务
  ↓
Agent 在云端 workspace 修改代码
  ↓
云端进入 /workspaces/{userId}/{workspaceId}/repo
  ↓
执行 npm run build
  ↓
生成 dist / build 静态产物
  ↓
后端把静态产物发布到 preview 目录或对象存储
  ↓
返回一个公网可访问 preview URL
  ↓
Web 前端用 iframe 或新窗口展示预览
```

以 Vite 项目为例：

```text
/workspaces/user_1/ws_123/repo
  └── npm run build

生成：

/workspaces/user_1/ws_123/repo/dist
```

后端可以把构建产物复制到：

```text
/previews/ws_123/run_456/
```

再通过 Nginx 对外暴露：

```text
https://preview.example.com/ws_123/run_456/
```

聊天流中的产物卡片保存这个 URL：

```ts
type WebPreviewArtifact = {
  type: 'web-preview'
  workspaceId: string
  runId: string
  url: string
  status: 'success' | 'failed'
  buildLog?: string
}
```

需要特别注意：不能把云服务器内部的 `localhost` 地址直接返回给用户。

例如云服务器上运行：

```text
http://localhost:5173
```

这个 `localhost` 是云服务器自己的本地地址，用户浏览器无法通过这个地址访问服务器里的 dev server。必须通过 Nginx、网关或对象存储生成公网可访问地址。

预览方式有三种：

| 方式 | 说明 | MVP 推荐度 |
|---|---|---:|
| 静态构建预览 | `npm run build` 后托管 `dist` / `build` 目录 | 高 |
| Dev Server 反向代理 | 云端运行 `npm run dev`，Nginx 按 workspace 转发到内部端口 | 中 |
| 每个预览独立容器 | 每个 workspace 或 run 使用独立容器暴露预览 | 后续扩展 |

MVP 推荐优先使用静态构建预览：

```text
Agent 写代码
  ↓
服务器执行 npm run build
  ↓
Nginx / 对象存储托管静态产物
  ↓
聊天中返回预览卡片
```

这样不需要长期占用多个 `npm run dev` 进程，服务器压力更小，也更容易做产物归档和 zip 导出。

如果构建失败，后端不返回预览 URL，而是把构建日志写入 AgentRun 和 Artifact，让工程师 Agent 根据错误日志继续修复。

### 11.3 推荐云资源配置

| 场景 | 推荐配置 | 适合情况 |
|---|---|---|
| 极简 Demo | 2 核 4G / 80GB 云盘 / 3M-5M 带宽 | 只做演示，不并发跑多个工程 Agent |
| 比赛 MVP 推荐 | 4 核 8G / 100GB-200GB 云盘 / 5M 带宽 | API、Worker、构建、预览都在一台机器上 |
| 稳妥内测 | 8 核 16G / 200GB 云盘 / 5M-10M 带宽 | 多用户试用，允许少量并发任务 |
| 后续扩容 | API Server + Worker 集群 + Redis + 独立数据库 + 对象存储 | 用户量增长后再拆 |

### 11.4 地域选择

地域选择主要看模型 API 和用户访问位置。

| 选择 | 优点 | 风险 |
|---|---|---|
| 中国大陆地域 | 国内访问快，阿里云 / 腾讯云资源成熟 | 如果接海外模型 API，网络可能不稳定；公网域名可能涉及备案 |
| 中国香港 / 新加坡 | 访问海外模型 API 更方便，免去大陆备案压力 | 国内用户访问延迟略高，云资源价格可能更高 |

如果主要调用海外模型 API，优先考虑香港或新加坡。

如果主要调用国内模型 API，且需要国内访问速度，可以选大陆地域，但要提前考虑域名备案问题。

### 11.5 费用估算

费用要拆成两类：

```text
总费用 = 云资源固定成本 + 模型调用浮动成本
```

云资源固定成本主要包括：

- 云服务器：CPU、内存
- 云盘：系统盘、数据盘
- 公网带宽或公网流量
- 对象存储：zip、附件、构建产物、日志
- 可选数据库：RDS / 云数据库
- 可选域名、证书、监控

按比赛周期从 5 月 21 日到 6 月 10 日估算，约 20-21 天。但云服务器通常按月、按量或包年包月计费，所以实际预算更适合按“一个月”准备。

| 方案 | 云资源月预算 | 比赛周期建议预算 | 说明 |
|---|---:|---:|---|
| 极简 Demo | 100-300 元 | 200-500 元 | 适合低并发演示，Agent 执行要排队 |
| 推荐 MVP | 300-800 元 | 500-1000 元 | 4 核 8G 左右，比较适合比赛主链路 |
| 稳妥内测 | 800-1800 元 | 1000-2500 元 | 8 核 16G 左右，可承受少量真实用户 |
| 多用户压测 | 2000-5000 元以上 | 3000 元以上 | 需要拆 API、Worker、数据库和队列 |

对象存储本身不贵。MVP 阶段如果只存源码 zip、构建产物、附件和日志，几十 GB 到一两百 GB 通常是几十元以内到一百元以内级别。真正容易失控的是公网下行流量和模型调用。

### 11.6 模型调用费用

AgentHub 的成本压力不只在服务器，更主要在模型调用。

一次完整任务可能包含：

```text
Orchestrator 1 次
产品经理 Agent 1 次
设计师 Agent 0-1 次
工程师 Agent 1-多次
Reviewer Agent 1 次
Publisher Agent 0-1 次
```

也就是说，一个用户看起来只发了一句话，底层可能触发 3-8 次模型调用。

模型费用估算公式：

```text
模型费用 = 任务次数 × 每个任务的 Agent 调用次数 × 单次平均 token 数 × 模型单价
```

比赛 MVP 建议先做成本上限：

- 每个任务最多调用 3-5 个 Agent
- 每个 Agent 设置最大上下文长度
- 工程师 Agent 才使用更强模型
- 产品、设计、审查优先使用便宜模型或 mock
- 每个用户每日限制任务次数
- 队列中同一工作区同时只允许 1 个写文件任务
- 失败任务自动停止，不无限重试

建议模型预算：

| 使用方式 | 模型预算 |
|---|---:|
| 主要用 mock / 少量真实模型 | 0-300 元 |
| 比赛真实演示，控制调用次数 | 300-1000 元 |
| 多人内测，频繁跑工程 Agent | 1000-5000 元 |

### 11.7 成本控制策略

MVP 必须内置成本控制，否则 Agent 平台很容易因为并发和重试导致费用不可控。

建议策略：

- 所有 AgentRun 进入队列，不直接并发打满服务器
- 限制全局并发，例如同时最多 1-2 个工程 Agent
- 普通咨询任务不启动 Workspace Runtime
- 只有需要写代码、构建、预览时才启动工程执行
- 使用项目模板缓存，避免每次重新安装依赖
- 预览优先生成静态构建产物，而不是长期占用 dev server
- workspace 定期清理，例如 7 天或 14 天无访问后归档
- 日志和产物转存对象存储，本机只保留热数据
- 设置单任务超时，例如 5-10 分钟
- 设置模型 token 上限和每用户调用额度

### 11.8 云厂商选择建议

阿里云 ECS + OSS 和腾讯云 CVM + COS 都可以。

选择标准不应该是理论架构差异，而是：

- 哪家账号、优惠券、学生认证或企业认证更容易用
- 目标地域是否支持稳定访问模型 API
- 服务器、对象存储、域名、备案是否能一次性搞定
- 团队对哪家控制台更熟悉

比赛 MVP 推荐：

```text
优先级 1：选择已有账号和优惠券的云厂商
优先级 2：选 4 核 8G 作为起步配置
优先级 3：把模型调用和 Agent 并发限制做好
优先级 4：后续根据真实瓶颈升级服务器或拆 Worker
```

### 11.9 后续扩容路径

当单机无法承载时，再按下面顺序拆：

```text
阶段 1：单 VM
API + Worker + Runtime + 数据库

阶段 2：单 API + 多 Worker
API Server 独立，Agent Worker 横向扩容

阶段 3：独立数据库和 Redis
PostgreSQL / MySQL + Redis Queue

阶段 4：容器集群
每个 AgentRun 用独立容器或任务调度运行

阶段 5：多地域和弹性伸缩
按用户地域和模型 API 地域拆分 Runtime
```

## 12. MVP 范围

项目周期较短，第一版必须保证主链路跑通。

### 12.1 必做功能

```text
1. 创建工作区
2. 工作区主群聊
3. Agent 成员列表
4. @ 指定 Agent
5. Orchestrator 自动分派
6. 子 Agent 按标准模板执行
7. 聊天流展示 Agent 回复
8. 产物卡片展示
9. 项目上下文 / pinned 消息
10. 至少两个底层 Adapter
11. 云端 Workspace Runtime
12. 在线预览 URL
13. 源码 zip 导出
```

### 12.2 第一阶段推荐真实实现

```text
product-manager
engineer
reviewer
```

设计师 Agent 和发布助手 Agent 可以先半自动或 mock。

### 12.3 MVP 项目来源与交付

MVP 推荐优先支持：

```text
项目来源：
1. 从云端模板创建项目
2. 可选支持上传 zip

交付方式：
1. 在线预览 URL
2. 源码 zip 下载
3. 聊天流中的 Diff / 文件列表
```

GitHub 导入和 GitHub 推送作为增强功能，不作为主链路前置条件。

### 12.4 可以延后

- 桌面端
- 移动端
- 完整版本历史
- 完整部署平台
- 多人协同编辑
- 复杂权限审批
- Local Connector
- GitHub OAuth 和仓库推送

## 13. 答辩表达重点

本项目不是简单地把多个 prompt 放进聊天框，而是设计了一套可扩展的多 Agent 协作架构。

答辩时可以强调：

- 工作区是项目上下文容器
- 群聊和私聊共享项目级上下文
- Orchestrator 负责任务理解、调度和汇总
- 子 Agent 按 AgentDefinition 标准接入
- Context Builder 控制上下文注入，避免上下文爆炸
- Tool Gateway 管理工具权限
- Adapter Layer 屏蔽不同 Agent 平台差异
- Artifact 系统让 Agent 产出可视化、可操作

## 14. 架构总结

AgentHub 的核心架构可以概括为：

```text
以工作区为项目上下文容器，
以群聊和私聊为交互入口，
以 Orchestrator 做任务调度，
以 AgentDefinition 规范子 Agent，
以 Context Builder 控制上下文注入，
以 Tool Gateway 管理工具和权限，
以 Adapter Layer 接入不同 Agent 平台，
以 Artifact 系统承接最终产物。
```

## 15. 第一版范围冻结

### 15.1 第一版必须实现

```text
1. 只做 dev 类型工作区
2. 支持工作区创建、复用、切换
3. 支持 IM 式对话列表：新建、置顶、归档、搜索、最近活跃排序
4. 支持单聊模式和群聊模式
5. 支持 Agent 作为联系人展示：头像、名称、能力标签
6. 支持用户自建 Agent：从模板复制后修改 prompt / 工具 / 权限
7. 接入至少 2 个主流 Agent 平台，优先 Claude Code + Codex
8. Orchestrator 一期直接支持串行调度、并行调度、失败降级、冲突处理
9. 支持聊天历史、pin 消息、项目摘要作为长期上下文
10. 支持产物内联展示：代码、Diff、文件附件、网页、文档、PPT、图片
11. 支持在线预览 URL
12. 支持源码 zip 下载
13. 支持一键应用 Diff / 代码二次编辑的基础能力
14. 支持云端 Workspace Runtime、git worktree、构建日志
```

### 15.2 第一版不做

```text
1. 桌面端
2. 移动端
3. 静态站点部署平台
4. 容器化部署平台
5. 完整版本历史管理
6. 对话式局部修改编辑器的深度版本能力
7. research / writing / chat 这些非 dev workspace 类型
8. Local Connector
9. GitHub OAuth 和仓库推送
```

### 15.3 交付物清单

```text
1. 产品设计文档
2. 技术架构文档
3. 可运行 Demo
4. AI 协作开发记录
5. 3 分钟 Demo 视频
```

### 15.4 主链路

这一版方案的重点不是把所有能力都堆满，而是先把以下主链路做通：

```text
用户创建 dev 工作区
→ 进入 IM 式聊天
→ 选择或自建 Agent
→ Orchestrator 分派任务
→ Agent 修改云端 workspace 代码
→ 前端收到 Diff / 预览 / 文档 / PPT / 图片等产物
→ 用户下载 zip 或打开预览 URL
```
