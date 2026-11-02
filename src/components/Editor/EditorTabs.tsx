import { useEffect, useRef } from 'react'
import { Loader2, Play, Save, X } from 'lucide-react'

export interface TabInfo {
  id: number
  name: string
  /** full project path, shown as tooltip */
  path: string
  dirty: boolean
}

interface Props {
  tabs: TabInfo[]
  activeId: number | null
  onActivate: (id: number) => void
  onClose: (id: number) => void
  running: boolean
  canRun: boolean
  canSave: boolean
  onRun: () => void
  onSave: () => void
}

export function EditorTabs({ tabs, activeId, onActivate, onClose, running, canRun, canSave, onRun, onSave }: Props) {
  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [activeId])

  return (
    <div className="flex items-stretch border-b border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
      <div role="tablist" className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = t.id === activeId
          return (
            <div
              key={t.id}
              ref={active ? activeRef : undefined}
              role="tab"
              aria-selected={active}
              title={t.path}
              onClick={() => onActivate(t.id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id) } }}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
              className={`group flex shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 [@media(pointer:coarse)]:py-2.5 ${
                active ? 'border-t-2 border-t-blue-500 bg-white dark:bg-slate-950' : 'border-t-2 border-t-transparent text-slate-600 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <span className="max-w-[12rem] truncate">{t.name}</span>
              <button
                aria-label={`Close ${t.name}`}
                title={t.dirty ? 'Unsaved changes: close' : 'Close'}
                onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
                className="flex h-4 w-4 items-center justify-center rounded hover:bg-slate-300 dark:hover:bg-slate-700 [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7"
              >
                {t.dirty ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-slate-500 group-hover:hidden dark:bg-slate-300" />
                    <X size={12} className="hidden group-hover:block" />
                  </>
                ) : (
                  <X size={12} className={active ? '' : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'} />
                )}
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-700 [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:py-2"
          title="Save (Ctrl+S)"
        >
          <Save size={14} /> <span className="max-sm:hidden">Save</span>
        </button>
        <button
          onClick={onRun}
          disabled={running || !canRun}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 [@media(pointer:coarse)]:py-2"
          title={canRun ? 'Run script (Ctrl/Cmd+Enter)' : 'Open a shell script (.sh) to run it'}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run
        </button>
      </div>
    </div>
  )
}
