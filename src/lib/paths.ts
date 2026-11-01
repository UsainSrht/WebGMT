// Small POSIX-style path helpers shared by the UI, the worker and the tests. Paths are relative to the project
// root, use "/" and never start or end with "/" ("" is the root).

/** Resolves "." and ".." and strips leading/trailing/duplicate slashes. ".." above the root is dropped. */
export function normalize(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

export const join = (...parts: string[]) => normalize(parts.join('/'))

export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** Lower-case extension without the dot ("" when there is none; dot-files such as ".bashrc" have none). */
export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase()
}

/** Resolves a name used inside a script (relative to the script's folder, or absolute = from the project root). */
export function resolveFrom(cwd: string, name: string): string {
  return name.startsWith('/') ? normalize(name) : normalize(`${cwd}/${name}`)
}

/** Path of `to` as seen from the directory `fromDir` ("../data/x.dat" style). */
export function relative(fromDir: string, to: string): string {
  const a = normalize(fromDir).split('/').filter(Boolean)
  const b = normalize(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

/** "name.ext" -> "name (2).ext" until it is not in `taken`. */
export function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const c = `${stem} (${n})${ext}`
    if (!taken.has(c)) return c
  }
}

/** null when `name` is acceptable as a single file or folder name, otherwise the reason it is not. */
export function validateName(name: string): string | null {
  if (!name.trim()) return 'Name cannot be empty'
  if (name === '.' || name === '..') return `"${name}" is not a valid name`
  if (/[\\/\0]/.test(name)) return 'Names cannot contain / or \\'
  if (name.length > 200) return 'Name is too long'
  return null
}
