FROM node:20-alpine AS builder

ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG APK_REPOSITORY=https://mirrors.aliyun.com/alpine

WORKDIR /app

RUN if [ -n "$APK_REPOSITORY" ]; then \
    sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${APK_REPOSITORY}|g; s|http://dl-cdn.alpinelinux.org/alpine|${APK_REPOSITORY}|g" /etc/apk/repositories; \
  fi

COPY package.json package-lock.json ./

RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM node:20-alpine

ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PNPM_VERSION=10.17.1
ARG APK_REPOSITORY=https://mirrors.aliyun.com/alpine

WORKDIR /app

RUN if [ -n "$APK_REPOSITORY" ]; then \
    sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${APK_REPOSITORY}|g; s|http://dl-cdn.alpinelinux.org/alpine|${APK_REPOSITORY}|g" /etc/apk/repositories; \
  fi \
  && apk add --no-cache bash ca-certificates docker-cli git openssh-client su-exec \
  && if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm install -g "pnpm@${PNPM_VERSION}" \
  && npm cache clean --force \
  && mkdir -p /app/data /agenthub-runtime-data \
  && chown -R node:node /app /agenthub-runtime-data

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/agenthub-backend-entrypoint

RUN chmod +x /usr/local/bin/agenthub-backend-entrypoint

ENV NODE_ENV=production
ENV PORT=8790
ENV APP_STORAGE_ROOT=/app/data
ENV AGENTHUB_RUNTIME_ROOT=/agenthub-runtime-data/workspaces

EXPOSE 8790

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '8790') + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["agenthub-backend-entrypoint"]
CMD ["node", "dist/main.js"]
