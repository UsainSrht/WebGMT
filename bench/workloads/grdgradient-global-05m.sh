#!/bin/bash
# 4320 x 2160 = 9.3 million nodes
gmt grdgradient earth_relief_05m_p.grd -A45 -Nt1 -Ggrad.nc
gmt grdinfo grad.nc > /dev/null
