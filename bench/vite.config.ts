// Builds the benchmark page only. Separate from the website's vite.config.ts: output goes to dist-bench/,
// which is never deployed. The page uses the same worker source as the website.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.join(here, 'web'),
  base: './',
  publicDir: false,
  define: { __APP_VERSION__: JSON.stringify('bench') },
  worker: { format: 'es' },
  build: { outDir: path.join(here, '..', 'dist-bench'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
})
