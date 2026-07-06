import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles/global.css"

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  void import("react-grab")
  void import("react-scan")
}

const root = document.getElementById("root")
if (root === null) {
  throw new Error("root element not found")
}

createRoot(root).render(<App />)
