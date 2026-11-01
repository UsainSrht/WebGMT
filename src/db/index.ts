import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { BlobRecord, FileRecord, HistoryRecord, NodeRecord, ScriptRecord } from '../types'
import { uniqueName } from '../lib/paths'
import { TUTORIAL_SCRIPTS } from './tutorialExamples'

class WebGmtDB extends Dexie {
  /** v1 tables, only read by the v2 upgrade (scripts and data files used to be separate lists) */
  scripts!: EntityTable<ScriptRecord, 'id'>
  files!: EntityTable<FileRecord, 'id'>
  history!: EntityTable<HistoryRecord, 'id'>
  /** v2: one project tree of files and folders. Contents are kept apart so listing the tree never loads them. */
  nodes!: EntityTable<NodeRecord, 'id'>
  blobs!: EntityTable<BlobRecord, 'id'>

  constructor() {
    super('webgmt')
    this.version(1).stores({
      scripts: '++id, title, updatedAt',
      files: '++id, &name, updatedAt',
      history: '++id, scriptId, executedAt',
    })
    this.version(2)
      .stores({
        nodes: '++id, parentId, &[parentId+name]',
        blobs: 'id',
      })
      .upgrade(migrateV1)
    this.on('populate', (tx) => { void seedExamples(tx) })
  }
}

export const db = new WebGmtDB()

const enc = new TextEncoder()
const toBuffer = (s: string) => enc.encode(s).buffer as ArrayBuffer

/** v1 -> v2: every script becomes "<title>.sh" and every data file keeps its name, all in the project root. */
async function migrateV1(tx: Transaction) {
  const taken = new Set<string>()
  const add = async (name: string, data: ArrayBuffer, createdAt: number, updatedAt: number) => {
    const safe = name.replace(/[\\/\0]/g, '-').trim() || 'untitled'
    const unique = uniqueName(taken, safe)
    taken.add(unique)
    const id = (await tx.table('nodes').add({ parentId: 0, name: unique, kind: 'file', size: data.byteLength, createdAt, updatedAt })) as number
    await tx.table('blobs').put({ id, data })
  }
  for (const f of (await tx.table('files').toArray()) as FileRecord[]) await add(f.name, f.data, f.updatedAt, f.updatedAt)
  for (const s of (await tx.table('scripts').toArray()) as ScriptRecord[]) {
    await add(/\.[A-Za-z0-9]+$/.test(s.title) ? s.title : `${s.title}.sh`, toBuffer(s.content), s.createdAt, s.updatedAt)
  }
}

const WORLD = `#!/bin/bash
# World map: coastlines, land/ocean fill and a graticule
gmt begin world png
  gmt basemap -R-180/180/-80/80 -JQ0/18c -Bafg -BWSen+t"World Map"
  gmt coast -Gtan -Slightblue -W0.25p,gray30
gmt end
`

const QUAKES = `#!/bin/bash
# Earthquake scatter plot using an inline synthetic CSV (lon,lat,magnitude)
cat > quakes.csv << EOF
-122.4,37.8,4.1
-118.2,34.0,3.2
-155.5,19.4,5.0
-72.5,-33.0,6.2
-70.1,-20.2,5.5
142.4,38.3,6.8
139.7,35.7,4.4
121.0,14.6,5.1
105.8,-6.2,5.9
95.9,3.3,7.1
28.9,41.0,4.6
13.4,42.4,5.3
-150.0,61.2,5.7
-175.0,-21.0,6.0
168.0,-16.0,6.4
EOF

gmt begin quakes png
  gmt basemap -R-180/180/-70/75 -JQ0/18c -Bafg -BWSen+t"Synthetic earthquakes"
  gmt coast -Ggray85 -Slightcyan -W0.1p,gray50
  gmt makecpt -Chot -T3/8/0.5
  gmt plot quakes.csv -Sc0.28c -C -W0.5p,black
  gmt colorbar -DJBC -Bxaf+l"Magnitude"
gmt end
`

const CONTOUR = `#!/bin/bash
# Contour map from scattered x,y,z points (inline data)
cat > surface.xyz << EOF
0 0 1
2 0 3
4 0 2
6 0 5
8 0 4
10 0 6
0 3 2
2 3 5
4 3 7
6 3 6
8 3 5
10 3 4
0 6 4
2 6 6
4 6 9
6 6 8
8 6 4
10 6 2
0 10 3
2 10 4
4 10 6
6 10 5
8 10 3
10 10 1
EOF

gmt begin contours png
  gmt basemap -R0/10/0/10 -JX14c/12c -Bafg -BWSen+t"Contours (interval 1)"
  gmt contour surface.xyz -C1 -W0.8p,blue
  gmt plot surface.xyz -Sc0.12c -Gred
gmt end
`

export const EXAMPLE_FOLDER = 'examples'
export const EXAMPLE_SCRIPTS: [string, string][] = [
  ['world-map.sh', WORLD],
  ['earthquakes.sh', QUAKES],
  ['contour-map.sh', CONTOUR],
]

/** First start: an "examples" folder with the three sample scripts and the GMT tutorial figures. */
async function seedExamples(tx: Transaction) {
  const now = Date.now()
  const folder = (await tx.table('nodes').add({ parentId: 0, name: EXAMPLE_FOLDER, kind: 'folder', size: 0, createdAt: now, updatedAt: now })) as number
  for (const [name, text] of EXAMPLE_SCRIPTS) {
    const data = toBuffer(text)
    const id = (await tx.table('nodes').add({ parentId: folder, name, kind: 'file', size: data.byteLength, createdAt: now, updatedAt: now })) as number
    await tx.table('blobs').put({ id, data })
  }
  const tut = (await tx.table('nodes').add({ parentId: folder, name: 'gmt-tutorial', kind: 'folder', size: 0, createdAt: now, updatedAt: now })) as number
  for (const [name, text] of TUTORIAL_SCRIPTS) {
    const data = toBuffer(text)
    const id = (await tx.table('nodes').add({ parentId: tut, name, kind: 'file', size: data.byteLength, createdAt: now, updatedAt: now })) as number
    await tx.table('blobs').put({ id, data })
  }
}
