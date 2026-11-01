# Compiling GMT to WebAssembly: what we did, what broke, what fixed it

This documents how WebGMT's `gmt.js` + `gmt.wasm` were produced from the GMT 6.6.0 sources, in the order things actually happened. It is meant for two readers: anyone reproducing the build, and us when we upgrade GMT.

**Result:** GMT 6.6.0 (core modules) running in a browser Web Worker, with real GSHHG coastlines. `gmt.wasm` is about 17.6 MB. Verified on three scripts (coastlines, scatter + colour scale, contour). Not verified: grids (`grdimage`, `grdcut`...), most other modules, large inputs, non-Chromium browsers.

**Cost:** roughly 20 Docker builds over a long session. Most were not compiler problems but configuration the cross-compile could not detect (type sizes, include paths). The table in section 4 lists every failure so you can skip them.

---

## 1. What you need

- Docker (we used Docker Desktop on Windows) with at least ~8 GB RAM for its VM. **Cap build parallelism** (see mistake M27) or the VM hangs.
- `emscripten/emsdk:latest`, which resolved to **Emscripten 6.0.13** (digest `sha256:fb7864e398acfda863dfcea78b8bc8adad359fa60c6a0bbeb845931de64aa68a`) on 31 Oct 2026. `latest` moves, so **pin `FROM emscripten/emsdk:6.0.13`** for reproducible builds; the `.so`-vs-`.a` behaviour in M16 and the `libemscripten_js_symbols.so` link input are Emscripten-version specific. We did not test any other version.
- Everything else is downloaded inside the build. Budget 30+ minutes for a cold build; Docker caches each step, so later iterations on the last steps take under a minute.

Files (all under `docker/`):

| File | Role |
|---|---|
| `Dockerfile.wasm` | Cross-compiles every dependency and GMT's static libraries |
| `build_wasm.sh` | Final link step: generates a `dlsym` table, links everything into `gmt.js` / `gmt.wasm`, collects the GSHHG data files |
| `gmt_wasm_wrapper.c` | The C entry point JavaScript calls |

Rebuild and extract:

```bash
docker build --progress=plain -f docker/Dockerfile.wasm -t webgmt-wasm docker
id=$(docker create webgmt-wasm) && docker cp "$id":/out ./wasm-out && docker rm "$id"
cp wasm-out/gmt.js wasm-out/gmt.wasm public/gmt/ && cp wasm-out/data/*.nc public/gmt/data/
```

---

## 2. The build, step by step

### Why the dependency list is longer than "GMT needs NetCDF"

GMT 6.6's `src/CMakeLists.txt` marks **libcurl and GDAL as `REQUIRED`**, and the C sources include their headers with no `#ifdef` guards. There is no switch to turn them off. So to compile GMT at all you must build both, even though the browser build uses neither. We discovered this only when configure failed (M9). Plan for it from the start:

| Library | Why | Notes |
|---|---|---|
| zlib 1.3.1 | HDF5, netCDF | |
| PCRE2 10.42 | GMT regex | |
| HDF5 1.14.6 | netCDF-4. **The GSHHG `binned_*.nc` coastline files are NetCDF-4 (HDF5)**, so classic netCDF is not enough | |
| netCDF-C 4.9.2 | GMT grid/coast I/O | |
| sqlite3 3.46 | PROJ | Compiled by hand with `emcc`; a host `sqlite3` binary builds `proj.db` |
| PROJ 9.4.1 | GDAL | `-DENABLE_TIFF=OFF -DENABLE_CURL=OFF` |
| GDAL 3.9.3 | GMT requires it | `-DGDAL_BUILD_OPTIONAL_DRIVERS=OFF -DOGR_BUILD_OPTIONAL_DRIVERS=OFF -DGDAL_USE_EXTERNAL_LIBS=OFF` keeps it small |
| libcurl 8.10.1 | GMT requires it | `-DCURL_ENABLE_SSL=OFF -DHTTP_ONLY=ON`; it compiles but cannot reach a network from the browser |
| FFTW 3.3.10 | built but **unused** (`GMT_USE_OPTIONAL_LIBS=OFF`); safe to delete | |

