// Benchmark page: drives the real GMT worker (same source as the website) and times it. Not part of the website.
import { psToSvg } from '../../src/workers/psInterpreter'

interface Workload { name: string; script: string; data: string[] }
interface RunResult { workload: string; iter: number; engineMs: number; roundtripMs: number; svgMs: number; psBytes: number; svgBytes: number; ok: boolean }

const dataFiles = new Map<string, ArrayBuffer>()
async function file(name: string): Promise<ArrayBuffer | null> {
  if (!dataFiles.has(name)) {
    const r = await fetch(`/gmt/remote/${name}`)
    if (!r.ok) return null
    dataFiles.set(name, await r.arrayBuffer())
  }
  return dataFiles.get(name)!
}

let worker: Worker | null = null
let nextId = 1
let stdout: string[] = []
const pending = new Map<number, (m: any) => void>()
function newWorker() {
  worker?.terminate()
  pending.clear()
  worker = new Worker(new URL('../../src/workers/gmt.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'log' && m.entry.stream === 'stdout') stdout.push(m.entry.text)
    else if (m.type === 'result') pending.get(m.id)?.(m)
  }
  return worker
}

async function runOnce(script: string, data: string[]) {
  const files: { name: string; data: ArrayBuffer }[] = []
  for (const n of data) { const d = await file(n); if (d) files.push({ name: n, data: d }) }
  const id = nextId++
  stdout = []
  const t0 = performance.now()
  const done = new Promise<any>((resolve, reject) => { pending.set(id, resolve); setTimeout(() => reject(new Error('timeout')), 600_000) })
  worker!.postMessage({ type: 'run', id, script, cwd: '', files: files.map((f) => ({ name: f.name, data: f.data.slice(0) })) })
  const m = await done
  const roundtripMs = performance.now() - t0
  let svgMs = 0, psBytes = 0, svgBytes = 0
  for (const f of m.figures as { ps?: ArrayBuffer }[]) {
    if (!f.ps) continue
    psBytes += f.ps.byteLength
    const t = performance.now()
    const { svg } = psToSvg(f.ps)
    svgMs += performance.now() - t
    svgBytes += svg.length
  }
  return { ok: m.ok as boolean, engineMs: m.durationMs as number, roundtripMs, svgMs, psBytes, svgBytes, engine: m.engine as string, stdout: stdout.join('\n') }
}

const api = {
  info: () => ({ userAgent: navigator.userAgent, isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency }),
  /** A new worker and the first run on it: engine download (or cache), compile, instantiate, run. */
  async coldStart(w: Workload) {
    const t0 = performance.now()
    newWorker()
    const r = await runOnce(w.script, w.data)
    return { ms: performance.now() - t0, engine: r.engine, ok: r.ok, runMs: r.engineMs }
  },
  /** Warm-up runs, then measured runs, on the current (already loaded) engine. */
  async workload(w: Workload, reps: number, warmup: number) {
    if (!worker) newWorker()
    const runs: RunResult[] = []
    let first: { engineMs: number } | null = null
    let lastStdout = ''
    for (let i = 0; i < warmup + reps; i++) {
      const r = await runOnce(w.script, w.data)
      if (i === 0) first = { engineMs: r.engineMs }
      lastStdout = r.stdout
      if (i < warmup) continue
      runs.push({ workload: w.name, iter: i - warmup + 1, engineMs: r.engineMs, roundtripMs: r.roundtripMs, svgMs: r.svgMs, psBytes: r.psBytes, svgBytes: r.svgBytes, ok: r.ok })
    }
    return { runs, first, stdout: lastStdout }
  },
}
;(window as any).bench = api
;(window as any).benchReady = true
