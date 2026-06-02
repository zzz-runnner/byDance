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
- `GET /api/agents/:agentId`
- `POST /api/agents`
- `PATCH /api/agents/:agentId`
- `DELETE /api/agents/:agentId`
- `GET /api/workbench`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId/metadata`
- `PUT /api/projects/:projectId/pin`
- `DELETE /api/projects/:projectId/pin`
- `PUT /api/projects/:projectId/archive`
- `DELETE /api/projects/:projectId/archive`
- `GET /api/projects/:projectId/state`
- `GET /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content`
- `GET /api/projects/:projectId/diff`
- `GET /api/projects/:projectId/delivery`
- `GET /api/projects/:projectId/preview-targets`
- `GET /api/projects/:projectId/preview-capability`
- `POST /api/projects`
- `POST /api/projects/:projectId/messages/stream`
- `POST /api/projects/:projectId/versions`
- `GET /api/projects/:projectId/versions`
- `GET /api/projects/:projectId/version-diff`
- `POST /api/projects/:projectId/versions/:versionId/restore`
- `GET /api/projects/:projectId/source.zip`
- `POST /api/projects/:projectId/builds`
- `POST /api/projects/:projectId/deploy`
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
- The built-in orchestrator keeps the stable id `orchestrator`, while its default display name is now `项目经理 Agent`.
- Agent `name` is now the editable display identity, while `id` stays the stable key for routing, storage, session binding, and conversation participants.
- Visible speaker identity now resolves from the current agent registry instead of flattening replies to one built-in coordinator label.
- Editing an agent name now refreshes direct-room titles, agent-session titles, direct-room composer copy, and reply sender labels that can still resolve through the live agent registry.
- Group-room explicit child-agent mentions now match stable ids, full current display names, and short display-name aliases.
- Built-in and custom child agents can now be viewed, created, edited, provider-switched, and deleted from the frontend through the business backend API.
- The left workspace rail uses server-backed paging through `/api/workbench`.
- The left workspace rail also supports backend-backed search, status filtering, sorting, pinning, and archiving.
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
  - saved source version history
  - version-to-version diff
  - one-click restore with auto snapshot protection
  - near-fullscreen modal layout with internal scrolling
  - whole-dialog bootstrap loading before the first screen renders
  - open and close transition animations
  - preview iframe and artifact iframe loading overlays
- New workspaces no longer auto-seed a placeholder `index.html`.
- If no previewable entry exists yet, the preview panel stays empty instead of fabricating a page.
- Chat history recovery now uses turn-safe grouping:
  - user messages, workflow events, and final replies are grouped by `turnId` when available
  - older historical messages without `turnId` fall back to the nearest visible unmatched user turn
  - the frontend no longer groups turns by array index
- Project state recovery now keeps message and event windows aligned:
  - `/api/projects/:projectId/state` still returns a recent message window
  - returned `workflowEvents` are now restricted to the visible message window turns instead of full-history replay
- The chat surface no longer fabricates routing placeholder bubbles such as "main brain is deciding who should reply".
- Waiting placeholders are now limited to turns with a real streaming reply, so completed history no longer shows empty running cards after refresh.
- Streaming chat replies now keep a frontend handoff stage:
  - `streaming` while SSE deltas are arriving
  - `awaiting_commit` after SSE finishes but before the persisted message is reloaded
  - the streamed reply bubble stays visible during `awaiting_commit`, so the chat does not show a blank gap between stream finish and persisted reply recovery
  - the persisted final reply appears first, and only then does the process block auto-collapse

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
- frontend preview and delivery builds can auto-detect one nested app root such as `repo/voting-app`
- shared pnpm store stays in `agentHubBackend/data/pnpm-store`
- build sandboxes stay in `agentHubBackend/data/build-sandboxes/{workspaceId}/{manifestHash}`
- built preview outputs stay in `agentHubBackend/data/preview-outputs/{workspaceId}/{cacheKey}`
- preview build does not write `node_modules`, `dist`, or runtime lockfiles back into the user workspace repo
- preview build and delivery build fall back to host-side install and build when Docker CLI is unavailable

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

Real local service smoke also passed on 2026-06-01:

- `GET http://127.0.0.1:8787/api/health` returned `ok: true` with PostgreSQL storage and real agents enabled.
- `GET http://127.0.0.1:8790/api/health` returned `ok: true`.
- `GET http://127.0.0.1:5173` returned `200`.
- Agent CRUD smoke passed through `agentHubBackend`:
  - create custom agent
  - update provider and description
  - reject deleting built-in agent
  - delete custom agent
