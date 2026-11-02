# WebGMT

Source: https://github.com/UsainSrht/WebGMT · Live: https://webgmt.pages.dev

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
| **GMT Wasm** (deployed) | `public/gmt/gmt.js` + `gmt.wasm` exist | Real GMT 6.6.0 with real GSHHG coastlines (crude to high resolution, plus borders and rivers). Output is PostScript, converted to SVG in the browser by `src/workers/psInterpreter.ts` |
| **Mock** (fallback) | no Wasm build present | Draws SVG directly for a **subset** of GMT (`basemap`, `coast` with crude hand-made outlines, `plot`, `text`, `makecpt`, `colorbar`, `contour`). It is not GMT and its output differs |

Verified on the Wasm engine: the three bundled examples, all 19 figures of the official GMT tutorial (see [docs/TUTORIAL-RESULTS.md](docs/TUTORIAL-RESULTS.md)), and ten real course scripts (time and log axes, text/fonts/equations, 3-D perspective plots, nine map projections, filled contours, `grdimage`/`grdview`, profiles with `gmt project`/`grdtrack`) compared against real GMT output, locally and on the deployed site. Not verified: other modules, very large inputs, non-Chromium browsers.

Known limits of the Wasm build:
- **No Ghostscript**, so `psconvert` fails. Modern-mode `gmt end` therefore reports a psconvert error, which the worker hides; it then reads GMT's raw figure file (`gmt_N.ps-`) from the session directory and renders it itself, cropping to the painted content. Every `gmt begin … gmt end` block becomes its own figure.
- `gmt begin name png` is rewritten to `ps`.
- **No network**: libcurl is linked only because GMT 6.6 requires it to compile and is stubbed to fail instantly. `@name` files cannot come from the GMT data server (a browser may not fetch it: no CORS headers), so they are served from `public/gmt/remote/` (see "Remote data" below); GSHHG shorelines are bundled too (`public/gmt/data`: crude, low, intermediate, high, plus borders and rivers). Full resolution (`-Df`, 30 MiB) exceeds the Pages file limit and is served from the high-resolution file with a note.
- The `supplements` plugin (`mgd77`, `gshhg`, `img`, …) is not built, and the share data for `mgd77`/`spotter`/`x2sys` is trimmed to keep `gmt.wasm` under Cloudflare Pages' 25 MiB file limit (currently ~17 MB).
- `psInterpreter.ts` is our own PostScript-to-SVG interpreter for GMT's output (paths, text with real font metrics, clipping, images, landscape rotation). Not handled: `-Gp` pattern fills, `imagemask`. Unknown operators are reported in the console and skipped.
- PDF export embeds a raster image; it is not vector.

## Remote data

