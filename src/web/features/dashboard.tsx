import type { NodeResponse } from "../../shared/schemas/nodes"
import type { ShareResponse } from "../../shared/schemas/shares"
import { Panel, StatusBadge } from "../components/primitives"

type DashboardPanelProps = {
  readonly nodes: readonly NodeResponse[]
  readonly shares: readonly ShareResponse[]
}

export function DashboardPanel({ nodes, shares }: DashboardPanelProps) {
  const nodeState = nodes.length > 0 ? "已有节点" : "节点清单为空"
  const shareState = shares.length > 0 ? "已有共享草稿" : "未创建共享"

  return (
    <>
      <section className="stat-grid" aria-label="状态摘要">
        <div className="stat">
          <span>节点</span>
          <strong>{nodes.length}</strong>
        </div>
        <div className="stat">
          <span>共享</span>
          <strong>{shares.length}</strong>
        </div>
        <div className="stat">
          <span>异常</span>
          <strong>0</strong>
        </div>
      </section>

      <Panel title="系统状态">
        <div className="status-row">
          <StatusBadge tone="success">API 正常</StatusBadge>
          <StatusBadge tone={nodes.length > 0 ? "info" : "warning"}>{nodeState}</StatusBadge>
          <StatusBadge tone={shares.length > 0 ? "info" : "neutral"}>{shareState}</StatusBadge>
        </div>
      </Panel>

      <Panel title="配置概览">
        <div className="status-matrix">
          <div>
            <span>节点清单</span>
            <strong>{nodes.length > 0 ? "已登记" : "空"}</strong>
          </div>
          <div>
            <span>NFS 共享</span>
            <strong>{shares.length > 0 ? "草稿已创建" : "未配置"}</strong>
          </div>
          <div>
            <span>执行计划</span>
            <strong>未生成</strong>
          </div>
        </div>
      </Panel>
    </>
  )
}
