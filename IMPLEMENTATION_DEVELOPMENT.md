# Linux Share Manager 实施开发文档

更新时间：2026-07-06

本文档基于 `PROJECT_CONCEPT.md`，补充项目落地时必须提前确定的边界、架构、开发顺序、验收标准和风险控制。它面向后续实际开发，目标是让开发人员可以按阶段实现 V1，而不是重新讨论产品方向。

## 1. V1 目标

Linux Share Manager V1 是一个单机部署的内网 Web 控制台，通过 SSH 编排两台 Linux 服务器之间的 NFS 目录共享。

V1 必须完成的闭环：

1. 管理员登录 Web 控制台。
2. 添加源节点 A 和目标节点 B。
3. 检测 SSH、sudo、系统类型、NFS 环境、systemd、防火墙状态。
4. 创建一个共享任务：A 的源目录通过 NFS 挂载到 B 的目标目录。
5. 生成执行计划，只展示不执行。
6. 管理员确认后执行远程配置。
7. B 节点能成功挂载、读写检测、重启后自动恢复。
8. 页面能查看共享状态、执行日志、错误原因。
9. 管理员能重新检测、重新挂载、禁用自动挂载、恢复自动挂载、删除任务。

V1 不追求企业级多租户，也不提供通用存储平台能力。它先把“两台 Linux 之间安全、可追踪、可恢复地配置 NFS”做稳。

## 1.1 当前实现状态

截至 2026-07-06，仓库已经从文档阶段进入可运行基础实现阶段：

- 已完成 Bun + Hono + SQLite 后端、Vite + React 前端、统一单端口静态服务。
- 已完成单管理员初始化、登录、退出和 session 保护。
- 已完成节点新增、编辑、列表展示、SSH 密码/私钥填写上传、凭据加密保存和安全响应脱敏。
- 已完成节点“测试”按钮和 `/api/nodes/:id/test-connection`，用于快速检查服务端到节点 SSH 端口的 TCP 可达性。
- 已完成共享草稿创建、编辑、删除和源/目标节点目录字段配置。
- 已完成 Docker 单端口部署方案，默认使用宿主机 `18088 -> 容器 18088`。

仍未完成的 V1 核心闭环：

- 完整 SSH 登录认证测试、sudo 检测和结构化命令执行。
- OS、NFS、systemd、防火墙、IP 和磁盘探测。
- 执行计划生成、风险预览和二次确认。
- 远程 NFS/systemd 配置执行、日志、回滚和健康检查。

因此当前版本可作为 P0/P1 基线和 P2 开发起点，但还不能用于真实生产修改远端 Linux 配置。

## 2. 默认决策

这些决策是开发默认值，除非后续明确修改，否则按这里实现。

| 项目 | V1 决策 |
| --- | --- |
| 部署形态 | 单个 Web 服务，部署在管理机或内网任一服务器上 |
| 使用范围 | 内网优先，不默认面向公网暴露 |
| 用户模型 | 单用户管理员登录 |
| 协议 | 只支持 NFS，默认 NFSv4.2，兼容 NFSv4 |
| NFSv3 | V1 不主动支持，只预留扩展点 |
| 自动挂载 | systemd `.mount` + `.automount` 优先 |
| `/etc/fstab` | V1 不作为默认写入方式，仅作为后续兼容方案 |
| 数据库 | SQLite |
| 后端 | TypeScript + Bun + Hono + Zod |
| 前端 | Vite + React + TypeScript |
| SSH 认证 | SSH 私钥优先；密码登录可作为一次性输入，不默认长期保存 |
| sudo | 推荐免密 sudo；需要 sudo 密码时只做一次性会话输入 |
| 防火墙 | 先检测并提示，自动放通作为可确认的危险操作 |
| 配置管理 | 只管理带标记的配置块和本工具生成的 systemd 单元 |
| 回滚 | 失败时只回滚本次创建或修改的托管内容，不删除用户原有配置 |

## 3. 支持范围

### 3.1 支持的系统

V1 优先支持：

- Ubuntu 22.04 LTS / 24.04 LTS
- Debian 12
- Rocky Linux 9
- AlmaLinux 9

V1 可以尽量兼容但不作为首批验收目标：

- CentOS Stream
- openSUSE
- Arch Linux

不同发行版要通过系统适配层处理包名、服务名和防火墙工具差异。

| 系统族 | Server 包 | Client 包 | 服务名 | 防火墙 |
| --- | --- | --- | --- | --- |
| Debian/Ubuntu | `nfs-kernel-server` | `nfs-common` | `nfs-server` 或 `nfs-kernel-server` | `ufw` / `nftables` |
| RHEL/Rocky/Alma | `nfs-utils` | `nfs-utils` | `nfs-server` | `firewalld` |

