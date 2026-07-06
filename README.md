# Linux Share Manager

Linux Share Manager 是一个面向内网运维场景的 Web 控制台，目标是把两台 Linux 服务器之间的 NFS 目录共享配置成可预览、可确认、可追踪、可恢复的流程。

当前仓库已完成 V1 的可运行基础：

- Bun + Hono 后端 API
- Vite + React 前端控制台
- SQLite 持久化与自动初始化迁移
- 单管理员初始化、登录、退出登录和会话保护
- Linux 节点新增、编辑、SSH 凭据填写/上传和快速连接测试
- 源节点目录浏览接口和共享草稿管理
- 单端口 Docker 部署，前端和 API 共用一个入口
- 基础同源写请求保护
- 集成测试覆盖认证、节点、凭据、共享、静态服务和连接测试主流程

完整产品边界见 `PROJECT_CONCEPT.md`，实施顺序见 `IMPLEMENTATION_DEVELOPMENT.md`。

## 开发环境

需要 Bun 1.3 或更新版本。

```bash
bun install
bun run dev:server
bun run dev:web
```

默认服务：

- API: `http://127.0.0.1:18088`
- Web: `http://127.0.0.1:5173`
- SQLite: `./data/linux-share-manager.sqlite`

如果 `18088` 后续也被占用，可以临时指定：

```bash
LSM_PORT=18089 bun run dev:server
LSM_API_TARGET=http://127.0.0.1:18089 bun run dev:web
```

## Docker 单端口部署

当前 Docker 方案只暴露一个端口：`18088`。前端静态资源和后端 API 都由同一个 Bun/Hono 服务提供，不需要额外的 Web 端口。

```bash
docker compose up -d --build
```

访问：

```text
http://127.0.0.1:18088
```

本地 Docker 首次访问会进入“初始化管理员”页面。推荐本地测试账号：

```text
用户名：admin
密码：LinuxShare@18088
```

如果 `./data/linux-share-manager.sqlite` 已经初始化过，登录密码以第一次创建管理员时填写的密码为准。

端口映射在 `docker-compose.yml` 中固定为：

```yaml
ports:
  - "18088:18088"
```

如果部署机器上后续出现冲突，只改这一处和 `LSM_PORT`，并保持两边数字一致，例如：

```yaml
environment:
  LSM_PORT: "18089"
ports:
  - "18089:18089"
```

## 常用命令

```bash
bun run lint
bun run typecheck
bun test
bun run build
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LSM_HOST` | `127.0.0.1` | API 监听地址 |
| `LSM_PORT` | `18088` | API 监听端口 |
| `LSM_DATABASE_PATH` | `./data/linux-share-manager.sqlite` | SQLite 数据库路径 |
| `LSM_STATIC_ROOT` | `./dist/web` | 生产前端静态资源目录 |
| `LSM_SECRET_KEY` | 无 | SSH 凭据加密密钥；保存密码或私钥时必须设置 |
| `LSM_SESSION_COOKIE_NAME` | `lsm_session` | 会话 cookie 名称 |
| `LSM_SESSION_TTL_SECONDS` | `86400` | 会话有效期 |
| `LSM_SSH_CONNECT_TIMEOUT_MS` | `5000` | 节点快速连接测试超时 |
| `LSM_SECURE_COOKIE` | `false` | 是否启用 Secure cookie |
| `LSM_WEB_ORIGIN` | `http://127.0.0.1:5173` | 写请求同源校验来源 |
| `LSM_API_TARGET` | `http://127.0.0.1:18088` | Vite 开发代理目标 |

## 当前 API

- `GET /api/health`
- `GET /api/auth/status`
- `POST /api/auth/init`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/nodes`
- `GET /api/nodes/:id`
- `POST /api/nodes`
- `PATCH /api/nodes/:id`
- `POST /api/nodes/:id/test-connection`
- `GET /api/nodes/:id/browse`
- `GET /api/shares`
- `GET /api/shares/:id`
- `POST /api/shares`
- `PATCH /api/shares/:id`
- `DELETE /api/shares/:id`

`/api/nodes/:id/test-connection` 是快速 TCP 可达性检查，用来确认 Web 服务所在机器能连接到节点的 SSH 端口。完整 SSH 登录、sudo 和系统环境探测属于后续节点探测能力。

## 下一阶段

下一步进入执行层：

1. SSH 连接与命令执行器。
2. 系统探测：发行版、sudo、systemd、NFS 包、防火墙和 IP。
3. 共享任务模型与“只生成计划不执行”的预览流程。
4. 远程配置执行、日志、失败恢复和审计记录。
