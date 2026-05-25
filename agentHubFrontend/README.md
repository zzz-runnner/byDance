# AgentHub Frontend

AgentHub Web frontend is split out from `E:\byDance\agentHub` and keeps its own dependencies, lockfile, build output, and runtime commands.

This directory is not an npm workspace package and does not depend on the AgentHub runtime through `file:` links. The local API is expected to run separately from `E:\byDance\agentHub`.

## Commands

```bash
npm install
npm run dev
npm run build
npm run check
npm run preview
```

## Runtime Link

- Dev server: `http://127.0.0.1:5173`
- Backend API proxy target: `http://127.0.0.1:8787`
- API endpoints consumed by the frontend: `/api/state`, `/api/messages/stream`, `/api/workspaces`, `/api/conversations`
- Preview assets are proxied through `/preview`

If the AgentHub runtime API is unavailable, the frontend falls back to local demo data.

## Boundary

- Frontend owns UI, local demo fixtures, browser state, and Vite build output.
- `E:\byDance\agentHub` owns AgentHub runtime, local API, CLI, orchestration, adapters, workspace runtime, and storage.
- Business backend is intentionally out of scope for this split.

## 当前状态

- 背景动效已从 `tsParticles` 粒子层改为纯 CSS 彩色模糊流光遮罩，不再使用粒子点和连线。
- `src/components/BackgroundCanvas.tsx` 保留原组件名，内部只渲染非交互式装饰层。
- `src/styles/effects.css` 增加青蓝、洋红、紫色和暖金的慢速柔焦覆盖层，并保持 `pointer-events: none`，不影响工作台点击、输入和滚动。
- 工作区列表已收紧卡片高度，避免左侧工作区卡片被网格拉伸出过多底部留白。
- 聊天区正文、输入框和卡片辅助文字已提升字号，消息操作按钮常态显示。
- 当前工作台背景图片使用 `src/asset/background/newBG.png`。
- 后端 API 未运行时，页面仍会回退到本地 demo 数据；后端运行在 `127.0.0.1:8787` 后会通过 Vite proxy 进入 live 状态。
- 当前目录已初始化为 Git 仓库，`main` 分支跟踪 `origin/main`，远程地址为 `git@github.com:zzz-runnner/agentHubFrontend.git`。

## 验证记录

最近一次前端背景动效接入后已执行：

```bash
npm run check
npm run build
Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing -TimeoutSec 5
```

结论：TypeScript 类型检查通过，Vite 生产构建通过，开发服务首页返回 `HTTP 200`。

现在仓库已初始化，后续改动提交前应执行 `git diff --check`。