All are built static (`-DBUILD_SHARED_LIBS=OFF`) into prefix `/libs`.

### GMT itself

Key decisions (each is a fix for a failure in section 4):

1. **Patch `CMakeLists.txt`** to set a normal `CMAKE_MODULE_PATH` (M10).
2. **Pass wasm32 type sizes** as `-DSIZEOF_*` (M8, M13) and `-DNO_SIGHANDLER` (M14).
3. **Build only the libraries**: `cmake --build . -- -k || true`, then require `src/libgmt.a` and `src/libpostscriptlight.a` to exist, and copy them plus the headers by hand. The `gmt` executable target fails to link (M15) and is not needed.
4. **`-DBUILD_SUPPLEMENTS=OFF`**: the supplements are built as a shared plugin that cannot link against static GDAL (M15).
5. Install the runtime data with `cmake -DCMAKE_INSTALL_COMPONENT=Runtime -P share/cmake_install.cmake` (a full `cmake --install` would try to install the executable that was never built).

### Final link (`build_wasm.sh`)

- Link every library by **explicit `.a` path**, not `-lz` etc. (M16).
- Use `em++`, because GDAL/PROJ are C++ (and `extern "C"` the wrapper, M18).
- `-s STACK_SIZE=8388608` (M20), `-s INITIAL_MEMORY=134217728` (M17), `-s ALLOW_MEMORY_GROWTH=1`, `-s ENVIRONMENT=worker`, `-s MODULARIZE=1 -s EXPORT_ES6=1`.
- `--embed-file <share>@/gmt-install/share`: embed the data **at the path GMT has compiled in** (M19).
- Generate a `dlopen`/`dlsym` replacement from `llvm-nm` output of `libgmt.a` (M19b), and link with `-Wl,--allow-multiple-definition` so ours wins over libc's.
- Trim the embedded share data (`mgd77`, `spotter`, `mgg`, `x2sys`, `tools`, `localization`): it was 19 MB of the 29 MB module (M21).

### The wrapper

`execute_gmt_command(module, argc, argv)` creates a session, calls `GMT_Call_Module`, destroys the session. Two non-obvious points:

- With string arguments, the third parameter of `GMT_Call_Module` must be **`argc`**, not `GMT_MODULE_OPT` (that is for pre-parsed option lists).
- **`argc == 0` means "args is a single command string"**, so a module with no arguments (`gmt end`) must be called with `GMT_MODULE_CMD` and an empty string (M22).
- `execute_gmt_command_ex(..., mode)` exists so you can pass `(verbosity << 16)` as the session mode. `7 << 16 = 458752` turns on GMT's debug output, which is how most of the runtime bugs were found.

---

## 3. The browser side (what the worker must do)

These are runtime requirements discovered after the Wasm built. The code is in `src/workers/gmt.worker.ts`.

