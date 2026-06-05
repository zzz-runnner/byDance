# AgentHub Docker 容器化部署步骤

这份步骤只部署 `agentHub` API 和它自己的 PostgreSQL。`agentHubFrontend`、`agentHubBackend` 可以继续单独部署；如果前端要直接访问 AgentHub API，需要配置 CORS 或通过 Nginx 做同源反代。

## 1. 服务器准备

服务器需要：

- Docker Engine
- Docker Compose V2
- 能访问 npm registry 和 DeepSeek API 的外网，只有开启真实 Agent 时需要
- 至少一个持久化磁盘目录给 Docker volume 使用

确认 Docker 可用：

```bash
docker --version
docker compose version
```

如果没有 Docker，先按服务器系统安装 Docker Engine 和 Compose V2。安装后建议把当前用户加入 docker 组，或者后续命令前加 `sudo`。

## 2. 拉取代码

示例路径：

```bash
mkdir -p /opt/agenthub
cd /opt/agenthub
git clone <your-repo-url> byDance
cd byDance
git checkout yangfulin
git pull
```

如果服务器上已经有代码：

```bash
cd /opt/agenthub/byDance
git fetch --all
git checkout yangfulin
git pull
```

进入 AgentHub 目录：

```bash
cd agentHub
```

## 3. 配置环境变量

复制模板：

```bash
cp .env.docker.example .env.docker
```

编辑：

```bash
vim .env.docker
```

最小可用配置：

```bash
POSTGRES_DB=agenthub_runtime
POSTGRES_USER=agenthub
POSTGRES_PASSWORD=change-this-password

AGENTHUB_PORT=8787
WEB_PORT=5173
AGENTHUB_CORS_ORIGINS=http://服务器IP:5173,http://你的域名

AGENTHUB_REAL_AGENTS=false
AGENTHUB_ORCHESTRATOR_PROVIDER=mock
AGENTHUB_ORCHESTRATOR_MODEL=deepseek-v4-pro
AGENTHUB_ROUTER_MODEL=deepseek-v4-flash

INSTALL_CODEX_CLI=true
CODEX_CLI_VERSION=0.136.0
INSTALL_CLAUDE_CODE=true
CLAUDE_CODE_VERSION=latest
APT_DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security
NPM_REGISTRY=https://registry.npmmirror.com
```

先用 `AGENTHUB_REAL_AGENTS=false` 跑通部署链路。确认 API、已有 PostgreSQL、前端连接都正常后，再开启真实 Agent。

## 4. 启动 AgentHub API

```bash
docker compose --env-file .env.docker up -d --build agenthub
```

当前 compose 不再创建 PostgreSQL 容器。AgentHub 会通过 `host.docker.internal:${POSTGRES_PORT:-5432}` 连接服务器上已有的 PostgreSQL，例如已存在的 `agenthub-postgres` 容器。

查看容器：

```bash
docker compose --env-file .env.docker ps
```

查看日志：

```bash
docker compose --env-file .env.docker logs -f agenthub
```

## 5. 健康检查

在服务器上执行：

```bash
curl http://127.0.0.1:8787/api/health
```

预期：

```json
{"ok":true,"storage":"postgres","realAgents":false}
```

如果 `storage` 不是 `postgres`，说明 `AGENTHUB_STORAGE` 或 `DATABASE_URL` 没生效。

如果外部需要直接访问：

```bash
curl http://服务器IP:8787/api/health
```

云服务器安全组、防火墙需要放行 `8787`，但生产环境更建议只暴露 Nginx 的 `80/443`，不要直接暴露 `8787`。

## 6. 前端如何连接

有两种方式。

方式一：前端直接请求 `http://服务器IP:8787`

`.env.docker` 里必须包含前端 origin：

```bash
AGENTHUB_CORS_ORIGINS=http://服务器IP:5173,http://你的前端域名
```

方式二：Nginx 同源反代，推荐生产使用

示例：

```nginx
location /agenthub/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
  proxy_read_timeout 300s;
}
```

`proxy_buffering off` 和较长的 `proxy_read_timeout` 是为了 `/api/messages/stream` 的 SSE 流式接口。

## 7. 开启真实 Codex Agent

确认 API 和 PostgreSQL 已正常后，再开启真实 Agent。

修改 `.env.docker`：

