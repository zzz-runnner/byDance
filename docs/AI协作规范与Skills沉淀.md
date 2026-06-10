# AI 协作规范与 Skills 沉淀

本文档用于说明 AgentHub 项目在使用 Codex/AI 进行协作开发时沉淀出的规范、专项能力和可复用流程。它是交付文档中“AI 协作能力”的仓库内证据，不依赖某台电脑上的个人路径。

## 1. 协作目标

AgentHub 的 AI 协作不是简单让 AI 生成代码，而是把 AI 作为项目协作伙伴参与：

- 需求理解。
- 产品方案设计。
- 技术架构拆解。
- 前后端实现。
- Agent Runtime 实现。
- 移动端适配。
- 真实链路验收。
- 返工修复。
- 文档交付整理。

## 2. Spec 沉淀

Spec 用于约束“做什么”和“为什么这样做”。

| Spec 文档 | 说明 |
| --- | --- |
| `docs/AgentHub架构设计文档.md` | 定义工作区、群聊、单聊、Orchestrator、AgentDefinition、Artifact 和整体架构 |
| `docs/开发具体方案及技术栈.md` | 定义 AgentHub Runtime、业务后端、前端、存储、版本、构建和部署边界 |
| `docs/AgentHub第一期落地执行计划.md` | 定义第一阶段范围、优先级和不做项 |
| `docs/AgentHub本地最小产物闭环分批实施方案.md` | 定义本地闭环、预览、zip、版本和交付的实施节奏 |
| `docs/业务后端接口文档.md` | 定义业务后端接口、字段、错误和 SSE/静态资源约定 |

## 3. Rules 沉淀

Rules 用于约束“怎么和 AI 协作写代码”。

项目规则主要保存在：

- `docs/developSkills.md`
- `agentHub/developSkills.md`
- `agentHubFrontend/developSkills.md`

核心规则包括：

1. 新增或修改代码要有清晰职责边界。
2. 函数注释使用英文说明作用、输入和输出。
3. 修改后在条件允许时执行验证命令。
4. 临时测试文件、临时日志和一次性脚本需要清理。
5. 阶段性完成后更新 README，记录当前项目状态。
6. git 提交需要详细说明，不随意推送远程。
7. 大文件要按职责拆分，避免继续堆叠难维护文件。
8. 遇到无法判断的方案决策，要先说明风险和建议。

## 4. 项目专项 Skills

这里的 skills 指本项目沉淀出的“专项协作能力”，不是把所有 Codex 系统内置技能原样罗列。

### 4.1 Agent Runtime Skill

目标：让 AI 能围绕 AgentHub Runtime 进行调度、执行、验收和返工开发。

沉淀内容：

- Orchestrator 阶段门控。
- 子 Agent dispatch。
- TaskHandoff / AgentRun 记录。
- Claude Code / Codex / mock adapter。
- workflow events。
- delivery validation。
- reviewer verdict。
- automatic repair。

证据：

- `agentHub/src/server/orchestrator/workflow.ts`
- `agentHub/src/server/orchestrator/turn-router.ts`
- `agentHub/src/server/orchestrator/delivery/`
- `agentHub/src/server/orchestrator/repair.ts`
- `agentHub/src/server/adapters/`
- `docs/AgentHub真实链路验收与返工机制改造方案.md`

### 4.2 Web Workbench Skill

目标：让 AI 能围绕 Web 工作台做 IM 体验、过程可视化和产物交付界面。

沉淀内容：

- 工作区列表。
- 群聊和单聊。
- `@Agent` picker。
- 消息引用。
- 流式消息。
- 过程卡片。
- 产物卡片。
- Markdown 渲染。
- 代码工作区。
- Diff/Preview/Version/Build/Deploy。
- PDF/DOCX/PPTX 文档预览。

证据：

