import { FileKey, Plus, Save, X } from "lucide-react"
import type { ChangeEvent, FormEvent } from "react"
import { useState } from "react"
import type { CreateNodeRequest, NodeResponse } from "../../shared/schemas/nodes"
import { createNode, errorMessage, updateNode } from "../api/client"
import { Button, SelectField, TextAreaField, TextField } from "../components/primitives"

const ROLE_OPTIONS = [
  { value: "source", label: "共享端" },
  { value: "target", label: "挂载端" },
  { value: "both", label: "两者皆可" },
] as const

const AUTH_OPTIONS = [
  { value: "private_key", label: "SSH 私钥" },
  { value: "password_session", label: "SSH 密码" },
] as const

type NodeDraft = {
  readonly name: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authType: CreateNodeRequest["authType"]
  readonly role: CreateNodeRequest["role"]
  readonly password: string
  readonly privateKey: string
  readonly privateKeyName: string
}

type NodeFormProps = {
  readonly editingNode: NodeResponse | null
  readonly onCancelEdit: () => void
  readonly onSaved: (node: NodeResponse) => void
}

export function NodeForm({ editingNode, onCancelEdit, onSaved }: NodeFormProps) {
  const [draft, setDraft] = useState<NodeDraft>(() => draftFromNode(editingNode))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const payload = nodePayload(draft)
      const saved =
        editingNode === null ? await createNode(payload) : await updateNode(editingNode.id, payload)
      onSaved(saved)
      if (editingNode === null) {
        setDraft(draftFromNode(null))
      }
    } catch (caught) {
      setError(await errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function privateKeyFileChanged(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.item(0)
    if (file === null || file === undefined) {
      return
    }

    const privateKey = await file.text()
    setDraft((current) => ({ ...current, privateKey, privateKeyName: file.name }))
  }

  const editing = editingNode !== null

  return (
    <form className="node-form" onSubmit={submit}>
      <div className="form-heading">
        <div>
          <h3>{editing ? "编辑节点" : "添加节点"}</h3>
          <p>SSH 密码和私钥只用于后续连接，不会在保存后回显。</p>
        </div>
        {editing ? (
          <Button icon={X} onClick={onCancelEdit} variant="ghost">
            取消
          </Button>
        ) : null}
      </div>

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

      <CredentialFields
        draft={draft}
        editing={editing}
        onFileChanged={privateKeyFileChanged}
        onDraftChanged={setDraft}
      />

      {error === null ? null : <p className="form-error">{error}</p>}
      <Button disabled={submitting} icon={editing ? Save : Plus} type="submit" variant="primary">
        {submitting ? "保存中" : editing ? "保存节点" : "添加节点"}
      </Button>
    </form>
  )
}

function CredentialFields({
  draft,
  editing,
  onDraftChanged,
  onFileChanged,
}: {
  readonly draft: NodeDraft
  readonly editing: boolean
  readonly onDraftChanged: (draft: NodeDraft) => void
  readonly onFileChanged: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
}) {
  switch (draft.authType) {
    case "password_session":
      return (
        <div className="credential-panel">
          <TextField
            autoComplete="new-password"
            label="SSH 密码"
            name="password"
            onChange={(event) => onDraftChanged({ ...draft, password: event.currentTarget.value })}
            placeholder={editing ? "留空则保留当前保存状态" : "输入 SSH 登录密码"}
            type="password"
            value={draft.password}
          />
        </div>
      )
    case "private_key":
      return (
        <div className="credential-panel">
          <TextField
            label="私钥名称"
            name="privateKeyName"
            onChange={(event) =>
              onDraftChanged({ ...draft, privateKeyName: event.currentTarget.value })
            }
            placeholder="例如 deploy_ed25519"
            value={draft.privateKeyName}
          />
          <TextAreaField
            label="SSH 私钥内容"
            name="privateKey"
            onChange={(event) =>
              onDraftChanged({ ...draft, privateKey: event.currentTarget.value })
            }
            placeholder={editing ? "留空则保留当前保存状态" : "粘贴 OpenSSH 私钥"}
            value={draft.privateKey}
          />
          <label className="field-file">
            <span className="field-label">
              <FileKey size={14} strokeWidth={1.8} />
              上传私钥文件
            </span>
            <input onChange={(event) => void onFileChanged(event)} type="file" />
            <span className="field-hint">选择文件后会填入私钥内容和文件名。</span>
          </label>
        </div>
      )
  }
}

function draftFromNode(node: NodeResponse | null): NodeDraft {
  return {
    name: node?.name ?? "",
    host: node?.host ?? "",
    port: node?.port ?? 22,
    username: node?.username ?? "root",
    authType: node?.authType ?? "private_key",
    role: node?.role ?? "source",
    password: "",
    privateKey: "",
    privateKeyName: node?.credentialLabel ?? "",
  }
}

function nodePayload(draft: NodeDraft): CreateNodeRequest {
  const payload: CreateNodeRequest = {
    name: draft.name,
    host: draft.host,
    port: draft.port,
    username: draft.username,
    authType: draft.authType,
    role: draft.role,
  }

  if (draft.password.length > 0) {
    payload.password = draft.password
  }
  if (draft.privateKey.length > 0) {
    payload.privateKey = draft.privateKey
  }
  if (draft.privateKeyName.length > 0) {
    payload.privateKeyName = draft.privateKeyName
  }

  return payload
}
