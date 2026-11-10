#!/bin/bash
gmt begin grdcontour_05m ps
	gmt grdcontour earth_relief_05m_p.grd -R-66/-60/30/35 -JM6i -C250 -A1000 -B
gmt end
