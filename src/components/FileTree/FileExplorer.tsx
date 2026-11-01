import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, ChevronsDownUp, File as FileIcon, FileCode, FileImage, FilePlus, FileText, FileUp, Folder,
  FolderOpen, FolderPlus,
} from 'lucide-react'
import {
  ROOT, childrenMap, createFile, createFolder, deleteNode, isDescendant, mkdirp, moveNode, pathOf, putFile, renameNode,
  type TreeNode,
} from '../../services/fsService'
import { collectDrop, type DroppedFile } from '../../lib/dropEntries'
import { isScriptName, kindFromName } from '../../lib/fileTypes'

interface Props {
  nodes: TreeNode[]
  /** file shown in the active editor tab */
  activeId: number | null
  onOpen: (id: number) => void | Promise<void>
  onDeleted: (ids: number[]) => void
  onInsertPath: (relativeToProjectRoot: string) => void
}

type Editing = { kind: 'rename'; id: number } | { kind: 'create'; what: 'file' | 'folder'; parentId: number }
type Menu = { x: number; y: number; id: number }

const EXPANDED_KEY = 'webgmt-expanded'
const NODE_MIME = 'application/x-webgmt-node'

function loadExpanded(): Set<number> {
  try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as number[]) } catch { return new Set() }
}

function iconFor(n: TreeNode, open: boolean) {
  if (n.kind === 'folder') return open ? <FolderOpen size={15} className="shrink-0 text-amber-500" /> : <Folder size={15} className="shrink-0 text-amber-500" />
  if (isScriptName(n.name)) return <FileCode size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
  const k = kindFromName(n.name)
  if (k === 'image') return <FileImage size={15} className="shrink-0 text-violet-500" />
  if (k === 'binary') return <FileIcon size={15} className="shrink-0 text-slate-400" />
  return <FileText size={15} className="shrink-0 text-slate-500" />
}

/** A small floating chip that follows the cursor while dragging an item. */
function setDragPreview(e: React.DragEvent, n: TreeNode) {
  const el = document.createElement('div')
  const dark = document.documentElement.classList.contains('dark')
  el.style.cssText = `position:fixed;top:-100px;left:-100px;padding:4px 10px 4px 8px;border-radius:6px;font:12px Inter,system-ui,sans-serif;display:flex;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(0,0,0,.35);border:1px solid ${dark ? '#475569' : '#cbd5e1'};background:${dark ? '#1e293b' : '#fff'};color:${dark ? '#f1f5f9' : '#0f172a'}`
  const dot = document.createElement('span')
  dot.style.cssText = `width:10px;height:10px;border-radius:${n.kind === 'folder' ? '2px' : '50%'};background:${n.kind === 'folder' ? '#f59e0b' : '#3b82f6'}`
  el.append(dot, document.createTextNode(n.name))
  document.body.appendChild(el)
  e.dataTransfer.setDragImage(el, 12, 14)
  setTimeout(() => el.remove(), 0)
}

