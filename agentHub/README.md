# AgentHub Local

## 2026-05-25 Agent 链路探测状态

- 根目录继续只作为 AgentHub runtime/API/CLI 仓库使用，不接入业务后端，不和前端目录做 workspace 绑定。
- 默认自动化仍然使用 Vitest、memory store、mock agents，不会触发真实 Claude Code / Codex / DeepSeek，也不会写入正式 `data/workspaces`。
- 新增真实链路探测入口：`tests/real/agent-chain-probe.test.ts`，默认跳过，只有设置 `AGENTHUB_RUN_REAL_TESTS=true` 后才会执行。
- 探测数据独立放在 `tests/fixtures/agent-chain/probe-prompts.json`；真实运行产物继续写入系统临时 runtime root，测试结束后清理。
- 当前探测目标分两段：先确认未批准的规划请求会进入 product-manager 且不会派发 engineer，再确认已批准的主链路能否走到 engineer、reviewer、changeSet、preview 和 synthesis。
- 探测失败时会输出 `Agent chain probe report`，展示 handoff、run、changeSet 和关键 workflow event，方便判断真实链路具体卡在哪一步。
- 2026-05-25 本地实测结果：Codex bridge 启动后，真实 engineer 直连写文件 smoke 通过；未批准规划请求通过保护，会派发 product-manager 且不会派发 engineer；批准执行请求已到达 `routing_finished`、engineer/reviewer handoff、engineer/reviewer real run、`change_set_created`、`preview_ready`、`agent_finished`、`synthesis_finished`、`workflow_finished`，并生成 `index.html` 与 `styles.css` 变更。因此当前执行链路已能完成真实工程交付和审查；product-manager 只在未批准/需求对接阶段出现。
- 真实链路测试命令：

```bash
$env:AGENTHUB_RUN_REAL_TESTS='true'
npm run test:real:chain
```

## 2026-05-25 Bridge、交付校验与自动返工

- Codex engineer 启动前会先对 `AGENTHUB_CODEX_BRIDGE_URL` 做短超时 TCP 预检查；bridge 未启动时快速失败，并提示先运行 `npm run codex:bridge`，避免等待 Codex 多轮重试后才暴露错误。
- 交付校验已增强：会提取任务中明确写出的文件名，检查必要文件、静态资源引用、changeSet、preview 状态和关键文本标记；校验结果继续写入 `delivery_validation_finished` 和 AgentRun delivery 日志。
- Reviewer 上下文仍包含最新 changeSet、preview、zip 和变更文件摘要；后续可继续把更完整的 delivery validation 结构化结果注入 reviewer evidence。
- 主脑执行阶段如果模型只派 engineer 而漏派 reviewer，后端会自动补 reviewer 审查任务，避免工程交付绕过质量门禁。
- 主链路已支持一次自动返工：engineer 交付失败/部分失败、交付校验失败/部分失败、reviewer `FAIL/PARTIAL` 时，会自动派 engineer 修复一次，再派 reviewer 复查一次。
- 自动返工最多一轮；二修后仍失败会发出 `repair_blocked`，不会无限循环。
- 新增 workflow 事件：`repair_suggested`、`repair_started`、`repair_finished`、`repair_blocked`，CLI 会打印简短状态。

## 2026-05-25 前端拆分状态

- Web 前端项目已从本仓库拆出到本机目录：`E:\byDance\agentHubFrontend`。
- 当前仓库后续只作为 `agentHub` agent/runtime 仓库，保留 CLI、本地 API、主脑编排、子 Agent adapter、数据库存储和工作区运行时。
- 根目录不再维护 `web/` 子项目，也不再提供 `npm run dev:web`、`npm run build:web`、`npm run check:web` 这类前端脚本。
- 前端开发需要进入 `E:\byDance\agentHubFrontend` 后单独执行 `npm install`、`npm run dev`、`npm run build`、`npm run check`。
- 当前不是 monorepo，也不使用 npm workspace 或 `file:` 本地依赖绑定两个项目；`agentHub` 和 `agentHubFrontend` 各自维护 `package.json`、`package-lock.json` 和 `node_modules`。
- 业务后端暂不进入本阶段。本仓库只保留 AgentHub runtime/API/CLI 侧能力；业务 API、业务数据、业务鉴权和业务发布后续通过明确接口再接入。

