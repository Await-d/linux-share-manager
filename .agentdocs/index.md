# Agentdocs Index

## Current Workflows

- `260706-implementation-development-doc`: Implementation document created; development has moved into the runnable V1 baseline.

## Project Notes

- The repository now contains a runnable Bun/Hono + React/Vite implementation.
- The primary implementation reference is `IMPLEMENTATION_DEVELOPMENT.md`.
- Current baseline includes single-admin auth, SQLite migrations, node add/edit, encrypted SSH credential storage, node TCP connection testing, share drafts, directory browsing scaffolding, and single-port Docker deployment on `18088`.
- Remaining V1 work centers on real SSH command execution, node probing, plan generation, NFS/systemd apply flows, logs, rollback, and health checks.
- `.agentdocs/runtime/` is temporary coordination state and is ignored by git.
