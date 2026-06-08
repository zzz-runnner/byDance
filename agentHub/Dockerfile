FROM node:20-bookworm-slim

ARG INSTALL_CODEX_CLI=true
ARG CODEX_CLI_VERSION=0.136.0
ARG INSTALL_CLAUDE_CODE=true
ARG CLAUDE_CODE_VERSION=latest
ARG INSTALL_MIMO2CODEX_BRIDGE=true
ARG MIMO2CODEX_VERSION=0.4.10
ARG APT_DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${APT_DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
  elif [ -f /etc/apt/sources.list ]; then \
    sed -i "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${APT_DEBIAN_MIRROR}|g" /etc/apt/sources.list; \
  fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client ripgrep python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci \
  && if [ "$INSTALL_CODEX_CLI" = "true" ]; then npm install -g "@openai/codex@${CODEX_CLI_VERSION}"; fi \
  && if [ "$INSTALL_CLAUDE_CODE" = "true" ]; then npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; fi \
  && if [ "$INSTALL_MIMO2CODEX_BRIDGE" = "true" ]; then npm install -g "mimo2codex@${MIMO2CODEX_VERSION}"; fi \
  && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data/workspaces /app/.codex-agenthub /home/node/.claude \
  && chown -R node:node /app /home/node

USER node

ENV NODE_ENV=production
ENV PORT=8787
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV MIMO2CODEX_BIN=mimo2codex
ENV CLAUDE_CODE_SIMPLE=1
EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8787') + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--max-old-space-size=4096", "node_modules/.bin/tsx", "src/server/main.ts"]
