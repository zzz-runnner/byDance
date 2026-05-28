# locateBackend

## 目标

在当前前端基线之上，先把本地链路跑通到可验证状态：

`agentHubFrontend -> agentHubBackend -> agentHub runtime -> real/mock agent`

当前建议先做最小闭环，不要一开始就追求所有房间类型和所有产品化能力都同时上线。

## 当前基线

- 已先提交现有前端改动基线：`35aa60d` `feat(frontend): refine workbench live and mock flows`
- 已从该提交切出新分支：`feat/local-frontend-agent-chain`
- 当前前端本地 `npm run check` 通过
- 当前 `agentHub` 本地 `npm run check` 通过
- 当前 `agentHubBackend` 还没有 `node_modules`，无法直接执行 `tsc`

## 现状判断

### 1. 前端已经具备 live/mock 切换，但 live 链路没有闭合

前端当前已经不是纯 demo 页面了，已经按业务后端协议去取 live 数据。

前端 live 模式依赖这些接口：

- `GET /api/projects`
- `GET /api/agents`
- `GET /api/projects/:projectId/state`
- `POST /api/projects/:projectId/messages/stream`

另外，创建工作区时前端还会提交：

- `conversationType`
- `agentIds`

这说明前端已经准备好走业务后端中转，不再是直接打 `agentHub` runtime。

### 2. 业务后端接口还没补齐

当前 `agentHubBackend` 里，`projects.controller.ts` 只有：

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `PUT /api/projects/:projectId/files`
- `POST /api/projects/:projectId/messages/stream`

还缺：

- `GET /api/agents`
- `GET /api/projects/:projectId/state`

所以前端切到 `live` 或 `auto` 时，数据读取链路现在是断的。

### 3. 创建工作区的 contract 也不完整

前端创建工作区会传 `conversationType` 和 `agentIds`，但后端 `CreateProjectDto` 目前只接：

- `name`
- `goal`
- `workspaceType`
- `workspaceId`
- `conversationId`

这意味着：

- 单聊工作区目标 agent 现在不会被业务后端保留下来
- 群聊和单聊的创建路径在业务后端还没真正接通

### 4. 业务后端源码骨架本身还不完整

`agentHubBackend/src/app.module.ts`、`projects.module.ts`、`versions.module.ts`、`builds.module.ts`、`deployments.module.ts` 都在引用：

- `../storage/storage.module`
- `./storage/storage.module`

但当前仓库里没有 `agentHubBackend/src/storage/`

所以就算先装依赖，后端也大概率会先卡在源码缺失，而不是只卡在环境。

### 5. 环境现状

- `agentHubFrontend/node_modules` 已存在
- `agentHub/node_modules` 已存在
- `agentHubBackend/node_modules` 不存在
- `agentHub/.env.local` 已存在
- `agentHubBackend/.env` 不存在
- `agentHubFrontend/.env` 不存在，但前端目前不依赖本地 env 才能跑

### 6. real agent 链路前置条件已经部分具备

`agentHub/.env.local` 里已经有：

- `DATABASE_URL`
- DeepSeek 相关配置

按仓库文档，真实 engineer/Codex 链路还依赖：

- PostgreSQL
- `npm run codex:bridge`
- `AGENTHUB_REAL_AGENTS=true`

所以真正的阻塞点不在前端，而在业务后端 contract 和本地启动骨架。

## 建议实施顺序

### Phase 0: 先定义最小闭环范围

建议第一阶段只追求：

- 前端 `Live` 模式可加载真实工作区列表
- 可创建一个群聊工作区
- 可发送一条消息
- 可看到 SSE workflow events

暂时不要第一步就把下面这些一起做满：

- 单聊工作区
- build/deploy 全链路
- 版本 diff/source zip 产品化
- 多工作区同时观测的所有边角状态

原因很简单：当前 runtime 自动创建的是 group conversation，direct room 需要额外补 conversation 创建路径，范围会立刻膨胀。

### Phase 1: 先把 `agentHubBackend` 修到能启动

优先级最高，必须先做。

要补的东西：

1. 创建 `agentHubBackend/src/storage/`
2. 实现 `StorageModule`
3. 实现 `LocalStorageService`
4. 让这些现有调用先有落点：
   - `projectsRoot`
   - `projectDir(projectId)`
   - `projectMetadataPath(projectId)`
   - `workspaceFilePath(workspaceId, filePath)`
5. 补完后执行：
   - `cd agentHubBackend`
   - `npm install`
   - `npm run check`
   - `npm run build`

验收标准：

- `agentHubBackend` 可以独立通过类型检查和 build
- `GET /api/health` 可以启动返回 200

### Phase 2: 补齐前端 live 所需的后端接口

这是前端 live 模式真正跑通的关键。

必须补：

