# byDance

This repository keeps the byDance project in one Git repository while each workspace manages its own dependencies.

## Workspaces

- `agentHub/` - AgentHub local runtime, API, CLI, orchestration, adapters, workspace runtime, and storage.
- `agentHubFrontend/` - AgentHub Web frontend with its own Vite/React dependencies and lockfile.
- `agentHubBackend/` - Business backend workspace. This is intentionally empty for now and has not been initialized as a package.

## Dependency Management

Each workspace owns its own dependency manifest and lockfile. The repository root is not an npm workspace and does not contain a shared `package.json`.

```powershell
cd E:\byDance\agentHub
npm install

cd E:\byDance\agentHubFrontend
npm install

cd E:\byDance\agentHubBackend
npm install
```

Use the backend install command only after `agentHubBackend` has been initialized with its own package manifest.

## Git Workflow

Git is managed from the repository root:

```powershell
cd E:\byDance
git status
git add .
git commit -m "Describe the change"
git push
```

## Documentation

Shared project documents live in `docs/`. Workspace-specific notes can stay inside their workspace directories.
