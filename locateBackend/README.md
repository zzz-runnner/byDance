# locateBackend

## Purpose

`locateBackend` is the local adapter layer between the frontend and the AgentHub runtime.

It keeps the current local live path simple:

`agentHubFrontend -> locateBackend -> agentHub runtime -> real or mock agents`

This workspace exists so the frontend can use the business-style API contract on `127.0.0.1:8790` without depending on `agentHubBackend/`.

## Current Status

The local adapter now supports:

- Loading project summaries from a local JSON project map
- Loading runtime-backed project state from `agentHub`
- Loading runtime agent definitions from `agentHub`
- Creating group workspaces
- Creating direct workspaces backed by a real runtime direct conversation
- Forwarding a unique group-chat `@agent` mention as an explicit target agent for upstream message routing
- Streaming SSE workflow events from `agentHub`
- Proxying preview assets
- Proxying workspace zip downloads

The current local implementation intentionally does not support:

- `build-preview` product flow
- `deploy` product flow
- Formal business backend features such as versions, approvals, and release records

## Project Structure

```text
locateBackend/
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

The adapter exposes the frontend-facing local API on `127.0.0.1:8790`:

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET /api/agents`
- `POST /api/projects`
- `GET /api/projects/:projectId/state`
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
cd E:\byDance\locateBackend
npm run dev
```

```powershell
cd E:\byDance\agentHubFrontend
npm run dev
```

## Local Verification

Basic checks:

```powershell
cd E:\byDance\locateBackend
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

Live smoke checks confirmed:

- Group workspaces stream real SSE events to the client
- Direct workspaces create a runtime direct conversation and can run the engineer agent
- Preview responses return non-empty HTML
- Zip responses return non-empty archives
- Real engineer and reviewer runs finish successfully through `locateBackend`

## Current Local Limits

- `projects.json` is a lightweight local project map, not a formal business database
- Direct workspaces still keep the runtime default group conversation in the background, but the frontend binds to the direct conversation
- `build-preview` and `deploy` are still placeholders
