#!/bin/bash
# Runs the workloads with the native GMT CLI. Mounted by bench/native/run.mjs:
#   /workloads (scripts, read-only)  /data (bundled data files, read-only)  /out (results)
# Per run it records: total wall time, time inside `gmt` calls other than `end` (the engine), time in `gmt end`
# (psconvert + Ghostscript, which WebGMT replaces with its own PostScript renderer), peak memory and PostScript size.
REPS=${REPS:-10}; WARMUP=${WARMUP:-2}; ONLY=${ONLY:-}
OUT=/out/native.tsv
ns() { date +%s%N; }

cat > /bench/wrap.sh <<'WRAP'
gmt() {
  local s e rc
  s=$(date +%s%N); command gmt "$@"; rc=$?; e=$(date +%s%N)
  echo "$1 $((e - s))" >> "$TIMELOG"
  return $rc
}
WRAP

# the data is copied into the container first: reading it through the bind mount from the host disk would slow the native side
mkdir -p /srv/data && cp /data/* /srv/data/

printf 'workload\titer\ttotal_ms\tengine_ms\tend_ms\tpeak_kb\tps_bytes\tstatus\n' > "$OUT"
for script in /workloads/*.sh; do
  name=$(basename "$script" .sh)
  if [ -n "$ONLY" ] && ! echo ",$ONLY," | grep -q ",$name,"; then continue; fi
  for i in $(seq 1 $((WARMUP + REPS))); do
    work=$(mktemp -d); cd "$work"
    for f in /srv/data/*; do ln -s "$f" .; done
    export TIMELOG="$work/.times" BASH_ENV=/bench/wrap.sh
    : > "$TIMELOG"
    t0=$(ns)
    /usr/bin/time -f '%M' -o "$work/.mem" bash "$script" > "$work/.stdout" 2> "$work/.stderr"
    rc=$?
    t1=$(ns)
    unset BASH_ENV
    engine=$(awk '$1!="end"{s+=$2} END{printf "%.3f", s/1e6}' "$TIMELOG")
    endms=$(awk '$1=="end"{s+=$2} END{printf "%.3f", s/1e6}' "$TIMELOG")
    mem=$(tail -1 "$work/.mem")
    ps=$(cat *.ps 2>/dev/null | wc -c)
    if [ "$i" -eq $((WARMUP + REPS)) ]; then mkdir -p /out/logs; cp "$work/.stdout" "/out/logs/$name.txt"; fi
    [ "$i" -le "$WARMUP" ] && continue
    printf '%s\t%d\t%.3f\t%s\t%s\t%s\t%s\t%s\n' "$name" $((i - WARMUP)) "$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.3f",(b-a)/1e6}')" "$engine" "$endms" "$mem" "$ps" "$rc" >> "$OUT"
    [ "$rc" -ne 0 ] && { echo "[$name] exit $rc:"; tail -3 "$work/.stderr"; }
    cd /; rm -rf "$work"
  done
  echo "done $name"
done
gmt --version > /out/native-version.txt
