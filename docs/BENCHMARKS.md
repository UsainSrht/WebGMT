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
| blockmedian-surface | 315 ms [313-324] | 274 ms [248-307] | 0.9x | 209 ms | 1.3x | 323 ms [319-332] | 276 ms [249-308] | 0.9x |
| coast-global | 128 ms [126-133] | 60 ms [58-66] | 0.5x | 58 ms | 1.0x | 183 ms [182-189] | 82 ms [80-103] | 0.4x |
| coast-mercator | 129 ms [127-133] | 73 ms [70-102] | 0.6x | 59 ms | 1.3x | 187 ms [184-199] | 126 ms [112-177] | 0.7x |
| grdcontour-05m-window | 82 ms [81-84] | 16 ms [16-18] | 0.2x | 12 ms | 1.4x | 135 ms [133-138] | 30 ms [28-34] | 0.2x |
| grdcut-global-05m | 183 ms [179-187] | 121 ms [114-134] | 0.7x | 112 ms | 1.1x | 189 ms [185-193] | 127 ms [121-140] | 0.7x |
| grdgradient-global-05m | 1.02 s [1010-1043] | 1.17 s [1157-1182] | 1.1x | 954 ms | 1.2x | 1.03 s [1016-1049] | 1.18 s [1163-1192] | 1.1x |
| grdimage-05m-window | 80 ms [79-96] | 16 ms [14-19] | 0.2x | 10 ms | 1.7x | 132 ms [130-148] | 28 ms [24-31] | 0.2x |
| grdimage-global-05m | 3.29 s [3269-3507] | 3.41 s [3385-3438] | 1.0x | 3.22 s | 1.1x | 3.39 s [3368-3614] | 4.20 s [4171-4271] | 1.2x |
| grdview-30s-window | 225 ms [221-242] | 125 ms [119-135] | 0.6x | 119 ms | 1.1x | 278 ms [276-300] | 137 ms [131-160] | 0.5x |
| nearneighbor | 808 ms [793-828] | 812 ms [805-840] | 1.0x | 738 ms | 1.1x | 815 ms [800-833] | 815 ms [807-842] | 1.0x |
| noop | 35 ms [35-37] | 1 ms [1-1] | 0.0x | - | - | 40 ms [39-41] | 1 ms [1-1] | 0.0x |
| plot-ship | 139 ms [135-147] | 63 ms [61-70] | 0.5x | 69 ms | 0.9x | 202 ms [194-210] | 344 ms [334-370] | 1.7x |

A ratio above 1 means WebGMT is slower.

## WebGMT: where the time goes

| Workload | GMT worker | PostScript to SVG | PostScript | SVG | First run (cold engine state) | Browser memory growth |
|---|---|---|---|---|---|---|
| basemap | 4 ms | 1 ms | 23 kB | 5 kB | 5 ms | 69 MB |
| blockmedian-surface | 274 ms | - | - | - | 281 ms | 433 MB |
| coast-global | 60 ms | 22 ms | 262 kB | 452 kB | 76 ms | 287 MB |
| coast-mercator | 73 ms | 54 ms | 463 kB | 852 kB | 210 ms | 296 MB |
| grdcontour-05m-window | 16 ms | 7 ms | 60 kB | 51 kB | 20 ms | 369 MB |
| grdcut-global-05m | 121 ms | - | - | - | 116 ms | 276 MB |
| grdgradient-global-05m | 1.17 s | - | - | - | 1.19 s | 477 MB |
| grdimage-05m-window | 16 ms | 4 ms | 33 kB | 20 kB | 23 ms | 443 MB |
| grdimage-global-05m | 3.41 s | 779 ms | 12467 kB | 12204 kB | 3.44 s | 347 MB |
| grdview-30s-window | 125 ms | 12 ms | 138 kB | 126 kB | 156 ms | 379 MB |
| nearneighbor | 812 ms | - | - | - | 983 ms | 340 MB |
| noop | 1 ms | - | - | - | 5 ms | 57 MB |
| plot-ship | 63 ms | 279 ms | 1210 kB | 5873 kB | 78 ms | 321 MB |

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
