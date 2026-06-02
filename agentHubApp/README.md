# AgentHub App

React Native / Expo mock UI for the AgentHub mobile client.

This folder is intentionally independent from `agentHubFrontend` and `agentHubBackend`, but sits beside them in the repository so the app has one clear home.

## Current Scope

- Home dashboard: workspace count, running agents, artifact count, feature shortcuts, current workspace, latest event.
- Workspaces: card list, search field, filter chips, workspace status, participants, latest event.
- AI chat: group/direct chat mock, process summary cards, artifact summary cards, composer.
- Code/artifacts: file summary, diff summary, preview summary, review/text artifact summaries.
- Agents: agent list, provider/status/skills, basic profile cards.

The Agents screen uses three responsive layout tiers (`compact`, `standard`, `wide`) so small Android phones, iPhone 16-class screens, and wider devices can use different card density and spacing.

Not included in the mobile first pass:

- Today collaboration / todo section.
- Source version save.
- Source zip download.
- Static build.
- Deploy.
- Long build logs.
- Full Monaco editor or full patch diff.

## Project Layout

```text
agentHubApp/
  App.tsx
  src/
    components/
    data/mockData.ts
  assets/
  docs/
```

Mock data is centralized in `src/data/mockData.ts` so it can be replaced by API services later.

## Commands

```bash
npm install
npm run start
npm run check
```
