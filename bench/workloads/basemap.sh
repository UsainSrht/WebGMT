#!/bin/bash
gmt begin basemap ps
	gmt basemap -R0/10/0/10 -JX12c -Bafg -B+tbenchmark
gmt end
