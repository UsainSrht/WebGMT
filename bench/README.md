# Benchmark: WebGMT against the native GMT CLI

For people who want to measure WebGMT on their own machine. Nothing here is part of the website: `src/` does not
import it, `npm run build` does not build it, and `npm run verify:dist` fails if any of it ends up in `dist/`.

## Run it

You need Node 20+, Docker (for the native side) and Chrome, and the engine in `public/gmt/` (the repository ships it).

```
npm run bench            # native, web, then the comparison table
npm run bench:native     # native GMT 6.6.0 in Docker only (the image takes ~15 minutes to build the first time)
npm run bench:web        # WebGMT in headless Chrome only
npm run bench:compare    # join the two result files into a table
npm run bench:check      # do both sides compute the same results? (prints grid statistics etc. and compares them)
```

Options go after `--`, for example `npm run bench:web -- --reps 20 --only plot-ship,surface`:

| Option | Default | Meaning |
|---|---|---|
| `--reps N` | 10 | measured runs per workload |
| `--warmup N` | 2 | runs that are not counted (the first one loads data and warms caches) |
| `--dir PATH` | workloads/ | use your own folder of workloads (same layout) |
| `--out DIR` | results/ | where the result files go |
| `--engine DIR` | public/gmt | web only: use `gmt.js` and `gmt.wasm` from this folder (an engine build under test) |
| `--only a,b` | all | workload names (file names in `workloads/`, without `.sh`) |
| `--cpus N` | 1 | native only: CPU limit of the container |
| `--no-build` | | skip rebuilding the Docker image / the benchmark page |
| `--chrome PATH` | auto | web only: Chrome or Chromium executable (or set `CHROME`) |
| `--headed` | | web only: show the browser window |
| `--write-docs` | | compare only: also write `docs/BENCHMARKS.md` |

Results are written to `bench/results/` (`native.json`, `web.json`, `REPORT.md`), which git ignores.

## What is measured

Both sides run the same scripts from `workloads/` on the same input files (`public/gmt/remote/`).

| | Native | WebGMT |
|---|---|---|
| **Engine** | time inside `gmt` calls other than `gmt end` (every call is a process) | one worker run: the shell, GMT, and copying the input files into the in-memory file system |
| **Total** | whole script, including `gmt end` (psconvert and Ghostscript) | worker run plus the PostScript-to-SVG renderer |
| **Memory** | peak RSS of the script | growth of the resident memory of the whole browser process tree after the workload |
| **Start-up** | `basemap` script from nothing | first visit (empty cache) and second visit (cached), time until the first finished figure |

Details that matter when reading the numbers:

- `npm run bench:check` runs the scripts in `check/` on both sides and compares what they print to 6 significant digits, so a fast wrong answer cannot pass for a result.
- Native GMT is built from the same 6.6.0 source, with OpenMP off, and runs on one CPU.
- A native script starts one process per `gmt` call (about 35 ms each here, the `noop` row); WebGMT keeps one engine alive.
  Short scripts therefore favour WebGMT. The report has a column with that start-up subtracted for an engine-against-engine view.
- WebGMT is served from a local server with the website's caching headers, so start-up contains no network time.
- The native side runs in a Linux container on your machine, WebGMT in Chrome on the host.
- Results depend on browser version, power plan and background load. Compare runs made under the same conditions.

## Layout

```
bench/
  workloads/      the scripts (portable GMT) and workloads.json (names, groups)
  native/         Dockerfile (GMT 6.6.0 from source), run.sh (inside the container), run.mjs (driver)
  web/            index.html + bench.ts (the page that drives the real worker), run.mjs (driver: build, serve, Chrome)
  vite.config.ts  builds the page to dist-bench/ (separate from the website's vite.config.ts)
  compare.mjs     results -> Markdown
```

To add a workload, put `name.sh` in `workloads/` and an entry in `workloads.json`. Scripts may use the data files in
`public/gmt/remote/` by file name (for example `earth_relief_05m_p.grd`, `tut_ship.xyz`); coastlines work as usual.
Avoid `-Df` (full resolution): WebGMT does not ship it.
