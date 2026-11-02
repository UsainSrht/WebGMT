import { useState } from 'react'
import { Check, Download as DownloadIcon, X } from 'lucide-react'
import { useDownloads } from '../../services/downloadStore'
import { cancelDownload } from '../../services/gmtBridge'
import { averageFraction, eta, formatBytes, formatEta, fraction, type Download } from '../../lib/downloadState'

function Bar({ value, tone = 'blue' }: { value: number | null; tone?: 'blue' | 'green' | 'red' }) {
  const color = tone === 'green' ? 'bg-emerald-500' : tone === 'red' ? 'bg-red-500' : 'bg-blue-500'
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <div className={`h-full rounded-full ${color} ${value === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-150'}`} style={value === null ? undefined : { width: `${value * 100}%` }} />
    </div>
  )
}

function Row({ d }: { d: Download }) {
  const f = fraction(d)
  const left = eta(d)
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={d.label}>{d.label}</span>
        {d.state === 'active' && (
          <button onClick={() => cancelDownload(d.id)} className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-red-600 dark:hover:bg-slate-700" aria-label={`Cancel ${d.label}`} title="Cancel this download">
            <X size={14} />
          </button>
        )}
        {d.state === 'done' && <Check size={14} className="text-emerald-500" aria-label="Done" />}
      </div>
      <Bar value={f} tone={d.state === 'done' ? 'green' : d.state === 'error' ? 'red' : 'blue'} />
      <p className="flex justify-between gap-2 text-[11px] text-slate-500">
        {d.state === 'error' ? <span className="text-red-600 dark:text-red-400">Failed{d.error ? `: ${d.error}` : ''}</span>
          : d.state === 'cancelled' ? <span>Cancelled</span>
          : (
            <>
              <span>{d.total > 0 ? `${formatBytes(d.loaded)} / ${formatBytes(d.total)}` : formatBytes(d.loaded)}</span>
              <span>{d.state === 'done' ? 'Done' : left !== null ? `${formatEta(left)} left` : d.total > 0 ? 'estimating...' : ''}</span>
            </>
          )}
      </p>
    </li>
  )
}

/** Header widget: one bar with the average progress of the active downloads; hover (or focus / tap) for each one. */
export function DownloadIndicator() {
  const downloads = useDownloads()
  const [open, setOpen] = useState(false)
  // nothing to show once the only downloads left are cancelled ones fading out
  if (downloads.every((d) => d.state === 'cancelled')) return null

  const active = downloads.filter((d) => d.state === 'active')
  const avg = averageFraction(downloads)
  const allUnknown = active.length > 0 && active.every((d) => d.total <= 0)
  const failed = active.length === 0 && downloads.some((d) => d.state === 'error')
  const value = active.length ? (allUnknown ? null : avg) : 1
  const pct = value === null ? '' : `${Math.round(value * 100)}%`
  const title = active.length ? `${active.length} download${active.length === 1 ? '' : 's'} in progress` : failed ? 'Download failed' : 'Download finished'

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
        aria-label={`${title}${pct ? `, ${pct}` : ''}`}
        aria-expanded={open}
      >
        <DownloadIcon size={14} className={active.length ? 'text-blue-600' : failed ? 'text-red-500' : 'text-emerald-500'} />
        <span className="w-20"><Bar value={value} tone={active.length ? 'blue' : failed ? 'red' : 'green'} /></span>
        <span className="w-8 text-right tabular-nums text-slate-600 dark:text-slate-300">{pct}</span>
        {active.length > 1 && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] dark:bg-slate-700">{active.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 pt-1">
          <div role="dialog" aria-label="Downloads" className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
            <p className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">Downloads</p>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
              {downloads.map((d) => <Row key={d.id} d={d} />)}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
