// Tests for the "@name" remote-file rewriting.
import { parseRegion, resolveRemote } from '../src/services/remoteData'

let failed = 0, total = 0
const eq = (name: string, got: unknown, want: unknown) => {
  total++
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${name}\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`) }
}

eq('no @ -> null', resolveRemote(['-R0/1/0/1', '-JX5i']), null)
eq('unknown @name untouched', resolveRemote(['-Bxa+l"P@al"', '-F+f30p']), null)
eq('+u@. untouched', resolveRemote(['-Bxaf+u@.']), null)
eq('tutorial file', resolveRemote(['@tut_data.txt', '-W']), { args: ['/gmt-remote/tut_data.txt', '-W'], files: [{ file: 'tut_data.txt' }], notes: [], hints: [] })
eq('quoted netcdf variable', resolveRemote(['-Rg', '"@otemp.anal1deg.nc?otemp[2,0]"'])?.args, ['-Rg', '"/gmt-remote/otemp.anal1deg.nc?otemp[2,0]"'])
eq('same file once', resolveRemote(['@tut_ship.xyz', '@tut_ship.xyz'])?.files.length, 1)
eq('global 10m', resolveRemote(['@earth_relief_10m', '-Rd'])?.args[0], '/gmt-remote/earth_relief_10m_p.grd')
eq('global 01d_g suffix', resolveRemote(['@earth_relief_01d_g'])?.args[0], '/gmt-remote/earth_relief_01d_p.grd')
eq('05m is bundled globally', resolveRemote(['@earth_relief_05m', '-R0/10/0/10'])?.args[0], '/gmt-remote/earth_relief_05m_p.grd')
eq('05m without -R', resolveRemote(['@earth_relief_05m'])?.notes, [])
eq('30s outside the tutorial region falls back with a note', [resolveRemote(['@earth_relief_30s', '-R0/10/0/10'])?.args[0], resolveRemote(['@earth_relief_30s', '-R0/10/0/10'])?.notes.length], ['/gmt-remote/earth_relief_10m_p.grd', 1])
eq('01m (not bundled) falls back', resolveRemote(['@earth_relief_01m'])?.args[0], '/gmt-remote/earth_relief_10m_p.grd')
eq('30s tutorial region', resolveRemote(['@earth_relief_30s', '-R-108/-103/35/40', '-JM6i'])?.args[0], '/gmt-remote/tut_relief.nc')
// hints for data we do not have
const has = (lines: string[] | undefined, text: string) => !!lines?.some((l) => l.includes(text))
{
  const r = resolveRemote(['@earth_relief_01m', '-R-66/-60/30/35', '-JM5i'])
  eq('tiled dataset: falls back to 10m', r?.args[0], '/gmt-remote/earth_relief_10m_p.grd')
  eq('tiled dataset: hint tells how to cut the region with the script\'s own -R', has(r?.hints, 'gmt grdcut @earth_relief_01m -R-66/-60/30/35 -Gregion.nc'), true)
  eq('tiled dataset: hint says what to do with the file', has(r?.hints, 'drag region.nc into the file explorer'), true)
}
eq('tiled dataset without a numeric region: placeholder', has(resolveRemote(['@earth_relief_01m', '-Rg'])?.hints, '-R<west>/<east>/<south>/<north>'), true)
{
  const r = resolveRemote(['@earth_relief_06m', '-R0/10/0/10'])
  eq('single-file dataset: download link', has(r?.hints, 'https://oceania.generic-mapping-tools.org/server/earth/earth_relief/earth_relief_06m_p.grd'), true)
  eq('single-file dataset: name to use', has(r?.hints, 'write earth_relief_06m_p.grd instead of @earth_relief_06m'), true)
}
{
  const r = resolveRemote(['@earth_geoid_10m_g', '-R0/10/0/10'])
  eq('other family: not rewritten', r?.args[0], '@earth_geoid_10m_g')
  eq('other family: link in its own folder, keeps registration', has(r?.hints, '/server/earth/earth_geoid/earth_geoid_10m_g.grd'), true)
}
eq('moon dataset folder', has(resolveRemote(['@moon_relief_06m'])?.hints, '/server/moon/moon_relief/moon_relief_06m_p.grd'), true)
{
  const r = resolveRemote(['@topo.8.4.img', '-R0/1/0/1'])
  eq('unknown cache file: not rewritten', r?.args[0], '@topo.8.4.img')
  eq('unknown cache file: download link and name', has(r?.hints, 'https://oceania.generic-mapping-tools.org/cache/topo.8.4.img') && has(r?.hints, 'write topo.8.4.img (without the @)'), true)
}
eq('colour palette from the cache', has(resolveRemote(['-C@earth_age.cpt'])?.hints, '/cache/earth_age.cpt'), true)
eq('a name that is not a server file gets no hint', resolveRemote(['@nonexistent_file.txt']), null)
eq('hint only once per name', resolveRemote(['@topo.8.4.img', '@topo.8.4.img'])?.hints.length, 2)
eq('no hint for text escapes and axis units', resolveRemote(['-Bxa+l"P@al, not Pal"', '-Bxaf+u@.', '-F+f@~p@~']), null)
eq('no hint for bundled data', resolveRemote(['@earth_relief_10m', '@tut_data.txt'])?.hints, [])
eq('parseRegion',parseRegion(['-JM5i', '-R-66/-60/30/35']), [-66, -60, 30, 35])
eq('parseRegion global', parseRegion(['-Rg']), null)
eq('parseRegion with +r', parseRegion(['-R10/20/30/40+r']), [10, 20, 30, 40])

if (failed) { console.error(`${failed}/${total} remote tests failed`); process.exit(1) }
console.log(`remote: ${total} checks passed`)
