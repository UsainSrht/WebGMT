/// <reference lib="webworker" />
// fetch() with progress reporting and cancellation, for the engine and data downloads made inside the GMT worker.
// Progress goes to the page through `sink`; the page can cancel by id (see cancelDownload).
import type { DownloadEvent } from '../types'

type Sink = (ev: DownloadEvent) => void
let sink: Sink = () => {}
export const setDownloadSink = (s: Sink) => { sink = s }

export class DownloadCancelled extends Error {
  constructor(label: string) { super(`download cancelled: ${label}`); this.name = 'DownloadCancelled' }
}

const controllers = new Map<string, AbortController>()
const cancelled = new Set<string>()
export const cancelDownload = (id: string) => { const c = controllers.get(id); if (c) { cancelled.add(id); c.abort() } }
/** True when the last download with this id was cancelled by the user. The browser may wrap the cancellation in a
 *  generic error (WebAssembly.instantiateStreaming does), so callers check this instead of the error type. */
export const wasCancelled = (id: string) => cancelled.has(id)

/** Raw (decoded) sizes of everything under /gmt, written at build time by scripts/gen-manifest.mjs. */
let manifest: Promise<Record<string, number>> | null = null
export function sizeOf(path: string): Promise<number> {
  manifest ??= fetch('/gmt/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
  return manifest.then((m) => m[path] ?? 0)
}

/** Starts the download and returns a Response whose body reports progress while it is read, or null when the file is
 *  not deployed (the SPA fallback answers with HTML). Reading the body of a cancelled download throws DownloadCancelled. */
export async function trackedFetch(id: string, label: string, url: string, total: number): Promise<Response | null> {
  const ac = new AbortController()
  controllers.set(id, ac)
  cancelled.delete(id)
  sink({ event: 'start', id, label, total })
  const finish = (status: 'done' | 'error' | 'cancelled', error?: string) => {
    controllers.delete(id)
    sink({ event: 'end', id, status, error })
  }
  let res: Response
  try {
    res = await fetch(url, { signal: ac.signal })
  } catch (e) {
    if (ac.signal.aborted) { finish('cancelled'); throw new DownloadCancelled(label) }
    finish('error', (e as Error).message)
    throw e
  }
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html') || !res.body) {
    finish('error', `${res.status} ${res.statusText}`.trim())
    return null
  }
  const reader = res.body.getReader()
  let loaded = 0
  let lastPost = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { sink({ event: 'progress', id, loaded }); finish('done'); controller.close(); return }
        loaded += value.length
        const now = performance.now()
        if (now - lastPost >= 100) { lastPost = now; sink({ event: 'progress', id, loaded }) }
        controller.enqueue(value)
      } catch (e) {
        if (ac.signal.aborted) { finish('cancelled'); controller.error(new DownloadCancelled(label)) }
        else { finish('error', (e as Error).message); controller.error(e) }
      }
    },
    cancel(reason) { cancelled.add(id); ac.abort(); void reader.cancel(reason) },
  })
  return new Response(body, { status: 200, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' } })
}
