import type { Figure, LogEntry, RenderResult, WorkerFile, WorkerRequest, WorkerResponse } from '../types'
import { applyDownloadEvent } from './downloadStore'

let gmtWorker: Worker | null = null
let psWorker: Worker | null = null
let nextId = 1
const pendingRuns = new Map<number, { onLog: (e: LogEntry) => void; resolve: (r: RenderResult) => void }>()
const pendingPs = new Map<number, (r: { svg?: string; warnings?: string[]; error?: string }) => void>()

function getWorkers() {
  if (!gmtWorker) {
    gmtWorker = new Worker(new URL('../workers/gmt.worker.ts', import.meta.url), { type: 'module' })
    gmtWorker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
      const m = e.data
      if (m.type === 'download') { const { type: _t, ...ev } = m; return applyDownloadEvent(ev) }
      // id -1 = worker-level message not tied to a run: route to the active run
      const p = pendingRuns.get(m.id) ?? [...pendingRuns.values()][0]
      if (m.type === 'log') return p?.onLog(m.entry)
      if (!p) return
      pendingRuns.delete(m.id)
      let ok = m.ok
      const figures: Figure[] = []
      for (const f of m.figures) {
        if (f.ps) {
          const r = await renderPs(f.ps.slice(0))
          if (r.svg) {
            figures.push({ name: f.name, svg: r.svg, ps: f.ps })
            r.warnings?.slice(0, 5).forEach((w) => p.onLog({ stream: 'info', text: `PS renderer (${f.name}): ${w}` }))
          } else {
            ok = false
            p.onLog({ stream: 'stderr', text: `[ERROR]: PostScript rendering of "${f.name}" failed: ${r.error}` })
          }
        } else if (f.svg) figures.push({ name: f.name, svg: f.svg })
      }
      p.resolve({ figures, engine: m.engine, durationMs: m.durationMs, ok })
    }
  }
  if (!psWorker) {
    psWorker = new Worker(new URL('../workers/psRenderer.worker.ts', import.meta.url), { type: 'module' })
    psWorker.onmessage = (e) => {
      const { id, ...rest } = e.data
      pendingPs.get(id)?.(rest)
      pendingPs.delete(id)
    }
  }
}

function renderPs(ps: ArrayBuffer) {
  getWorkers()
  const id = nextId++
  return new Promise<{ svg?: string; warnings?: string[]; error?: string }>((resolve) => {
    pendingPs.set(id, resolve)
    psWorker!.postMessage({ id, ps }, [ps])
  })
}

/** cwd: the script's folder (project-relative); files: the whole project, named by project path. */
export function runScript(script: string, cwd: string, files: WorkerFile[], onLog: (e: LogEntry) => void): Promise<RenderResult> {
  getWorkers()
  const id = nextId++
  return new Promise((resolve) => {
    pendingRuns.set(id, { onLog, resolve })
    gmtWorker!.postMessage({ type: 'run', id, script, cwd, files: files.map((f) => ({ name: f.name, data: f.data.slice(0) })) })
  })
}

/** Starts loading the engine in the background so the first Run does not wait for the download. Data files are
 *  still fetched only when a script needs them. */
export function warmup() {
  getWorkers()
  gmtWorker!.postMessage({ type: 'warmup' } satisfies WorkerRequest)
}

/** Cancels a download shown in the download indicator. */
export function cancelDownload(id: string) {
  gmtWorker?.postMessage({ type: 'cancel-download', id } satisfies WorkerRequest)
}
