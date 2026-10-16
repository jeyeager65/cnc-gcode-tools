(ViewerDemo T1 only)
(FluidNC post for FreeCAD - V1E Jackpot style. Run from the SD card.)
(CNCSIM 1 UNITS=mm)
(Stock: XMIN=0 XMAX=300 YMIN=0 YMAX=180 ZMIN=-19 ZMAX=0)
(ToolDef 1: SHAPE=flat D=6.35 FLUTES=2 LEN=22 OAL=50 NAME=1/4in flat end mill)
G0 G54 G17 G21 G90 G94

(===== Settings - edit here =====)
(Feeds, mm/min)
#<t1_feed>=1200 (T1 1/4in flat end mill - cutting: 1200 mm/min = 20 mm/s)
#<t1_plunge>=240 (T1 1/4in flat end mill - plunging: 240 mm/min = 4 mm/s)
(Heights above the board top, mm)
#<clear_z>=4 (rapids between regions)
#<safe_z>=2 (feed moves start from here)
(Touch plate)
#<plate>=0.5 (plate thickness, mm)
#<probe_feed>=200 (200 mm/min = 3.33 mm/s)
#<probe_depth>=110 (probe goes down to Z-110 at most, below the work zero)
#<probe_clear>=10 (Z after probing)
#<probe_x>=5 (probe spot X)
#<probe_y>=5 (probe spot Y)

(Start: Tool T1 1/4in flat end mill in the router, jogged to board front-left corner, just above the board, router off)

