// npm run bench:compare -- [--write-docs]
// Joins bench/results/native.json and web.json into a Markdown table (bench/results/REPORT.md, printed too).
// --write-docs also copies it to docs/BENCHMARKS.md.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, median } from './lib.mjs'

const bench = path.dirname(fileURLToPath(import.meta.url))
const res = path.join(bench, 'results')
const read = (n) => (existsSync(path.join(res, n)) ? JSON.parse(readFileSync(path.join(res, n), 'utf8')) : null)
const native = read('native.json'), web = read('web.json')
if (!native && !web) { console.error('No results yet: run npm run bench:native and npm run bench:web.'); process.exit(1) }

const names = [...new Set([...(native?.runs ?? []), ...(web?.runs ?? [])].map((r) => r.workload))]
const pick = (d, n, f) => (d?.runs ?? []).filter((r) => r.workload === n && r.ok).map(f)
const stat = (v) => (v.length ? { m: median(v), lo: Math.min(...v), hi: Math.max(...v), n: v.length } : null)
const ms = (s) => (s ? (s.m >= 1000 ? `${(s.m / 1000).toFixed(2)} s` : `${s.m.toFixed(0)} ms`) : 'n/a')
const rng = (s) => (s ? `${s.lo.toFixed(0)}-${s.hi.toFixed(0)}` : '')
const ratio = (w, n) => (w && n ? `${(w.m / n.m).toFixed(1)}x` : 'n/a')
const mb = (b) => (b ? `${(b / 2 ** 20).toFixed(0)} MB` : 'n/a')

// gmt calls per script (other than `gmt end`): each one is a process start natively
const callsOf = (n) => {
  const f = path.join(bench, 'workloads', n + '.sh')
  return existsSync(f) ? [...readFileSync(f, 'utf8').matchAll(/\bgmt\s+([a-z0-9]+)/g)].filter((x) => x[1] !== 'end').length : 0
}
const startup = stat(pick(native, 'noop', (r) => r.engineMs))?.m ?? 0

const L = []
L.push('# WebGMT vs native GMT CLI', '')
L.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`npm run bench:compare\`. Medians of ${web?.reps ?? '?'} runs after ${web?.warmup ?? '?'} warm-ups; the range (min-max, ms) is in brackets.`, '')
L.push('| | |', '|---|---|')
if (native) L.push(`| Native | GMT ${native.gmt} in Docker, ${native.cpusLimit} CPU, OpenMP off |`)
if (web) L.push(`| WebGMT | GMT 6.6.0 Wasm + PostScript renderer in ${web.browser}, one worker |`)
const m = (web ?? native).machine
L.push(`| Machine | ${m.cpu}, ${m.logicalCpus} logical CPUs, ${m.memoryGB} GB, ${m.os} |`, '')

L.push('## Time per script', '')
L.push('Engine = GMT itself. Native engine is the time inside `gmt` calls other than `gmt end` (each call is a new process). WebGMT engine is one worker run, including staging the input files into its in-memory file system.')
L.push('Total = a finished figure: native adds `gmt end` (psconvert and Ghostscript), WebGMT adds its PostScript-to-SVG renderer. Scripts without a figure have the same engine and total.', '')
L.push('Native engine without start-up = native engine minus (number of gmt calls x the noop row). That is the fair engine-against-engine column; the plain engine column is what a user of the CLI actually waits.', '')
L.push('| Workload | Native engine | WebGMT engine | Engine ratio | Native without start-up | Ratio without start-up | Native total | WebGMT total | Total ratio |', '|---|---|---|---|---|---|---|---|---|')
for (const n of names) {
  const ne = stat(pick(native, n, (r) => r.engineMs)), nt = stat(pick(native, n, (r) => r.totalMs))
  const we = stat(pick(web, n, (r) => r.engineMs)), wt = stat(pick(web, n, (r) => r.roundtripMs + r.svgMs))
  const adj = ne && startup && n !== 'noop' ? { m: Math.max(1, ne.m - callsOf(n) * startup) } : null
  L.push(`| ${n} | ${ms(ne)} [${rng(ne)}] | ${ms(we)} [${rng(we)}] | ${ratio(we, ne)} | ${adj ? ms(adj) : '-'} | ${adj ? ratio(we, adj) : '-'} | ${ms(nt)} [${rng(nt)}] | ${ms(wt)} [${rng(wt)}] | ${ratio(wt, nt)} |`)
}
L.push('', 'A ratio above 1 means WebGMT is slower.', '')

