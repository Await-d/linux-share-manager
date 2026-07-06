import { ShieldCheck } from "lucide-react"
import type { FormEvent } from "react"
import { useState } from "react"
import type { UserResponse } from "../../shared/schemas/auth"
import { errorMessage, initializeAdmin, login } from "../api/client"
import { Button, Panel, TextField } from "../components/primitives"

type AuthScreenProps = {
  readonly initialized: boolean
  readonly onAuthenticated: (user: UserResponse) => void
}

export function AuthScreen({ initialized, onAuthenticated }: AuthScreenProps) {
  const [username, setUsername] = useState("admin")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const user = initialized
        ? await login({ username, password })
        : await initializeAdmin({ username, password })
      onAuthenticated(user)
    } catch (caught) {
      setError(await errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <Panel title={initialized ? "管理员登录" : "初始化管理员"}>
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-mark" aria-hidden="true">
            <ShieldCheck size={22} strokeWidth={1.8} />
          </div>
          <TextField
            autoComplete="username"
            label="用户名"
            name="username"
            onChange={(event) => setUsername(event.currentTarget.value)}
            value={username}
          />
          <TextField
            autoComplete={initialized ? "current-password" : "new-password"}
            label="密码"
            name="password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            type="password"
            value={password}
          />
          {error === null ? null : <p className="form-error">{error}</p>}
          <Button disabled={submitting} icon={ShieldCheck} type="submit" variant="primary">
            {submitting ? "处理中" : initialized ? "登录" : "创建管理员"}
          </Button>
        </form>
      </Panel>
    </main>
  )
}
