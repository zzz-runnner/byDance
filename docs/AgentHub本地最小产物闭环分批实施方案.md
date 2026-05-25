# AgentHub 本地最小产物闭环分批实施方案

## 1. 结论

这份文档只分两个责任域：

- AgentHub Runtime / 产物闭环侧：包含需求 Agent、工程 Agent、Reviewer、Orchestrator、Runtime、ToolGateway、Artifact、ChangeSet、Preview、Zip、Build / Validate、Workflow Event。下文为了简洁，仍简称为“Agent 侧”。
- 业务后端侧：包含业务 API、业务数据、业务鉴权、业务发布、业务系统自己的存储和运行逻辑。

当前阶段优先把 AgentHub Runtime / 产物闭环做好。业务后端先只保留清晰边界和后续接入点，不进入本阶段主线。

这里的“Agent 侧”不是单个大模型 Agent，而是 AgentHub 为了让 Agent 完成任务所需要的一整套执行环境和产物能力。也就是说，Runtime、预览、打包、构建、diff、artifact 记录都归 Agent 侧闭环。

结合当前项目现状，需求阶段判断和执行闸门已经基本跑通，不再作为下一步大批次开发重点。后续真正要补的是“Agent 已经写出文件以后，系统能不能稳定生成可预览、可下载、可回放、可验收的产物链路”。

核心判断：

- 需求 Agent 负责把用户模糊输入变成可执行范围、验收标准和任务包。
- 工程 Agent 负责在 Runtime workspace 里实现代码。
- Reviewer 负责基于真实产物验收。
- Orchestrator 负责阶段判断、任务派发、结果综合。
- Runtime / ToolGateway / Artifact / ChangeSet / Preview / Zip / Build Log 是 Agent 侧基础设施。
- 业务后端不参与本地 AgentRun 的打包、预览、构建和 artifact 生成。

这部分工作量中等偏大，不建议一次性做完。

原因不是单个功能难，而是它横跨 Agent 编排、Runtime、ToolGateway、Artifact、ChangeSet、Workflow Event、Reviewer 上下文和业务边界。一次性做完容易出现几个问题：

- Agent 能写文件，但没有稳定 diff 和产物记录。
- Preview 能打开，但静态资源、MIME、构建目录优先级不稳定。
- Zip 能打包，但安全排除规则、下载接口、artifact 记录不完整。
- Build 能跑，但日志没有进入 Reviewer 上下文。
- Reviewer 会总结，但不是基于真实产物验收。
- 后续接业务后端时，如果边界不清，会把业务 API、发布、鉴权和 Agent Runtime 混在一起。

建议按实际缺口分批推进，每个批次都能独立验证。当前不从需求闸门重新做起，而是从 Preview、产物事件、Zip、Reviewer 真实验收开始。

## 2. 职责边界

### 2.1 Agent 侧做什么

Agent 侧负责把“用户需求”变成“可验证的本地产物”。

Agent 侧包含：

- 需求 Agent。
- 工程 Agent。
- Reviewer。
- Orchestrator。
- Runtime。
- ToolGateway。
- AgentRun。
- ChangeSet。
- Artifact。
- Preview。
- Zip。
- Build / Validate。
- Workflow Event。

Agent 侧负责：

- 接收用户需求。
- 判断当前阶段：需求对接、方案确认、执行、审查。
- 需求 Agent 澄清范围、产出验收标准。
- 工程 Agent 修改 workspace 文件。
- Runtime 提供隔离 workspace repo。
- ToolGateway 约束所有命令和文件访问在 workspace 内。
- AgentRun 前后读取 repo snapshot。
- 生成 changed files、patch、ChangeSet。
- 提供本地 preview URL。
- 打包源码 zip。
- 运行受控 build/check。
- 记录 build/check logs。
- 生成 artifact。
- 发出 workflow event。
- Reviewer 基于真实产物给出 PASS / PARTIAL / FAIL。
- Orchestrator 汇总最终结果。

Agent 侧不负责：

- 业务数据库建模。
- 业务鉴权策略。
- 业务生产数据写入。
- 业务正式发布。
- 业务后端服务运行。
- 业务后端内部 CI/CD。

