# AgentHub Web 端已有功能清单

本文档根据当前 `agentHubFrontend` 代码、业务后端接口文档和项目 README 整理，用于说明 AgentHub Web 端已经实现或已经接入的功能范围。后续移动端 App 可以按本文档决定哪些能力需要完整迁移，哪些能力只做摘要入口或降级展示。

## 1. Web 端总体形态

当前 Web 端是一个多 Agent 协作工作台，核心界面由三类区域组成：

- 顶部状态栏：展示品牌、业务后端连接状态、工作区数量、Agent 数量、Agent 管理入口、代码工作区入口、刷新入口。
- 左侧工作区栏：展示和管理多个工作区，支持搜索、筛选、排序、置顶、归档和分页加载。
- 主聊天工作台：一个工作区对应一个主要聊天窗口，支持群聊、单聊、流式回复、流程事件、产物卡片和消息输入。

Web 端当前是 `live-only` 模式。如果业务后端不可用，不再回退到本地 demo 数据，而是展示阻塞错误页和重试入口。

## 2. 后端连接与全局状态

### 2.1 后端连接状态

Web 端会在启动时请求业务后端，加载工作台概览和当前工作区详情。

已有状态：

- connecting
- live
- error

已有 UI：

- 顶部后端地址状态 chip。
- `backend live` / `backend error` / `connecting` 状态提示。
- 后端异常时展示全屏阻塞错误态。
- 支持手动刷新重试。

对应代码：

- `agentHubFrontend/src/App.tsx`
- `agentHubFrontend/src/api/businessBackend.ts`

对应接口：

- `GET /api/workbench`
- `GET /api/projects/:projectId/state`

### 2.2 首次加载与错误页

当没有工作区数据且处于加载或错误状态时，Web 会显示阻塞状态页：

- loading：正在连接本地业务后端。
- error：无法连接本地业务后端，提供重试按钮。

该能力对移动端也重要，但移动端可改成更轻量的启动页或顶部错误 banner。

## 3. 工作区列表与管理

### 3.1 工作区列表

Web 左侧 `WorkspaceRail` 已实现工作区列表。

每个工作区卡片展示：

- 工作区名称。
- 工作区目标/摘要。
- 群聊或单聊类型。
- runtime 状态。
- 参与 Agent 头像。
- 运行中 Agent 数。
- 产物数。
- 消息数。
- 置顶状态。
- 归档状态。

对应代码：

- `agentHubFrontend/src/components/WorkspaceRail.tsx`
- `agentHubFrontend/src/appModel.ts`

对应接口：

- `GET /api/workbench`

### 3.2 工作区搜索

Web 已支持工作区关键字搜索。

实现细节：

- 搜索框输入会 debounce。
- 搜索词传给业务后端。
- 后端按工作区名称/目标返回匹配结果。

对应查询参数：

- `query`
- `q`

### 3.3 工作区筛选与排序

Web 已支持：

- active / archived / all 状态筛选。
- updatedAt / createdAt / name 排序字段。
- asc / desc 排序方向。

对应接口：

- `GET /api/workbench?status=&sortBy=&sortDirection=`

### 3.4 工作区分页加载

Web 已支持按页加载工作区。

实现细节：

- 初始加载 20 个工作区。
- 点击加载更多继续请求下一页。
- 使用 cursor 合并结果并去重。

对应接口：

- `GET /api/workbench?pageSize=&cursor=`

### 3.5 工作区创建

Web 已实现新建工作区弹窗。

支持输入：

- 工作区名称。
- 项目目标。
- 工作区类型。
- 群聊或单聊。
- 单聊目标 Agent。

创建逻辑：

- 群聊默认使用产品经理、工程师、审查员等默认 Agent。
- 单聊会绑定一个固定目标 Agent。
- 创建成功后刷新工作区列表并选中新工作区。

对应代码：

- `agentHubFrontend/src/components/CreateWorkspaceDialog.tsx`
- `createBusinessWorkspace`

对应接口：

- `POST /api/projects`

### 3.6 工作区置顶与归档

Web 已支持：

- 置顶工作区。
- 取消置顶。
- 归档工作区。
- 取消归档。

对应代码：

