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
eq('tutorial file', resolveRemote(['@tut_data.txt', '-W']), { args: ['/gmt-remote/tut_data.txt', '-W'], files: [{ file: 'tut_data.txt' }], notes: [] })
eq('quoted netcdf variable', resolveRemote(['-Rg', '"@otemp.anal1deg.nc?otemp[2,0]"'])?.args, ['-Rg', '"/gmt-remote/otemp.anal1deg.nc?otemp[2,0]"'])
eq('same file once', resolveRemote(['@tut_ship.xyz', '@tut_ship.xyz'])?.files.length, 1)
eq('global 10m', resolveRemote(['@earth_relief_10m', '-Rd'])?.args[0], '/gmt-remote/earth_relief_10m_p.grd')
eq('global 01d_g suffix', resolveRemote(['@earth_relief_01d_g'])?.args[0], '/gmt-remote/earth_relief_01d_p.grd')
eq('05m is bundled globally', resolveRemote(['@earth_relief_05m', '-R0/10/0/10'])?.args[0], '/gmt-remote/earth_relief_05m_p.grd')
eq('05m without -R', resolveRemote(['@earth_relief_05m'])?.notes, [])
eq('30s outside the tutorial region falls back with a note', [resolveRemote(['@earth_relief_30s', '-R0/10/0/10'])?.args[0], resolveRemote(['@earth_relief_30s', '-R0/10/0/10'])?.notes.length], ['/gmt-remote/earth_relief_10m_p.grd', 1])
eq('01m (not bundled) falls back', resolveRemote(['@earth_relief_01m'])?.args[0], '/gmt-remote/earth_relief_10m_p.grd')
eq('30s tutorial region', resolveRemote(['@earth_relief_30s', '-R-108/-103/35/40', '-JM6i'])?.args[0], '/gmt-remote/tut_relief.nc')
eq('parseRegion', parseRegion(['-JM5i', '-R-66/-60/30/35']), [-66, -60, 30, 35])
eq('parseRegion global', parseRegion(['-Rg']), null)
eq('parseRegion with +r', parseRegion(['-R10/20/30/40+r']), [10, 20, 30, 40])

if (failed) { console.error(`${failed}/${total} remote tests failed`); process.exit(1) }
console.log(`remote: ${total} checks passed`)
