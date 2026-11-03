import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import type { LogEntry } from '../../types'
import { fold, severity, type Severity } from '../../lib/consoleLog'

interface Props {
  logs: LogEntry[]
  collapsed: boolean
  onToggle: () => void
  onClear: () => void
}

const COLOR: Record<Severity, string> = {
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-slate-500',
  plain: '',
}

export function ConsoleOutput({ logs, collapsed, onToggle, onClear }: Props) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [logs, collapsed])
  const errors = logs.filter((l) => severity(l) === 'error').length
  const warnings = logs.filter((l) => severity(l) === 'warning').length
  const rows = fold(logs)
  return (
    <div className="flex h-full flex-col border-t border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-2 bg-slate-50 px-3 py-1 text-xs dark:bg-slate-800">
        <button onClick={onToggle} className="flex items-center gap-1 font-medium" aria-label="Toggle console">
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Console
          {errors > 0 && <span className="rounded bg-red-500 px-1.5 text-white" title="errors">{errors}</span>}
          {warnings > 0 && <span className="rounded bg-amber-500 px-1.5 text-white" title="warnings">{warnings}</span>}
        </button>
        <span className="flex-1" />
        <button onClick={onClear} aria-label="Clear console" title="Clear"><Trash2 size={13} /></button>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-auto bg-white p-2 font-mono text-xs dark:bg-slate-950">
          {logs.length === 0 && <div className="text-slate-500">GMT output appears here.</div>}
          {rows.map(({ l, n }, i) => (
            <div key={i} className={COLOR[severity(l)]}>
              {l.line ? <span className="mr-2 text-slate-400">L{l.line}</span> : null}{l.text}
              {n > 1 ? <span className="ml-2 rounded bg-slate-200 px-1 text-slate-600 dark:bg-slate-700 dark:text-slate-300">×{n}</span> : null}
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  )
}