- `WorkspaceRail`
- `updateBusinessWorkspaceMetadata`

对应接口：

- `PATCH /api/projects/:projectId/metadata`
- `PUT /api/projects/:projectId/pin`
- `DELETE /api/projects/:projectId/pin`
- `PUT /api/projects/:projectId/archive`
- `DELETE /api/projects/:projectId/archive`

## 4. 群聊与单聊

### 4.1 工作区到聊天窗口的映射

当前 Web 端设计是：

- 一个工作区映射一个主要聊天窗口。
- dev/research/writing 等项目型工作区优先使用群聊。
- chat 类型或直接对某 Agent 的工作区使用单聊。

对应模型：

- `WorkspaceRoom`
- `Conversation`
- `workspaceRooms`
- `primaryConversationForWorkspace`

### 4.2 群聊

群聊是多 Agent 协作的主入口。

已有能力：

- 用户发送任务。
- Orchestrator 判断任务阶段和路由策略。
- 可以显式 `@agent` 指定子 Agent。
- 非显式提及时，后端可以根据路由元数据选择可见回复 Agent。
- 多个 Agent 的执行过程会进入聊天流。
- 最终结果以 Agent 回复或主脑汇总形式展示。

### 4.3 单聊

单聊用于用户与单个 Agent 独立沟通。

已有能力：

- 单聊工作区固定目标 Agent。
- 不展示 `@` mention picker。
- 发送消息时带固定 `agentId`。
- 单聊结果仍归属同一个工作区上下文。

### 4.4 当前工作区恢复

Web 会把最近活跃工作区保存到 `localStorage`。

刷新后：

- 如果该工作区仍存在，则恢复选中。
- 如果不存在，则选中第一个工作区。

对应 key：

- `agenthub.activeWorkspaceId`

## 5. 消息流与聊天体验

### 5.1 消息列表

Web 聊天流支持：

- 用户消息。
- Agent 消息。
- 系统消息。
- 流式临时消息。
- 后端持久化后的正式消息。
- 历史消息分页加载。

对应代码：

- `ChatPane`
- `buildChatTimeline`
- `messagesForConversation`

### 5.2 消息分页

当前项目详情接口按最近消息窗口加载。

Web 支持：

- 初始加载最近 40 条消息。
- 点击加载更早消息。
- 每次增加 messageLimit。
- 加载更早消息时保持滚动位置稳定。

对应接口：

- `GET /api/projects/:projectId/state?messageLimit=`

### 5.3 自动滚动与回到底部

Web 已实现：

- 切换聊天时滚动到最新消息。
- 用户接近底部时跟随流式输出滚动。
- 用户离开底部时停止强制滚动。
- 显示“回到底部”按钮。

### 5.4 回复引用

Web 已支持消息回复引用。

能力：

- 点击消息的回复操作。
- Composer 上方显示引用条。
- 发送时传结构化 `replyTo`。
- 刷新后引用关系仍可显示。

结构：

```ts
type ReplyReference = {
  messageId: string
  senderId: string
  senderName?: string
  excerpt: string
}
```

对应接口字段：

- `replyTo`

### 5.5 复制消息

Web 支持复制消息内容到剪贴板。

对应代码：

- `handleCopyMessage`

### 5.6 重新生成

Web 支持对上一条用户消息重新生成。

行为：

- 查找当前会话最近一条用户消息。
- 使用相同内容和引用信息再次发送。

### 5.7 Markdown 渲染

Web 已统一使用 Markdown 渲染 AI 回复、流程摘要和产物文本。

能力：

- `react-markdown`
- `remark-gfm`
- GFM 表格、列表等。
- 禁用 raw HTML。
- AI 输出预清洗，避免空标题、空列表、未闭合代码块破坏布局。
- fenced code block 有语言标签和复制动作。

对应代码：

- `MarkdownRenderer`
- `normalizeAiMarkdown`

## 6. @Agent 提及与输入框

### 6.1 @ 提及

群聊 Composer 支持 `@` 提及子 Agent。

能力：

- 在光标附近识别 `@` token。
- 展示 Agent mention picker。
- 支持键盘上下选择。
- Enter 插入 Agent mention。
- Escape 关闭。
- 插入位置尊重当前光标。

