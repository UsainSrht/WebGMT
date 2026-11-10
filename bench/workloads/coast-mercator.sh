#!/bin/bash
gmt begin coast_mercator ps
	gmt coast -R-130/-70/24/52 -JM6i -B -Ggray -Wthin -Di
gmt end