系统探测必须以实际命令结果为准，不要只根据 `/etc/os-release` 推断。

### 3.2 网络前提

V1 假设：

- Web 服务所在机器能 SSH 到源节点和目标节点。
- 目标节点 B 能访问源节点 A 的 NFS 服务端口。
- A 与 B 最好在同一内网或专线网络内。
- 不处理复杂 NAT、跨公网动态 IP、端口映射和 VPN 自动配置。

如果网络不满足，系统应给出明确诊断，而不是继续执行高风险配置。

### 3.3 明确不支持

V1 不支持：

- 数据库数据目录放到 NFS 上。
- Docker 核心 volume 直接放到 NFS 上。
- 多节点同时高频写同一批文件。
- 多用户权限系统。
- Windows/Samba。
- SSHFS。
- iSCSI、DRBD、Ceph、GlusterFS 配置。
- 文件管理器、在线编辑器、文件同步或备份功能。

## 4. 总体架构

```text
Browser
  |
  v
Vite/React Web UI
  |
  v
Hono API Server
  |
  +-- Auth / Session
  +-- Node Service
  +-- Share Service
  +-- Plan Builder
  +-- Execution Engine
  +-- Health Check Service
  +-- Audit Log Service
  |
  +-- SQLite
  |
  +-- SSH Executor
        |
        +-- Source Node A
        +-- Target Node B
```

核心原则：

- Web API 不直接拼接 shell 字符串。
- 所有远程动作先生成计划，再确认执行。
- 计划里的每一步都有预览、执行结果、失败原因和重试策略。
- 系统配置写入必须幂等。
- 所有危险变更必须审计。

## 5. 推荐目录结构

```text
linux-share-manager/
  package.json
  bun.lock
  README.md
  PROJECT_CONCEPT.md
  IMPLEMENTATION_DEVELOPMENT.md
  src/
    server/
      index.ts
      app.ts
      config.ts
      auth/
      db/
      nodes/
      shares/
      plans/
      executor/
      system/
      audit/
      health/
      routes/
    web/
      main.tsx
      App.tsx
      routes/
      components/
      features/
      api/
      styles/
    shared/
      schemas/
      types/
      constants/
  migrations/
  scripts/
  tests/
    unit/
    integration/
    e2e/
  docs/
```

`src/shared` 只放前后端都需要的类型、Zod schema 和常量，不放后端实现细节。

## 6. 后端模块设计

### 6.1 Auth 模块

职责：

- 管理单用户登录。
- 创建、刷新、注销 session。
- 保护所有 `/api/*` 管理接口。
- 提供初始化管理员密码的机制。

实现要求：

- 首次启动如果没有管理员账号，生成一次性初始化 token 或要求通过环境变量设置初始密码。
- 密码使用 Argon2id 或 bcrypt 哈希保存。
- Session cookie 默认 `HttpOnly`、`SameSite=Lax`。
- 如果部署在 HTTPS 后面，支持启用 `Secure` cookie。
- 所有写操作需要 CSRF 防护或同源校验。

V1 不做：

- 多用户。
- OAuth。
- RBAC。
- API token。

### 6.2 Node 模块

职责：

- 保存 Linux 节点信息。
- 测试 SSH 连接。
- 探测 OS、包管理器、sudo、systemd、NFS、防火墙、IP、磁盘空间。
- 保存最近一次探测结果。

关键行为：

- 添加节点时不立即执行安装动作，只做连接和基本探测。
- 节点探测必须有超时。
- 探测输出必须脱敏后入库。
- 同一节点同一时间只允许一个 probe 运行。

节点探测命令建议：

```bash
cat /etc/os-release
id -u
sudo -n true
command -v systemctl
systemctl is-system-running
command -v exportfs
command -v mount.nfs
ip -o addr show
df -P
```

`sudo -n true` 失败不代表节点不可用，但代表后续配置需要用户处理 sudo 权限。

### 6.3 Credential 模块

职责：

- 管理 SSH 认证材料引用。
- 加密保存必要凭据。
- 避免把敏感内容写入日志和命令记录。

V1 策略：

- 优先支持私钥认证。
- 私钥可以加密保存在 SQLite，密钥来自环境变量 `LSM_SECRET_KEY`。
- 如果没有 `LSM_SECRET_KEY`，不允许持久保存私钥，只允许本次会话使用。
- SSH 密码和 sudo 密码默认不持久化，只允许一次性输入。
- 日志中永远不展示密码、私钥、passphrase。

后续可以扩展：

- ssh-agent。
- 系统 keyring。
- HashiCorp Vault / 1Password / SOPS。

### 6.4 Plan Builder 模块

职责：

- 把用户输入转换成执行计划。
- 做输入校验、风险识别、冲突检查、命令预览。
- 生成不可变的 plan 版本，供 apply 使用。