### 2.2 需求 Agent 做什么

需求 Agent 是 Agent 侧优先要做好的第一环。

需求 Agent 负责：

- 把用户的模糊需求整理成明确目标。
- 追问缺失信息。
- 定义范围和不做范围。
- 输出验收标准。
- 输出工程 Agent 可执行的任务包。
- 标记是否已经允许进入执行阶段。

需求 Agent 输出建议包含：

```text
1. 用户目标
2. 页面 / 功能范围
3. 必须包含的内容
4. 不做范围
5. 验收标准
6. 交给工程 Agent 的任务包
7. 是否需要用户确认后才能执行
```

需求 Agent 不负责：

- 写代码。
- 打包 zip。
- 跑 build。
- 发布业务系统。
- 直接操作业务数据库。

### 2.3 工程 Agent 做什么

工程 Agent 负责实现代码，但它依赖 Runtime 和 ToolGateway 完成安全执行。

工程 Agent 负责：

- 读取需求 Agent 输出的任务包。
- 修改 workspace repo 文件。
- 尽量生成可静态预览的产物。
- 在输出中说明改动内容、关键文件、自测情况和风险。
- 根据 build/check 日志继续修复。

工程 Agent 不负责：

- 自己定义 zip 排除规则。
- 自己生成 artifact id。
- 自己维护 workflow event。
- 自己绕过 ToolGateway 执行命令。
- 自己调用业务后端生产写接口。

### 2.4 Reviewer 做什么

Reviewer 负责验收，不只是读工程 Agent 总结。

Reviewer 需要基于：

- 原始用户需求。
- 需求 Agent 的范围和验收标准。
- 工程 Agent 输出。
- changed files。
- ChangeSet summary。
- preview artifact。
- zip artifact。
- build/check logs。

Reviewer 输出必须包含：

```text
1. 结论：PASS / PARTIAL / FAIL
2. 验收依据
3. 发现的问题
4. 是否建议继续修复
```

### 2.5 业务后端做什么

业务后端负责业务系统本身，不负责 Agent 本地执行闭环。

业务后端负责：

- 业务 API。
- 业务数据模型。
- 业务鉴权。
- 业务资源存储。
- 业务发布流程。
- 业务系统运行监控。
- 业务侧报表、文件、订单、用户、权限等能力。

业务后端不负责：

- Agent workspace 隔离。
- AgentRun 生命周期。
- Agent 本地源码 zip 打包。
- Agent 本地 preview 服务。
- Agent ChangeSet 生成。
- Agent artifact id 生成。
- Agent workflow event 生成。

后续接业务后端时，只通过明确接口接入：

```text
API schema / manifest / webhook / publish adapter / artifact metadata
```

不把业务后端逻辑混进 Agent Runtime。

## 3. 最终期望效果

用户在主群聊里发起一个模糊任务：

```text
帮我做一个极简活动页
```

系统先进入需求对接，而不是直接写代码：

```text
task_stage_updated: requirements_intake
agent_task_dispatched: product-manager
```

需求 Agent 输出需求、范围和验收标准。用户确认后：

```text
可以，按这个方案开始实现
```

系统进入 Agent 侧执行链路：

```text
task_stage_updated: execution
agent_task_dispatched: engineer
agent_started: engineer
agent_progress: engineer 正在修改 workspace 文件
agent_finished: engineer success
change_set_created: Agent 侧生成真实 changed files + patch
preview_ready: Agent 侧生成本地 preview URL
zip_ready: Agent 侧生成本地源码 zip 下载 URL
agent_task_dispatched: reviewer
agent_started: reviewer
agent_finished: reviewer success
assistant_delta: 最终回复流式输出
```

本地 Demo 的验收标准：

```text
1. 需求 Agent 能产出明确任务包和验收标准
2. 工程 Agent 真的修改了 workspace repo 文件
3. Agent 侧生成真实 ChangeSet 和 patch
4. 预览 URL 能打开修改后的页面，并能加载 CSS / JS / 图片
5. zip 能下载，解压后包含源码，且不包含 .git / node_modules / .env*
6. 如果本轮执行了 build/check，结果会被记录为日志和 artifact；没有 build 脚本时可以跳过
7. Reviewer 基于真实 changed files、preview、zip 给出结论；如果有 build/check 日志，需要一并引用
8. 最终回复流式输出，并明确带出预览、diff、zip、验收结果
9. 刷新后仍能从状态中恢复 run / artifact / changeSet / workflow event
```

