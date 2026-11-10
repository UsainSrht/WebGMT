#!/bin/bash
gmt blockmedian tut_ship.xyz -R245/255/20/30 -I5m > ship_5m.xyz
gmt surface ship_5m.xyz -R245/255/20/30 -I5m -Gship.nc
gmt grdinfo ship.nc > /dev/null
