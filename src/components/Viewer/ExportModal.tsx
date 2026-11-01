import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { exportAs, type ExportFormat, type Exportable } from '../../lib/exporters'

interface Props {
  result: Exportable | null
  script: string
  name: string
  onClose: () => void
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'png', label: 'PNG', hint: '300 DPI raster' },
  { id: 'svg', label: 'SVG', hint: 'Vector, for editors like Inkscape' },
  { id: 'pdf', label: 'PDF', hint: 'Single page; embeds a raster render' },
  { id: 'ps', label: 'PostScript', hint: 'Raw GMT .ps (Wasm engine only)' },
  { id: 'script', label: 'Script (.sh)', hint: 'The GMT script itself' },
]

export function ExportModal({ result, script, name, onClose }: Props) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState('')

  const go = async (f: ExportFormat) => {
    setBusy(f)
    setError('')
    try { await exportAs(f, result, script, name) } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-lg bg-white p-4 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Export</h2>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <ul className="space-y-1.5">
          {FORMATS.map((f) => {
            const disabled = f.id === 'ps' ? !result?.ps : f.id !== 'script' && !result?.svg
            return (
              <li key={f.id}>
                <button
                  disabled={disabled || busy !== null}
                  onClick={() => go(f.id)}
                  className="flex w-full items-center justify-between rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
                >
                  <span><b>{f.label}</b> <span className="text-xs text-slate-500">{f.hint}</span></span>
                  <Download size={15} className={busy === f.id ? 'animate-pulse' : ''} />
                </button>
              </li>
            )
          })}
        </ul>
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      </div>
    </div>
  )
}
