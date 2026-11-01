import { useRef, useState, type ReactNode } from 'react'

function useDrag(initial: number, min: number, max: number, axis: 'x' | 'y', invert = false) {
  const [size, setSize] = useState(initial)
  const start = useRef<{ p: number; s: number } | null>(null)
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      start.current = { p: axis === 'x' ? e.clientX : e.clientY, s: size }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return
      const d = (axis === 'x' ? e.clientX : e.clientY) - start.current.p
      setSize(Math.min(max, Math.max(min, start.current.s + (invert ? -d : d))))
    },
    onPointerUp: () => { start.current = null },
  }
  return [size, handlers] as const
}

interface Props {
  sidebar: ReactNode
  editor: ReactNode
  console: ReactNode
  viewer: ReactNode
  consoleCollapsed: boolean
}

export function SplitLayout({ sidebar, editor, console: consoleNode, viewer, consoleCollapsed }: Props) {
  const [sideW, sideH] = useDrag(250, 160, 420, 'x')
  const [viewerW, viewerH] = useDrag(560, 260, 1200, 'x', true)
  const [consoleH, consoleHandlers] = useDrag(180, 80, 500, 'y', true)
  return (
    <div className="flex min-h-0 flex-1">
      <aside style={{ width: sideW }} className="shrink-0 overflow-y-auto bg-slate-100 p-2 dark:bg-slate-900">{sidebar}</aside>
      <div {...sideH} className="w-1 shrink-0 cursor-col-resize bg-slate-200 hover:bg-blue-400 dark:bg-slate-700" />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">{editor}</div>
        {!consoleCollapsed && <div {...consoleHandlers} className="h-1 shrink-0 cursor-row-resize bg-slate-200 hover:bg-blue-400 dark:bg-slate-700" />}
        <div style={{ height: consoleCollapsed ? 28 : consoleH }} className="shrink-0">{consoleNode}</div>
      </main>
      <div {...viewerH} className="w-1 shrink-0 cursor-col-resize bg-slate-200 hover:bg-blue-400 dark:bg-slate-700" />
      <section style={{ width: viewerW }} className="shrink-0">{viewer}</section>
    </div>
  )
}
