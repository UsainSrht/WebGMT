// npm run bench:check [-- --no-build]
// Do both sides compute the same thing? Runs the scripts in bench/check/ once on native GMT and once in WebGMT and
// compares what they print (grid statistics, data ranges, colour tables). Numbers must agree to 6 significant digits.
// Exit code 1 if anything differs. Results go to a temporary folder, not bench/results.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { args } from './lib.mjs'

const bench = path.dirname(fileURLToPath(import.meta.url))
const out = mkdtempSync(path.join(os.tmpdir(), 'webgmt-check-'))
const extra = args()['no-build'] ? ['--no-build'] : []
const common = ['--dir', path.join(bench, 'check'), '--out', out, '--reps', '1', '--warmup', '0']
for (const side of ['native', 'web']) {
  const r = spawnSync(process.execPath, [path.join(bench, side, 'run.mjs'), ...common, ...extra], { stdio: 'inherit' })
  if (r.status !== 0) { console.error(`${side} run failed`); process.exit(1) }
}
const native = JSON.parse(readFileSync(path.join(out, 'native.json'), 'utf8')).stdout
const web = JSON.parse(readFileSync(path.join(out, 'web.json'), 'utf8')).stdout
rmSync(out, { recursive: true, force: true })

const lines = (t) => (t ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const same = (a, b) => {
  const x = a.split(/\s+/), y = b.split(/\s+/)
  if (x.length !== y.length) return false
  return x.every((v, i) => {
    if (v === y[i]) return true
    const p = Number(v), q = Number(y[i])
    return Number.isFinite(p) && Number.isFinite(q) && Math.abs(p - q) <= 1e-6 * Math.max(Math.abs(p), Math.abs(q), 1e-12)
  })
}
let bad = 0
console.log('\nscript'.padEnd(18) + 'lines  result')
for (const name of Object.keys(native)) {
  const a = lines(native[name]), b = lines(web[name])
  const diffs = []
  if (a.length !== b.length) diffs.push(`line count ${a.length} native vs ${b.length} WebGMT`)
  a.forEach((l, i) => { if (b[i] !== undefined && !same(l, b[i])) diffs.push(`native: ${l}\n    web:    ${b[i]}`) })
  if (!a.length) diffs.push('native printed nothing')
  console.log(name.padEnd(18) + String(a.length).padEnd(7) + (diffs.length ? 'DIFFERENT' : 'same'))
  if (diffs.length) { bad++; for (const d of diffs.slice(0, 3)) console.log('    ' + d) }
}
console.log(bad ? `\n${bad} script(s) differ` : '\nall outputs agree')
process.exit(bad ? 1 : 0)
