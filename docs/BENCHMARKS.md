# WebGMT vs native GMT CLI

Generated 2026-11-10 by `npm run bench:compare`. Medians of 10 runs after 2 warm-ups; the range (min-max, ms) is in brackets.

| | |
|---|---|
| Native | GMT 6.6.0 in Docker, 1 CPU, OpenMP off |
| WebGMT | GMT 6.6.0 Wasm + PostScript renderer in Chrome/156.0.8078.80, one worker |
| Machine | 12th Gen Intel(R) Core(TM) i3-12100F, 8 logical CPUs, 15.8 GB, Windows_NT 10.0.26300 |

## Time per script

Engine = GMT itself. Native engine is the time inside `gmt` calls other than `gmt end` (each call is a new process). WebGMT engine is one worker run, including staging the input files into its in-memory file system.
Total = a finished figure: native adds `gmt end` (psconvert and Ghostscript), WebGMT adds its PostScript-to-SVG renderer. Scripts without a figure have the same engine and total.

Native engine without start-up = native engine minus (number of gmt calls x the noop row). That is the fair engine-against-engine column; the plain engine column is what a user of the CLI actually waits.

| Workload | Native engine | WebGMT engine | Engine ratio | Native without start-up | Ratio without start-up | Native total | WebGMT total | Total ratio |
|---|---|---|---|---|---|---|---|---|
| basemap | 73 ms [70-74] | 4 ms [3-5] | 0.0x | 2 ms | 1.6x | 124 ms [121-128] | 5 ms [4-7] | 0.0x |
| blockmedian-surface | 315 ms [313-324] | 460 ms [454-468] | 1.5x | 209 ms | 2.2x | 323 ms [319-332] | 461 ms [455-470] | 1.4x |
| coast-global | 128 ms [126-133] | 62 ms [60-64] | 0.5x | 58 ms | 1.1x | 183 ms [182-189] | 86 ms [82-100] | 0.5x |
| coast-mercator | 129 ms [127-133] | 80 ms [72-92] | 0.6x | 59 ms | 1.4x | 187 ms [184-199] | 139 ms [116-162] | 0.7x |
| grdcontour-05m-window | 82 ms [81-84] | 18 ms [17-20] | 0.2x | 12 ms | 1.5x | 135 ms [133-138] | 33 ms [29-38] | 0.2x |
| grdcut-global-05m | 183 ms [179-187] | 121 ms [118-135] | 0.7x | 112 ms | 1.1x | 189 ms [185-193] | 128 ms [125-142] | 0.7x |
| grdgradient-global-05m | 1.02 s [1010-1043] | 1.22 s [1215-1231] | 1.2x | 954 ms | 1.3x | 1.03 s [1016-1049] | 1.23 s [1228-1247] | 1.2x |
| grdimage-05m-window | 80 ms [79-96] | 16 ms [15-20] | 0.2x | 10 ms | 1.7x | 132 ms [130-148] | 29 ms [26-32] | 0.2x |
| grdimage-global-05m | 3.29 s [3269-3507] | 3.49 s [3460-3514] | 1.1x | 3.22 s | 1.1x | 3.39 s [3368-3614] | 4.31 s [4263-4391] | 1.3x |
| grdview-30s-window | 225 ms [221-242] | 128 ms [124-134] | 0.6x | 119 ms | 1.1x | 278 ms [276-300] | 142 ms [139-149] | 0.5x |
| nearneighbor | 808 ms [793-828] | 1.05 s [1031-1071] | 1.3x | 738 ms | 1.4x | 815 ms [800-833] | 1.05 s [1032-1073] | 1.3x |
| noop | 35 ms [35-37] | 1 ms [1-2] | 0.0x | - | - | 40 ms [39-41] | 1 ms [1-3] | 0.0x |
| plot-ship | 139 ms [135-147] | 246 ms [242-274] | 1.8x | 69 ms | 3.6x | 202 ms [194-210] | 543 ms [534-626] | 2.7x |

A ratio above 1 means WebGMT is slower.

## WebGMT: where the time goes

| Workload | GMT worker | PostScript to SVG | PostScript | SVG | First run (cold engine state) | Browser memory growth |
|---|---|---|---|---|---|---|
| basemap | 4 ms | 1 ms | 23 kB | 5 kB | 6 ms | 77 MB |
| blockmedian-surface | 460 ms | - | - | - | 544 ms | 324 MB |
| coast-global | 62 ms | 24 ms | 262 kB | 452 kB | 78 ms | 287 MB |
| coast-mercator | 80 ms | 58 ms | 463 kB | 852 kB | 223 ms | 283 MB |
| grdcontour-05m-window | 18 ms | 7 ms | 60 kB | 51 kB | 22 ms | 343 MB |
| grdcut-global-05m | 121 ms | - | - | - | 124 ms | 231 MB |
| grdgradient-global-05m | 1.22 s | - | - | - | 1.29 s | 506 MB |
| grdimage-05m-window | 16 ms | 3 ms | 33 kB | 20 kB | 24 ms | 304 MB |
| grdimage-global-05m | 3.49 s | 829 ms | 12467 kB | 12204 kB | 3.47 s | 412 MB |
| grdview-30s-window | 128 ms | 13 ms | 138 kB | 126 kB | 162 ms | 349 MB |
| nearneighbor | 1.05 s | - | - | - | 1.22 s | 229 MB |
| noop | 1 ms | - | - | - | 6 ms | 58 MB |
| plot-ship | 246 ms | 296 ms | 1210 kB | 5873 kB | 259 ms | 339 MB |

Memory growth is the resident memory of the whole Chrome process tree after the workload minus the idle browser; it includes the Wasm heap, which only grows within a session.

## Native: peak memory

| Workload | Peak RSS of the script | PostScript |
|---|---|---|
| basemap | 40 MB | 23 kB |
| blockmedian-surface | 47 MB | - |
| coast-global | 49 MB | 263 kB |
| coast-mercator | 50 MB | 463 kB |
| grdcontour-05m-window | 48 MB | 60 kB |
| grdcut-global-05m | 63 MB | - |
| grdgradient-global-05m | 130 MB | - |
| grdimage-05m-window | 48 MB | 33 kB |
| grdimage-global-05m | 133 MB | 12467 kB |
| grdview-30s-window | 53 MB | 138 kB |
| nearneighbor | 46 MB | - |
| noop | 40 MB | - |
| plot-ship | 45 MB | 1210 kB |

## Start-up

| | Time to the first finished figure |
|---|---|
| First visit (empty cache: download, compile, run) | 0.14 s |
| Second visit (cached engine and data) | 0.09 s |
| Native, one `basemap` script | 124 ms |

Both are served from this machine, so the first visit has no real network time in it: add the download of the engine (see the download indicator in the app) for your connection.

## Caveats

- Every native gmt call is a new process: 35 ms for a trivial call here (noop row), against 1 ms in the already running engine. A script with several calls pays that several times, so rows under about 300 ms mostly measure process start-up, not GMT. Compare the heavy rows for the speed of the engine itself.
- Native runs in a Linux container on this machine; WebGMT in Chrome on the host. Same CPU, different operating system layers.
- A native script starts one process per `gmt` call, WebGMT keeps one engine alive. That is a real difference between the two, not a measurement error.
- Browser timers are coarsened by a few microseconds to a millisecond; the runs here are much longer than that.
- Results change with browser version, power plan and background load: compare runs made on the same machine under the same conditions.
