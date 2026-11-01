import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { runScript } from './services/gmtBridge'
import { parseErrors } from './services/errorParser'
import { pathOf, readFile, snapshotFiles, writeFile, type TreeNode } from './services/fsService'
import { classify } from './lib/fileTypes'
import { dirname, relative } from './lib/paths'
import { MonacoGmtEditor, disposeModel } from './components/Editor/MonacoGmtEditor'
import { EditorTabs, type TabInfo } from './components/Editor/EditorTabs'
import { BinaryNotice, ImagePreview } from './components/Editor/FileViews'
import { MapCanvasViewer } from './components/Viewer/MapCanvasViewer'
import { ExportModal } from './components/Viewer/ExportModal'
import { FileExplorer } from './components/FileTree/FileExplorer'
import { ConsoleOutput } from './components/Terminal/ConsoleOutput'
import { Header } from './components/Layout/Header'
import { SidebarFooter } from './components/Layout/SidebarFooter'
import { AboutModal } from './components/Layout/AboutModal'
import { SplitLayout } from './components/Layout/SplitLayout'
import type { EditorMarker, LogEntry, RenderResult } from './types'

type Doc =
  | { kind: 'text'; text: string; saved: string; updatedAt: number }
  | { kind: 'image'; data: ArrayBuffer; mime: string; updatedAt: number }
  | { kind: 'binary'; size: number; tooLarge?: boolean; updatedAt: number }

const SESSION_KEY = 'webgmt-tabs'
const enc = new TextEncoder()
const dec = new TextDecoder()
const editorPath = (id: number) => `inmemory://webgmt/${id}`

async function loadDoc(node: TreeNode): Promise<Doc> {
  const data = await readFile(node.id)
  const info = classify(node.name, new Uint8Array(data))
  if (info.kind === 'text') { const text = dec.decode(data); return { kind: 'text', text, saved: text, updatedAt: node.updatedAt } }
  if (info.kind === 'image') return { kind: 'image', data, mime: info.mime!, updatedAt: node.updatedAt }
  return { kind: 'binary', size: data.byteLength, tooLarge: info.tooLarge, updatedAt: node.updatedAt }
}

