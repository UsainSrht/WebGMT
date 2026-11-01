import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Eye, FileUp, Trash2, X, CornerDownLeft } from 'lucide-react'
import { db } from '../../db'

const ACCEPT = ['.txt', '.dat', '.csv', '.nc', '.grd', '.xyz', '.tsv']
const PREVIEWABLE = /\.(txt|dat|csv|xyz|tsv)$/i

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export function DatasetManager({ onInsertPath }: { onInsertPath: (name: string) => void }) {
  const files = useLiveQuery(() => db.files.orderBy('name').toArray(), [])
  const [over, setOver] = useState(false)
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const add = async (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      const data = await f.arrayBuffer()
      const existing = await db.files.where('name').equals(f.name).first()
      const rec = { name: f.name, type: f.type || 'application/octet-stream', size: f.size, data, updatedAt: Date.now() }
      if (existing) await db.files.update(existing.id!, rec)
      else await db.files.add(rec)
    }
  }

  const show = async (id: number) => {
    const f = await db.files.get(id)
    if (!f) return
    const bytes = new Uint8Array(f.data.slice(0, 20000))
    setPreview({ name: f.name, text: new TextDecoder().decode(bytes) + (f.size > 20000 ? '\n… (truncated)' : '') })
  }

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Data files</h3>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files) }}
        onClick={() => input.current?.click()}
        className={`mb-2 flex cursor-pointer flex-col items-center gap-1 rounded border-2 border-dashed p-3 text-center text-xs ${over ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-300 dark:border-slate-600'}`}
      >
        <FileUp size={18} />
        Drop files or click to upload
        <span className="text-slate-500">{ACCEPT.join(' ')}</span>
        <input ref={input} type="file" multiple accept={ACCEPT.join(',')} hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = '' }} />
      </div>
      <ul className="space-y-0.5">
        {files?.map((f) => (
          <li key={f.id} className="flex items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-slate-200 dark:hover:bg-slate-700">
            <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
            <span className="shrink-0 text-[10px] text-slate-500">{fmtSize(f.size)}</span>
            <button onClick={() => onInsertPath(f.name)} title="Insert path into editor" aria-label={`Insert ${f.name}`}><CornerDownLeft size={13} /></button>
            {PREVIEWABLE.test(f.name) && <button onClick={() => show(f.id!)} title="Preview" aria-label={`Preview ${f.name}`}><Eye size={13} /></button>}
            <button onClick={() => db.files.delete(f.id!)} title="Delete" aria-label={`Delete ${f.name}`} className="hover:text-red-500"><Trash2 size={13} /></button>
          </li>
        ))}
        {files?.length === 0 && <li className="text-xs text-slate-500">No files uploaded. Reference them in a script by name, e.g. <code>gmt plot mydata.csv</code>.</li>}
      </ul>
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPreview(null)}>
          <div className="flex max-h-[80vh] w-[40rem] max-w-[95vw] flex-col rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">{preview.name}</h2><button onClick={() => setPreview(null)} aria-label="Close"><X size={18} /></button></div>
            <pre className="flex-1 overflow-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-900">{preview.text}</pre>
          </div>
        </div>
      )}
    </section>
  )
}
