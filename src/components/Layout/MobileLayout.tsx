import type { ReactNode } from 'react'
import { FileCode2, FolderTree, Loader2, Map as MapIcon } from 'lucide-react'
import { SHORT_QUERY, WIDE_QUERY, useMediaQuery } from '../../lib/useMediaQuery'

export type Pane = 'files' | 'editor' | 'map'

interface Props {
  sidebar: ReactNode
  editor: ReactNode
  console: ReactNode
  viewer: ReactNode
  consoleCollapsed: boolean
  pane: Pane
  onPane: (p: Pane) => void
  running: boolean
}

/** Layout for phones and tablets: one pane at a time (files, editor with console, map) chosen from a navigation bar
 *  at the bottom, or at the left edge on a phone held sideways. From 768 px wide the editor and the map share the
 *  screen. All panes stay mounted so editor state and the map's pan/zoom survive switching. */
export function MobileLayout({ sidebar, editor, console: consoleNode, viewer, consoleCollapsed, pane, onPane, running }: Props) {
  const wide = useMediaQuery(WIDE_QUERY)
  const rail = useMediaQuery(SHORT_QUERY)
  const showFiles = pane === 'files'
  const showEditor = !showFiles && (pane === 'editor' || wide)
  const showMap = !showFiles && (pane === 'map' || wide)

  const tab = (id: Pane, label: string, icon: ReactNode, active: boolean) => (
    <button
      key={id}
      role="tab"
      aria-selected={active}
      onClick={() => onPane(id)}
      className={`relative flex flex-1 items-center justify-center gap-0.5 text-[11px] font-medium ${rail ? 'flex-col px-1 py-2' : 'flex-col py-1.5'} ${
        active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
      {active && <span className={`absolute bg-blue-500 ${rail ? 'inset-y-1 left-0 w-0.5' : 'inset-x-3 top-0 h-0.5'}`} />}
    </button>
  )

  const nav = (
    <nav
      role="tablist"
      aria-label="Views"
      className={`flex shrink-0 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900 ${
        rail ? 'w-16 flex-col border-r pl-[env(safe-area-inset-left)]' : 'h-14 border-t pb-[env(safe-area-inset-bottom)]'
      }`}
    >
      {tab('files', 'Files', <FolderTree size={20} />, showFiles)}
      {tab('editor', wide ? 'Code & map' : 'Editor', <FileCode2 size={20} />, !showFiles && (wide || pane === 'editor'))}
      {!wide && tab('map', 'Map', running ? <Loader2 size={20} className="animate-spin" /> : <MapIcon size={20} />, pane === 'map')}
    </nav>
  )

  return (
    <div className={`flex min-h-0 flex-1 ${rail ? 'flex-row' : 'flex-col'}`}>
      {rail && nav}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className={`${showFiles ? 'block' : 'hidden'} min-w-0 flex-1 overflow-hidden bg-slate-100 dark:bg-slate-900`}>{sidebar}</div>
        <div className={`${showEditor ? 'flex' : 'hidden'} min-w-0 flex-col ${wide ? 'w-1/2 border-r border-slate-200 dark:border-slate-700' : 'flex-1'}`}>
          <div className="min-h-0 flex-1">{editor}</div>
          <div style={{ height: consoleCollapsed ? 28 : 'clamp(96px, 30%, 240px)' }} className="shrink-0">{consoleNode}</div>
        </div>
        <div className={`${showMap ? 'block' : 'hidden'} min-w-0 ${wide ? 'w-1/2' : 'flex-1'}`}>{viewer}</div>
      </div>
      {!rail && nav}
    </div>
  )
}
