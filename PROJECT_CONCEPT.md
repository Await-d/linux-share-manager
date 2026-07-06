# Linux Share Manager 项目构思

## 1. 项目定位

Linux Share Manager 是一个通过网页完成两台 Linux 服务器目录共享配置的工具。

目标是让不会手动配置 NFS、systemd、fstab、防火墙和 SSH 命令的人，也能通过浏览器完成：

- A 服务器把某个目录共享出来。
- B 服务器把 A 的共享目录挂载成本地目录。
- 重启后自动恢复挂载。
- 网络异常断开后自动重连。
- 在网页里查看共享、挂载、连通性和错误状态。

第一版建议只做 **NFS 目录共享**，不做“同一块硬盘块设备同时给两台机器读写”。后者需要集群文件系统或专门存储方案，风险明显更高，容易损坏数据。

## 2. 核心使用场景

### 场景一：实施人员远程调整预览目录

A 服务器运行网站或预览服务：

```text
/data/www/project
```

B 服务器通过网页把这个目录挂载到：

```text
/mnt/project
```

之后用户在 B 上编辑 `/mnt/project` 里的文件，实际文件保存在 A 的硬盘里。A 上的 Web 服务刷新后可以直接看到变化。

### 场景二：多台服务器共享资源目录

A 服务器保存公共文件：

```text
/data/share
```

B、C、D 多台服务器挂载：

```text
/mnt/share
```

适合放静态资源、安装包、导出文件、预览文件、脚本、非高频写入的项目目录。

### 场景三：服务器重启后自动恢复

工具在 B 服务器上写入 systemd mount/automount 配置，或者维护 `/etc/fstab` 配置，使机器重启后自动挂载。

如果 A 服务器临时不可达，B 不应该长时间卡死启动流程，应使用 `_netdev`、`nofail`、`x-systemd.automount`、`timeo`、`retrans` 等参数降低风险。

## 3. 不建议支持的场景

第一版明确不建议支持：

- MySQL、PostgreSQL、Redis 等数据库数据目录放到 NFS 上。
- Docker 核心 volume 直接放到 NFS 上。
- 两台服务器同时高频写同一批文件。
- 把同一个 ext4/xfs 块设备同时挂载到两台服务器。
- 用这个工具替代 Ceph、GlusterFS、DRBD、iSCSI 集群方案。

这些场景不是完全不能做，但需要更专业的存储设计，不能用“点几下网页”草率处理。

## 4. 推荐技术路线

### 共享协议

第一阶段只支持 NFS：

- Linux 到 Linux 最常见。
- 性能比 SSHFS 更适合作为共享目录。
- 配置可控，适合自动化。
- 能配合 systemd 做自动挂载和异常恢复。

后续可以扩展：

- SSHFS：简单、安全，适合轻量临时挂载。
- Samba：需要 Windows 访问时再加。
- iSCSI：只作为高级模式，默认隐藏。

### 控制方式

网页服务运行在管理机或其中一台服务器上，通过 SSH 控制 A 和 B：

```text
浏览器
  |
  v
Linux Share Manager Web 服务
  |
  +-- SSH 到 A：安装 NFS Server、创建共享目录、写 /etc/exports
  |
  +-- SSH 到 B：安装 NFS Client、创建挂载点、写 systemd/fstab、执行 mount
```

用户在网页中填写：

- A 服务器 SSH 地址、端口、用户名、认证方式。
- B 服务器 SSH 地址、端口、用户名、认证方式。
- A 上要共享的源目录。
- B 上要挂载到的目标目录。
- 读写模式：只读或读写。
- 允许访问的客户端 IP 或网段。
- 是否开机自动挂载。
- 是否启用自动重连。

## 5. 功能模块设计

### 5.1 节点管理

节点就是一台 Linux 服务器。

字段：

- 节点名称
- 主机地址
- SSH 端口
- 用户名
- 认证方式
- 操作系统类型
- 内网 IP
- 角色：共享端、挂载端、两者皆可

节点检测能力：

- SSH 是否可连接
- 当前用户是否有 sudo 权限
- 是否安装 NFS 相关包
- 防火墙状态
- systemd 是否可用
- 当前机器 IP 列表
- 磁盘空间

### 5.2 共享任务

一个共享任务描述“A 的目录挂载到 B 的目录”。

字段：

- 任务名称
- 源节点
- 源目录
- 目标节点
- 目标挂载目录
- 协议：第一版固定为 NFS
- 权限：只读或读写
- NFS 版本：默认 4.2，兼容模式可选 4 或 3
- 自动挂载：启用或关闭
- 自动恢复：启用或关闭
- 状态：未配置、配置中、正常、异常、已断开

### 5.3 配置执行器

