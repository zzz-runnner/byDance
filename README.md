# byDance

This repository keeps the byDance project in one Git repository while each workspace manages its own dependencies.

## Workspaces

- `agentHub/` - AgentHub local runtime, API, CLI, orchestration, adapters, workspace runtime, and storage.
- `agentHubBackend/` - The current local backend adapter on `127.0.0.1:8790`. It exposes the frontend-facing API and forwards runtime work to `agentHub`.
- `agentHubFrontend/` - AgentHub Web frontend with its own Vite/React dependencies and lockfile.

## Current Local Architecture

The current local live path is:

`agentHubFrontend -> agentHubBackend -> agentHub runtime -> real agents`

`agentHubBackend` is the backend used by the frontend in local mode. The current implementation covers:

- `GET /api/health`
- `GET /api/workbench`
- `GET /api/projects`
- `GET /api/agents`
- `GET /api/projects/:projectId`
- `GET /api/projects/:projectId/state`
- `POST /api/projects`
- `POST /api/projects/:projectId/messages/stream`
- `GET /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content`
- `GET /api/projects/:projectId/diff`
- `GET /api/projects/:projectId/preview-targets`
- `GET /preview/*`
- `GET /api/workspaces/:workspaceId/zip`

It supports both:

- Group workspaces backed by the main orchestrated conversation
- Direct workspaces backed by a runtime direct conversation for one target agent
- WeChat-style `@agent` picking in group chat
- Structured `replyTo` quoting and structured `codeSelection` routing input

## 2026-05-31 Local Status

The current local path is focused on one workspace equals one chat window.

- Group chat supports three effective routing inputs:
  - One explicit `@agent` mention is forwarded by `agentHubBackend` as a real upstream target agent.
  - One quoted child-agent message can keep that same child agent as the visible reply target in normal follow-up cases.
  - One code-selection message without an explicit target defaults to `engineer` in group rooms.
- The visible speaker identity flows through `routing_finished.speakerAgentId`, so the frontend can show the actual replying agent instead of always showing Orchestrator.
- The composer now stays close to a normal chat input:
  - Group rooms use natural typing plus the upward `@` mention picker.
  - Direct rooms keep a fixed target and do not show the picker.
  - Messages support a WeChat-style structured quote reference rendered in the composer and in the final bubble.
- The chat surface now renders one grouped turn:
  - User message
  - One inline process block
  - Compact inline artifact cards
  - Final agent reply
- The process block stays expanded while a turn is still running, auto-collapses after completion, and remains expanded for failed or partial turns.
- AI-authored replies, process summaries, and artifact text now use one controlled Markdown renderer with GFM support, safe-link handling, code-block copy actions, and normalization for noisy separators, empty headings, empty bullets, and incomplete code fences.
- Preview, diff, review, zip, and text artifacts are rendered inside the chat stream instead of depending on a separate right-side status panel.
- Frontend startup is now live-only:
  - First load shows a blocking loading state
  - Backend failure shows a blocking retry state
  - The page no longer falls back to mock or demo workspaces
- Preview dialogs show `loading / slow / error` states before iframe content is ready.
- The workbench now loads in two layers instead of sweeping every project state on first paint:
  - The left workspace rail is backed by `/api/workbench`
  - The right chat pane only fetches the active workspace detail
  - Sending a message or refreshing one room no longer refetches every workspace state
- The workspace rail now uses real server-side paging:
  - `agentHubBackend /api/workbench` accepts `limit`, `cursor`, and `q`
  - The frontend search box is server-driven
  - The rail appends results through a load-more action
- Workspace history uses one recent-message window:
  - `/api/projects/:projectId/state` accepts `messageLimit`
  - The chat pane can load older messages incrementally instead of loading the full conversation on startup
- The current workspace can open one in-window code browser:
  - The top-bar `代码` button opens only the current workspace repo through `agentHub` workspace file APIs proxied by `agentHubBackend`
  - The browser does not expose the full local monorepo
  - The panel uses a read-only Monaco editor, file search, diff count, binary-file shielding, dark theme, and explicit line-wrap toggle
  - Code selection no longer interrupts the drag with a popup and can be quoted back into the composer as structured `codeSelection`
- The same dialog now includes both `代码` and `预览` panels:
  - `代码` reads only the current workspace repo from `agentHub`
  - `预览` reads real static entry targets from `/api/projects/:projectId/preview-targets`
  - New workspaces no longer auto-seed a placeholder `index.html`
  - If no static entry exists yet, the preview panel shows an empty state
  - If multiple preview entries exist, the dialog can switch between them and keeps `loading / slow / error` feedback inside the preview panel
- When the page is viewed through a remote desktop or remote-control session, decorative blur layers and React dev-mode re-renders can look like visible flicker. Treat this as an environment observation first, not as a confirmed frontend callback loop.

## Dependency Management

Each workspace owns its own dependency manifest and lockfile. The repository root is not an npm workspace and does not contain a shared `package.json`.

```powershell
cd E:\byDance\agentHub
npm install

cd E:\byDance\agentHubBackend
npm install

cd E:\byDance\agentHubFrontend
npm install
```

## Local Startup

Start the local live chain in this order:

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

Expected local ports:

- `8787` - `agentHub`
- `8788` - Codex bridge
- `8790` - `agentHubBackend`
- `5173` - frontend dev server

## Verification

Run the current local code checks with:

```powershell
cd E:\byDance\agentHub
npm run build

cd E:\byDance\agentHubBackend
npm run check
npm run build

cd E:\byDance\agentHubFrontend
npm run check
npm run build
```

Recommended real-chain verification:

```powershell
cd E:\byDance\agentHub
$env:AGENTHUB_RUN_REAL_TESTS='true'
npx vitest run tests/real/agent-chain-probe.test.ts -t "keeps an unapproved planning request out of the engineer path" --reporter=verbose
npx vitest run tests/real/agent-chain-probe.test.ts -t "probes the approved main chain through engineer, reviewer, and synthesis" --reporter=verbose
npx vitest run tests/real/agent-chain-probe.test.ts -t "keeps quoted engineer follow-ups with engineer in a real group room" --reporter=verbose
```

Smoke checks should confirm:

- Group workspaces can stream real SSE workflow events
- Direct workspaces create a real runtime direct conversation
- Group quote follow-ups can keep the quoted child agent as the visible speaker
- Preview and zip responses return non-empty bodies when workspace outputs exist
- File tree, file content, and preview-target endpoints respond for the active workspace

## Compatibility

- Prefer `AGENTHUB_BACKEND_DATA_DIR` for local data overrides
- `LOCATE_BACKEND_DATA_DIR` is still accepted as a temporary compatibility alias

## Current Limits

The current local implementation intentionally does not cover:

- Cloud deployment
- Build-preview and deploy product flows
- Version history and one-click apply-diff UX
- In-browser manual file editing and save-back flow
- Non-static framework preview builds such as Vue or React source builds through the business backend
- Desktop and mobile clients

`/build-preview/*` and `/deploy/*` currently return `404` placeholders from `agentHubBackend`.

## Git Workflow

Git is managed from the repository root:

```powershell
cd E:\byDance
git status
git add <paths>
git commit -m "详细的本地阶段提交说明"
```

Use a detailed Chinese commit message for real checkpoints, and do not push to the remote unless explicitly requested.

## Documentation

Shared project documents live in `docs/`. Workspace-specific notes can stay inside their workspace directories.