计划生成必须检查：

- 源节点和目标节点存在且可用。
- 源目录和目标目录是绝对路径。
- 源目录不是 `/`。
- 目标目录不是关键系统路径。
- 客户端允许规则是单 IP 或 CIDR。
- 目标挂载点没有被其他任务占用。
- 源节点 exports 托管块不会和其他任务冲突。
- NFS 版本、读写权限、root squash 策略合法。

计划输出至少包含：

- 风险等级。
- 将执行的步骤列表。
- 每步影响的节点。
- 命令预览。
- 会写入或修改的文件。
- 是否需要二次确认。
- 可回滚动作。

### 6.5 Execution Engine 模块

职责：

- 执行已确认的计划。
- 逐步记录命令状态。
- 支持失败中止和有限回滚。
- 通过事件流让前端实时展示进度。

执行原则：

- 只执行数据库中已冻结的 plan。
- apply 时校验 plan 未过期，相关节点未发生关键变化。
- 每个 share 同一时间只能有一个执行任务。
- 同一节点的系统配置写入需要互斥锁。
- 每步命令必须有超时。
- stdout/stderr 只保存截断后的脱敏摘要。
- 失败后进入 `partial_failed`，不要假装完全未配置。

建议事件：

```text
plan.started
step.started
step.succeeded
step.failed
rollback.started
rollback.succeeded
rollback.failed
plan.completed
plan.failed
```

### 6.6 System Adapter 模块

职责：

- 屏蔽发行版差异。
- 根据 OS family 生成包安装、服务控制、防火墙检测命令。
- 生成 systemd unit 名称和内容。

接口示例：

```ts
interface SystemAdapter {
  detect(): ProbeCommand[];
  installNfsServer(): CommandSpec[];
  installNfsClient(): CommandSpec[];
  enableNfsServer(): CommandSpec[];
  firewallProbe(): CommandSpec[];
  firewallOpenNfs(clientRule: string): CommandSpec[];
}
```

命令描述必须使用结构化数据，例如：

```ts
type CommandSpec = {
  executable: string;
  args: string[];
  sudo: boolean;
  timeoutMs: number;
  preview: string;
  sensitive?: boolean;
};
```

禁止把用户输入直接拼入一整段 shell。

### 6.7 Share 模块

职责：

- 管理共享任务生命周期。
- 查询共享状态。
- 禁用、恢复、重新挂载、删除配置。

共享状态建议：

| 状态 | 含义 |
| --- | --- |
| `draft` | 已创建但未生成计划 |
| `planned` | 已生成计划，未执行 |
| `applying` | 正在执行配置 |
| `active` | 挂载正常 |
| `degraded` | 部分可用，例如 SSH 可连但读写检测失败 |
| `partial_failed` | 执行过程中失败，可能已有部分配置 |
| `disabled` | 自动挂载已禁用 |
| `unmounted` | 已卸载但配置仍存在 |
| `deleting` | 正在删除托管配置 |
| `deleted` | 已删除 |

状态变化必须由执行结果或检测结果驱动，不能只靠前端按钮直接改状态。

### 6.8 Health 模块

职责：

- 主动检测共享状态。
- 提供手动检测接口。
- 记录最近检测结果和错误分类。

检测内容：

- A 节点 SSH 是否可达。
- A 上 NFS 服务是否运行。
- A 上 exports 是否包含托管配置。
- B 节点 SSH 是否可达。
- B 上 systemd automount 是否启用。
- B 上目标目录是否是 mountpoint。
- `findmnt` 是否指向正确源。
- 读写共享是否能完成写入测试。

写入测试策略：

- 只在任务创建验证、用户手动触发或明确允许时执行。
- 测试文件名使用 `.linux-share-manager-write-test-<share-id>`。
- 测试完成后删除。
- 写入失败要分类为权限问题、只读挂载、NFS 错误或未知错误。

## 7. NFS 配置设计

### 7.1 默认版本

V1 默认使用 NFSv4.2：

- 默认 mount 选项包含 `vers=4.2`。
- 如果目标节点不支持 4.2，再由用户选择兼容 NFSv4。
- V1 不默认启用 NFSv3，因为 NFSv3 涉及 rpcbind、mountd、动态端口和更多防火墙差异。

### 7.2 exports 托管块

`/etc/exports` 只写入本工具托管块，格式示例：

```text
# BEGIN LINUX_SHARE_MANAGER share_id=sh_123
/data/share 192.168.1.20(rw,sync,no_subtree_check,root_squash)
# END LINUX_SHARE_MANAGER share_id=sh_123
```

规则：

