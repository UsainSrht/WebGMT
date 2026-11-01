// Compares our awk against the system awk on programs typical for GMT scripts. Skipped when no `awk` is installed.
import { execFileSync } from 'node:child_process'
import { runAwk } from '../src/lib/awk'

const csv = ['id,a,b,c,d,lat,lon,depth,e,f,g,mag', ...Array.from({ length: 40 }, (_, i) => `q${i},a,b,c,d,${(25 + (i * 7) % 24).toFixed(3)},${(-124 + (i * 13) % 56).toFixed(3)},${((i * 3) % 40).toFixed(1)},e,f,g,${(1 + (i % 6) * 0.9).toFixed(1)}`)].join('\n') + '\n'
const xy = Array.from({ length: 21 }, (_, i) => `${i * 50 - 100} ${(i * 37) % 100}`).join('\n') + '\n'
const pop = '-86.79 32.80 5024279 "Alabama"\n-111.43 34.16 7151502 "Arizona"\n-119.68 36.11 39538223 "California"\n'

const cases: [string, string, string?][] = [
  [String.raw`{percent=$3/346396648*100;printf "%s %s %.2f\n", $1, $2, percent}`, pop],
  [String.raw`{percent_sign="%"$3; print $1, $2, percent_sign}`, pop],
  [String.raw`$12>0 {print $7,$6,$12^3/3001}`, csv, ','],
  [String.raw`$8=$8*-1 {print $7,$6,$8,$12}`, csv, ','],
  [String.raw`$8>10 {print $7,$6,$8,$12}`, csv, ','],
  [String.raw`{print $1, $2*2, $1 " and " $2, NR, NF}`, xy],
  [String.raw`BEGIN{s=0} {s+=$2} END{print s, s/NR}`, xy],
  [String.raw`NR>2 && $1<100 {x=$1^2; printf "%5.1f|%-6d|%e|%g\n", x, $2, x, x/3}`, xy],
  [String.raw`{if ($2>20) print "hi", $0; else print "lo"}`, xy],
  [String.raw`{gsub(/a/, "A"); print length($0), toupper($1), substr($1,2,3)}`, csv, ','],
  [String.raw`BEGIN{for(i=1;i<=5;i++) print i*2, i*i}`, ''],
  [String.raw`BEGIN{i=0; while(i<4){ if (i==2){i++; continue}; print i; i++ }}`, ''],
  [String.raw`{a[$1]=$2} END{ if (100 in a) print "yes", a[100]; else print "no"}`, xy],
  [String.raw`BEGIN{for(i=0;i<10;i++){ if(i==3) break; s=s i " " } print s}`, ''],
  [String.raw`BEGIN{x[1]=1; x[2]=2; delete x[1]; n=0; for(k in x) n++; print n}`, ''],
  [String.raw`BEGIN{for(x=0;x<=360;x+=90) printf "%d %.4f\n", x, sin(x*3.14159265358979/180)}`, ''],
]

let awkAvailable = true
try { execFileSync('awk', ['{ print }'], { input: '' }) } catch { awkAvailable = false }
if (!awkAvailable) { console.log('awk tests skipped: no system awk found'); process.exit(0) }

let failed = 0
for (const [prog, input, fs] of cases) {
  let mine: string
  try { mine = runAwk(prog, input, { fs }) } catch (e) { mine = 'ERROR ' + (e as Error).message }
  const ref = execFileSync('awk', [...(fs ? ['-F' + fs] : []), prog], { input }).toString()
  if (mine !== ref) { failed++; console.log(`FAIL ${prog}\n  ours: ${JSON.stringify(mine.slice(0, 120))}\n  awk : ${JSON.stringify(ref.slice(0, 120))}`) }
}
console.log(`awk: ${cases.length - failed}/${cases.length} programs match the system awk`)
if (failed) process.exit(1)