if (web) {
  L.push('## WebGMT: where the time goes', '', '| Workload | GMT worker | PostScript to SVG | PostScript | SVG | First run (cold engine state) | Browser memory growth |', '|---|---|---|---|---|---|---|')
  for (const n of names) {
    const we = stat(pick(web, n, (r) => r.engineMs)), sv = stat(pick(web, n, (r) => r.svgMs)), ps = stat(pick(web, n, (r) => r.psBytes)), sg = stat(pick(web, n, (r) => r.svgBytes))
    const kb = (s) => (s && s.m ? `${(s.m / 1024).toFixed(0)} kB` : '-')
    L.push(`| ${n} | ${ms(we)} | ${sv && sv.m ? ms(sv) : '-'} | ${kb(ps)} | ${kb(sg)} | ${web.firstRunMs?.[n] ? ms({ m: web.firstRunMs[n].engineMs }) : 'n/a'} | ${web.rssBytes?.[n] ? mb(web.rssBytes[n] - web.idleRssBytes) : 'n/a'} |`)
  }
  L.push('', 'Memory growth is the resident memory of the whole Chrome process tree after the workload minus the idle browser; it includes the Wasm heap, which only grows within a session.', '')
}
if (native) {
  L.push('## Native: peak memory', '', '| Workload | Peak RSS of the script | PostScript |', '|---|---|---|')
  for (const n of names) {
    const pk = stat(pick(native, n, (r) => r.peakKB * 1024)), ps = stat(pick(native, n, (r) => r.psBytes))
    L.push(`| ${n} | ${pk ? mb(pk.m) : 'n/a'} | ${ps && ps.m ? `${(ps.m / 1024).toFixed(0)} kB` : '-'} |`)
  }
  L.push('')
}
if (web?.startup) {
  L.push('## Start-up', '', '| | Time to the first finished figure |', '|---|---|')
  L.push(`| First visit (empty cache: download, compile, run) | ${(web.startup.firstVisitMs / 1000).toFixed(2)} s |`)
  L.push(`| Second visit (cached engine and data) | ${(web.startup.secondVisitMs / 1000).toFixed(2)} s |`)
  if (native) {
    const b = stat(pick(native, 'basemap', (r) => r.totalMs))
    L.push(`| Native, one \`basemap\` script | ${ms(b)} |`)
  }
  L.push('', 'Both are served from this machine, so the first visit has no real network time in it: add the download of the engine (see the download indicator in the app) for your connection.', '')
}
L.push('## Caveats', '')
const nn = stat(pick(native, 'noop', (r) => r.engineMs)), wn = stat(pick(web, 'noop', (r) => r.engineMs))
L.push(`- Every native gmt call is a new process: ${nn ? ms(nn) : 'tens of ms'} for a trivial call here (noop row)${wn ? `, against ${ms(wn)} in the already running engine` : ''}. A script with several calls pays that several times, so rows under about 300 ms mostly measure process start-up, not GMT. Compare the heavy rows for the speed of the engine itself.`)
L.push('- Native runs in a Linux container on this machine; WebGMT in Chrome on the host. Same CPU, different operating system layers.')
L.push('- A native script starts one process per `gmt` call, WebGMT keeps one engine alive. That is a real difference between the two, not a measurement error.')
L.push('- Browser timers are coarsened by a few microseconds to a millisecond; the runs here are much longer than that.')
L.push('- Results change with browser version, power plan and background load: compare runs made on the same machine under the same conditions.')

const text = L.join('\n') + '\n'
writeFileSync(path.join(res, 'REPORT.md'), text)
console.log(text)
if (args()['write-docs']) { copyFileSync(path.join(res, 'REPORT.md'), path.join(bench, '..', 'docs', 'BENCHMARKS.md')); console.log('copied to docs/BENCHMARKS.md') }
