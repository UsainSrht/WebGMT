import { DownloadCancelled, sizeOf, trackedFetch, wasCancelled } from '../workers/trackedFetch'

/** Fetches GSHHG coastline files and bundled datasets on demand from /gmt and caches them in CacheStorage. */
const CACHE_NAME = 'webgmt-gshhg-v1'

export interface CoastFile {
  /** file served under /gmt/data */
  file: string
  /** name GMT will look for under share/coast (differs only for the full-resolution substitute) */
  mountAs: string
}

/** The full-resolution shorelines (binned_GSHHS_f.nc, 30 MiB) exceed Cloudflare Pages' 25 MiB file limit, so
 *  `-Df` is served from the high-resolution data instead. */
export const FULL_RES_NOTE = 'full-resolution GSHHG (-Df) is not bundled (file larger than the 25 MiB hosting limit); using high resolution (-Dh) shorelines instead'

/** Which coastline files does a `gmt coast` command need? `-D<res>` selects the resolution; automatic (-Da or no
 *  -D) lets GMT choose from the map scale, so all bundled shoreline resolutions are mounted. */
export function coastFilesFor(args: string[]): { files: CoastFile[]; notes: string[] } {
  const d = args.find((a) => a.startsWith('-D'))?.slice(2)
  const letter = d ? d.replace(/\+.*$/, '')[0]?.toLowerCase() : 'a'
  const notes: string[] = []
  const files: CoastFile[] = []
  const add = (file: string, mountAs = file) => { if (!files.some((f) => f.mountAs === mountAs)) files.push({ file, mountAs }) }
  const resolutions = ['c', 'l', 'i', 'h'].includes(letter ?? '') ? [letter!] : letter === 'f' ? ['f'] : ['c', 'l', 'i', 'h']
  for (const r of resolutions) {
    if (r === 'f') { add('binned_GSHHS_h.nc', 'binned_GSHHS_f.nc'); notes.push(FULL_RES_NOTE) }
    else add(`binned_GSHHS_${r}.nc`)
    if (args.some((a) => a.startsWith('-N'))) add(`binned_border_${r}.nc`)
    if (args.some((a) => a.startsWith('-I'))) add(`binned_river_${r}.nc`)
  }
  return { files, notes }
}

/** dir is the folder under /gmt/ the file is served from: 'data' (coastlines) or 'remote' (tutorial data, earth_relief) */
export async function loadDataFile(name: string, dir: 'data' | 'remote' = 'data'): Promise<ArrayBuffer | null> {
  const url = `/gmt/${dir}/${name}`
  try {
  let cache: Cache | null = null
  try { cache = await caches.open(CACHE_NAME) } catch { /* CacheStorage can be unavailable (private mode, blocked storage) */ }
  const hit = cache ? await cache.match(url) : undefined
  if (hit) return await hit.arrayBuffer() // already downloaded earlier: no progress to show
  // The page shows this download (size, speed, cancel); a cancelled download rejects with DownloadCancelled.
  const res = await trackedFetch(url, `${dir === 'data' ? 'Coastline data' : 'Dataset'}: ${name}`, url, await sizeOf(`${dir}/${name}`))
  if (!res) return null
  if (cache) { try { await cache.put(url, res.clone()) } catch { /* caching is best effort */ } }
  return await res.arrayBuffer()
  } catch (e) {
    if (e instanceof DownloadCancelled) throw e // the user cancelled: stop the run
    if (wasCancelled(url)) throw new DownloadCancelled(name)
    return null // not deployed / network error: reported by the caller
  }
}
