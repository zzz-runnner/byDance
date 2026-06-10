# AgentHub 多 Agent 协作平台

AgentHub 是一个以 IM 聊天为核心交互的多 Agent 协作平台。用户在项目工作区中发起需求、发送消息、`@Agent`、查看执行过程和预览产物；平台由 Orchestrator 调度产品经理、工程师、Reviewer 等子 Agent，共同完成需求澄清、代码实现、审查、预览、版本和交付。

一句话概括：AgentHub 把 AI Agent 从“单个工具回答”升级为“项目工作区中的多 Agent 协作与产物交付”。

## 在线访问

| 类型 | 地址 |
| --- | --- |
| Web 公网 Demo | http://120.79.130.49:5173 |
| 业务后端健康检查 | http://120.79.130.49:8790/api/health |
| GitHub 仓库 | https://github.com/zzz-runnner/byDance |

后端健康检查当前应返回类似：

```json
{
  "ok": true,
  "service": "agenthub-backend",
  "agentHubBaseUrl": "http://agenthub:8787",
  "storageRoot": "/opt/agenthub/agenthub-backend-data"
}
```

## 核心能力

- 工作区式项目管理：一个工作区保存项目目标、聊天上下文、Agent 成员、产物和版本状态。
- IM 协作体验：支持群聊、单聊、`@Agent`、消息引用、消息 pin、Markdown 渲染和流式回复。
- 多 Agent 调度：Orchestrator 根据任务阶段调度产品经理、工程师、Reviewer 等子 Agent。
- 用户自建 Agent：支持在工作区内创建、编辑和调用自定义 Agent。
- 产物交付闭环：支持网页预览、文件树、源码查看、Diff、文档预览、版本、构建、部署预览和源码 zip。
- 多端支持：Web 是完整工程工作台，App 是轻量协作入口，可查看/触达聊天、Agent、产物、构建和部署状态。
- AI 协作沉淀：项目保留 Spec、rules、专项 Skills、真实链路验收和交付文档。

## 项目结构

| 目录 | 职责 |
| --- | --- |
| `agentHub/` | AgentHub Runtime，负责 Orchestrator、子 Agent 调度、Adapter、workflow events、workspace repo、preview、zip 和存储 |
| `agentHubBackend/` | Nest 业务后端，负责项目元数据、工作台接口、版本、构建、部署预览、预览代理和统一 API |
| `agentHubFrontend/` | React/Vite Web 工作台，负责工作区、聊天、过程卡片、产物卡片、代码工作区、Diff、预览、版本和交付 |
| `agentHubApp/` | Expo/React Native 移动端 App，负责轻量工作区、聊天、产物摘要、Agent 状态和结果触达 |
| `docs/` | 架构、接口、AI 协作、交付材料和内部整理文档 |

本地 Web 链路：

```text
agentHubFrontend -> agentHubBackend -> agentHub Runtime -> Agent adapters
```

默认端口：

| 服务 | 端口 | 说明 |
| --- | ---: | --- |
| `agentHub` | `8787` | Runtime API |
| Codex bridge | `8788` | 可选，本地 Codex 适配桥 |
| `agentHubBackend` | `8790` | 业务后端 API |
| `agentHubFrontend` | `5173` | Web 工作台 |
| `agentHubApp` | Expo 默认端口 | Expo Dev Server |

## 环境要求

- Node.js 20+ 建议。
- npm 可直接运行本仓库四个子工程。
- Expo Go 或 Android/iOS 模拟器用于移动端调试。
- 可选：PostgreSQL。默认本地开发可使用文件/本地存储配置。

每个子工程独立维护依赖和 lockfile。仓库根目录不是 npm workspace，因此需要分别安装依赖。

## 本地启动 Web 端

下面命令默认当前终端已经位于仓库根目录。第一次启动先安装依赖：

```powershell
cd agentHub
npm install

cd ..\agentHubBackend
npm install

cd ..\agentHubFrontend
npm install
```

按顺序打开 3-4 个终端启动服务。

终端 1：启动 AgentHub Runtime。

```powershell
cd agentHub
npm run dev:api
```

终端 2：可选，启动 Codex bridge。只有需要本机 Codex adapter 时启动；普通 mock/Claude 路径可先跳过。

```powershell
cd agentHub
npm run codex:bridge
```

终端 3：启动业务后端。

```powershell
cd agentHubBackend
npm run dev
```

终端 4：启动 Web 工作台。

```powershell
cd agentHubFrontend
npm run dev
```

启动后访问：

- Web 工作台：http://127.0.0.1:5173
- 后端健康检查：http://127.0.0.1:8790/api/health
- Runtime 健康检查：http://127.0.0.1:8787/api/health

### 后端本地配置

`agentHubBackend` 默认读取本地配置即可运行。需要自定义时复制 `.env.example`：

