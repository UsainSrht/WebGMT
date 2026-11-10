#!/bin/bash
gmt grdgradient earth_relief_05m_p.grd -A45 -Nt1 -Gg.nc
gmt grdinfo g.nc -C -L2
