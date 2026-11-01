# WebGMT

A serverless, client-side IDE for [GMT](https://www.generic-mapping-tools.org/) scripts. React 19 + TypeScript + Vite + Tailwind, Monaco editor, Dexie (IndexedDB) storage, GMT running in a Web Worker. Deployable to Cloudflare Pages.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # -> dist/
npm run verify:dist  # checks dist/ and the COOP/COEP headers file
```

## Engines

| Engine | When | What it does |
|---|---|---|
| **GMT Wasm** (deployed) | `public/gmt/gmt.js` + `gmt.wasm` exist | Real GMT 6.6.0 with real GSHHG coastlines (crude + low resolution). Output is PostScript, converted to SVG in the browser by `src/workers/psInterpreter.ts` |
| **Mock** (fallback) | no Wasm build present | Draws SVG directly for a **subset** of GMT (`basemap`, `coast` with crude hand-made outlines, `plot`, `text`, `makecpt`, `colorbar`, `contour`). It is not GMT and its output differs |

Verified on the Wasm engine: the three bundled examples, and ten real course scripts (time and log axes, text/fonts/equations, 3-D perspective plots, nine map projections, filled contours, `grdimage`/`grdview`, profiles with `gmt project`/`grdtrack`) compared against real GMT output, locally and on the deployed site. Not verified: other modules, very large inputs, non-Chromium browsers.

Known limits of the Wasm build:
- **No Ghostscript**, so `psconvert` fails. Modern-mode `gmt end` therefore reports a psconvert error, which the worker hides; it then reads GMT's raw figure file (`gmt_N.ps-`) from the session directory and renders it itself, cropping to the painted content. Only the first figure is used.
- `gmt begin name png` is rewritten to `ps`.
- **No network**: libcurl is linked only because GMT 6.6 requires it to compile and is stubbed to fail instantly. Remote datasets (`@earth_relief` etc.) are unavailable; GSHHG shorelines are bundled instead (`public/gmt/data`: crude, low, intermediate, high, plus borders and rivers). Full resolution (`-Df`, 30 MiB) exceeds the Pages file limit and is served from the high-resolution file with a note.
- The `supplements` plugin (`mgd77`, `gshhg`, `img`, …) is not built, and the share data for `mgd77`/`spotter`/`x2sys` is trimmed to keep `gmt.wasm` under Cloudflare Pages' 25 MiB file limit (currently ~17 MB).
- `psInterpreter.ts` is our own PostScript-to-SVG interpreter for GMT's output (paths, text with real font metrics, clipping, images, landscape rotation). Not handled: `-Gp` pattern fills, `imagemask`. Unknown operators are reported in the console and skipped.
- PDF export embeds a raster image; it is not vector.

## Rebuilding the Wasm engine

```bash
docker build -f docker/Dockerfile.wasm -t webgmt-wasm docker      # ~30+ min cold, cached afterwards
id=$(docker create webgmt-wasm) && docker cp "$id":/out ./wasm-out && docker rm "$id"
cp wasm-out/gmt.js wasm-out/gmt.wasm public/gmt/ && cp wasm-out/data/*.nc public/gmt/data/
```

Needs Docker with ~8 GB RAM available to the VM; every parallel build step is capped at `-j4` because unlimited `-j` exhausted memory and hung Docker Desktop. The pipeline cross-compiles zlib, PCRE2, HDF5, netCDF-C, sqlite3, PROJ, GDAL (nearly all drivers off), libcurl and GMT, then links `libgmt.a` with `docker/gmt_wasm_wrapper.c`. Non-obvious fixes baked in (see comments in the files): GMT's CMake module path patch, wasm32 `SIZEOF_*` defines, `NO_SIGHANDLER`, a table-backed `dlopen`/`dlsym` (GMT finds its modules by symbol name), an 8 MB stack (the 64 KB default corrupts the heap), data embedded at the compiled-in `/gmt-install/share`, and linking static `.a` files explicitly so `libz.so` is not picked up.

## Features

- Monaco with a `gmt` language (highlighting, module/flag completion, heredocs, `$VAR`), diagnostics from stderr via `errorParser.ts`
- Script library + uploaded datasets in IndexedDB (`scripts`, `files`, `history`); uploaded files are available to scripts by name
- **Scripts run as shell scripts** (`src/lib/shell.ts`), not just lists of `gmt` commands: variables, quotes, `$(...)` and backticks, pipes (`echo "x y t" | gmt text`, `awk ... | gmt plot`), redirects, heredocs, `for ... in ...; do ... done` (nestable), `;`/`&&`/`||`, and bash-like error behaviour (a failing `gmt` command is reported and the script carries on).
- Built-in commands: `gmt`, `echo`, `printf`, `cat`, `awk` (own implementation: patterns, fields, `printf`, loops, arrays, `-F`/`-v`), `grep`, `date`, `seq`, `qrencode` (writes an EPS QR code that `gmt image` can place), `rm`, `mkdir`, `cd`. `ip a` returns nothing (no network interfaces in a browser). Not supported: `if`/`while`/functions/`$(( ))` (reported, not run).
- **Several figures per script**: every `gmt begin ... gmt end` block becomes a figure; pick one in the viewer's dropdown.
- Pan/zoom viewer, vector/raster toggle, export to PNG (300 DPI), SVG, PDF, PostScript (Wasm only), `.sh`
- PDF export embeds a raster image of the map; it is not vector PDF
- Light/dark theme, resizable panes, `Ctrl+Enter` run, `Ctrl+S` save

## Deployment

`public/_headers` sets COOP/COEP (needed for `SharedArrayBuffer`). Monaco is bundled locally rather than loaded from a CDN so the app works under `require-corp`. `.github/workflows/deploy-pages.yml` typechecks, builds, verifies and deploys with Wrangler; set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Cloudflare Pages has a 25 MiB per-file limit: every GSHHG file fits except full-resolution shorelines (`binned_GSHHS_f.nc`, 30 MiB), which is why `-Df` falls back to high resolution. Files in `public/gmt/data` total about 24 MB and are fetched only when a script needs them (then cached).

## Tests

`npm test` runs `tests/awk.test.ts` (our awk against the system awk, 16 programs) and `tests/shell.test.ts` (pipes, heredocs, substitution, loops, error behaviour). The Wasm engine and renderer have no automated tests; they were checked by running scripts in headless Chrome and comparing the output with real GMT results.

## Not implemented

`pdfjs-dist` and `d3-zoom` from the original spec are not used (CSS transforms and an SVG pipeline instead). No automated test suite.