```powershell
cd agentHubBackend
Copy-Item .env.example .env
```

常用配置：

```text
PORT=8790
CORS_ORIGIN=http://127.0.0.1:5173
AGENTHUB_BASE_URL=http://127.0.0.1:8787
AGENTHUB_RUNTIME_ROOT=../agentHub/data/workspaces
APP_STORAGE_ROOT=data
APP_METADATA_STORE=local
```

如果需要 PostgreSQL metadata storage，可额外配置：

```text
DATABASE_URL=postgres://agenthub:agenthub@127.0.0.1:5432/agenthub_business
```

## 本地启动 App 端

第一次启动先安装依赖：

```powershell
cd agentHubApp
npm install
```

默认情况下，App 使用公网业务后端：

```text
http://120.79.130.49:8790
```

直接启动 Expo：

```powershell
cd agentHubApp
npm run start
```

然后使用 Expo Go 扫码，或在终端中按提示打开 Android/iOS 模拟器。

如果希望 App 连接本机后端，需要先启动 Web 端本地链路中的 `agentHub` 和 `agentHubBackend`，再设置 `EXPO_PUBLIC_BUSINESS_API_BASE_URL`。

Windows PowerShell 示例：

```powershell
cd agentHubApp
$env:EXPO_PUBLIC_BUSINESS_API_BASE_URL='http://127.0.0.1:8790'
npm run start
```

注意：

- 如果使用手机真机访问本机后端，`127.0.0.1` 指的是手机自身，不是电脑。
- 真机调试时请把地址改成电脑在同一局域网下的 IP，例如 `http://192.168.1.23:8790`。
- Android 模拟器访问宿主机时通常可使用 `http://10.0.2.2:8790`。

常用 App 命令：

```powershell
cd agentHubApp
npm run start
npm run android
npm run ios
npm run web
npm run check
```

## 验证命令

各端常用检查：

```powershell
cd agentHub
npm run check
npm test

cd ..\agentHubBackend
npm run check
npm run build

cd ..\agentHubFrontend
npm run check
npm run build

cd ..\agentHubApp
npm run check
```

真实 Agent 链路测试默认需要显式开启，避免日常验证消耗真实模型或 CLI：

```powershell
cd agentHub
$env:AGENTHUB_RUN_REAL_TESTS='true'
npm run test:real
```

## 交付文档入口

| 材料 | 链接 | 用途 |
| --- | --- | --- |
| 飞书交付终稿 | [docs/delivery-90/飞书交付终稿.md](docs/delivery-90/飞书交付终稿.md) | 面向评委的正文材料 |
| AI 协作规范与 Skills 沉淀 | [docs/AI协作规范与Skills沉淀.md](docs/AI协作规范与Skills沉淀.md) | AI 协作能力证据 |
| 架构设计文档 | [docs/AgentHub架构设计文档.md](docs/AgentHub架构设计文档.md) | 产品和技术架构 Spec |
| 技术方案及技术栈 | [docs/开发具体方案及技术栈.md](docs/开发具体方案及技术栈.md) | 工程拆分和技术选型 |
| 业务后端接口文档 | [docs/业务后端接口文档.md](docs/业务后端接口文档.md) | API 和字段约定 |
| 真实链路验收与返工机制 | [docs/AgentHub真实链路验收与返工机制改造方案.md](docs/AgentHub真实链路验收与返工机制改造方案.md) | Agent 链路验收和自动返工证据 |
| 移动端功能取舍说明 | [agentHubApp/docs/AgentHub移动端App功能取舍说明.md](agentHubApp/docs/AgentHub移动端App功能取舍说明.md) | App 职责边界说明 |
| 移动端接口对接文档 | [agentHubApp/docs/AgentHub移动端App接口对接文档.md](agentHubApp/docs/AgentHub移动端App接口对接文档.md) | App API 接入说明 |

## 当前边界

当前版本已经完成比赛核心链路，但仍是比赛 Demo 和 MVP 阶段，不主张已经具备完整生产 SaaS 能力。

- 公网 Demo 已部署，可供评委直接访问 Web 工作台。
- 服务端已具备版本、构建预览、部署预览和源码下载链路。
- 移动端以轻量协作为主，可展示或触达构建、部署、产物等入口；完整工程排查、复杂 Diff 和 Monaco 级代码编辑以 Web 工作台为主。
- 多用户权限、租户隔离、弹性队列、更完整的云发布审批和发布历史属于后续增强。

## Git 工作流

从仓库根目录执行 Git 操作：

```powershell
cd <你的仓库根目录>
git status
git add <paths>
git commit -m "详细的阶段提交说明"
```

建议提交前至少运行对应端的 `check/build/test` 命令，并确认 README、飞书文档和实际项目状态一致。


