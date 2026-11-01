Place GSHHG coastline files here (served to the in-browser GMT Wasm engine):
  binned_GSHHS_c.nc   binned_GSHHS_l.nc   binned_border_c.nc   binned_river_c.nc
docker/build_wasm.sh copies them from the gshhg-gmt tarball into this folder.
Without gmt.wasm in public/gmt/, WebGMT runs on its built-in mock engine, which needs none of these.
