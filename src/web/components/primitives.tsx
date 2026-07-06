import type { LucideIcon } from "lucide-react"
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger"
  readonly icon?: LucideIcon
}

export function Button({ children, icon: Icon, variant = "secondary", ...props }: ButtonProps) {
  return (
    <button className={`button button-${variant}`} type="button" {...props}>
      {Icon === undefined ? null : <Icon aria-hidden="true" size={16} strokeWidth={1.8} />}
      <span>{children}</span>
    </button>
  )
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string
  readonly error?: string
}

export function TextField({ label, error, id, ...props }: TextFieldProps) {
  const inputId = id ?? props.name
  return (
    <label className="field" htmlFor={inputId}>
      <span className="field-label">{label}</span>
      <input className="field-input" id={inputId} {...props} />
      {error === undefined ? null : <span className="field-error">{error}</span>}
    </label>
  )
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  readonly label: string
  readonly error?: string
}

export function TextAreaField({ label, error, id, ...props }: TextAreaFieldProps) {
  const inputId = id ?? props.name
  return (
    <label className="field" htmlFor={inputId}>
      <span className="field-label">{label}</span>
      <textarea className="field-input field-textarea" id={inputId} {...props} />
      {error === undefined ? null : <span className="field-error">{error}</span>}
    </label>
  )
}

type SelectFieldProps<T extends string> = {
  readonly label: string
  readonly name: string
  readonly value: T
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly onChange: (value: T) => void
  readonly disabled?: boolean
}

export function SelectField<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  disabled,
}: SelectFieldProps<T>) {
  return (
    <label className="field" htmlFor={name}>
      <span className="field-label">{label}</span>
      <select
        className="field-input"
        disabled={disabled}
        id={name}
        name={name}
        onChange={(event) => {
          const selected = options.find((option) => option.value === event.currentTarget.value)
          if (selected !== undefined) {
            onChange(selected.value)
          }
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

type PanelProps = {
  readonly title: string
  readonly action?: ReactNode
  readonly children: ReactNode
}

export function Panel({ title, action, children }: PanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

type StatusBadgeProps = {
  readonly tone: "success" | "warning" | "error" | "info" | "neutral"
  readonly children: ReactNode
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${tone}`}>
      <span aria-hidden="true" className="status-dot" />
      {children}
    </span>
  )
}
