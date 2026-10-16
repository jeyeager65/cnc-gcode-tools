# Viewer demo job

A 300 x 180 x 19 mm board with one feature per bit type, made with FreeCAD CAM and a FluidNC
post processor. For the viewer only: the sizes and feeds are demo values, not for a real cut.

| File | Bit | Feature |
|---|---|---|
| `ViewerDemo_T1_flat.nc` | 1/4in flat end mill | pocket around a round island |
| `ViewerDemo_T2_bullnose.nc` | 1/2in bull nose R3 | stadium pocket |
| `ViewerDemo_T3_ball.nc` | 1/4in ball nose | sine wave groove |
| `ViewerDemo_T4_vbit.nc` | 60 deg V-bit | V-carved "CNC" |
| `ViewerDemo_T5_drill.nc` | 6 mm drill | pecked holes |
| `ViewerDemo_T6_chamfer.nc` | 90 deg chamfer | chamfered pocket and hole edges |
| `ViewerDemo_T7_taperball.nc` | tapered ball nose | spiral groove |
| `ViewerDemo_ALL.nc` | all seven | the whole job in one file |

Each file has `Stock` and `ToolDef` header comments for the stock simulation, parametric
feed and height settings, touch-plate probing and `M0` bit changes with `(MSG, ...)` prompts.
The per-bit files list the files before them with `(PriorJob: ...)`, so each one is
simulated on the stock the earlier bits left.

The hosted viewer opens them with `gcodeviewer.html?demo` (the whole job) or
`gcodeviewer.html?demo=ViewerDemo_T4_vbit.nc` (one bit), and lists them all under **Demo job** in
its file menu (from `demo.json`).

Each bit's section starts with its `T` word (`T4` for the V-bit, in both the whole job and its own
file); FluidNC only records it, as there's no `M6`.