## 2026-05-25 后端 AgentRun 交付状态更新

- AgentRun 现在区分 `success`、`partial`、`failed` 三种终态；真实 Claude Code / Codex 子进程如果 timeout、非零退出但仍有最终输出，会先标为 `partial`，不再静默记为完整成功。
- 子 Agent 执行结束后会经过统一 delivery assessment：进程状态、文件变更、轻量交付校验和 reviewer verdict 会共同决定最终状态。
- 工程交付会发出 `delivery_validation_finished` 事件；Reviewer 输出会解析为 `review_verdict` 事件，综合阶段会把 `partial` / `failed` / review fail 当作交付门禁，不再描述成已完整完成。
- `TaskHandoff` 已支持 `partial`，并随 AgentRun 最终状态同步更新为 `completed` / `partial` / `failed`。
- Store 启动时会恢复长期卡在 `running` 的 AgentRun：超过内置 agent 最大运行时长 2 倍且不少于 900 秒的 run 会被标为 `failed`，并写入 diagnostic log。
- Workflow events 保留策略从简单保留最后 1000 条改为关键事件优先保留；`agent_stdout_delta`、`agent_stderr_delta`、`agent_progress` 这类高频事件只保留最近一部分，避免挤掉 handoff、artifact、review、validation、synthesis 等关键事件。
- 本轮验证命令：`npm run check`，结论：TypeScript 编译检查通过。

AgentHub 当前是本地优先的多 Agent 调度原型。入口以 CLI 和本地 HTTP API 为主，重点验证主脑路由、子 Agent 私聊、任务派发、最终回复流式输出和工作区上下文。

## 当前状态

