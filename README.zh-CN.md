# Linux Share Manager

[English](README.md) | [简体中文](README.zh-CN.md)

Linux Share Manager 是一个面向内网运维场景的 Web 控制台，用于在两台 Linux 服务器之间安全配置和管理 NFS 目录共享。它把 SSH、NFS、systemd 和健康检查这些高风险操作整理成可预览、可确认、可追踪、可恢复的流程。

## 它能做什么

Linux Share Manager 可以帮助管理员：

- 注册 Linux 共享端和挂载端节点。
- 加密保存 SSH 密码或私钥凭据。
- 探测 SSH、sudo、操作系统、systemd、NFS 包、防火墙、IP 和磁盘状态。
- 创建两台 Linux 节点之间的 NFS 共享草稿。
- 在生成执行计划前运行前置检查。
- 执行前预览 NFS 与 systemd 配置变更。
- 通过 SSH 执行远程配置步骤。
- 追踪计划执行结果、审计日志和健康状态。
- 检查节点间 NFS 连通性、挂载状态、读写状态和导出状态。
- 对托管共享执行禁用、启用、重挂载、重试和健康检查。

这个项目面向内部 Linux 到 Linux 的 NFS 运维流程，不是通用分布式存储平台。

## 当前技术栈

- Bun + Hono 后端 API
- Vite + React 前端控制台
- SQLite 持久化与启动迁移
- Drizzle ORM
- Zod 请求/响应 schema
- 基于 `ssh2` 的 SSH 命令执行
- 单端口 Docker 部署
- 使用 `bun test` 的单元测试和集成测试

## 开发环境

推荐使用 Bun 1.3 或更新版本。

```bash
bun install
bun run dev:server
bun run dev:web
```

默认本地服务：

- API: `http://127.0.0.1:18188`
- Web: `http://127.0.0.1:5173`
- SQLite: `./data/linux-share-manager.sqlite`

开发环境默认使用 `18188`，避免和 Docker 部署端口 `18088` 冲突。如果 `18188` 后续也被占用，可以临时指定：

```bash
LSM_PORT=18189 bun run dev:server
LSM_API_TARGET=http://127.0.0.1:18189 bun run dev:web
```

## Docker 单端口部署

Docker 部署只暴露一个端口：`18088`。前端静态资源和后端 API 都由同一个 Bun/Hono 服务提供。

```bash
docker compose up -d --build
```

访问：

```text
http://127.0.0.1:18088
```

首次访问会进入“初始化管理员”页面。本地测试账号可以使用：

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

如果部署机器上出现端口冲突，需要同时修改容器环境变量和端口映射，例如：

```yaml
environment:
  LSM_PORT: "18089"
ports:
  - "18089:18089"
```

更多部署说明见 [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)。

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
| `LSM_PORT` | `18188` | 开发 API 监听端口；Docker 部署在 compose 中显式使用 `18088` |
| `LSM_DATABASE_PATH` | `./data/linux-share-manager.sqlite` | SQLite 数据库路径 |
| `LSM_STATIC_ROOT` | `./dist/web` | 生产前端静态资源目录 |
| `LSM_SECRET_KEY` | 无 | 保存加密 SSH 密码或私钥时必须设置 |
| `LSM_SESSION_COOKIE_NAME` | `lsm_session` | 会话 cookie 名称 |
| `LSM_SESSION_TTL_SECONDS` | `86400` | 会话有效期 |
| `LSM_SSH_CONNECT_TIMEOUT_MS` | `5000` | SSH TCP 快速连通性测试超时 |
| `LSM_SECURE_COOKIE` | `false` | 是否启用 Secure cookie |
| `LSM_WEB_ORIGIN` | `http://127.0.0.1:5173` | 写请求同源校验来源 |
| `LSM_API_TARGET` | `http://127.0.0.1:18188` | Vite 开发代理目标 |

## API 概览

核心接口包括：

- `GET /api/health`
- `GET /api/auth/status`
- `POST /api/auth/init`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/nodes`
- `POST /api/nodes`
- `PATCH /api/nodes/:id`
- `POST /api/nodes/:id/test-connection`
- `POST /api/nodes/:id/test-auth`
- `POST /api/nodes/:id/probe`
- `GET /api/nodes/:id/browse`
- `GET /api/shares`
- `POST /api/shares`
- `PATCH /api/shares/:id`
- `DELETE /api/shares/:id`
- `POST /api/shares/:id/plan`
- `POST /api/shares/:id/apply`
- `POST /api/shares/:id/check`
- `POST /api/shares/:id/disable`
- `POST /api/shares/:id/enable`
- `POST /api/shares/:id/remount`
- `GET /api/interconnect/:sourceId/:targetId`

## 安全边界

Linux Share Manager 适合在受控内网环境中使用，不用于替代 Ceph、GlusterFS、DRBD、iSCSI 集群或其他存储平台。

不建议通过本工具把 NFS 用于：

- 数据库数据目录。
- Docker 核心 volume。
- 多节点高频同时写入。
- 共享块设备。
- 面向公网的不可信管理入口。

产品构思和实施说明目前以中文维护：

- [PROJECT_CONCEPT.md](PROJECT_CONCEPT.md)
- [IMPLEMENTATION_DEVELOPMENT.md](IMPLEMENTATION_DEVELOPMENT.md)
