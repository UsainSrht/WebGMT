// Turns a drop event into a flat list of files, walking dropped folders (File System Access "entries").
export interface DroppedFile {
  /** folder names above the file, outermost first ([] for a loose file) */
  dirs: string[]
  /** null for an empty folder */
  file: File | null
}

type Entry = FileSystemEntry

const readAll = (reader: FileSystemDirectoryReader) =>
  new Promise<Entry[]>((resolve, reject) => {
    const all: Entry[] = []
    const next = () => reader.readEntries((batch) => { if (batch.length === 0) resolve(all); else { all.push(...batch); next() } }, reject) // readEntries returns max ~100 per call
    next()
  })

async function walk(entry: Entry, dirs: string[], out: DroppedFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    out.push({ dirs, file })
  } else if (entry.isDirectory) {
    const inner = [...dirs, entry.name]
    const children = await readAll((entry as FileSystemDirectoryEntry).createReader())
    // an empty folder still has to exist after the drop
    if (children.length === 0) out.push({ dirs: inner, file: null })
    for (const child of children) await walk(child, inner, out)
  }
}

/** Must be called synchronously inside the drop handler (the DataTransfer is cleared afterwards). */
export function collectDrop(dt: DataTransfer): Promise<DroppedFile[]> {
  const entries: Entry[] = []
  const loose: File[] = []
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue
    const e = item.webkitGetAsEntry?.()
    if (e) entries.push(e)
    else { const f = item.getAsFile(); if (f) loose.push(f) }
  }
  return (async () => {
    const out: DroppedFile[] = loose.map((file) => ({ dirs: [], file }))
    for (const e of entries) await walk(e, [], out)
    return out
  })()
}
