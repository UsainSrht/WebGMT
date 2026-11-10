#!/bin/bash
gmt grdcut earth_relief_05m_p.grd -R-20/60/-35/40 -Gcut.nc
gmt grdinfo cut.nc -C -L2
