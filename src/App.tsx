import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { db, seedIfEmpty } from './db'
import { runScript } from './services/gmtBridge'
import { parseErrors } from './services/errorParser'
import { MonacoGmtEditor } from './components/Editor/MonacoGmtEditor'
import { Toolbar } from './components/Editor/Toolbar'
import { MapCanvasViewer } from './components/Viewer/MapCanvasViewer'
import { ExportModal } from './components/Viewer/ExportModal'
import { ScriptList } from './components/FileTree/ScriptList'
import { DatasetManager } from './components/FileTree/DatasetManager'
import { ConsoleOutput } from './components/Terminal/ConsoleOutput'
import { Header } from './components/Layout/Header'
import { SplitLayout } from './components/Layout/SplitLayout'
import type { EditorMarker, LogEntry, RenderResult } from './types'

const NEW_SCRIPT = `#!/bin/bash
gmt begin map png
  gmt basemap -R-30/60/30/75 -JM16c -Bafg
  gmt coast -Ggray90 -Slightblue -W0.25p
gmt end
`

export default function App() {
  const [dark, setDark] = useState(() => {
    try { const s = localStorage.getItem('webgmt-theme'); if (s) return s === 'dark' } catch { /* ignore */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [activeId, setActiveId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [markers, setMarkers] = useState<EditorMarker[]>([])
  const [result, setResult] = useState<RenderResult | null>(null)
  const [figIndex, setFigIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null)
  const loadedTitle = useRef('')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('webgmt-theme', dark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [dark])

  const open = useCallback(async (id: number) => {
    const s = await db.scripts.get(id)
    if (!s) return
    setActiveId(id); setTitle(s.title); setContent(s.content); setSaved(s.content); loadedTitle.current = s.title
    setMarkers([])
  }, [])

  useEffect(() => {
    void (async () => {
      await seedIfEmpty()
      const first = await db.scripts.orderBy('updatedAt').reverse().first()
      if (first) void open(first.id!)
    })()
  }, [open])

  const save = useCallback(async () => {
    if (activeId == null) return
    await db.scripts.update(activeId, { title, content, updatedAt: Date.now() })
    setSaved(content); loadedTitle.current = title
  }, [activeId, title, content])

  const create = async () => {
    const id = (await db.scripts.add({ title: 'Untitled', content: NEW_SCRIPT, tags: [], createdAt: Date.now(), updatedAt: Date.now() })) as number
    void open(id)
  }

  const run = useCallback(async () => {
    if (running) return
    setRunning(true); setLogs([]); setMarkers([])
    const collected: LogEntry[] = []
    const onLog = (e: LogEntry) => { collected.push(e); setLogs((l) => [...l, e]) }
    const files = (await db.files.toArray()).map((f) => ({ name: f.name, data: f.data }))
    let status: 'ok' | 'error' = 'error'
    let ms = 0
    try {
      const r = await runScript(content, files, onLog)
      ms = r.durationMs
      if (r.figures.length) { setResult(r); setFigIndex(0) }
      ;(window as unknown as { __webgmtLast?: unknown }).__webgmtLast = r // debug/test hook: lets tests fetch the raw PostScript
      status = r.ok ? 'ok' : 'error'
      setMarkers(parseErrors(collected, content.split('\n').length))
      onLog({ stream: 'info', text: r.ok ? `Done in ${Math.round(ms)} ms` : 'Finished with errors' })
    } catch (e) {
      onLog({ stream: 'stderr', text: `[ERROR]: ${(e as Error).message}` })
    }
    if (activeId != null) await db.history.add({ scriptId: activeId, executedAt: Date.now(), status, executionTimeMs: ms })
    setRunning(false)
  }, [running, content, activeId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [save])

  const dirty = content !== saved || title !== loadedTitle.current

  const sidebar = (
    <div className="space-y-4">
      <ScriptList activeId={activeId} onSelect={open} onCreate={create} onDeleted={(id) => { if (id === activeId) { setActiveId(null); setContent(''); setTitle('') } }} />
      <DatasetManager onInsertPath={(name) => setInsert({ text: name, nonce: Date.now() })} />
      <section>
        <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"><BookOpen size={12} /> Quick reference</h3>
        <ul className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
          <li><code>-R</code> region · <code>-J</code> projection</li>
          <li><code>-B</code> frame · <code>-W</code> pen · <code>-G</code> fill</li>
          <li><code>Ctrl+Enter</code> run · <code>Ctrl+S</code> save</li>
          <li><a className="text-blue-600 underline" href="https://docs.generic-mapping-tools.org/6.6/" target="_blank" rel="noreferrer">GMT 6.6 docs</a></li>
        </ul>
      </section>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <Header dark={dark} onToggleTheme={() => setDark((d) => !d)} />
      <SplitLayout
        consoleCollapsed={consoleCollapsed}
        sidebar={sidebar}
        editor={
          <div className="flex h-full flex-col">
            <Toolbar title={title} onTitle={setTitle} running={running} dirty={dirty} onRun={run} onSave={save} />
            <div className="min-h-0 flex-1">
              {activeId != null ? (
                <MonacoGmtEditor value={content} onChange={setContent} onRun={run} markers={markers} dark={dark} insertRequest={insert} />
              ) : (
                <p className="p-4 text-sm text-slate-500">Select or create a script.</p>
              )}
            </div>
          </div>
        }
        console={<ConsoleOutput logs={logs} collapsed={consoleCollapsed} onToggle={() => setConsoleCollapsed((c) => !c)} onClear={() => setLogs([])} />}
        viewer={<MapCanvasViewer result={result} index={figIndex} onIndex={setFigIndex} running={running} onExport={() => setExporting(true)} />}
      />
      {exporting && <ExportModal result={result?.figures[Math.min(figIndex, result.figures.length - 1)] ?? null} script={content} name={title} onClose={() => setExporting(false)} />}
    </div>
  )
}
