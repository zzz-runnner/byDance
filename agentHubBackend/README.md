# AgentHub Backend

`agentHubBackend` is now the unified Nest backend for local AgentHub work.

The current local live path is:

`agentHubFrontend -> agentHubBackend -> agentHub runtime -> real agents`

This backend keeps the Nest business modules from `origin/main`, and also carries the local adapter capabilities that the frontend needs for real local workspaces.

The old `locateBackend` compatibility layer has been removed. Local startup and local API access now use `agentHubBackend` only.

## Current Responsibilities

- create and bind business projects to AgentHub workspaces
- expose `/api/workbench` for paged workspace summaries
- expose `/api/projects/:projectId/state` for one active workspace state page
- proxy project message SSE to the runtime
- proxy workspace zip, preview, file tree, file content, diff, and preview-target APIs
- run local preview capability detection and local preview builds
- keep project metadata in local storage or PostgreSQL
- keep version, build, and deployment service modules available for later product flows

## Local Preview Behavior

The preview chain supports:

- static HTML
- browser-native module shell
- Vite React
- Vite Vue
- Vite Svelte

Preview build behavior:

- source repo stays under `agentHub/data/workspaces/{workspaceId}/repo`
- shared pnpm store stays under `agentHubBackend/data/pnpm-store`
- build sandboxes stay under `agentHubBackend/data/build-sandboxes`
- built preview outputs stay under `agentHubBackend/data/preview-outputs`
- preview build does not write `node_modules`, `dist`, or runtime lockfiles back into the workspace repo

## Environment

Copy `.env.example` to `.env` when local defaults are not enough.

```text
PORT=8790
CORS_ORIGIN=http://127.0.0.1:5173
AGENTHUB_BASE_URL=http://127.0.0.1:8787
AGENTHUB_RUNTIME_ROOT=../agentHub/data/workspaces
APP_STORAGE_ROOT=data
APP_METADATA_STORE=local
```

Prefer `APP_STORAGE_ROOT` as the local runtime data root. `LOCATE_BACKEND_DATA_DIR` is no longer used.

Optional PostgreSQL metadata storage:

```text
DATABASE_URL=postgres://agenthub:agenthub@127.0.0.1:5432/agenthub_business
```

## Commands

```bash
npm install
npm run dev
npm run check
npm run build
```

Start `agentHub` first, then start this backend.

## Main Local API

- `GET /api/health`
- `GET /api/agents`
- `GET /api/workbench`
- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET /api/projects/:projectId/state`
- `GET /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content`
- `GET /api/projects/:projectId/diff`
- `GET /api/projects/:projectId/preview-targets`
- `GET /api/projects/:projectId/preview-capability`
- `POST /api/projects/:projectId/preview-build`
- `POST /api/projects/:projectId/messages/stream`
- `GET /api/workspaces/:workspaceId/zip`
- `GET /preview/runtime/*`
- `GET /preview/*`
- `GET /build-preview/*`

Business-module endpoints still kept for later flows:

- `POST /api/projects/:projectId/versions`
- `GET /api/projects/:projectId/versions`
- `GET /api/projects/:projectId/version-diff?v1=...&v2=...`
- `GET /api/projects/:projectId/source.zip?versionId=...`
- `POST /api/projects/:projectId/builds`
- `POST /api/projects/:projectId/deploy`

## Current Limits

- local frontend does not yet expose deployment UI
- preview does not yet support Angular or broader framework matrix
- local flow is focused on one active workbench window plus code/preview dialog, not multi-window desktop clients