业务后端本阶段验收标准：

```text
1. 文档中边界清楚
2. 不阻塞 Agent 侧闭环
3. 后续能通过 API schema / manifest / webhook / publish adapter 接入
```

## 4. 基于当前现状的实施顺序

### 已基本完成：需求 Agent 和执行闸门

当前项目已经具备：

- 模糊需求进入 `requirements_intake`。
- 未确认前只允许产品/需求对接，不直接派工程 Agent。
- 用户明确确认后进入 `execution`。
- 执行闸门会拦截模型误派的工程执行。

这一块不再作为下一步大批次开发，只保留小修项：

- 让需求 Agent 输出格式更稳定。
- 强化“任务包 + 验收标准 + 是否需要确认”的结构。
- 在 smoke 测试里继续覆盖“模糊任务不执行、确认后执行”。

验收以回归为主：

```text
1. “帮我做一个活动页”进入需求对接
2. 未确认前不派工程 Agent
3. 用户确认后进入执行阶段
4. npm run check 通过
```

### 批次 1：Runtime Preview 静态资源服务

目标：

让 Agent 已经写好的本地 HTML/CSS/JS 页面可以被 iframe 稳定预览。

范围：

- 支持 `/preview/:workspaceId/*` 返回 HTML、CSS、JS、图片等静态资源。
- 根据文件后缀返回正确 MIME。
- 支持相对路径资源加载。
- 如果存在 `dist/` 或 `build/`，优先预览构建产物。
- 如果没有构建产物，则预览 repo 根目录。
- 保持 workspace 路径边界校验。
- 保持 `web-preview` artifact 使用 `previewUrl`，供后续前端 iframe 直接加载。

不做：

- 公网预览 URL。
- 长驻 dev server 反向代理。
- 每个 workspace 独立容器。
- 业务后端代理。
- 前端 iframe 页面。

验收：

```text
1. Agent 生成 index.html + styles.css 后，预览页能加载 CSS
2. 访问不存在文件返回明确错误
3. 访问 workspace 外路径会被拒绝
4. web-preview artifact 能从状态中恢复
5. npm run check 通过
```

预估：

0.5 天。

### 批次 2：ChangeSet / Artifact 事件归一化

目标：

让 AgentRun 结束后有稳定的产物事件和可回放状态。当前系统已经能记录 ChangeSet 和部分 Artifact，但缺少专门的产物事件。

范围：

- 新增 workflow event：
  - `artifact_created`
  - `change_set_created`
  - `preview_ready`
  - `zip_ready`
- AgentRun 结束后按统一顺序发事件。
- `change_set_created` 包含 changeSetId、agentRunId、files、summary。
- `artifact_created` 包含 artifactId、type、title、url。
- `preview_ready` 指向已有或新生成的 `web-preview` artifact。
- 保持当前 `agent_task_dispatched`、`agent_started`、`agent_finished` 不变。
- 事件必须落库，刷新后可回放。

不做：

- 复杂 artifact parser。
- 文档 / PPT / 图片转码。
- 业务后端事件转发。
- 前端时间线 UI。

验收：

```text
1. /api/messages/stream 能收到新增事件
2. 事件顺序能支撑后续时间线
3. 事件落库后刷新可回放
4. mock 链路和真实链路都不报错
5. npm run check 通过
```

预估：

0.5-1 天。

### 批次 3：Zip 导出和 Zip Artifact

目标：

让 AgentHub Runtime 产物可以被下载，满足比赛主链路中的“源码 zip 下载”。

范围：

- 新增 workspace zip 打包服务。
- 新增下载接口，例如 `GET /api/workspaces/:workspaceId/zip`。
- 排除 `.git`、`node_modules`、`.env*`、临时日志、缓存目录。
- AgentRun 结束后，基于当前 workspace snapshot 生成 `zip` artifact。
- Artifact 中保存 title、content、url、agentRunId、createdByAgentId。
- 发出 `artifact_created` 和 `zip_ready` 事件。