- 主脑路由已经拆成三层：本地强规则、轻量 Router 模型、最终回复生成。
- 固定回复只保留确定性链路：空输入、`/help`、`/run` 和少量系统控制类问题；普通闲聊不再大面积 hardcode。
- 硬规则只负责安全边界和显式命令，不再因为“做一个 / 创建 / 生成 / 实现”直接判定执行。
- Router 会输出任务阶段：`chat`、`requirements_intake`、`planning`、`awaiting_confirmation`、`execution`、`review`。
- 模糊产品需求默认进入 `requirements_intake`，最多派产品经理 Agent 对接需求；工程师执行必须等用户明确确认。
- Planner 后有执行闸门：如果模型在需求对接或方案确认阶段误派工程师，后端会暂缓工程实现并只保留产品经理或转成追问。
- Router 负责分流，不直接替模型长答复；普通聊天和 `@agent` 私聊会走轻量流式最终回复。
- `ModelGateway` 现在支持 `generate()` 和 `streamText()`；DeepSeek provider 已接入 SSE 解析，只抽取最终文本 delta。
- router / planner / JSON 决策仍然非流式；真正对用户可见的最终文本才流式。
- 新增统一的 assistant 流式事件：`assistant_message_started`、`assistant_delta`、`assistant_message_finished`、`assistant_message_error`。
- 新增产品化过程事件：`task_stage_updated` 和 `agent_task_dispatched`，前端可展示“主脑当前阶段”和“主脑给子 Agent 派发了什么任务包”。
- `routing_finished` 现在会带 `speakerAgentId` 和 `finalizationMode`，CLI 会直接打印本轮唯一可见发言者和最终回复模式。
- 主脑派发子 Agent 时遵循“一轮一个可见 speaker”：单子 Agent 可直接作为最终发言者；多 Agent 或主脑收口时，子 Agent 输出只进入事件、产物、session history 和 run history，不再重复写成多条对话消息。
- 文件治理已开始按职责拆分：`src/server/orchestrator/workflow/` 现在承载可见 speaker、workflow events、diagnostics、assistant 流式回复和通用工具；`workflow.ts` 已从 2355 行降到约 1672 行。
- CLI 也开始按职责拆分：`src/cli/event-formatters.ts` 和 `src/cli/stream-printer.ts` 已抽出，`chat.ts` 已从 1040 行降到约 813 行。
- 新增文件大小约束：1000 行以上视为大文件，后续不继续堆逻辑；当前待继续拆分的是 `workflow.ts` 和 `src/cli/chat.ts`。
- CLI 会在最终文本生成时边收边打印，并跳过已流式展示过的最终消息，避免二次整段重复输出。
- 本地 HTTP API 新增 `POST /api/messages/stream`，可把同一套 workflow 事件以 SSE 方式返回给前端。
- `@agent` 私聊默认走轻量流式回复；只有 `/run <task>` 或明显执行型请求才会创建 handoff 并进入真实 AgentRun。
- 主脑派发子 Agent 时会先创建 `TaskHandoff` 并写入目标 AgentSession，再执行当前同步 AgentRun；AgentRun 会记录 `sessionId` 和 `handoffId`。
- 子 Agent 仍通过现有 Claude Code / Codex / mock adapter 执行；真实模式下适配器失败不会静默替换成 mock 结果。
- 子 Agent 真实执行现在会发出 `agent_output_started`、`agent_stdout_delta`、`agent_stderr_delta`、`agent_output_finished`，CLI 和 SSE 前端都可以看到执行过程输出。
- Claude Code adapter 已切到 `stream-json`，后端会把流式 JSON 转成可读输出：只展示推理状态标记、工具动作和最终可见文本，不原样暴露 `thinking_delta`。
- Claude 只读/询问型 Agent 不再使用 Claude Code 的 `plan` permission mode，改为 `default + allowedTools`，避免子 Agent 卡在“等待批准计划”而不产出任务结果。
- Codex adapter 已切到 `codex exec --json --color never`，后端会把 Codex JSONL 翻译成可读的 thread、turn、命令和最终文本输出，同时继续优先读取最终 agent message。
- Codex 子 Agent 现在默认使用独立 bridge 配置：子进程会拿到专用 `CODEX_HOME`、DeepSeek bridge URL 和临时 provider 配置，只影响 AgentHub 启动的 Codex，不影响你自己在终端里的个人 Codex。AgentHub 会在启动前自动创建这个目录。Windows 上可写型 Codex 任务会临时使用 `danger-full-access`，因为当前本机 `workspace-write` 会被 Codex 判成只读。
- OpenClaw 当前未在本机安装；从官方 CLI backend 文档看，它支持 CLI JSONL backend、`openclaw --json` 和内置 `codex-cli` JSONL 配置，后续可以按独立 adapter 接入。
- 本地 `ToolGateway` 已接入 git / Claude Code / Codex 白名单，并限制所有命令和文件访问必须落在 workspace 边界内。
- 工作区产物写入 `data/workspaces/{workspaceId}/repo`，每个 workspace 会初始化并验证独立 git repo。
- PostgreSQL 现在按 workspaces / conversations / messages / agents / agent sessions / task handoffs / runs / artifacts / change sets / context snapshots / workflow events / diagnostic logs 做正规化存储；未配置时使用本地 memory store。
- 上下文包、任务快照、工作流事件和诊断日志都会写入 PostgreSQL；CLI 和 API 都会实时发出主脑、context、模型调用、handoff、子 Agent 执行和综合阶段状态。
- 每次聊天会生成 `turnId`，workflow events 与 diagnostic logs 会共享同一个 turn 标识，便于后续回放完整链路。
- 主脑上下文包包含 workspace 成员、当前聊天模块、可用子 Agent、最近消息、最近 agent runs、artifacts、change sets 和 snapshots，可直接回答“当前工作区有几位成员”等状态问题。
- 子 Agent 执行上下文包会包含自己的 `agentSession` 记忆切片，包括最近私聊消息、最近 handoff、最近 task result。
- 主脑仍决定任务拆分、Agent 顺序和并行意图；AgentHub 后端只做安全兜底：只读任务允许并发，包含 `fileWrite=true` Agent 的并行批次会降级为串行。
- 单产品经理需求对接回合现在会跳过慢的综合模型，直接用本地综合回复，避免 v4-pro 综合 JSON 不稳定时把异常兜底文案展示给用户。
- 真实 Claude Code / Codex 适配器会优先解析有效输出；如果 CLI 已返回有效结果但外层进程退出码异常或 timeout，会标记为 success 并在 logs 写 warning。
- 主脑综合 JSON 已加固：DeepSeek 综合请求使用 `json_object`、关闭 thinking、收紧 schema 提示，并限制 timeout/token；模型仍异常时会本地综合兜底。
- 当前真实验证 workspace：`data/workspaces/ws-ab1d451a-1611-4d75-9bdf-e8b8c39ffc7f/repo`，已由真实 Codex 生成 `index.html` 和 `styles.css`。
- 最新真实链路验证发现：工程师 Codex 子进程在 timeout / exit code 1 但有 final message 时仍会被记录为 success，且微信小程序产物缺失云函数时只能由 Reviewer 发现，说明下一阶段必须补 AgentRun 状态判定、交付清单、基础产物验收和返工门禁。
- 真实链路验收与返工改造方案已整理到 `AgentHub真实链路验收与返工机制改造方案.md`，当前建议先修“半成品不能算 success”，再做 delivery checklist、validator、Reviewer verdict 和事件保留策略。
- 下一阶段建议先补本地最小产物闭环，再转 Web 产品化；当前计划已收敛为先做 Preview、产物事件、Zip 和 Reviewer 真实验收，分批方案见 `AgentHub本地最小产物闭环分批实施方案.md`。

