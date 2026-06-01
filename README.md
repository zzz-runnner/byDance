# byDance

This repository keeps the byDance project in one Git repository while local workspace source files live under `agentHub` and local preview runtime assets are managed by `agentHubBackend`.

## Workspaces

- `agentHub/` - AgentHub local runtime, API, CLI, orchestration, adapters, workspace runtime, and storage.
- `agentHubBackend/` - Unified Nest backend on `127.0.0.1:8790`. It is now both the frontend-facing local adapter and the business backend shell.
- `agentHubFrontend/` - AgentHub Web frontend with its own Vite/React dependencies and lockfile.

## Current Local Architecture

The current local live path is:

`agentHubFrontend -> agentHubBackend -> agentHub runtime -> real agents`

The deprecated `locateBackend/` adapter has been removed from the repository. The unified local backend path is now only `agentHubBackend/`.

The current local chain covers:

- `GET /api/health`
- `GET /api/agents`
- `GET /api/workbench`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET /api/projects/:projectId/state`
- `GET /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content`
- `GET /api/projects/:projectId/diff`
- `GET /api/projects/:projectId/preview-targets`
- `GET /api/projects/:projectId/preview-capability`
- `POST /api/projects`
- `POST /api/projects/:projectId/messages/stream`
- `POST /api/projects/:projectId/preview-build`
- `GET /api/workspaces/:workspaceId/zip`
- `GET /preview/runtime/*`
- `GET /preview/*`
- `GET /build-preview/*`

The backend still keeps the Nest business modules for:

- project metadata
- versions
- builds
- deployments

## 2026-06-01 Local Status

- One workspace equals one main chat window.
- Group rooms support three effective routing inputs:
  - explicit `@agent`
  - quoted child-agent reply follow-up
  - code selection, which defaults to `engineer` when no explicit target is given
- Direct rooms stay fixed to one agent and do not show the mention picker.
- Visible speaker identity comes from runtime routing and is no longer flattened to Orchestrator.
- The left workspace rail uses server-backed paging through `/api/workbench`.
- The right chat pane loads only the active workspace state through `/api/projects/:projectId/state`.
- Older messages load incrementally through the `messageLimit` window instead of loading the full conversation at startup.
- The chat surface renders one grouped turn:
  - user message
  - process block
  - compact artifact cards
  - final agent reply
- Quote replies and code selections are structured inputs, not plain text hacks.
- AI output, process summaries, and artifact text use the unified Markdown renderer.
- The code dialog is scoped to the current workspace repo only. It includes:
  - file tree
  - file content
  - diff view
  - code quoting
  - preview panel
- New workspaces no longer auto-seed a placeholder `index.html`.
- If no previewable entry exists yet, the preview panel stays empty instead of fabricating a page.

## Local Preview

`agentHubBackend` now provides the first local preview chain inside the unified Nest backend.

Supported preview modes:

- Static HTML
- Browser-native ES modules without bare-package imports
- Vite React
- Vite Vue
- Vite Svelte

Preview runtime behavior:

- user-facing source files stay in `agentHub/data/workspaces/{workspaceId}/repo`
- shared pnpm store stays in `agentHubBackend/data/pnpm-store`
- build sandboxes stay in `agentHubBackend/data/build-sandboxes/{workspaceId}/{manifestHash}`
- built preview outputs stay in `agentHubBackend/data/preview-outputs/{workspaceId}/{cacheKey}`
- preview build does not write `node_modules`, `dist`, or runtime lockfiles back into the user workspace repo

## Dependency Management

The repository root is not an npm workspace and does not contain a shared `package.json`.

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

This checkpoint was verified with:

```powershell
cd E:\byDance\agentHub
npm run check
npm test

cd E:\byDance\agentHubBackend
npm run check
npm run build

cd E:\byDance\agentHubFrontend
npm run check
npm run build
```

Result:

- `agentHub` TypeScript check passed
- `agentHub` unit and integration tests passed
- `agentHubBackend` TypeScript check passed
- `agentHubBackend` Nest build passed
- `agentHubFrontend` TypeScript check passed
- `agentHubFrontend` production build passed

Recommended real-chain verification after starting local services:

```powershell
cd E:\byDance\agentHub
$env:AGENTHUB_RUN_REAL_TESTS='true'
npx vitest run tests/real/agent-chain-probe.test.ts -t "keeps an unapproved planning request out of the engineer path" --reporter=verbose
npx vitest run tests/real/agent-chain-probe.test.ts -t "probes the approved main chain through engineer, reviewer, and synthesis" --reporter=verbose
```

## Current Limits

The current local implementation still does not cover:

- cloud deployment flow
- deployment UI
- one-click version diff and release UX
- framework preview outside the first local phase, such as Angular
- desktop and mobile clients

`/deploy/*` is still only a backend artifact route and is not wired into the current frontend local flow.

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
