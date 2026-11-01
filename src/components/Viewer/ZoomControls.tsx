import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'

interface Props {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

export function ZoomControls({ scale, onZoomIn, onZoomOut, onFit }: Props) {
  const b = 'rounded p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700'
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white/90 p-0.5 shadow dark:border-slate-600 dark:bg-slate-800/90">
      <button className={b} onClick={onZoomOut} aria-label="Zoom out"><ZoomOut size={16} /></button>
      <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
      <button className={b} onClick={onZoomIn} aria-label="Zoom in"><ZoomIn size={16} /></button>
      <button className={b} onClick={onFit} aria-label="Fit to view"><Maximize size={16} /></button>
    </div>
  )
}
