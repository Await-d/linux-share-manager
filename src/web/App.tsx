import { Activity, FolderOpen, LogOut, RefreshCw, Server } from "lucide-react"
import type { MouseEvent } from "react"
import { useCallback, useEffect, useState } from "react"
import type { UserResponse } from "../shared/schemas/auth"
import type { NodeResponse } from "../shared/schemas/nodes"
import type { ShareResponse } from "../shared/schemas/shares"
import {
  errorMessage,
  getAuthStatus,
  getCurrentUser,
  listNodes,
  listShares,
  logout,
} from "./api/client"
import { Button, Panel, StatusBadge } from "./components/primitives"
import { AuthScreen } from "./features/auth"
import { DashboardPanel } from "./features/dashboard"
import { NodesPanel } from "./features/nodes"
import { SharesPanel } from "./features/shares"
import { CONSOLE_VIEWS, type ConsoleView, viewFromPathname } from "./navigation"

type AppState =
  | { readonly kind: "loading" }
  | { readonly kind: "anonymous"; readonly initialized: boolean }
  | {
      readonly kind: "ready"
      readonly user: UserResponse
      readonly nodes: readonly NodeResponse[]
      readonly shares: readonly ShareResponse[]
    }
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

      const [nodes, shares] = await Promise.all([listNodes(), listShares()])
      setState({ kind: "ready", user, nodes, shares })
    } catch (caught) {
      if (!(caught instanceof Error)) {
        throw caught
      }
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
      return <AuthScreen initialized={state.initialized} onAuthenticated={() => void refresh()} />
    case "ready":
      return (
        <ConsoleScreen
          onLogout={() => void logout().then(refresh)}
          onNodeSaved={(node) => setState({ ...state, nodes: upsertNode(state.nodes, node) })}
          onRefresh={refresh}
          onShareCreated={(share) => setState({ ...state, shares: [...state.shares, share] })}
          onShareDeleted={(id) =>
            setState({ ...state, shares: state.shares.filter((share) => share.id !== id) })
          }
          onShareUpdated={(share) =>
            setState({
              ...state,
              shares: state.shares.map((existing) => (existing.id === share.id ? share : existing)),
            })
          }
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
  onNodeSaved,
  onShareCreated,
  onShareDeleted,
  onShareUpdated,
}: {
  readonly state: Extract<AppState, { readonly kind: "ready" }>
  readonly onRefresh: () => Promise<void>
  readonly onLogout: () => void
  readonly onNodeSaved: (node: NodeResponse) => void
  readonly onShareCreated: (share: ShareResponse) => void
  readonly onShareDeleted: (id: string) => void
  readonly onShareUpdated: (share: ShareResponse) => void
}) {
  const [view, setView] = useState<ConsoleView>(() => viewFromPathname(window.location.pathname))
  const activeView = CONSOLE_VIEWS[view]

  useEffect(() => {
    function syncViewFromLocation(): void {
      setView(viewFromPathname(window.location.pathname))
    }

    window.addEventListener("popstate", syncViewFromLocation)
    return () => window.removeEventListener("popstate", syncViewFromLocation)
  }, [])

  function navigateTo(nextView: ConsoleView): void {
    const nextPath = CONSOLE_VIEWS[nextView].path
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath)
    }
    setView(nextView)
  }

  function navClick(nextView: ConsoleView): (event: MouseEvent<HTMLAnchorElement>) => void {
    return (event) => {
      event.preventDefault()
      navigateTo(nextView)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Server size={22} strokeWidth={1.8} />
          <span>Linux Share Manager</span>
        </div>
        <nav className="nav-list" aria-label="主导航">
          <a
            aria-current={view === "dashboard" ? "page" : undefined}
            href={CONSOLE_VIEWS.dashboard.path}
            onClick={navClick("dashboard")}
          >
            <Activity size={16} strokeWidth={1.8} />
            {CONSOLE_VIEWS.dashboard.label}
          </a>
          <a
            aria-current={view === "nodes" ? "page" : undefined}
            href={CONSOLE_VIEWS.nodes.path}
            onClick={navClick("nodes")}
          >
            <Server size={16} strokeWidth={1.8} />
            {CONSOLE_VIEWS.nodes.label}
          </a>
          <a
            aria-current={view === "shares" ? "page" : undefined}
            href={CONSOLE_VIEWS.shares.path}
            onClick={navClick("shares")}
          >
            <FolderOpen size={16} strokeWidth={1.8} />
            {CONSOLE_VIEWS.shares.label}
          </a>
        </nav>
      </aside>
      <main className="workspace" id={view}>
        <header className="topbar">
          <div>
            <p className="eyebrow">已登录 · {state.user.username}</p>
            <h1>{activeView.label}</h1>
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
        <ConsoleViewPanel
          nodes={state.nodes}
          onNodeSaved={onNodeSaved}
          onShareCreated={onShareCreated}
          onShareDeleted={onShareDeleted}
          onShareUpdated={onShareUpdated}
          shares={state.shares}
          view={view}
        />
      </main>
    </div>
  )
}

function ConsoleViewPanel({
  view,
  nodes,
  shares,
  onNodeSaved,
  onShareCreated,
  onShareDeleted,
  onShareUpdated,
}: {
  readonly view: ConsoleView
  readonly nodes: readonly NodeResponse[]
  readonly shares: readonly ShareResponse[]
  readonly onNodeSaved: (node: NodeResponse) => void
  readonly onShareCreated: (share: ShareResponse) => void
  readonly onShareDeleted: (id: string) => void
  readonly onShareUpdated: (share: ShareResponse) => void
}) {
  switch (view) {
    case "dashboard":
      return <DashboardPanel nodes={nodes} shares={shares} />
    case "nodes":
      return <NodesPanel nodes={nodes} onSaved={onNodeSaved} />
    case "shares":
      return (
        <SharesPanel
          nodes={nodes}
          onCreated={onShareCreated}
          onDeleted={onShareDeleted}
          onUpdated={onShareUpdated}
          shares={shares}
        />
      )
    default:
      return assertNever(view)
  }
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

function upsertNode(
  nodes: readonly NodeResponse[],
  savedNode: NodeResponse,
): readonly NodeResponse[] {
  const found = nodes.some((node) => node.id === savedNode.id)
  if (!found) {
    return [...nodes, savedNode]
  }

  return nodes.map((node) => (node.id === savedNode.id ? savedNode : node))
}
