# byDance

This repository keeps the byDance project in one Git repository while each workspace manages its own dependencies.

## Workspaces

- `agentHub/` - AgentHub local runtime, API, CLI, orchestration, adapters, workspace runtime, and storage.
- `locateBackend/` - Local adapter layer that exposes the frontend-facing API on `127.0.0.1:8790` and forwards requests to `agentHub`.
- `agentHubFrontend/` - AgentHub Web frontend with its own Vite/React dependencies and lockfile.
- `agentHubBackend/` - Business backend workspace placeholder. It is intentionally not used for the current local demo path.

## Current Local Architecture

The current local demo path is:

`agentHubFrontend -> locateBackend -> agentHub runtime -> real agents`

`locateBackend` is the only backend used by the frontend in local live mode. The current implementation covers:

- `GET /api/projects`
- `GET /api/agents`
- `GET /api/projects/:projectId/state`
- `POST /api/projects`
- `POST /api/projects/:projectId/messages/stream`
- `GET /preview/*`
- `GET /api/workspaces/:workspaceId/zip`

It supports both:

- Group workspaces backed by the main orchestrated conversation
- Direct workspaces backed by a runtime direct conversation for one target agent

## Dependency Management

Each workspace owns its own dependency manifest and lockfile. The repository root is not an npm workspace and does not contain a shared `package.json`.

```powershell
cd E:\byDance\agentHub
npm install

cd E:\byDance\locateBackend
npm install

cd E:\byDance\agentHubFrontend
npm install
```

Use the backend install command only after `agentHubBackend` has been initialized with its own package manifest.

## Local Startup

Start the local demo in this order:

```powershell
cd E:\byDance\agentHub
npm run dev:api
```

```powershell
cd E:\byDance\agentHub
npm run codex:bridge
```

```powershell
cd E:\byDance\locateBackend
npm run dev
```

```powershell
cd E:\byDance\agentHubFrontend
npm run dev
```

Expected local ports:

- `8787` - `agentHub`
- `8788` - Codex bridge
- `8790` - `locateBackend`
- `5173` - frontend dev server

## Verification

The current local chain has been verified with these checks:

```powershell
cd E:\byDance\locateBackend
npm run check
npm run build
```

```powershell
cd E:\byDance\agentHub
$env:AGENTHUB_RUN_REAL_TESTS='true'
npx vitest run tests/real/agent-chain-probe.test.ts -t "keeps an unapproved planning request out of the engineer path" --reporter=verbose
npx vitest run tests/real/agent-chain-probe.test.ts -t "probes the approved main chain through engineer, reviewer, and synthesis" --reporter=verbose
```

Additional live smoke tests were executed against `http://127.0.0.1:8790` and the frontend dev proxy on `http://127.0.0.1:5173` to confirm:

- Group workspaces can stream real SSE workflow events
- Direct workspaces create a real runtime direct conversation
- Preview and zip responses return non-empty bodies
- Real engineer and reviewer runs finish successfully

## Current Limits

The current local implementation intentionally does not cover:

- `agentHubBackend/` integration
- Cloud deployment
- Build-preview and deploy product flows
- Version history and one-click apply-diff UX
- Desktop and mobile clients

`/build-preview/*` and `/deploy/*` currently return `404` placeholders from `locateBackend`.

## Git Workflow

Git is managed from the repository root:

```powershell
cd E:\byDance
git status
git add <paths>
git commit -m "Detailed local checkpoint"
```

Use a detailed Chinese commit message for real checkpoints, and do not push to the remote unless explicitly requested.

## Documentation

Shared project documents live in `docs/`. Workspace-specific notes can stay inside their workspace directories.
