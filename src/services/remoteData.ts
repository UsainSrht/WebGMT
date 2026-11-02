// GMT's "@name" remote files (tutorial data, @earth_relief_*) normally come from the GMT data server. A browser
// cannot download them (the server sends no CORS headers), so WebGMT ships the ones it can under /gmt/remote/ and
// rewrites "@name" arguments to the bundled copy. Pure logic: the worker does the fetching and mounting.
import { SERVER_CACHE_FILES } from './serverCacheFiles'

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
  /** how to get data WebGMT does not have (download link, how to add it to the project), one line each */
  hints: string[]
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

const SERVER = 'https://oceania.generic-mapping-tools.org'
/** Resolutions the server offers as one downloadable .grd file; everything finer is a folder of JPEG 2000 tiles. */
const SINGLE_FILE_RES = new Set(['01d', '30m', '20m', '15m', '10m', '06m'])
const DATASET = /^(earth|moon|mars|mercury|venus|pluto)_([a-z0-9]+)_(\d\d[dms])(?:_([gp]))?$/

/** The -R of the command if it is numeric (so the hint can be pasted), else a placeholder. */
function regionText(args: string[]): string {
  const r = args.find((a) => a.startsWith('-R'))
  return r && parseRegion(args) ? r.replace(/\+.*$/, '') : '-R<west>/<east>/<south>/<north>'
}

const WHY = "WebGMT cannot download it: GMT's data server does not allow requests from web pages, and this dataset is not bundled."

/** How to get a server dataset (@earth_geoid_10m, @earth_relief_01m, ...) into WebGMT by hand. */
export function datasetHint(name: string, args: string[]): string[] {
  const m = DATASET.exec(name)
  if (!m) return []
  const [, body, what, res, reg] = m
  const family = `${body}_${what}`
  if (SINGLE_FILE_RES.has(res)) {
    const file = `${family}_${res}_${reg ?? 'p'}.grd`
    return [
      `@${name}: ${WHY}`,
      `It is a single file: download ${SERVER}/server/${body}/${family}/${file} , drag it into the file explorer (next to your script) and write ${file} instead of @${name} in the script.`,
    ]
  }
  return [
    `@${name}: ${WHY}`,
    `This resolution is a set of very large JPEG 2000 tiles. On a computer with GMT installed, cut just the region you need: gmt grdcut @${name} ${regionText(args)} -Gregion.nc`,
    `Then drag region.nc into the file explorer (next to your script) and write region.nc instead of @${name} in the script. Several regions: use one file each.`,
  ]
}

/** How to get a server cache file (@name.ext) into WebGMT by hand. */
export function cacheFileHint(name: string): string[] {
  return [
    `@${name}: ${WHY}`,
    `Download ${SERVER}/cache/${name} , drag it into the file explorer (next to your script) and write ${name} (without the @) in the script.`,
  ]
}

/** Rewrites the "@name" arguments of one GMT command to bundled files, and explains how to add the data we do not
 *  have; returns null when there is nothing to do. */
export function resolveRemote(args: string[]): RemoteResolution | null {
  const files: RemoteFile[] = []
  const notes: string[] = []
  const hints: string[] = []
  const hinted = new Set<string>()
  const hint = (name: string, lines: string[]) => { if (!hinted.has(name)) { hinted.add(name); hints.push(...lines) } }
  const region = parseRegion(args)
  let touched = false

  const use = (file: string) => { if (!files.some((f) => f.file === file)) files.push({ file }); return `${REMOTE_DIR}/${file}` }

  const out = args.map((arg) => {
    if (!arg.includes('@')) return arg
    return arg.replace(NAME, (whole, raw: string) => {
      const name = raw.replace(/\.$/, '') // a trailing dot is punctuation ("+u@.")
      if (PLAIN.has(name)) { touched = true; return use(name) + raw.slice(name.length) }
      const m = /^earth_relief_(\d\d[dms])(?:_([gp]))?$/.exec(name)
      if (!m) {
        if (DATASET.test(name)) hint(name, datasetHint(name, args))
        else if (SERVER_CACHE_FILES.has(name)) hint(name, cacheFileHint(name)) // a real server file we do not bundle
        return whole
      }
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
      hint(name, datasetHint(name, args))
      return use(GLOBAL[FALLBACK])
    })
  })
  return touched || hints.length ? { args: out, files, notes, hints } : null
}
