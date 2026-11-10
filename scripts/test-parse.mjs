// npm run test:parse [-- --quick]
// Checks docker/fast_strtod.c (the fast number parsing linked into the WebAssembly engine) against Emscripten's own
// libc, the reference of the real build: the value must be identical bit for bit and the end pointer / return value
// the same, for every short string over a small alphabet, hand-picked edge cases and tens of millions of random numbers.
// Takes about 5 minutes; --quick uses fewer random strings (about 25 s). Needs Docker. See docs/ENGINE-PERFORMANCE.md.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docker')
const count = process.argv.includes('--quick') ? '3000000' : '60000000'
const cmd = `cd /tmp && emcc -O2 /d/fast_strtod_test.c /d/fast_strtod.c -o t.js -sALLOW_MEMORY_GROWTH=1 && node t.js ${count}`
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) { console.error('Docker is not running.'); process.exit(1) }
const r = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/d:ro`, 'emscripten/emsdk:6.0.13', 'bash', '-c', cmd], { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
process.exit(r.status ?? 1)
