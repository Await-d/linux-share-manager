# Linux Share Manager

[English](README.md) | [简体中文](README.zh-CN.md)

Linux Share Manager is an intranet operations web console for safely configuring NFS directory sharing between Linux servers. It turns a risky SSH, NFS, systemd, and health-check workflow into a previewable, confirmable, traceable, and recoverable process.

## What It Does

Linux Share Manager helps an administrator:

- Register Linux source and target nodes.
- Store SSH credentials with encrypted persistence.
- Probe SSH, sudo, OS, systemd, NFS package, firewall, IP, and disk status.
- Create NFS share drafts between two Linux nodes.
- Run pre-checks before generating an execution plan.
- Preview NFS and systemd changes before applying them.
- Execute remote configuration steps through SSH.
- Track plan execution results, audit logs, and health status.
- Check inter-node NFS reachability, mount state, read/write status, and export status.
- Disable, enable, remount, retry, and health-check managed shares.

The project is designed for internal Linux-to-Linux NFS workflows. It is not a general-purpose distributed storage platform.

## Current Stack

- Bun + Hono backend API
- Vite + React frontend console
- SQLite persistence with startup migration
- Drizzle ORM
- Zod request/response schemas
- SSH command execution through `ssh2`
- Single-port Docker deployment
- Unit and integration tests with `bun test`

## Development

Bun 1.3 or newer is recommended.

```bash
bun install
bun run dev:server
bun run dev:web
```

Default local services:

- API: `http://127.0.0.1:18188`
- Web: `http://127.0.0.1:5173`
- SQLite: `./data/linux-share-manager.sqlite`

The development API uses `18188` by default to avoid colliding with the Docker deployment port `18088`. If the default development port is already in use:

```bash
LSM_PORT=18189 bun run dev:server
LSM_API_TARGET=http://127.0.0.1:18189 bun run dev:web
```

## Docker Single-Port Deployment

The Docker deployment exposes one port: `18088`. The same Bun/Hono service serves both the frontend assets and backend API.

```bash
docker compose up -d --build
```

Open:

```text
http://127.0.0.1:18088
```

On first access, the app opens the administrator initialization page. A local testing account can be:

```text
Username: admin
Password: LinuxShare@18088
```

If `./data/linux-share-manager.sqlite` has already been initialized, use the password created during the first initialization.

The Docker port mapping is fixed in `docker-compose.yml`:

```yaml
ports:
  - "18088:18088"
```

If the deployment host has a port conflict, update both the container environment and port mapping consistently:

```yaml
environment:
  LSM_PORT: "18089"
ports:
  - "18089:18089"
```

More deployment notes are available in [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md).

## Common Commands

```bash
bun run lint
bun run typecheck
bun test
bun run build
bun run release:package
```

## Versioning And Release Packages

The canonical application version is the `version` field in [package.json](package.json). The backend exposes this value through `GET /api/health`, together with optional build metadata from `LSM_BUILD_COMMIT` and `LSM_BUILD_TIME`.

`bun run release:package` builds the latest frontend and backend output, then writes a versioned archive and manifest under `packages/`, for example:

```text
packages/linux-share-manager-v0.1.1.tar.gz
packages/linux-share-manager-v0.1.1.json
```

To run an extracted package:

```bash
tar -xzf packages/linux-share-manager-v0.1.1.tar.gz
cd linux-share-manager-v0.1.1
bun install --production
LSM_HOST=0.0.0.0 LSM_PORT=18088 bun run start
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `LSM_HOST` | `127.0.0.1` | API listen host |
| `LSM_PORT` | `18188` | Development API port; Docker explicitly uses `18088` in compose |
| `LSM_DATABASE_PATH` | `./data/linux-share-manager.sqlite` | SQLite database path |
| `LSM_STATIC_ROOT` | `./dist/web` | Production frontend asset root |
| `LSM_SECRET_KEY` | unset | Required to save encrypted SSH passwords or private keys |
| `LSM_SESSION_COOKIE_NAME` | `lsm_session` | Session cookie name |
| `LSM_SESSION_TTL_SECONDS` | `86400` | Session lifetime |
| `LSM_SSH_CONNECT_TIMEOUT_MS` | `5000` | Fast SSH TCP connectivity timeout |
| `LSM_SECURE_COOKIE` | `false` | Enables Secure cookies |
| `LSM_WEB_ORIGIN` | `http://127.0.0.1:5173` | Same-origin guard for write requests |
| `LSM_API_TARGET` | `http://127.0.0.1:18188` | Vite development proxy target |
| `LSM_BUILD_COMMIT` | unset | Optional source commit shown by `/api/health` |
| `LSM_BUILD_TIME` | unset | Optional build timestamp shown by `/api/health` |

## API Surface

Core routes include:

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

## Safety Boundaries

Linux Share Manager is intended for controlled intranet environments. It does not aim to replace Ceph, GlusterFS, DRBD, iSCSI clusters, or other storage platforms.

Avoid using NFS through this tool for:

- Database data directories.
- Docker core volumes.
- High-frequency multi-writer workloads.
- Shared block devices.
- Internet-facing untrusted administration.

The product concept and implementation notes are currently maintained in Chinese:

- [PROJECT_CONCEPT.md](PROJECT_CONCEPT.md)
- [IMPLEMENTATION_DEVELOPMENT.md](IMPLEMENTATION_DEVELOPMENT.md)
