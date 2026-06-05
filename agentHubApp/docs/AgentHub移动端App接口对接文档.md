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
服务器`：http://120.79.130.49:8790
```

配置：

```text
EXPO_PUBLIC_AGENTHUB_BACKEND_URL=http:120.79.130.49//:8790
```

SSE 接口需要 React Native 侧选择 `EventSource` polyfill 或支持 stream 的 fetch 方案。

## 2. 当前可直接接入接口

### 2.1 系统健康检查

```text
GET /api/health
```

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

| 参数 | 类型 | App 用法 |
| --- | --- | --- |
| `pageSize` | `number` | 工作区列表分页大小，建议 20。 |
| `cursor` | `string` | 下一页游标。 |
| `query` | `string` | 搜索关键词。 |
| `status` | `active \| archived \| all` | 工作区筛选。 |
| `sortBy` | `updatedAt \| createdAt \| name` | 排序字段。 |
| `sortDirection` | `asc \| desc` | 排序方向。 |

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

移动端使用建议：

- 创建群聊工作区：`conversationType=group`。
- 创建单聊工作区：`conversationType=direct`，`agentIds` 只传目标 Agent。
- 创建成功后刷新 `/api/workbench`，并进入新项目对应的对话页。

### 2.4 置顶和归档

批量元数据接口：

```text
PATCH /api/projects/:projectId/metadata
```

请求示例：

```json
{
  "pinned": true,
  "archived": false
}
```

也可以使用专用接口：

```text
PUT    /api/projects/:projectId/pin
DELETE /api/projects/:projectId/pin
PUT    /api/projects/:projectId/archive
DELETE /api/projects/:projectId/archive
```

移动端使用建议：

- App 内优先用 `PATCH /metadata`，一次更新多个轻量状态。
- 操作后更新本地列表状态，并后台刷新 `/api/workbench`。

### 2.5 项目状态 / 对话主数据

```text
GET /api/projects/:projectId/state?messageLimit=80
```

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

- 当前只支持最近消息数量限制，最大 200。
- 暂无消息游标分页；如果 App 要完整历史滚动，后续需要补充移动端消息分页接口。
- `state.messages[]` 和 `state.artifacts[]` 会包含业务后端合成的本地交付消息和 artifact。

### 2.6 发送消息和流式回复

```text
POST /api/projects/:projectId/messages/stream
```

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

### 2.9 文件摘要和文件内容

```text
GET /api/projects/:projectId/files
GET /api/projects/:projectId/files/content?path=src/App.tsx
GET /api/projects/:projectId/files/preview?path=docs/report.docx
```

移动端使用建议：

- 文件页首屏用 `files` 展示文件树摘要。
- 点击文本文件时再请求 `files/content`。
- PDF、DOCX、PPTX 用 `files/preview` 做轻量预览。
- App 不做文件写入；`PUT /api/projects/:projectId/files` 留给 Web。

### 2.10 Diff 摘要

```text
GET /api/projects/:projectId/diff
```

返回：

- `baseCommit`
- `status`
- `patch`

移动端使用建议：

- 首版只展示 `status` 和简单统计。
- 如果要新增/删除行数、关键文件列表，需要 App 解析 patch，或后续补移动端 diff summary 接口。

### 2.11 预览状态

```text
GET /api/projects/:projectId/preview-capability
POST /api/projects/:projectId/preview-build?force=true
```

移动端首版建议：

- 只读展示 `mode`、`framework`、`build.status`、`targets[]`。
- 不在 App 触发 `preview-build`，除非后续明确允许。
- 真机打开 `targets[].url` 前要确认后端 base URL 是手机可访问地址。

### 2.12 交付只读摘要

```text
GET /api/projects/:projectId/delivery
```

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

解决问题：

- 首页不用自己汇总所有 workbench rooms。
- 后端可以统一定义“当前活跃工作区”和“最近活动”。

优先级：P1。

### 5.2 移动端消息分页

```text
GET /api/mobile/projects/:projectId/chat?limit=40&cursor=xxx
```

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

解决问题：

- 当前 `state` 只有最近消息数量限制，没有历史游标分页。
- App 对话页可做上拉加载历史。

优先级：P1。

### 5.3 移动端活动中心

```text
GET /api/mobile/activity?limit=50&cursor=xxx
```

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

解决问题：

- 当前没有通知、未读、提及中心。
- App 不需要自己扫描多个项目的 workflow events。

优先级：P1。

### 5.4 移动端 Agent 状态聚合

```text
GET /api/mobile/agents?projectId=proj-xxx
```

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

解决问题：

- `/api/agents` 是定义列表，不包含 App 需要的 `idle/running/reviewing` 聚合状态。
- App Agent 页不用自己遍历多个 project state。

优先级：P1。

### 5.5 移动端 Diff 摘要

```text
GET /api/mobile/projects/:projectId/diff-summary
```

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

解决问题：

- 当前 `/diff` 返回 raw patch，手机端解析成本高。
- 产物详情页只需要摘要，不需要完整 patch。

优先级：P2。

### 5.6 移动端预览 URL 配置

```text
GET /api/mobile/config
```

建议返回：

```json
{
  "backendBaseUrl": "http://192.168.x.x:8790",
  "previewBaseUrl": "http://192.168.x.x:8790",
  "sseSupported": true
}
```

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