- 创建前先备份 `/etc/exports`。
- 只更新同一 `share_id` 的托管块。
- 删除任务时只删除同一 `share_id` 的托管块。
- 如果发现托管块被人工修改，删除或覆盖前必须提示。
- 不修改用户手写的其他 exports 行。

默认 export 选项：

| 模式 | 选项 |
| --- | --- |
| 只读 | `ro,sync,no_subtree_check,root_squash` |
| 读写 | `rw,sync,no_subtree_check,root_squash` |

V1 不提供默认 `no_root_squash`。如未来支持，必须放在高级危险选项中，并要求二次确认。

### 7.3 UID/GID 与权限提示

NFS 使用数字 UID/GID 判断文件属主。A/B 两边用户同名但 UID 不一致时，可能出现文件归属混乱或无法写入。

V1 必须提供权限诊断：

- 显示源目录 owner UID/GID。
- 显示目标节点当前登录用户 UID/GID。
- 检查源目录权限位。
- 在读写模式下执行可选写入测试。
- 当 UID/GID 不一致时给出风险提示。

V1 不自动创建用户或同步 UID/GID。这个动作风险较高，留给管理员处理。

### 7.4 systemd mount/automount

V1 使用 systemd 单元，不默认写 `/etc/fstab`。

单元名必须通过路径规则生成，等价于：

```bash
systemd-escape -p --suffix=mount /mnt/share
systemd-escape -p --suffix=automount /mnt/share
```

`.mount` 示例：

```ini
[Unit]
Description=Linux Share Manager mount for /mnt/share
Documentation=Linux Share Manager share_id=sh_123
After=network-online.target
Wants=network-online.target

[Mount]
What=192.168.1.10:/data/share
Where=/mnt/share
Type=nfs
Options=vers=4.2,_netdev,nofail,hard,timeo=50,retrans=2
TimeoutSec=30

[Install]
WantedBy=multi-user.target
```

`.automount` 示例：

```ini
[Unit]
Description=Linux Share Manager automount for /mnt/share
Documentation=Linux Share Manager share_id=sh_123

[Automount]
Where=/mnt/share
TimeoutIdleSec=60

[Install]
WantedBy=multi-user.target
```

默认使用 `hard` mount，优先保证数据完整性。避免默认 `soft`，因为写入场景下 `soft` 可能让应用误以为写入成功。

### 7.5 防火墙处理

V1 默认策略：

- 探测防火墙状态。
- 给出需要放通的服务或端口建议。
- 自动修改防火墙属于危险操作，必须在执行计划中明确展示并二次确认。

NFSv4 常见情况：

- 优先放通源节点 A 的 NFS 服务。
- firewalld 可使用 `--add-service=nfs`。
- ufw 可按源 IP 放通 `2049/tcp`。

如果发现 NFSv3 或动态端口需求，V1 应提示不在默认支持范围内。

## 8. 幂等、回滚和并发控制

### 8.1 幂等要求

以下操作重复执行必须安全：

- 安装 NFS 包。
- 创建源目录。
- 创建目标挂载目录。
- 写入同一 share 的 exports 托管块。
- 写入同一 share 的 systemd 单元。
- 执行 `exportfs -ra`。
- 执行 `systemctl daemon-reload`。
- 启用 automount。

如果检测到资源已存在但不是本工具创建，必须进入冲突处理，不要直接覆盖。

### 8.2 回滚策略

执行失败时，按已完成步骤倒序回滚可安全撤销的动作。

可回滚：

- 删除本次新建的 systemd 单元。
- 禁用本次启用的 automount。
- 删除本次写入的 exports 托管块。
- 恢复执行前备份的 `/etc/exports`，但只有在确认没有并发变更时才允许。

默认不回滚：

- 已安装的软件包。
- 用户原本存在的目录。
- 执行前已经存在的防火墙规则。
- 用户手工配置。

回滚失败时必须保留错误记录，并将共享状态设为 `partial_failed`。

### 8.3 锁策略

需要的锁：

| 锁 | 范围 | 目的 |
| --- | --- | --- |
| `node:<id>:probe` | 单节点 | 避免重复探测 |
| `node:<id>:config` | 单节点 | 避免并发写系统配置 |
| `share:<id>:apply` | 单共享 | 避免重复执行同一计划 |
| `mount:<target_node_id>:<target_path>` | 单挂载点 | 避免目标目录冲突 |

锁可以先用 SQLite 事务实现。后续如果有多进程或多实例部署，再迁移到外部锁。

## 9. 数据库设计

### 9.1 表清单

V1 建议表：

- `users`
- `sessions`
- `credentials`
- `nodes`
- `node_probe_results`
- `shares`
- `share_plans`
- `command_runs`
- `health_checks`
- `audit_logs`
- `locks`

### 9.2 users

```text
id
username
password_hash
created_at
updated_at
last_login_at
```

### 9.3 credentials