- 本地 preview 路由现在会按扩展名返回正确 MIME，`/api/workspaces/:workspaceId/zip` 会返回 zip 并写入 `artifact_created` / `zip_ready` 事件。
## 本地聊天

```bash
npm run chat
npm run chat:new
npm run chat -- "帮我做一个简单的静态页面"
```

## 前端 Mock 工作台

当前 Web 工作台代码已拆到 `E:\byDance\agentHubFrontend`。它会优先连接本地 API；API 不可用时自动进入 Demo 数据，用于验证 AgentHub 的产品形态和 UI 风格。

- 技术栈：Vite + React + TypeScript + lucide-react。
- 入口：`E:\byDance\agentHubFrontend\src\main.tsx`，页面壳子在 `E:\byDance\agentHubFrontend\src\App.tsx`。
- Demo 数据：`E:\byDance\agentHubFrontend\src\fixtures\demoState.ts`。
- 组件目录：`E:\byDance\agentHubFrontend\src\components\`。
- 样式目录：`E:\byDance\agentHubFrontend\src\styles\`，当前 `index.css` 控制在 1000 行以内，`effects.css` 承载背景和交互动效。
- 背景动效：`E:\byDance\agentHubFrontend\src\components\BackgroundCanvas.tsx` 在背景图上方绘制非交互 canvas 伪动画，当前使用更明显的粉紫蓝光场、柔和粒子漂移和轻扫光，只影响背景层。
- 视觉方向：背景图提供主色，工作台使用更通透的多段半透明渐变、亮边、高光、blur 和 saturation 形成紧凑玻璃风组件。

启动命令：

```bash
Set-Location E:\byDance\agentHubFrontend
npm run dev
npm run build
npm run preview
```

当前 mock 页面覆盖：

- 左侧工作区栏：群聊工作区和单聊工作区都作为 workspace room 展示，不再单独展示会话列表；工作区卡片保持紧凑，参与 Agent 头像统一尺寸并按顺序叠层。
- 中央聊天区：根据当前工作区显示群聊 Orchestrator 调度或固定目标 Agent 单聊。
- 顶部观察条：可同时观察多个工作区的最新事件和产物数量。
- 右侧详情区：任务阶段、派发任务包、实时事件、目标 Agent 档案、产物和工作区规则。
- 滚动结构：页面外层固定在一屏内，左侧工作区列表、中央聊天记录和右侧详情区分别在各自子框内滚动。
- Demo 交互：发送消息、切换工作区、新建群聊或单聊工作区、消费本地模拟 workflow events。

后续接真实数据时，优先把 mock 数据替换为 `/api/messages/stream` 的 SSE workflow events，包括 `task_stage_updated`、`agent_task_dispatched`、`assistant_delta`、`agent_stdout_delta`、`artifact_created`、`preview_ready` 和 `zip_ready`。

`npm run chat:new` 只创建一个新的默认 workspace 并退出；旧 workspace 不会删除。随后运行 `npm run chat` 会进入这个最新 workspace，并默认停在 `@main` 主聊天室。交互中可以像切 git 分支一样切换聊天模块：

```text
@main
@engineer
@product-manager
@reviewer
```

切换后，普通输入会发送到当前模块：

```text
agenthub:AgentHub CLI Workspace/@main> 总结当前项目状态
agenthub:AgentHub CLI Workspace/@engineer> 你好
agenthub:AgentHub CLI Workspace/@engineer> /run 检查 index.html 和 styles.css
```

也支持一行切换并发送：

```text
@engineer 检查当前工作区文件
@main 让主脑安排下一步任务
```

私聊规则：

- `@product-manager 你好`：进入产品经理 AgentSession 轻量对话，不准备 workspace、不锁定 baseCommit、不启动真实 CLI agent。
- `@product-manager /run 请输出一个简单 PRD`：在同一个 AgentSession 中创建 `TaskHandoff`，然后启动真实 Claude Code / Codex / mock adapter。
- `@main 请做一个页面`：默认先进入需求对接或方案确认，不直接派工程师；用户确认“按方案开始实现”后再进入工程和审查链路。

常用 CLI 命令：

```text
/agents      查看 agent
/workspace   查看当前 workspace
/where       查看当前 workspace 和聊天模块
/convs       查看当前 workspace 的会话
/logs        查看当前模块最近的 workflow events
/logs --turn 查看当前模块最近一轮 turn 的完整事件
/logs --debug 查看当前模块最近的 diagnostic logs
/runs        查看当前 workspace 最近 AgentRun
/handoffs    查看当前 workspace 最近 TaskHandoff
/sessions    查看当前 workspace 的 AgentSession
/session     查看当前 @agent 的 session 历史
/main        切回 @main
/new         在当前 CLI 内创建并切换到新 workspace
/exit        退出
```

实时打印重点：

- `@main` 会显示 turn、主脑 context、路由决策、handoff、AgentRun、综合阶段状态和最终回复流式 delta。
- 需求类任务会显示 `task_stage_updated`，派发时会显示 `agent_task_dispatched`，便于前端渲染主脑给子 Agent 的任务包。
- `@agent 你好` 会显示 session context、轻量模型调用和最终回复流式 delta，不会显示 baseCommit 或 AgentRun heartbeat。
- `@agent /run ...` 会显示 handoff pending/running/completed、run context、真实或 mock adapter 执行状态，以及真实子进程 stdout/stderr 的可读流式输出。

## API 流式

本地 API 现在提供：

```text
POST /api/messages
POST /api/messages/stream
```

`/api/messages/stream` 返回 SSE 事件，客户端只需要消费统一的 AgentHub workflow 事件即可，不需要直接处理 DeepSeek 原生流。

前端重点可消费：

```text
task_stage_updated
agent_task_dispatched
handoff_created
handoff_updated
agent_started
agent_progress
agent_output_started
agent_stdout_delta
agent_stderr_delta
agent_output_finished
agent_finished
assistant_message_started
assistant_delta
assistant_message_finished
artifact_created
change_set_created
preview_ready
zip_ready
```

## 环境配置

`.env.local` 会被自动读取。当前兼容短变量名：

```text
MODEL=deepseek model name
APIKEY=deepseek api key
```

推荐显式配置：

```text
AGENTHUB_ORCHESTRATOR_PROVIDER=deepseek
AGENTHUB_ORCHESTRATOR_MODEL=deepseek-v4-pro
AGENTHUB_ORCHESTRATOR_TIMEOUT_MS=90000
AGENTHUB_ORCHESTRATOR_MAX_TOKENS=2000
AGENTHUB_CODEX_BRIDGE_URL=http://127.0.0.1:8788/v1
AGENTHUB_CODEX_MODEL_PROVIDER=agenthub-deepseek
AGENTHUB_CODEX_MODEL=deepseek-v4-pro
AGENTHUB_CODEX_HOME=.codex-agenthub
AGENTHUB_CODEX_BRIDGE_API_KEY=agenthub-local
DEEPSEEK_API_KEY=replace-with-your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
AGENTHUB_REAL_AGENTS=true
```

Codex bridge 的推荐顺序：

```text
1. 先确认 `.env.local` 里已经能读取 DeepSeek key。
2. 运行 `npm run codex:bridge`，启动本地 mimo2codex bridge。
3. 重启 AgentHub，再让 `@engineer /run ...` 走真实 Codex 子 Agent。
```

## 验证命令

自动化测试默认使用 Vitest、memory store 和 mock Agent，不调用真实 Claude Code / Codex / DeepSeek，也不写入正式 `data/workspaces`。测试夹具在 `tests/fixtures/`，运行时临时 workspace 使用系统临时目录并在测试结束后清理。集成测试通过 `createApp(env, { logger: false })` 关闭 Fastify 请求日志，正式 API 启动仍保持默认日志。

当前自动化覆盖：

- unit：delivery 状态降级、delivery validator、runtime preview/zip、visible speaker。
- integration：`/api/health`、`/api/state`、`/api/workspaces`、`/api/messages`、`/api/messages/stream`、`/preview/:workspaceId/*`、`/api/workspaces/:workspaceId/zip`。
- workflow：普通聊天不新增 AgentRun、模糊需求不派工程师、direct `/run` 创建 handoff/run/artifact/event、workflow events 可从 state 回放。
- real：`tests/real/real-agent-smoke.test.ts` 保留真实 Agent 烟测入口，默认 skipped；显式开启后会验证真实 engineer 子 Agent 可返回结果，并能在隔离临时 workspace 里创建 `index.html` / `styles.css`、生成 changeSet 和 preview event。

```bash
npm run check
npm test
npm run verify
npm run db:smoke
npm run chat -- --once "@main 目前我们工作区有几位成员？"
npm run chat -- --once "@product-manager 你好"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "@product-manager /run 请输出一个超短PRD，不要读写文件"
node_modules\.bin\tsx.cmd src\cli\chat.ts new --mock --once "@main 请必须重新调度子Agent：规划并模拟实现一个简单静态页面。这是全新调度链路测试，不需要真实写文件。"
npm run chat -- new --once "请在当前本地 workspace 里创建一个极简但好看的静态前端页面，用真实工程师 agent 完成，生成 index.html 和 styles.css，不要使用 mock，不要启动服务。"
npm run chat -- --once "@engineer 请只做一句话检查：确认当前目录是否存在 index.html 和 styles.css，不要修改任何文件。"
npm run chat -- --once "@main 请简要总结当前 workspace 状态，不要修改文件。"
npm run chat -- --once "@product-manager /run 请只输出一句话：真实子agent流式输出测试完成。不要读写文件，不要运行命令。"
npm run chat -- --once "@engineer /run 请只输出一句话：真实Codex子agent JSONL流式输出测试完成。不要读写文件，不要运行命令。"
npm run codex:bridge
npm run chat -- --once "@main 我主要想做一个候选人投票的小程序，先帮我梳理需求和方案，不要写代码。"
```

真实 Agent 自动化烟测需要显式开启，避免日常测试误跑真实 CLI、模型调用或 token 消耗：

```bash
$env:AGENTHUB_RUN_REAL_TESTS='true'
npm run test:real
```

已验证：

```bash
npm run check
npm test
npm run verify
npm run db:smoke
npm run chat -- --once "@main 目前我们工作区有几位成员？"
npm run chat -- --once "@product-manager 你好"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "@product-manager /run 请输出一个超短PRD，不要读写文件"
node_modules\.bin\tsx.cmd src\cli\chat.ts new --mock --once "@main 请必须重新调度子Agent：规划并模拟实现一个简单静态页面。这是全新调度链路测试，不需要真实写文件。"
npm run chat -- new --once "请在当前本地 workspace 里创建一个极简但好看的静态前端页面，用真实工程师 agent 完成，生成 index.html 和 styles.css，不要使用 mock，不要启动服务。"
npm run chat -- --once "@engineer 请只做一句话检查：确认当前目录是否存在 index.html 和 styles.css，不要修改任何文件。"
npm run chat -- --once "@main 请简要总结当前 workspace 状态，不要修改文件。"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "@product-manager 你好"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "@main 你好"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "@product-manager /run 梳理需求"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "帮我做一个小程序"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "可以，按这个方案开始实现"
node_modules\.bin\tsx.cmd src\cli\chat.ts --mock --once "先给我方案，不要写代码"
npm run chat -- --once "@product-manager /run 请只输出一句话：真实子agent流式输出测试完成。不要读写文件，不要运行命令。"
npm run chat -- --once "@engineer /run 请只输出一句话：真实Codex子agent JSONL流式输出测试完成。不要读写文件，不要运行命令。"
npm run chat -- --once "@main 我主要想做一个候选人投票的小程序，先帮我梳理需求和方案，不要写代码。"
```

最近一次真实验证结论：

- DeepSeek 主脑可直接回答状态查询：“目前工作区有5位成员：user、orchestrator、product-manager、engineer、reviewer。”
- `@product-manager 你好` 现在走真实 DeepSeek AgentSession 轻量回复，CLI 会显示 turn、session context、轻量模型调用和 `chat_reply`，没有 `agent_started`。
- `@product-manager /run 请输出一个超短PRD，不要读写文件` 会创建 `TaskHandoff`，显示 pending/running/completed，启动 AgentRun，并把结果写回同一个产品经理 AgentSession。
- DeepSeek 主脑可输出 `dispatch_agents/serial`，并按 `product-manager -> engineer -> reviewer` 调度子 Agent。
- 子 Agent 全部完成后，DeepSeek 主脑会再次执行综合，输出偏项目经理交付总结的最终答复。
- 如果综合主脑输出 `continue_dispatch`，当前版本只展示建议，不会自动执行后续派发。
- `product-manager`、`engineer`、`reviewer` 三个真实子 Agent 均返回 success。
- `engineer` 通过真实 Codex 在独立 workspace git repo 中生成静态页面文件。
- PostgreSQL 已记录对应 `agentRuns`、`workflowEvents`、`contextSnapshots`、`artifacts` 和 `changeSets`。
- PostgreSQL 已记录 AgentSession、AgentSessionMessage、TaskHandoff、DiagnosticLog，并能通过 `db:smoke` 验证完整读写回环。
- 只读私聊检查不会重复生成 changeSet。
- `@product-manager 你好` 现在会走轻量流式最终回复，不再使用大段固定模板。
- `@main 你好` 现在会在最终回复阶段流式输出 assistant delta。
- `POST /api/messages/stream` 已确认能返回 `assistant_delta` 和 `assistant_message_finished` 事件。
- `帮我做一个小程序` 现在进入 `requirements_intake`，执行闸门会暂缓 engineer，只派 product-manager 对接需求。
- `可以，按这个方案开始实现` 会进入 `execution`，允许派发 engineer 和 reviewer。
- `先给我方案，不要写代码` 会保持需求/方案阶段，不派工程师执行。
- Claude 子 Agent 执行现在能在 CLI 中实时看到 `stdout` 流式输出；`thinking_delta` 不原样展示，只显示推理状态标记。
- `@product-manager /run 请只输出一句话...` 已验证真实 Claude adapter 会直接返回目标句子，不再卡在 Claude Code plan approval。
- Codex 子 Agent 执行现在能在 CLI 中看到 JSONL 转译后的 thread、turn 和最终 agent message；`@engineer /run 请只输出一句话...` 已验证真实 Codex adapter 会返回目标句子。
- `npm run codex:bridge` 会启动本地 mimo2codex bridge；打开 bridge 配置后，AgentHub 的 Codex 子 Agent 会通过它转发到 DeepSeek。
- 需求对接类主脑回合已验证只派产品经理，综合阶段走本地 summary，不再调用 DeepSeek v4-pro 综合模型。
- 注意：`db:smoke` 会创建并清理临时 workspace，不能和 `npm run chat` 并行执行，否则 chat 可能选中正在被 smoke 清理的最新 workspace。

## Web 前端工作台方案

当前 Web 前端已拆到独立目录 `E:\byDance\agentHubFrontend`，本仓库只保留 agent/runtime/API/CLI。前端目标不是普通 chatbot，而是比赛要求中的 AgentHub 多 Agent IM 工作台，当前版本聚焦“工作区即聊天房间”的可运行 Demo 和产品形态展示。

前端开发约束：

- 遵守 `developSkills.md`：新增函数写英文注释，说明作用、输入和输出；完成后执行可用验证命令。
- 新增文件按职责拆分到 `E:\byDance\agentHubFrontend\src\api`、`E:\byDance\agentHubFrontend\src\components`、`E:\byDance\agentHubFrontend\src\fixtures`、`E:\byDance\agentHubFrontend\src\styles`，避免单文件超过 1000 行。
- UI 采用半透明玻璃组件，背景主色来自 `E:\byDance\agentHubFrontend\src\asset\background\`，AI Core 图来自 `E:\byDance\agentHubFrontend\src\asset\brand\ai-core.png`，AI Core 只作为品牌和 Orchestrator 视觉符号使用。
- 页面首屏直接进入工作台，不做营销式落地页；顶部说明文案条已删除，把高度留给工作区、聊天和详情面板。

当前页面结构：

- 左侧工作区栏：展示多个 workspace room、运行状态、参与 Agent、最近产物，可切换当前工作区；卡片高度更紧凑，参与 Agent 头像统一尺寸并按顺序叠层。
- 中央聊天区：展示当前工作区的用户、Agent、系统消息，支持流式 assistant delta、消息产物卡和快捷命令。
- 右侧详情区：展示任务阶段、Agent handoff、运行事件、目标 Agent 档案、Preview / Zip / Diff 等产物。
- 顶部多工作区观察条：可同时观察多个 workspace 的最新状态，突出“多工作区观看”能力。
- 视觉层：整站使用背景图上色，`BackgroundCanvas` 在背景图上方绘制更明显的粉紫蓝色彩流动和粒子漂移，核心面板、消息气泡和输入框使用更通透的多段半透明渐变、亮边、顶部高光、blur 和 saturation 的紧凑玻璃风格。
- 动效层：`effects.css` 管理非布局型轻动效，包括工作区卡片、观察卡、按钮、头像和运行状态的 hover / pulse / enter 反馈。
- 滚动层：`body`、页面壳和工作台外层不滚动，只允许工作区列表、聊天消息区和右侧详情区内部滚动。

前端概念模型：

- 前端只暴露“工作区”，不再展示独立会话列表；一个群聊工作区和一个单聊工作区都表现为一个可切换工作区。
- 群聊工作区：默认由 Orchestrator 判断、拆解和调度；用户在群聊中 `@engineer`、`@reviewer` 等子 Agent 时，目标 Agent 在群聊上下文中定向回复。
- 单聊工作区：固定发送给一个目标 Agent，适合明确任务、复查或一对一上下文沉淀。
- 后端和数据库仍保留 `workspace + conversation`，前端通过 `WorkspaceRoom` 自动选择每个 workspace 的 primary internal conversation，并隐藏这层实现细节。

前端接口：

- `GET /api/state` 初始化工作区、会话、消息、Agent、产物和 workflow events。
- `POST /api/workspaces` 新建工作区。
- `POST /api/conversations` 仍可新建内部单聊或群聊；Web 创建单聊工作区时会在新 workspace 下自动创建 direct primary conversation。
- `POST /api/messages/stream` 发送消息并消费 SSE 事件。
- `POST /api/agents` 创建自定义 Agent。
- `/preview/:workspaceId/...` 打开网页预览，`/api/workspaces/:workspaceId/zip` 下载工作区 zip。
