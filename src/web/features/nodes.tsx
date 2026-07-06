import { useMemo, useState } from "react"
import type { NodeResponse } from "../../shared/schemas/nodes"
import { Panel } from "../components/primitives"
import { NodeForm } from "./node-form"
import { NodeList } from "./node-list"

type NodesPanelProps = {
  readonly nodes: readonly NodeResponse[]
  readonly onSaved: (node: NodeResponse) => void
}

export function NodesPanel({ nodes, onSaved }: NodesPanelProps) {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const editingNode = useMemo(
    () => nodes.find((node) => node.id === editingNodeId) ?? null,
    [editingNodeId, nodes],
  )

  function saved(node: NodeResponse): void {
    onSaved(node)
    setEditingNodeId(node.id)
  }

  return (
    <Panel title="节点">
      <div className="node-layout">
        <NodeForm
          editingNode={editingNode}
          key={editingNode?.id ?? "new-node"}
          onCancelEdit={() => setEditingNodeId(null)}
          onSaved={saved}
        />
        <NodeList
          editingNodeId={editingNodeId}
          nodes={nodes}
          onEdit={(node) => setEditingNodeId(node.id)}
          onTested={onSaved}
        />
      </div>
    </Panel>
  )
}
