# AgentHub 移动端 App 接口对接文档

本文档面向 `agentHubApp` 接入真实业务后端时使用，区分三类接口：

- 当前可直接接入的业务接口。
- 当前不建议 App 使用的接口。
- 后续建议补充的移动端聚合接口。

核心原则：Web 和 App 不各自复制一整套业务接口。写操作共用核心业务接口；移动端只在读多、聚合重、需要降载时补 `/api/mobile/**` 聚合接口。

## 1. 接入前提

默认业务后端地址：

```text
本地：http://127.0.0.1:8790
服务器：http://120.79.130.49:8790
```

配置：

```text
EXPO_PUBLIC_AGENTHUB_BACKEND_URL=http://120.79.130.49:8790
```

SSE 接口需要 React Native 侧选择 `EventSource` polyfill 或支持 stream 的 fetch 方案。

字段标记约定：

- `必填`：App 请求时必须传，或后端响应中正常情况下稳定返回。
- `可选`：App 可以不传；后端响应中可能不存在、为 `null`，或为空数组。
- 路径参数如 `:projectId`、`:agentId`、`:messageId` 均为必填。
- 后端开启了请求字段白名单校验，请求体里不要传未列出的字段；响应里的 runtime 对象可能携带额外字段，App adapter 只读取本文档列出的字段。

## 2. 当前可直接接入接口

### 2.1 系统健康检查

```text
GET /api/health
```

请求字段：无路径参数、无查询参数、无请求体。

