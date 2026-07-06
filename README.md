# Linux Share Manager

Linux Share Manager 是一个面向内网运维场景的 Web 控制台，目标是把两台 Linux 服务器之间的 NFS 目录共享配置成可预览、可确认、可追踪、可恢复的流程。

当前仓库已完成 V1 的基础骨架：

- Bun + Hono 后端 API
- Vite + React 前端控制台
- SQLite 持久化与自动初始化迁移
- 单管理员初始化、登录、退出登录和会话保护
- Linux 节点列表与新增接口
- 基础同源写请求保护
- 集成测试覆盖认证和节点管理主流程

完整产品边界见 `PROJECT_CONCEPT.md`，实施顺序见 `IMPLEMENTATION_DEVELOPMENT.md`。

## 开发环境

需要 Bun 1.3 或更新版本。

```bash
bun install
bun run dev:server
bun run dev:web
```

默认服务：

- API: `http://127.0.0.1:8080`
- Web: `http://127.0.0.1:5173`
- SQLite: `./data/linux-share-manager.sqlite`

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
| `LSM_PORT` | `8080` | API 监听端口 |
| `LSM_DATABASE_PATH` | `./data/linux-share-manager.sqlite` | SQLite 数据库路径 |
| `LSM_SESSION_COOKIE_NAME` | `lsm_session` | 会话 cookie 名称 |
| `LSM_SESSION_TTL_SECONDS` | `86400` | 会话有效期 |
| `LSM_SECURE_COOKIE` | `false` | 是否启用 Secure cookie |
| `LSM_WEB_ORIGIN` | `http://127.0.0.1:5173` | 写请求同源校验来源 |
| `LSM_API_TARGET` | `http://127.0.0.1:8080` | Vite 开发代理目标 |

## 当前 API

- `GET /api/health`
- `GET /api/auth/status`
- `POST /api/auth/init`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/nodes`
- `POST /api/nodes`

## 下一阶段

下一步进入执行层：

1. SSH 连接与命令执行器。
2. 系统探测：发行版、sudo、systemd、NFS 包、防火墙和 IP。
3. 共享任务模型与“只生成计划不执行”的预览流程。
4. 远程配置执行、日志、失败恢复和审计记录。
