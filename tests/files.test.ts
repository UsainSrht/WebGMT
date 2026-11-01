// Tests for the path helpers and the file-type detection used by the explorer and editor tabs.
import { basename, dirname, extname, join, normalize, relative, resolveFrom, uniqueName, validateName } from '../src/lib/paths'
import { classify, formatSize, kindFromName } from '../src/lib/fileTypes'

let failed = 0, total = 0
const eq = (name: string, got: unknown, want: unknown) => {
  total++
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${name}\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`) }
}
const bytes = (s: string) => new TextEncoder().encode(s)

eq('normalize', normalize('/a//b/./c/../d/'), 'a/b/d')
eq('normalize above root', normalize('../../x'), 'x')
eq('join', join('a', 'b/c', '../d'), 'a/b/d')
eq('dirname', dirname('a/b/c.sh'), 'a/b')
eq('dirname root', dirname('c.sh'), '')
eq('basename', basename('a/b/c.sh'), 'c.sh')
eq('extname', extname('a/b/C.SH'), 'sh')
eq('extname dotfile', extname('.bashrc'), '')
eq('extname none', extname('Makefile'), '')
eq('resolveFrom relative', resolveFrom('hw1', 'data/x.dat'), 'hw1/data/x.dat')
eq('resolveFrom parent', resolveFrom('hw1/sub', '../x.dat'), 'hw1/x.dat')
eq('resolveFrom absolute', resolveFrom('hw1', '/data/x.dat'), 'data/x.dat')
eq('relative same dir', relative('a/b', 'a/b/c.dat'), 'c.dat')
eq('relative sibling', relative('a/b', 'a/d/c.dat'), '../d/c.dat')
eq('relative from root', relative('', 'a/c.dat'), 'a/c.dat')
eq('uniqueName free', uniqueName(new Set(), 'a.sh'), 'a.sh')
eq('uniqueName taken', uniqueName(new Set(['a.sh']), 'a.sh'), 'a (2).sh')
eq('uniqueName taken twice', uniqueName(new Set(['a.sh', 'a (2).sh']), 'a.sh'), 'a (3).sh')
eq('uniqueName no ext', uniqueName(new Set(['notes']), 'notes'), 'notes (2)')
eq('validate ok', validateName('my file.dat'), null)
eq('validate empty', validateName('  ') !== null, true)
eq('validate slash', validateName('a/b') !== null, true)
eq('validate dotdot', validateName('..') !== null, true)

// classification
eq('sh is a gmt script', classify('run.sh', bytes('gmt begin')), { kind: 'text', language: 'gmt' })
eq('dat is plain text', classify('x.dat', bytes('1 2\n3 4\n')), { kind: 'text', language: 'plaintext' })
eq('txt is plain text', classify('x.txt', bytes('hello')), { kind: 'text', language: 'plaintext' })
eq('json', classify('a.json', bytes('{}')).language, 'json')
eq('empty file is text', classify('new.dat', new Uint8Array(0)).kind, 'text')
eq('png is image', classify('a.PNG', new Uint8Array([0x89, 0x50])).kind, 'image')
eq('svg is image', classify('a.svg', bytes('<svg/>')).mime, 'image/svg+xml')
eq('netcdf binary by extension', classify('g.grd', bytes('CDF\u0001')).kind, 'binary')
eq('NUL bytes are binary', classify('mystery', new Uint8Array([65, 0, 66])).kind, 'binary')
eq('invalid utf-8 is binary', classify('mystery.dat', new Uint8Array([0xff, 0xfe, 0xfd, 0x80])).kind, 'binary')
eq('utf-8 text is text', classify('t.txt', bytes('Hüseyin ödev')).kind, 'text')
eq('shebang without extension', classify('run', bytes('#!/bin/bash\ngmt begin\n')).language, 'gmt')
eq('big file is not editable', classify('big.txt', new Uint8Array(6 * 1024 * 1024).fill(65)).tooLarge, true)
eq('kindFromName image', kindFromName('a.jpg'), 'image')
eq('kindFromName unknown', kindFromName('a.zzz'), 'unknown')
eq('formatSize', [formatSize(10), formatSize(2048), formatSize(3 * 1048576)], ['10 B', '2.0 KB', '3.0 MB'])

if (failed) { console.error(`${failed}/${total} file tests failed`); process.exit(1) }
console.log(`files: ${total} checks passed`)
