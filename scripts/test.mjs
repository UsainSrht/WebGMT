// Runs tests/*.test.ts: each file is bundled with esbuild (already a dependency of vite) and executed with node.
import { build } from 'esbuild'
import { readdirSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const out = path.resolve('node_modules/.cache/webgmt-tests')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

let failed = 0
for (const f of readdirSync('tests').filter((n) => n.endsWith('.test.ts'))) {
  const outfile = path.join(out, f.replace(/\.ts$/, '.mjs'))
  await build({ entryPoints: [path.join('tests', f)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' })
  const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  if (r.status !== 0) failed++
}
if (failed) { console.error(`${failed} test file(s) failed`); process.exit(1) }
console.log('all tests passed')
