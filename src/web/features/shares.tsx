import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderOpen,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
  Wifi,
  X,
} from "lucide-react"
import type { FormEvent as ReactFormEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import type { InterconnectivityResponse } from "../../shared/schemas/connectivity"
import type { NodeResponse } from "../../shared/schemas/nodes"
import type {
  CreateShareRequest,
  PlanResponse,
  ShareAccessMode,
  ShareResponse,
  ShareStatus,
  UpdateShareRequest,
} from "../../shared/schemas/shares"
import {
  applySharePlan,
  checkInterconnectivity,
  checkShareHealth,
  createShare,
  deleteShare,
  disableShare,
  enableShare,
  errorMessage,
  generateSharePlan,
  getSharePlan,
  remountShare,
  updateShare,
} from "../api/client"
import { PathBrowser } from "../components/path-browser"
import { Button, Panel, SelectField, StatusBadge, TextField } from "../components/primitives"
import { formatApplyHealthMessage, shareStatusFromHealth } from "./share-health"

const ACCESS_MODE_OPTIONS = [
  { value: "read_write", label: "读写" },
  { value: "read_only", label: "只读" },
] as const

const NFS_VERSION_OPTIONS = [
  { value: "auto", label: "自动识别" },
  { value: "4.2", label: "NFS 4.2" },
  { value: "4.1", label: "NFS 4.1" },
  { value: "4", label: "NFS 4" },
  { value: "3", label: "NFS 3" },
] as const

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  planned: "已计划",
  applying: "应用中",
  active: "已生效",
  degraded: "降级",
  partial_failed: "部分失败",
  disabled: "已禁用",
  unmounted: "已卸载",
  deleting: "删除中",
  deleted: "已删除",
  failed: "失败",
}

const STATUS_TONES: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  draft: "neutral",
  planned: "info",
  applying: "info",
  active: "success",
  degraded: "warning",
  partial_failed: "error",
  disabled: "warning",
  unmounted: "neutral",
  deleting: "info",
  deleted: "neutral",
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

const PROBE_LABELS: Record<string, string> = {
  unknown: "未测试",
  ok: "端口可达",
  failed: "连接失败",
}

const PROBE_TONES: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  unknown: "warning",
  ok: "success",
  failed: "error",
}

