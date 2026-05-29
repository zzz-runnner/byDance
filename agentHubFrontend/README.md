# AgentHub Frontend

AgentHub Web frontend keeps its own dependencies, lockfile, build output, and runtime commands.

This directory is not an npm workspace package and does not depend on the AgentHub runtime through `file:` links. The frontend talks to the business backend, and the business backend owns the bridge to AgentHub Runtime.

## Commands

```bash
npm install
npm run dev
npm run build
npm run check
npm run preview
```

## Backend Link

- Dev server: `http://127.0.0.1:5173`
- Business backend proxy target: `http://127.0.0.1:8790`
- API endpoints consumed by the frontend: `/api/projects`, `/api/projects/:projectId/state`, `/api/projects/:projectId/messages/stream`
- Preview and delivery assets are proxied through `/preview`, `/build-preview`, and `/deploy`

If the business backend API is unavailable, the frontend falls back to local demo data.

## Current UI Status

- One workspace maps to one chat window in the web workbench.
- Group workspaces now support a WeChat-style `@` mention picker for child agents inside the composer.
- Direct workspaces keep a fixed target agent and do not open the `@` picker.
- Composer shortcut chips still exist as a fallback, and all insertions now respect the current caret position.
- In local live mode, one explicit group-chat `@agent` mention now routes to that child agent for the visible reply instead of always falling back to Orchestrator.
- Non-mention specialist questions can now route to one visible child agent through runtime routing metadata, so the final bubble can show the real specialist instead of a forced Orchestrator summary.
- Auto mode now starts from an empty loading state and no longer flashes demo workspace lists before live backend data arrives.
- The active workspace id is restored from `localStorage` after page refresh.
- Chat switches now open at the latest message, keep follow-scroll during nearby streaming, and show a jump-to-bottom button when the user scrolls away from the bottom.
- The chat list now renders temporary routing and reply placeholders so the user sees waiting bubbles before the final streamed message arrives.
- Each user turn now renders as one chat block with the user message, a `本轮过程` section, inline artifact cards, and the final agent result.
- `本轮过程` stays expanded while the turn is active, auto-collapses after completion, and stays open for failed or partial turns.
- Preview, diff, review, zip, and text artifacts now live inside the main chat stream, and preview/diff details can be opened without relying on the old right-side dock.

## Boundary

- Frontend owns UI, local demo fixtures, browser state, and Vite build output.
- `E:\byDance\agentHubBackend` owns business projects, conversations, versions, builds, deployments, and the API contract consumed by the frontend.
- `E:\byDance\agentHub` owns AgentHub Runtime, local API, CLI, orchestration, adapters, workspace runtime, and storage.

## 当前状态

- 背景动效已从 `tsParticles` 粒子层改为纯 CSS 彩色模糊流光遮罩，不再使用粒子点和连线。
- `src/components/BackgroundCanvas.tsx` 保留原组件名，内部只渲染非交互式装饰层。
- `src/styles/effects.css` 增加青蓝、洋红、紫色和暖金的慢速柔焦覆盖层，并保持 `pointer-events: none`，不影响工作台点击、输入和滚动。
- 工作区列表已收紧卡片高度，避免左侧工作区卡片被网格拉伸出过多底部留白。
- 聊天区正文、输入框和卡片辅助文字已提升字号，消息操作按钮常态显示。
- 当前工作台背景图片使用 `src/asset/background/newBG.png`。
- 业务后端 API 未运行时，页面仍会回退到本地 demo 数据；业务后端运行在 `127.0.0.1:8790` 后会通过 Vite proxy 进入 live 状态。
- 当前目录由根仓库 `E:\byDance` 统一管理 Git，前端只保留自己的依赖和构建配置。

## 验证记录

最近一次前端背景动效接入后已执行：

```bash
npm run check
npm run build
Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing -TimeoutSec 5
```

结论：TypeScript 类型检查通过，Vite 生产构建通过，开发服务首页返回 `HTTP 200`。

现在仓库已初始化，后续改动提交前应执行 `git diff --check`。
