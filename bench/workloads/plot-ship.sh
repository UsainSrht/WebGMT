#!/bin/bash
# 82,970 shipboard soundings
gmt begin plot_ship ps
	gmt plot tut_ship.xyz -R245/255/20/30 -JM6i -Sc0.04c -Gblack -B
gmt end
