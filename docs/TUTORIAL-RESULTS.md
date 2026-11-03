# GMT tutorial vs WebGMT

Every script of the GMT 6.6 bash tutorial (https://docs.generic-mapping-tools.org/6.6/tutorial.html, sessions 1-4,
19 figures plus the stand-alone `info`, `grdinfo`, `grdcut`, `grdgradient`, `makecpt`, `blockmedian`, `surface`
commands) was run in WebGMT and compared with the figures and output printed on those pages. The scripts are in
`src/db/tutorialExamples.ts` and are seeded into `examples/gmt-tutorial/` on a fresh install.

How: each script was uploaded and run through the UI in headless Chrome; the SVG was rendered next to the
documentation PNG and compared by eye (geometry, labels, colours, line weights). Data: `@name` files are served from
`public/gmt/remote/` (see the README, "Remote data").

| Figure | Content | Result |
|---|---|---|
| 1-2 | linear and log basemap | same |
| 3-6 | Mercator, Albers, orthographic, Eckert VI coastlines | same (hairline seams between land polygons are slightly more visible in a browser) |
| 7-8 | `plot` of `@tut_data.txt`, lines and symbols | same |
| 9 | NCEI tsunami earthquakes on a Japan map | same |
| 10 | text, fonts, `@~` Greek, `@!` overstrike | same after fixes 2 and 3 below |
| 11 | `grdcontour @earth_relief_05m` | same style, annotations and extent; **fewer small contours** (newer, smoother data, see below) |
| 12-13 | `nearneighbor`/`surface` on `@tut_ship.xyz`, `mask` | same after fix 1 |
| 14 | colour bars (discrete and continuous) | same |
| 15-16 | `grdimage` with and without illumination | same |
| 17 | `grdimage` of a netCDF slice, Hammer projection | same; the 1 degree grid is interpolated, not drawn as big squares |
| 18 | `grdview` mesh | same shape and axes after fixes 4 and 7; **less spiky** (newer, smoother data, see below) |
| 19 | colour `grdview` with illumination | same |

Text output: `gmt info @tut_data.txt` (`N = 7 <1/5> <1/5>`) and `gmt info @tut_ship.xyz`
(`N = 82970 <245/254.705> <20/29.99131> <-7708/-9>`) are identical to the documentation. `makecpt`, `grdcut`,
`grdinfo`, `blockmedian`, `surface` and `grdgradient` run and print what GMT prints (`-V` output included).

## Differences that remain

- **Figures 11 and 18 use newer data than the documentation images.** The images on the documentation site were
  made from an older, rougher elevation grid. With the current SRTM15+ v2.7 data that `@earth_relief_05m` stands for
  (bundled here, global, 5 arc minutes) the same commands give the same large features but smoother terrain and fewer
  small contours and spikes. The legacy `@tut_bathy.nc` (ETOPO5) reproduces the documentation figure 18 closely.
- **`@earth_relief_*` is only partly available offline.** Bundled: 01d, 30m, 10m and 05m globally, and the
  tutorial's 30 arc-second region (-108/-103/35/40). Anything finer, or 30s elsewhere, uses the 10m grid and says so in
  the console.
- **`ncdump`** (a command in the tutorial text, not part of GMT) is not available in the browser shell.
- **Line weights** look a little lighter than the documentation PNGs next to them. Both are 0.25 pt hairlines; the
  PNGs were rasterised at a different size.

## Bugs found by this comparison (all fixed)

1. **Annotated contours were drawn as thin as the others.** GMT keeps pens as strings and runs them with
   `PSL_path_pen N get cvx exec`; the interpreter did not run executable strings.
2. **Text next to Zapf Chancery overlapped** because the browser's fallback font is wider than the metrics used to
   place the next word. Text now carries `textLength`, so it fills exactly the width the layout assumed.
3. **Accented letters** (`M@!a\225noa` = a with macron): ISOLatin1+ has the spacing accents at 0x90-0x9F, where
   Latin-1 has control characters (drawn as a box); they also need their real widths (333) for the overstrike centring.
4. **3-D axis labels were rotated but not sheared**, unlike GMT's labels along the axes of a perspective view; text now
   uses the full transformation matrix.
5. A script without a figure (`gmt info ...`) was reported as "finished with errors"; it is now just "Done" with an
   informational line.
6. Bundled data appeared in the console as `/gmt-remote/tut_data.txt`; the folder is hidden so output reads like GMT's.
7. **Windows of a bundled global grid kept the whole globe's z range.** GMT cuts the region out of the server tiles
   first, so `grdview` scales its vertical axis to the window; the bundled global file made figure 18 a flat sheet
   floating above its axes. Commands that read the header (`grdview`, `grdimage`, `grdcontour`, `grd2cpt`, `grd2xyz`,
   `grdinfo`) now get the requested window, cut with `grdcut` first.
8. **Images were drawn as hard pixels at any scale**, so coarse grids looked like big squares and dense ones aliased.
   Pixels are now only kept hard when the image is shown at about its own size.
9. **Console colours.** GMT's `[WARNING]` and `[INFORMATION]` lines were red like errors. Warnings are amber,
   information is grey and only errors are red; repeated lines are shown once with a count, and the "landscape
   orientation" paper guess (WebGMT has no paper) is not shown.
