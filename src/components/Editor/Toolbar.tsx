import { Loader2, Play, Save } from 'lucide-react'

interface Props {
  title: string
  onTitle: (t: string) => void
  running: boolean
  dirty: boolean
  onRun: () => void
  onSave: () => void
}

export function Toolbar({ title, onTitle, running, dirty, onRun, onSave }: Props) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
      <input
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm font-medium outline-none focus:bg-white dark:focus:bg-slate-900"
        aria-label="Script title"
      />
      <button onClick={onSave} className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700" title="Save (Ctrl+S)">
        <Save size={14} /> Save{dirty ? ' •' : ''}
      </button>
      <button
        onClick={onRun}
        disabled={running}
        className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
        title="Run script (Ctrl/Cmd+Enter)"
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run
      </button>
    </div>
  )
}
