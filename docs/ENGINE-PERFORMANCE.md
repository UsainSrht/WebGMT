# Engine performance: why reading text tables was slow, and the fix

The WebAssembly build of GMT was 3-8 times slower than the native `gmt` on anything that reads a text table (a
`.xyz` file, the longitude/latitude columns of a map plot), while pure number crunching was at native speed. This is
what the cause was, how it was found, how the fix is proven exact, and what is still slower than native.

## Summary

- **Cause:** every number read from text goes through `strtod` (plain columns) or `sscanf("%lf")` (longitude/latitude
  columns). Emscripten's libc (musl) implements both with `long double`, which on WebAssembly is 128-bit floating
  point done in software: about 650 ns per number against 50 ns for glibc.
- **Fix:** `docker/fast_strtod.c` converts the common case exactly with one floating-point operation and hands every
  other input to the original function. It is linked in with `-Wl,--wrap=strtod -Wl,--wrap=sscanf` (see
  `docker/build_wasm.sh`). 0 differences against the C library over 68 million `strtod` and 82 million `sscanf`
  comparisons, and identical output of the whole engine on 59 scripts.
- **Effect** (engine time in the browser, median of 10 runs):

| Script | Native GMT | Before | After | Speed-up |
|---|---|---|---|---|
| `gmt info` of 82,970 lines | 67 ms | 207 ms | 25 ms | 8.1x |
| `blockmedian` | 105 ms | 271 ms | 102 ms | 2.7x |
| `surface` (reads 83k points, then solves) | 227 ms | 398 ms | 220 ms | 1.8x |
| `psxy` of 83k symbols | 104 ms | 287 ms | 115 ms | 2.5x |
| text to text (`gmt convert`) | 147 ms | 337 ms | 159 ms | 2.1x |
| `grdmath` (reads no text: control) | 684 ms | 730 ms | 745 ms | 1.0x |

Native times include about 35 ms per `gmt` call for starting the process, which the browser does not pay; see
[BENCHMARKS.md](BENCHMARKS.md) for the full comparison.

## How the cause was found

The benchmark ([bench/](../bench/README.md)) showed the gap on `blockmedian`, `surface` and `plot` of the 2.3 MB ship
data but not on `grdmath`, so it was not general slowness of WebAssembly. Candidates, and what ruled each in or out:

