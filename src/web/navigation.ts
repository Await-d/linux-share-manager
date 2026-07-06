export const CONSOLE_VIEWS = {
  dashboard: { label: "控制台", path: "/dashboard" },
  nodes: { label: "节点", path: "/nodes" },
  shares: { label: "共享", path: "/shares" },
} as const

export type ConsoleView = keyof typeof CONSOLE_VIEWS

export function viewFromPathname(pathname: string): ConsoleView {
  switch (pathname) {
    case CONSOLE_VIEWS.shares.path:
      return "shares"
    case CONSOLE_VIEWS.nodes.path:
      return "nodes"
    case CONSOLE_VIEWS.dashboard.path:
    case "/":
      return "dashboard"
    default:
      return "dashboard"
  }
}