function ShareForm({ editingShare, nodes, onCreated, onUpdated, onCancelEdit }: ShareFormProps) {
  const [draft, setDraft] = useState<ShareDraft>(() =>
    editingShare === null ? emptyShareDraft() : draftFromShare(editingShare),
  )
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [interconnectSummary, setInterconnectSummary] = useState<string | null>(null)
  const [interconnectTone, setInterconnectTone] = useState<
    "success" | "warning" | "error" | "info" | "neutral"
  >("neutral")
  const [checkingInterconnect, setCheckingInterconnect] = useState(false)

  const sourceOptions = nodeOptions(nodes.filter(canShareFrom), "选择源节点")
  const targetOptions = nodeOptions(nodes.filter(canMountTo), "选择目标节点")
  const hasNodeChoices = sourceOptions.length > 1 && targetOptions.length > 1
  const editing = editingShare !== null

  const sourceNode = nodes.find((node) => node.id === draft.sourceNodeId) ?? null
  const targetNode = nodes.find((node) => node.id === draft.targetNodeId) ?? null

  const bothSelected = sourceNode !== null && targetNode !== null

  const ready =
    hasNodeChoices &&
    draft.name.trim().length > 0 &&
    draft.sourceNodeId.length > 0 &&
    draft.targetNodeId.length > 0

  async function handleCheckInterconnect(): Promise<void> {
    if (!bothSelected) {
      return
    }

    setCheckingInterconnect(true)
    setInterconnectSummary(null)

    try {
      const result = await checkInterconnectivity(sourceNode.id, targetNode.id, {
        sourcePath: draft.sourcePath,
        targetPath: draft.targetPath,
      })
      setInterconnectSummary(result.summary)
      const allOk = result.source.reachable === "ok" && result.target.reachable === "ok"
      setInterconnectTone(
        allOk && result.crossReachable === "ok" ? "success" : allOk ? "warning" : "error",
      )
    } catch (caught) {
      setInterconnectSummary(await errorMessage(caught))
      setInterconnectTone("error")
    } finally {
      setCheckingInterconnect(false)
    }
  }

  async function submit(event: ReactFormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!ready) {
      setError("请填写共享名称并选择源节点和目标节点。")
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccessMessage(null)

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
        setSuccessMessage(`共享「${share.name}」已更新`)
      } else {
        const payload = sharePayload(draft)
        const share = await createShare(payload)
        onCreated(share)
        setDraft(emptyShareDraft())
        setInterconnectSummary(null)
        setSuccessMessage(`共享「${share.name}」已创建，状态: 草稿`)
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
        onChange={(sourceNodeId) => {
          setDraft({ ...draft, sourceNodeId })
          setInterconnectSummary(null)
        }}
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
        onChange={(targetNodeId) => {
          setDraft({ ...draft, targetNodeId })
          setInterconnectSummary(null)
        }}
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

      {bothSelected ? (
        <div className="interconnect-panel">
          <div className="interconnect-header">
            <span className="field-label">节点互通状态</span>
            <Button
              disabled={checkingInterconnect}
              icon={RefreshCw}
              onClick={handleCheckInterconnect}
              type="button"
              variant="secondary"
            >
              {checkingInterconnect ? "检测中" : "检测互通"}
            </Button>
          </div>
          <div className="interconnect-nodes">
            <StatusBadge tone={PROBE_TONES[sourceNode.lastProbeStatus] ?? "neutral"}>
              <Wifi size={12} strokeWidth={1.8} />
              {sourceNode.name} · {PROBE_LABELS[sourceNode.lastProbeStatus] ?? "未知"}
            </StatusBadge>
            <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
            <StatusBadge tone={PROBE_TONES[targetNode.lastProbeStatus] ?? "neutral"}>
              <Wifi size={12} strokeWidth={1.8} />
              {targetNode.name} · {PROBE_LABELS[targetNode.lastProbeStatus] ?? "未知"}
            </StatusBadge>
          </div>
          {interconnectSummary === null ? (
            <p className="field-hint">点击「检测互通」验证两个节点之间的 NFS 网络连通性。</p>
          ) : (
            <StatusBadge tone={interconnectTone}>{interconnectSummary}</StatusBadge>
          )}
        </div>
      ) : null}

      {hasNodeChoices ? null : <p className="form-error">需要至少一个共享端和一个挂载端节点。</p>}
      {error === null ? null : <p className="form-error">{error}</p>}
      {successMessage === null ? null : <p className="form-success">{successMessage}</p>}
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
  const [statusInfo, setStatusInfo] = useState<string | null>(null)
  const [planView, setPlanView] = useState<PlanResponse | null>(null)
  const [showFailureDetails, setShowFailureDetails] = useState(false)
  const [preCheckResult, setPreCheckResult] = useState<string | null>(null)
  const [preCheckTone, setPreCheckTone] = useState<
    "success" | "warning" | "error" | "info" | "neutral"
  >("neutral")
  const [healthResult, setHealthResult] = useState<string | null>(null)
  const [interconnectResult, setInterconnectResult] = useState<InterconnectivityResponse | null>(
    null,
  )
  const [operating, setOperating] = useState(false)

  useEffect(() => {
    if (share.status !== "partial_failed" && share.status !== "applying") {
      setPlanView(null)
      return
    }

    let cancelled = false
    async function loadLatestPlan(): Promise<void> {
      try {
        const { plan } = await getSharePlan(share.id)
        if (!cancelled) {
          setPlanView(plan)
        }
      } catch {
        // Ignore load errors; the user can still retry or check health.
      }
    }
    void loadLatestPlan()
    return () => {
      cancelled = true
    }
  }, [share.id, share.status])

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

  async function handleGeneratePlan(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    setPreCheckResult(null)
    setPlanView(null)
    setShowFailureDetails(false)
    try {
      const result = await generateSharePlan(share.id)
      setPlanView(result.plan)
      if (result.preCheck) {
        setPreCheckResult(result.preCheck.summary)
        setPreCheckTone(
          result.preCheck.passed
            ? result.preCheck.warnings.length > 0
              ? "warning"
              : "success"
            : "error",
        )
      }
      onStatusChange({ ...share, status: "planned" as ShareStatus })
    } catch (caught) {
      setStatusError(await errorMessage(caught))
    } finally {
      setOperating(false)
    }
  }

  async function handleApplyPlan(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    setPlanView(null)
    setShowFailureDetails(false)
    try {
      const planResult = await getSharePlan(share.id)
      const result = await applySharePlan(share.id, planResult.plan.id)
      const mergedPlan: PlanResponse = { ...planResult.plan, results: [...result.results] }
      setPlanView(mergedPlan)
      if (result.allSucceeded) {
        await verifyAppliedShare("执行完成并通过健康检查，共享已生效。")
      } else {
        onStatusChange({ ...share, status: "partial_failed" as ShareStatus })
        const failedCount = result.results.filter((r) => r.status === "failed").length
        setStatusError(`执行失败：${failedCount} 个步骤失败，请查看下方详情。`)
        setShowFailureDetails(true)
      }
    } catch (caught) {
      setStatusError(await errorMessage(caught))
      onStatusChange({ ...share, status: "partial_failed" as ShareStatus })
    } finally {
      setOperating(false)
    }
  }

  async function handleRetryPlan(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    setShowFailureDetails(false)
    try {
      const planResult = await getSharePlan(share.id)
      const result = await applySharePlan(share.id, planResult.plan.id)
      const mergedPlan: PlanResponse = { ...planResult.plan, results: [...result.results] }
      setPlanView(mergedPlan)
      if (result.allSucceeded) {
        setShowFailureDetails(false)
        await verifyAppliedShare("重新执行完成并通过健康检查，共享已生效。")
      } else {
        onStatusChange({ ...share, status: "partial_failed" as ShareStatus })
        const failedCount = result.results.filter((r) => r.status === "failed").length
        setStatusError(`重新执行失败：${failedCount} 个步骤失败，请查看下方详情。`)
        setShowFailureDetails(true)
      }
    } catch (caught) {
      setStatusError(await errorMessage(caught))
      onStatusChange({ ...share, status: "partial_failed" as ShareStatus })
    } finally {
      setOperating(false)
    }
  }

  async function handleHealthCheck(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    setHealthResult(null)
    try {
      const result = await checkShareHealth(share.id)
      setHealthResult(result.health.summary)
      const statusMap: Record<string, ShareStatus> = {
        healthy: "active",
        degraded: "degraded",
        unhealthy: "partial_failed",
      }
      onStatusChange({ ...share, status: statusMap[result.health.status] ?? "degraded" })
    } catch (caught) {
      setStatusError(await errorMessage(caught))
    } finally {
      setOperating(false)
    }
  }

  async function verifyAppliedShare(successMessage: string): Promise<void> {
    try {
      const result = await checkShareHealth(share.id)
      const nextStatus = shareStatusFromHealth(result.health.status)
      setHealthResult(result.health.summary)
      onStatusChange({ ...share, status: nextStatus })
      const message = formatApplyHealthMessage({
        healthStatus: result.health.status,
        summary: result.health.summary,
        errorMessage: result.health.errorMessage,
      })
      if (nextStatus === "active") {
        setStatusInfo(successMessage)
      } else {
        setStatusError(message)
      }
    } catch (caught) {
      onStatusChange({ ...share, status: "degraded" as ShareStatus })
      setStatusError(`执行命令已完成，但健康检查失败：${await errorMessage(caught)}`)
    }
  }

  async function handleDisable(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    try {
      await disableShare(share.id)
      onStatusChange({ ...share, status: "disabled" as ShareStatus })
    } catch (caught) {
      setStatusError(await errorMessage(caught))
    } finally {
      setOperating(false)
    }
  }

  async function handleEnable(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    try {
      await enableShare(share.id)
      onStatusChange({ ...share, status: "active" as ShareStatus })
    } catch (caught) {
      setStatusError(await errorMessage(caught))
    } finally {
      setOperating(false)
    }
  }

  async function handleRemount(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    try {
      await remountShare(share.id)
      setStatusInfo("重挂载已完成")
    } catch (caught) {
      setStatusError(await errorMessage(caught))
    } finally {
      setOperating(false)
    }
  }

  async function handleCheckInterconnect(): Promise<void> {
    setOperating(true)
    setStatusError(null)
    setStatusInfo(null)
    setInterconnectResult(null)
    try {
      const result = await checkInterconnectivity(share.sourceNodeId, share.targetNodeId, {
        sourcePath: share.sourcePath,
        targetPath: share.targetPath,
      })
      setInterconnectResult(result)
      const allOk =
        result.crossReachable === "ok" &&
        result.mountStatus === "mounted" &&
        result.readTest !== "failed" &&
        result.writeTest !== "failed" &&
        result.exportStatus !== "not_exported"
      if (allOk) {
        setStatusInfo("检查通过：NFS 连通、已挂载、读写正常。")
      } else {
        setStatusError(result.summary)
      }
    } catch (caught) {
      setStatusError(await errorMessage(caught))
    } finally {
      setOperating(false)
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
          <StatusBadge tone={STATUS_TONES[share.status] ?? "neutral"}>
            {STATUS_LABELS[share.status] ?? share.status}
          </StatusBadge>
        </div>
        <div className="share-actions">
          <Button disabled={operating} icon={Pencil} onClick={onEdit} variant="secondary">
            编辑
          </Button>
          <Button
            disabled={operating}
            icon={Wifi}
            onClick={() => void handleCheckInterconnect()}
            variant="secondary"
          >
            {operating ? "检测中" : "检查互通"}
          </Button>
          {share.status === "draft" ? (
            <Button
              disabled={operating}
              icon={FileText}
              onClick={() => void handleGeneratePlan()}
              variant="primary"
            >
              {operating ? "生成中" : "生成计划"}
            </Button>
          ) : null}
          {share.status === "planned" ? (
            <Button
              disabled={operating}
              icon={Play}
              onClick={() => void handleApplyPlan()}
              variant="primary"
            >
              {operating ? "执行中" : "执行"}
            </Button>
          ) : null}
          {share.status === "partial_failed" || share.status === "applying" ? (
            <Button
              disabled={operating}
              icon={RefreshCw}
              onClick={() => void handleRetryPlan()}
              variant="primary"
            >
              {operating ? "重试中" : "重新执行"}
            </Button>
          ) : null}
          {share.status === "draft" ||
          share.status === "partial_failed" ||
          share.status === "applying" ? (
            <Button
              disabled={operating}
              icon={FileText}
              onClick={() => void handleGeneratePlan()}
              variant="secondary"
            >
              {operating ? "生成中" : "生成计划"}
            </Button>
          ) : null}
          {share.status === "active" || share.status === "degraded" ? (
            <>
              <Button
                disabled={operating}
                icon={Search}
                onClick={() => void handleHealthCheck()}
                variant="secondary"
              >
                检查
              </Button>
              <Button
                disabled={operating}
                icon={RotateCw}
                onClick={() => void handleRemount()}
                variant="secondary"
              >
                重挂载
              </Button>
              <Button
                disabled={operating}
                icon={PowerOff}
                onClick={() => void handleDisable()}
                variant="secondary"
              >
                禁用
              </Button>
            </>
          ) : null}
          {share.status === "disabled" ? (
            <Button
              disabled={operating}
              icon={Power}
              onClick={() => void handleEnable()}
              variant="primary"
            >
              恢复
            </Button>
          ) : null}
          {confirmingDelete ? (
            <>
              <Button
                disabled={deleting}
                icon={Trash2}
                onClick={() => void handleDelete()}
                variant="danger"
              >
                {deleting ? "删除中" : "确认"}
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
        {preCheckResult !== null ? (
          <StatusBadge tone={preCheckTone}>前置检查: {preCheckResult}</StatusBadge>
        ) : null}
        {statusInfo !== null ? <StatusBadge tone="success">{statusInfo}</StatusBadge> : null}
        {interconnectResult !== null ? <InterconnectDetails result={interconnectResult} /> : null}
        {planView !== null && share.status === "partial_failed" ? (
          <FailureDetails
            plan={planView}
            show={showFailureDetails}
            onToggle={() => setShowFailureDetails((value) => !value)}
          />
        ) : null}
        {planView !== null && share.status === "planned" ? (
          <div className="plan-preview">
            <h4>执行计划</h4>
            <pre>{JSON.stringify(planView.plan, null, 2)}</pre>
          </div>
        ) : null}
        {healthResult !== null ? <StatusBadge tone="info">{healthResult}</StatusBadge> : null}
        {statusError === null ? null : <p className="form-error">{statusError}</p>}
      </div>
    </article>
  )
}

type FailureDetailsProps = {
  readonly plan: PlanResponse
  readonly show: boolean
  readonly onToggle: () => void
}

function FailureDetails({ plan, show, onToggle }: FailureDetailsProps) {
  const failedSteps = plan.results.filter((result) => result.status === "failed")
  if (failedSteps.length === 0) {
    return null
  }

  const planSteps = plan.plan as { steps?: readonly { key: string; name: string }[] }
  const stepName = (key: string): string => {
    const step = planSteps.steps?.find((s) => s.key === key)
    return step?.name ?? key
  }

  return (
    <div className="failure-details">
      <button className="failure-summary" onClick={onToggle} type="button">
        <AlertCircle size={14} strokeWidth={1.8} />
        <span>
          {failedSteps.length} 个步骤失败：{stepName(failedSteps[0]?.stepKey ?? "")}
          {failedSteps.length > 1 ? ` 等` : ""}
        </span>
        {show ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {show ? (
        <ul className="failure-list">
          {failedSteps.map((result) => (
            <li key={result.stepKey}>
              <strong>{stepName(result.stepKey)}</strong>
              {result.error ? <p>{result.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type InterconnectDetailsProps = {
  readonly result: InterconnectivityResponse
}

function InterconnectDetails({ result }: InterconnectDetailsProps) {
  const allOk =
    result.crossReachable === "ok" &&
    result.mountStatus === "mounted" &&
    result.readTest !== "failed" &&
    result.writeTest !== "failed" &&
    result.exportStatus !== "not_exported"

  const tone = allOk ? "success" : result.crossReachable === "ok" ? "warning" : "error"

  return (
    <div className="interconnect-result">
      <StatusBadge tone={tone}>{result.summary}</StatusBadge>
      <div className="interconnect-detail-grid">
        <StatusBadge tone={result.source.reachable === "ok" ? "success" : "error"}>
          源节点 {result.source.nodeName}: {result.source.reachable === "ok" ? "可达" : "不可达"}
        </StatusBadge>
        <StatusBadge tone={result.target.reachable === "ok" ? "success" : "error"}>
          目标节点 {result.target.nodeName}: {result.target.reachable === "ok" ? "可达" : "不可达"}
        </StatusBadge>
        <StatusBadge tone={result.crossReachable === "ok" ? "success" : "error"}>
          NFS 端口 {result.nfsPort ?? "?"}: {result.crossReachable === "ok" ? "可访问" : "不可访问"}
        </StatusBadge>
        {result.exportStatus !== "unknown" ? (
          <StatusBadge tone={result.exportStatus === "ok" ? "success" : "error"}>
            源路径导出: {result.exportStatus === "ok" ? "已导出" : "未导出"}
          </StatusBadge>
        ) : null}
        {result.mountStatus !== "unknown" ? (
          <StatusBadge tone={result.mountStatus === "mounted" ? "success" : "warning"}>
            挂载状态: {result.mountStatus === "mounted" ? "已挂载" : "未挂载"}
          </StatusBadge>
        ) : null}
        {result.readTest !== "unknown" ? (
          <StatusBadge tone={result.readTest === "ok" ? "success" : "error"}>
            读取测试: {result.readTest === "ok" ? "通过" : "失败"}
          </StatusBadge>
        ) : null}
        {result.writeTest !== "unknown" ? (
          <StatusBadge tone={result.writeTest === "ok" ? "success" : "error"}>
            写入测试: {result.writeTest === "ok" ? "通过" : "失败"}
          </StatusBadge>
        ) : null}
      </div>
      {result.exportDetail !== null && result.exportDetail.length > 0 ? (
        <pre className="interconnect-mount-detail">{result.exportDetail}</pre>
      ) : null}
      {result.mountDetail !== null && result.mountDetail.length > 0 ? (
        <pre className="interconnect-mount-detail">{result.mountDetail}</pre>
      ) : null}
    </div>
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
    nfsVersion: "auto",
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
