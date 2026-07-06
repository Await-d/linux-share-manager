import { ArrowRight, FolderOpen, Pencil, Plus, RefreshCw, Trash2, Wifi, X } from "lucide-react"
import type { FormEvent } from "react"
import { useMemo, useState } from "react"
import type { NodeResponse } from "../../shared/schemas/nodes"
import type {
  CreateShareRequest,
  ShareAccessMode,
  ShareResponse,
  ShareStatus,
  UpdateShareRequest,
} from "../../shared/schemas/shares"
import {
  checkInterconnectivity,
  createShare,
  deleteShare,
  errorMessage,
  updateShare,
} from "../api/client"
import { PathBrowser } from "../components/path-browser"
import { Button, Panel, SelectField, StatusBadge, TextField } from "../components/primitives"

const ACCESS_MODE_OPTIONS = [
  { value: "read_write", label: "读写" },
  { value: "read_only", label: "只读" },
] as const

const NFS_VERSION_OPTIONS = [
  { value: "4.2", label: "NFS 4.2" },
  { value: "4.1", label: "NFS 4.1" },
  { value: "4", label: "NFS 4" },
] as const

const STATUS_LABELS: Record<ShareStatus, string> = {
  draft: "草稿",
  applying: "应用中",
  active: "已生效",
  failed: "失败",
}

const STATUS_TONES: Record<ShareStatus, "success" | "warning" | "error" | "info" | "neutral"> = {
  draft: "neutral",
  applying: "info",
  active: "success",
  failed: "error",
}

type ShareDraft = {
  readonly name: string
  readonly sourceNodeId: string
  readonly sourcePath: string
  readonly targetNodeId: string
  readonly targetPath: string
  readonly accessMode: ShareAccessMode
  readonly nfsVersion: CreateShareRequest["nfsVersion"]
  readonly autoMount: boolean
}

type SharesPanelProps = {
  readonly nodes: readonly NodeResponse[]
  readonly shares: readonly ShareResponse[]
  readonly onCreated: (share: ShareResponse) => void
  readonly onDeleted: (id: string) => void
  readonly onUpdated: (share: ShareResponse) => void
}

export function SharesPanel({ nodes, shares, onCreated, onDeleted, onUpdated }: SharesPanelProps) {
  const [editingShareId, setEditingShareId] = useState<string | null>(null)
  const editingShare = useMemo(
    () => shares.find((share) => share.id === editingShareId) ?? null,
    [editingShareId, shares],
  )

  return (
    <>
      <Panel title="创建共享">
        <ShareForm
          editingShare={editingShare}
          key={editingShare?.id ?? "new-share"}
          nodes={nodes}
          onCreated={onCreated}
          onUpdated={(share) => {
            onUpdated(share)
            setEditingShareId(share.id)
          }}
          onCancelEdit={() => setEditingShareId(null)}
        />
      </Panel>

      <Panel title={`共享任务 (${shares.length})`}>
        <ShareList
          nodes={nodes}
          onDeleted={onDeleted}
          onEdit={(share) => setEditingShareId(share.id)}
          onStatusChange={onUpdated}
          shares={shares}
        />
      </Panel>
    </>
  )
}

type ShareFormProps = {
  readonly editingShare: ShareResponse | null
  readonly nodes: readonly NodeResponse[]
  readonly onCreated: (share: ShareResponse) => void
  readonly onUpdated: (share: ShareResponse) => void
  readonly onCancelEdit: () => void
}

