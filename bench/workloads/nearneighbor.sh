#!/bin/bash
gmt nearneighbor tut_ship.xyz -R245/255/20/30 -I5m -S40k -Gship_nn.nc
gmt grdinfo ship_nn.nc > /dev/null
