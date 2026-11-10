#!/bin/bash
gmt grdmath -R0/360/-90/90 -I5m X Y COSD MUL SIN = m.nc
gmt grdinfo m.nc -C -L2
