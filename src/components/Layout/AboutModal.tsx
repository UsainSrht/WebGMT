import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import license from '../../../LICENSE?raw'
import notices from '../../../THIRD-PARTY-NOTICES.md?raw'
import { APP_VERSION, AUTHOR, AUTHOR_URL, GMT_DOCS, GMT_REPO, GMT_VERSION, WEBGMT_REPO } from '../../lib/version'

const LICENSE_FILES: [string, string][] = [
  ['GMT-LICENSE.txt', 'GMT'], ['LGPL-3.0.txt', 'LGPL-3.0'], ['GPL-3.0.txt', 'GPL-3.0'], ['GDAL-LICENSE.txt', 'GDAL'], ['PROJ-COPYING.txt', 'PROJ'],
  ['netCDF-COPYRIGHT.txt', 'netCDF'], ['HDF5-COPYING.txt', 'HDF5'], ['curl-COPYING.txt', 'curl'], ['PCRE2-LICENCE.txt', 'PCRE2'],
  ['zlib-README.txt', 'zlib'], ['Emscripten-LICENSE.txt', 'Emscripten'], ['npm-licenses.txt', 'npm packages'],
]

type Tab = 'about' | 'license' | 'notices'

const link = 'text-blue-600 underline hover:text-blue-500 dark:text-blue-400'
const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a className={link} href={href} target="_blank" rel="noreferrer">{children}</a>

export function AboutModal({ initial = 'about', onClose }: { initial?: Tab; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initial)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`border-b-2 px-3 py-1.5 text-sm ${tab === id ? 'border-blue-500 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
    >{label}</button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label="About WebGMT" className="flex max-h-[85vh] w-[42rem] max-w-full flex-col rounded-lg bg-white shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-lg font-semibold">WebGMT <span className="text-sm font-normal text-slate-500">v{APP_VERSION}</span></h2>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex border-b border-slate-200 px-3 dark:border-slate-700">
          {tabBtn('about', 'About')}{tabBtn('license', 'License')}{tabBtn('notices', 'Third-party')}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
          {tab === 'about' && (
            <div className="space-y-3">
              <p>WebGMT runs the real <A href={GMT_REPO}>Generic Mapping Tools</A> {GMT_VERSION}, compiled to WebAssembly, entirely in your browser. Nothing you write or upload leaves your computer.</p>
              <p>Made by <A href={AUTHOR_URL}>{AUTHOR}</A>. Source code: <A href={WEBGMT_REPO}>WebGMT on GitHub</A>. Released under the MIT License.</p>
              <p>
                <b>Credit:</b> all of the mapping is done by GMT, created and maintained by Paul Wessel, Walter H. F. Smith, Remko Scharroo, Joaquim Luis,
                Florian Wobbe, Dongdong Tian, Leonardo Uieda and the GMT team. Coastlines come from the GSHHG database (Wessel &amp; Smith).
                Please cite GMT when you publish maps made with it: Wessel et al. (2019), <i>Geochemistry, Geophysics, Geosystems</i>, 20, 5556-5564, doi:10.1029/2019GC008515.
              </p>
              <p>GMT documentation: <A href={GMT_DOCS}>docs.generic-mapping-tools.org</A></p>
              <p className="text-xs text-slate-500">WebGMT is an independent project and is not affiliated with or endorsed by the GMT project. GMT is licensed under LGPL-3.0-or-later; see the Third-party tab.</p>
            </div>
          )}
          {tab === 'license' && <pre className="whitespace-pre-wrap font-mono text-xs">{license}</pre>}
          {tab === 'notices' && (
            <>
              <p className="mb-2 text-xs">Full license texts: {LICENSE_FILES.map(([f, n], i) => <span key={f}>{i > 0 && ', '}<A href={`/licenses/${f}`}>{n}</A></span>)}</p>
              <pre className="whitespace-pre-wrap font-mono text-xs">{notices}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
