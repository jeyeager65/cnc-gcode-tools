(ViewerDemo T6 only)
(FluidNC post for FreeCAD - V1E Jackpot style. Run from the SD card.)
(CNCSIM 1 UNITS=mm)
(Stock: XMIN=0 XMAX=300 YMIN=0 YMAX=180 ZMIN=-19 ZMAX=0)
(PriorJob: ViewerDemo_T1_flat.nc)
(PriorJob: ViewerDemo_T2_bullnose.nc)
(PriorJob: ViewerDemo_T3_ball.nc)
(PriorJob: ViewerDemo_T4_vbit.nc)
(PriorJob: ViewerDemo_T5_drill.nc)
(ToolDef 6: SHAPE=chamfer D=12.7 ANGLE=90 TIP=1 FLUTES=2 LEN=6 OAL=50 NAME=90 deg chamfer 1/2in)
G0 G54 G17 G21 G90 G94

(===== Settings - edit here =====)
(Feeds, mm/min)
#<t6_feed>=900 (T6 90 deg chamfer 1/2in - cutting: 900 mm/min = 15 mm/s)
#<t6_plunge>=180 (T6 90 deg chamfer 1/2in - plunging: 180 mm/min = 3 mm/s)
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

(===== T6: 90 deg chamfer 1/2in - Kobalt trim router dial 3 = ~18000 RPM, ~2 min =====)
T6
G4 P0 (finish queued moves, then home Z - FluidNC 4.1 rejects $HZ while moving)
$HZ
G0 X#<probe_x> Y#<probe_y> (probe spot: the uncut front-left corner)
M0 (MSG, Change to Tool T6 90 deg chamfer 1/2in and Attach Probe - keep X0 Y0)
G38.2 Z[-#<probe_depth>] F#<probe_feed> P#<plate> (probe, Z = plate thickness)
G0 Z#<probe_clear>
M0 (MSG, Remove Probe and Turn On Router at Dial 3)
(MSG, 1/1 T6 Chamfer edges - ~2 min)
(Chamfer edges)
G0 Z#<clear_z>
G0 X15.000 Y165.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G1 Y100.000 F#<t6_feed>
G1 X95.000
G1 Y165.000
G1 X15.000
G0 Z#<clear_z>
G0 X65.000 Y132.500
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X65.000 Y132.500 I-10.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
G0 X175.000 Y100.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X195.000 Y120.000 I-0.000 J20.000 F#<t6_feed>
G1 Y145.000
G3 X175.000 Y165.000 I-20.000 J-0.000
G1 X135.000
G3 X115.000 Y145.000 I0.000 J-20.000
G1 Y120.000
G3 X135.000 Y100.000 I20.000 J0.000
G1 X175.000
G0 Z#<clear_z>
G0 X228.000 Y150.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X228.000 Y150.000 I-3.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
G0 X248.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X248.000 Y150.000 I-3.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
G0 X268.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X268.000 Y150.000 I-3.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
G0 X288.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X288.000 Y150.000 I-3.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
G0 X278.000 Y122.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X278.000 Y122.000 I-3.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
G0 X258.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X258.000 Y122.000 I-3.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
G0 X238.000
G0 Z#<safe_z>
G1 Z-2.000 F#<t6_plunge>
G3 X238.000 Y122.000 I-3.000 J0.000 F#<t6_feed>
G0 Z#<clear_z>
(Finish operation: T6_chamfer_edges)

G4 P0 (finish queued moves, then home Z - FluidNC 4.1 rejects $HZ while moving)
$HZ
(MSG, Done - Turn Off Router)
M30
