/// <reference lib="webworker" />
import { runShell, type ShellRuntime, type Vfs } from '../lib/shell'
import { createMock } from './mockEngine'
import { coastFilesFor, loadDataFile } from '../services/dataCacheService'
import type { LogEntry, WorkerRequest, WorkerResponse } from '../types'

const ctx = self as unknown as DedicatedWorkerGlobalScope
const WORKSPACE = '/workspace'
const SESSION_DIR = '/home/web_user/.gmt/sessions/gmt_session.webgmt'
const enc = new TextEncoder()
const dec = new TextDecoder()

type Figure = { name: string; ps?: ArrayBuffer; svg?: string }

let wasm: any | null = null
let wasmChecked = false
let currentLogger: ((e: LogEntry) => void) | null = null
let currentLine: number | undefined
// stdin for the GMT call in flight (set by the shell for `echo ... | gmt plot` and heredocs)
let stdinBuf: Uint8Array | null = null
let stdinPos = 0
// coastline files already written into the Wasm file system (it lives as long as the module instance)
const mounted = new Set<string>()

async function loadWasm() {
  if (wasmChecked) return wasm
  wasmChecked = true
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
    }
    wasm = await mod.default(cfg)
    const FS = wasm.FS
    for (const d of [WORKSPACE, '/gmt-install/share/coast']) {
      try { FS.mkdirTree(d) } catch { /* exists */ }
    }
    FS.chdir(WORKSPACE)
  } catch (e) {
    wasm = null
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

function cleanWorkspace(keep: Set<string>) {
  const FS = wasm.FS
  try { rmTree(SESSION_DIR) } catch { /* nothing to clean */ }
  for (const name of FS.readdir(WORKSPACE) as string[]) {
    if (name === '.' || name === '..' || keep.has(name)) continue
    try { FS.unlink(`${WORKSPACE}/${name}`) } catch { /* directory or busy */ }
  }
}

async function run(req: Extract<WorkerRequest, { type: 'run' }>) {
  const t0 = performance.now()
  const post = (m: WorkerResponse) => {
    const transfer: Transferable[] = []
    if (m.type === 'result') for (const f of m.figures) if (f.ps) transfer.push(f.ps)
    ctx.postMessage(m, transfer)
  }
  const log = (entry: LogEntry) => post({ type: 'log', id: req.id, entry })
  currentLogger = log

  const engine = await loadWasm()
  const figures: Figure[] = []
  let ok = true

  // ------------------------------------------------------------------ mock engine
  if (!engine) {
    const files = new Map<string, Uint8Array>()
    for (const f of req.files) files.set(f.name, new Uint8Array(f.data))
    log({ stream: 'info', text: 'Engine: built-in mock (no gmt.wasm found in /gmt/)' })
    const mock = createMock(files, (stream, text, line) => { if (stream === 'stderr') ok = false; log({ stream, text, line }) })
    let figN = 0
    const rt: ShellRuntime = {
      vfs: {
        read: (n) => files.get(n),
        write: (n, d, append) => { const o = files.get(n); files.set(n, append && o ? new Uint8Array([...o, ...d]) : d) },
        remove: (n) => { files.delete(n) },
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
    if (figures.length === 0 && ok) log({ stream: 'stderr', text: '[WARNING]: script produced no map' })
    post({ type: 'result', id: req.id, ok: ok && figures.length > 0, engine: 'mock', figures, durationMs: performance.now() - t0 })
    return
  }

  // ------------------------------------------------------------------ real GMT Wasm
  const FS = engine.FS
  cleanWorkspace(new Set(req.files.map((f) => f.name)))
  for (const f of req.files) FS.writeFile(`${WORKSPACE}/${f.name}`, new Uint8Array(f.data))
  let figName = 'figure'

  const vfs: Vfs = {
    read: (n) => { const p = `${WORKSPACE}/${n}`; return FS.analyzePath(p).exists ? (FS.readFile(p) as Uint8Array) : undefined },
    write: (n, d, append) => {
      const p = `${WORKSPACE}/${n}`
      const slash = p.lastIndexOf('/'); if (slash > WORKSPACE.length) { try { FS.mkdirTree(p.slice(0, slash)) } catch { /* exists */ } }
      if (append && FS.analyzePath(p).exists) { const o = FS.readFile(p) as Uint8Array; FS.writeFile(p, new Uint8Array([...o, ...d])) } else FS.writeFile(p, d)
    },
    remove: (n) => { try { FS.unlink(`${WORKSPACE}/${n}`) } catch { /* not there */ } },
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
        wasm = null; wasmChecked = false; mounted.clear()
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
    for (const n of (FS.readdir(WORKSPACE) as string[]).filter((n: string) => n.endsWith('.ps')).sort()) {
      figures.push({ name: n, ps: (FS.readFile(`${WORKSPACE}/${n}`) as Uint8Array).slice().buffer })
    }
  }
  if (figures.length === 0 && ok) log({ stream: 'stderr', text: '[WARNING]: no PostScript output was produced' })
  post({ type: 'result', id: req.id, ok: ok && figures.length > 0, engine: 'wasm', figures, durationMs: performance.now() - t0 })
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type === 'run') void run(e.data)
}