配置执行器负责把网页配置转换成远程命令。

在 A 上执行：

- 检查并安装 NFS Server。
- 创建源目录。
- 生成 `/etc/exports` 配置。
- 执行 `exportfs -ra`。
- 启动并启用 NFS 服务。
- 放通防火墙端口。

在 B 上执行：

- 检查并安装 NFS Client。
- 创建挂载目录。
- 测试 `showmount` 或 NFS 连通性。
- 执行临时挂载测试。
- 写入 systemd mount/automount 或 `/etc/fstab`。
- 启动自动挂载。
- 验证读写。

### 5.4 状态监控

网页需要展示：

- A 是否在线。
- B 是否在线。
- NFS 服务是否运行。
- B 是否已挂载。
- 挂载目录是否可读写。
- 延迟与最近检测时间。
- 最近错误日志。

检测命令示例：

```bash
mountpoint /mnt/project
findmnt /mnt/project
df -h /mnt/project
touch /mnt/project/.lsm-write-test
```

写入测试需要谨慎，只在用户授权或配置任务时执行。

### 5.5 自动重连

自动重连建议用 systemd，而不是让 Web 服务一直死循环执行 mount。

推荐方式：

- 使用 systemd `.mount` 单元定义挂载。
- 使用 systemd `.automount` 单元按需触发挂载。
- 设置 `nofail` 避免开机卡死。
- 设置合理的超时和重试。
- 可选：增加健康检查 timer，发现异常后执行 `systemctl restart xxx.automount`。

示例思路：

```text
/etc/systemd/system/mnt-project.mount
/etc/systemd/system/mnt-project.automount
/etc/systemd/system/linux-share-manager-health.timer
/etc/systemd/system/linux-share-manager-health.service
```

## 6. 安全边界

这个工具会远程执行高权限系统命令，所以安全比界面更重要。

第一版必须做到：

- Web 登录后才能使用。
- 不能把 SSH 密码明文存数据库。
- 推荐 SSH 密钥认证。
- 私钥需要加密保存，或者只保存在本机文件系统并设置严格权限。
- 所有用户输入必须做白名单校验。
- 目录路径不能允许注入 shell 命令。
- 远程命令不能直接拼接用户原始输入。
- 所有操作要有审计日志。
- 删除、覆盖系统配置前必须先备份。
- 每次变更都要能显示“将会执行什么”。

危险操作需要二次确认：

- 修改 `/etc/exports`
- 修改 `/etc/fstab`
- 写入 systemd 单元
- 重启 NFS 服务
- 卸载目录
- 删除共享任务

## 7. 输入校验原则

服务器地址：

- 允许 IP、域名。
- 禁止包含空格、分号、反引号、管道符等 shell 特殊字符。

路径：

- 必须是绝对路径。
- 禁止为空。
- 禁止 `/` 作为共享源目录。
- 禁止系统关键路径作为目标挂载点，例如 `/bin`、`/etc`、`/usr`、`/var/lib/mysql`。
- 路径只允许常规字符：字母、数字、下划线、横线、点、斜杠。

网段：

- 支持单 IP，例如 `192.168.1.20`。
- 支持 CIDR，例如 `192.168.1.0/24`。
- 不建议默认开放 `*`。

## 8. 页面设计构思

第一版页面不做复杂营销页，直接进入控制台。

### 页面一：仪表盘

展示：

- 节点数量
- 正常共享数量
- 异常挂载数量
- 最近操作
- 最近错误
- 快速创建共享按钮

### 页面二：节点列表

功能：

- 添加服务器
- 测试 SSH
- 检查 sudo
- 检查 NFS 环境
- 查看节点状态

### 页面三：创建共享向导

分步骤：

1. 选择源服务器 A。
2. 填写源目录。
3. 选择目标服务器 B。
4. 填写挂载目录。
5. 选择权限和自动恢复策略。
6. 预检查。
7. 展示执行计划。
8. 用户确认后执行。

### 页面四：共享详情

展示：

- 当前状态
- 源目录
- 目标挂载点
- 挂载参数
- systemd 单元状态
- 最近健康检查
- 操作日志

操作：

- 重新检测
- 重新挂载
- 暂停自动挂载
- 恢复自动挂载
- 卸载
- 删除配置

### 页面五：操作日志

展示每次操作：

- 操作人
- 操作时间
- 操作对象
- 执行步骤
- 成功或失败
- 错误信息

## 9. 后端 API 构思

建议接口：

```text
POST /api/auth/login
POST /api/nodes
GET  /api/nodes
POST /api/nodes/:id/probe
POST /api/shares/plan
POST /api/shares/apply
GET  /api/shares
GET  /api/shares/:id
POST /api/shares/:id/check
POST /api/shares/:id/remount
POST /api/shares/:id/disable
POST /api/shares/:id/enable
DELETE /api/shares/:id
GET  /api/audit-logs
```