1. **Set environment variables in `preRun`**, not after startup: libc copies the environment at init (`GMT_SESSION_NAME`, `HOME`). Pass your own config object so `preRun` can reach `cfg.ENV`.
2. **Create `/workspace`** and `chdir` into it; put coastline files in **`/gmt-install/share/coast/`**. Mount both resolutions (`_c`, `_l`): GMT picks by map scale, and if the file it wants is missing it tries to download it with libcurl and stalls on a timeout.
3. **Modern mode needs a persistent session**: every call creates a new GMT session, and modern mode keeps its state in `~/.gmt/sessions/gmt_session.<name>`. A fixed `GMT_SESSION_NAME` makes consecutive calls share it. **Delete that directory before each run**, or stale state leaks between scripts.
4. **`gmt end` always fails** with no Ghostscript (`psconvert`). The raw figure is left in the session dir as `gmt_N.ps-`. Read it, ignore the psconvert errors (filter them from the console), and treat the run as successful if the file exists.
5. **That raw PostScript has an A4 `%%BoundingBox`** (the real one comes from Ghostscript). The renderer must compute a tight box from what is painted.
6. **A Wasm trap poisons the instance.** After any exception from a call, discard the module and instantiate again on the next run.
7. Call `gmt begin name png` as `gmt begin name ps`; PNG would need Ghostscript.
8. **Serve with COOP/COEP headers** (`public/_headers`), and bundle Monaco locally: loading it from a CDN breaks under `Cross-Origin-Embedder-Policy: require-corp`.
9. **Cloudflare Pages limits files to 25 MiB.** `gmt.wasm` must stay below that; this is why the share data is trimmed and the larger GSHHG resolutions are not shipped.
10. **stdin for piped commands.** Scripts use `echo "x y text" | gmt text` and `cmd << EOF` constantly. Pass `stdin: () => next byte or null` in the module options and `clearerr(stdin)` before each call (M29).
11. **No network, fail fast.** Anything that reaches for the GMT server (`@earth_relief`, `@tut_data`, and surprisingly `+u@.`) must fail immediately, not after 10 s (M30).
12. **Coastline data.** GMT picks the resolution from the map scale (`-Da`) and aborts if the file is missing, so for `-Da`/no `-D` mount every bundled resolution (c, l, i, h); for `-Dh` etc. mount just that one (plus `border`/`river` files for `-N`/`-I`). Keep the "already mounted" set for the lifetime of the Wasm instance. Full resolution (`binned_GSHHS_f.nc`, 30 MiB) cannot be hosted on Cloudflare Pages, so `-Df` is served from the high-resolution file under the full-resolution name, with a visible note.
13. **Scripts are shell scripts, not lists of `gmt` commands.** Real GMT scripts use pipes, `awk`, heredocs, backticks, `for` loops, `date`, and tools like `qrencode`. `src/lib/shell.ts` interprets these (see README); `echo`, `awk`, `cat`, `grep`, `date`, `seq`, `printf` and `qrencode` are implemented in TypeScript.
14. **Several figures per script.** A script may contain several `gmt begin … gmt end` blocks (one per figure). Collect the raw figure after each `end`, then delete the session directory before the next `begin` (leftover `gmt.session` state breaks the next figure).

Rendering: PostScript is converted to SVG by our own interpreter (`src/workers/psInterpreter.ts`). Things GMT's PostScript relies on that a "good enough" interpreter gets wrong, each found by comparing against real GMT output:

- **`save`/`restore` must restore the graphics state.** GMT's EPS inclusion (`PSL_eps_begin/end`) scales the picture by ~27 and relies on `restore` to undo it; without that, everything after the first `gmt image` is 27x too large.
- **The current point lives in device space.** GMT does `x y moveto`, then `90 rotate`, then `show`; storing the point in user space moves the text. Same for `translate`/`scale`.
- **A `moveto` right after a `moveto` replaces it.** Otherwise `pathbbox` includes stale points.
- **Text is measured with `stringwidth` and `charpath`+`pathbbox`** (macros `sw`, `sh`, `sd`) and all axis labels/titles are laid out from those numbers. Real font metrics are needed (`psFonts.ts`: Helvetica/Times/Courier AFM widths and glyph boxes); a flat guess puts labels in the wrong place. `charpath` also draws outlined text, so it records text runs rather than painting a rectangle, and it advances the current point.
- **ISOLatin1+ encoding**: byte `0x2D` is a true minus sign, `0xAD` is the hyphen (invisible as a soft hyphen if passed through), `0x27`/`0x60` are curly quotes. GMT font 33 is Zapf Chancery Italic and font 12 is Symbol (`@~p@~` is pi).
- **Images**: `grdimage`, colorbars and EPS pictures are `<< /ImageType 1 … /DataSource currentfile /ASCII85Decode filter /FlateDecode filter >> image` with the data *inside the PostScript stream*. Extract it before tokenizing, decode (ASCII85, Flate via `fflate`), convert indexed/RGB/gray samples, encode a PNG (a worker has no canvas) and emit an SVG `<image>` with the matrix `inverse(ImageMatrix) × CTM × y-flip`.
- **Landscape pages** (`%%Orientation: Landscape`, chosen when the plot is wider than the page) are rotated back to upright, as `psconvert -P` does, and the crop is to what was painted, **not** the page: a script can stack panels far taller than one sheet (`-Y-6i`).
- Hairlines: strokes thinner than 0.25 pt are drawn at 0.25 pt, because PDF viewers draw hairlines at one device pixel and the real outputs look that way.

