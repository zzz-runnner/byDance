# agentHubBackend

## Purpose

`agentHubBackend` is the local business-style backend adapter between the frontend and the AgentHub runtime.

The current live path is:

`agentHubFrontend -> agentHubBackend -> agentHub runtime -> real agents`

This workspace exposes the frontend-facing API on `127.0.0.1:8790` and forwards runtime work to `agentHub`.

## Current Status

The local backend currently supports:

- Loading paged workspace summaries from a local JSON project map
- Loading runtime-backed project state from `agentHub`
- Loading runtime agent definitions from `agentHub`
- Creating group workspaces
- Creating direct workspaces backed by a real runtime direct conversation
- Forwarding one unique group-chat `@agent` mention as an explicit target agent
- Forwarding quoted replies and code selections as structured routing input
- Streaming SSE workflow events from `agentHub`
- Proxying workspace preview assets and zip downloads
- Proxying workspace file tree, file content, diff, and preview target APIs

The backend intentionally does not rewrite visible speaker identity. It forwards upstream events and leaves the final speaker selection to `agentHub`, so the frontend can render `speakerAgentId` from the runtime chain directly.

The local implementation intentionally does not yet support:

- `build-preview` product flow
- `deploy` product flow
- Formal business backend features such as versions, approvals, and release records

## Project Structure

```text
agentHubBackend/
  data/
    .gitkeep
    projects.json
  src/
    agenthub-client.ts
    config.ts
    main.ts
    project-store.ts
    server.ts
    sse-proxy.ts
    state-bridge.ts
    types.ts
  package.json
  tsconfig.json
```

## API Surface

The backend exposes the frontend-facing local API on `127.0.0.1:8790`:

- `GET /api/health`
- `GET /api/workbench`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET /api/agents`
- `POST /api/projects`
- `GET /api/projects/:projectId/state`
- `GET /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/content`
- `GET /api/projects/:projectId/diff`
- `GET /api/projects/:projectId/preview-targets`
- `POST /api/projects/:projectId/messages/stream`
- `GET /api/workspaces/:workspaceId/zip`
- `GET /preview/*`

Placeholders:

- `ALL /build-preview/*` -> `404`
- `ALL /deploy/*` -> `404`

## Local Startup

Start the local live stack in this order:

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

## Local Verification

Basic checks:

```powershell
cd E:\byDance\agentHubBackend
npm run check
npm run build
```

Runtime real-chain checks:

```powershell
cd E:\byDance\agentHub
$env:AGENTHUB_RUN_REAL_TESTS='true'
npx vitest run tests/real/agent-chain-probe.test.ts -t "keeps an unapproved planning request out of the engineer path" --reporter=verbose
npx vitest run tests/real/agent-chain-probe.test.ts -t "probes the approved main chain through engineer, reviewer, and synthesis" --reporter=verbose
```

Live smoke checks should confirm:

- Group workspaces stream real SSE events to the client
- Direct workspaces create a runtime direct conversation and can run the engineer agent
- Preview responses return non-empty HTML when a static entry exists
- Zip responses return non-empty archives

## Compatibility

- Prefer `AGENTHUB_BACKEND_DATA_DIR` for local data overrides
- `LOCATE_BACKEND_DATA_DIR` is still accepted as a temporary compatibility alias

## Current Local Limits

- `projects.json` is still a lightweight local project map, not a formal business database
- Direct workspaces still keep the runtime default group conversation in the background, but the frontend binds to the direct conversation
- `build-preview` and `deploy` are still placeholders
