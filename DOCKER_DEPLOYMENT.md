# Docker 单端口部署方案

更新时间：2026-07-06

## 端口选择

已检查当前 Docker 和系统监听端口，发现以下端口已被占用：

- Docker 服务：`5432`、`5341`、`6379`、`6666`、`6671`、`6672`、`6673`、`7010`、`7861`、`8000`、`8001`、`8030`、`8080`、`8081`、`15432`、`16379`、`18080`、`19000`、`19001`
- 本机开发服务：`5173`、`4173`、`4181`、`44279`
- 系统服务：`22`、`53`、`139`、`445`、`5100`

最终选择 `18088`：

- 当前没有 Docker 容器映射。
- 当前没有系统 TCP 监听。
- 接近已有内部管理端口段，但避开已占用的 `18080`。
- 适合作为单端口 Web 控制台入口。

## 部署目标

Docker 部署只暴露一个端口：

```text
宿主机 18088 -> 容器 18088
```

前端页面和后端 API 都由同一个 Bun/Hono 服务提供：

```text
http://服务器地址:18088/          前端页面
http://服务器地址:18088/api/...   后端 API
```

不再额外暴露 Vite、Nginx 或第二个 API 端口。

## 启动命令

```bash
docker compose up -d --build
```

本地首次访问会进入管理员初始化页面。推荐本地测试账号：

```text
用户名：admin
密码：LinuxShare@18088
```

如果 `./data/linux-share-manager.sqlite` 已经存在并初始化过，账号密码以第一次创建的管理员为准。需要重新初始化本地测试环境时，先停止服务并备份或删除 `./data/linux-share-manager.sqlite`。

查看状态：

```bash
docker compose ps
docker compose logs -f linux-share-manager
```

停止：

```bash
docker compose down
```

## 数据持久化

SQLite 数据库通过宿主机目录持久化：

```text
./data:/app/data
```

默认数据库路径：

```text
/app/data/linux-share-manager.sqlite
```

## 配置

核心环境变量：

| 变量 | 值 |
| --- | --- |
| `LSM_HOST` | `0.0.0.0` |
| `LSM_PORT` | `18088` |
| `LSM_DATABASE_PATH` | `/app/data/linux-share-manager.sqlite` |
| `LSM_STATIC_ROOT` | `/app/dist/web` |
| `LSM_SECRET_KEY` | `change-this-local-docker-secret-before-production` |
| `LSM_SSH_CONNECT_TIMEOUT_MS` | `5000` |

`LSM_SECRET_KEY` 用于加密保存 SSH 密码和私钥。生产环境必须替换为只在服务器上保存的强随机值；如果更换密钥，旧凭据需要重新保存。

节点页面的“测试”按钮会调用 `/api/nodes/:id/test-connection`，快速检查服务端到该节点 SSH 端口的 TCP 可达性。它用于快速排查主机、端口和网络连通性，不等同于完整 SSH 登录认证探测。

## 端口冲突处理

如果未来 `18088` 被占用，先确认占用方：

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -H -ltn sport = :18088
```

然后在 `docker-compose.yml` 中保持容器内外一致修改，例如改为 `18089`：

```yaml
environment:
  LSM_PORT: "18089"
ports:
  - "18089:18089"
```

不要配置成多个端口，也不要把前端和 API 分开暴露。
