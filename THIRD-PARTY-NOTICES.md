# Third-party notices

WebGMT's own source code is MIT licensed (see `LICENSE`). The in-browser engine and the bundled data are made of
other people's work, under their own licenses. Each project below keeps its own copyright.

## Bundled in `public/gmt/` (the WebAssembly engine and data)

| Component | Version | License | Project |
|---|---|---|---|
| GMT, Generic Mapping Tools (compiled to `gmt.wasm`) | 6.6.0 | LGPL-3.0-or-later | https://github.com/GenericMappingTools/gmt |
| GSHHG shorelines, borders and rivers (`data/binned_*.nc`) | 2.3.7 | LGPL-3.0-or-later | https://www.soest.hawaii.edu/pwessel/gshhg/ |
| GDAL | 3.9.3 | MIT | https://gdal.org |
| PROJ | 9.4.1 | MIT | https://proj.org |
| netCDF-C | 4.9.2 | BSD-3-Clause style | https://github.com/Unidata/netcdf-c |
| HDF5 | 1.14.6 | BSD-3-Clause style | https://github.com/HDFGroup/hdf5 |
| libcurl | 8.10.1 | curl license (MIT style) | https://curl.se |
| SQLite | 3.x | Public domain | https://sqlite.org |
| zlib | 1.3.x | zlib license | https://zlib.net |
| PCRE2 | 10.x | BSD-3-Clause | https://github.com/PCRE2Project/pcre2 |
| Emscripten runtime (the JavaScript glue and libc in `gmt.js`/`gmt.wasm`) | 6.0.13 | MIT / UIUC | https://emscripten.org |

**LGPL note.** `gmt.wasm` statically contains GMT, which is LGPL. The complete, reproducible build recipe
(`docker/Dockerfile.wasm`, `docker/build_wasm.sh`, `docker/gmt_wasm_wrapper.c`) is part of this repository, so anyone can
rebuild `gmt.wasm` from the unmodified GMT 6.6.0 sources, or replace GMT with another version, as the LGPL requires.
GMT is not modified; only a small wrapper and a dlopen/dlsym shim are added at link time. FFTW is built by the
Dockerfile for completeness but is **not** linked into `gmt.wasm` (FFTW is GPL).

## Data bundled in `public/gmt/remote/` (copies of files from the GMT data server)

| File | Source |
|---|---|
| `earth_relief_05m_p.grd`, `10m`, `30m`, `01d` | SRTM15+ v2.7 global relief, Tozer, B., Sandwell, D. T., Smith, W. H. F., Olson, C., Beale, J. R., & Wessel, P. (2019), *Earth and Space Science*, 6, 1847-1864, doi:10.1029/2019EA000658, as distributed by the GMT data server. The 05m grid was converted from the server's JPEG 2000 tiles to netCDF without changing the values. |
| `tut_ship.xyz`, `tut_quakes.ngdc`, `otemp.anal1deg.nc`, `tut_bathy.nc`, `tut_relief.nc`, `tut_data.txt` | The GMT tutorial datasets (ship soundings, NOAA NCEI tsunami earthquake catalogue, NOAA World Ocean Atlas temperatures, ETOPO5 and USGS DEM subsets), as distributed by the GMT data server for the official tutorial. |

Please check the terms of the original data providers before reusing these files outside of the tutorial and demo.

## npm packages in the web app

React, React DOM, Monaco Editor, `@monaco-editor/react`, Dexie, `dexie-react-hooks`, Tailwind CSS, `clsx`,
`tailwind-merge`, `qrcode-generator`, `fflate` and Vite are MIT licensed. `lucide-react` is ISC licensed.
Exact versions are in `package-lock.json`.

## How to cite GMT

Wessel, P., Luis, J. F., Uieda, L., Scharroo, R., Wobbe, F., Smith, W. H. F., & Tian, D. (2019). The Generic Mapping
Tools version 6. *Geochemistry, Geophysics, Geosystems*, 20, 5556-5564. https://doi.org/10.1029/2019GC008515

Wessel, P., & Smith, W. H. F. (1996). A global, self-consistent, hierarchical, high-resolution shoreline database.
*Journal of Geophysical Research*, 101(B4), 8741-8743. (GSHHG)

## License texts

The full license texts and copyright notices of everything listed above are shipped with the app under
`public/licenses/` (served at `/licenses/`): `GMT-LICENSE.txt` (GMT's copyright and license statement; the GSHHG data is under the same LGPL-3.0), `LGPL-3.0.txt`,
`GPL-3.0.txt` (the LGPL is an addition to it), `GDAL-LICENSE.txt`, `PROJ-COPYING.txt`, `netCDF-COPYRIGHT.txt`,
`HDF5-COPYING.txt`, `curl-COPYING.txt`, `PCRE2-LICENCE.txt`, `zlib-README.txt`, `Emscripten-LICENSE.txt` and
`npm-licenses.txt` (all production npm packages; regenerate with `node scripts/gen-npm-licenses.mjs` after changing dependencies).
SQLite is in the public domain.

## Source code of the LGPL parts

GMT 6.6.0 and GSHHG 2.3.7 are not modified. Their sources are at https://github.com/GenericMappingTools/gmt/releases/tag/6.6.0
and https://github.com/GenericMappingTools/gshhg-gmt/releases/tag/2.3.7. To use a different or modified GMT, rebuild
`gmt.wasm` with `docker/` (see `docs/COMPILING-GMT-TO-WASM.md`) and replace `public/gmt/gmt.wasm` and `gmt.js`.
