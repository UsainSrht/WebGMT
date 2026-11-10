// npm run bench:native -- [--reps 10] [--warmup 2] [--only name,name] [--cpus 1]
// Builds the native GMT 6.6.0 image (first time only: about 15 minutes) and times the workloads in it.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { args, machine } from '../lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const bench = path.resolve(here, '..')
const root = path.resolve(bench, '..')
const a = args()
const reps = +(a.reps ?? 10), warmup = +(a.warmup ?? 2), cpus = String(a.cpus ?? 1)
const wdir = typeof a.dir === 'string' ? path.resolve(a.dir) : path.join(bench, 'workloads')
const results = typeof a.out === 'string' ? path.resolve(a.out) : path.join(bench, 'results')
mkdirSync(results, { recursive: true })

const docker = (...p) => spawnSync('docker', p, { stdio: 'inherit' })
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) { console.error('Docker is not running. Start Docker Desktop and try again.'); process.exit(1) }
if (a['no-build'] !== true && docker('build', '-t', 'webgmt-bench-native', here).status !== 0) process.exit(1)

for (const f of ['native.tsv', 'native-version.txt']) rmSync(path.join(results, f), { force: true })
const env = ['-e', `REPS=${reps}`, '-e', `WARMUP=${warmup}`, ...(a.only ? ['-e', `ONLY=${a.only}`] : [])]
const run = docker('run', '--rm', `--cpus=${cpus}`, ...env,
  '-v', `${path.join(root, 'public', 'gmt', 'remote')}:/data:ro`, '-v', `${wdir}:/workloads:ro`, '-v', `${results}:/out`,
  'webgmt-bench-native')
if (run.status !== 0 || !existsSync(path.join(results, 'native.tsv'))) process.exit(1)

const [head, ...lines] = readFileSync(path.join(results, 'native.tsv'), 'utf8').trim().split('\n')
const cols = head.split('\t')
const runs = lines.map((l) => { const v = l.split('\t'); const o = Object.fromEntries(cols.map((c, i) => [c, v[i]])); return { workload: o.workload, iter: +o.iter, totalMs: +o.total_ms, engineMs: +o.engine_ms, endMs: +o.end_ms, peakKB: +o.peak_kb, psBytes: +o.ps_bytes, ok: +o.status === 0 } })
const version = readFileSync(path.join(results, 'native-version.txt'), 'utf8').trim()
const stdout = {}
for (const n of new Set(runs.map((r) => r.workload))) { const f = path.join(results, 'logs', `${n}.txt`); if (existsSync(f)) stdout[n] = readFileSync(f, 'utf8').trim() }
writeFileSync(path.join(results, 'native.json'), JSON.stringify({ kind: 'native', stdout, date: new Date().toISOString(), gmt: version, cpusLimit: +cpus, reps, warmup, machine: machine(), runs }, null, 1))
console.log(`native: ${runs.length} runs written to bench/results/native.json (GMT ${version}, ${cpus} CPU)`)
