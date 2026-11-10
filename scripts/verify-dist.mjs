// Cloudflare Pages build verification: static output, headers present, no server code.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
const fail = (m) => { console.error('verify:dist FAILED -', m); process.exit(1) }
if (!existsSync('dist/index.html')) fail('dist/index.html missing (run npm run build)')
if (!existsSync('dist/_headers')) fail('dist/_headers missing')
const h = readFileSync('dist/_headers', 'utf8')
if (!h.includes('Cross-Origin-Opener-Policy: same-origin') || !h.includes('Cross-Origin-Embedder-Policy: require-corp')) fail('COOP/COEP headers missing in _headers')
if (readdirSync('dist/assets').length === 0) fail('no assets emitted')
// The benchmark (bench/) is for people who run it themselves: nothing of it may be in the deployed site.
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]))
for (const f of walk('dist')) {
  if (/(^|\/)bench[\w.-]*\.(js|html|mjs|json)$/i.test(f) || /dist\/bench\//.test(f)) fail('benchmark file in the production build: ' + f)
  if (/\.(js|html)$/.test(f) && /WebGMT benchmark page|window\.bench\b|benchReady/.test(readFileSync(f, 'utf8'))) fail('benchmark code in the production build: ' + f)
}
const hasWasm = existsSync('dist/gmt/gmt.wasm') && existsSync('dist/gmt/gmt.js')
console.log('verify:dist OK. GMT wasm engine bundled:', hasWasm ? 'yes' : 'no (mock fallback engine will be used)')
