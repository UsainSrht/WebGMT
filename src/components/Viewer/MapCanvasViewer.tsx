import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Spline } from 'lucide-react'
import { rasterize, svgSize } from '../../lib/exporters'
import { ZoomControls } from './ZoomControls'
import type { RenderResult } from '../../types'

interface Props {
  result: RenderResult | null
  /** index of the figure shown (a script can produce several gmt begin/end figures) */
  index: number
  onIndex: (i: number) => void
  running: boolean
  onExport: () => void
}

export function MapCanvasViewer({ result, index, onIndex, running, onExport }: Props) {
  const fig = result ? result.figures[Math.min(index, result.figures.length - 1)] ?? null : null
  const box = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'vector' | 'raster'>('vector')
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [rasterUrl, setRasterUrl] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  // two fingers: pinch to zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDist = useRef<number | null>(null)
  const spread = () => { const [a, b] = [...pointers.current.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }

  const size = useMemo(() => (fig?.svg ? svgSize(fig.svg) : null), [fig])
  const vectorUrl = useMemo(() => (fig?.svg ? URL.createObjectURL(new Blob([fig.svg], { type: 'image/svg+xml' })) : null), [fig])
  useEffect(() => () => { if (vectorUrl) URL.revokeObjectURL(vectorUrl) }, [vectorUrl])

  useEffect(() => {
    let url: string | null = null
    let dead = false
    setRasterUrl(null)
    if (mode === 'raster' && fig?.svg) {
      rasterize(fig.svg, 144).then((b) => { if (!dead) { url = URL.createObjectURL(b); setRasterUrl(url) } }).catch(() => {})
    }
    return () => { dead = true; if (url) URL.revokeObjectURL(url) }
  }, [mode, fig])

  const fit = useCallback(() => {
    if (!box.current || !size) return
    const r = box.current.getBoundingClientRect()
    const k = Math.min((r.width - 32) / size.w, (r.height - 32) / size.h, 4)
    setView({ k, x: (r.width - size.w * k) / 2, y: (r.height - size.h * k) / 2 })
  }, [size])
  // true once the user zoomed or panned: then the view is theirs and is not re-fitted automatically
  const touched = useRef(false)
  useEffect(() => { touched.current = false; fit() }, [fit])
  // On phones the map lives in a pane that is hidden (0 x 0) until its tab is opened: fit it when it first gets a size.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let hidden = el.clientWidth === 0 || el.clientHeight === 0
    const ro = new ResizeObserver(() => {
      const nowHidden = el.clientWidth === 0 || el.clientHeight === 0
      if (hidden && !nowHidden && !touched.current) fit()
      hidden = nowHidden
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    touched.current = true
    const r = box.current!.getBoundingClientRect()
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2
    setView((v) => {
      const k = Math.min(20, Math.max(0.05, v.k * factor))
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
    })
  }

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const src = mode === 'vector' ? vectorUrl : rasterUrl
  const cm = size ? { w: (size.w / 72) * 2.54, h: (size.h / 72) * 2.54 } : null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
        <div className="flex overflow-hidden rounded border border-slate-300 dark:border-slate-600">
          {(['vector', 'raster'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`flex items-center gap-1 px-2 py-1 ${mode === m ? 'bg-blue-600 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
              {m === 'vector' ? <Spline size={12} /> : <ImageIcon size={12} />} {m === 'vector' ? 'Vector' : 'Raster'}
            </button>
          ))}
        </div>
        {result && result.figures.length > 1 && (
          <select
            value={Math.min(index, result.figures.length - 1)}
            onChange={(e) => onIndex(+e.target.value)}
            aria-label="Figure"
            className="max-w-[9rem] rounded border border-slate-300 bg-white px-1 py-1 dark:border-slate-600 dark:bg-slate-800"
          >
            {result.figures.map((f, i) => <option key={i} value={i}>{i + 1}/{result.figures.length} {f.name}</option>)}
          </select>
        )}
        <span className="flex-1 truncate text-slate-500">
          {cm ? `${cm.w.toFixed(1)} × ${cm.h.toFixed(1)} cm · ${Math.round(size!.w)} × ${Math.round(size!.h)} pt` : 'No map yet'}
          {result ? ` · ${result.engine === 'mock' ? 'mock engine' : 'GMT Wasm'} · ${Math.round(result.durationMs)} ms` : ''}
        </span>
        <button onClick={onExport} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600">
          <Download size={12} /> Export
        </button>
      </div>
      <div
        ref={box}
        className="relative flex-1 cursor-grab touch-none overflow-hidden bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#f3f4f6_0%_50%)] bg-[length:20px_20px] active:cursor-grabbing dark:bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)]"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId)
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pointers.current.size === 2) { drag.current = null; pinchDist.current = spread() }
          else drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pinchDist.current !== null && pointers.current.size === 2) {
            const d = spread()
            const [a, b] = [...pointers.current.values()]
            const r = box.current!.getBoundingClientRect()
            if (pinchDist.current > 0) zoomAt(d / pinchDist.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top)
            pinchDist.current = d
            return
          }
          const d = drag.current
          if (d) { touched.current = true; setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })) }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId)
          pinchDist.current = null
          const rest = [...pointers.current.values()][0]
          // one finger left after a pinch: carry on panning from where it is
          drag.current = rest ? { x: rest.x, y: rest.y, vx: view.x, vy: view.y } : null
        }}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); pinchDist.current = null; drag.current = null }}
      >
        {src && size && (
          <img
            src={src}
            alt="GMT map"
            draggable={false}
            style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: size.h, maxWidth: 'none', transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, background: 'white', boxShadow: '0 2px 12px rgba(0,0,0,.25)' }}
          />
        )}
        {!result && !running && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500"><span className="[@media(hover:none)]:hidden">Run a script (Ctrl+Enter) to see the map</span><span className="hidden [@media(hover:none)]:inline">Run a script to see the map</span></p>}
        {running && <p className="absolute left-3 top-3 rounded bg-blue-600 px-2 py-1 text-xs text-white">Running…</p>}
        <ZoomControls scale={view.k} onZoomIn={() => zoomAt(1.25)} onZoomOut={() => zoomAt(0.8)} onFit={() => { touched.current = false; fit() }} />
      </div>
    </div>
  )
}
