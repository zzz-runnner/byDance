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
- API endpoints consumed by the frontend:
  - `/api/projects`
  - `/api/agents`
  - `/api/projects/:projectId/state`
  - `/api/projects`
  - `/api/projects/:projectId/messages/stream`
- Preview and delivery assets are proxied through `/preview`, `/build-preview`, and `/deploy`

The frontend is now `live-only`. If the business backend API is unavailable, the page shows a blocking error state instead of falling back to local demo data.

## Current UI Status

- One workspace maps to one chat window in the web workbench.
- AI-authored replies, process summaries, and artifact text now render through one controlled Markdown pipeline based on `react-markdown + remark-gfm`.
- Group workspaces support a WeChat-style `@` mention picker for child agents inside the composer.
- Direct workspaces keep a fixed target agent and do not open the `@` picker.
- Composer shortcut chips still exist as a fallback, and all insertions respect the current caret position.
- One explicit group-chat `@agent` mention now routes to that child agent for the visible reply instead of always falling back to Orchestrator.
- Non-mention specialist questions can route to one visible child agent through runtime routing metadata, so the final bubble can show the real specialist instead of a forced Orchestrator summary.
- Refresh restores the last active workspace from `localStorage`.
- Chat switches open at the latest message, keep follow-scroll during nearby streaming, and show a jump-to-bottom button when the user scrolls away from the bottom.
- The chat list renders temporary routing and reply placeholders so the user sees waiting bubbles before the final streamed message arrives.
- Each user turn renders as one chat block with the user message, a `本轮过程` section, inline artifact cards, and the final agent result.
- `本轮过程` stays expanded while a turn is active, auto-collapses after completion, and stays open for failed or partial turns.
- `本轮过程` now shows structured execution cards for routing, dispatch, progress, logs, validation, synthesis, and reply output, with readable log excerpts inside the chat stream.
- Each execution card stays collapsed by default, so users can keep the chat stream compact and expand only the steps they need to inspect.
- Preview, diff, review, zip, and text artifacts live inside the main chat stream.
- Preview dialogs now show `loading / slow / error` states before the iframe becomes ready.
- The first page load now shows a blocking loading screen, and backend disconnection shows a blocking error screen with retry.
- AI Markdown output is lightly normalized before rendering, so noisy separators, empty bullets, empty headings, incomplete fences, and conversational soft line breaks do not break the chat layout.
- Fenced code blocks render inside a shared code shell with language labels and copy actions, while raw HTML remains disabled.

## Boundary

- Frontend owns UI, browser state, and Vite build output.
- `E:\byDance\agentHubBackend` owns business projects, conversations, versions, builds, deployments, and the API contract consumed by the frontend.
- `E:\byDance\agentHub` owns AgentHub Runtime, local API, CLI, orchestration, adapters, workspace runtime, and storage.

## Current Notes

- Background motion is implemented with CSS decorative layers instead of `tsParticles`.
- The current workbench background image is `src/asset/background/newBG.png`.
- The frontend is managed under the repository root `E:\byDance`, but keeps its own dependency and build configuration.
- The old page-level mock/demo fallback path has been removed from the local operator flow.
- Raw HTML is still disabled in the Markdown renderer; the current scope is safe Markdown plus GFM features.
- In remote desktop or remote-control environments, animated blur layers plus React dev-mode double render can appear as page flicker. Verify this outside the remote session before classifying it as a frontend callback or state-loop bug.

## Verification

Latest frontend verification for this checkpoint:

```bash
npm run check
npm run build
```

Result:

- TypeScript type-check passed
- Vite production build passed

Before future commits, run:

```bash
git diff --check
```
