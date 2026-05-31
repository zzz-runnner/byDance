# byDance

This repository keeps the byDance project in one Git repository while each workspace manages its own dependencies.

## Workspaces

- `agentHub/` - AgentHub local runtime, API, CLI, orchestration, adapters, workspace runtime, and storage.
- `locateBackend/` - Local adapter layer that exposes the frontend-facing API on `127.0.0.1:8790` and forwards requests to `agentHub`.
- `agentHubFrontend/` - AgentHub Web frontend with its own Vite/React dependencies and lockfile.
- `agentHubBackend/` - Business backend workspace placeholder. It is intentionally outside the current local live path.

## Current Local Architecture

The current local live path is:

`agentHubFrontend -> locateBackend -> agentHub runtime -> real agents`

`locateBackend` is the only backend used by the frontend in local mode. The current implementation covers:

- `GET /api/workbench`
- `GET /api/projects`
- `GET /api/agents`
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
- Group chat composer supports a WeChat-style `@` picker for child agents, while direct rooms keep a fixed target and do not show the picker
- `locateBackend` forwards one explicit group-chat `@agent` mention as a real upstream target agent

## 2026-05-30 Local Status

The current local path is focused on one workspace equals one chat window.

- Group chat now supports two visible child-agent reply paths in local live mode:
  - One explicit `@agent` mention is forwarded by `locateBackend` as a real upstream target agent.
  - One non-mention specialist question can be routed by `agentHub` to a single visible child agent based on runtime agent metadata, task stage, and message content.
- The composer now stays closer to a normal chat input:
  - The old preset `@product-manager` / `@engineer` / `@reviewer` / `/run` chips have been removed.
  - Group rooms rely on natural typing plus the upward `@` mention picker instead of fixed quick-action tags.
- Chat messages now support a WeChat-style structured reply reference:
  - The frontend shows a quote bar in the composer and a quote header in persisted chat bubbles.
  - `locateBackend` and `agentHub` forward `replyTo` as structured data instead of injecting visible template text into the composer.
  - The quoted relationship survives refresh because the main conversation message now persists `replyTo` in storage.
  - In group chat, quoting one current child agent now has the same routing priority as a weak `@agent`: the quoted agent keeps the visible reply by default unless the user explicitly `@` mentions another agent.
  - If the quoted sender is `user`, `orchestrator`, or a child agent that is no longer a participant in the current workspace conversation, `agentHub` falls back to normal routing.
- The visible speaker identity flows through `routing_finished.speakerAgentId`, so the frontend can show the actual replying agent instead of always showing Orchestrator.
- Frontend chat restores the last active workspace after refresh, auto-scrolls to the bottom on room switch, keeps follow-scroll near the bottom during streaming, shows a jump-to-bottom button when the user scrolls up, and renders temporary waiting bubbles during routing and reply generation.
- The main chat surface groups each user turn into one visible block: user message, `本轮过程`, inline artifact cards, and the final agent result.
- `本轮过程` stays expanded while a turn is still running, auto-collapses after the turn completes, and remains expanded for failed or partial turns.
- Preview, diff, review, zip, and text artifacts are rendered inside the chat stream instead of depending on the right-side status dock.
- AI-authored reply bubbles, process summaries, and artifact text now use one controlled Markdown renderer with GFM support, safe-link handling, code-block copy actions, and a lightweight normalization layer for noisy separators, empty headings, empty bullets, and incomplete code fences.
- `本轮过程` now renders structured execution cards for routing, dispatch, progress, logs, validation, synthesis, and reply output, with readable log excerpts instead of generic status rows.
- Artifact cards inside the chat stream now stay compact by default and only expose the key summary, while full preview, diff, review, and long-form text stay in the artifact dialog.
- Frontend startup is now `live-only`: first load shows a blocking loading state, backend failure shows a blocking retry state, and the page no longer falls back to mock/demo workspaces.
- Preview dialogs now show `loading / slow / error` states before iframe content is ready.
- The workbench now loads in two layers instead of sweeping every project state on first paint:
  - The left workspace rail is backed by one lightweight `/api/workbench` summary payload.
  - The right chat pane only fetches the active workspace detail.
  - Sending a message or refreshing one room no longer refetches every workspace state.
- The workspace rail now uses real server-side paging instead of loading every workspace at once:
  - `locateBackend /api/workbench` accepts `limit`, `cursor`, and `q`.
  - The frontend search box is now server-driven and the rail appends results through `加载更多`.
  - Refresh keeps the current visible page size instead of snapping back to a full-list sweep.