function ShareForm({ editingShare, nodes, onCreated, onUpdated, onCancelEdit }: ShareFormProps) {
  const [draft, setDraft] = useState<ShareDraft>(() =>
    editingShare === null ? emptyShareDraft() : draftFromShare(editingShare),
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const sourceOptions = nodeOptions(nodes.filter(canShareFrom), "选择源节点")
  const targetOptions = nodeOptions(nodes.filter(canMountTo), "选择目标节点")
  const hasNodeChoices = sourceOptions.length > 1 && targetOptions.length > 1
  const editing = editingShare !== null
  const ready =
    hasNodeChoices &&
    draft.name.trim().length > 0 &&
    draft.sourceNodeId.length > 0 &&
    draft.targetNodeId.length > 0

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!ready) {
      setError("请填写共享名称并选择源节点和目标节点。")
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      if (editing) {
        const payload: UpdateShareRequest = {
          name: draft.name,
          sourcePath: draft.sourcePath,
          targetPath: draft.targetPath,
          accessMode: draft.accessMode,
          nfsVersion: draft.nfsVersion,
          autoMount: draft.autoMount,
        }
        const share = await updateShare(editingShare.id, payload)
        onUpdated(share)
      } else {
        const payload = sharePayload(draft)
        const share = await createShare(payload)
        onCreated(share)
        setDraft(emptyShareDraft())
      }
    } catch (caught) {
      setError(await errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="share-form" onSubmit={submit}>
      <div className="form-heading">
        <div>
          <h3>{editing ? "编辑共享" : "目录共享草稿"}</h3>
          <p>
            {editing
              ? "修改共享配置。源节点和目标节点不可更改。"
              : "选择源节点目录，再指定目标节点的挂载目录。"}
          </p>
        </div>
        {editing ? (
          <Button icon={X} onClick={onCancelEdit} variant="ghost">
            取消
          </Button>
        ) : null}
      </div>

      <TextField
        label="共享名称"
        name="name"
        onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
        value={draft.name}
      />
      <SelectField
        disabled={editing}
        label="源节点"
        name="sourceNodeId"
        onChange={(sourceNodeId) => setDraft({ ...draft, sourceNodeId })}
        options={sourceOptions}
        value={draft.sourceNodeId}
      />
      <PathBrowser
        label="源节点目录"
        name="sourcePath"
        nodeId={draft.sourceNodeId}
        onChange={(sourcePath) => setDraft({ ...draft, sourcePath })}
        placeholder="/data/share"
        value={draft.sourcePath}
      />
      <SelectField
        disabled={editing}
        label="目标节点"
        name="targetNodeId"
        onChange={(targetNodeId) => setDraft({ ...draft, targetNodeId })}
        options={targetOptions}
        value={draft.targetNodeId}
      />
      <PathBrowser
        label="目标挂载目录"
        name="targetPath"
        nodeId={draft.targetNodeId}
        onChange={(targetPath) => setDraft({ ...draft, targetPath })}
        placeholder="/mnt/share"
        value={draft.targetPath}
      />
      <SelectField
        label="访问模式"
        name="accessMode"
        onChange={(accessMode) => setDraft({ ...draft, accessMode })}
        options={ACCESS_MODE_OPTIONS}
        value={draft.accessMode}
      />
      <SelectField
        label="NFS 版本"
        name="nfsVersion"
        onChange={(nfsVersion) => setDraft({ ...draft, nfsVersion })}
        options={NFS_VERSION_OPTIONS}
        value={draft.nfsVersion}
      />
      <label className="toggle-field">
        <input
          checked={draft.autoMount}
          onChange={(event) => setDraft({ ...draft, autoMount: event.currentTarget.checked })}
          type="checkbox"
        />
        <span>在目标节点写入自动挂载配置</span>
      </label>

      {hasNodeChoices ? null : <p className="form-error">需要至少一个共享端和一个挂载端节点。</p>}
      {error === null ? null : <p className="form-error">{error}</p>}
      <Button disabled={submitting || !ready} icon={Plus} type="submit" variant="primary">
        {submitting ? (editing ? "保存中" : "创建中") : editing ? "保存修改" : "创建共享草稿"}
      </Button>
    </form>
  )
}

type ShareListProps = {
  readonly shares: readonly ShareResponse[]
  readonly nodes: readonly NodeResponse[]
  readonly onDeleted: (id: string) => void
  readonly onEdit: (share: ShareResponse) => void
  readonly onStatusChange: (share: ShareResponse) => void
}

function ShareList({ shares, nodes, onDeleted, onEdit, onStatusChange }: ShareListProps) {
  if (shares.length === 0) {
    return (
      <div className="empty-state">
        <FolderOpen size={28} strokeWidth={1.7} />
        <span>暂无共享任务</span>
      </div>
    )
  }

  return (
    <div className="share-list">
      {shares.map((share) => (
        <ShareRow
          key={share.id}
          nodes={nodes}
          onDeleted={onDeleted}
          onEdit={() => onEdit(share)}
          onStatusChange={onStatusChange}
          share={share}
        />
      ))}
    </div>
  )
}

type ShareRowProps = {
  readonly share: ShareResponse
  readonly nodes: readonly NodeResponse[]
  readonly onDeleted: (id: string) => void
  readonly onEdit: () => void
  readonly onStatusChange: (share: ShareResponse) => void
}

function ShareRow({ share, nodes, onDeleted, onEdit, onStatusChange }: ShareRowProps) {
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    setStatusError(null)
    try {
      await deleteShare(share.id)
      onDeleted(share.id)
    } catch (caught) {
      setStatusError(await errorMessage(caught))
      setConfirmingDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  async function cycleStatus(): Promise<void> {
    const next = nextStatus(share.status)
    if (next === null) {
      return
    }

    setStatusError(null)
    try {
      const updated = await updateShare(share.id, { status: next })
      onStatusChange(updated)
    } catch (caught) {
      setStatusError(await errorMessage(caught))
    }
  }

  return (
    <article className="share-row">
      <div className="share-row-main">
        <h3>{share.name}</h3>
        <div className="share-path">
          <span className="share-node">
            <code>{nodeName(nodes, share.sourceNodeId)}</code>
          </span>
          <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
          <span className="share-node">
            <code>{nodeName(nodes, share.targetNodeId)}</code>
          </span>
        </div>
        <div className="share-path share-path-detail">
          <code>{share.sourcePath}</code>
          <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
          <code>{share.targetPath}</code>
        </div>
      </div>

      <div className="share-row-side">
        <div className="share-meta">
          <StatusBadge tone="info">{share.nfsVersion}</StatusBadge>
          <StatusBadge tone={share.accessMode === "read_write" ? "success" : "neutral"}>
            {share.accessMode === "read_write" ? "读写" : "只读"}
          </StatusBadge>
          {share.autoMount ? <StatusBadge tone="neutral">自动挂载</StatusBadge> : null}
          <button
            className="share-status-toggle"
            disabled={nextStatus(share.status) === null || deleting}
            onClick={() => void cycleStatus()}
            title="推进状态"
            type="button"
          >
            <StatusBadge tone={STATUS_TONES[share.status]}>
              {STATUS_LABELS[share.status]}
            </StatusBadge>
          </button>
        </div>
        <div className="share-actions">
          <Button icon={Pencil} onClick={onEdit} variant="secondary">
            编辑
          </Button>
          {confirmingDelete ? (
            <>
              <Button
                disabled={deleting}
                icon={Trash2}
                onClick={() => void handleDelete()}
                variant="danger"
              >
                {deleting ? "删除中" : "确认删除"}
              </Button>
              <Button
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
                variant="ghost"
              >
                取消
              </Button>
            </>
          ) : (
            <Button icon={Trash2} onClick={() => setConfirmingDelete(true)} variant="danger">
              删除
            </Button>
          )}
        </div>
        {statusError === null ? null : <p className="form-error">{statusError}</p>}
      </div>
    </article>
  )
}

function emptyShareDraft(): ShareDraft {
  return {
    name: "",
    sourceNodeId: "",
    sourcePath: "/data/share",
    targetNodeId: "",
    targetPath: "/mnt/share",
    accessMode: "read_write",
    nfsVersion: "4.2",
    autoMount: true,
  }
}

function draftFromShare(share: ShareResponse): ShareDraft {
  return {
    name: share.name,
    sourceNodeId: share.sourceNodeId,
    sourcePath: share.sourcePath,
    targetNodeId: share.targetNodeId,
    targetPath: share.targetPath,
    accessMode: share.accessMode,
    nfsVersion: share.nfsVersion as CreateShareRequest["nfsVersion"],
    autoMount: share.autoMount,
  }
}

function sharePayload(draft: ShareDraft): CreateShareRequest {
  return {
    name: draft.name,
    sourceNodeId: draft.sourceNodeId,
    sourcePath: draft.sourcePath,
    targetNodeId: draft.targetNodeId,
    targetPath: draft.targetPath,
    accessMode: draft.accessMode,
    nfsVersion: draft.nfsVersion,
    autoMount: draft.autoMount,
  }
}

function nodeOptions(
  nodes: readonly NodeResponse[],
  placeholder: string,
): readonly { readonly value: string; readonly label: string }[] {
  return [
    { value: "", label: placeholder },
    ...nodes.map((node) => ({ value: node.id, label: `${node.name} · ${node.host}` })),
  ]
}

function nodeName(nodes: readonly NodeResponse[], id: string): string {
  return nodes.find((node) => node.id === id)?.name ?? id
}

function nextStatus(status: ShareStatus): ShareStatus | null {
  switch (status) {
    case "draft":
      return "applying"
    case "applying":
      return "active"
    case "active":
      return "draft"
    case "failed":
      return "draft"
    default:
      return null
  }
}

function canShareFrom(node: NodeResponse): boolean {
  switch (node.role) {
    case "source":
    case "both":
      return true
    case "target":
      return false
  }
}

function canMountTo(node: NodeResponse): boolean {
  switch (node.role) {
    case "target":
    case "both":
      return true
    case "source":
      return false
  }
}
