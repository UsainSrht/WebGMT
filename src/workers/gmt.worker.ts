/// <reference lib="webworker" />
import { runShell, type ShellRuntime, type Vfs } from '../lib/shell'
import { dirname, normalize, relative, resolveFrom } from '../lib/paths'
import { createMock } from './mockEngine'
import { coastFilesFor, loadDataFile } from '../services/dataCacheService'
import { REMOTE_DIR, resolveRemote } from '../services/remoteData'
import { DownloadCancelled, cancelDownload, setDownloadSink, sizeOf, trackedFetch, wasCancelled } from './trackedFetch'
import type { LogEntry, WorkerRequest, WorkerResponse } from '../types'

const ctx = self as unknown as DedicatedWorkerGlobalScope
const WORKSPACE = '/workspace'
const SESSION_DIR = '/home/web_user/.gmt/sessions/gmt_session.webgmt'
const enc = new TextEncoder()
const dec = new TextDecoder()

type Figure = { name: string; ps?: ArrayBuffer; svg?: string }

let wasm: any | null = null
// one load in flight at a time: the warm-up and a first Run share it
let wasmPromise: Promise<any | null> | null = null
setDownloadSink((ev) => ctx.postMessage({ type: 'download', ...ev } satisfies WorkerResponse))
let currentLogger: ((e: LogEntry) => void) | null = null
let currentLine: number | undefined
// stdin for the GMT call in flight (set by the shell for `echo ... | gmt plot` and heredocs)
let stdinBuf: Uint8Array | null = null
let stdinPos = 0
// coastline files already written into the Wasm file system (it lives as long as the module instance)
const mounted = new Set<string>()

/** The engine, or null when none is deployed (then the mock engine is used). Throws DownloadCancelled if the user
 *  cancelled the download; the next call tries again. */
function loadWasm(): Promise<any | null> {
  wasmPromise ??= doLoadWasm().catch((e) => { wasmPromise = null; throw e })
  return wasmPromise
}

async function doLoadWasm() {
  try {
    const probe = await fetch('/gmt/gmt.js', { method: 'HEAD' })
    const type = probe.headers.get('content-type') ?? ''
    if (!probe.ok || type.includes('text/html')) return null
    const url = '/gmt/gmt.js'
    const mod = await import(/* @vite-ignore */ url)
    const cfg: Record<string, any> = {
      // libc copies the environment at startup, so variables must be set in preRun
      preRun: [() => { Object.assign(cfg.ENV, { GMT_SESSION_NAME: 'webgmt', HOME: '/home/web_user' }) }],
      print: (t: string) => currentLogger?.({ stream: 'stdout', text: t, line: currentLine }),
      printErr: (t: string) => currentLogger?.({ stream: 'stderr', text: t, line: currentLine }),
      stdin: () => (stdinBuf && stdinPos < stdinBuf.length ? stdinBuf[stdinPos++] : null),
      locateFile: (p: string) => `/gmt/${p}`,
      // download the wasm ourselves: compiles while it streams in, and the page shows progress / can cancel it
      instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
        void (async () => {
          try {
            const res = await trackedFetch('engine', 'GMT engine (gmt.wasm)', '/gmt/gmt.wasm', await sizeOf('gmt.wasm'))
            if (!res) throw new Error('gmt.wasm is not deployed')
            const r = await WebAssembly.instantiateStreaming(res, imports)
            done(r.instance, r.module)
          } catch (e) { failLoad(wasCancelled('engine') ? new DownloadCancelled('GMT engine (gmt.wasm)') : e) }
        })()
        return {}
      },
    }
    let failLoad: (e: unknown) => void = () => {}
    const failed = new Promise<never>((_, reject) => { failLoad = reject })
    wasm = await Promise.race([mod.default(cfg), failed])
    const FS = wasm.FS
    for (const d of [WORKSPACE, '/gmt-install/share/coast']) {
      try { FS.mkdirTree(d) } catch { /* exists */ }
    }
    FS.chdir(WORKSPACE)
  } catch (e) {
    wasm = null
    if (e instanceof DownloadCancelled) throw e
    ctx.postMessage({
      type: 'log',
      id: -1,
      entry: { stream: 'info', text: `GMT Wasm unavailable (${(e as Error).message}); using mock engine` },
    } satisfies WorkerResponse)
  }
  return wasm
}