响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ok` | `boolean` | 必填 | 健康检查是否通过。 |
| `service` | `string` | 必填 | 服务标识，当前为 `agenthub-backend`。 |
| `agentHubBaseUrl` | `string` | 可选 | AgentHub runtime 地址，取决于后端环境变量。 |
| `storageRoot` | `string` | 可选 | 后端存储根目录，取决于后端环境变量。 |

用途：

- App 启动时判断业务后端是否在线。
- 展示后端连接状态。

移动端使用建议：

- 启动后拉一次。
- 下拉刷新失败时可再拉一次，用于区分业务错误和后端不可用。

### 2.2 工作台 / 工作区列表

```text
GET /api/workbench
```

查询参数：

| 参数 | 类型 | 必填 | 默认值 | App 用法 |
| --- | --- | --- | --- | --- |
| `pageSize` | `number` | 可选 | `20` | 工作区列表分页大小，建议 20。 |
| `limit` | `number` | 可选 | `20` | `pageSize` 的兼容别名；App 优先用 `pageSize`。 |
| `cursor` | `string` | 可选 | 无 | 下一页游标，首次加载不传。 |
| `query` | `string` | 可选 | 无 | 搜索关键词。 |
| `q` | `string` | 可选 | 无 | `query` 的兼容别名；App 优先用 `query`。 |
| `status` | `active \| archived \| all` | 可选 | `active` | 工作区筛选。 |
| `sortBy` | `updatedAt \| createdAt \| name` | 可选 | `updatedAt` | 排序字段。 |
| `sortDirection` | `asc \| desc` | 可选 | `desc` | 排序方向。 |

主要响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `agents` | `Agent[]` | 必填 | 全局 Agent 定义列表，可为空数组。 |
| `rooms` | `WorkbenchRoom[]` | 必填 | 工作区房间摘要列表，可为空数组。 |
| `page` | `object` | 必填 | 分页信息。 |
| `page.limit` | `number` | 必填 | 本次返回使用的分页大小。 |
| `page.total` | `number` | 必填 | 符合条件的总数量。 |
| `page.hasMore` | `boolean` | 必填 | 是否还有下一页。 |
| `page.nextCursor` | `string` | 可选 | 下一页游标，没有下一页时不存在。 |
| `page.status` | `active \| archived \| all` | 可选 | 本次筛选状态。 |
| `page.sortBy` | `updatedAt \| createdAt \| name` | 可选 | 本次排序字段。 |
| `page.sortDirection` | `asc \| desc` | 可选 | 本次排序方向。 |
| `page.query` | `string` | 可选 | 本次搜索关键词。 |

`rooms[]` 主要字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | runtime workspace id，App 可作为工作区卡片 id。 |
| `kind` | `group \| direct` | 必填 | 群聊或单聊。 |
| `title` | `string` | 必填 | 工作区标题。 |
| `subtitle` | `string` | 必填 | 工作区副标题或目标摘要。 |
| `workspace` | `object` | 必填 | 工作区详情，包含 `projectId`、`pinnedAt`、`archivedAt` 等业务字段。 |
| `conversation` | `object` | 必填 | 当前房间对应会话。 |
| `participantAgentIds` | `string[]` | 必填 | 参与该房间的 Agent id 列表。 |
| `targetAgentId` | `string` | 可选 | 单聊目标 Agent 或业务记录中的目标 Agent。 |
| `signal` | `object` | 必填 | 工作区轻量状态。 |
| `signal.runningAgents` | `number` | 必填 | 运行中的 Agent 数。 |
| `signal.latestEventLabel` | `string` | 必填 | 最新事件展示文案。 |
| `signal.artifactCount` | `number` | 必填 | 产物数量。 |
| `signal.messageCount` | `number` | 必填 | 消息数量。 |
| `lastActivityAt` | `string` | 必填 | 最近活动时间，ISO 字符串。 |

移动端可映射字段：

| App 字段 | 后端来源 |
| --- | --- |
| 工作区列表 | `rooms[]` |
| 工作区标题 | `rooms[].title` |
| 工作区目标 | `rooms[].subtitle` 或 `rooms[].workspace.goal` |
| 群聊/单聊 | `rooms[].kind` |
| 参与 Agent | `rooms[].participantAgentIds` |
| 运行中 Agent 数 | `rooms[].signal.runningAgents` |
| 产物数 | `rooms[].signal.artifactCount` |
| 消息数 | `rooms[].signal.messageCount` |
| 最新事件 | `rooms[].signal.latestEventLabel` |
| 置顶状态 | `rooms[].workspace.pinnedAt` |
| 归档状态 | `rooms[].workspace.archivedAt` |

可支撑页面：

- 工作台首页。
- 工作区搜索。
- 工作区筛选。
- 当前活跃工作区卡片。
- 最近更新工作区列表。

### 2.3 创建工作区

```text
POST /api/projects
```

请求示例：

```json
{
  "name": "投票小程序",
  "goal": "做一个候选人投票系统",
  "workspaceType": "dev",
  "conversationType": "group",
  "agentIds": ["product-manager", "engineer", "reviewer"]
}
```

请求体字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 必填 | 无 | 工作区名称，最长 120 字符。 |
| `goal` | `string` | 必填 | 无 | 工作区目标，最长 4000 字符。 |
| `workspaceType` | `dev \| research \| writing \| chat` | 可选 | `dev` | 工作区类型；单聊会被后端规范为 `chat`。 |
| `conversationType` | `group \| direct` | 可选 | `group` | 创建群聊或单聊工作区。 |
| `agentIds` | `string[]` | 可选 | 无 | 目标 Agent id 列表；单聊时取第一个有效值，未传则默认 `engineer`。当前群聊创建不按该字段筛选参与 Agent。 |
| `workspaceId` | `string` | 可选 | 无 | 绑定已有 runtime workspace 的高级字段，App 首版不建议传。 |
| `conversationId` | `string` | 可选 | 无 | 绑定已有 runtime conversation 的高级字段，通常和 `workspaceId` 一起使用。 |

主要响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id，后续所有 `/api/projects/:projectId/**` 接口使用。 |
| `workspaceId` | `string` | 必填 | runtime workspace id。 |
| `name` | `string` | 必填 | 项目名称。 |
| `goal` | `string` | 必填 | 项目目标。 |
| `conversationId` | `string` | 必填 | 默认会话 id；如果后端没有绑定会返回空字符串。 |
| `conversationType` | `group \| direct` | 可选 | 会话类型。 |
| `targetAgentId` | `string` | 可选 | 单聊目标 Agent id。 |
| `agentHubPreviewUrl` | `string` | 必填 | runtime 预览入口。 |
| `agentHubZipUrl` | `string` | 必填 | runtime 源码 zip 入口。 |
| `pinnedAt` | `string` | 可选 | 已置顶时存在，ISO 字符串。 |
| `archivedAt` | `string` | 可选 | 已归档时存在，ISO 字符串。 |
| `createdAt` | `string` | 必填 | 创建时间，ISO 字符串。 |
| `updatedAt` | `string` | 必填 | 更新时间，ISO 字符串。 |

移动端使用建议：

- 创建群聊工作区：`conversationType=group`。
- 创建单聊工作区：`conversationType=direct`，`agentIds` 只传目标 Agent。
- 创建成功后刷新 `/api/workbench`，并进入新项目对应的对话页。

### 2.4 置顶和归档

批量元数据接口：

```text
PATCH /api/projects/:projectId/metadata
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

请求示例：

```json
{
  "pinned": true,
  "archived": false
}
```

请求体字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `pinned` | `boolean` | 可选 | 不变更 | `true` 置顶，`false` 取消置顶。 |
| `archived` | `boolean` | 可选 | 不变更 | `true` 归档，`false` 取消归档。 |

说明：`pinned` 和 `archived` 至少传一个才有实际效果；两者都不传时接口仍会返回项目，但不会改变状态。

也可以使用专用接口：

```text
PUT    /api/projects/:projectId/pin
DELETE /api/projects/:projectId/pin
PUT    /api/projects/:projectId/archive
DELETE /api/projects/:projectId/archive
```

专用接口只有 `projectId` 路径参数，均无请求体；响应字段与 `POST /api/projects` 返回的项目对象一致。

移动端使用建议：

- App 内优先用 `PATCH /metadata`，一次更新多个轻量状态。
- 操作后更新本地列表状态，并后台刷新 `/api/workbench`。

### 2.5 项目状态 / 对话主数据

```text
GET /api/projects/:projectId/state?messagePageSize=80
GET /api/projects/:projectId/state?messagePageSize=80&messageCursor=eyJvZmZzZXQiOjQwfQ
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `messagePageSize` | `number` | 可选 | `40` | 单页消息数量，最小 1，最大按 200 截断。 |
| `messageCursor` | `string` | 可选 | 无 | 更早消息页游标；首次拉取不传，后续传上一次响应里的 `messagePage.nextCursor`。 |
| `messageLimit` | `number` | 可选 | `40` | 兼容旧参数，等价于不传 cursor 时的 `messagePageSize`。 |

主要响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state` | `object` | 必填 | 当前项目过滤后的 runtime 状态。 |
| `state.workspaces` | `Workspace[]` | 必填 | 当前工作区列表，通常只有一个元素。 |
| `state.conversations` | `Conversation[]` | 必填 | 当前工作区会话列表，可为空数组。 |
| `state.messages` | `Message[]` | 必填 | 当前消息页，按时间正序排列，可为空数组。 |
| `state.agents` | `Agent[]` | 必填 | 当前工作区可见 Agent 列表，可为空数组。 |
| `state.workspaceAgentMembers` | `object[]` | 必填 | 工作区 Agent 成员覆盖信息，可为空数组。 |
| `state.agentSessions` | `object[]` | 必填 | Agent 会话列表，可为空数组。 |
| `state.agentSessionMessages` | `object[]` | 必填 | Agent 会话内部消息，可为空数组。 |
| `state.taskHandoffs` | `object[]` | 必填 | 任务交接记录，可为空数组。 |
| `state.agentRuns` | `object[]` | 必填 | Agent 运行记录，可为空数组。 |
| `state.artifacts` | `object[]` | 必填 | 产物列表，包含 runtime 产物和后端合成的交付产物，可为空数组。 |
| `state.changeSets` | `object[]` | 必填 | 变更集列表，可为空数组。 |
| `state.contextSnapshots` | `object[]` | 必填 | 上下文快照，可为空数组。 |
| `state.workflowEvents` | `object[]` | 必填 | 过程事件列表，可为空数组。 |
| `state.diagnosticLogs` | `object[]` | 必填 | 诊断日志，可为空数组。 |
| `messagePage` | `object` | 必填 | 消息分页摘要。 |
| `messagePage.limit` | `number` | 必填 | 本次使用的单页消息数量。 |
| `messagePage.total` | `number` | 必填 | 当前项目全部消息数量。 |
| `messagePage.hasMore` | `boolean` | 必填 | 是否还有更早消息。 |
| `messagePage.nextCursor` | `string` | 可选 | 下一页更早消息游标；`hasMore=false` 时通常为空。 |
| `messagePage.cursor` | `string` | 可选 | 本次请求使用的游标，首次页为空。 |
| `messagePage.offset` | `number` | 可选 | 当前页第一条消息在完整时间线中的偏移。 |
| `messagePage.endOffset` | `number` | 可选 | 当前页后一位偏移。 |

用途：

- 拉取当前工作区消息流。
- 拉取参与 Agent。
- 拉取 workflow 过程事件。
- 拉取产物、change set、诊断摘要。

移动端可映射字段：

| App 字段 | 后端来源 |
| --- | --- |
| 当前 workspace | `state.workspaces[0]` |
| 会话列表 | `state.conversations[]` |
| 消息流 | `state.messages[]` |
| Agent 列表 | `state.agents[]` |
| 过程事件 | `state.workflowEvents[]` |
| Agent 运行状态 | `state.agentRuns[]` |
| 产物卡 | `state.artifacts[]` |
| 变更集 | `state.changeSets[]` |
| 分页信息 | `messagePage` |

注意：

- 首次进入会话不传 `messageCursor`，接口返回最新一页消息。
- 上拉加载历史时继续请求同一接口，并传 `messageCursor=messagePage.nextCursor`。
- 每页最大 200；旧的 `messageLimit` 仍保留兼容，但新接入建议使用 `messagePageSize`。
- `state.messages[]` 和 `state.artifacts[]` 会包含业务后端合成的本地交付消息和 artifact。

### 2.6 发送消息和流式回复

```text
POST /api/projects/:projectId/messages/stream
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

请求示例：

```json
{
  "content": "@engineer 帮我检查当前页面适配",
  "conversationId": "conv-xxx",
  "agentId": "engineer",
  "replyTo": {
    "messageId": "msg-xxx",
    "senderId": "engineer",
    "senderName": "工程师 Agent",
    "excerpt": "上一条消息摘要"
  }
}
```

请求体字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `content` | `string` | 必填 | 无 | 用户发送的消息内容，最长 20000 字符。 |
| `conversationId` | `string` | 可选 | 项目默认会话 | 指定会话 id；普通场景不传。 |
| `agentId` | `string` | 可选 | 自动路由 | 明确指定目标 Agent。 |
| `replyTo` | `object` | 可选 | 无 | 引用回复信息。 |
| `codeSelection` | `object` | 可选 | 无 | 代码选区引用，App 首版可不接。 |

`replyTo` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `messageId` | `string` | 必填 | 被引用消息 id。 |
| `senderId` | `string` | 必填 | 被引用消息发送者 id。 |
| `senderName` | `string` | 可选 | 被引用消息发送者展示名。 |
| `excerpt` | `string` | 必填 | 被引用内容摘要。 |

`codeSelection` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `filePath` | `string` | 必填 | 仓库相对文件路径。 |
| `selectedText` | `string` | 必填 | 选中的代码文本。 |
| `startLine` | `number` | 必填 | 起始行，从 1 开始。 |
| `startColumn` | `number` | 必填 | 起始列，从 1 开始。 |
| `endLine` | `number` | 必填 | 结束行，从 1 开始。 |
| `endColumn` | `number` | 必填 | 结束列，从 1 开始。 |
| `language` | `string` | 可选 | 代码语言。 |
| `beforeContext` | `string` | 可选 | 选区前上下文。 |
| `afterContext` | `string` | 可选 | 选区后上下文。 |

移动端使用建议：

- 普通群聊消息只传 `content`。
- 单聊或明确指定 Agent 时传 `agentId`。
- 引用回复时传 `replyTo`。
- 代码选区引用不是首版 App 必需能力，可暂不接。

响应：

```text
text/event-stream; charset=utf-8
```

App 侧需要处理：

- 连接中。
- assistant delta。
- workflow event。
- 完成。
- 失败和重试。

### 2.7 消息 Pin

```text
PUT    /api/projects/:projectId/messages/:messageId/pin
DELETE /api/projects/:projectId/messages/:messageId/pin
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |
| `messageId` | `string` | 必填 | 要置顶或取消置顶的消息 id。 |

请求体：无。

响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `workspaceId` | `string` | 必填 | runtime workspace id。 |
| `pinnedMessageIds` | `string[]` | 必填 | 更新后的置顶消息 id 列表。 |

用途：

- 把重要消息加入工作区长期上下文。
- 首版 App 可以先不做 UI，后续放在消息长按菜单里。

### 2.8 Agent 读取和轻管理

全局读取：

```text
GET /api/agents
GET /api/agents/:agentId
```

项目级读取和管理：

```text
GET    /api/projects/:projectId/agents
GET    /api/projects/:projectId/agents/:agentId
POST   /api/projects/:projectId/agents
PATCH  /api/projects/:projectId/agents/:agentId
DELETE /api/projects/:projectId/agents/:agentId
```

移动端使用建议：

- Agent 首页如果没有选中项目，可以先用 `GET /api/agents` 展示内置 Agent。
- 进入具体工作区后，用 `GET /api/projects/:projectId/agents` 展示该 workspace 可见 Agent。
- 移动端编辑 Agent 时必须走项目级接口。
- 内置 Agent 只允许在工作区内覆盖 `name`、`modelProvider`、`model`。
- 自建 Agent 可编辑基础字段，App 首版建议限制为 `name`、`role`、`description`、`modelProvider`、`model`、`skills`。

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 可选 | 仅项目级接口必填。 |
| `agentId` | `string` | 可选 | 仅单 Agent 读取、更新、删除接口必填。 |

`POST /api/projects/:projectId/agents` 请求体字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 必填 | 无 | Agent 展示名，最长 120 字符。 |
| `systemPrompt` | `string` | 必填 | 无 | Agent 系统提示词，最长 20000 字符。 |
| `id` | `string` | 可选 | 后端生成或 runtime 处理 | Agent id，最长 80 字符。 |
| `role` | `string` | 可选 | 无 | 角色摘要，最长 240 字符。 |
| `description` | `string` | 可选 | 无 | 描述，最长 1000 字符。 |
| `whenToUse` | `string` | 可选 | 无 | 使用场景，最长 1000 字符。 |
| `modelProvider` | `claude \| codex \| mock` | 可选 | runtime 默认 | 模型提供方。 |
| `model` | `string` | 可选 | runtime 默认 | 模型名，最长 120 字符。 |
| `contextPolicy` | `object` | 可选 | runtime 默认 | 上下文策略。 |
| `tools` | `string[]` | 可选 | runtime 默认 | 允许工具列表。 |
| `permissions` | `object` | 可选 | runtime 默认 | 权限配置。 |
| `disallowedTools` | `string[]` | 可选 | runtime 默认 | 禁用工具列表。 |
| `permissionMode` | `readonly \| ask \| acceptEdits \| dangerous` | 可选 | runtime 默认 | 权限模式。 |
| `runtimePolicy` | `object` | 可选 | runtime 默认 | 运行策略。 |
| `outputSchema` | `string` | 可选 | 无 | 输出格式约束，最长 4000 字符。 |
| `isolation` | `shared \| worktree` | 可选 | runtime 默认 | 运行隔离模式。 |
| `skills` | `string[]` | 可选 | 无 | 技能标签。 |
| `routingProfile` | `object` | 可选 | runtime 默认 | 路由配置。 |

`PATCH /api/projects/:projectId/agents/:agentId` 请求体字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 可选 | Agent 展示名，最长 120 字符。 |
| `role` | `string` | 可选 | 角色摘要，最长 240 字符。 |
| `description` | `string` | 可选 | 描述，最长 1000 字符。 |
| `whenToUse` | `string` | 可选 | 使用场景，最长 1000 字符。 |
| `systemPrompt` | `string` | 可选 | 系统提示词，最长 20000 字符。 |
| `modelProvider` | `claude \| codex \| mock` | 可选 | 模型提供方。 |
| `model` | `string` | 可选 | 模型名，最长 120 字符。 |
| `contextPolicy` | `object` | 可选 | 上下文策略。 |
| `tools` | `string[]` | 可选 | 允许工具列表。 |
| `permissions` | `object` | 可选 | 权限配置。 |
| `disallowedTools` | `string[]` | 可选 | 禁用工具列表。 |
| `permissionMode` | `readonly \| ask \| acceptEdits \| dangerous` | 可选 | 权限模式。 |
| `runtimePolicy` | `object` | 可选 | 运行策略。 |
| `outputSchema` | `string` | 可选 | 输出格式约束，最长 4000 字符。 |
| `isolation` | `shared \| worktree` | 可选 | 运行隔离模式。 |
| `skills` | `string[]` | 可选 | 技能标签。 |
| `routingProfile` | `object` | 可选 | 路由配置。 |

Agent 主要响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | Agent id。 |
| `name` | `string` | 可选 | 展示名。 |
| `modelProvider` | `string` | 可选 | 模型提供方。 |
| `model` | `string` | 可选 | 模型名。 |
| `source` | `built-in \| workspace \| custom` | 可选 | Agent 来源。 |
| `workspaceId` | `string` | 可选 | 工作区自建或覆盖 Agent 所属 workspace。 |
| `role`、`description`、`skills` 等 | 多类型 | 可选 | runtime 可能返回的扩展字段，App 按需读取。 |

说明：`GET /api/agents` 和 `GET /api/projects/:projectId/agents` 返回 `Agent[]`；单 Agent 接口返回 `Agent`；删除接口返回 runtime 删除结果，App 侧通常只需要本地移除并刷新列表。

### 2.9 文件摘要和文件内容

```text
GET /api/projects/:projectId/files
GET /api/projects/:projectId/files/content?path=src/App.tsx
GET /api/projects/:projectId/files/preview?path=docs/report.docx
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

查询参数：

| 接口 | 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `GET /files` | 无 | - | - | 拉取文件树不需要查询参数。 |
| `GET /files/content` | `path` | `string` | 必填 | 仓库相对路径，只用于文本文件内容读取。 |
| `GET /files/preview` | `path` | `string` | 必填 | 仓库相对路径，只支持 PDF、DOCX、PPTX。 |

`GET /files` 响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `rootLabel` | `string` | 必填 | 文件树根节点展示名。 |
| `entries` | `ProjectFileNode[]` | 必填 | 文件树节点列表，可为空数组。 |

`ProjectFileNode` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | `string` | 必填 | 仓库相对路径。 |
| `name` | `string` | 必填 | 文件或目录名。 |
| `kind` | `directory \| file` | 必填 | 节点类型。 |
| `isText` | `boolean` | 必填 | 是否可按文本读取。 |
| `byteLength` | `number` | 可选 | 文件大小，目录通常没有。 |
| `language` | `string` | 可选 | 文本语言标识。 |
| `children` | `ProjectFileNode[]` | 可选 | 子节点，目录可能存在。 |

`GET /files/content` 响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | `string` | 必填 | 仓库相对路径。 |
| `name` | `string` | 必填 | 文件名。 |
| `content` | `string` | 必填 | UTF-8 文本内容。 |
| `language` | `string` | 必填 | 语言标识。 |
| `byteLength` | `number` | 必填 | 文件大小。 |
| `updatedAt` | `string` | 必填 | 文件更新时间，ISO 字符串。 |
| `lineCount` | `number` | 必填 | 行数。 |

`GET /files/preview` 响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | `pdf \| docx \| pptx` | 必填 | 预览文件类型。 |
| `path` | `string` | 必填 | 仓库相对路径。 |
| `name` | `string` | 必填 | 文件名。 |
| `byteLength` | `number` | 必填 | 文件大小。 |
| `updatedAt` | `string` | 必填 | 文件更新时间，ISO 字符串。 |
| `sourceUrl` | `string` | 必填 | 可打开或渲染的预览源 URL。 |
| `summary` | `string` | 必填 | 预览说明。 |

移动端使用建议：

- 文件页首屏用 `files` 展示文件树摘要。
- 点击文本文件时再请求 `files/content`。
- PDF、DOCX、PPTX 用 `files/preview` 做轻量预览。
- App 不做文件写入；`PUT /api/projects/:projectId/files` 留给 Web。

### 2.10 Diff 摘要

```text
GET /api/projects/:projectId/diff
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

返回：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `baseCommit` | `string` | 必填 | diff 对比的基础 commit。 |
| `status` | `string` | 必填 | git status 摘要。 |
| `patch` | `string` | 必填 | unified diff 文本，可能为空字符串。 |

移动端使用建议：

- 首版只展示 `status` 和简单统计。
- 如果要新增/删除行数、关键文件列表，需要 App 解析 patch，或后续补移动端 diff summary 接口。

### 2.11 预览状态

```text
GET /api/projects/:projectId/preview-capability
POST /api/projects/:projectId/preview-build?force=true
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

`POST /preview-build` 查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `force` | `boolean` | 可选 | `false` | 是否强制重新构建。 |

`GET /preview-capability` 和 `POST /preview-build` 主要响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | `static \| module-shell \| build \| unsupported` | 必填 | 当前预览模式。 |
| `framework` | `static-html \| vanilla-module \| vite-react \| vite-vue \| vite-svelte \| vite \| angular \| unsupported` | 必填 | 检测到的前端框架。 |
| `reason` | `string` | 必填 | 检测原因或不可预览原因。 |
| `sourceHash` | `string` | 必填 | 当前源码 hash。 |
| `entryPath` | `string` | 可选 | 入口文件路径。 |
| `defaultTargetPath` | `string` | 可选 | 默认预览目标路径。 |
| `targets` | `ProjectPreviewRenderableTarget[]` | 必填 | 可打开的预览目标列表，可为空数组。 |
| `build` | `ProjectPreviewBuildState` | 可选 | build 模式下的构建状态。 |

`targets[]` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | `string` | 必填 | 预览目标路径。 |
| `url` | `string` | 必填 | 可打开的预览 URL。 |
| `source` | `runtime \| module-shell \| build` | 必填 | 预览来源。 |

`build` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | `idle \| running \| success \| failed` | 必填 | 构建状态。 |
| `sourceHash` | `string` | 必填 | 构建对应源码 hash。 |
| `summary` | `string` | 必填 | 构建摘要。 |
| `buildId` | `string` | 可选 | 构建任务 id。 |
| `installCommand` | `string` | 可选 | 依赖安装命令。 |
| `buildCommand` | `string` | 可选 | 构建命令。 |
| `startedAt` | `string` | 可选 | 开始时间，ISO 字符串。 |
| `finishedAt` | `string` | 可选 | 结束时间，ISO 字符串。 |
| `logExcerpt` | `string` | 可选 | 构建日志摘要。 |
| `error` | `string` | 可选 | 失败错误信息。 |

移动端首版建议：

- 只读展示 `mode`、`framework`、`build.status`、`targets[]`。
- 不在 App 触发 `preview-build`，除非后续明确允许。
- 真机打开 `targets[].url` 前要确认后端 base URL 是手机可访问地址。

### 2.12 交付只读摘要

```text
GET /api/projects/:projectId/delivery
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

主要响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |
| `currentVersion` | `object` | 可选 | 当前源码版本摘要，没有保存版本时不存在。 |
| `sourceArchive` | `ProjectDeliveryAssetSummary` | 必填 | 源码快照状态。 |
| `build` | `ProjectDeliveryAssetSummary` | 必填 | 交付构建状态。 |
| `deployment` | `ProjectDeliveryAssetSummary` | 必填 | 本地部署状态。 |

`currentVersion` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `versionId` | `string` | 必填 | 当前版本 id。 |
| `createdAt` | `string` | 必填 | 创建时间，ISO 字符串。 |
| `updatedAt` | `string` | 必填 | 更新时间，ISO 字符串。 |

`ProjectDeliveryAssetSummary` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | `idle \| ready \| failed` | 必填 | 资产状态。 |
| `summary` | `string` | 必填 | 展示摘要。 |
| `versionId` | `string` | 可选 | 关联版本 id。 |
| `url` | `string` | 可选 | 源码、构建预览或部署 URL。 |
| `createdAt` | `string` | 可选 | 创建时间，ISO 字符串。 |
| `updatedAt` | `string` | 可选 | 更新时间，ISO 字符串。 |
| `log` | `string` | 可选 | 构建日志或失败信息。 |

移动端可展示：

- 当前源码版本状态。
- 最近一次构建状态。
- 最近一次部署状态。
- 简短失败信息。

移动端不做：

- 保存版本。
- 下载源码 zip。
- 触发构建。
- 触发部署。

## 3. 当前不建议 App 使用的接口

### 3.1 全局 Agent 写接口

不要在 App 中使用：

```text
POST   /api/agents
PATCH  /api/agents/:agentId
DELETE /api/agents/:agentId
```

字段说明：

| 接口 | 路径参数 | 请求体字段 | 说明 |
| --- | --- | --- | --- |
| `POST /api/agents` | 无 | 同项目级 `POST /api/projects/:projectId/agents`，其中 `name`、`systemPrompt` 必填 | 不建议 App 使用。 |
| `PATCH /api/agents/:agentId` | `agentId` 必填 | 同项目级 `PATCH /api/projects/:projectId/agents/:agentId`，所有字段可选 | 不建议 App 使用。 |
| `DELETE /api/agents/:agentId` | `agentId` 必填 | 无 | 不建议 App 使用。 |

原因：

- 当前这些接口只是兼容保留路由。
- Runtime 不允许通过全局接口创建、编辑、删除 Agent。
- App 应使用项目级 Agent 接口。

### 3.2 版本、构建、部署写接口

移动端首版不要使用：

```text
POST /api/projects/:projectId/versions
POST /api/projects/:projectId/builds
POST /api/projects/:projectId/deploy
POST /api/projects/:projectId/versions/:versionId/restore
```

字段说明：

| 接口 | 路径参数 | 查询参数 | 请求体字段 |
| --- | --- | --- | --- |
| `POST /api/projects/:projectId/versions` | `projectId` 必填 | 无 | `versionId` 可选，`message` 可选，`requireAgentGate` 可选。 |
| `POST /api/projects/:projectId/builds` | `projectId` 必填 | 无 | `versionId` 可选，`skipDocker` 可选，`installCommand` 可选，`buildCommand` 可选。 |
| `POST /api/projects/:projectId/deploy` | `projectId` 必填 | 无 | `versionId` 可选。 |
| `POST /api/projects/:projectId/versions/:versionId/restore` | `projectId`、`versionId` 必填 | 无 | `createSnapshotBeforeRestore` 可选，`message` 可选。 |

原因：

- 属于工程交付链路，更适合 Web 工作台。
- 手机端误触成本高。
- 构建日志和失败排查不适合移动端首版。

App 只读使用：

```text
GET /api/projects/:projectId/delivery
```

### 3.3 当前没有实现的旧规划接口

不要依赖：

```text
GET /api/projects/:projectId/conversations
GET /api/projects/:projectId/conversations/:conversationId/messages
GET /api/projects/:projectId/events
GET /api/projects/:projectId/artifacts
GET /api/projects/:projectId/builds
GET /api/projects/:projectId/deployments
```

当前应从 `GET /api/projects/:projectId/state` 或 `GET /api/workbench` 读取聚合数据。

## 4. App Mock 数据替换映射

当前 `agentHubApp/src/data/mockData.ts` 可按以下方式替换：

| Mock 类型 | 后端来源 | 备注 |
| --- | --- | --- |
| `Workspace` | `/api/workbench` 的 `rooms[]` | App adapter 负责字段转换。 |
| `Agent` | `/api/agents` 或 `/api/projects/:projectId/agents` | `status` 需要从运行态推导。 |
| `ChatMessage` | `/api/projects/:projectId/state` 的 `state.messages[]` | 需要兼容 system/user/agent 消息。 |
| `ProcessStep` | `state.workflowEvents[]` | App adapter 按 event type 归纳。 |
| `Artifact` | `state.artifacts[]` | 类型映射为 preview/diff/review/text。 |
| `CodeFile` | `/files` + `/diff` | 变更状态需要从 diff status 或 patch 推导。 |

建议新增 App 侧目录：

```text
agentHubApp/src/api/
  client.ts
  contracts.ts
  adapters.ts
  workbench.ts
  projects.ts
  agents.ts
```

## 5. 后续建议补充的移动端聚合接口

这些接口不是首版接入的硬前置，但能减少 App 端解析成本和过度拉取。

### 5.1 移动端工作台聚合

```text
GET /api/mobile/workbench
```

查询参数：建议首版无必填参数；后续如果需要分页，可复用 `/api/workbench` 的 `pageSize`、`cursor`、`query`、`status`。

建议返回：

```json
{
  "summary": {
    "workspaceCount": 12,
    "runningAgentCount": 3,
    "artifactCount": 28,
    "unreadCount": 4
  },
  "activeWorkspace": {},
  "pinnedRooms": [],
  "recentRooms": [],
  "archivedCount": 2,
  "latestActivities": []
}
```

建议响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `summary` | `object` | 必填 | 首页统计摘要。 |
| `summary.workspaceCount` | `number` | 必填 | 工作区总数。 |
| `summary.runningAgentCount` | `number` | 必填 | 运行中 Agent 数。 |
| `summary.artifactCount` | `number` | 必填 | 产物总数。 |
| `summary.unreadCount` | `number` | 可选 | 未读数；没有未读体系前可不返回。 |
| `activeWorkspace` | `WorkbenchRoom` | 可选 | 当前活跃工作区，没有时为 `null` 或不返回。 |
| `pinnedRooms` | `WorkbenchRoom[]` | 必填 | 置顶工作区列表，可为空数组。 |
| `recentRooms` | `WorkbenchRoom[]` | 必填 | 最近工作区列表，可为空数组。 |
| `archivedCount` | `number` | 必填 | 已归档工作区数量。 |
| `latestActivities` | `ActivityItem[]` | 必填 | 最近活动列表，可为空数组。 |

解决问题：

- 首页不用自己汇总所有 workbench rooms。
- 后端可以统一定义“当前活跃工作区”和“最近活动”。

优先级：P1。

### 5.2 移动端消息分页

```text
GET /api/mobile/projects/:projectId/chat?limit=40&cursor=xxx
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `limit` | `number` | 可选 | `40` | 单页消息数量。 |
| `cursor` | `string` | 可选 | 无 | 历史消息分页游标。 |

建议返回：

```json
{
  "workspace": {},
  "conversation": {},
  "messages": [],
  "processCards": [],
  "artifactCards": [],
  "page": {
    "nextCursor": "xxx",
    "hasMore": true
  }
}
```

建议响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `workspace` | `Workspace` | 必填 | 当前工作区。 |
| `conversation` | `Conversation` | 必填 | 当前会话。 |
| `messages` | `Message[]` | 必填 | 当前页消息，可为空数组。 |
| `processCards` | `object[]` | 必填 | 移动端过程卡片，可为空数组。 |
| `artifactCards` | `object[]` | 必填 | 移动端产物卡片，可为空数组。 |
| `page` | `object` | 必填 | 分页信息。 |
| `page.nextCursor` | `string` | 可选 | 下一页游标，没有下一页时不存在。 |
| `page.hasMore` | `boolean` | 必填 | 是否还有更早消息。 |

解决问题：

- 当前 `state` 只有最近消息数量限制，没有历史游标分页。
- App 对话页可做上拉加载历史。

优先级：P1。

### 5.3 移动端活动中心

```text
GET /api/mobile/activity?limit=50&cursor=xxx
```

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `limit` | `number` | 可选 | `50` | 单页活动数量。 |
| `cursor` | `string` | 可选 | 无 | 下一页游标。 |

建议返回：

```json
{
  "items": [
    {
      "id": "act-xxx",
      "projectId": "proj-xxx",
      "workspaceId": "ws-xxx",
      "type": "preview_ready",
      "title": "预览已就绪",
      "summary": "投票小程序生成了新的预览",
      "createdAt": "2026-06-01T10:00:00.000Z",
      "readAt": null
    }
  ],
  "page": {
    "nextCursor": "xxx",
    "hasMore": true
  }
}
```

建议响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `items` | `ActivityItem[]` | 必填 | 活动列表，可为空数组。 |
| `page` | `object` | 必填 | 分页信息。 |
| `page.nextCursor` | `string` | 可选 | 下一页游标，没有下一页时不存在。 |
| `page.hasMore` | `boolean` | 必填 | 是否还有下一页。 |

`ActivityItem` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 活动 id。 |
| `projectId` | `string` | 必填 | 业务项目 id。 |
| `workspaceId` | `string` | 必填 | runtime workspace id。 |
| `type` | `string` | 必填 | 活动类型，如 `preview_ready`。 |
| `title` | `string` | 必填 | 活动标题。 |
| `summary` | `string` | 可选 | 活动摘要。 |
| `createdAt` | `string` | 必填 | 创建时间，ISO 字符串。 |
| `readAt` | `string \| null` | 可选 | 已读时间；没有未读体系前可不返回。 |

解决问题：

- 当前没有通知、未读、提及中心。
- App 不需要自己扫描多个项目的 workflow events。

优先级：P1。

### 5.4 移动端 Agent 状态聚合

```text
GET /api/mobile/agents?projectId=proj-xxx
```

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `projectId` | `string` | 可选 | 无 | 指定项目时返回项目级 Agent 及运行态；不传时返回全局 Agent 聚合。 |

建议返回：

```json
{
  "agents": [
    {
      "id": "engineer",
      "name": "工程师 Agent",
      "role": "修改代码、生成 diff",
      "modelProvider": "codex",
      "model": "default",
      "source": "built-in",
      "status": "running",
      "skills": ["代码", "文件", "Diff"],
      "recentWorkspaceIds": ["ws-xxx"]
    }
  ]
}
```

建议响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `agents` | `MobileAgent[]` | 必填 | Agent 聚合列表，可为空数组。 |

`MobileAgent` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | Agent id。 |
| `name` | `string` | 必填 | 展示名。 |
| `role` | `string` | 可选 | 角色摘要。 |
| `modelProvider` | `claude \| codex \| mock` | 可选 | 模型提供方。 |
| `model` | `string` | 可选 | 模型名。 |
| `source` | `built-in \| workspace \| custom` | 可选 | Agent 来源。 |
| `status` | `idle \| running \| reviewing` | 必填 | 移动端聚合运行态。 |
| `skills` | `string[]` | 必填 | 技能标签，可为空数组。 |
| `recentWorkspaceIds` | `string[]` | 必填 | 最近参与工作区 id，可为空数组。 |

解决问题：

- `/api/agents` 是定义列表，不包含 App 需要的 `idle/running/reviewing` 聚合状态。
- App Agent 页不用自己遍历多个 project state。

优先级：P1。

### 5.5 移动端 Diff 摘要

```text
GET /api/mobile/projects/:projectId/diff-summary
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | `string` | 必填 | 业务项目 id。 |

建议返回：

```json
{
  "baseCommit": "abc123",
  "changedFileCount": 4,
  "additions": 128,
  "deletions": 36,
  "files": [
    {
      "path": "src/App.tsx",
      "status": "modified",
      "additions": 80,
      "deletions": 20,
      "language": "typescript"
    }
  ]
}
```

建议响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `baseCommit` | `string` | 必填 | diff 基础 commit。 |
| `changedFileCount` | `number` | 必填 | 变更文件数量。 |
| `additions` | `number` | 必填 | 新增行数。 |
| `deletions` | `number` | 必填 | 删除行数。 |
| `files` | `DiffSummaryFile[]` | 必填 | 文件级摘要，可为空数组。 |

`DiffSummaryFile` 字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | `string` | 必填 | 仓库相对路径。 |
| `status` | `added \| modified \| deleted \| renamed` | 必填 | 文件变更类型。 |
| `additions` | `number` | 必填 | 文件新增行数。 |
| `deletions` | `number` | 必填 | 文件删除行数。 |
| `language` | `string` | 可选 | 语言标识。 |

解决问题：

- 当前 `/diff` 返回 raw patch，手机端解析成本高。
- 产物详情页只需要摘要，不需要完整 patch。

优先级：P2。

### 5.6 移动端预览 URL 配置

```text
GET /api/mobile/config
```

请求字段：无路径参数、无查询参数、无请求体。

建议返回：

```json
{
  "backendBaseUrl": "http://192.168.x.x:8790",
  "previewBaseUrl": "http://192.168.x.x:8790",
  "sseSupported": true
}
```

建议响应字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `backendBaseUrl` | `string` | 必填 | 手机可访问的业务后端地址。 |
| `previewBaseUrl` | `string` | 必填 | 手机可访问的预览基础地址。 |
| `sseSupported` | `boolean` | 必填 | 当前后端和 App 配置是否支持 SSE。 |

解决问题：

- 真机 App 打开预览不能依赖 `127.0.0.1`。
- App 可以统一拼接 WebView URL。

优先级：P2。

## 6. 建议接入顺序

第一阶段直接接当前业务接口：

1. `GET /api/health`
2. `GET /api/workbench`
3. `POST /api/projects`
4. `PATCH /api/projects/:projectId/metadata`
5. `GET /api/projects/:projectId/state`
6. `POST /api/projects/:projectId/messages/stream`
7. `GET /api/projects/:projectId/agents`
8. `GET /api/projects/:projectId/files`
9. `GET /api/projects/:projectId/diff`
10. `GET /api/projects/:projectId/preview-capability`
11. `GET /api/projects/:projectId/delivery`

第二阶段补移动端聚合：

1. `GET /api/mobile/projects/:projectId/chat`
2. `GET /api/mobile/activity`
3. `GET /api/mobile/agents`
4. `GET /api/mobile/workbench`
5. `GET /api/mobile/projects/:projectId/diff-summary`
6. `GET /api/mobile/config`

## 7. 当前结论

当前业务接口已经可以支撑 `agentHubApp` 首版从 mock 数据切换到真实数据。

短期不需要单独给 App 复制一套业务接口。真正需要补的是移动端读聚合接口，尤其是消息分页、活动中心、Agent 状态聚合和 Diff 摘要。
