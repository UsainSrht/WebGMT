// Writes public/gmt/manifest.json: the raw size in bytes of every file the app downloads on demand from /gmt.
// The download indicator needs the real size because compressed transfers (Brotli) report only the encoded length.
// Runs before dev and build (see package.json). Run: node scripts/gen-manifest.mjs
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = 'public/gmt'
const manifest = {}
const add = (rel) => { const p = path.join(root, rel); if (existsSync(p) && statSync(p).isFile()) manifest[rel.split(path.sep).join('/')] = statSync(p).size }
add('gmt.wasm'); add('gmt.js')
for (const dir of ['data', 'remote']) {
  const d = path.join(root, dir)
  if (existsSync(d)) for (const f of readdirSync(d).sort()) add(path.join(dir, f))
}
if (existsSync(root)) writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
console.log(`manifest: ${Object.keys(manifest).length} files`)
