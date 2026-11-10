#!/bin/bash
gmt blockmedian tut_ship.xyz -R245/255/20/30 -I5m > b.xyz
gmt surface b.xyz -R245/255/20/30 -I5m -Gs.nc
gmt grdinfo s.nc -C -L2
