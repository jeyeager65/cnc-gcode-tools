(ViewerDemo T2 only)
(FluidNC post for FreeCAD - V1E Jackpot style. Run from the SD card.)
(CNCSIM 1 UNITS=mm)
(Stock: XMIN=0 XMAX=300 YMIN=0 YMAX=180 ZMIN=-19 ZMAX=0)
(PriorJob: ViewerDemo_T1_flat.nc)
(ToolDef 2: SHAPE=bullnose D=12.7 CR=3 FLUTES=2 LEN=25 OAL=60 NAME=1/2in bull nose R3)
G0 G54 G17 G21 G90 G94

(===== Settings - edit here =====)
(Feeds, mm/min)
#<t2_feed>=1200 (T2 1/2in bull nose R3 - cutting: 1200 mm/min = 20 mm/s)
#<t2_plunge>=180 (T2 1/2in bull nose R3 - plunging: 180 mm/min = 3 mm/s)
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

(===== T2: 1/2in bull nose R3 - Kobalt trim router dial 2 = ~14000 RPM, ~3 min =====)
T2
G4 P0 (finish queued moves, then home Z - FluidNC 4.1 rejects $HZ while moving)
$HZ
G0 X#<probe_x> Y#<probe_y> (probe spot: the uncut front-left corner)
M0 (MSG, Change to Tool T2 1/2in bull nose R3 and Attach Probe - keep X0 Y0)
G38.2 Z[-#<probe_depth>] F#<probe_feed> P#<plate> (probe, Z = plate thickness)
G0 Z#<probe_clear>
M0 (MSG, Remove Probe and Turn On Router at Dial 2)
(MSG, 1/1 T2 Stadium pocket - ~3 min)
(Stadium pocket)
G0 Z#<clear_z>
G0 X184.650 Y154.650
G0 Z#<safe_z>
G1 Z-2.000 F#<t2_plunge>
G3 X174.900 Y158.650 I-9.658 J-9.658 F#<t2_feed>
G1 X135.100
G3 X121.350 Y144.900 I-0.091 J-13.658
G1 Y120.100
G3 X135.100 Y106.350 I13.658 J-0.091
G1 X174.900
G3 X188.650 Y120.100 I0.091 J13.658
G1 Y144.900
G3 X184.650 Y154.650 I-13.658 J0.091
G0 Z#<clear_z>
G0 X181.056 Y151.056
G0 Z#<safe_z>
G1 Z-2.000 F#<t2_plunge>
G3 X174.820 Y153.570 I-6.073 J-6.073 F#<t2_feed>
G1 X135.180
G3 X126.430 Y144.820 I-0.162 J-8.587
G1 Y120.180
G3 X135.180 Y111.430 I8.587 J-0.162
G1 X174.820
G3 X183.570 Y120.180 I0.162 J8.587
G1 Y144.820
G3 X181.056 Y151.056 I-8.587 J0.162
G0 Z#<clear_z>
G0 X177.462 Y147.462
G0 Z#<safe_z>
G1 Z-2.000 F#<t2_plunge>
G3 X174.741 Y148.490 I-2.499 J-2.499 F#<t2_feed>
G1 X135.259
G3 X131.510 Y144.741 I-0.223 J-3.527
G1 Y120.259
G3 X135.259 Y116.510 I3.527 J-0.223
G1 X174.741
G3 X178.490 Y120.259 I0.223 J3.527
G1 Y144.741
G3 X177.462 Y147.462 I-3.527 J0.223
G0 Z#<clear_z>
G0 X173.410 Y143.410
G0 Z#<safe_z>
G1 Z-2.000 F#<t2_plunge>
G1 X136.590 F#<t2_feed>
G1 Y121.590
G1 X173.410
G1 Y143.410
G0 Z#<clear_z>
G0 X168.330 Y138.330
G0 Z#<safe_z>
G1 Z-2.000 F#<t2_plunge>
G1 X141.670 F#<t2_feed>
G1 Y126.670
G1 X168.330
G1 Y138.330
G0 Z#<clear_z>
G0 X163.250 Y133.250
G0 Z#<safe_z>
G1 Z-2.000 F#<t2_plunge>
G1 X146.750 F#<t2_feed>
G1 Y131.750
G1 X163.250
G1 Y133.250
G1 Z-4.000 F#<t2_plunge>
G1 X146.750 F#<t2_feed>
G1 Y131.750
G1 X163.250
G1 Y133.250
G0 Z#<clear_z>
G0 X168.330
G0 Z#<safe_z>
G1 Z-4.000 F#<t2_plunge>
G1 Y138.330 F#<t2_feed>
G1 X141.670
G1 Y126.670
G1 X168.330
G1 Y133.250
G0 Z#<clear_z>
G0 X173.410
G0 Z#<safe_z>
G1 Z-4.000 F#<t2_plunge>
G1 Y143.410 F#<t2_feed>
G1 X136.590
G1 Y121.590
G1 X173.410
G1 Y133.250
G0 Z#<clear_z>
G0 X178.490
G0 Z#<safe_z>
G1 Z-4.000 F#<t2_plunge>
G1 Y144.741 F#<t2_feed>
G3 X174.741 Y148.490 I-3.527 J0.223
G1 X135.259
G3 X131.510 Y144.741 I-0.223 J-3.527
G1 Y120.259
G3 X135.259 Y116.510 I3.527 J-0.223
G1 X174.741
G3 X178.490 Y120.259 I0.223 J3.527
G1 Y133.250
G0 Z#<clear_z>
G0 X183.570
G0 Z#<safe_z>
G1 Z-4.000 F#<t2_plunge>
G1 Y144.820 F#<t2_feed>
G3 X174.820 Y153.570 I-8.587 J0.162
G1 X135.180
G3 X126.430 Y144.820 I-0.162 J-8.587
G1 Y120.180
G3 X135.180 Y111.430 I8.587 J-0.162
G1 X174.820
G3 X183.570 Y120.180 I0.162 J8.587
G1 Y133.250
G0 Z#<clear_z>
G0 X188.650
G0 Z#<safe_z>
G1 Z-4.000 F#<t2_plunge>
G1 Y144.900 F#<t2_feed>
G3 X174.900 Y158.650 I-13.658 J0.091
G1 X135.100
G3 X121.350 Y144.900 I-0.091 J-13.658
G1 Y120.100
G3 X135.100 Y106.350 I13.658 J-0.091
G1 X174.900
G3 X188.650 Y120.100 I0.091 J13.658
G1 Y133.250
G1 Z-6.000 F#<t2_plunge>
G1 Y144.900 F#<t2_feed>
G3 X174.900 Y158.650 I-13.658 J0.091
G1 X135.100
G3 X121.350 Y144.900 I-0.091 J-13.658
G1 Y120.100
G3 X135.100 Y106.350 I13.658 J-0.091
G1 X174.900
G3 X188.650 Y120.100 I0.091 J13.658
G1 Y133.250
G0 Z#<clear_z>
G0 X183.570
G0 Z#<safe_z>
G1 Z-6.000 F#<t2_plunge>
G1 Y144.820 F#<t2_feed>
G3 X174.820 Y153.570 I-8.587 J0.162
G1 X135.180
G3 X126.430 Y144.820 I-0.162 J-8.587
G1 Y120.180
G3 X135.180 Y111.430 I8.587 J-0.162
G1 X174.820
G3 X183.570 Y120.180 I0.162 J8.587
G1 Y133.250
G0 Z#<clear_z>
G0 X178.490
G0 Z#<safe_z>
G1 Z-6.000 F#<t2_plunge>
G1 Y144.741 F#<t2_feed>
G3 X174.741 Y148.490 I-3.527 J0.223
G1 X135.259
G3 X131.510 Y144.741 I-0.223 J-3.527
G1 Y120.259
G3 X135.259 Y116.510 I3.527 J-0.223
G1 X174.741
G3 X178.490 Y120.259 I0.223 J3.527
G1 Y133.250
G0 Z#<clear_z>
G0 X173.410
G0 Z#<safe_z>
G1 Z-6.000 F#<t2_plunge>
G1 Y143.410 F#<t2_feed>
G1 X136.590
G1 Y121.590
G1 X173.410
G1 Y133.250
G0 Z#<clear_z>
G0 X168.330
G0 Z#<safe_z>
G1 Z-6.000 F#<t2_plunge>
G1 Y138.330 F#<t2_feed>
G1 X141.670
G1 Y126.670
G1 X168.330
G1 Y133.250
G0 Z#<clear_z>
G0 X163.250
G0 Z#<safe_z>
G1 Z-6.000 F#<t2_plunge>
G1 X146.750 F#<t2_feed>
G1 Y131.750
G1 X163.250
G1 Y133.250
G0 Z#<clear_z>
(Finish operation: T2_bull_nose_stadium_pocket)

G4 P0 (finish queued moves, then home Z - FluidNC 4.1 rejects $HZ while moving)
$HZ
(MSG, Done - Turn Off Router)
M30