- `agentHubFrontend/README.md`
- `agentHubFrontend/src/components/ChatPane.tsx`
- `agentHubFrontend/src/components/WorkspaceRail.tsx`
- `agentHubFrontend/src/components/AgentMentionPicker.tsx`
- `agentHubFrontend/src/components/CodeWorkspaceDialog.tsx`
- `agentHubFrontend/src/components/DocumentPreviewPane.tsx`
- `agentHubApp/docs/AgentHub Web端已有功能清单.md`

### 4.3 Business Backend Skill

目标：让 AI 能围绕业务后端维护项目、版本、构建、部署和运行时代理能力。

沉淀内容：

- 项目与 workspace 绑定。
- 工作台分页、搜索、筛选。
- 项目状态聚合。
- Runtime 消息流代理。
- 文件树、文件内容、diff、preview 代理。
- 版本保存、版本 diff、版本恢复。
- build preview。
- deploy preview。
- source zip。

证据：

- `agentHubBackend/README.md`
- `docs/业务后端接口文档.md`
- `agentHubBackend/src/projects/`
- `agentHubBackend/src/versions/`
- `agentHubBackend/src/builds/`
- `agentHubBackend/src/deployments/`
- `agentHubBackend/src/storage/`

### 4.4 Mobile App Skill

目标：让 AI 能围绕 Expo/React Native 移动端做小屏适配、功能取舍、状态触达和接口接入。

沉淀内容：

- 移动端定位为轻量协作入口。
- 首页、工作区、聊天、产物摘要、Agent 状态。
- 移动端保留构建、部署、产物等相关入口或状态触达，但不承担完整工程排查、复杂 Diff 和 Monaco 级代码编辑。
- 小屏/标准屏/宽屏布局密度控制。
- SafeArea、底部导航、键盘和卡片密度适配。

证据：

- `agentHubApp/README.md`
- `agentHubApp/docs/AgentHub移动端App功能取舍说明.md`
- `agentHubApp/docs/AgentHub移动端App接口对接文档.md`
- `agentHubApp/docs/AgentHub移动端UI功能说明.md`
- `agentHubApp/src/styles/mobileScale.ts`

## 5. Codex 环境技能的使用口径

Codex 环境中存在系统技能和个人技能，例如图片生成、官方文档查询、skill 创建、React Native 移动端适配等。这些能力可以帮助开发，但交付时不建议把某台电脑上的绝对路径作为主要证据。

推荐口径：

- 系统内置技能只作为“AI 工具能力背景”简要说明。
- 项目相关技能要沉淀到仓库文档中，也就是本文档。
- 真正给评委看的证据以仓库文件、代码模块、测试和提交记录为主。

## 6. AI 协作流程

```text
课题要求
-> 产品 Spec
-> 技术 Spec
-> 开发 Rules
-> 分端专项 Skill
-> AI 辅助实现
-> 测试/Smoke/真实链路验收
-> 返工修复
-> README 和交付文档沉淀
```

## 7. 后续可继续沉淀的 Skills

后续如果继续开发，可以把以下专项能力进一步写成更标准的 Codex skill：

- `agenthub-runtime-development`
- `agenthub-web-workbench`
- `agenthub-business-backend`
- `agenthub-mobile-app`
- `agenthub-delivery-validation`

这些 skill 可以放在仓库的 `docs/skills/` 或未来正式的 `.codex/skills/` 目录中，形成更强的可复用 AI 协作资产。

## 8. 具体协作案例

本节用于给交付文档提供可核验的 AI 协作证据。这里先沉淀已经整理清楚的个人 Codex 协作案例，后续可以继续补充 Web、后端和 Agent Runtime 成员案例。

### 8.1 移动端 App 产品取舍与适配

问题：Web 工作台包含完整聊天、Agent 管理、代码、Diff、Preview、Version、Build、Deploy 能力，移动端如果完全照搬会导致小屏拥挤，也会让 App 维护成本过高。同时 App 中已经存在构建、部署、产物相关按钮或入口，因此需要准确区分“轻量触达”和“完整工程工作台”。

AI 协作方式：使用 Codex 阅读 App README、移动端功能文档、Web 功能清单和接口文档，结合 React Native/Expo 小屏适配经验，重新划分 Web 与 App 的职责。