对应代码：

- `ChatComposer`
- `AgentMentionPicker`

### 6.2 Composer 草稿

Web 会按 conversation 保存输入草稿。

能力：

- 切换工作区后恢复对应草稿。
- 发送成功后清除草稿。

对应 key：

- `agenthub:draft:${conversation.id}`

### 6.3 代码引用

Web 支持从代码工作区选择一段代码，然后带到聊天输入框。

能力：

- 选择代码片段。
- 生成结构化 `codeSelection`。
- Composer 显示代码引用条。
- 发送时把代码选区作为结构化字段传给后端。
- 未指定 Agent 时，代码选区可优先路由给 engineer。

结构：

```ts
type CodeSelectionReference = {
  filePath: string
  selectedText: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  language?: string
  beforeContext?: string
  afterContext?: string
}
```

对应接口字段：

- `codeSelection`

## 7. 流式事件与任务过程展示

### 7.1 SSE 流式消息

Web 发送消息后通过 SSE 接收后端事件。

已有能力：

- 解析 `data:` JSON。
- 处理 assistant started / delta / finished。
- 维护 streaming message。
- SSE 结束后进入 awaiting_commit 状态。
- 刷新当前工作区 state 后替换为持久化消息。

对应接口：

- `POST /api/projects/:projectId/messages/stream`

### 7.2 流程事件类型

Web 已支持多种 workflow event：

- turn_started
- workflow_received
- routing_started
- routing_finished
- task_stage_updated
- context_started / context_finished
- model_call_started / model_call_finished / model_call_failed
- handoff_created
- agent_task_dispatched
- handoff_updated
- agent_started
- agent_progress
- agent output stdout/stderr delta
- agent_finished
- delivery_validation_finished
- review_verdict
- artifact_created
- change_set_created
- preview_ready
- zip_ready
- synthesis_started / synthesis_finished
- workflow_finished

对应类型：

- `WorkflowEvent`

### 7.3 本轮过程卡

Web 会把用户消息、流程事件、产物和最终回复合并成一个 `ChatTurn`。

每个 turn 包含：

- 用户消息。
- 流程过程卡。
- 产物卡片。
- streaming / settling / final message。
- 当前状态：running、awaiting_commit、completed、partial、failed。

过程卡类型：

- route
- stage
- context
- dispatch
- progress
- log
- artifact
- validation
- review
- synthesis
- reply
- status

对应代码：

- `chatTimeline.ts`
- `TurnBlock`

### 7.4 过程自动折叠

Web 已实现：

- 运行中、失败、部分完成的 turn 默认展开。
- 完成后的 turn 自动折叠。
- 最终回复刚提交时短暂保持展开，让用户看到完成状态。
- 用户手动展开/折叠会覆盖默认行为。

## 8. 产物展示

### 8.1 聊天流内产物卡片

Web 在聊天流中展示紧凑产物卡片。

支持类型：

- preview
- diff
- review
- zip
- deploy
- text
- generic artifact

每张卡片展示：

- 类型图标。
- 标题。
- 摘要。
- 关键指标。
- URL 或详情入口。

对应代码：

- `ChatPane`
- `artifactToChatArtifact`

### 8.2 产物详情弹窗

Web 已实现产物详情弹窗。

不同产物有不同详情：

- preview：iframe 预览，含 loading / slow / ready / error 状态。
- diff：变更文件列表和 patch 文本。
- review：审查结论、summary、issues。
- text / artifact / deploy：Markdown 详情。
- URL：可在新窗口打开。

### 8.3 产物排序

聊天 turn 内产物排序：

1. preview
2. diff
3. review
4. zip
5. deploy
6. text
7. generic artifact

## 9. 代码工作区

Web 端 `CodeWorkspaceDialog` 是目前最完整的代码与交付功能入口。

### 9.1 文件树

已有能力：

- 加载当前 workspace repo 文件树。
- 展示目录和文件。
- 目录展开/折叠。
- 自动选择第一个文本文件。
- 搜索文件。
- 二进制文件置灰。
- 展开当前文件的父目录。

对应接口：

- `GET /api/projects/:projectId/files`

### 9.2 文件内容查看

