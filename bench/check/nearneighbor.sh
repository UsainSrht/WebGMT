#!/bin/bash
gmt nearneighbor tut_ship.xyz -R245/255/20/30 -I5m -S40k -Gn.nc
gmt grdinfo n.nc -C -L2