`plan` 接口只生成计划，不执行命令。

`apply` 接口必须基于已生成计划执行，执行前要求用户确认。

## 10. 数据模型构思

### nodes

```text
id
name
host
port
username
auth_type
encrypted_secret_ref
os_family
created_at
updated_at
last_probe_at
last_probe_status
```

### shares

```text
id
name
source_node_id
source_path
target_node_id
target_path
protocol
permission_mode
client_allow_rule
auto_mount_enabled
auto_recover_enabled
status
created_at
updated_at
last_check_at
last_error
```

### audit_logs

```text
id
actor
action
target_type
target_id
status
summary
created_at
```

### command_runs

```text
id
share_id
node_id
step_name
command_preview
status
stdout_excerpt
stderr_excerpt
started_at
finished_at
```

## 11. MVP 范围

第一版建议只做这些：

- 单用户登录。
- 添加两台 Linux 服务器。
- SSH 连通性检测。
- NFS Server/Client 环境检测。
- 创建一个 NFS 共享任务。
- 自动安装 NFS 依赖。
- 自动写 `/etc/exports`。
- 自动在 B 上挂载。
- 支持开机自动挂载。
- 支持状态检测。
- 支持重新挂载。
- 支持审计日志。

不做：

- 多租户。
- 复杂权限系统。
- 集群存储。
- Windows/Samba。
- SSHFS。
- 数据库目录迁移。
- 可视化文件管理器。

## 12. 后续版本规划

### V1：NFS 自动配置

完成最小可用闭环。

### V2：自愈与告警

增加：

- 定时健康检查。
- 异常自动重启 automount。
- 企业微信、钉钉、邮件通知。
- 失败原因诊断。

### V3：多协议

增加：

- SSHFS。
- Samba。
- 只读共享模板。
- 临时挂载任务。

### V4：高级存储

只面向高级用户开放：

- iSCSI 配置助手。
- DRBD 状态检测。
- Ceph/GlusterFS 方案引导。

## 13. 关键风险

### 权限风险

工具需要 sudo 权限，一旦被未授权访问，攻击者可以控制服务器配置。

应对：

- 强制登录。
- 限制管理页面只监听内网或本机。
- 支持反向代理加 HTTPS。
- 所有危险操作二次确认。

### 数据风险

用户可能把数据库目录或关键系统目录共享出去。

应对：

- 路径黑名单。
- 风险提示。
- 默认禁止关键路径。

### 网络风险

A 服务器离线时，B 的挂载可能卡住。

应对：

- 使用 systemd automount。
- 设置超时。
- 设置 `nofail`。
- 健康检查时避免长时间阻塞。

### 配置覆盖风险

手动编辑过的 `/etc/exports` 或 `/etc/fstab` 可能被工具覆盖。

应对：

- 使用带标记的托管配置块。
- 修改前备份。
- 只管理自己创建的配置段。
- 展示 diff 后再执行。

## 14. 建议技术栈

### 后端

- TypeScript
- Bun
- Hono
- Zod
- SQLite
- SSH2 客户端库
- pino 日志

### 前端

- Vite
- 原生 TypeScript 或 React
- 深色运维控制台风格
- 表单向导
- 状态看板

### 系统集成

- NFS
- systemd mount/automount
- systemd timer
- firewalld 或 ufw 检测

## 15. 第一版执行流程草图

```text
用户添加 A 节点
  -> 测试 SSH
  -> 检查 sudo
  -> 检查系统类型

用户添加 B 节点
  -> 测试 SSH
  -> 检查 sudo
  -> 检查系统类型

用户创建共享
  -> 填写 A:/data/share
  -> 填写 B:/mnt/share
  -> 选择读写权限
  -> 开启自动挂载

系统生成执行计划
  -> A: 安装 nfs-server
  -> A: 创建目录
  -> A: 写 exports 托管块
  -> A: exportfs -ra
  -> A: 启动 nfs-server
  -> B: 安装 nfs client
  -> B: 创建挂载点
  -> B: 测试挂载
  -> B: 写 systemd mount/automount
  -> B: 启用 automount

用户确认执行
  -> 后端逐步执行
  -> 网页实时显示日志
  -> 成功后进入共享详情页
```

## 16. 项目命名建议

候选：

- Linux Share Manager
- NFS Bridge
- MountPilot
- ShareOps
- NetMount Console

当前项目目录暂定为：

```text
linux-share-manager
```

## 17. 一句话总结

这个项目不是“把硬盘随便共享出去”的工具，而是一个通过 SSH 安全编排 NFS 配置、自动挂载和异常恢复的网页控制台。