1. `GET /api/agents`
2. `GET /api/projects/:projectId/state`

推荐实现方式：

1. 业务后端调用 `agentHub` 的 `GET /api/state`
2. 从完整 `AppState` 里筛出当前 `project.workspaceId` 对应的数据
3. 返回给前端

`GET /api/agents` 最小实现可以直接从 runtime state 里返回 `agents`

`GET /api/projects/:projectId/state` 需要至少筛出：

- `workspaces`
- `conversations`
- `messages`
- `agents`
- `agentSessions`
- `agentSessionMessages`
- `taskHandoffs`
- `agentRuns`
- `artifacts`
- `changeSets`
- `contextSnapshots`
- `workflowEvents`
- `diagnosticLogs`

验收标准：

- 前端切到 `Live` 时不再因为缺接口退回 mock
- 新建项目后可以看到真实 workspace state

### Phase 3: 补齐创建工作区 contract

这是第二优先级，不建议在 Phase 1/2 之前做复杂化。

要补：

1. `CreateProjectDto` 接收：
   - `conversationType`
   - `agentIds`
2. `ProjectsService.createProject()` 保留这些字段对应的业务含义
3. 如果第一阶段只做群聊，可以先约束：
   - `conversationType !== 'direct'` 时按现有逻辑工作
   - `direct` 暂时返回明确错误或先降级成群聊

更稳妥的做法：

- Milestone 1 只支持 group workspace
- Milestone 2 再补 direct conversation

因为 `agentHub` runtime 现在自动创建的是 group conversation。要支持 direct，业务后端还需要新增一层：

- 调 `agentHub` 的 `POST /api/conversations`

而当前 `AgentHubClientService` 里还没有这个 client 方法。

### Phase 4: 连通 real agent 链路

当前推荐顺序：

1. 启 PostgreSQL
2. 启 `agentHub`
3. 启 `codex:bridge`
4. 启 `agentHubBackend`
5. 启 `agentHubFrontend`

建议启动命令：

```powershell
cd E:\byDance\agentHub
npm run dev:api
```

```powershell
cd E:\byDance\agentHub
npm run codex:bridge
```

```powershell
cd E:\byDance\agentHubBackend
npm run dev
```

```powershell
cd E:\byDance\agentHubFrontend
npm run dev
```

需要补的 backend `.env` 建议最小值：

```text
PORT=8790
CORS_ORIGIN=http://127.0.0.1:5173
AGENTHUB_BASE_URL=http://127.0.0.1:8787
AGENTHUB_RUNTIME_ROOT=../agentHub/data/workspaces
APP_STORAGE_ROOT=storage
```

如果要打真实 agent：

- `agentHub` 环境里要确保 `AGENTHUB_REAL_AGENTS=true`
- DeepSeek key 可用
- PostgreSQL 可连
- bridge 可连

### Phase 5: 做最小验收脚本

建议在这个分支里最后补两个本地脚本：

- `locateBackend/start-local.ps1`
- `locateBackend/health-check.ps1`

用途：

- 一键打印四个进程的启动顺序
- 一键检查 `5173 / 8790 / 8787`
- 一键验证 `/api/projects`、`/api/agents`、`/api/projects/:id/state`

## 推荐里程碑

### Milestone A

目标：前端 live 模式可用，但先只支持 group workspace

交付标准：

- `agentHubBackend` build 通过
- 前端 `Live` 模式能加载真实项目
- 前端可创建群聊工作区
- 前端可发送消息并消费 SSE

### Milestone B

目标：把 real agent 执行接起来

交付标准：

- `/run` 或执行型请求能穿过业务后端到 runtime
- 前端可看到 `task_stage_updated`
- 前端可看到 `agent_task_dispatched`
- 前端可看到 `agent_output_*`
- 前端可看到 `preview_ready`

### Milestone C

目标：补 direct room 和更完整的产品化后端能力

交付标准：

- direct workspace 可创建
- target agent 可正确绑定
- 版本、build、deploy 再继续接

## 我建议的实际执行方式

最稳的切法不是“把所有缺口一起补”，而是按下面顺序：

1. 先修 `agentHubBackend` 的 storage 骨架和 build
2. 再补 `GET /api/agents`
3. 再补 `GET /api/projects/:projectId/state`
4. 先只跑 group workspace live
5. 最后再看要不要做 direct room

这个顺序能最快拿到第一个真实闭环，而且不会被 direct conversation 的额外复杂度拖住。

## 下一步

如果按这个方案继续，我建议直接在当前分支先做：

1. 补 `agentHubBackend/src/storage/*`
2. 补 `GET /api/agents`
3. 补 `GET /api/projects/:projectId/state`
4. 写一个最小本地 health-check 脚本

这样可以最快验证前端 `Live` 模式，而不是继续停留在 `Mock`。