```text
id
type                  -- private_key, password_session, sudo_password_session
label
encrypted_payload
encryption_mode       -- env_key, session_only
created_at
updated_at
last_used_at
```

`session_only` 凭据不能在服务重启后继续使用。

### 9.4 nodes

```text
id
name
host
port
username
credential_id
role                  -- source, target, both
os_family
os_version
package_manager
primary_ip
created_at
updated_at
last_probe_at
last_probe_status
last_probe_summary
```

### 9.5 node_probe_results

```text
id
node_id
status
ssh_ok
sudo_ok
systemd_ok
nfs_server_installed
nfs_client_installed
firewall_type
firewall_status
ip_addresses_json
disk_summary_json
error_code
error_message
created_at
```

### 9.6 shares

```text
id
name
source_node_id
source_path
target_node_id
target_path
protocol              -- nfs
nfs_version           -- 4.2, 4
permission_mode       -- ro, rw
client_allow_rule
root_squash_mode      -- root_squash
auto_mount_enabled
auto_recover_enabled
status
created_at
updated_at
last_check_at
last_error_code
last_error_message
```

### 9.7 share_plans

```text
id
share_id
version
status                -- planned, applying, applied, failed, expired
risk_level
plan_json
created_by
confirmed_at
created_at
updated_at
```

`plan_json` 保存冻结后的步骤，不允许 apply 时重新临时生成。

### 9.8 command_runs

```text
id
plan_id
share_id
node_id
step_key
step_name
command_preview
status
stdout_excerpt
stderr_excerpt
error_code
started_at
finished_at
```

### 9.9 health_checks

```text
id
share_id
status
source_online
target_online
nfs_service_ok
mountpoint_ok
read_ok
write_ok
latency_ms
error_code
error_message
created_at
```

### 9.10 audit_logs

```text
id
actor
action
target_type
target_id
status
summary
metadata_json
ip_address
created_at
```

## 10. API 设计

所有 API 默认要求登录，除登录和初始化接口外。

### 10.1 Auth

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/auth/init` | 首次初始化管理员 |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 退出 |
| `GET` | `/api/auth/me` | 当前用户 |

### 10.2 Nodes

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/nodes` | 添加节点 |
| `GET` | `/api/nodes` | 节点列表 |
| `GET` | `/api/nodes/:id` | 节点详情 |
| `PATCH` | `/api/nodes/:id` | 更新节点基础信息 |
| `POST` | `/api/nodes/:id/test-connection` | 快速测试 SSH 端口 TCP 可达性 |
| `GET` | `/api/nodes/:id/browse` | 使用已保存 SSH 凭据浏览远端目录 |
| `POST` | `/api/nodes/:id/probe` | 执行探测 |
| `GET` | `/api/nodes/:id/probe-results` | 探测历史 |
| `DELETE` | `/api/nodes/:id` | 删除节点 |

删除节点前必须检查是否有关联 share。

`test-connection` 当前只验证 TCP 连通，不验证 SSH 用户名、密码、私钥或 sudo 权限。完整认证和系统探测归入 P2/P3。

### 10.3 Shares

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/shares` | 创建共享草稿 |
| `GET` | `/api/shares` | 共享列表 |
| `GET` | `/api/shares/:id` | 共享详情 |
| `PATCH` | `/api/shares/:id` | 更新共享草稿 |
| `POST` | `/api/shares/:id/plan` | 生成计划 |
| `POST` | `/api/shares/:id/apply` | 确认并执行计划 |
| `GET` | `/api/shares/:id/events` | 执行事件流 |
| `POST` | `/api/shares/:id/check` | 手动健康检查 |
| `POST` | `/api/shares/:id/remount` | 重新挂载 |
| `POST` | `/api/shares/:id/disable` | 禁用自动挂载 |
| `POST` | `/api/shares/:id/enable` | 恢复自动挂载 |
| `DELETE` | `/api/shares/:id` | 删除托管配置 |

`apply` 请求必须包含 `plan_id` 和确认标记，后端要校验计划状态为 `planned`。

### 10.4 Logs

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/audit-logs` | 操作审计日志 |
| `GET` | `/api/command-runs` | 命令执行记录 |
| `GET` | `/api/health-checks` | 健康检查记录 |

日志查询需要分页，默认按时间倒序。

## 11. 输入校验规则

### 11.1 主机地址

允许：

- IPv4
- IPv6
- 合法域名

禁止：

- 空值。
- 包含空格。
- 包含 shell 特殊字符，例如 `;`、`|`、`&`、反引号、`$()`。
- URL 形式，例如 `http://example.com`。

### 11.2 路径

要求：

- 必须是绝对路径。
- 不能是 `/`。
- 不能包含空字节。
- 不能包含换行。
- 不允许 shell 元字符。

