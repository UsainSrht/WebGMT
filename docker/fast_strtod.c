/* Fast paths for reading numbers in the WebAssembly build: strtod and sscanf("%lf").
 *
 * Why: GMT converts every number of a text table with strtod (gmt_scanf_float), and the longitude / latitude columns
 * of geographic data with sscanf("%lf") (gmtio_scanf_geo). Emscripten's libc (musl) does both with `long double`,
 * which on WebAssembly is 128-bit floating point done in software: about 650 ns per number against 50 ns for glibc,
 * so reading a text table was 5-14 times slower than the native GMT. See docs/ENGINE-PERFORMANCE.md.
 *
 * What: the common case is converted exactly with one floating-point operation (Clinger's fast path, 1990):
 *   - the decimal digits fit in 53 bits, so the integer w is exactly a double,
 *   - the power of ten is 10^0 .. 10^22, which are exactly doubles,
 *   so w * 10^k (or w / 10^k) is a single correctly rounded IEEE operation, and the result equals what a correctly
 *   rounded strtod returns, bit for bit. Everything else (more than 19 digits, a large exponent, signs without digits,
 *   "inf", "nan", hexadecimal floats, ...) is left to the original function, so behaviour is the same for every
 *   input. The same end pointer is returned for every string the fast path accepts.
 *
 * Linked with -Wl,--wrap=strtod -Wl,--wrap=sscanf: calls arrive at __wrap_*, the original is __real_strtod / vsscanf.
 * sscanf is only taken over for the exact format "%lf" / "%lg", and only when the fast path consumes the whole string;
 * anything else (trailing text, other formats) goes to the original vsscanf, whose edge cases are left as they are.
 * Verified against the C library's functions on random and edge-case strings by docker/fast_strtod_test.c.
 */
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

double __real_strtod(const char *nptr, char **endptr);

static const double POW10[23] = {
  1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22
};

#define IS_DIGIT(c) ((unsigned)((c) - '0') < 10u)

/* Converts the number at nptr if it is a plain decimal that the fast path can do exactly. Returns 1 and sets *out and
 * *endptr, or 0 (nothing is set) when the original function has to decide. */
int fast_parse(const char *nptr, char **endptr, double *out) {
  const char *s = nptr;
  while (*s == ' ' || (*s >= '\t' && *s <= '\r')) s++;   /* leading white space, as strtod skips it (C locale) */
  int neg = 0;
  if (*s == '-') { neg = 1; s++; } else if (*s == '+') s++;
  /* must start with a digit, or a point followed by a digit; "0x..." (hexadecimal) is left to the original */
  if (IS_DIGIT(*s)) {
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) return 0;
  } else if (!(*s == '.' && IS_DIGIT(s[1]))) {
    return 0;
  }

  uint64_t w = 0;
  int sig = 0;        /* significant digits kept in w (leading zeros do not count) */
  int frac = 0;       /* digits after the decimal point that were kept in w */
  int dropped = 0;    /* digits that did not fit: then we do not know the value exactly */
  while (IS_DIGIT(*s)) {
    if (sig < 19) { w = w * 10 + (uint64_t)(*s - '0'); if (w) sig++; }
    else dropped = 1;
    s++;
  }
  if (*s == '.') {
    s++;
    while (IS_DIGIT(*s)) {
      if (sig < 19) { w = w * 10 + (uint64_t)(*s - '0'); if (w) sig++; frac++; }
      else dropped = 1;
      s++;
    }
  }
  if (dropped) return 0;

  int exp10 = 0;
  const char *end = s;
  if (*s == 'e' || *s == 'E') {
    const char *p = s + 1;
    int eneg = 0;
    if (*p == '-') { eneg = 1; p++; } else if (*p == '+') p++;
    if (IS_DIGIT(*p)) {
      int digits = 0;
      while (IS_DIGIT(*p)) { if (digits < 5) exp10 = exp10 * 10 + (*p - '0'); digits++; p++; }
      if (digits > 4) return 0;   /* absurd exponent: let the original decide (overflow, underflow) */
      if (eneg) exp10 = -exp10;
      end = p;
    } /* else: "1e" or "1e+": the number ends before the 'e', like strtod */
  }

  double v;
  if (w == 0) {
    v = 0.0;                                   /* any exponent: zero (the sign is applied below, so "-0" is -0.0) */
  } else {
    int k = exp10 - frac;
    if (w > (1ULL << 53)) return 0;
    if (k >= 0 && k <= 22) v = (double)w * POW10[k];
    else if (k < 0 && k >= -22) v = (double)w / POW10[-k];
    else return 0;
  }
  *out = neg ? -v : v;
  if (endptr) *endptr = (char *)end;
  return 1;
}

/* the form the test program uses: the fast path, or the given function */
double fast_strtod(const char *nptr, char **endptr, double (*slow)(const char *, char **)) {
  double v;
  return fast_parse(nptr, endptr, &v) ? v : slow(nptr, endptr);
}

double __wrap_strtod(const char *nptr, char **endptr) {
  double v;
  return fast_parse(nptr, endptr, &v) ? v : __real_strtod(nptr, endptr);
}

/* sscanf(s, "%lf", &x) and "%lg": the whole string must be one plain decimal number the fast path can do */
int fast_sscanf(const char *s, const char *fmt, int (*slow)(const char *, const char *, va_list), va_list ap) {
  if (fmt[0] == '%' && fmt[1] == 'l' && (fmt[2] == 'f' || fmt[2] == 'g') && fmt[3] == 0) {
    char *end;
    double v;
    if (fast_parse(s, &end, &v) && *end == 0) {
      double *dst = va_arg(ap, double *);
      *dst = v;
      return 1;
    }
  }
  return slow(s, fmt, ap);
}

int __wrap_sscanf(const char *s, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int r = fast_sscanf(s, fmt, vsscanf, ap);
  va_end(ap);
  return r;
}
