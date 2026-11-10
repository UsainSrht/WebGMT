#!/bin/bash
gmt begin grdview_30s ps
	gmt makecpt -Cdem2 -T1000/5000
	gmt grdview tut_relief.nc -R-108/-103/35/40 -JM4i -p135/35 -Qi50 -I+a100+ne0.8 -B -JZ0.5i
gmt end