禁止作为源目录或目标目录：

```text
/bin
/boot
/dev
/etc
/lib
/lib64
/proc
/root
/run
/sbin
/sys
/usr
/var/lib/mysql
/var/lib/postgresql
/var/lib/redis
/var/lib/docker
```

目标挂载点如果已存在，必须确认它是空目录或由本工具管理。

### 11.3 客户端规则

允许：

- 单个 IP：`192.168.1.20`
- CIDR：`192.168.1.0/24`

V1 默认不允许 `*`。如果后续提供开放全部客户端，需要高级模式和二次确认。

## 12. 前端页面设计

V1 是运维控制台，不做营销首页。登录后直接进入仪表盘。

### 12.1 登录与初始化

页面：

- 初始化管理员。
- 登录。
- 登录过期提示。

要求：

- 初始化状态只在无管理员时出现。
- 密码输入不回显。
- 登录失败提示不能暴露账号是否存在。

### 12.2 仪表盘

展示：

- 节点总数。
- 活跃共享数。
- 异常共享数。
- 最近失败操作。
- 最近健康检查。
- 创建共享入口。

仪表盘只展示摘要，不承载复杂配置。

### 12.3 节点管理

功能：

- 添加节点。
- 编辑节点。
- 测试 SSH。
- 执行完整探测。
- 查看探测结果。
- 查看系统信息和风险提示。

节点卡片或表格必须突出：

- SSH 状态。
- sudo 状态。
- NFS Server/Client 状态。
- systemd 状态。
- 防火墙状态。

### 12.4 创建共享向导

步骤：

1. 选择源节点。
2. 填写源目录。
3. 选择目标节点。
4. 填写目标挂载点。
5. 选择读写模式、NFS 版本、自动挂载。
6. 预检查。
7. 展示执行计划和风险。
8. 二次确认执行。

执行计划页面必须展示：

- 将修改的远程文件。
- 将启动或重启的服务。
- 将写入的 systemd 单元。
- 防火墙变更。
- 回滚能力和不能回滚的动作。

### 12.5 共享详情

展示：

- 当前状态。
- 源节点、源目录。
- 目标节点、目标挂载点。
- NFS 版本和挂载参数。
- systemd 单元状态。
- 最近健康检查。
- 最近执行日志。
- 最近错误和建议处理方式。

操作：

- 重新检测。
- 重新挂载。
- 禁用自动挂载。
- 恢复自动挂载。
- 删除托管配置。

危险操作要二次确认。

### 12.6 日志页面

展示：

- 操作审计。
- 命令执行记录。
- 健康检查历史。

要求：

- 支持按节点、共享、状态、时间过滤。
- 敏感字段脱敏。
- 命令输出默认折叠。

## 13. 开发阶段计划

### P0：项目脚手架与质量基线

目标：

- 初始化 Bun + TypeScript 项目。
- 配置 Hono API、Vite React、SQLite migration。
- 配置 lint、format、typecheck、test。
- 建立基础目录结构。

验收：

- `bun test` 可以运行。
- `bun run typecheck` 通过。
- API health endpoint 返回正常。
- 前端能打开登录占位页。

### P1：数据模型与基础 API

目标：

- 实现 SQLite schema 和 migration。
- 实现用户初始化、登录、session。
- 实现节点和共享基础 CRUD。
- 实现统一错误响应。

验收：

- 能初始化管理员并登录。
- 登录后能创建、查询、更新节点。
- 未登录访问管理接口返回 401。
- 输入校验错误返回结构化错误。

### P2：SSH 执行器与命令安全层

目标：

- 实现 SSH 连接。
- 实现 `CommandSpec` 结构化命令执行。
- 实现超时、stdout/stderr 截断、脱敏。
- 实现 sudo 检测和 sudo 命令执行。

验收：

- 能对测试节点执行只读命令。
- 命令超时能正确失败。
- 敏感字段不会出现在日志。
- 禁止执行原始用户输入拼接命令。

### P3：节点探测

目标：

- 实现 OS、sudo、systemd、NFS、IP、磁盘、防火墙探测。
- 保存探测结果。
- 前端展示节点状态。

验收：

- Ubuntu 和 Rocky 测试节点能得到正确探测结果。
- sudo 不可用时给出明确提示。
- NFS 包缺失时显示待安装。

### P4：共享计划生成

目标：

- 实现 share plan builder。
- 实现路径、客户端规则、目标挂载点冲突校验。
- 实现 exports 托管块预览。
- 实现 systemd unit 预览。
- 前端展示执行计划。

验收：

- 合法输入能生成计划。
- 危险路径被拒绝。
- 目标挂载点冲突被拒绝。
- 计划只生成不执行。

### P5：NFS 配置执行

目标：

