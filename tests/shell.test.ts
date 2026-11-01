// Tests for the bash-like script runner, using a recording runtime in place of GMT.
import { runShell, type ShellRuntime } from '../src/lib/shell'

interface Call { module: string; args: string[]; stdin: string | null; line: number }

async function run(script: string, files: Record<string, string> = {}) {
  const store = new Map<string, Uint8Array>(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]))
  const calls: Call[] = []
  const logs: string[] = []
  const rt: ShellRuntime = {
    vfs: {
      read: (n) => store.get(n),
      write: (n, d, append) => { const o = store.get(n); store.set(n, append && o ? new Uint8Array([...o, ...d]) : d) },
      remove: (n) => { store.delete(n) },
    },
    async gmt(module, args, stdin, line) {
      calls.push({ module, args, stdin: stdin ? new TextDecoder().decode(stdin) : null, line })
      return { status: args.includes('--fail') ? 72 : 0, stdout: new Uint8Array() }
    },
    log: (s, t) => { logs.push(`${s}: ${t}`) },
    now: () => new Date(Date.UTC(2026, 10, 1, 1, 30, 5)),
  }
  const r = await runShell(script, rt)
  return { ...r, calls, logs, store }
}

let failed = 0, total = 0
const check = (name: string, cond: boolean, detail = '') => { total++; if (!cond) { failed++; console.log(`FAIL ${name} ${detail}`) } }
const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), `\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`)

{
  const r = await run(`R=-R0/10/0/10\nJ=-JX5c\ngmt basemap $R $J -Bafg\n`)
  eq('variables expand', r.calls[0].args, ['-R0/10/0/10', '-JX5c', '-Bafg'])
}
{
  const r = await run(`gmt basemap -Bxa90g30+u'@.'+l"Angle (deg)" -BWS+t"A & B"`)
  eq('quotes keep spaces and GMT escapes', r.calls[0].args, ['-Bxa90g30+u@.+lAngle (deg)', '-BWS+tA & B'])
}
{
  const r = await run(`echo "3 4 hello" | gmt text -F+f12p`)
  eq('echo | gmt passes stdin', [r.calls[0].module, r.calls[0].stdin], ['text', '3 4 hello\n'])
}
{
  const r = await run(`gmt plot -Sc0.2c << COR\n-115 30\n-108 42\nCOR\n`)
  eq('heredoc as stdin', r.calls[0].stdin, '-115 30\n-108 42\n')
}
{
  const r = await run(`cat > pts.txt << EOF\n1 2\n3 4\nEOF\ngmt plot pts.txt`, {})
  eq('heredoc to file', new TextDecoder().decode(r.store.get('pts.txt')), '1 2\n3 4\n')
}
{
  const r = await run(`N=$(echo 7)\nT=\`date +%Y\`\ngmt basemap -R0/$N/0/$N --title=$T`)
  eq('command substitution ($() and backticks)', r.calls[0].args, ['-R0/7/0/7', '--title=2026'])
}
{
  const r = await run(`awk -F, '$2>1 {print $1, $2*10}' d.csv | gmt plot -Sc0.1c`, { 'd.csv': 'a,1\nb,2\nc,3\n' })
  eq('awk | gmt', r.calls[0].stdin, 'b 20\nc 30\n')
}
{
  const r = await run(`gmt plot missing.txt --fail\ngmt basemap -R0/1/0/1\n`)
  eq('continues after a failing gmt command', r.calls.map((c) => c.module), ['plot', 'basemap'])
  check('...and reports the script as failed', r.ok === false)
}
{
  const r = await run(`ip a | grep link/ether\necho done`)
  check('grep with no match is not a script failure', r.ok === true)
}
{
  const r = await run(`nosuchcmd\n`)
  check('unknown command fails the script and is reported', r.ok === false && r.logs.some((l) => l.includes('command not found')))
}
{
  const r = await run(`for i in 1 2 3; do gmt basemap -R0/$i/0/$i; done`)
  eq('for loop (one line)', r.calls.map((c) => c.args[0]), ['-R0/1/0/1', '-R0/2/0/2', '-R0/3/0/3'])
}
{
  const r = await run(`for f in a b\ndo\n  for k in $(seq 1 2); do gmt basemap -B$f$k; done\ndone\ngmt end`)
  eq('nested multi-line for loops with seq', r.calls.map((c) => c.args[0] ?? c.module), ['-Ba1', '-Ba2', '-Bb1', '-Bb2', 'end'])
}
{
  const r = await run(`qrencode "hello world" -t EPS -o qr.eps\ngmt image qr.eps -Dx0/0+w3c`)
  const eps = new TextDecoder().decode(r.store.get('qr.eps'))
  check('qrencode writes an EPS the script can use', eps.startsWith('%!PS-Adobe') && eps.includes('%%BoundingBox'))
}
{
  const r = await run(`echo $(echo a b) | cat`)
  check('pipelines inside substitution', r.ok)
}

console.log(`shell: ${total - failed}/${total} checks passed`)
if (failed) process.exit(1)