| Candidate | Test | Result |
|---|---|---|
| Reading the file (Emscripten's in-memory file system, stdio) | Same C program, native glibc and Emscripten/node: `fgets`, `getc`, `fread` over the file | WebAssembly was as fast or faster (1.7 ms against 43 ms for `fgets`): **not the cause** |
| Writing text (`printf`) | `snprintf("%.12g")` of 249,000 numbers | 36 ms against 49 ms native: **not the cause** |
| Integer parsing | `strtol` | 14 ms against 9 ms: **not the cause** |
| Plain floating-point arithmetic | 20 passes over the data | 4.1 ms against 2.4 ms: **not the cause** |
| **Converting text to a floating-point number** | `strtod` of the 249,000 numbers | **163 ms against 12 ms: 13.6 times slower** |
| | `sscanf("%lf")` per line | **182 ms against 21 ms: 8.5 times slower** |

The size matched what was observed in the engine (about 150 ms extra for `gmt info`). To be sure it was in the
engine and not only in a test program, the engine was relinked with function names (`--profiling-funcs`) and profiled in
Chrome while running `blockmedian`: the time was in `fmodl`, `__floatscan`, `__addtf3`, `__multf3` and `__letf2`
(musl's float scanning and the software quad-precision helpers it uses), called from `vfscanf` and
`gmtio_scanf_geo`. In GMT's source (`gmt_io.c`) a plain number is read by `gmt_scanf_float` with `strtod`, and a
geographic coordinate by `gmtio_scanf_geo` with `sscanf (scopy, "%lf", &dd)`; those are the two paths.

An early assumption that `surface`, `blockmedian` and `plot` were slow because of "text I/O" was wrong in its details:
fixing `strtod` alone left them unchanged, because their coordinates go through `sscanf`. The profile is what showed it.

## The fix, and why it is exact

`fast_parse` in `docker/fast_strtod.c` implements Clinger's fast path (1990). If a decimal number has at most 15-19
significant digits that fit in 53 bits, and a decimal exponent between -22 and 22, then both the integer `w` of its
digits and the power of ten `10^k` are exactly representable as doubles, so `w * 10^k` (or `w / 10^k`) is **one**
correctly rounded IEEE operation. That is the value a correctly rounded `strtod` returns, bit for bit. WebAssembly's
`f64` is strict IEEE (no extended precision), so there is no double rounding.

Everything the fast path is not certain about goes to the original function unchanged: more than 19 digits, a large
exponent, `inf`, `nan`, hexadecimal floats, a sign with no digits, text that does not start like a number. The end
pointer is identical for every string the fast path accepts (for example `1e` and `1e+` end before the `e`, like
`strtod`).

`sscanf` is taken over only for the exact formats `"%lf"` and `"%lg"`, and only when the fast path consumes the **whole**
string. That last rule matters: musl's `sscanf("2E", "%lf")` returns 0 (a matching failure), which `strtod`-like parsing
would not reproduce. Every other format, and every string with trailing text, goes to the real `vsscanf`.

## Proof

1. **The function against the C library** (`npm run test:parse`, needs Docker; about 5 minutes, `-- --quick` about 25 s).
   Every string up to length 6 over the alphabet `0123459+-.eE x`, 104 hand-picked edge cases, and 60 million
   random numbers in six formats with random precision and magnitude. Compared: the value bit for bit, the end pointer
   for `strtod`, the return value and value for `sscanf` with both `%lf` and `%lg`. Run natively against glibc and
   compiled to WebAssembly against musl, the build's own libc. Result: 0 mismatches in 68 million strings.
   The test was checked to be able to fail: loosening the 53-bit limit, the `10^22` limit or the "whole string" rule
   each produce thousands to hundreds of thousands of mismatches.
2. **The engine against its previous build.** The old engine was relinked from the same libraries and is byte-identical
   to the one that was deployed (same SHA-256), so the only difference between the two is the fix. All 21 tutorial
   scripts, the 13 benchmark workloads, the 10 check scripts and 15 scripts that print numbers with 17 significant digits
   (plain and geographic data, mixed formats, Fortran `1d5` exponents, `NaN`, 21-digit numbers, denormals,
   `10:30:15.5` and `30.5W` notation, a million-line table) give **identical** PostScript fingerprints and
   byte-identical text: 29 figures and about 56 MB of printed numbers.
3. **The engine against native GMT.** `npm run bench:check` prints real data files with 17 digits on both sides
   (`parse-text`, `parse-geo`, `parse-quakes`, `parse-small`) and requires identical text, so a parsing difference of
   one bit in any number fails it.

## Rebuilding the engine

`docker/Dockerfile.wasm` copies `fast_strtod.c` and `docker/build_wasm.sh` compiles it and links with
`--wrap=strtod --wrap=sscanf`. To benchmark an engine build without installing it, use
`npm run bench:web -- --engine <folder with gmt.js and gmt.wasm>`.

## What is still slower than native

Found by the same profiling; none of it is text reading, and none of it is changed here:

- **Sorting.** About a third of `blockmedian` is musl's `qsort` (smoothsort: `sift`, `cycle`, `trinkle`), which is
  slower than glibc's. A faster `qsort` could be linked the same way, but has to give identical results for equal keys,
  which needs its own proof.
- **Solver arithmetic.** More than half of `surface` is `surface_iterate`, plain floating-point loops. The native build is
  compiled with `-O3` and auto-vectorised SSE; the WebAssembly build is `-O2` without SIMD. `grdgradient` (1.18x) and
  `nearneighbor` (1.04x) are in this class. Building with `-msimd128` is untested.
- **Binary and redirected output** is about 2.5x native (`x-text2bin`): the worker receives program output through a
  line-based callback. Not investigated further.
- **Other `sscanf` formats** (`"%d:%lf"` for degree-minute notation, times such as `hh:mm:ss.sss`) still use the slow
  routine. They are rare in large files.
