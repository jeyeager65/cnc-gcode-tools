(ViewerDemo T5 only)
(FluidNC post for FreeCAD - V1E Jackpot style. Run from the SD card.)
(CNCSIM 1 UNITS=mm)
(Stock: XMIN=0 XMAX=300 YMIN=0 YMAX=180 ZMIN=-19 ZMAX=0)
(PriorJob: ViewerDemo_T1_flat.nc)
(PriorJob: ViewerDemo_T2_bullnose.nc)
(PriorJob: ViewerDemo_T3_ball.nc)
(PriorJob: ViewerDemo_T4_vbit.nc)
(ToolDef 5: SHAPE=vbit D=6 ANGLE=118 FLUTES=2 OAL=60 NAME=6mm drill 118 deg)
G0 G54 G17 G21 G90 G94

(===== Settings - edit here =====)
(Feeds, mm/min)
#<t5_feed>=600 (T5 6mm drill 118 deg - cutting: 600 mm/min = 10 mm/s)
#<t5_plunge>=120 (T5 6mm drill 118 deg - plunging: 120 mm/min = 2 mm/s)
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

(===== T5: 6mm drill 118 deg - Kobalt trim router dial 1 = ~10000 RPM, <1 min =====)
T5
G4 P0 (finish queued moves, then home Z - FluidNC 4.1 rejects $HZ while moving)
$HZ
G0 X#<probe_x> Y#<probe_y> (probe spot: the uncut front-left corner)
M0 (MSG, Change to Tool T5 6mm drill 118 deg and Attach Probe - keep X0 Y0)
G38.2 Z[-#<probe_depth>] F#<probe_feed> P#<plate> (probe, Z = plate thickness)
G0 Z#<probe_clear>
M0 (MSG, Remove Probe and Turn On Router at Dial 1)
(MSG, 1/1 T5 Drill holes - <1 min)
(Drill holes)
(Begin Drilling)
G0 Z#<clear_z>
( G98 )
G0 X235.000 Y122.000
G0 Z#<safe_z>
(G83 X235.000 Y122.000 Z-12.000 F120.000 Q4.500 R3.000)
G0 Z3.000
G1 Z-1.500 F#<t5_plunge>
G0 Z3.000
G0 Z-1.275
G1 Z-6.000
G0 Z3.000
G0 Z-5.775
G1 Z-10.500
G0 Z3.000
G0 Z-10.275
G1 Z-12.000
G0 Z3.000
G0 X255.000
(G83 X255.000 Y122.000 Z-12.000 F120.000 Q4.500 R3.000)
G1 Z-1.500
G0 Z3.000
G0 Z-1.275
G1 Z-6.000
G0 Z3.000
G0 Z-5.775
G1 Z-10.500
G0 Z3.000
G0 Z-10.275
G1 Z-12.000
G0 Z3.000
G0 X275.000
(G83 X275.000 Y122.000 Z-12.000 F120.000 Q4.500 R3.000)
G1 Z-1.500
G0 Z3.000
G0 Z-1.275
G1 Z-6.000
G0 Z3.000
G0 Z-5.775
G1 Z-10.500
G0 Z3.000
G0 Z-10.275
G1 Z-12.000
G0 Z3.000
G0 X265.000 Y150.000
(G83 X265.000 Y150.000 Z-12.000 F120.000 Q4.500 R3.000)
G1 Z-1.500
G0 Z3.000
G0 Z-1.275
G1 Z-6.000
G0 Z3.000
G0 Z-5.775
G1 Z-10.500
G0 Z3.000
G0 Z-10.275
G1 Z-12.000
G0 Z3.000
G0 X245.000
(G83 X245.000 Y150.000 Z-12.000 F120.000 Q4.500 R3.000)
G1 Z-1.500
G0 Z3.000
G0 Z-1.275
G1 Z-6.000
G0 Z3.000
G0 Z-5.775
G1 Z-10.500
G0 Z3.000
G0 Z-10.275
G1 Z-12.000
G0 Z3.000
G0 X225.000
(G83 X225.000 Y150.000 Z-12.000 F120.000 Q4.500 R3.000)
G1 Z-1.500
G0 Z3.000
G0 Z-1.275
G1 Z-6.000
G0 Z3.000
G0 Z-5.775
G1 Z-10.500
G0 Z3.000
G0 Z-10.275
G1 Z-12.000
G0 Z3.000
G0 X285.000
(G83 X285.000 Y150.000 Z-12.000 F120.000 Q4.500 R3.000)
G1 Z-1.500
G0 Z3.000
G0 Z-1.275
G1 Z-6.000
G0 Z3.000
G0 Z-5.775
G1 Z-10.500
G0 Z3.000
G0 Z-10.275
G1 Z-12.000
G0 Z3.000
( G80 )
G0 Z#<clear_z>
(Finish operation: T5_peck_drill_holes)

G4 P0 (finish queued moves, then home Z - FluidNC 4.1 rejects $HZ while moving)
$HZ
(MSG, Done - Turn Off Router)
M30
