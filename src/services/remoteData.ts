// GMT's "@name" remote files (tutorial data, @earth_relief_*) normally come from the GMT data server. A browser
// cannot download them (the server sends no CORS headers), so WebGMT ships the ones it can under /gmt/remote/ and
// rewrites "@name" arguments to the bundled copy. Pure logic: the worker does the fetching and mounting.

/** Where the bundled copies appear in the Wasm file system. */
export const REMOTE_DIR = '/gmt-remote'

export interface RemoteFile {
  /** file under /gmt/remote/ on the web server */
  file: string
}

export interface RemoteResolution {
  args: string[]
  files: RemoteFile[]
  notes: string[]
}

/** Tutorial and example files that are bundled unchanged. */
const PLAIN = new Set(['tut_data.txt', 'tut_quakes.ngdc', 'tut_ship.xyz', 'tut_bathy.nc', 'tut_relief.nc', 'otemp.anal1deg.nc'])

/** Global earth_relief grids that are bundled (pixel registered), by resolution. */
const GLOBAL: Record<string, string> = { '01d': 'earth_relief_01d_p.grd', '30m': 'earth_relief_30m_p.grd', '10m': 'earth_relief_10m_p.grd', '05m': 'earth_relief_05m_p.grd' }
const FALLBACK = '10m'

/** The finer tiled datasets are too big to bundle. The tutorial's 30 arc-second region is bundled as a subset of the
 *  real data (it is what `gmt grdcut @earth_relief_30s -R-108/-103/35/40` produces). */
const SUBSETS: Record<string, { file: string; w: number; e: number; s: number; n: number }> = {
  '30s': { file: 'tut_relief.nc', w: -108, e: -103, s: 35, n: 40 },
}

/** First -R<w>/<e>/<s>/<n> of the command as numbers, or null (-Rg, -R<code>, -R<grid>, no -R, ...). */
export function parseRegion(args: string[]): [number, number, number, number] | null {
  const r = args.find((a) => a.startsWith('-R'))
  if (!r) return null
  const parts = r.slice(2).replace(/\+.*$/, '').split('/')
  if (parts.length !== 4) return null
  const nums = parts.map(Number)
  return nums.every((n) => Number.isFinite(n)) && parts.every((p) => p.trim() !== '') ? (nums as [number, number, number, number]) : null
}

const NAME = /@([A-Za-z0-9_.]+)/g

/** Rewrites the "@name" arguments of one GMT command to bundled files; returns null when there is nothing to do. */
export function resolveRemote(args: string[]): RemoteResolution | null {
  const files: RemoteFile[] = []
  const notes: string[] = []
  const region = parseRegion(args)
  let touched = false

  const use = (file: string) => { if (!files.some((f) => f.file === file)) files.push({ file }); return `${REMOTE_DIR}/${file}` }

  const out = args.map((arg) => {
    if (!arg.includes('@')) return arg
    return arg.replace(NAME, (whole, raw: string) => {
      const name = raw.replace(/\.$/, '') // a trailing dot is punctuation ("+u@.")
      if (PLAIN.has(name)) { touched = true; return use(name) + raw.slice(name.length) }
      const m = /^earth_relief_(\d\d[dms])(?:_([gp]))?$/.exec(name)
      if (!m) return whole
      touched = true
      const res = m[1]
      if (GLOBAL[res]) return use(GLOBAL[res])
      const sub = SUBSETS[res]
      if (sub && region && region[0] >= sub.w && region[1] <= sub.e && region[2] >= sub.s && region[3] <= sub.n) return use(sub.file)
      notes.push(
        `@${name} (${res}) is not available offline` +
        (sub ? ` outside ${sub.w}/${sub.e}/${sub.s}/${sub.n}` : '') +
        `; using the bundled ${FALLBACK} global grid instead (coarser than requested)`,
      )
      return use(GLOBAL[FALLBACK])
    })
  })
  return touched ? { args: out, files, notes } : null
}