已有能力：

- 读取 UTF-8 文本文件内容。
- 使用 Monaco Editor 只读展示。
- 自动语言识别。
- 暗色代码主题。
- word wrap 开关。
- 保持编辑器布局稳定。

对应接口：

- `GET /api/projects/:projectId/files/content?path=`

### 9.3 代码选区引用

已有能力：

- 在 Monaco 中选择代码。
- 读取选区文本、行列范围、前后上下文。
- 展示浮动选区提示。
- 点击引用后把结构化代码选区带回聊天 Composer。

### 9.4 Diff 查看

已有能力：

- 加载当前 workspace Git diff。
- 展示 base commit。
- 展示 git status。
- 展示 patch。
- 统计 changed files。

对应接口：

- `GET /api/projects/:projectId/diff`

### 9.5 预览面板

已有能力：

- 检测当前项目预览能力。
- 支持 static / module-shell / build / unsupported 模式。
- 支持 Vite React、Vite Vue、Vite Svelte、Vite、Angular 等框架识别。
- 展示 preview targets。
- iframe 加载预览。
- loading / slow / error / ready 状态。
- 预览失败时可重试或新窗口打开。

对应接口：

- `GET /api/projects/:projectId/preview-capability`
- `POST /api/projects/:projectId/preview-build?force=true`
- `/preview/*`
- `/build-preview/*`

### 9.6 预览构建

已有能力：

- 当 preview mode 是 build 时，可启动构建。
- 构建状态包括 idle / running / success / failed。
- 可强制重新构建。
- 展示 install command、build command、log excerpt。

对应接口：

- `POST /api/projects/:projectId/preview-build?force=true`

### 9.7 交付状态

代码工作区顶部有本地交付状态卡。

已支持：

- 当前源码快照状态。
- 当前构建状态。
- 当前部署状态。
- 保存源码版本。
- 构建版本。
- 部署版本。
- 打开源码 zip、构建预览、部署预览。

对应接口：

- `GET /api/projects/:projectId/delivery`
- `POST /api/projects/:projectId/versions`
- `POST /api/projects/:projectId/builds`
- `POST /api/projects/:projectId/deploy`
- `GET /api/projects/:projectId/source.zip?versionId=`
- `/deploy/*`

## 10. Agent 管理

### 10.1 Agent 列表

Web 已支持查看 Agent 列表。

展示字段：

- id
- name
- role
- description
- modelProvider
- model
- source
- skills
- permissions
- routingProfile

对应代码：

- `AgentManagementDialog`

对应接口：

- `GET /api/agents`

### 10.2 Agent 创建

Web 已支持创建自定义 Agent。

可提交字段：

- id
- name
- role
- description
- whenToUse
- systemPrompt
- modelProvider
- model
- contextPolicy
- tools
- permissions
- disallowedTools
- permissionMode
- runtimePolicy
- outputSchema
- isolation
- skills
- routingProfile

对应接口：

- `POST /api/agents`

### 10.3 Agent 编辑

Web 已支持编辑 Agent。

内置 Agent 限制：

- 不允许删除。
- 只允许编辑部分描述、模型、上下文、提示词、技能等字段。

自定义 Agent：

- 可额外编辑 tools、permissions、permissionMode、isolation 等权限相关字段。

对应接口：

- `PATCH /api/agents/:agentId`

### 10.4 Agent 删除

Web 已支持删除自定义 Agent。

限制：

- 内置 Agent 不可删除。

对应接口：

- `DELETE /api/agents/:agentId`

## 11. 工作区洞察与辅助展示

项目中存在 `InsightDock` 和 `WatchStrip` 组件，用于工作区观察和辅助信息展示。

从代码结构看，相关能力包括：

- 工作区 watcher 卡片。
- Agent 执行状态。
- handoff 列表。
- event 列表。
- artifact mini list。
- diff 文件列表。
- issue / review 信息。
- 当前工作区统计信息。

这些能力适合移动端拆成：

- 首页当前工作区卡片。
- 工作区详情页。
- AI 对话页中的过程折叠卡。
- 代码/交付页中的 diff 与 issue 摘要。

## 12. 视觉与交互

### 12.1 背景与玻璃 UI

