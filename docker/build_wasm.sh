#!/usr/bin/env bash
# Links libgmt + wrapper into gmt.js / gmt.wasm (ES module, MODULARIZE) and collects GSHHG data.
set -euo pipefail
OUT=/out
mkdir -p "$OUT/data"

# Directory holding GMT's runtime data (conf/, cpt/, ...) after install
SHARE=$(dirname "$(find /gmt-install -type d -name cpt | head -1)")
echo "GMT share dir: $SHARE"
# Trim data for modules the web app does not use (keeps gmt.wasm under Cloudflare Pages' 25 MiB file limit)
SLIM=/tmp/share-slim; rm -rf "$SLIM"; cp -r "$SHARE" "$SLIM"
rm -rf "$SLIM"/mgd77 "$SLIM"/spotter "$SLIM"/mgg "$SLIM"/x2sys "$SLIM"/tools "$SLIM"/localization
SHARE=$SLIM

# GMT finds its modules with dlopen(NULL)/dlsym(name), which Emscripten does not provide in a static build.
# Generate a replacement dlopen/dlsym backed by a table of libgmt's exported GMT_* / core_* functions.
/emsdk/upstream/bin/llvm-nm -g --defined-only /gmt-install/lib/libgmt.a 2>/dev/null \
  | awk 'NF==3 && $2=="T" && ($3 ~ /^GMT_/ || $3 ~ /^core_/) {print $3}' | sort -u > /tmp/gmt_syms.txt
echo "dlsym table entries: $(wc -l < /tmp/gmt_syms.txt)"
{
  echo '#include <string.h>'
  echo 'extern "C" {'
  sed 's/.*/void &(void);/' /tmp/gmt_syms.txt
  echo '}'
  echo 'static const struct { const char *n; void *p; } gmt_symtab[] = {'
  sed 's/.*/  {"&", (void *)\&&},/' /tmp/gmt_syms.txt
  echo '  {0, 0}};'
  cat <<'DLEOF'
extern "C" {
void *dlopen(const char *file, int flags) { (void)file; (void)flags; return (void *)1; }
void *dlsym(void *handle, const char *name) {
  (void)handle;
  for (int i = 0; gmt_symtab[i].n; i++) if (strcmp(gmt_symtab[i].n, name) == 0) return gmt_symtab[i].p;
  return 0;
}
char *dlerror(void) { return 0; }
int dlclose(void *handle) { (void)handle; return 0; }
/* There is no network in the browser build. GMT only uses the curl "easy" API; without this, every attempt to reach
 * the GMT data server (triggered by e.g. an axis unit written as +u@. ) waits the full 10 s connect timeout.
 * 7 = CURLE_COULDNT_CONNECT: fail immediately instead. */
int curl_easy_perform(void *handle) { (void)handle; return 7; }
}
DLEOF
} > /tmp/gmt_dl.cpp

# em++ because libgdal/libproj are C++
em++ /src/gmt_wasm_wrapper.c /tmp/gmt_dl.cpp -O2 \
  -I/gmt-install/include/gmt -I/libs/include \
  /gmt-install/lib/libgmt.a /gmt-install/lib/libpostscriptlight.a \
  /libs/lib/libgdal.a /libs/lib/libproj.a /libs/lib/libsqlite3.a /libs/lib/libcurl.a \
  /libs/lib/libnetcdf.a /libs/lib/libhdf5_hl.a /libs/lib/libhdf5.a /libs/lib/libpcre2-8.a /libs/lib/libz.a \
  -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=134217728 -s STACK_SIZE=8388608 -s MAXIMUM_MEMORY=2GB -s FORCE_FILESYSTEM=1 \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createGMT -s ENVIRONMENT=worker \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_execute_gmt_command","_execute_gmt_command_ex"]' \
  -s EXPORTED_RUNTIME_METHODS='["FS","ENV","ccall","cwrap","setValue","stringToUTF8","lengthBytesUTF8"]' \
  -Wl,--allow-multiple-definition -lidbfs.js \
  --embed-file "$SHARE"@/gmt-install/share \
  -o "$OUT/gmt.js"

# GSHHG coastlines (netCDF binned files)
curl -fsSL https://github.com/GenericMappingTools/gshhg-gmt/releases/download/2.3.7/gshhg-gmt-2.3.7.tar.gz | tar xz -C /tmp
# Every resolution except full-resolution shorelines: binned_GSHHS_f.nc is 30 MiB, over Cloudflare Pages' 25 MiB
# per-file limit (the worker substitutes the high-resolution file for -Df).
for f in /tmp/gshhg-gmt-2.3.7/binned_*.nc; do
  case "$f" in *binned_GSHHS_f.nc) continue ;; esac
  cp "$f" "$OUT/data/"
done
ls -la "$OUT" "$OUT/data"
