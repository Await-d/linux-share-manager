import type { NodeProbeResponse } from "../../shared/schemas/nodes"
import { StatusBadge } from "../components/primitives"

export function ProbeDetail({ result }: { readonly result: NodeProbeResponse }) {
  return (
    <div className="probe-detail">
      <h4>探测结果</h4>
      <dl>
        <ProbeItem label="SSH 认证" ok={result.sshOk} />
        <ProbeItem label="sudo 权限" ok={result.sudoOk} detail={result.sudoError} />
        <ProbeItem label="systemd" ok={result.systemdOk} detail={result.systemdState} />
        <ProbeItem label="NFS Server" ok={result.nfsServerInstalled} />
        <ProbeItem label="NFS Client" ok={result.nfsClientInstalled} />
        {result.osPrettyName ? (
          <div className="probe-row">
            <dt>操作系统</dt>
            <dd>{result.osPrettyName}</dd>
          </div>
        ) : null}
        {result.firewallType ? (
          <div className="probe-row">
            <dt>防火墙</dt>
            <dd>
              {result.firewallType} ({result.firewallActive ? "运行中" : "未激活"})
            </dd>
          </div>
        ) : null}
        {result.primaryIp ? (
          <div className="probe-row">
            <dt>主 IP</dt>
            <dd>{result.primaryIp}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

function ProbeItem({
  label,
  ok,
  detail,
}: {
  readonly label: string
  readonly ok: boolean
  readonly detail?: string | null
}) {
  return (
    <div className="probe-row">
      <dt>
        <StatusBadge tone={ok ? "success" : "error"}>{ok ? "OK" : "FAIL"}</StatusBadge>
        {label}
      </dt>
      <dd>{detail ?? (ok ? "正常" : "不可用")}</dd>
    </div>
  )
}