function callGmt(module: string, args: string[]): number {
  const alloc = (s: string) => {
    const n = wasm.lengthBytesUTF8(s) + 1
    const p = wasm._malloc(n)
    wasm.stringToUTF8(s, p, n)
    return p
  }
  const argv = wasm._malloc(4 * Math.max(1, args.length))
  const ptrs = args.map(alloc)
  ptrs.forEach((p, i) => wasm.setValue(argv + 4 * i, p, 'i32'))
  const mod = alloc(module)
  try {
    return wasm._execute_gmt_command(mod, args.length, argv)
  } finally {
    ptrs.forEach((p) => wasm._free(p))
    wasm._free(mod)
    wasm._free(argv)
  }
}

/** Messages from modern-mode `gmt end` that are expected: Ghostscript (psconvert) is not available, and the
 *  session directory still holds the raw figure(s) that we render ourselves. */
const EXPECTED_END_NOISE = /psconvert|Ghostscript|gmtinit_process_figures|Directory not empty|Unable to remove directory|Failed to call psconvert/i

function rmTree(path: string) {
  const FS = wasm.FS
  if (!FS.analyzePath(path).exists) return
  for (const name of FS.readdir(path) as string[]) {
    if (name === '.' || name === '..') continue
    const p = `${path}/${name}`
    if (FS.isDir(FS.stat(p).mode)) rmTree(p)
    else FS.unlink(p)
  }
  FS.rmdir(path)
}

/** Raw (unconverted) figure PostScript left in the session dir by modern mode: gmt_<n>.ps- */
function readRawFigures(): ArrayBuffer[] {
  const FS = wasm.FS
  if (!FS.analyzePath(SESSION_DIR).exists) return []
  const names = (FS.readdir(SESSION_DIR) as string[]).filter((n) => /^gmt_\d+\.ps-$/.test(n)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)))
  return names.map((n) => (FS.readFile(`${SESSION_DIR}/${n}`) as Uint8Array).slice().buffer)
}

/** Empties the workspace (the project files are written fresh for every run). */
function cleanWorkspace() {
  const FS = wasm.FS
  try { rmTree(SESSION_DIR) } catch { /* nothing to clean */ }
  for (const name of FS.readdir(WORKSPACE) as string[]) {
    if (name === '.' || name === '..') continue
    const p = `${WORKSPACE}/${name}`
    try { if (FS.isDir(FS.stat(p).mode)) rmTree(p); else FS.unlink(p) } catch { /* busy */ }
  }
}

/** A cancelled download ends the run with an error instead of falling back to something else. */
async function run(req: Extract<WorkerRequest, { type: 'run' }>) {
  try {
    await runScript(req)
  } catch (e) {
    if (!(e instanceof DownloadCancelled)) throw e
    ctx.postMessage({ type: 'log', id: req.id, entry: { stream: 'stderr', text: `[ERROR]: ${e.message}` } } satisfies WorkerResponse)
    ctx.postMessage({ type: 'result', id: req.id, ok: false, engine: 'wasm', figures: [], durationMs: 0 } satisfies WorkerResponse)
  }
}