Web 当前使用：

- `src/asset/background/newBG.png` 作为主背景。
- 半透明玻璃卡片 `GlassPanel`。
- CSS blur、saturate、半透明描边和柔和阴影。
- 彩色 orb 品牌标识 `OrbMark`。

对应代码：

- `GlassPanel.tsx`
- `OrbMark.tsx`
- `styles/index.css`

### 12.2 Agent 头像

Web 已实现 Agent 头像：

- Orchestrator 使用 orb 标识。
- User 使用用户图标。
- 子 Agent 使用 DiceBear 机器人头像，按 agentId 稳定生成。
- engineer / reviewer / product-manager 有不同背景色调。

对应代码：

- `AgentAvatar.tsx`

### 12.3 状态标签

Web 有统一 `StatusPill`。

状态 tone：

- running
- success
- ready
- failed
- muted

用于：

- 后端连接。
- workspace runtime。
- running agents。
- pinned/archived。
- review verdict。
- delivery status。

## 13. Web 端已接入接口总览

### 13.1 工作台与健康状态

- `GET /api/health`
- `GET /api/workbench`

### 13.2 Agent

- `GET /api/agents`
- `GET /api/agents/:agentId`
- `POST /api/agents`
- `PATCH /api/agents/:agentId`
- `DELETE /api/agents/:agentId`

### 13.3 项目与工作区

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId/metadata`
- `PUT /api/projects/:projectId/pin`
- `DELETE /api/projects/:projectId/pin`
- `PUT /api/projects/:projectId/archive`
- `DELETE /api/projects/:projectId/archive`

### 13.4 项目状态、文件、消息

- `GET /api/projects/:projectId/state`
- `GET /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content?path=`
- `PUT /api/projects/:projectId/files`
- `GET /api/projects/:projectId/diff`
- `POST /api/projects/:projectId/messages/stream`

### 13.5 预览与交付

- `GET /api/projects/:projectId/preview-targets`
- `GET /api/projects/:projectId/preview-capability`
- `POST /api/projects/:projectId/preview-build?force=true`
- `POST /api/projects/:projectId/versions`
- `GET /api/projects/:projectId/versions`
- `GET /api/projects/:projectId/version-diff?v1=&v2=`
- `GET /api/projects/:projectId/source.zip?versionId=`
- `POST /api/projects/:projectId/builds`
- `POST /api/projects/:projectId/deploy`
- `GET /api/workspaces/:workspaceId/zip`
- `/preview/*`
- `/build-preview/*`
- `/deploy/*`

## 14. 移动端迁移建议

### 14.1 建议完整迁移

- 工作区概览。
- 工作区搜索、筛选、排序。
- 群聊/单聊消息流。
- 发送消息。
- SSE 流式回复。
- 本轮过程卡。
- 产物摘要卡。
- Agent 列表和基础管理。
- 当前工作区最新事件。

### 14.2 建议移动端降级展示

- Monaco 代码编辑器：移动端改成只读文件摘要和轻量代码查看。
- 完整 patch diff：移动端展示 diff 摘要和关键文件，完整 diff 可跳 Web。
- iframe 预览：移动端用 WebView 或缩略图，失败时提供外部打开。
- Agent 复杂权限表单：移动端先做关键字段编辑，复杂配置可跳 Web。
- 版本 diff：移动端先展示版本列表和差异摘要。

### 14.3 不建议首版移动端承载

- 桌面级代码编辑。
- 大型长日志阅读。
- 多窗口 artifact dialog。
- 完整 build log 和复杂部署配置。
- 复杂 Agent routingProfile 全字段编辑。

## 15. 总结

当前 Web 端已经是一个较完整的多 Agent 项目工作台，主要成熟能力包括：

- 多工作区管理。
- 群聊/单聊协作。
- Agent 路由和 @ 指定。
- 流式回复。
- 结构化任务过程展示。
- 产物卡片和详情。
- 代码文件树与只读代码查看。
- diff、预览、zip、版本、构建和部署。
- Agent 注册表管理。

移动端 App 首版应围绕“状态总览 + 轻量协作 + 过程追踪 + 产物摘要”设计，而不是完整复刻桌面代码工作台。