export default function App() {
  const [dark, setDark] = useState(() => {
    try { const s = localStorage.getItem('webgmt-theme'); if (s) return s === 'dark' } catch { /* ignore */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const nodesLive = useLiveQuery(() => db.nodes.toArray() as Promise<TreeNode[]>, [])
  const nodes = useMemo(() => nodesLive ?? [], [nodesLive])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const [tabs, setTabs] = useState<number[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [docs, setDocs] = useState<Record<number, Doc>>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [markers, setMarkers] = useState<{ id: number; list: EditorMarker[] }>({ id: -1, list: [] })
  const [result, setResult] = useState<RenderResult | null>(null)
  const [figIndex, setFigIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [about, setAbout] = useState<'about' | 'license' | null>(null)
  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null)
  const restored = useRef(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('webgmt-theme', dark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [dark])

  // ---------------------------------------------------------------- tabs
  const loadInto = useCallback(async (node: TreeNode) => {
    const doc = await loadDoc(node)
    setDocs((d) => ({ ...d, [node.id]: doc }))
  }, [])

  const openFile = useCallback(async (id: number) => {
    // a file that was just created is not in the live list yet, so ask the database
    const node = byId.get(id) ?? ((await db.nodes.get(id)) as TreeNode | undefined)
    if (!node || node.kind !== 'file') return
    setTabs((t) => (t.includes(id) ? t : [...t, id]))
    setActiveId(id)
    if (!docs[id]) void loadInto(node)
  }, [byId, docs, loadInto])

  const closeTabs = useCallback((ids: number[]) => {
    const gone = new Set(ids)
    setTabs((t) => {
      const next = t.filter((x) => !gone.has(x))
      setActiveId((a) => {
        if (a == null || !gone.has(a)) return a
        const at = t.indexOf(a)
        return next[Math.min(at, next.length - 1)] ?? null
      })
      return next
    })
    setDocs((d) => { const n = { ...d }; for (const id of ids) delete n[id]; return n })
    for (const id of ids) setTimeout(() => disposeModel(editorPath(id)), 50)
  }, [])

  const isDirty = (id: number) => { const d = docs[id]; return d?.kind === 'text' && d.text !== d.saved }

  const closeTab = (id: number) => {
    const name = byId.get(id)?.name ?? 'this file'
    if (isDirty(id) && !confirm(`"${name}" has unsaved changes. Close without saving?`)) return
    closeTabs([id])
  }

  // restore the previous session's tabs, or open the first script
  useEffect(() => {
    if (restored.current || nodesLive === undefined) return
    restored.current = true
    let saved: { tabs: number[]; active: number | null } | null = null
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') } catch { /* ignore */ }
    const ids = (saved?.tabs ?? []).filter((id) => byId.get(id)?.kind === 'file')
    if (ids.length) {
      setTabs(ids)
      const active = saved?.active != null && ids.includes(saved.active) ? saved.active : ids[0]
      setActiveId(active)
      for (const id of ids) void loadInto(byId.get(id)!)
    } else {
      const first = nodes.filter((n) => n.kind === 'file' && n.name.endsWith('.sh')).map((n) => ({ n, p: pathOf(byId, n.id) })).sort((a, b) => a.p.localeCompare(b.p))[0]
      if (first) void openFile(first.n.id)
    }
  }, [nodesLive, nodes, byId, loadInto, openFile])

  useEffect(() => {
    if (!restored.current) return
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs, active: activeId })) } catch { /* ignore */ }
  }, [tabs, activeId])

  // keep tabs in sync with the tree: drop deleted files, reload files replaced by an upload
  useEffect(() => {
    if (nodesLive === undefined || !restored.current) return
    const missing = tabs.filter((id) => !byId.has(id))
    if (missing.length) closeTabs(missing)
    for (const id of tabs) {
      const node = byId.get(id)
      const doc = docs[id]
      if (node && doc && doc.updatedAt !== node.updatedAt && !(doc.kind === 'text' && doc.text !== doc.saved)) void loadInto(node)
    }
  }, [nodesLive, byId, tabs, docs, closeTabs, loadInto])

  // ---------------------------------------------------------------- saving
  const save = useCallback(async (id = activeId) => {
    if (id == null) return
    const doc = docs[id]
    if (doc?.kind !== 'text' || doc.text === doc.saved) return
    const text = doc.text
    const updatedAt = await writeFile(id, enc.encode(text).buffer as ArrayBuffer)
    setDocs((d) => (d[id]?.kind === 'text' ? { ...d, [id]: { ...(d[id] as Extract<Doc, { kind: 'text' }>), saved: text, updatedAt } } : d))
  }, [activeId, docs])

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void saveRef.current() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const anyDirty = Object.values(docs).some((d) => d.kind === 'text' && d.text !== d.saved)
  useEffect(() => {
    if (!anyDirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [anyDirty])

  // ---------------------------------------------------------------- running
  const activeNode = activeId != null ? byId.get(activeId) : undefined
  const activeDoc = activeId != null ? docs[activeId] : undefined
  const activeLanguage = useMemo(
    () => (activeNode && activeDoc?.kind === 'text' ? classify(activeNode.name, enc.encode(activeDoc.text.slice(0, 256))).language : 'plaintext'),
    [activeNode, activeDoc],
  )
  const canRun = activeDoc?.kind === 'text' && activeLanguage === 'gmt'

  const run = useCallback(async () => {
    if (running || activeId == null || !activeNode || activeDoc?.kind !== 'text' || activeLanguage !== 'gmt') return
    const scriptId = activeId
    const content = activeDoc.text
    await save(scriptId) // running a script saves it first
    setRunning(true); setLogs([]); setMarkers({ id: scriptId, list: [] })
    const collected: LogEntry[] = []
    const onLog = (e: LogEntry) => { collected.push(e); setLogs((l) => [...l, e]) }
    // unsaved edits in any open tab are what the script should see
    const overrides = new Map<number, Uint8Array>()
    for (const [id, d] of Object.entries(docs)) if (d.kind === 'text' && d.text !== d.saved) overrides.set(Number(id), enc.encode(d.text))
    let status: 'ok' | 'error' = 'error'
    let ms = 0
    try {
      const files = await snapshotFiles(overrides)
      const r = await runScript(content, dirname(pathOf(byId, scriptId)), files, onLog)
      ms = r.durationMs
      if (r.figures.length) { setResult(r); setFigIndex(0) }
      ;(window as unknown as { __webgmtLast?: unknown }).__webgmtLast = r // debug/test hook: lets tests fetch the raw PostScript
      status = r.ok ? 'ok' : 'error'
      setMarkers({ id: scriptId, list: parseErrors(collected, content.split('\n').length) })
      onLog({ stream: 'info', text: r.ok ? `Done in ${Math.round(ms)} ms` : 'Finished with errors' })
    } catch (e) {
      onLog({ stream: 'stderr', text: `[ERROR]: ${(e as Error).message}` })
    }
    await db.history.add({ scriptId, executedAt: Date.now(), status, executionTimeMs: ms })
    setRunning(false)
  }, [running, activeId, activeNode, activeDoc, activeLanguage, docs, byId, save])

  // ---------------------------------------------------------------- rendering
  const tabInfos: TabInfo[] = tabs.flatMap((id) => {
    const n = byId.get(id)
    return n ? [{ id, name: n.name, path: pathOf(byId, id), dirty: isDirty(id) }] : []
  })

  const onInsertPath = (projectPath: string) => {
    if (activeDoc?.kind !== 'text' || activeId == null) return
    setInsert({ text: relative(dirname(pathOf(byId, activeId)), projectPath), nonce: Date.now() })
  }

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <FileExplorer nodes={nodes} activeId={activeId} onOpen={openFile} onDeleted={closeTabs} onInsertPath={onInsertPath} />
      <SidebarFooter onAbout={setAbout} />
    </div>
  )

  let body: React.ReactNode
  if (activeId == null || !activeNode) {
    body = <p className="p-4 text-sm text-slate-500">Open a file from the explorer, or create a new one.</p>
  } else if (!activeDoc) {
    body = <p className="p-4 text-sm text-slate-500">Loading…</p>
  } else if (activeDoc.kind === 'text') {
    body = (
      <MonacoGmtEditor
        path={editorPath(activeId)}
        language={activeLanguage}
        value={activeDoc.text}
        onChange={(text) => setDocs((d) => (d[activeId]?.kind === 'text' ? { ...d, [activeId]: { ...(d[activeId] as Extract<Doc, { kind: 'text' }>), text } } : d))}
        onRun={run}
        markers={markers.id === activeId ? markers.list : []}
        dark={dark}
        insertRequest={insert}
      />
    )
  } else if (activeDoc.kind === 'image') {
    body = <ImagePreview name={activeNode.name} data={activeDoc.data} mime={activeDoc.mime} />
  } else {
    body = <BinaryNotice name={activeNode.name} size={activeDoc.size} tooLarge={activeDoc.tooLarge} />
  }

  return (
    <div className="flex h-full flex-col">
      <Header dark={dark} onToggleTheme={() => setDark((d) => !d)} />
      <SplitLayout
        consoleCollapsed={consoleCollapsed}
        sidebar={sidebar}
        editor={
          <div className="flex h-full flex-col">
            <EditorTabs
              tabs={tabInfos}
              activeId={activeId}
              onActivate={setActiveId}
              onClose={closeTab}
              running={running}
              canRun={canRun}
              canSave={activeId != null && isDirty(activeId)}
              onRun={run}
              onSave={() => void save()}
            />
            <div className="min-h-0 flex-1">{body}</div>
          </div>
        }
        console={<ConsoleOutput logs={logs} collapsed={consoleCollapsed} onToggle={() => setConsoleCollapsed((c) => !c)} onClear={() => setLogs([])} />}
        viewer={<MapCanvasViewer result={result} index={figIndex} onIndex={setFigIndex} running={running} onExport={() => setExporting(true)} />}
      />
      {exporting && (
        <ExportModal
          result={result?.figures[Math.min(figIndex, result.figures.length - 1)] ?? null}
          script={activeDoc?.kind === 'text' ? activeDoc.text : ''}
          name={(activeNode?.name ?? 'figure').replace(/\.[^.]+$/, '')}
          onClose={() => setExporting(false)}
        />
      )}
      {about && <AboutModal initial={about} onClose={() => setAbout(null)} />}
    </div>
  )
}