不做：

- 对象存储。
- 云端持久下载链接。
- GitHub 导出。
- 业务后端源码导出。

验收：

```text
1. 下载 zip 成功
2. 解压后包含 Agent 修改后的文件
3. zip 中不包含 .git / node_modules / .env*
4. artifact 列表中能看到 zip 产物
5. SSE 能收到 zip_ready
6. npm run check 通过
```

预估：

0.5-1 天。

### 批次 4：Reviewer 基于真实产物验收

目标：

让 Reviewer 不再只读工程 Agent 总结，而是基于真实产物给出判断。

范围：

- Reviewer 上下文中注入：
  - 原始用户需求
  - 需求 Agent 输出的范围和验收标准
  - engineer output
  - changed files
  - changeSet summary
  - preview artifact
  - zip artifact
  - build/check logs，如果本轮存在
- Reviewer 输出必须包含：
  - 结论：PASS / PARTIAL / FAIL
  - 验收依据
  - 发现的问题
  - 是否建议继续修复
- 主脑最终综合时引用 Reviewer 结论。

不做：

- Playwright 截图验收。
- 视觉 diff。
- 自动修复循环。
- 业务后端冒烟测试。

验收：

```text
1. Reviewer 结论能引用真实 changed files、preview 或 zip
2. 最终回复里能看到验收结果
3. npm run check 通过
```

预估：

0.5-1 天。

### 批次 5：Build / Validate 最小链路

目标：

让 Agent 的产物在有 `package.json` 时具备最小构建或检查结果。这个批次是 P2，不阻塞静态 HTML/CSS 的最小闭环。

范围：

- Runtime 增加受控 build/check 入口。
- 如果 workspace 有 `package.json` 且存在 `scripts.build`，运行 `npm run build`。
- 如果没有 build 脚本，记录为 skipped，不作为失败。
- stdout/stderr 写入 AgentRun logs。
- 生成 build/check text artifact。
- Workflow 中发出构建开始和完成事件，事件名可先用：
  - `agent_progress`
  - 后续再升级为 `build_started` / `build_finished`
- 命令仍必须经过 ToolGateway 白名单。

关键决策：

当前 ToolGateway 只白名单 git / Claude Code / Codex。要支持 `npm run build`，需要扩展命令白名单。建议只开放：

```text
npm install / npm run build / npm test
```

并限制：

- cwd 必须在 workspace repo 内。
- 超时时间固定。
- 不允许任意 shell 字符串。
- 不读取或注入平台密钥。
- 不读取业务后端密钥。

不做：

- 任意命令执行。
- 长驻 dev server。
- 自动安装复杂依赖缓存。
- 业务后端 CI/CD。

验收：

```text
1. 有 build 脚本时能运行并记录日志
2. 无 build 脚本时返回 skipped
3. build 失败时不会吞错误
4. Reviewer 上下文能看到 build/check 结果
5. build 失败时 Reviewer 能识别为 PARTIAL 或 FAIL
6. npm run check 通过
```

预估：

1 天。

## 5. 业务后端后续接入边界

业务后端后续可以接入，但不应该阻塞 Agent 侧优先闭环。

### 5.1 业务后端接入方式

可选方式：

```text
1. API schema：告诉 Agent 业务后端有哪些接口
2. manifest：告诉 AgentHub 有哪些业务能力可用
3. webhook：业务后端订阅 AgentHub 产物事件
4. publish adapter：用户确认后，把 Agent 侧产物发布到业务系统
5. artifact metadata：用 metadata 引用业务资源，不复制业务数据库
```

### 5.2 业务后端不进入本阶段

本阶段不做：

```text
1. 业务生产环境发布
2. 业务数据库迁移
3. 业务后端权限系统重构
4. Agent 直接调用生产写接口
5. AgentHub 托管业务后端运行时
6. 把业务后端代码混入 Agent Runtime
7. 通用 CI/CD 平台
```

### 5.3 后续业务接入验收

等 Agent 侧闭环稳定后，再做业务后端接入。验收标准可以是：

