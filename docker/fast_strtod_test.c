/* Checks docker/fast_strtod.c against the C library's strtod and sscanf("%lf"): the value must be identical bit for bit
 * and the end pointer (return value for sscanf) must be the same, for exhaustive short strings, hand-picked edge cases and random numbers.
 *
 *   npm run test:parse            (compiled for WebAssembly, compared with Emscripten's own libc in Docker: the real reference)
 *   npm run test:parse -- --quick (3 million random strings instead of 60 million)
 *
 * Both glibc and musl round correctly, so the reference is the true value; run under emcc, the reference is the build's libc.
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <stdarg.h>
double fast_strtod(const char *nptr, char **endptr, double (*slow)(const char *, char **));
int fast_sscanf(const char *s, const char *fmt, int (*slow)(const char *, const char *, va_list), va_list ap);
double __real_strtod(const char *nptr, char **endptr) { return strtod(nptr, endptr); }
double __wrap_strtod(const char *nptr, char **endptr);

static uint64_t bits(double d) { uint64_t u; memcpy(&u, &d, 8); return u; }
static long checked, fast_hits, failures, scanf_checked;
static int via_fast_sscanf(const char *s, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = fast_sscanf(s, fmt, vsscanf, ap); va_end(ap); return r; }
static void check_scanf(const char *s, const char *fmt) {
  double a = 12345.0, b = 12345.0;
  int r1 = sscanf(s, fmt, &a);
  int r2 = via_fast_sscanf(s, fmt, &b);
  scanf_checked++;
  int same = r1 == r2 && (r1 != 1 || bits(a) == bits(b) || (isnan(a) && isnan(b)));
  if (!same && failures++ < 20) printf("SSCANF MISMATCH \"%s\" %s: libc ret %d value %a, fast ret %d value %a\n", s, fmt, r1, a, r2, b);
}

static int slow_called;
static double counting_slow(const char *s, char **e) { slow_called = 1; return strtod(s, e); }

static void check(const char *s) {
  char *e1, *e2;
  double a = strtod(s, &e1);
  slow_called = 0;
  double b = fast_strtod(s, &e2, counting_slow);
  checked++;
  if (!slow_called) fast_hits++;
  check_scanf(s, "%lf");
  if (checked % 5 == 0) check_scanf(s, "%lg");
  int same = (isnan(a) && isnan(b)) || bits(a) == bits(b);
  if (!same || (e1 - s) != (e2 - s)) {
    if (failures++ < 20) printf("MISMATCH \"%s\": libc %a (end %ld) fast %a (end %ld)\n", s, a, (long)(e1 - s), b, (long)(e2 - s));
  }
}

static uint64_t rng = 88172645463325252ULL;
static uint64_t next(void) { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; return rng; }

int main(int argc, char **argv) {
  long random_count = argc > 1 ? atol(argv[1]) : 60000000L;   /* random strings; the exhaustive and edge cases always run */
  /* 1. hand-picked */
  const char *edge[] = {
    "", "+", "-", ".", "-.", "+.", "0", "00", "0.", ".0", "-0", "-0.0", "+0", "0e0", "0e999999", "1e", "1e+", "1e-", "1e5", "1E5", "1e+5", "1e-5",
    "1.e5", ".5e1", "5.", "-5.", "0x10", "0X1.8p1", "-0x1p-2", "inf", "-INF", "infinity", "nan", "NaN(abc)", " 5", "\t5", "\n5", "\v5", "\f5", "\r5", "  \t 5.5e3 ", " -.5", " +", " inf", " 0x10", "5 ", "5x", "1_2", "1,5",
    "9007199254740991", "9007199254740992", "9007199254740993", "18446744073709551615", "18446744073709551616", "1e22", "1e23", "1e-22", "1e-23",
    "123456789012345678901234567890", "0.000000000000000000000000001", "0.1", "0.2", "0.3", "0.7", "123.456", "-123.456", "245.00891", "27.49555", "-636.0",
    "2.2250738585072014e-308", "1.7976931348623157e308", "1e309", "5e-324", "1e-400", "4.9406564584124654e-324", "1d5", "1D5", "1e5d", "00000000000000000000001",
    "0.00000000000000000000000000000001", "100000000000000000000", "1000000000000000000000", "99999999999999999999", "3.14159265358979323846", "1e0005", "1e00005",
    "1e12345", "1e-12345", "+1.5", "+.5", "-.5e-3", "7.0e+2", "7e2.5", "1..2", "1.2.3", "1e5e5", "--1", "+-1", "e5", "E", "0e", "0.e", ".e5", "٣", NULL
  };
  for (int i = 0; edge[i]; i++) check(edge[i]);

  /* 2. every string up to length 6 over a small alphabet */
  const char alpha[] = "0123459+-.eE x";
  int na = (int)strlen(alpha);
  char buf[16];
  for (int len = 1; len <= 6; len++) {
    long total = 1; for (int i = 0; i < len; i++) total *= na;
    for (long n = 0; n < total; n++) {
      long m = n; for (int i = 0; i < len; i++) { buf[i] = alpha[m % na]; m /= na; } buf[len] = 0;
      check(buf);
    }
  }

  /* 3. random numbers written in every format GMT data uses, with random precision and magnitude */
  static const char *fmts[] = { "%.*f", "%.*e", "%.*g", "%.*E", "%+.*f", "%.*G" };
  for (long n = 0; n < random_count; n++) {
    uint64_t r = next();
    double v;
    switch (r % 6) {
      case 0: v = (double)(int64_t)(next() % 2000000001ULL) / 1000.0 - 1000000.0; break;           /* thousandths */
      case 1: v = ((double)(next() % 100000000ULL)) / 1e6; break;                                   /* 1e-6 steps */
      case 2: { uint64_t u = next(); memcpy(&v, &u, 8); if (!isfinite(v)) v = 1.5; break; }          /* any double */
      case 3: v = ((double)(next() >> 11)) / 9007199254740992.0 * pow(10.0, (double)(int)(next() % 60) - 30); break;
      case 4: v = (double)(int64_t)(next() % 100000000ULL) - 50000000.0; break;                       /* integers */
      default: v = ((double)(next() % 1000000ULL)) / 100.0 + ((double)(next() % 360)) ; break;      /* coordinates */
    }
    int prec = (int)(next() % 21);
    char text[128];
    snprintf(text, sizeof text, fmts[next() % 6], prec, v);
    /* sometimes add a suffix that must stay unparsed */
    if (next() % 7 == 0) strcat(text, next() % 2 ? "x" : "\t7");
    check(text);
  }

  printf("checked %ld strings with strtod (%ld, %.1f%%, took the fast path) and %ld with sscanf, %ld mismatches\n", checked, fast_hits, 100.0 * fast_hits / checked, scanf_checked, failures);
  return failures ? 1 : 0;
}
