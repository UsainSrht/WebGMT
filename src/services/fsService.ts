// The project tree (files and folders) stored in IndexedDB. All operations validate names, so the UI only has
// to show the thrown message.
import { db } from '../db'
import { uniqueName, validateName } from '../lib/paths'
import type { NodeRecord } from '../types'

export const ROOT = 0

export type TreeNode = NodeRecord & { id: number }

const sortKey = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/** parentId -> sorted children (folders first, then names) */
export function childrenMap(nodes: TreeNode[]): Map<number, TreeNode[]> {
  const m = new Map<number, TreeNode[]>()
  for (const n of nodes) {
    const list = m.get(n.parentId)
    if (list) list.push(n)
    else m.set(n.parentId, [n])
  }
  for (const list of m.values()) list.sort(sortKey)
  return m
}

export function pathOf(byId: Map<number, TreeNode>, id: number): string {
  const parts: string[] = []
  for (let n = byId.get(id); n; n = byId.get(n.parentId)) parts.unshift(n.name)
  return parts.join('/')
}

export function isDescendant(byId: Map<number, TreeNode>, id: number, ancestorId: number): boolean {
  for (let n = byId.get(id); n; n = byId.get(n.parentId)) if (n.id === ancestorId) return true
  return false
}

function descendantIds(nodes: TreeNode[], id: number): number[] {
  const kids = childrenMap(nodes)
  const out: number[] = []
  const walk = (p: number) => { for (const c of kids.get(p) ?? []) { out.push(c.id); if (c.kind === 'folder') walk(c.id) } }
  walk(id)
  return out
}

async function siblingNamed(parentId: number, name: string) {
  return (await db.nodes.where('[parentId+name]').equals([parentId, name]).first()) as TreeNode | undefined
}

async function requireFolder(parentId: number) {
  if (parentId === ROOT) return
  const p = await db.nodes.get(parentId)
  if (!p || p.kind !== 'folder') throw new Error('Target folder no longer exists')
}

export async function createFolder(parentId: number, name: string): Promise<TreeNode> {
  name = name.trim()
  const bad = validateName(name)
  if (bad) throw new Error(bad)
  await requireFolder(parentId)
  if (await siblingNamed(parentId, name)) throw new Error(`"${name}" already exists here`)
  const now = Date.now()
  const id = (await db.nodes.add({ parentId, name, kind: 'folder', size: 0, createdAt: now, updatedAt: now })) as number
  return { id, parentId, name, kind: 'folder', size: 0, createdAt: now, updatedAt: now }
}

export async function createFile(parentId: number, name: string, data: ArrayBuffer = new ArrayBuffer(0)): Promise<TreeNode> {
  name = name.trim()
  const bad = validateName(name)
  if (bad) throw new Error(bad)
  await requireFolder(parentId)
  if (await siblingNamed(parentId, name)) throw new Error(`"${name}" already exists here`)
  const now = Date.now()
  const rec = { parentId, name, kind: 'file' as const, size: data.byteLength, createdAt: now, updatedAt: now }
  const id = await db.transaction('rw', db.nodes, db.blobs, async () => {
    const id = (await db.nodes.add(rec)) as number
    await db.blobs.put({ id, data })
    return id
  })
  return { ...rec, id }
}

/** Creates the file, or replaces its contents when it exists (uploads overwrite, like a file manager "replace"). */
export async function putFile(parentId: number, name: string, data: ArrayBuffer): Promise<TreeNode> {
  const existing = await siblingNamed(parentId, name)
  if (existing && existing.kind === 'file') { const updatedAt = await writeFile(existing.id, data); return { ...existing, size: data.byteLength, updatedAt } }
  if (existing) throw new Error(`A folder named "${name}" already exists here`)
  return createFile(parentId, name, data)
}

/** Finds or creates nested folders under parentId and returns the innermost id. */
export async function mkdirp(parentId: number, segments: string[]): Promise<number> {
  let cur = parentId
  for (const seg of segments) {
    const hit = await siblingNamed(cur, seg)
    if (hit) { if (hit.kind !== 'folder') throw new Error(`"${seg}" is a file`); cur = hit.id }
    else cur = (await createFolder(cur, seg)).id
  }
  return cur
}

export async function renameNode(id: number, name: string): Promise<void> {
  name = name.trim()
  const bad = validateName(name)
  if (bad) throw new Error(bad)
  const n = await db.nodes.get(id)
  if (!n) throw new Error('Item no longer exists')
  if (n.name === name) return
  if (await siblingNamed(n.parentId, name)) throw new Error(`"${name}" already exists here`)
  await db.nodes.update(id, { name }) // content unchanged, so updatedAt stays (open tabs would otherwise reload)
}

export async function moveNode(id: number, newParentId: number): Promise<void> {
  const all = (await db.nodes.toArray()) as TreeNode[]
  const byId = new Map(all.map((n) => [n.id, n]))
  const n = byId.get(id)
  if (!n) throw new Error('Item no longer exists')
  if (n.parentId === newParentId) return
  if (newParentId !== ROOT) {
    const target = byId.get(newParentId)
    if (!target || target.kind !== 'folder') throw new Error('Target is not a folder')
    if (isDescendant(byId, newParentId, id)) throw new Error('Cannot move a folder into itself')
  }
  if (await siblingNamed(newParentId, n.name)) throw new Error(`"${n.name}" already exists in the target folder`)
  await db.nodes.update(id, { parentId: newParentId })
}

/** Deletes the node and everything below it; returns every deleted id (so the UI can close their tabs). */
export async function deleteNode(id: number): Promise<number[]> {
  const all = (await db.nodes.toArray()) as TreeNode[]
  const ids = [id, ...descendantIds(all, id)]
  await db.transaction('rw', db.nodes, db.blobs, async () => {
    await db.nodes.bulkDelete(ids)
    await db.blobs.bulkDelete(ids)
  })
  return ids
}

export async function readFile(id: number): Promise<ArrayBuffer> {
  return (await db.blobs.get(id))?.data ?? new ArrayBuffer(0)
}

/** Returns the new modification time. */
export async function writeFile(id: number, data: ArrayBuffer): Promise<number> {
  const updatedAt = Date.now()
  await db.transaction('rw', db.nodes, db.blobs, async () => {
    await db.blobs.put({ id, data })
    await db.nodes.update(id, { size: data.byteLength, updatedAt })
  })
  return updatedAt
}

/** A free name for a new item in a folder: "untitled.sh", "untitled (2).sh", ... */
export async function freeName(parentId: number, wanted: string): Promise<string> {
  const names = new Set((await db.nodes.where('parentId').equals(parentId).toArray()).map((n) => n.name))
  return uniqueName(names, wanted)
}

/** Every file with its project path and contents (for running a script). `overrides` holds unsaved editor text. */
export async function snapshotFiles(overrides: Map<number, Uint8Array>): Promise<{ name: string; data: ArrayBuffer }[]> {
  const all = (await db.nodes.toArray()) as TreeNode[]
  const byId = new Map(all.map((n) => [n.id, n]))
  const out: { name: string; data: ArrayBuffer }[] = []
  for (const n of all) {
    if (n.kind !== 'file') continue
    const o = overrides.get(n.id)
    const data = o ? (o.slice().buffer as ArrayBuffer) : (await db.blobs.get(n.id))?.data ?? new ArrayBuffer(0)
    out.push({ name: pathOf(byId, n.id), data })
  }
  return out
}
