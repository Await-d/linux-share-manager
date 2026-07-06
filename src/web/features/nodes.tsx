import { Plus, Server, ShieldCheck } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import type { CreateNodeRequest, NodeResponse } from "../../shared/schemas/nodes"
import { createNode, errorMessage } from "../api/client"
import { Button, Panel, SelectField, StatusBadge, TextField } from "../components/primitives"

const ROLE_OPTIONS = [
  { value: "source", label: "共享端" },
  { value: "target", label: "挂载端" },
  { value: "both", label: "两者皆可" },
] as const

const AUTH_OPTIONS = [
  { value: "private_key", label: "SSH 私钥" },
  { value: "password_session", label: "一次性密码" },
] as const

type NodesPanelProps = {
  readonly nodes: readonly NodeResponse[]
  readonly onCreated: (node: NodeResponse) => void
}

export function NodesPanel({ nodes, onCreated }: NodesPanelProps) {
  const [draft, setDraft] = useState<CreateNodeRequest>({
    name: "",
    host: "",
    port: 22,
    username: "root",
    authType: "private_key",
    role: "source",
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const node = await createNode(draft)
      onCreated(node)
      setDraft({ ...draft, name: "", host: "" })
    } catch (caught) {
      setError(await errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel title="节点">
      <form className="node-form" onSubmit={submit}>
        <TextField
          label="节点名称"
          name="name"
          onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
          value={draft.name}
        />
        <TextField
          label="主机地址"
          name="host"
          onChange={(event) => setDraft({ ...draft, host: event.currentTarget.value })}
          value={draft.host}
        />
        <TextField
          label="SSH 端口"
          name="port"
          onChange={(event) => setDraft({ ...draft, port: Number(event.currentTarget.value) })}
          type="number"
          value={draft.port}
        />
        <TextField
          label="用户名"
          name="username"
          onChange={(event) => setDraft({ ...draft, username: event.currentTarget.value })}
          value={draft.username}
        />
        <SelectField
          label="认证方式"
          name="authType"
          onChange={(authType) => setDraft({ ...draft, authType })}
          options={AUTH_OPTIONS}
          value={draft.authType}
        />
        <SelectField
          label="角色"
          name="role"
          onChange={(role) => setDraft({ ...draft, role })}
          options={ROLE_OPTIONS}
          value={draft.role}
        />
        {error === null ? null : <p className="form-error">{error}</p>}
        <Button disabled={submitting} icon={Plus} type="submit" variant="primary">
          {submitting ? "添加中" : "添加节点"}
        </Button>
      </form>

      <div className="node-list">
        {nodes.length === 0 ? (
          <div className="empty-state">
            <Server size={28} strokeWidth={1.7} />
            <span>暂无节点</span>
          </div>
        ) : (
          nodes.map((node) => <NodeRow key={node.id} node={node} />)
        )}
      </div>
    </Panel>
  )
}

function NodeRow({ node }: { readonly node: NodeResponse }) {
  return (
    <article className="node-row">
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
        <StatusBadge tone="neutral">{node.role}</StatusBadge>
        <StatusBadge tone="info">
          <ShieldCheck size={12} strokeWidth={1.8} />
          {node.authType}
        </StatusBadge>
      </div>
    </article>
  )
}