```bash
AGENTHUB_REAL_AGENTS=true
AGENTHUB_ORCHESTRATOR_PROVIDER=deepseek
AGENTHUB_CODEX_BRIDGE_URL=http://codex-bridge:8788/v1
AGENTHUB_CODEX_MODEL_PROVIDER=agenthub-deepseek
AGENTHUB_CODEX_MODEL=deepseek-v4-pro
AGENTHUB_CODEX_BRIDGE_API_KEY=agenthub-local
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

启动 Codex bridge profile：

```bash
docker compose --env-file .env.docker --profile real-agents up -d --build
```

查看 bridge 日志：

```bash
docker compose --env-file .env.docker logs -f codex-bridge
```

注意：当前 Docker 镜像默认同时安装 `@openai/codex` 和 `@anthropic-ai/claude-code`。真实 Claude Agent 还需要在运行时提供 Claude Code 所需的鉴权配置；如果没有配置鉴权，`claude` provider 仍然会执行失败。

## 8. Claude Code 配置

Claude Code 可以通过两种方式配置。

方式一：在 `.env.docker` 里配置环境变量，推荐容器部署优先用这个方式。AgentHub 启动的 `claude` 子进程会继承容器环境变量。

```bash
ANTHROPIC_API_KEY=你的 Anthropic API Key
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=你的 Claude 模型
API_TIMEOUT_MS=1200000
BASH_DEFAULT_TIMEOUT_MS=300000
CLAUDE_CODE_MAX_RETRIES=5
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
DISABLE_TELEMETRY=1
```

如果使用代理：

```bash
HTTP_PROXY=http://proxy-host:proxy-port
HTTPS_PROXY=http://proxy-host:proxy-port
NO_PROXY=localhost,127.0.0.1,host.docker.internal,codex-bridge
```

注意：设置 `ANTHROPIC_API_KEY` 后，Claude Code 会优先使用 API key，而不是 Claude Pro/Max/Team/Enterprise 订阅登录态。

方式二：写入容器内 `~/.claude/settings.json`。当前 compose 已把 `/home/node` 挂成 `agenthub_node_home` volume，容器重建后配置不会丢。

```bash
docker compose --env-file .env.docker exec agenthub sh -lc 'mkdir -p ~/.claude && cat > ~/.claude/settings.json <<EOF
{
  "env": {
    "API_TIMEOUT_MS": "1200000",
    "BASH_DEFAULT_TIMEOUT_MS": "300000",
    "CLAUDE_CODE_MAX_RETRIES": "5",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_TELEMETRY": "1"
  }
}
EOF'
```

验证 Claude Code 配置：

```bash
docker compose --env-file .env.docker exec agenthub claude --version
docker compose --env-file .env.docker exec agenthub sh -lc 'ls -la ~/.claude && cat ~/.claude/settings.json'
```

如果服务器宿主机 root 已经配置好了 Claude Code 和 Codex，可以把现有配置一次性导入 Docker volume。不要长期直接 bind mount `/root/.claude`、`/root/.claude.json`、`/root/.codex`，否则容易出现权限问题，也会让容器直接改宿主机配置。

先启动容器：

```bash
docker compose --env-file .env.docker --profile real-agents up -d --build
```

把宿主机配置复制到容器对应的持久化 volume：

```bash
docker compose --env-file .env.docker cp /root/.claude/. agenthub:/home/node/.claude/
docker compose --env-file .env.docker cp /root/.claude.json agenthub:/home/node/.claude.json
docker compose --env-file .env.docker cp /root/.codex/. agenthub:/app/.codex-agenthub/
docker compose --env-file .env.docker exec -u root agenthub chown -R node:node /home/node /app/.codex-agenthub
```

验证：

```bash
docker compose --env-file .env.docker exec agenthub sh -lc 'whoami && ls -la ~ ~/.claude /app/.codex-agenthub'
docker compose --env-file .env.docker exec agenthub claude --version
docker compose --env-file .env.docker exec agenthub codex --version
```

## 9. 常用运维命令

重启 AgentHub：

```bash
docker compose --env-file .env.docker restart agenthub
```

重启全部：

```bash
docker compose --env-file .env.docker restart
```

停止：

```bash
docker compose --env-file .env.docker down
```

停止并删除数据卷，谨慎使用：

```bash
docker compose --env-file .env.docker down -v
```

更新代码并重新部署：

```bash
cd /opt/agenthub/byDance
git pull
cd agentHub
docker compose --env-file .env.docker up -d --build
```

## 10. 持久化数据

Compose 会创建三个 named volumes：

- `agenthub_runtime_data`：AgentHub workspace repo、预览文件、生成产物
- `agenthub_codex_home`：AgentHub 使用的 Codex home/config
- `agenthub_node_home`：容器内 `node` 用户 home，包含 Claude Code 的 `~/.claude` 和 `~/.claude.json`

PostgreSQL 数据不再由本 compose 管理。备份已有 PostgreSQL 容器：

```bash
docker exec agenthub-postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > agenthub.sql
```

恢复到已有 PostgreSQL 容器：

```bash
cat agenthub.sql | docker exec -i agenthub-postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

## 11. 常见问题

PostgreSQL 连不上：

- 当前 compose 通过 `host.docker.internal:${POSTGRES_PORT:-5432}` 连接服务器已有 PostgreSQL。
- 检查已有 PostgreSQL 容器是否运行：`docker ps | grep agenthub-postgres`
- 检查 PostgreSQL 容器日志：`docker logs agenthub-postgres`
- 检查 `docker compose --env-file .env.docker ps`

健康检查不是 postgres：

- 检查 `AGENTHUB_STORAGE=postgres`
- 检查 `DATABASE_URL` 是否被覆盖

浏览器 CORS 报错：

- 把前端地址加入 `AGENTHUB_CORS_ORIGINS`
- 或改成 Nginx 同源反代

真实 Codex 任务提示 bridge unavailable：

- 使用 `--profile real-agents` 启动
- 检查 `codex-bridge` 日志
- 确认 `DEEPSEEK_API_KEY` 已配置

真实 Claude Agent 跑不起来：

- 检查镜像构建参数 `INSTALL_CLAUDE_CODE=true`
- 进入容器执行 `claude --version`
- 检查 Claude Code 鉴权配置是否已提供
- 临时方案是先用 `AGENTHUB_REAL_AGENTS=false` 或把对应 Agent 改为 `codex/mock`