沉淀结果：

- `agentHubApp/docs/AgentHub移动端App功能取舍说明.md`
- `agentHubApp/docs/AgentHub移动端App接口对接文档.md`
- `agentHubApp/docs/AgentHub移动端UI功能说明.md`
- `docs/AI协作规范与Skills沉淀.md`

最终口径：App 是轻量协作入口，可展示或触达构建、部署、产物等结果；完整日志排查、复杂 Diff 阅读和 Monaco 级代码编辑仍以 Web 工作台为主。

### 8.2 交付文档冲刺与评分映射

问题：项目代码和功能已经接近交付，但文档分散，新旧口径混杂，容易让评委看不出项目和评分标准之间的对应关系。

AI 协作方式：使用 Codex 读取课题要求、项目 README、docs、提交记录和公网部署状态，把材料重新映射到 AI 协作能力、功能完整度、生成效果质量、代码理解度、创新与产品感五个评分维度。

沉淀结果：

- `docs/delivery-90/飞书交付终稿.md`
- `docs/delivery-90/内部审计与整理建议.md`

最终效果：飞书正文从“开发材料堆叠”调整为“评委可直接阅读的交付说明”，内部审计文档则保留给团队判断哪些材料适合作为附件、哪些不适合直接暴露。

### 8.3 飞书图表显示问题修正

问题：部分 Mermaid 图在飞书中可能出现裁切、显示不完整或移动端阅读困难，影响评委对核心流程的理解。

AI 协作方式：根据截图反馈，让 Codex 将复杂回环图改成短主线流程，并把分支逻辑放入表格说明；同时补充飞书原生流程图、导出 PNG、必要时使用 imagegen 生成汇报视觉图的替代方案。

沉淀结果：`docs/delivery-90/飞书交付终稿.md` 中的核心流程采用“主线图 + 分支表”，内部审计文档补充了图表处理策略。

最终效果：降低飞书渲染失败导致的展示风险，也让正文阅读更清楚。

### 8.4 Skills 证据口径修正

问题：本机 Codex 环境存在系统 skill 和个人 skill，如果把绝对路径直接放入飞书正文，容易让评委觉得证据依赖个人电脑，不像项目资产。

AI 协作方式：使用 Codex 区分 `.system` 内置技能、个人技能和仓库内专项能力，重新定义交付口径：系统技能只作为工具背景，真正评分证据以仓库文档、代码模块、测试和提交记录为主。

沉淀结果：本文档把 Agent Runtime、Web Workbench、Business Backend、Mobile App 四类能力统一整理为仓库内可交付的专项 Skills。

最终效果：飞书正文可引用仓库文档作为 evidence，不依赖本机 `.codex/skills` 路径。

## 9. 队友补充模板

建议每位成员至少补充 1 个真实案例，格式保持短而实：

| 成员/模块 | 遇到的问题 | 与 AI 的协作方式 | 产出文件/提交记录 | 最终效果 |
| --- | --- | --- | --- | --- |
| Web 工作台/前端交互（待补充） | 例如：聊天流、产物卡片、Diff/Preview/Version 状态复杂。 | 例如：让 AI 拆组件职责、检查状态流、生成边界场景清单、辅助修复 UI bug。 | 例如：`agentHubFrontend/src/components/ChatPane.tsx`、`CodeWorkspaceDialog.tsx`、相关 commit。 | 例如：Web 工作台能稳定展示聊天、过程、产物和交付入口。 |
| 后端/Agent Runtime/部署（待补充） | 例如：Runtime、业务后端、预览代理、版本和部署链路需要打通。 | 例如：让 AI 梳理接口契约、定位链路断点、补充 smoke/测试和 README。 | 例如：`agentHub/src/server/orchestrator/workflow.ts`、`agentHubBackend/src/`、部署 commit。 | 例如：公网 Demo 可访问，后端健康检查返回 `ok: true`，构建/部署/zip 链路可演示。 |
