import { FilePlus, FileText, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'

interface Props {
  activeId: number | null
  onSelect: (id: number) => void
  onCreate: () => void
  onDeleted: (id: number) => void
}

export function ScriptList({ activeId, onSelect, onCreate, onDeleted }: Props) {
  const scripts = useLiveQuery(() => db.scripts.orderBy('updatedAt').reverse().toArray(), [])
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scripts</h3>
        <button onClick={onCreate} className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="New script" title="New script"><FilePlus size={14} /></button>
      </div>
      <ul className="space-y-0.5">
        {scripts?.map((s) => (
          <li key={s.id} className={`group flex items-center gap-1 rounded px-1.5 py-1 text-sm ${s.id === activeId ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
            <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onSelect(s.id!)}>
              <FileText size={14} className="shrink-0" /> <span className="truncate">{s.title}</span>
            </button>
            <button
              className="hidden shrink-0 text-slate-500 hover:text-red-500 group-hover:block"
              aria-label={`Delete ${s.title}`}
              onClick={async () => { if (confirm(`Delete "${s.title}"?`)) { await db.scripts.delete(s.id!); onDeleted(s.id!) } }}
            ><Trash2 size={13} /></button>
          </li>
        ))}
      </ul>
    </section>
  )
}
