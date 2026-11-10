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
| noop | 35 ms [34-38] | 1 ms [1-1] | 0.0x | - | - | 40 ms [39-44] | 1 ms [1-1] | 0.0x |
| basemap | 67 ms [63-77] | 5 ms [4-8] | 0.1x | 1 ms | 5.5x | 117 ms [109-128] | 7 ms [6-10] | 0.1x |
| blockmedian-surface | 316 ms [310-339] | 442 ms [436-451] | 1.4x | 210 ms | 2.1x | 324 ms [318-347] | 444 ms [437-452] | 1.4x |
| coast-global | 130 ms [127-136] | 62 ms [61-65] | 0.5x | 59 ms | 1.0x | 186 ms [182-194] | 107 ms [101-111] | 0.6x |
| coast-mercator | 131 ms [128-136] | 81 ms [76-101] | 0.6x | 60 ms | 1.3x | 189 ms [186-197] | 175 ms [161-210] | 0.9x |
| grdcontour-05m-window | 82 ms [79-88] | 16 ms [16-17] | 0.2x | 11 ms | 1.4x | 135 ms [132-142] | 33 ms [30-37] | 0.2x |
| grdcut-global-05m | 184 ms [180-188] | 120 ms [114-125] | 0.7x | 113 ms | 1.1x | 190 ms [186-194] | 128 ms [120-132] | 0.7x |
| grdgradient-global-05m | 1.04 s [1023-1193] | 1.18 s [1175-1199] | 1.1x | 973 ms | 1.2x | 1.05 s [1030-1200] | 1.19 s [1187-1212] | 1.1x |
| grdimage-05m-window | 81 ms [78-84] | 15 ms [14-24] | 0.2x | 11 ms | 1.5x | 135 ms [133-143] | 27 ms [24-43] | 0.2x |
| grdimage-global-05m | 3.38 s [3333-3505] | 3.39 s [3369-3450] | 1.0x | 3.31 s | 1.0x | 3.49 s [3440-3606] | 4.16 s [4148-4400] | 1.2x |
| grdview-30s-window | 234 ms [227-256] | 123 ms [122-140] | 0.5x | 128 ms | 1.0x | 292 ms [283-315] | 137 ms [134-165] | 0.5x |
| nearneighbor | 844 ms [820-876] | 1.01 s [999-1054] | 1.2x | 774 ms | 1.3x | 851 ms [827-883] | 1.01 s [1000-1055] | 1.2x |
| plot-ship | 144 ms [139-158] | 240 ms [234-264] | 1.7x | 74 ms | 3.3x | 210 ms [203-222] | 7.20 s [7076-7518] | 34.4x |

A ratio above 1 means WebGMT is slower.

## WebGMT: where the time goes

| Workload | GMT worker | PostScript to SVG | PostScript | SVG | First run (cold engine state) | Browser memory growth |
|---|---|---|---|---|---|---|
| noop | 1 ms | - | - | - | n/a | n/a |
| basemap | 5 ms | 2 ms | 23 kB | 8 kB | 5 ms | 97 MB |
| blockmedian-surface | 442 ms | - | - | - | 490 ms | 241 MB |
| coast-global | 62 ms | 44 ms | 262 kB | 506 kB | 79 ms | 97 MB |
| coast-mercator | 81 ms | 93 ms | 463 kB | 1249 kB | 167 ms | 77 MB |
| grdcontour-05m-window | 16 ms | 10 ms | 60 kB | 74 kB | 20 ms | 204 MB |
| grdcut-global-05m | 120 ms | - | - | - | 118 ms | 213 MB |
| grdgradient-global-05m | 1.18 s | - | - | - | 1.21 s | 233 MB |
| grdimage-05m-window | 15 ms | 4 ms | 33 kB | 28 kB | 22 ms | 206 MB |
| grdimage-global-05m | 3.39 s | 772 ms | 12467 kB | 12206 kB | 3.37 s | 322 MB |
| grdview-30s-window | 123 ms | 14 ms | 138 kB | 129 kB | 156 ms | 194 MB |
| nearneighbor | 1.01 s | - | - | - | 1.20 s | 166 MB |
| plot-ship | 240 ms | 6.96 s | 1210 kB | 156532 kB | 264 ms | 395 MB |

Memory growth is the resident memory of the whole Chrome process tree after the workload minus the idle browser; it includes the Wasm heap, which only grows within a session.

## Native: peak memory

| Workload | Peak RSS of the script | PostScript |
|---|---|---|
| noop | 40 MB | - |
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
| plot-ship | 45 MB | 1210 kB |

## Start-up

| | Time to the first finished figure |
|---|---|
| First visit (empty cache: download, compile, run) | 0.19 s |
| Second visit (cached engine and data) | 0.10 s |
| Native, one `basemap` script | 117 ms |

Both are served from this machine, so the first visit has no real network time in it: add the download of the engine (see the download indicator in the app) for your connection.

## Caveats

- Every native gmt call is a new process: 35 ms for a trivial call here (noop row), against 1 ms in the already running engine. A script with several calls pays that several times, so rows under about 300 ms mostly measure process start-up, not GMT. Compare the heavy rows for the speed of the engine itself.
- Native runs in a Linux container on this machine; WebGMT in Chrome on the host. Same CPU, different operating system layers.
- A native script starts one process per `gmt` call, WebGMT keeps one engine alive. That is a real difference between the two, not a measurement error.
- Browser timers are coarsened by a few microseconds to a millisecond; the runs here are much longer than that.
- Results change with browser version, power plan and background load: compare runs made on the same machine under the same conditions.