`@name` arguments are rewritten (`src/services/remoteData.ts`) to bundled copies in `public/gmt/remote/`, fetched on demand and cached: the tutorial files (`@tut_data.txt`, `@tut_quakes.ngdc`, `@tut_ship.xyz`, `@tut_bathy.nc`, `@tut_relief.nc`, `@otemp.anal1deg.nc`) and the global `@earth_relief_01d`, `30m`, `10m` and `05m` grids (SRTM15+ v2.7, pixel registered; the 05m file was converted from the server's JPEG 2000 tiles with GDAL). The 30 arc-second tutorial region (-108/-103/35/40) is bundled as a subset. Any other `@earth_relief_*` resolution falls back to the 10m grid with a note in the console. About 33 MB of data in total; none of it is loaded until a script uses it.

## Rebuilding the Wasm engine

```bash
docker build -f docker/Dockerfile.wasm -t webgmt-wasm docker      # ~30+ min cold, cached afterwards
id=$(docker create webgmt-wasm) && docker cp "$id":/out ./wasm-out && docker rm "$id"
cp wasm-out/gmt.js wasm-out/gmt.wasm public/gmt/ && cp wasm-out/data/*.nc public/gmt/data/
```

Needs Docker with ~8 GB RAM available to the VM; every parallel build step is capped at `-j4` because unlimited `-j` exhausted memory and hung Docker Desktop. The pipeline cross-compiles zlib, PCRE2, HDF5, netCDF-C, sqlite3, PROJ, GDAL (nearly all drivers off), libcurl and GMT, then links `libgmt.a` with `docker/gmt_wasm_wrapper.c`. Non-obvious fixes baked in (see comments in the files): GMT's CMake module path patch, wasm32 `SIZEOF_*` defines, `NO_SIGHANDLER`, a table-backed `dlopen`/`dlsym` (GMT finds its modules by symbol name), an 8 MB stack (the 64 KB default corrupts the heap), data embedded at the compiled-in `/gmt-install/share`, and linking static `.a` files explicitly so `libz.so` is not picked up.

## Features

- Monaco with a `gmt` language (highlighting, module/flag completion, heredocs, `$VAR`), diagnostics from stderr via `errorParser.ts`
- **File explorer** (left panel): one project tree for scripts and data, stored in IndexedDB (`nodes` + `blobs` tables; `history` kept). Create files and folders, rename (F2 or context menu), delete (Del), download (a file as it is stored, a folder as a .zip), and move items by drag and drop (a floating chip follows the cursor, the target folder is highlighted, folders auto-open when hovered). Files and whole folders can be dropped from the desktop onto any folder, or added with the "Drop files or click to upload" box, which stays at the bottom of the tree. Databases from versions before 1.0.0 are migrated automatically (scripts become `<title>.sh`, data files keep their names).
- **Editor tabs** like VS Code (dirty dot, middle-click to close, tabs restored on reload). Any text file opens in the editor: `.sh`/`.bash`/`.zsh`/`.ksh` (or an extensionless file with a shell shebang) are GMT scripts with GMT highlighting; `.dat`, `.txt`, `.csv` and other text files are plain text (`.json`, `.md`, `.xml` and friends get their own highlighting). Images (png, jpg, gif, webp, svg, bmp, ico, avif) open as a preview, binary files (netCDF grids etc.) open with a "binary file, contents not readable" notice and their size. Split editor is planned, not implemented.
- **Running**: Run saves the script in the active tab and executes it (only for scripts). It runs as if started from its own folder, so `gmt plot data/pts.dat` and `../shared/x.dat` resolve like they would in a terminal, and unsaved edits in other open tabs are used. Files a script writes (`cat > x.csv`) exist only during the run.
- **Loading**: the page itself is about 1 MB (editor and file tree appear immediately). About two seconds later the GMT engine (`gmt.wasm`, 17 MB raw, a few MB compressed) is downloaded and compiled in the background (skipped when the browser asks to save data), so the first Run does not wait for it. Coastlines and `@name` data are downloaded only when a script needs them and are then cached.
- **Download indicator** (header): one bar with the average progress of the active downloads; hover it (or focus / tap) for each download with `loaded / total`, estimated time left and a cancel button. Cancelling a download that a Run is waiting for ends that run with an error; the next Run tries again. Sizes come from `public/gmt/manifest.json`, written by `scripts/gen-manifest.mjs` before `dev` and `build` (Brotli-compressed transfers only report the encoded length).
- **Version and credits**: the version lives in `package.json` (`1.0.0`), is injected at build time as `__APP_VERSION__` (`src/lib/version.ts`) and shown in the panel footer together with links to the GMT repository and this repository, the author, and the license dialog.
- **Scripts run as shell scripts** (`src/lib/shell.ts`), not just lists of `gmt` commands: variables, quotes, `$(...)` and backticks, pipes (`echo "x y t" | gmt text`, `awk ... | gmt plot`), redirects, heredocs, `for ... in ...; do ... done` (nestable), `;`/`&&`/`||`, and bash-like error behaviour (a failing `gmt` command is reported and the script carries on).
- Built-in commands: `gmt`, `echo`, `printf`, `cat`, `awk` (own implementation: patterns, fields, `printf`, loops, arrays, `-F`/`-v`), `grep`, `date`, `seq`, `qrencode` (writes an EPS QR code that `gmt image` can place), `rm`, `mkdir`, `cd`. `ip a` returns nothing (no network interfaces in a browser). Not supported: `if`/`while`/functions/`$(( ))` (reported, not run).
- **Several figures per script**: every `gmt begin ... gmt end` block becomes a figure; pick one in the viewer's dropdown.
- Pan/zoom viewer, vector/raster toggle, export to PNG (300 DPI), SVG, PDF, PostScript (Wasm only), `.sh`
- PDF export embeds a raster image of the map; it is not vector PDF
- Light/dark theme, resizable panes, `Ctrl+Enter` run, `Ctrl+S` save

## Deployment

`public/_headers` sets COOP/COEP (needed for `SharedArrayBuffer`). It also caches hashed `/assets/*` for a year (immutable) and `/gmt/data/*`, `/gmt/remote/*` for a week; `gmt.js`, `gmt.wasm` and `manifest.json` keep revalidating because they must always match each other. A data file that is ever replaced must get a new name. Monaco is bundled locally rather than loaded from a CDN so the app works under `require-corp`. `.github/workflows/deploy-pages.yml` typechecks, builds, verifies and deploys with Wrangler; set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Cloudflare Pages has a 25 MiB per-file limit: every GSHHG file fits except full-resolution shorelines (`binned_GSHHS_f.nc`, 30 MiB), which is why `-Df` falls back to high resolution. Files in `public/gmt/data` total about 24 MB and are fetched only when a script needs them (then cached).

## Tests

`npm test` runs `tests/awk.test.ts` (our awk against the system awk, 16 programs), `tests/shell.test.ts` (pipes, heredocs, substitution, loops, error behaviour) and `tests/files.test.ts` (path helpers, text/image/binary detection), `tests/remote.test.ts` (`@name` rewriting) and `tests/ps.test.ts` (PostScript interpreter regressions) and `tests/downloads.test.ts` (progress, speed, ETA, averages). The Wasm engine, renderer and explorer UI have no automated tests in the repository; they were checked by driving headless Chrome and comparing the output with real GMT results.

## License

WebGMT is MIT licensed (see [LICENSE](LICENSE)), made by [UsainSrht](https://github.com/UsainSrht). It bundles GMT (LGPL-3.0-or-later) and other third-party code and data; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). WebGMT is not affiliated with the GMT project.

## Not implemented

`pdfjs-dist` and `d3-zoom` from the original spec are not used (CSS transforms and an SVG pipeline instead). The Wasm engine, renderer and explorer UI are not covered by automated tests (see Tests).
