# AgentHub Backend

NestJS business backend for the AgentHub demo. This service does not replace the AgentHub runtime. It binds a business `projectId` to an AgentHub `workspaceId`, then handles product-version persistence, source zip snapshots, Docker build previews, and local deployment artifacts.

## Responsibilities

- Create or bind business projects to AgentHub workspaces.
- Proxy project chat messages to AgentHub SSE workflow streams.
- Keep project metadata in local storage.
- Save accepted workspace state as Git tags and source zip snapshots.
- Build version artifacts with Docker and expose `/build-preview/...` static URLs.
- Publish the latest build artifact to `/deploy/...`.

## Environment

Copy `.env.example` to `.env` when local defaults are not enough.

```text
PORT=8790
CORS_ORIGIN=http://127.0.0.1:5173
AGENTHUB_BASE_URL=http://127.0.0.1:8787
AGENTHUB_RUNTIME_ROOT=../agentHub/data/workspaces
APP_STORAGE_ROOT=storage
```

`AGENTHUB_RUNTIME_ROOT` must point at AgentHub's runtime workspace root. Each workspace repo is expected at:

```text
{AGENTHUB_RUNTIME_ROOT}/{workspaceId}/repo
```

Project metadata is stored in local JSON files by default:

```text
APP_METADATA_STORE=local
```

To use PostgreSQL for project metadata, set:

```text
APP_METADATA_STORE=postgres
DATABASE_URL=postgres://agenthub:agenthub@127.0.0.1:5432/agenthub_business
```

The backend creates the `business_projects` table automatically on startup. Source zips, build artifacts, deploy artifacts, and temporary build folders still stay on local disk under `APP_STORAGE_ROOT`.

## Commands

```bash
npm install
npm run dev
npm run build
npm run check
```

Start AgentHub first, then start this backend.

## Main API

- `GET /api/health`
- `POST /api/projects` creates a business project and AgentHub workspace, or binds an existing `workspaceId`.
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `POST /api/projects/:projectId/messages/stream` proxies a message to AgentHub SSE.
- `PUT /api/projects/:projectId/files` writes a manual edit back to the bound workspace repo.
- `POST /api/projects/:projectId/versions` commits/tags the workspace repo and creates a source zip.
- `GET /api/projects/:projectId/versions`
- `GET /api/projects/:projectId/diff?v1=...&v2=...`
- `GET /api/projects/:projectId/source.zip?versionId=...`
- `POST /api/projects/:projectId/builds` builds a saved version.
- `POST /api/projects/:projectId/deploy` publishes a built version.

Static artifact routes:

- `/build-preview/{projectId}/{versionId}/index.html`
- `/deploy/{projectId}/latest/index.html`