```text
1. Agent 能读取业务 API schema 摘要
2. 不暴露业务生产密钥
3. 写操作必须经过用户确认
4. 写操作必须经过 allowlist
5. 发布结果生成 deploy-status artifact
```

## 6. Agent 侧数据契约

### 6.1 Artifact

Artifact 属于 Agent 侧产物记录。

最小字段：

```text
id
workspaceId
agentRunId
type
title
content
url
createdByAgentId
metadata
createdAt
```

当前本地闭环优先支持：

```text
text
diff
web-preview
zip
```

后续业务接入再扩展：

```text
deploy-status
business-resource
```

### 6.2 ChangeSet

ChangeSet 基于 AgentRun 前后的 repo snapshot 生成。

最小字段：

```text
id
workspaceId
agentRunId
baseCommit
files
summary
patch
createdAt
```

### 6.3 Workflow Event

产物相关事件属于 Agent 侧闭环。

最小新增事件：

```text
artifact_created
change_set_created
preview_ready
zip_ready
```

后续可扩展：

```text
build_started
build_finished
artifact_failed
preview_failed
zip_failed
deploy_started
deploy_finished
```

## 7. 总工作量判断

如果按当前项目现状只补剩余最小闭环，预计：

```text
最乐观：2 天
正常：3-4 天
如果真实 Codex / Claude Code 适配器输出不稳定：4-5 天
```

推荐节奏：

```text
第 1 天：Preview 静态资源 + ChangeSet / Artifact 事件
第 2 天：Zip artifact + 下载接口
第 3 天：Reviewer 真实产物验收
第 4 天：联调、文档更新、必要时补 Build / Validate
```

如果时间紧，优先级如下：

```text
已完成回归：需求 Agent + 执行闸门
P0：Preview 静态资源和 iframe 可访问链接
P0：ChangeSet / Artifact 事件
P0：Zip 下载和 zip artifact
P1：Reviewer 真实产物验收
P2：Build / Validate
P2：业务后端接入
```

每个批次完成后都应该提交一次中文 commit，避免 Runtime、事件契约和产物模型混在一个大提交里。

## 8. 风险和取舍

### 8.1 最大风险

- ToolGateway 开放 `npm` 后的安全边界。
- Windows 下 zip 打包、路径排除和 MIME 处理的一致性。
- Agent 修改的是 repo 根目录，但 preview 可能优先读取 dist/build，导致用户看不到最新改动。
- 真实 Codex / Claude Code 可能写出非静态项目，build 失败率不可控。
- Reviewer 如果没有强约束，容易继续泛泛总结。
- 后续接业务后端时，如果不守边界，容易把 Agent Runtime 和业务发布系统混在一起。

### 8.2 建议取舍

- 先把 Agent 侧跑通，不等业务后端。
- Preview 优先保证静态站点，不优先支持 dev server。
- Zip 优先从 repo 当前文件打包，不等待 build 成功。
- Diff 先只展示，不做一键应用。
- Build 失败不阻断 artifact 生成，但 Reviewer 必须指出风险。
- 业务后端先只保留 API schema / manifest / publish adapter 的接口设想。

## 9. 不纳入本阶段

```text
1. 云端 Runtime
2. 公网部署
3. Vercel / Netlify / 自建部署 provider
4. 文档 / PPT / 图片复杂预览
5. 小程序真实编译和微信开发者工具联动
6. 一键应用 Diff / 回滚 / 冲突解决
7. 多工程 Agent 并行合并
8. 完整在线 IDE
9. 完整版本历史
10. GitHub OAuth / 导入 / 推送
11. 业务后端数据库写入
12. 业务后端鉴权系统
13. 业务后端部署流水线
```

## 10. 当前推荐下一步

后续优先做 AgentHub Runtime / 产物闭环，建议顺序：

```text
0. 回归需求 Agent 和执行闸门，不重新大改
1. 补 Preview 静态资源 MIME、路径安全和构建目录优先级
2. 补 ChangeSet / Artifact / Preview / Zip 事件
3. 补 Zip 下载接口和 zip artifact
4. 补 Reviewer 真实产物验收上下文
5. 最后再补 Build / Validate
```

业务后端暂时只保留边界，不进入近期实现主线。