- 在源节点安装和启用 NFS Server。
- 创建源目录。
- 备份并写入 exports 托管块。
- 执行 `exportfs -ra`。
- 在目标节点安装 NFS Client。
- 创建挂载点。
- 写入 systemd `.mount` / `.automount`。
- 启用并启动 automount。
- 执行挂载验证。

验收：

- 两台测试 VM 能完成一次共享创建。
- B 节点 `findmnt` 指向 A 的源目录。
- 读写模式下写入测试成功。
- 删除任务不会影响用户手写 exports。

### P6：执行日志与事件流

目标：

- 实现命令执行记录。
- 实现前端实时显示执行步骤。
- 实现失败中止和状态更新。

验收：

- 页面能看到每一步开始、成功、失败。
- 后端重启后历史执行结果仍可查看。
- 失败时 share 状态准确进入 `partial_failed` 或 `degraded`。

### P7：健康检查和运维操作

目标：

- 实现手动健康检查。
- 实现重新挂载。
- 实现禁用/恢复自动挂载。
- 实现删除托管配置。

验收：

- A 离线时检测结果能明确显示源节点不可达。
- B 重启后 automount 仍存在。
- 禁用后 automount 不再自动启动。
- 删除任务清理托管 exports 和 systemd 单元。

### P8：打包部署

目标：

- 提供生产启动方式。
- 提供 systemd service。
- 提供环境变量说明。
- 提供 SQLite 备份说明。

验收：

- 一条命令可以构建前后端。
- systemd service 可以启动 Web 服务。
- 首次初始化流程可用。
- 升级不会丢失 SQLite 数据。

### P9：端到端验收

目标：

- 准备两台 Linux 测试 VM。
- 完整走通创建、重启、断网、恢复、删除。
- 补齐 README。

验收：

- Ubuntu -> Ubuntu 通过。
- Rocky -> Rocky 通过。
- Ubuntu -> Rocky 至少完成只读共享。
- B 重启后访问挂载目录可触发 automount。
- A 临时离线时 B 启动不被长时间阻塞。

## 14. 测试策略

### 14.1 单元测试

覆盖：

- Zod 输入校验。
- 路径黑名单。
- CIDR/IP 校验。
- systemd unit 名称生成。
- exports 托管块生成和更新。
- mount options 生成。
- share 状态机。
- plan builder 风险识别。

### 14.2 集成测试

覆盖：

- SQLite migration。
- Auth/session。
- Nodes API。
- Shares API。
- Plan/apply 状态流。
- 命令执行记录。

SSH 和系统命令先用 fake executor 测试业务逻辑，再用真实 VM 做系统级验收。

### 14.3 端到端测试

覆盖：

- 初始化管理员。
- 添加节点。
- 探测节点。
- 创建共享向导。
- 查看执行计划。
- 执行共享。
- 查看共享详情。
- 删除共享。

前端 e2e 可以使用 Playwright。真实 NFS 端到端建议在 VM 中执行，不建议依赖普通 Docker 容器，因为 systemd、NFS kernel server 和 mount 权限在容器中限制较多。

### 14.4 手工验收矩阵

| 场景 | 期望 |
| --- | --- |
| A/B SSH 正常 | 节点探测成功 |
| B sudo 不可用 | 计划生成前提示阻断 |
| 源目录不存在 | 计划展示将创建目录 |
| 目标目录非空 | 阻断或要求明确确认 |
| 客户端规则为 `*` | V1 拒绝 |
| UID/GID 不一致 | 给出风险提示 |
| A 离线 | 健康检查显示源节点不可达 |
| B 重启 | automount 保留且可触发挂载 |
| 删除共享 | 清理托管配置，不影响手写配置 |

## 15. 安全要求

必须实现：

- 登录保护。
- 密码哈希保存。
- session cookie 安全属性。
- 所有输入白名单校验。
- 结构化命令执行，禁止拼接 shell。
- SSH 私钥加密或会话级使用。
- 命令日志脱敏。
- 危险操作二次确认。
- 审计日志。
- 远程配置修改前备份。
- 默认不监听公网地址，或文档明确提示风险。

危险操作：

- 修改 `/etc/exports`。
- 写入 systemd 单元。
- 执行 `systemctl daemon-reload`。
- 启动、重启、启用 NFS 服务。
- 修改防火墙。
- 挂载、卸载目录。
- 删除托管配置。

所有危险操作必须出现在执行计划里。

## 16. 错误分类

建议错误码：

