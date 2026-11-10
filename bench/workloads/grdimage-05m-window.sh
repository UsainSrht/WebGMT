#!/bin/bash
gmt begin grdimage_05m ps
	gmt grdimage earth_relief_05m_p.grd -R-66/-60/30/35 -JM6i -Cgeo -B
gmt end