---

## 4. Everything that went wrong, in order

Process mistakes are marked **(process)**. The rest are build or runtime failures.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| M1 | Prompt's wrapper looked fine but would not work | It passed `GMT_MODULE_OPT` with a `char**`. That mode expects a GMT option list | Pass `argc` as the mode (and see M22) |
| M2 | Wrote the whole Dockerfile before running any of it **(process)** | Assumed URLs and flags from memory | Do the first build early and fix forward; verify every URL with `curl -I` before building |
| M3 | `tar: Error is not recoverable` at zlib | `zlib.net` only hosts the latest release | Use the GitHub release asset |
| M4 | Same error, plus silent bad downloads | `curl -sL` hides 404s and pipes an HTML error page into `tar` | Use `curl -fsSL` everywhere |
| M5 | HDF5 404 (twice) | The tag we guessed (`hdf5_1.14.3`) does not exist; a second guess with the archive URL also 404'd | List tags with `git ls-remote --tags`; use `hdf5_1.14.6` (extracts to `hdf5-hdf5_1.14.6/`) |
| M6 | HDF5: `Could NOT find ZLIB`, `ZLIB::ZLIB` target missing | Emscripten's toolchain restricts `find_package` to its sysroot, so the zlib in `/libs` is invisible | `-DZLIB_LIBRARY=... -DZLIB_INCLUDE_DIR=... -DCMAKE_FIND_ROOT_PATH=$PREFIX`; disable SZIP |
| M7 | HDF5: `use of undeclared identifier 'FE_INVALID'` | Emscripten's `fenv.h` defines no exception flags | `-DCMAKE_C_FLAGS=-DFE_INVALID=0` |
| M8 | netCDF: `typedef redefinition ssize_t`, then `unknown SIZEOF_UCHAR`, then `ix_float implementation` / `NC_fill_int implementation` `#error`s | `config.h` was either not included or missing its `SIZEOF_*` values: CMake's type-size detection does not carry over cross-compiling. We **fixed it three times one macro at a time** before supplying the full set **(process)** | `-DHAVE_CONFIG_H=1 -DHAVE_SSIZE_T=1` plus every wasm32 size (`CHAR 1, SHORT 2, INT 4, LONG 4, LONG_LONG 8, FLOAT 4, DOUBLE 8, SIZE_T 4, OFF_T 8, VOIDP 4`, unsigned variants, `UCHAR/USHORT/UINT/INT64/UINT64`). When one macro is missing, assume many are |
| M9 | GMT configure: `Could NOT find CURL`, then GDAL | GMT 6.6 requires both with no opt-out | Build sqlite3 → PROJ → GDAL (minimal) → libcurl; point GMT at the `.a` files |
| M10 | GMT configure: `include could not find requested file: ConfigCMake` | The Emscripten toolchain sets a normal `CMAKE_MODULE_PATH` that shadows the cached one GMT sets with `CACHE INTERNAL FORCE`. Reproduced in a bare container first, which was the fast way to confirm | `sed` a normal `set(CMAKE_MODULE_PATH ...)` into GMT's `CMakeLists.txt` |
| M11 | The patch from M10 did not apply, and a build ran on the old Dockerfile **(process)** | I used a Python heredoc; Python is not available in that shell, and I did not check the edit before launching | Verify an edit landed (`grep`) before starting a 5-minute build; prefer the editor tool over shell one-liners |
| M12 | GMT link of helper tools: `undefined symbol: H5Pclose, H5open...` | `NETCDF_LIBRARY` listed only `libnetcdf.a`, and static libs need their dependencies listed after them | `"-DNETCDF_LIBRARY=libnetcdf.a;libhdf5_hl.a;libhdf5.a;libz.a"` |
| M13 | GMT compile: `typedef long off_t` redefinition in `gmt_io.h` | GMT defines its own `off_t` when `SIZEOF_OFF_T` is unset | Same wasm32 `-DSIZEOF_*` set as M8 |
| M14 | `gmt_common_sighandler.c`: `no member named 'eip' in 'mcontext_t'` | Crash-backtrace handler reads x86 registers | `-DNO_SIGHANDLER` (GMT's own switch) |
| M15 | `wasm-ld: relocation ... cannot be used against symbol...; recompile with -fPIC` on `supplements.so` and then on `gmt.js` | The supplements plugin and GMT's own executable are linked as position-independent against a non-PIC static GDAL | `-DBUILD_SUPPLEMENTS=OFF`; build only the library targets with `make -k` and do the final link ourselves. Do not try to rebuild GDAL with `-fPIC` unless you need the executable |
| M16 | Final link OK, but at runtime: `need to see wasm magic number` | wasm-ld resolved `-lz` to a **`libz.so`** that zlib's CMake installs next to `libz.a`. Emscripten treats `.so` as a dynamic library, so the module declared a dynamic dependency. (`strings gmt.wasm | grep dylink` showed it) | Link by explicit `.a` path. After any change, check `strings gmt.wasm | grep -c '^dylink'` is 0 |
| M17 | `wasm-ld: initial memory too small, 19552368 bytes needed` | Embedded share data (19 MB) exceeds the 16 MB default | `-s INITIAL_MEMORY=134217728` |
| M18 | `undefined exported symbol: _execute_gmt_command` | Switching to `em++` compiled the `.c` wrapper as C++, mangling the name; also an unused `-lfftw3f` pointed at a library we never built | Wrap the wrapper in `extern "C"`; drop `-lfftw3f` |
| M19 | `GMT_MEMORY_ERROR (25)` from every call, even `gmtdefaults` | **Misleading message.** `gmt_begin()` returned NULL; the real error (`Could not locate share directory for GMT`) only appeared with debug verbosity. Setting `GMT_SHAREDIR` through `Module.ENV` after startup does nothing (section 3, item 1) | Embed the data at the compiled-in path `/gmt-install/share`; if you must use env vars, set them in `preRun` |
| M19b | `Failure while loading core GMT shared library (libgmt.so): dynamic linking not enabled` | GMT finds all modules via `dlopen(NULL)` + `dlsym("GMT_basemap")`. Emscripten's static build provides neither | Generate a `dlopen`/`dlsym`/`dlerror`/`dlclose` replacement backed by a table built from `llvm-nm libgmt.a` (`GMT_*` and `core_*` functions; 223 entries). Needs `--allow-multiple-definition` because libc also defines `dlerror`. Keep it in its own source file: redeclaring GMT functions next to `gmt.h` conflicts |
| M20 | `memory access out of bounds` inside `malloc`, called from `gmt_map_clip_path`, only for `gmt plot` | **Stack overflow.** Emscripten's default stack is 64 KB and GMT uses far more. The stack sits next to static data, which includes the allocator's state, so malloc corrupted rather than the stack faulting. Found by relinking with `--profiling-funcs` to get function names in the trap trace | `-s STACK_SIZE=8388608`. If you see traps *inside* malloc/free, suspect the stack first |
| M21 | `gmt.wasm` was 29.8 MB, over Cloudflare Pages' 25 MiB file limit | 19 MB of it was embedded share data for modules we do not use | Trim `mgd77`, `spotter`, `mgg`, `x2sys`, `tools`, `localization` before embedding: 17.6 MB |
| M22 | `gmt end`: `Unrecognized argument` with garbage | `argc == 0` is `GMT_MODULE_CMD` (a command string), not "no arguments" | Empty-string call, see wrapper |
| M23 | `gmt end`: `Cannot execute Ghostscript (gs)` | Modern mode runs `psconvert` at the end, which needs Ghostscript | Read the raw `gmt_N.ps-` from the session dir (section 3) |
| M24 | After a trap, every later run failed with `memory access out of bounds` on its first call | The Wasm instance stays corrupted after a trap | Re-instantiate the module on the next run |
| M25 | `coast` hung then failed: `Libcurl Error: Timeout`, `No GSHHG databases available` | GMT asked for `binned_GSHHS_c.nc`; we had only mounted `_l`, so it tried to download | Mount both resolutions |
| M26 | The data loader said the files were "not deployed" although they were served | `caches.open()` threw in the test browser, and our `catch` turned any error into "not found" | Treat CacheStorage as optional; fall back to plain `fetch` |
| M27 | **(process)** Docker Desktop hung twice mid-build; my first explanation ("a Docker bug") was wrong | Unlimited `cmake --build -j` started hundreds of C++ compilers during GDAL and exhausted the Docker VM's memory. Symptoms looked like a hang: log silent, `docker ps` and WSL unresponsive, `vmmemWSL` at high CPU. It happened at the *same point* both times, which was the clue | `-j4` on every step. If a build freezes at a reproducible point, suspect resource exhaustion before blaming the tool. Recovery: quit Docker Desktop, `wsl --shutdown`, restart |
| M28 | **(process)** Test results were hard to read at first | Headless Chrome screenshots taken before the app finished loading showed an empty list and led to a false suspicion that seeding was broken | Drive Chrome over the DevTools protocol and read real state (console, DOM), not just screenshots |
| M29 | Found by running real homework scripts, not the samples: only the **first** `echo "..." \| gmt text` / `gmt plot` of a script produced output; later ones were silently empty | C stdio `stdin` keeps a **sticky EOF flag**. Each GMT call is a new session but the process-wide `stdin` stays at EOF after the first piped command | `clearerr(stdin)` at the start of every `execute_gmt_command_ex` call, and supply input through Emscripten's `stdin` module option (a function returning the next byte or `null`) |
| M30 | Some basemap commands took **exactly 10.0 s** (axis unit `+u'@.'`); a script ran 20 s instead of 0.15 s | GMT treats `@name` as a *remote data file* and calls libcurl. libcurl is linked only to satisfy the compiler, there is no network, so each attempt waits out `GMT_CONNECT_TIME_OUT` (10 s). The log line `Libcurl Error: Timeout` was the clue; real GMT hides this because the server answers | Override `curl_easy_perform` (the only curl function that blocks) with a stub returning `CURLE_COULDNT_CONNECT` immediately. It lives in the generated `gmt_dl.cpp`; GMT only uses curl's "easy" API (`grep -ho "curl_[a-z_]*" src/*.c`) |

---

## 5. Debugging techniques that paid off

- **Reproduce in a bare container** before touching the big Dockerfile (`docker run --rm -v tarball:/g.tar.xz emscripten/emsdk bash -c '...'`). This turned M10 from a guess into a confirmed fix in one minute.
- **Debug verbosity through the session mode** (`mode = level << 16`, level 7 = debug) is the only way to see GMT's real reasons; the default error text is often generic (M19).
- **A tiny test worker** that loads `gmt.js` and calls `_execute_gmt_command_ex` directly, run through Chrome DevTools Protocol, isolates GMT problems from the app. We used `begin` → `basemap` → `plot` as the smoke test; adding `end` and `coast` extends it.
- **`--profiling-funcs`** for a readable trap stack; remove it afterwards (it adds ~1.7 MB).
- **`strings gmt.wasm | grep dylink`** to catch accidental dynamic linking; **`curl -I`** every source URL before building.
- Keep Docker layers cached: the expensive layers (GDAL ~5 min) must come *before* anything you are still changing. Final-link experiments (the last `RUN`) take about 30 seconds.

---

## 6. Upgrading GMT: checklist

1. **Check the new version's `src/CMakeLists.txt`** for `REQUIRED` dependencies and for `include_directories` surprises. Note any new mandatory libraries (this is how GDAL/curl ambushed us).
2. Change the tarball URL in `Dockerfile.wasm`. Confirm the tarball still has `cmake/modules/ConfigCMake.cmake` and that the line `include (FindUnixCommands)` the `sed` patches still exists in the top-level `CMakeLists.txt`; if not, the patch silently does nothing (M10, M11).
3. Rebuild and walk through section 4 in order; expect the type-size and `off_t` issues to recur if GMT adds new `SIZEOF_*` checks (`grep -rh 'SIZEOF_[A-Z_]*' src | sort -u` lists what the source tests).
4. **Re-run the three-call smoke test** (`begin`, `basemap`, `plot`) plus `coast` and `end`. Specific things that can change:
   - `GMT_Create_Session` / `GMT_Call_Module` signatures and the `GMT_MODULE_CMD` semantics (wrapper).
   - How modules are located (`gmtapi_get_shared_module_func`): if GMT replaces `dlsym` lookup, the symbol-table trick may become unnecessary or incomplete.
   - Session directory layout and the `gmt_N.ps-` filename (worker).
   - Where GMT looks for `SHAREDIR` and coast data.
5. **Check `gmt.wasm` size** against the Cloudflare limit; more modules or data means more bytes.
6. Check `strings gmt.wasm | grep -c '^dylink'` is 0.
7. Update the GSHHG tarball URL/version in `build_wasm.sh` only if the new GMT requires a newer GSHHG (GMT reports "GSHHG version 2.2.0 or newer is needed").
8. Verify the example scripts in the real UI on the deployed site, not only locally: COOP/COEP and content types differ in production.

## 7. Known gaps (so you do not rediscover them)

- No Ghostscript: `psconvert`, and therefore PNG/PDF/EPS from GMT itself, is unavailable. We convert PostScript ourselves; every `gmt begin … gmt end` block becomes a figure.
- No network: remote data (`@earth_relief`, `@tut_data`) cannot be fetched; libcurl exists only to satisfy the compiler.
- The supplements (`mgd77`, `gshhg` module, `img`, `x2sys`, `spotter`...) are not built.
- The standalone `gmt` executable is not built (M15).
- Everything runs on the main wasm thread inside a worker; there is no multithreading (`ENABLE_OPENMP=OFF`).
- The PostScript interpreter was checked against the real output of ten scripts (basemaps with time/log axes, text and fonts, 3-D perspective, many map projections, filled contours, grdimage/grdview, profiles). Not handled: `-Gp` pattern fills (`makepattern`), `imagemask`, non-ASCII85 image encodings, the `Interpolate` image flag. Unknown operators are logged to the console and skipped.
- Full-resolution shorelines (`-Df`) fall back to high resolution (see item 12 above).
- The shell runner has no `if`/`while`/functions/`$(( ))`; such lines are reported, not run. `ip a` returns nothing (a browser cannot see network interfaces), so `qrencode` strings that include a MAC address omit it.
- Tests: `npm test` runs `tests/awk.test.ts` (our awk vs the system awk) `tests/shell.test.ts` and `tests/files.test.ts` (pipes, heredocs, substitution, loops, error continuation). There is no automated test of the Wasm engine or the renderer; those were checked by running scripts in headless Chrome and comparing with real GMT output.