- The current workspace history now uses one recent-message window:
  - `/api/projects/:projectId/state` accepts `messageLimit`.
  - The chat pane can load older messages incrementally instead of loading the full conversation history on startup.
- The current workspace can now open one in-window code browser:
  - The top bar `代码` button now opens only the current workspace repo through the `agentHub` workspace file APIs proxied by `locateBackend`.
  - The browser no longer exposes the full local repository root such as `agentHubFrontend/`, `locateBackend/`, `agentHub/`, or `docs/`.
  - New and old workspaces both follow the same rule: if a workspace repo only contains seed files, only those files appear; if it is empty, the code panel shows an empty state.
  - Future “edit an existing local project” support should import or copy files into the workspace repo first instead of directly exposing the original local folder.
  - The panel uses a read-only Monaco editor, file search, local diff count, binary-file shielding, and a dedicated dark code-browser theme.
  - The right editor panel now uses a stable top-bar plus full-height editor layout, so the Monaco viewport no longer collapses to roughly half-height when the selection banner is hidden.
  - The desktop breakpoint for the code browser now stays in the two-column layout until narrower widths, so remote-desktop and medium desktop windows no longer fall into a half-height editor feel too early.
  - The Monaco toolbar now includes one explicit line-wrap toggle. It defaults to wrapped lines for readability and can be switched back to horizontal-scroll mode when raw formatting matters.
  - Code selection is now confirmed after the drag finishes or the keyboard selection settles, without interrupting the drag with a floating selection popup.
  - One selected code range can be quoted back into the chat composer as structured `codeSelection` data.
  - In group rooms, a message with `codeSelection` and no explicit `@agent` defaults to `engineer` routing in `locateBackend`.
  - The Monaco viewer now measures the visible editor shell with `ResizeObserver` and triggers explicit `layout()` calls after open, resize, and file switches, so it no longer depends on fragile percentage-height inheritance.
  - The same dialog now includes both `代码` and `预览` panels:
    - `代码` reads only the current workspace repo from `agentHub`, not the whole monorepo.
    - `预览` reads real static entry targets from `/api/projects/:projectId/preview-targets`.
    - New workspaces no longer auto-seed a placeholder `index.html`; if no static entry exists yet, the preview panel shows an empty state.
    - If multiple static preview entries exist, the dialog can switch between them and keeps `loading / slow / error` feedback inside the preview panel.
- When the page is viewed through a remote desktop or remote-control session, decorative blur layers and React dev-mode re-renders can look like visible flicker. Treat this as an environment observation first, not as a confirmed frontend callback loop.
- `agentHubBackend/` is still outside the local live path and remains untouched.

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
npx vitest run tests/real/agent-chain-probe.test.ts -t "keeps quoted engineer follow-ups with engineer in a real group room" --reporter=verbose
```

Additional live smoke tests were executed against `http://127.0.0.1:8790` and the frontend dev proxy on `http://127.0.0.1:5173` to confirm:

- Group workspaces can stream real SSE workflow events
- Direct workspaces create a real runtime direct conversation
- Group quote follow-ups can keep the quoted child agent as the visible speaker in a real workspace
- Preview and zip responses return non-empty bodies
- Real engineer and reviewer runs finish successfully

Latest local code verification for this checkpoint:

```powershell
cd E:\byDance\agentHub
npm run build

cd E:\byDance\agentHubFrontend
npm run check
npm run build

cd E:\byDance\locateBackend
npm run check
npm run build
```

Result:

- `agentHub` TypeScript build passed
- `agentHubFrontend` TypeScript check passed
- `agentHubFrontend` production build passed
- `locateBackend` TypeScript check passed
- `locateBackend` TypeScript build passed
- Local smoke checks passed for:
  - `GET /api/workbench`
  - `GET /api/projects/:projectId/state?messageLimit=2` returning `hasMore=true`
  - `GET /api/projects/:projectId/files`
  - `GET /api/projects/:projectId/files/content?path=index.html`

## Current Limits

The current local implementation intentionally does not cover:

- `agentHubBackend/` integration
- Cloud deployment
- Build-preview and deploy product flows
- Version history and one-click apply-diff UX
- In-browser manual file editing and save-back flow
- Desktop and mobile clients

`/build-preview/*` and `/deploy/*` currently return `404` placeholders from `locateBackend`.

## Git Workflow

Git is managed from the repository root:

```powershell
cd E:\byDance
git status
git add <paths>
git commit -m "详细的本地阶段提交"
```

Use a detailed Chinese commit message for real checkpoints, and do not push to the remote unless explicitly requested.

## Documentation

Shared project documents live in `docs/`. Workspace-specific notes can stay inside their workspace directories.