(===== T1: 1/4in flat end mill - Kobalt trim router dial 2.5 = ~16000 RPM, ~7 min =====)
G10 L20 P0 X0 Y0 Z0 (here = X0 Y0, temporary Z0)
G0 X#<probe_x> Y#<probe_y> (probe spot: the uncut front-left corner)
M0 (MSG, Attach Probe)
G38.2 Z[-#<probe_depth>] F#<probe_feed> P#<plate> (probe, Z = plate thickness)
G0 Z#<probe_clear>
M0 (MSG, Remove Probe and Turn On Router at Dial 2.5)
(MSG, 1/1 T1 Pocket + island - ~7 min)
(Pocket + island)
G0 Z#<clear_z>
G0 X91.825 Y161.825
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X18.175 F#<t1_feed>
G1 Y103.175
G1 X91.825
G1 Y161.825
G0 Z#<clear_z>
G0 X88.968 Y158.968
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X21.032 F#<t1_feed>
G1 Y106.032
G1 X88.968
G1 Y158.968
G0 Z#<clear_z>
G0 X86.110 Y156.110
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X23.890 F#<t1_feed>
G1 Y108.890
G1 X86.110
G1 Y156.110
G0 Z#<clear_z>
G0 X83.252 Y153.252
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X61.471 F#<t1_feed>
G2 X61.471 Y111.748 I-6.465 J-20.752
G1 X83.252
G1 Y153.252
G0 Z#<clear_z>
G0 X80.395 Y150.395
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X71.877 F#<t1_feed>
G2 X71.877 Y114.605 I-16.873 J-17.895
G1 X80.395
G1 Y150.395
G0 Z#<clear_z>
G0 X78.808 Y148.808
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X75.488 F#<t1_feed>
G2 X78.808 Y143.385 I-19.968 J-15.950
G1 Y148.808
G0 Z#<clear_z>
G0 X70.581 Y143.172
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G3 X56.259 Y151.343 I-15.581 J-10.672 F#<t1_feed>
G3 X53.741 Y113.657 I-1.259 J-18.843
G3 X70.581 Y143.172 I1.259 J18.843
G0 Z#<clear_z>
G0 X68.224 Y141.558
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G3 X56.135 Y148.489 I-13.224 J-9.058 F#<t1_feed>
G3 X53.865 Y116.511 I-1.135 J-15.989
G3 X68.224 Y141.558 I1.135 J15.989
G0 Z#<clear_z>
G0 X65.868 Y139.944
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G3 X56.010 Y145.634 I-10.868 J-7.444 F#<t1_feed>
G3 X53.990 Y119.366 I-1.010 J-13.134
G3 X65.868 Y139.944 I1.010 J13.134
G0 Z#<clear_z>
G0 X48.529 Y153.252
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X26.747 F#<t1_feed>
G1 Y111.748
G1 X48.529
G2 X48.529 Y153.252 I6.465 J20.752
G0 Z#<clear_z>
G0 X38.123 Y150.395
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X29.605 F#<t1_feed>
G1 Y114.605
G1 X38.123
G2 X38.123 Y150.395 I16.873 J17.895
G0 Z#<clear_z>
G0 X34.512 Y148.808
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X31.192 F#<t1_feed>
G1 Y143.385
G2 X34.512 Y148.808 I23.376 J-10.582
G0 Z#<clear_z>
G0 X31.192 Y121.615
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 Y116.192 F#<t1_feed>
G1 X34.512
G2 X31.193 Y121.615 I19.968 J15.950
G0 Z#<clear_z>
G0 X75.488 Y116.192
G0 Z#<safe_z>
G1 Z-2.000 F#<t1_plunge>
G1 X78.808 F#<t1_feed>
G1 Y121.615
G2 X75.488 Y116.192 I-23.376 J10.582
G1 Z-4.000 F#<t1_plunge>
G1 X78.808 F#<t1_feed>
G1 Y121.615
G2 X75.488 Y116.192 I-23.376 J10.582
G0 Z#<clear_z>
G0 X74.246 Y117.181
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G2 X71.877 Y114.605 I-19.242 J15.319 F#<t1_feed>
G1 X80.395
G1 Y150.395
G1 X71.877
G2 X74.246 Y117.181 I-16.873 J-17.895
G0 Z#<clear_z>
G0 X72.011 Y118.961
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G2 X61.471 Y111.748 I-17.005 J13.539 F#<t1_feed>
G1 X83.252
G1 Y153.252
G1 X61.471
G2 X72.011 Y118.961 I-6.465 J-20.752
G0 Z#<clear_z>
G0 X69.777 Y120.739
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G3 X56.259 Y151.343 I-14.777 J11.761 F#<t1_feed>
G3 X53.741 Y113.657 I-1.259 J-18.843
G3 X69.777 Y120.739 I1.259 J18.843
G0 Z#<clear_z>
G0 X67.541 Y122.518
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G3 X56.135 Y148.489 I-12.541 J9.982 F#<t1_feed>
G3 X53.865 Y116.511 I-1.135 J-15.989
G3 X67.541 Y122.518 I1.135 J15.989
G0 Z#<clear_z>
G0 X65.307 Y124.297
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G3 X56.010 Y145.634 I-10.307 J8.203 F#<t1_feed>
G3 X53.990 Y119.366 I-1.010 J-13.134
G3 X65.307 Y124.297 I1.010 J13.134
G0 Z#<clear_z>
G0 Y108.890
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G1 X86.110 F#<t1_feed>
G1 Y156.110
G1 X23.890
G1 Y108.890
G1 X65.307
G0 Z#<clear_z>
G0 Y106.032
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G1 X88.968 F#<t1_feed>
G1 Y158.968
G1 X21.032
G1 Y106.032
G1 X65.307
G0 Z#<clear_z>
G0 Y103.175
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G1 X91.825 F#<t1_feed>
G1 Y161.825
G1 X18.175
G1 Y103.175
G1 X65.307
G0 Z#<clear_z>
G0 X48.529 Y111.748
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G2 X48.529 Y153.252 I6.465 J20.752 F#<t1_feed>
G1 X26.747
G1 Y111.748
G1 X48.529
G0 Z#<clear_z>
G0 X38.123 Y114.605
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G2 X38.123 Y150.395 I16.873 J17.895 F#<t1_feed>
G1 X29.605
G1 Y114.605
G1 X38.123
G0 Z#<clear_z>
G0 X34.512 Y116.192
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G2 X31.193 Y121.615 I19.968 J15.950 F#<t1_feed>
G1 X31.192 Y116.192
G1 X34.512
G0 Z#<clear_z>
G0 X31.192 Y143.385
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G2 X34.512 Y148.808 I23.376 J-10.582 F#<t1_feed>
G1 X31.192
G1 Y143.385
G0 Z#<clear_z>
G0 X75.488 Y148.808
G0 Z#<safe_z>
G1 Z-4.000 F#<t1_plunge>
G2 X78.808 Y143.385 I-19.968 J-15.950 F#<t1_feed>
G1 Y148.808
G1 X75.488
G1 Z-6.000 F#<t1_plunge>
G2 X78.808 Y143.385 I-19.968 J-15.950 F#<t1_feed>
G1 Y148.808
G1 X75.488
G0 Z#<clear_z>
G0 X74.246 Y147.819
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G2 X71.877 Y114.605 I-19.242 J-15.319 F#<t1_feed>
G1 X80.395
G1 Y150.395
G1 X71.877
G2 X74.246 Y147.819 I-16.873 J-17.895
G0 Z#<clear_z>
G0 X72.011 Y146.039
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G2 X61.471 Y111.748 I-17.005 J-13.539 F#<t1_feed>
G1 X83.252
G1 Y153.252
G1 X61.471
G2 X72.011 Y146.039 I-6.465 J-20.752
G0 Z#<clear_z>
G0 X69.777 Y144.261
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G3 X56.259 Y151.343 I-14.777 J-11.761 F#<t1_feed>
G3 X53.741 Y113.657 I-1.259 J-18.843
G3 X69.777 Y144.261 I1.259 J18.843
G0 Z#<clear_z>
G0 X67.541 Y142.482
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G3 X56.135 Y148.489 I-12.541 J-9.982 F#<t1_feed>
G3 X53.865 Y116.511 I-1.135 J-15.989
G3 X67.541 Y142.482 I1.135 J15.989
G0 Z#<clear_z>
G0 X65.307 Y140.703
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G3 X56.010 Y145.634 I-10.307 J-8.203 F#<t1_feed>
G3 X53.990 Y119.366 I-1.010 J-13.134
G3 X65.307 Y140.703 I1.010 J13.134
G0 Z#<clear_z>
G0 Y156.110
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 X23.890 F#<t1_feed>
G1 Y108.890
G1 X86.110
G1 Y156.110
G1 X65.307
G0 Z#<clear_z>
G0 Y158.968
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 X21.032 F#<t1_feed>
G1 Y106.032
G1 X88.968
G1 Y158.968
G1 X65.307
G0 Z#<clear_z>
G0 Y161.825
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 X18.175 F#<t1_feed>
G1 Y103.175
G1 X91.825
G1 Y161.825
G1 X65.307
G0 Z#<clear_z>
G0 X48.529 Y153.252
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 X26.747 F#<t1_feed>
G1 Y111.748
G1 X48.529
G2 X48.529 Y153.252 I6.465 J20.752
G0 Z#<clear_z>
G0 X38.123 Y150.395
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 X29.605 F#<t1_feed>
G1 Y114.605
G1 X38.123
G2 X38.123 Y150.395 I16.873 J17.895
G0 Z#<clear_z>
G0 X34.512 Y148.808
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 X31.192 F#<t1_feed>
G1 Y143.385
G2 X34.512 Y148.808 I23.376 J-10.582
G0 Z#<clear_z>
G0 X31.192 Y121.615
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 Y116.192 F#<t1_feed>
G1 X34.512
G2 X31.193 Y121.615 I19.968 J15.950
G0 Z#<clear_z>
G0 X75.488 Y116.192
G0 Z#<safe_z>
G1 Z-6.000 F#<t1_plunge>
G1 X78.808 F#<t1_feed>
G1 Y121.615
G2 X75.488 Y116.192 I-23.376 J10.582
G0 Z#<clear_z>
(Finish operation: T1_flat_pocket_around_island)

G4 P0 (finish queued moves, then home Z - FluidNC 4.1 rejects $HZ while moving)
$HZ
(MSG, Done - Turn Off Router)
M30
