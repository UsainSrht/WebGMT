#!/bin/bash
# the whole 05m globe, shaded, in Hammer: the heavy case
gmt begin grdimage_global ps
	gmt grdimage earth_relief_05m_p.grd -I+a45+nt1 -JW20c -Cgeo -Bag
gmt end
