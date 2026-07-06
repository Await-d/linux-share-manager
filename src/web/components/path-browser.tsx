import { ChevronRight, Folder, Loader2, RefreshCw, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { BrowseResponse } from "../../shared/schemas/browse"
import { browseDirectories, errorMessage } from "../api/client"

type PathBrowserProps = {
  readonly label: string
  readonly name: string
  readonly nodeId: string
  readonly value: string
  readonly placeholder: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

export function PathBrowser({
  label,
  name,
  nodeId,
  value,
  placeholder,
  onChange,
  disabled,
}: PathBrowserProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [browse, setBrowse] = useState<BrowseResponse | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  async function openBrowser(): Promise<void> {
    setOpen(true)
    await loadPath(value.length > 0 ? value : "/")
  }

  async function loadPath(path: string): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const result = await browseDirectories(nodeId, path)
      setBrowse(result)
    } catch (caught) {
      setError(await errorMessage(caught))
      setBrowse(null)
    } finally {
      setLoading(false)
    }
  }

  function selectDirectory(path: string): void {
    onChange(path)
  }

  return (
    <div className="field path-browser" ref={containerRef}>
      <label className="field-label" htmlFor={name}>
        {label}
      </label>
      <div className="path-browser-input-row">
        <input
          className="field-input"
          disabled={disabled}
          id={name}
          name={name}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={placeholder}
          value={value}
        />
        <button
          aria-label="浏览远程目录"
          className="path-browser-button"
          disabled={disabled || nodeId.length === 0}
          onClick={() => void openBrowser()}
          title="浏览远程目录"
          type="button"
        >
          {loading ? (
            <Loader2 aria-hidden="true" size={16} strokeWidth={1.8} className="spin" />
          ) : (
            <Folder aria-hidden="true" size={16} strokeWidth={1.8} />
          )}
        </button>
      </div>

      {open ? (
        <div className="path-browser-dropdown">
          <div className="path-browser-header">
            <span className="path-browser-cwd">{browse?.path ?? "/"}</span>
            <div className="path-browser-header-actions">
              {browse?.parent !== null ? (
                <button
                  className="path-browser-link"
                  onClick={() =>
                    browse?.parent !== null && browse?.parent !== undefined
                      ? void loadPath(browse.parent)
                      : undefined
                  }
                  type="button"
                >
                  上级
                </button>
              ) : null}
              <button
                aria-label="刷新目录"
                className="path-browser-icon-button"
                disabled={loading || nodeId.length === 0}
                onClick={() => browse !== null && void loadPath(browse.path)}
                title="刷新"
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              <button
                aria-label="关闭目录浏览"
                className="path-browser-icon-button"
                onClick={() => setOpen(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          {error !== null ? <div className="path-browser-error">{error}</div> : null}

          {browse !== null && error === null ? (
            <div className="path-browser-list">
              {browse.entries.length === 0 ? (
                <div className="path-browser-empty">目录为空</div>
              ) : (
                browse.entries.map((entry) => (
                  <button
                    className={
                      entry.isDirectory
                        ? "path-browser-entry path-browser-entry-dir"
                        : "path-browser-entry"
                    }
                    key={entry.path}
                    onClick={() =>
                      entry.isDirectory ? void loadPath(entry.path) : selectDirectory(entry.path)
                    }
                    type="button"
                  >
                    <span className="path-browser-entry-name">
                      {entry.isDirectory ? (
                        <Folder aria-hidden="true" size={14} strokeWidth={1.8} />
                      ) : (
                        <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
                      )}
                      {entry.name}
                    </span>
                    {entry.isDirectory ? (
                      <span className="path-browser-entry-select">选择</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : null}

          <div className="path-browser-footer">
            <button
              className="path-browser-select-button"
              onClick={() => {
                if (browse !== null) {
                  selectDirectory(browse.path)
                  setOpen(false)
                }
              }}
              type="button"
            >
              选择当前目录
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
