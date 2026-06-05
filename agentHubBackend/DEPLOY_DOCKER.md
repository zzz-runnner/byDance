# agentHubBackend Docker deployment

This backend depends on the already deployed AgentHub API and its runtime workspace data.

## Upload list

Upload these files/directories from `agentHubBackend`:

- `src/`
- `package.json`
- `package-lock.json`
- `nest-cli.json`
- `tsconfig.json`
- `tsconfig.build.json`
- `Dockerfile`
- `.dockerignore`
- `.env.docker.example`
- `docker/entrypoint.sh`
- `docker/run-agenthub-backend.sh`

Do not upload:

- `node_modules/`
- `dist/`
- `data/`
- `storage/`
- `.env`
- `.env.*` files that contain secrets

## Server setup

From the uploaded `agentHubBackend` directory:

```bash
cp .env.docker.example .env.docker
vim .env.docker
chmod +x docker/run-agenthub-backend.sh
```

Set `CORS_ORIGIN` to the real frontend origin. If AgentHub is on the same compose network, keep:

```bash
AGENTHUB_BASE_URL=http://agenthub:8787
```

If AgentHub is only exposed through the host port, run the script with:

```bash
AGENTHUB_BASE_URL=http://host.docker.internal:8787 DOCKER_NETWORK=bridge ./docker/run-agenthub-backend.sh
```

## Run

For the existing `agentHub/compose.yaml`, the defaults should work:

```bash
./docker/run-agenthub-backend.sh
```

The script defaults are:

```bash
DOCKER_NETWORK=agenthub_default
AGENTHUB_RUNTIME_VOLUME=agenthub_agenthub_runtime_data
BACKEND_DATA_DIR=/opt/agenthub/agenthub-backend-data
HOST_PORT=8790
```

Override them if your deployed AgentHub container uses different names:

```bash
DOCKER_NETWORK=your_network \
AGENTHUB_RUNTIME_VOLUME=your_runtime_volume \
AGENTHUB_BASE_URL=http://agenthub:8787 \
BACKEND_DATA_DIR=/opt/agenthub/agenthub-backend-data \
./docker/run-agenthub-backend.sh
```

## Verify

```bash
docker logs -f agenthub-backend
curl http://127.0.0.1:8790/api/health
```