export function FileExplorer({ nodes, activeId, onOpen, onDeleted, onInsertPath }: Props) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const kids = useMemo(() => childrenMap(nodes), [nodes])
  const [expanded, setExpanded] = useState<Set<number>>(loadExpanded)
  const [selected, setSelected] = useState<number>(ROOT)
  const [editing, setEditing] = useState<Editing | null>(null)
  // read synchronously by commitEdit so Enter followed by the input losing focus cannot commit twice
  const editingRef = useRef<Editing | null>(null)
  const setEdit = (v: Editing | null) => { editingRef.current = v; setEditing(v) }
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [zoneOver, setZoneOver] = useState(false)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const dragId = useRef<number | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<number>(ROOT)

  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])) } catch { /* ignore */ }
  }, [expanded])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), notice.error ? 6000 : 3000)
    return () => window.clearTimeout(t)
  }, [notice])

  // reveal the file of the active tab (only when the tab changes, so the user's own selection is not overridden)
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  useEffect(() => {
    const map = byIdRef.current
    if (activeId == null || !map.has(activeId)) return
    setSelected(activeId)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let n = map.get(map.get(activeId)!.parentId); n; n = map.get(n.parentId)) next.add(n.id)
      return next.size === prev.size ? prev : next
    })
  }, [activeId])

  // close the context menu on any outside click / Escape
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', key) }
  }, [menu])

  const fail = (e: unknown) => setNotice({ text: (e as Error).message, error: true })
  const info = (text: string) => setNotice({ text, error: false })
  const expand = (id: number) => id !== ROOT && setExpanded((p) => (p.has(id) ? p : new Set(p).add(id)))

  /** where new items and uploads go: the selected folder, or the folder of the selected file, or the root */
  const targetFolder = (): number => {
    const n = byId.get(selected)
    return !n ? ROOT : n.kind === 'folder' ? n.id : n.parentId
  }
  const folderLabel = (id: number) => (id === ROOT ? '/' : `/${pathOf(byId, id)}/`)

  const startCreate = (what: 'file' | 'folder', parentId = targetFolder()) => { expand(parentId); setMenu(null); setEdit({ kind: 'create', what, parentId }) }

  const commitEdit = async (value: string) => {
    const ed = editingRef.current
    if (!ed) return
    setEdit(null)
    const name = value.trim()
    try {
      if (ed.kind === 'rename') {
        await renameNode(ed.id, name)
      } else if (name) {
        if (ed.what === 'folder') { const f = await createFolder(ed.parentId, name); expand(f.id); setSelected(f.id) }
        else { const f = await createFile(ed.parentId, name); setSelected(f.id); onOpen(f.id) }
      }
    } catch (e) { fail(e) }
  }

  const remove = async (id: number) => {
    const n = byId.get(id)
    if (!n) return
    setMenu(null)
    let count = 0
    const walk = (p: number) => { for (const c of kids.get(p) ?? []) { count++; walk(c.id) } }
    walk(id)
    const msg = n.kind === 'folder' ? `Delete folder "${n.name}"${count ? ` and its ${count} item${count === 1 ? '' : 's'}` : ''}?` : `Delete "${n.name}"?`
    if (!confirm(msg)) return
    try { onDeleted(await deleteNode(id)); if (selected === id) setSelected(ROOT) } catch (e) { fail(e) }
  }

  const importDropped = async (items: DroppedFile[], target: number) => {
    let files = 0
    try {
      for (const it of items) {
        const folder = it.dirs.length ? await mkdirp(target, it.dirs) : target
        if (it.file) { await putFile(folder, it.file.name, await it.file.arrayBuffer()); files++ }
      }
      expand(target)
      info(`Added ${files} file${files === 1 ? '' : 's'} to ${folderLabel(target)}`)
    } catch (e) { fail(e) }
  }

  const move = async (id: number, target: number) => {
    try { await moveNode(id, target); expand(target) } catch (e) { fail(e) }
  }

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  /** Shared drag-over logic. `target` is the folder that would receive the drop. */
  const dragOver = (e: React.DragEvent, target: number, expandOnHover?: number) => {
    const internal = dragId.current != null
    if (!internal && !hasFiles(e)) return
    if (internal && target !== ROOT && isDescendant(byId, target, dragId.current!)) return // folder onto itself
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
    if (dropTarget !== target) setDropTarget(target)
    if (expandOnHover != null && !expanded.has(expandOnHover) && hoverTimer.current === undefined) {
      hoverTimer.current = window.setTimeout(() => { hoverTimer.current = undefined; expand(expandOnHover) }, 600)
    }
  }

  const clearHover = () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = undefined }

  const drop = (e: React.DragEvent, target: number) => {
    e.preventDefault()
    e.stopPropagation()
    clearHover()
    setDropTarget(null); setZoneOver(false)
    if (dragId.current != null) { const id = dragId.current; dragId.current = null; void move(id, target) }
    else if (hasFiles(e)) { const p = collectDrop(e.dataTransfer); void p.then((items) => importDropped(items, target)) } // collectDrop must start inside the event
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return
    if (e.key === 'F2' && selected !== ROOT) { e.preventDefault(); setEdit({ kind: 'rename', id: selected }) }
    else if (e.key === 'Delete' && selected !== ROOT) { e.preventDefault(); void remove(selected) }
  }

  const nameInput = (initial: string, placeholder: string, depth: number, icon: React.ReactNode) => (
    <div className="flex items-center gap-1 py-0.5 pr-2" style={{ paddingLeft: 6 + depth * 14 + 16 }}>
      {icon}
      <input
        autoFocus
        defaultValue={initial}
        placeholder={placeholder}
        onFocus={(e) => { const dot = initial.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length) }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') void commitEdit(e.currentTarget.value)
          else if (e.key === 'Escape') setEdit(null)
        }}
        onBlur={(e) => void commitEdit(e.currentTarget.value)}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded border border-blue-500 bg-white px-1 py-0 text-sm outline-none dark:bg-slate-950"
        aria-label={placeholder}
      />
    </div>
  )

  const renderRows = (parentId: number, depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = []
    if (editing?.kind === 'create' && editing.parentId === parentId) {
      rows.push(<div key="__create">{nameInput('', editing.what === 'file' ? 'File name' : 'Folder name', depth, editing.what === 'file' ? <FileText size={15} className="shrink-0 text-slate-500" /> : <Folder size={15} className="shrink-0 text-amber-500" />)}</div>)
    }
    for (const n of kids.get(parentId) ?? []) {
      const isFolder = n.kind === 'folder'
      const open = isFolder && expanded.has(n.id)
      const renaming = editing?.kind === 'rename' && editing.id === n.id
      const target = isFolder ? n.id : n.parentId
      const isDrop = dropTarget === n.id && isFolder
      if (renaming) {
        rows.push(<div key={n.id}>{nameInput(n.name, 'Name', depth, iconFor(n, open))}</div>)
      } else {
        rows.push(
          <div
            key={n.id}
            role="treeitem"
            aria-expanded={isFolder ? open : undefined}
            aria-selected={selected === n.id}
            draggable
            title={pathOf(byId, n.id)}
            onClick={(e) => {
              e.stopPropagation()
              setSelected(n.id)
              if (isFolder) setExpanded((p) => { const x = new Set(p); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x })
              else onOpen(n.id)
            }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelected(n.id); setMenu({ x: e.clientX, y: e.clientY, id: n.id }) }}
            onDragStart={(e) => {
              dragId.current = n.id
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(NODE_MIME, String(n.id))
              e.dataTransfer.setData('text/plain', pathOf(byId, n.id))
              setDragPreview(e, n)
            }}
            onDragEnd={() => { dragId.current = null; setDropTarget(null); clearHover() }}
            onDragOver={(e) => dragOver(e, target, isFolder ? n.id : undefined)}
            onDragLeave={() => { if (dropTarget === n.id) setDropTarget(null); if (isFolder) clearHover() }}
            onDrop={(e) => drop(e, target)}
            style={{ paddingLeft: 6 + depth * 14 }}
            className={`flex cursor-pointer select-none items-center gap-1 py-[3px] pr-2 text-sm ${
              isDrop ? 'bg-blue-200/70 ring-1 ring-inset ring-blue-500 dark:bg-blue-900/50'
              : dropTarget === target && !isFolder && dropTarget !== ROOT ? 'bg-blue-100/60 dark:bg-blue-900/20'
              : selected === n.id ? 'bg-blue-100 dark:bg-blue-900/40'
              : 'hover:bg-slate-200 dark:hover:bg-slate-800'
            } ${dragId.current === n.id ? 'opacity-50' : ''}`}
          >
            <span className="flex w-3.5 shrink-0 justify-center text-slate-500">{isFolder ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</span>
            {iconFor(n, open)}
            <span className={`min-w-0 flex-1 truncate ${n.id === activeId ? 'font-semibold' : ''}`}>{n.name}</span>
          </div>,
        )
      }
      if (open) rows.push(...renderRows(n.id, depth + 1))
    }
    return rows
  }

  const menuNode = menu && menu.id !== ROOT ? byId.get(menu.id) : undefined
  const item = 'block w-full px-3 py-1 text-left text-sm hover:bg-blue-600 hover:text-white'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 py-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Explorer</h3>
        <div className="flex items-center gap-0.5">
          <button onClick={() => startCreate('file')} className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="New file" title="New file"><FilePlus size={15} /></button>
          <button onClick={() => startCreate('folder')} className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="New folder" title="New folder"><FolderPlus size={15} /></button>
          <button onClick={() => setExpanded(new Set())} className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Collapse all folders" title="Collapse all"><ChevronsDownUp size={15} /></button>
        </div>
      </div>

      <div
        role="tree"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={() => setSelected(ROOT)}
        onContextMenu={(e) => { e.preventDefault(); setSelected(ROOT); setMenu({ x: e.clientX, y: e.clientY, id: ROOT }) }}
        onDragOver={(e) => dragOver(e, ROOT)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => drop(e, ROOT)}
        className={`min-h-0 flex-1 overflow-y-auto pb-2 outline-none ${dropTarget === ROOT ? 'bg-blue-100/60 ring-1 ring-inset ring-blue-500 dark:bg-blue-900/20' : ''}`}
      >
        {renderRows(ROOT, 0)}
        {nodes.length === 0 && !editing && <p className="px-3 py-2 text-xs text-slate-500">Empty project. Create a file or drop files here.</p>}
      </div>

      {notice && (
        <p role="status" className={`mx-2 mb-1 rounded px-2 py-1 text-xs ${notice.error ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'}`}>{notice.text}</p>
      )}

      <div
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setZoneOver(true) } }}
        onDragLeave={() => setZoneOver(false)}
        onDrop={(e) => drop(e, targetFolder())}
        onClick={() => { uploadTarget.current = targetFolder(); fileInput.current?.click() }}
        className={`mx-2 mb-2 flex cursor-pointer flex-col items-center gap-0.5 rounded border-2 border-dashed p-2 text-center text-xs ${zoneOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-300 dark:border-slate-600'}`}
      >
        <FileUp size={16} />
        <span>Drop files or click to upload</span>
        <span className="max-w-full truncate text-[10px] text-slate-500">to {folderLabel(targetFolder())}</span>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []).map((file) => ({ dirs: [] as string[], file }))
            e.target.value = ''
            if (list.length) void importDropped(list, uploadTarget.current)
          }}
        />
      </div>

      {menu && (
        <div
          role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 190) }}
          className="fixed z-50 w-44 overflow-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          {menuNode?.kind === 'file' && <button role="menuitem" className={item} onClick={() => { setMenu(null); onOpen(menuNode.id) }}>Open</button>}
          {(!menuNode || menuNode.kind === 'folder') && (
            <>
              <button role="menuitem" className={item} onClick={() => startCreate('file', menuNode ? menuNode.id : ROOT)}>New file</button>
              <button role="menuitem" className={item} onClick={() => startCreate('folder', menuNode ? menuNode.id : ROOT)}>New folder</button>
              <button role="menuitem" className={item} onClick={() => { setMenu(null); uploadTarget.current = menuNode ? menuNode.id : ROOT; fileInput.current?.click() }}>Upload files here</button>
            </>
          )}
          {menuNode && (
            <>
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
              {menuNode.kind === 'file' && <button role="menuitem" className={item} onClick={() => { setMenu(null); onInsertPath(pathOf(byId, menuNode.id)) }}>Insert path in editor</button>}
              <button role="menuitem" className={item} onClick={() => { setMenu(null); setEdit({ kind: 'rename', id: menuNode.id }) }}>Rename <span className="float-right opacity-60">F2</span></button>
              <button role="menuitem" className={`${item} text-red-600 hover:text-white dark:text-red-400`} onClick={() => void remove(menuNode.id)}>Delete <span className="float-right opacity-60">Del</span></button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