- Workspace metadata smoke passed through `agentHubBackend`:
  - update `pinned`
  - update `archived`
  - read filtered `status=archived`
  - restore metadata cleanly
- Real group-room message stream smoke passed through `POST /api/projects/:projectId/messages/stream`:
  - explicit `@product-manager` message returned `speaker_direct`

Additional local preview smoke passed on 2026-06-02:

- `GET http://127.0.0.1:8790/api/projects/proj-8a85e530-cf40-43bd-8a13-556e517e5a6a/preview-capability` detected `voting-app` as the workspace app root and returned `mode: build`.
- `POST http://127.0.0.1:8790/api/projects/proj-8a85e530-cf40-43bd-8a13-556e517e5a6a/preview-build` completed successfully and produced one preview target at `index.html`.
- `GET http://127.0.0.1:8790/build-preview/proj-8a85e530-cf40-43bd-8a13-556e517e5a6a/47280d926db374ad/index.html` returned `200`.
- `POST http://127.0.0.1:8790/api/projects/proj-8a85e530-cf40-43bd-8a13-556e517e5a6a/builds` rebuilt delivery version `v20260602_135651` successfully.
- `GET http://127.0.0.1:8790/build-preview/proj-8a85e530-cf40-43bd-8a13-556e517e5a6a/v20260602_135651/index.html` returned `200`.
  - final visible reply sender was `product-manager`
  - SSE stream completed and state reload reflected the persisted reply

Version history smoke also passed on 2026-06-02 through a temporary isolated backend instance:

- create a project bound to a temporary local workspace repo
- save two source versions back to back
- load `/api/projects/:projectId/versions`
- load `/api/projects/:projectId/version-diff?v1=...&v2=...`
- restore `/api/projects/:projectId/versions/:versionId/restore`
- verify the workspace repo file content returned to the older version after restore

Recommended real-chain verification after starting local services:

```powershell
cd E:\byDance\agentHub
$env:AGENTHUB_RUN_REAL_TESTS='true'
npx vitest run tests/real/agent-chain-probe.test.ts -t "keeps an unapproved planning request out of the engineer path" --reporter=verbose
npx vitest run tests/real/agent-chain-probe.test.ts -t "probes the approved main chain through engineer, reviewer, and synthesis" --reporter=verbose
```

## Local Delivery And Version Flow

The current local frontend now exposes a first usable delivery and rollback flow inside the code workspace dialog:

- save the current workspace repo into a source snapshot
- browse saved source versions
- compare two saved versions through unified diff
- restore one saved version back into the live workspace repo with an automatic safety snapshot
- build a delivery artifact from the latest saved version
- publish that built artifact into the local `/deploy/*` route
- open the latest built preview, deployed page, or source archive directly from the UI

The backend also injects the latest source/build/deploy status back into the main chat history as stable system cards, so refreshes no longer lose the latest local delivery result.

## Current Limits

The current local implementation still does not cover:

- cloud deployment flow
- richer release management flows such as approval, release channels, and publish history
- framework preview outside the first local phase, such as Angular
- desktop and mobile clients

The current local deployment flow is still a backend-managed static publish step. It is not yet a true agent-driven cloud release workflow.

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
