import Dexie, { type EntityTable } from 'dexie'
import type { FileRecord, HistoryRecord, ScriptRecord } from '../types'

class WebGmtDB extends Dexie {
  scripts!: EntityTable<ScriptRecord, 'id'>
  files!: EntityTable<FileRecord, 'id'>
  history!: EntityTable<HistoryRecord, 'id'>

  constructor() {
    super('webgmt')
    this.version(1).stores({
      scripts: '++id, title, updatedAt',
      files: '++id, &name, updatedAt',
      history: '++id, scriptId, executedAt',
    })
  }
}

export const db = new WebGmtDB()

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

export const DEFAULT_SCRIPTS: Omit<ScriptRecord, 'id'>[] = [
  { title: 'World map', content: WORLD, tags: ['coast', 'basemap'] },
  { title: 'Earthquakes scatter', content: QUAKES, tags: ['plot', 'cpt'] },
  { title: 'Contour map', content: CONTOUR, tags: ['contour'] },
].map((s) => ({ ...s, createdAt: Date.now(), updatedAt: Date.now() }))

export async function seedIfEmpty() {
  if ((await db.scripts.count()) === 0) await db.scripts.bulkAdd(DEFAULT_SCRIPTS)
}
