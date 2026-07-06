import { Activity, LogOut, RefreshCw, Server } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { UserResponse } from "../shared/schemas/auth"
import type { NodeResponse } from "../shared/schemas/nodes"
import { errorMessage, getAuthStatus, getCurrentUser, listNodes, logout } from "./api/client"
import { Button, Panel, StatusBadge } from "./components/primitives"
import { AuthScreen } from "./features/auth"
import { NodesPanel } from "./features/nodes"

type AppState =
  | { readonly kind: "loading" }
  | { readonly kind: "anonymous"; readonly initialized: boolean }
  | { readonly kind: "ready"; readonly user: UserResponse; readonly nodes: readonly NodeResponse[] }
  | { readonly kind: "failed"; readonly message: string }

export function App() {
  const [state, setState] = useState<AppState>({ kind: "loading" })

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [status, user] = await Promise.all([getAuthStatus(), getCurrentUser()])
      if (user === null) {
        setState({ kind: "anonymous", initialized: status.initialized })
        return
      }

      const nodes = await listNodes()
      setState({ kind: "ready", user, nodes })
    } catch (caught) {
      setState({ kind: "failed", message: await errorMessage(caught) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  switch (state.kind) {
    case "loading":
      return <LoadingScreen />
    case "anonymous":
      return (
        <AuthScreen
          initialized={state.initialized}
          onAuthenticated={(user) => setState({ kind: "ready", user, nodes: [] })}
        />
      )
    case "ready":
      return (
        <ConsoleScreen
          onLogout={() => void logout().then(refresh)}
          onNodeCreated={(node) => setState({ ...state, nodes: [...state.nodes, node] })}
          onRefresh={refresh}
          state={state}
        />
      )
    case "failed":
      return <ErrorScreen message={state.message} onRetry={refresh} />
    default:
      return assertNever(state)
  }
}

function ConsoleScreen({
  state,
  onRefresh,
  onLogout,
  onNodeCreated,
}: {
  readonly state: Extract<AppState, { readonly kind: "ready" }>
  readonly onRefresh: () => Promise<void>
  readonly onLogout: () => void
  readonly onNodeCreated: (node: NodeResponse) => void
}) {
  const stats = useMemo(
    () => [
      { label: "节点", value: state.nodes.length },
      { label: "共享", value: 0 },
      { label: "异常", value: 0 },
    ],
    [state.nodes.length],
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Server size={22} strokeWidth={1.8} />
          <span>Linux Share Manager</span>
        </div>
        <nav className="nav-list" aria-label="主导航">
          <a aria-current="page" href="#dashboard">
            <Activity size={16} strokeWidth={1.8} />
            控制台
          </a>
          <a href="#nodes">
            <Server size={16} strokeWidth={1.8} />
            节点
          </a>
        </nav>
      </aside>
      <main className="workspace" id="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">已登录</p>
            <h1>{state.user.username}</h1>
          </div>
          <div className="topbar-actions">
            <Button icon={RefreshCw} onClick={() => void onRefresh()} variant="ghost">
              刷新
            </Button>
            <Button icon={LogOut} onClick={onLogout} variant="secondary">
              退出
            </Button>
          </div>
        </header>
        <section className="stat-grid" aria-label="状态摘要">
          {stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </section>
        <Panel title="系统状态">
          <div className="status-row">
            <StatusBadge tone="success">API 正常</StatusBadge>
            <StatusBadge tone={state.nodes.length > 0 ? "info" : "warning"}>
              {state.nodes.length > 0 ? "已有节点" : "等待添加节点"}
            </StatusBadge>
          </div>
        </Panel>
        <div id="nodes">
          <NodesPanel nodes={state.nodes} onCreated={onNodeCreated} />
        </div>
      </main>
    </div>
  )
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <StatusBadge tone="info">加载中</StatusBadge>
    </main>
  )
}

function ErrorScreen({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => Promise<void>
}) {
  return (
    <main className="center-screen">
      <Panel title="启动失败">
        <p className="form-error">{message}</p>
        <Button icon={RefreshCw} onClick={() => void onRetry()} variant="primary">
          重试
        </Button>
      </Panel>
    </main>
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled app state: ${JSON.stringify(value)}`)
}
