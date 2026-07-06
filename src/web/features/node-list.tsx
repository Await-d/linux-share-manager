import { Fingerprint, KeyRound, Pencil, Search, Server, ShieldCheck, Wifi } from "lucide-react"
import { useState } from "react"
import type { NodeResponse } from "../../shared/schemas/nodes"
import { errorMessage, probeNode, testNodeAuth, testNodeConnection } from "../api/client"
import { Button, StatusBadge } from "../components/primitives"

const ROLE_LABELS = {
  source: "共享端",
  target: "挂载端",
  both: "两者皆可",
} as const

const AUTH_LABELS = {
  private_key: "SSH 私钥",
  password_session: "SSH 密码",
} as const

const CREDENTIAL_LABELS = {
  missing: "未配置凭据",
  password_set: "密码已保存",
  private_key_set: "私钥已保存",
} as const

const PROBE_LABELS = {
  unknown: "未测试",
  ok: "端口可达",
  failed: "连接失败",
} as const

type StatusTone = "success" | "warning" | "error" | "info" | "neutral"

const PROBE_TONES = {
  unknown: "neutral",
  ok: "success",
  failed: "error",
} satisfies Record<NodeResponse["lastProbeStatus"], StatusTone>

type NodeListProps = {
  readonly nodes: readonly NodeResponse[]
  readonly editingNodeId: string | null
  readonly onEdit: (node: NodeResponse) => void
  readonly onTested: (node: NodeResponse) => void
}

