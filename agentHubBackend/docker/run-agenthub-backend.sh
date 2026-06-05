#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-agenthub-backend:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-agenthub-backend}"
HOST_PORT="${HOST_PORT:-8790}"
CONTAINER_PORT="${CONTAINER_PORT:-8790}"
DOCKER_NETWORK="${DOCKER_NETWORK:-agenthub_default}"
AGENTHUB_RUNTIME_VOLUME="${AGENTHUB_RUNTIME_VOLUME:-agenthub_agenthub_runtime_data}"
RUNTIME_VOLUME_MOUNT="${RUNTIME_VOLUME_MOUNT:-/agenthub-runtime-data}"
RUNTIME_VOLUME_MODE="${RUNTIME_VOLUME_MODE:-rw}"
BACKEND_DATA_DIR="${BACKEND_DATA_DIR:-/opt/agenthub/agenthub-backend-data}"
AGENTHUB_BASE_URL="${AGENTHUB_BASE_URL:-http://agenthub:8787}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
PNPM_VERSION="${PNPM_VERSION:-11.1.2}"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env.docker}"

if ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  echo "Docker network not found: ${DOCKER_NETWORK}"
  echo "Set DOCKER_NETWORK to the network used by the deployed AgentHub container."
  echo "For the existing compose.yaml, the default is usually: agenthub_default"
  exit 1
fi

if ! docker volume inspect "$AGENTHUB_RUNTIME_VOLUME" >/dev/null 2>&1; then
  echo "Docker volume not found: ${AGENTHUB_RUNTIME_VOLUME}"
  echo "Set AGENTHUB_RUNTIME_VOLUME to the AgentHub runtime data volume."
  echo "For the existing compose.yaml, the default is usually: agenthub_agenthub_runtime_data"
  exit 1
fi

mkdir -p "$BACKEND_DATA_DIR"

DOCKER_GID=""
if [ -S /var/run/docker.sock ]; then
  DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
fi

docker build \
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY}" \
  --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
  -t "$IMAGE_NAME" \
  "$PROJECT_DIR"

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

ENV_ARGS=()
if [ -f "$ENV_FILE" ]; then
  ENV_ARGS+=(--env-file "$ENV_FILE")
else
  echo "Env file not found: ${ENV_FILE}; continuing with script defaults."
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network "$DOCKER_NETWORK" \
  --add-host host.docker.internal:host-gateway \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  "${ENV_ARGS[@]}" \
  -e "NODE_ENV=production" \
  -e "PORT=${CONTAINER_PORT}" \
  -e "AGENTHUB_BASE_URL=${AGENTHUB_BASE_URL}" \
  -e "AGENTHUB_RUNTIME_ROOT=${RUNTIME_VOLUME_MOUNT}/workspaces" \
  -e "APP_STORAGE_ROOT=${BACKEND_DATA_DIR}" \
  -e "DOCKER_GID=${DOCKER_GID}" \
  -v "${BACKEND_DATA_DIR}:${BACKEND_DATA_DIR}" \
  -v "${AGENTHUB_RUNTIME_VOLUME}:${RUNTIME_VOLUME_MOUNT}:${RUNTIME_VOLUME_MODE}" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  "$IMAGE_NAME"

echo "agentHubBackend is starting."
echo "Health check: curl http://127.0.0.1:${HOST_PORT}/api/health"
echo "Logs: docker logs -f ${CONTAINER_NAME}"