| 错误码 | 含义 |
| --- | --- |
| `SSH_CONNECT_FAILED` | SSH 无法连接 |
| `SSH_AUTH_FAILED` | SSH 认证失败 |
| `SUDO_REQUIRED` | 需要 sudo 但不可用 |
| `UNSUPPORTED_OS` | 系统不支持 |
| `NFS_PACKAGE_MISSING` | NFS 包未安装 |
| `NFS_SERVICE_FAILED` | NFS 服务异常 |
| `FIREWALL_BLOCKED` | 防火墙可能阻断 |
| `INVALID_SOURCE_PATH` | 源目录非法 |
| `INVALID_TARGET_PATH` | 目标目录非法 |
| `TARGET_PATH_CONFLICT` | 目标挂载点冲突 |
| `EXPORTS_CONFLICT` | exports 配置冲突 |
| `SYSTEMD_UNAVAILABLE` | systemd 不可用 |
| `MOUNT_FAILED` | 挂载失败 |
| `WRITE_TEST_FAILED` | 写入测试失败 |
| `PLAN_EXPIRED` | 执行计划过期 |
| `LOCK_CONFLICT` | 有并发任务正在运行 |

错误展示要包含：

- 人类可读解释。
- 影响范围。
- 建议处理方式。
- 相关命令摘要。

## 17. 配置项

建议环境变量：

```text
LSM_HOST=127.0.0.1
LSM_PORT=18088
LSM_DATABASE_PATH=./data/linux-share-manager.sqlite
LSM_STATIC_ROOT=./dist/web
LSM_SECRET_KEY=
LSM_SESSION_COOKIE_NAME=lsm_session
LSM_SESSION_TTL_SECONDS=86400
LSM_SSH_CONNECT_TIMEOUT_MS=5000
LSM_COMMAND_TIMEOUT_MS=30000
LSM_LOG_LEVEL=info
LSM_TRUST_PROXY=false
```

生产部署时必须设置：

- `LSM_SECRET_KEY`
- 独立的 `LSM_DATABASE_PATH`
- 反向代理 HTTPS 或内网访问限制

## 18. 部署和升级

### 18.1 开发环境

目标命令：

```bash
bun install
bun run db:migrate
bun run dev
```

### 18.2 生产环境

交付物：

- 构建后的 Web 静态资源。
- Bun 后端服务。
- SQLite 数据目录。
- systemd service 文件。

systemd service 示例后续放入 `docs/deploy-systemd.md`。

### 18.3 数据备份

SQLite 备份：

- 停止服务后复制数据库文件，或使用 SQLite online backup。
- 升级前必须备份。
- migration 必须向前兼容，失败时停止启动。

### 18.4 卸载

卸载 Web 服务不应自动清理远端 NFS 配置。

如果要清理远端配置，必须通过每个 share 的删除流程完成，因为只有应用数据库知道哪些配置由本工具管理。

## 19. MVP 验收标准

MVP 完成必须满足：

1. 可以在一台管理机启动 Web 控制台。
2. 可以初始化管理员并登录。
3. 可以添加两台 Linux 节点。
4. 可以探测 SSH、sudo、OS、NFS、systemd、防火墙。
5. 可以创建 NFSv4.2 共享计划。
6. 可以展示完整执行计划和危险操作。
7. 确认后可以完成远程 NFS 配置。
8. 目标节点可以通过目标挂载点访问源目录。
9. B 节点重启后挂载能自动恢复或按需触发。
10. A 节点离线时 B 节点启动不长时间阻塞。
11. 页面能展示共享状态、命令日志、错误原因。
12. 删除任务只删除托管配置，不影响用户手写配置。
13. Ubuntu/Rocky 至少各完成一组端到端验收。

## 20. 后续版本预留

V2：

- 定时健康检查。
- 告警通知。
- 更细的故障诊断。
- 自动恢复策略可配置。

V3：

- SSHFS。
- Samba。
- 临时挂载任务。
- 只读共享模板。

V4：

- iSCSI 助手。
- DRBD 状态检测。
- Ceph/GlusterFS 方案引导。
- 多用户和 RBAC。

这些能力不应污染 V1 设计。V1 只保留清晰扩展点，不提前做复杂抽象。

## 21. 当前未决问题

这些问题不阻塞 V1 开发，但需要在实现到对应阶段前确认：

- 是否允许长期保存 SSH 私钥，还是只允许本机文件路径引用。
- sudo 密码是否完全不保存。
- 防火墙是否默认只提示，不自动修改。
- V1 是否必须支持 Debian 12 之外的 Debian 系版本。
- 生产部署是否要求提供 Docker 镜像。
- 是否需要内置 HTTPS，还是完全交给反向代理。

推荐默认答案：

- 私钥可加密保存，但必须要求 `LSM_SECRET_KEY`。
- sudo 密码不持久化。
- 防火墙默认提示，自动修改需要二次确认。
- 首批验收只锁 Ubuntu 22.04/24.04 和 Rocky 9。
- Docker 镜像放到 MVP 后。
- HTTPS 交给反向代理。