export function NodeList({ nodes, editingNodeId, onEdit, onTested }: NodeListProps) {
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null)
  const [testError, setTestError] = useState<{
    readonly nodeId: string
    readonly message: string
  } | null>(null)
  const [probingNodeId, setProbingNodeId] = useState<string | null>(null)
  const [probeResult, setProbeResult] = useState<Record<string, unknown> | null>(null)

  async function testNode(node: NodeResponse): Promise<void> {
    setTestingNodeId(node.id)
    setTestError(null)
    try {
      const tested = await testNodeConnection(node.id)
      onTested(tested)
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught
      }
      setTestError({ nodeId: node.id, message: await errorMessage(caught) })
    } finally {
      setTestingNodeId(null)
    }
  }

  async function authTest(node: NodeResponse): Promise<void> {
    setTestingNodeId(node.id)
    setTestError(null)
    try {
      await testNodeAuth(node.id)
      const tested = await testNodeConnection(node.id)
      onTested(tested)
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught
      }
      setTestError({ nodeId: node.id, message: await errorMessage(caught) })
    } finally {
      setTestingNodeId(null)
    }
  }

  async function fullProbe(node: NodeResponse): Promise<void> {
    setProbingNodeId(node.id)
    setTestError(null)
    setProbeResult(null)
    try {
      const result = await probeNode(node.id)
      onTested(result.node)
      setProbeResult({ ...result.probe, nodeId: node.id })
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught
      }
      setTestError({ nodeId: node.id, message: await errorMessage(caught) })
    } finally {
      setProbingNodeId(null)
    }
  }

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        <Server size={28} strokeWidth={1.7} />
        <span>暂无节点</span>
      </div>
    )
  }

  return (
    <div className="node-list">
      {nodes.map((node) => (
        <div key={node.id}>
          <NodeRow
            errorMessage={testError?.nodeId === node.id ? testError.message : null}
            editing={editingNodeId === node.id}
            node={node}
            onEdit={() => onEdit(node)}
            onTest={() => void testNode(node)}
            onAuthTest={() => void authTest(node)}
            onProbe={() => void fullProbe(node)}
            probing={probingNodeId === node.id}
            testing={testingNodeId === node.id}
            testingDisabled={testingNodeId !== null || probingNodeId !== null}
          />
          {probeResult !== null && (probeResult as Record<string, unknown>).nodeId === node.id ? (
            <ProbeDetail result={probeResult as Record<string, unknown>} />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ProbeDetail({ result }: { readonly result: Record<string, unknown> }) {
  return (
    <div className="probe-detail">
      <h4>探测结果</h4>
      <dl>
        <ProbeItem label="SSH 认证" ok={result.sshOk as boolean} />
        <ProbeItem
          label="sudo 权限"
          ok={result.sudoOk as boolean}
          detail={result.sudoError as string | null}
        />
        <ProbeItem
          label="systemd"
          ok={result.systemdOk as boolean}
          detail={result.systemdState as string | null}
        />
        <ProbeItem label="NFS Server" ok={result.nfsServerInstalled as boolean} />
        <ProbeItem label="NFS Client" ok={result.nfsClientInstalled as boolean} />
        {result.osPrettyName ? (
          <div className="probe-row">
            <dt>操作系统</dt>
            <dd>{result.osPrettyName as string}</dd>
          </div>
        ) : null}
        {result.firewallType ? (
          <div className="probe-row">
            <dt>防火墙</dt>
            <dd>
              {result.firewallType as string} ({result.firewallActive ? "运行中" : "未激活"})
            </dd>
          </div>
        ) : null}
        {result.primaryIp ? (
          <div className="probe-row">
            <dt>主 IP</dt>
            <dd>{result.primaryIp as string}</dd>
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

function NodeRow({
  node,
  editing,
  errorMessage,
  onEdit,
  onTest,
  onAuthTest,
  onProbe,
  probing,
  testing,
  testingDisabled,
}: {
  readonly node: NodeResponse
  readonly editing: boolean
  readonly errorMessage: string | null
  readonly onEdit: () => void
  readonly onTest: () => void
  readonly onAuthTest: () => void
  readonly onProbe: () => void
  readonly probing: boolean
  readonly testing: boolean
  readonly testingDisabled: boolean
}) {
  const credentialText =
    node.credentialLabel === null
      ? CREDENTIAL_LABELS[node.credentialStatus]
      : `${CREDENTIAL_LABELS[node.credentialStatus]} · ${node.credentialLabel}`

  return (
    <article className={editing ? "node-row node-row-selected" : "node-row"}>
      <div className="node-main">
        <Server aria-hidden="true" size={18} strokeWidth={1.8} />
        <div>
          <h3>{node.name}</h3>
          <code>{node.host}</code>
        </div>
      </div>
      <div className="node-meta">
        <span>{node.username}</span>
        <span>:{node.port}</span>
        <StatusBadge tone="neutral">{ROLE_LABELS[node.role]}</StatusBadge>
        <StatusBadge tone={testing ? "info" : PROBE_TONES[node.lastProbeStatus]}>
          <Wifi size={12} strokeWidth={1.8} />
          {testing ? "检测中" : PROBE_LABELS[node.lastProbeStatus]}
        </StatusBadge>
        <StatusBadge tone="info">
          <ShieldCheck size={12} strokeWidth={1.8} />
          {AUTH_LABELS[node.authType]}
        </StatusBadge>
        <StatusBadge tone={node.credentialStatus === "missing" ? "warning" : "success"}>
          <KeyRound size={12} strokeWidth={1.8} />
          {credentialText}
        </StatusBadge>
        <Button icon={Pencil} onClick={onEdit} variant={editing ? "primary" : "secondary"}>
          编辑
        </Button>
        <Button disabled={testingDisabled} icon={Wifi} onClick={onTest} variant="secondary">
          {testing ? "TCP" : "TCP"}
        </Button>
        <Button
          disabled={testingDisabled}
          icon={Fingerprint}
          onClick={onAuthTest}
          variant="secondary"
        >
          {testing ? "认证" : "认证"}
        </Button>
        <Button disabled={testingDisabled} icon={Search} onClick={onProbe} variant="primary">
          {probing ? "探测中" : "完整探测"}
        </Button>
      </div>
      {errorMessage === null ? null : <p className="node-test-message">{errorMessage}</p>}
    </article>
  )
}
