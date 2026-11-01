GSHHG coastline files served to the in-browser GMT Wasm engine (fetched on demand):
  binned_GSHHS_{c,l,i,h}.nc   binned_border_{c,l,i,h,f}.nc   binned_river_{c,l,i,h,f}.nc
binned_GSHHS_f.nc (full resolution, 30 MiB) is left out: Cloudflare Pages allows 25 MiB per file.
docker/build_wasm.sh copies these files from the gshhg-gmt tarball into this folder.
Without gmt.wasm in public/gmt/, WebGMT runs on its built-in mock engine, which needs none of these.