async function runScript(req: Extract<WorkerRequest, { type: 'run' }>) {
  const t0 = performance.now()
  const post = (m: WorkerResponse) => {
    const transfer: Transferable[] = []
    if (m.type === 'result') for (const f of m.figures) if (f.ps) transfer.push(f.ps)
    ctx.postMessage(m, transfer)
  }
  // bundled "@name" data lives under /gmt-remote; show the name the user typed
  const log = (entry: LogEntry) => post({ type: 'log', id: req.id, entry: { ...entry, text: entry.text.split(REMOTE_DIR + '/').join('') } })
  currentLogger = log

  const engine = await loadWasm()
  const figures: Figure[] = []
  let ok = true

  // ------------------------------------------------------------------ mock engine
  if (!engine) {
    // keys are paths as seen from the script's folder ("data.dat", "../shared/x.dat")
    const files = new Map<string, Uint8Array>()
    for (const f of req.files) files.set(relative(req.cwd, f.name), new Uint8Array(f.data))
    const key = (n: string) => relative('', resolveFrom('', n))
    log({ stream: 'info', text: 'Engine: built-in mock (no gmt.wasm found in /gmt/)' })
    const mock = createMock(files, (stream, text, line) => { if (stream === 'stderr') ok = false; log({ stream, text, line }) })
    let figN = 0
    const rt: ShellRuntime = {
      vfs: {
        read: (n) => files.get(key(n)),
        write: (n, d, append) => { const k = key(n); const o = files.get(k); files.set(k, append && o ? new Uint8Array([...o, ...d]) : d) },
        remove: (n) => { files.delete(key(n)) },
      },
      log: (stream, text, line) => { if (stream === 'stderr' && !text.startsWith('[WARNING]')) ok = false; log({ stream, text, line }) },
      async gmt(module, args, stdin, line) {
        const svg = mock.exec({ line, module, args }, stdin ? dec.decode(stdin) : undefined)
        if (svg) figures.push({ name: `figure ${++figN}`, svg })
        return { status: 0, stdout: new Uint8Array() }
      },
    }
    const r = await runShell(req.script, rt)
    ok = ok && r.ok
    if (figures.length === 0) { const svg = mock.finish(); if (svg) figures.push({ name: 'figure 1', svg }) }
    if (figures.length === 0 && ok) log({ stream: 'info', text: 'No figure was produced (no gmt begin ... gmt end block); the text output is above.' })
    post({ type: 'result', id: req.id, ok, engine: 'mock', figures, durationMs: performance.now() - t0 })
    return
  }

  // ------------------------------------------------------------------ real GMT Wasm
  const FS = engine.FS
  cleanWorkspace()
  for (const f of req.files) {
    const p = `${WORKSPACE}/${normalize(f.name)}`
    const dir = dirname(p)
    if (dir !== WORKSPACE) { try { FS.mkdirTree(dir) } catch { /* exists */ } }
    FS.writeFile(p, new Uint8Array(f.data))
  }
  // the script runs as if started from its own folder
  const cwdPath = `${WORKSPACE}${req.cwd ? '/' + normalize(req.cwd) : ''}`
  try { FS.mkdirTree(cwdPath) } catch { /* exists */ }
  FS.chdir(cwdPath)
  const at = (n: string) => `${WORKSPACE}/${resolveFrom(req.cwd, n)}`
  let figName = 'figure'

  const vfs: Vfs = {
    read: (n) => { const p = at(n); return FS.analyzePath(p).exists ? (FS.readFile(p) as Uint8Array) : undefined },
    write: (n, d, append) => {
      const p = at(n)
      { try { FS.mkdirTree(dirname(p)) } catch { /* exists */ } }
      if (append && FS.analyzePath(p).exists) { const o = FS.readFile(p) as Uint8Array; FS.writeFile(p, new Uint8Array([...o, ...d])) } else FS.writeFile(p, d)
    },
    remove: (n) => { try { FS.unlink(at(n)) } catch { /* not there */ } },
  }

  const rt: ShellRuntime = {
    vfs,
    log: (stream, text, line) => log({ stream, text, line }),
    async gmt(module, args0, stdin, line) {
      let args = args0
      if (module === 'begin') {
        // psconvert needs Ghostscript, so figures are rendered to PostScript and converted in the browser.
        figName = args[0] ?? 'figure'
        args = [figName, 'ps', ...args.slice(2)]
      } else if (module === 'figure') {
        figName = args[0] ?? figName
        if (args.length > 1 && !args[1].startsWith('-')) args = [args[0], 'ps', ...args.slice(2)]
      }
      // "@tut_data.txt", "@earth_relief_10m", ...: GMT would download these; use the bundled copies
      const remote = resolveRemote(args)
      if (remote) {
        args = remote.args
        for (const n of remote.notes) log({ stream: 'info', text: `[NOTE]: ${n}`, line })
        for (const f of remote.files) {
          if (mounted.has(REMOTE_DIR + '/' + f.file)) continue
          const data = await loadDataFile(f.file, 'remote')
          if (!data) { log({ stream: 'stderr', text: `[ERROR]: bundled data file ${f.file} is not deployed under /gmt/remote/`, line }); continue }
          try { FS.mkdirTree(REMOTE_DIR) } catch { /* exists */ }
          FS.writeFile(`${REMOTE_DIR}/${f.file}`, new Uint8Array(data))
          mounted.add(REMOTE_DIR + '/' + f.file)
        }
      }
      if (module === 'coast') {
        const need = coastFilesFor(args)
        for (const n of need.notes) log({ stream: 'info', text: `[NOTE]: ${n}`, line })
        for (const f of need.files) {
          if (mounted.has(f.mountAs)) continue
          const data = await loadDataFile(f.file)
          if (!data) { log({ stream: 'stderr', text: `[ERROR]: coastline dataset ${f.file} is not deployed under /gmt/data/`, line }); continue }
          FS.writeFile(`/gmt-install/share/coast/${f.mountAs}`, new Uint8Array(data))
          mounted.add(f.mountAs)
        }
      }
      currentLine = line
      log({ stream: 'info', text: `$ gmt ${module} ${args.join(' ')}`, line })

      const captured: string[] = []
      currentLogger = (e) => {
        if (e.stream === 'stdout') captured.push(e.text)
        else if (module === 'end' && EXPECTED_END_NOISE.test(e.text)) return
        else log(e)
      }
      stdinBuf = stdin; stdinPos = 0
      let status = -1
      let trapped = false
      const tStart = performance.now()
      try {
        status = callGmt(module, args)
        const ms = performance.now() - tStart
        if (ms > 1000) log({ stream: 'info', text: `(gmt ${module} took ${(ms / 1000).toFixed(1)} s)`, line })
      } catch (e) {
        trapped = true
        log({ stream: 'stderr', text: `[ERROR]: ${(e as Error).message}`, line })
      }
      stdinBuf = null
      currentLogger = log

      if (trapped) {
        // A Wasm trap leaves the module in an undefined state: drop it so the next run starts fresh.
        wasm = null; wasmPromise = null; mounted.clear()
        throw new Error('GMT crashed (WebAssembly trap)')
      }
      if (module === 'end') {
        const raws = readRawFigures()
        raws.forEach((ps, i) => figures.push({ name: raws.length > 1 ? `${figName} (${i + 1})` : figName, ps }))
        try { rmTree(SESSION_DIR) } catch { /* ignore */ }
        if (raws.length) status = 0   // the failure was only the missing Ghostscript conversion
      }
      if (status !== 0) log({ stream: 'stderr', text: `[ERROR]: ${module} exited with status ${status}`, line })
      return { status, stdout: enc.encode(captured.length ? captured.join('\n') + '\n' : '') }
    },
  }

  try {
    const r = await runShell(req.script, rt)
    ok = r.ok
  } catch (e) {
    ok = false
    log({ stream: 'stderr', text: `[ERROR]: ${(e as Error).message}` })
  }

  if (figures.length === 0) {
    // classic mode (no begin/end): look for PostScript files the script wrote
    for (const n of (FS.readdir(cwdPath) as string[]).filter((n: string) => n.endsWith('.ps')).sort()) {
      figures.push({ name: n, ps: (FS.readFile(`${cwdPath}/${n}`) as Uint8Array).slice().buffer })
    }
  }
  if (figures.length === 0 && ok) log({ stream: 'info', text: 'No figure was produced (no gmt begin ... gmt end block); the text output is above.' })
  post({ type: 'result', id: req.id, ok, engine: 'wasm', figures, durationMs: performance.now() - t0 })
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data
  if (m.type === 'run') void run(m)
  else if (m.type === 'cancel-download') cancelDownload(m.id)
  else if (m.type === 'warmup') void loadWasm().catch(() => { /* cancelled: the first Run asks again */ })
}
