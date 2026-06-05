# AgentHub 移动端 UI 功能说明

本文档描述 `agentHubApp` 首版 React Native App 的页面结构和功能范围。当前移动端定位是“轻量协作入口 + 状态查看 + 产物摘要”，不复刻完整 Web 工程工作台。

## 1. 首版不做的功能

移动端首版明确不做：

- 首页 `今日协作` / 待办任务区块。
- 保存源码版本。
- 下载源码 zip。
- 构建静态产物。
- 发布到 latest 路由。
- 打开构建/部署预览。
- 长构建日志。
- 完整版本 diff。

这些能力继续留在 Web 端完成。

## 2. App 目录结构

`agentHubApp` 与 `agentHubFrontend`、`agentHubBackend` 同级，所有 App 相关文件放在该目录内。

```text
agentHubApp/
  App.tsx
  app.json
  package.json
  tsconfig.json
  README.md
  assets/
    background/
    brand/
  docs/
    AgentHub移动端UI功能说明.md
    AgentHub移动端App功能取舍说明.md
    AgentHub移动端App接口对接文档.md
    AgentHub Web端已有功能清单.md
  src/
    components/
      AgentGlyph.tsx
      GlassCard.tsx
      Pill.tsx
    data/
      mockData.ts
```

mock 数据集中放在：

```text
agentHubApp/src/data/mockData.ts
```

后续接后端时，可把 mock 数据替换为 API service 层，不要把临时数据散落在页面组件中。

## 3. 底部导航

首版底部导航保留 5 个入口：

| Tab | 功能 |
| --- | --- |
| 首页 | 总览、功能入口、当前工作区、最新事件 |
| 工作区 | 工作区搜索、筛选、状态列表 |
| AI | 群聊/单聊消息流、过程摘要、产物卡 |
| 对话/代码 | 文件摘要、diff 摘要、预览摘要、review 摘要 |
| 我的/Agent | Agent 列表、运行状态、基础信息 |

## 4. 首页

首页保留：

- 顶部品牌区：AgentHub logo、标题、通知入口。
- 欢迎区：`Hi, Susanna`、`很高兴为您服务`。
- 指标卡：工作区数量、运行中 Agent、产物数量。
- 全部功能入口：
  - 群聊协作
  - Agent 管理
  - 代码文件
  - 预览产物
  - Diff 摘要
  - 审查结论
- 当前工作区卡片：
  - 工作区名称
  - 工作区目标
  - 参与 Agent 头像
  - 状态标签
  - 最新事件
- 最新事件卡片：
  - 最近更新时间
  - 最近发生的文件/产物/审查事件

首页不再放 `今日协作`。

## 5. 工作区页

工作区页承接 Web 的工作区栏能力，但以移动卡片形式展示。

功能：

- 搜索工作区。
- 状态筛选：Active / Archived / All。
- 排序提示：Updated / Created / Name。
- 工作区卡片列表。
- 展示置顶、归档、运行中、产物数、消息数、参与 Agent。

后续真实接口：

- `GET /api/workbench`
- `PATCH /api/projects/:projectId/metadata`

## 6. AI 对话页

AI 页是移动端主入口。

保留能力：

- 群聊消息流。
- 单聊消息流。
- 用户消息。
- Agent 回复。
- `@Agent` 入口。
- 回复引用入口。
- 本轮过程摘要。
- 产物摘要卡。
- 输入框。

对话流中不展开完整长日志，只展示关键过程：

- 路由完成。
- Agent 执行中。
- 等待审查。
- 结果输出。

后续真实接口：

- `GET /api/projects/:projectId/state`
- `POST /api/projects/:projectId/messages/stream`

## 7. 对话/代码页

该页不是完整代码工作台，只做移动端摘要。

保留：

- 文件摘要：
  - 文件路径
  - 语言
  - 行数
  - added / modified / deleted / clean
- Diff 摘要：
  - 修改文件
  - 新增/删除行数
  - 关键文件列表
- 预览摘要：
  - 预览是否 ready
  - 预览缩略图或链接
- Review 摘要：
  - pass / partial / fail
  - 风险列表
  - 阻塞问题
  - 建议修改项

不做：

- Monaco 编辑器。
- 完整 patch 阅读。
- 构建按钮。
- 部署按钮。
- 源码 zip 下载按钮。

后续真实接口：

- `GET /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content?path=`
- `GET /api/projects/:projectId/diff`
- `GET /api/projects/:projectId/preview-capability`

## 8. Agent 页

Agent 页首版做列表和基础状态。

展示：

- Agent 头像。
- Agent 名称。
- 角色描述。
- provider：claude / codex / mock。
- 当前状态：idle / running / reviewing。
- 技能标签。

基础编辑后续可以支持：

- 名称。
- 角色描述。
- provider / model。
- 技能标签。
- 常用权限开关。

高级配置留给 Web：

- 长 systemPrompt。
- outputSchema。
- routingProfile。
- contextPolicy 全字段。
- disallowedTools。
- isolation 策略。

后续真实接口：

- `GET /api/agents`
- `GET /api/agents/:agentId`
- `GET /api/projects/:projectId/agents`
- `POST /api/projects/:projectId/agents`
- `PATCH /api/projects/:projectId/agents/:agentId`
- `DELETE /api/projects/:projectId/agents/:agentId`

说明：全局 Agent 写接口是兼容保留路由，移动端轻管理应使用项目级 Agent 接口。完整接口说明见 `AgentHub移动端App接口对接文档.md`。

## 9. RN 可实现性

当前首版范围 RN 都能实现。

注意事项：

- 背景图和玻璃 UI 可用 `ImageBackground`、`expo-blur`、半透明 View 实现。
- 底部胶囊导航可直接用 RN layout 实现。
- SSE 需要选择 fetch stream 或 EventSource polyfill。
- 预览如果需要打开网页，用 `react-native-webview`。
- Markdown 和代码片段建议简化渲染，不做桌面级编辑器。

## 10. 后续接后端顺序

建议顺序：

1. 工作区页接 `/api/workbench`。
2. 首页从 workbench 聚合指标和最新事件。
3. AI 页接 `/api/projects/:projectId/state`。
4. AI 输入框接 `/api/projects/:projectId/messages/stream`。
5. Agent 页接 `/api/agents`。
6. 对话/代码页接 files、diff、preview capability。
