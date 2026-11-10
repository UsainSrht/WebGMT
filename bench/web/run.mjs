// npm run bench:web -- [--reps 10] [--warmup 2] [--only name,name] [--chrome <path>] [--headed]
// Builds the benchmark page, serves it together with the production engine and data from public/gmt, and times the
// workloads in headless Chrome. Cold start uses a fresh browser profile; "second visit" reloads in the same profile.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, createReadStream, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, machine } from '../lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const bench = path.resolve(here, '..')
const root = path.resolve(bench, '..')
const a = args()
const reps = +(a.reps ?? 10), warmup = +(a.warmup ?? 2)
const only = typeof a.only === 'string' ? a.only.split(',') : null
const wdir = typeof a.dir === 'string' ? path.resolve(a.dir) : path.join(bench, 'workloads')
const results = typeof a.out === 'string' ? path.resolve(a.out) : path.join(bench, 'results')
mkdirSync(results, { recursive: true })

// ---- build the benchmark page (never the website)
const dist = path.join(root, 'dist-bench')
if (a['no-build'] !== true) {
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(bench, 'vite.config.ts')], { stdio: 'inherit', cwd: root })
  if (r.status !== 0) process.exit(1)
}
for (const f of ['gmt/gmt.wasm', 'gmt/gmt.js']) {
  if (!existsSync(path.join(root, 'public', f))) { console.error(`public/${f} is missing: the engine is not built (see docs/COMPILING-GMT-TO-WASM.md).`); process.exit(1) }
}

// ---- static server with the website's isolation and caching headers
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.txt': 'text/plain' }
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = url.startsWith('/gmt/') ? path.join(root, 'public', url) : path.join(dist, url === '/' ? 'index.html' : url)
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end() }
  const st = statSync(file)
  const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`
  const headers = {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    ETag: etag,
  }
  if (url.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  else if (url.startsWith('/gmt/data/') || url.startsWith('/gmt/remote/')) headers['Cache-Control'] = 'public, max-age=604800'
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end() }
  res.writeHead(200, { ...headers, 'Content-Length': st.size })
  createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

// ---- headless Chrome over the DevTools protocol
const chromePath = typeof a.chrome === 'string' ? a.chrome : [
  process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p))
if (!chromePath) { console.error('Chrome not found: pass --chrome <path> or set CHROME.'); process.exit(1) }
const profile = mkdtempSync(path.join(os.tmpdir(), 'webgmt-bench-'))
const port = 9300 + Math.floor(Math.random() * 600)
const flags = [a.headed ? null : '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1200,800', 'about:blank'].filter(Boolean)
const chrome = spawn(chromePath, flags, { stdio: 'ignore' })
const cleanup = () => { try { chrome.kill() } catch { /* gone */ } server.close(); try { rmSync(profile, { recursive: true, force: true }) } catch { /* locked */ } }
process.on('exit', cleanup)

let tabs
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500))
  try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.some((t) => t.type === 'page')) break } catch { /* not up yet */ }
}
if (!tabs) { console.error('could not start Chrome'); process.exit(1) }
const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const waiting = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
await send('Runtime.enable')
await send('Page.enable')
const load = async () => {
  await send('Page.navigate', { url: base })
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (await ev('window.benchReady === true').catch(() => false)) return }
  throw new Error('bench page did not load')
}

// Resident memory of the whole browser process tree (the Wasm heap lives in the renderer), in bytes.
function browserRss() {
  const rows = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize)" }'], { encoding: 'utf8' }).stdout
    : spawnSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).stdout
  const mult = process.platform === 'win32' ? 1 : 1024
  const procs = rows.trim().split('\n').map((l) => l.trim().split(' ').filter(Boolean).map(Number))
  const ids = new Set([chrome.pid])
  for (let grew = true; grew;) { grew = false; for (const [p, pp] of procs) if (ids.has(pp) && !ids.has(p)) { ids.add(p); grew = true } }
  return procs.filter(([p]) => ids.has(p)).reduce((s, [, , m]) => s + (m || 0) * mult, 0)
}

// ---- workloads
const defs = JSON.parse(readFileSync(path.join(wdir, 'workloads.json'), 'utf8')).filter((w) => !only || only.includes(w.name))
const dataNames = (w) => w.data.filter((d) => existsSync(path.join(root, 'public', 'gmt', 'remote', d)))
const script = (n) => readFileSync(path.join(wdir, `${n}.sh`), 'utf8')
const arg1 = (w) => JSON.stringify({ name: w.name, script: script(w.name), data: dataNames(w) })
const probe = JSON.stringify({ name: 'basemap', script: readFileSync(path.join(bench, 'workloads', 'basemap.sh'), 'utf8'), data: [] })

await load()
const info = JSON.parse(await ev('JSON.stringify(bench.info())'))
if (!info.isolated) console.warn('warning: page is not cross-origin isolated; memory numbers will be unavailable')

const idleRss = browserRss()
console.log('first visit (empty browser cache) ...')
const cold = JSON.parse(await ev(`bench.coldStart(${probe}).then(JSON.stringify)`))
console.log(`  ${cold.ms.toFixed(0)} ms (engine: ${cold.engine})`)
if (cold.engine !== 'wasm') { console.error('the real GMT engine did not load; refusing to benchmark the mock engine'); process.exit(1) }

const runs = []
const firsts = {}
const memory = {}
const outputs = {}
for (const w of defs) {
  process.stdout.write(`${w.name} ... `)
  const r = JSON.parse(await ev(`bench.workload(${arg1(w)}, ${reps}, ${warmup}).then(JSON.stringify)`))
  runs.push(...r.runs); firsts[w.name] = r.first; outputs[w.name] = r.stdout; memory[w.name] = browserRss()
  const bad = r.runs.filter((x) => !x.ok).length
  console.log(bad ? `${bad} of ${r.runs.length} runs reported errors` : 'ok')
}

console.log('second visit (same profile, cached engine and data) ...')
await load()
const warm = JSON.parse(await ev(`bench.coldStart(${probe}).then(JSON.stringify)`))
console.log(`  ${warm.ms.toFixed(0)} ms`)

writeFileSync(path.join(results, 'web.json'), JSON.stringify({
  kind: 'web', date: new Date().toISOString(), browser: version, cores: info.cores, isolated: info.isolated, reps, warmup,
  machine: machine(), startup: { firstVisitMs: cold.ms, secondVisitMs: warm.ms }, firstRunMs: firsts, idleRssBytes: idleRss, rssBytes: memory, runs, stdout: outputs,
}, null, 1))
console.log(`web: ${runs.length} runs written to bench/results/web.json (${version})`)
cleanup()
process.exit(0)
