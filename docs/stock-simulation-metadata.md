# Stock Simulation Metadata

The CNC GCode Viewer can show the machined stock as a 3D solid. To do that it needs the stock bounds and the geometry of every tool that cuts. A post processor provides them as header comments in the G-code. FluidNC and other controllers ignore comments, so these lines don't change how the job runs.

This document is the format reference for post processor authors. The viewer's parser is `parseSimComment()` in `src/js/parser.js`.

## Example

```gcode
(CNCSIM 1 UNITS=mm)
(Stock: XMIN=0 XMAX=300 YMIN=0 YMAX=200 ZMIN=-19.05 ZMAX=0)
(ToolDef 1: SHAPE=flat D=6.35 FLUTES=2 LEN=22 OAL=50 NAME=1/4in flat end mill)
(ToolDef 3: SHAPE=vbit D=12.7 ANGLE=60 TIP=0 FLUTES=2 LEN=12 OAL=45 NAME=60 deg V-bit)
G21 G90 G17
T1 M6
...
T3 M6
...
```

## Line format

- Each metadata comment must be a **line on its own** that starts with `(` (or `;`). The whole line is the comment. Comments after G-code on the same line are not read.
- Don't nest parentheses inside the comment.
- Fields are `KEY=VALUE` pairs separated by spaces. Keys are case-insensitive. Values can't contain spaces or commas.
- Write numbers in plain decimal form (`6.35`, `-19.05`). Four decimal places is plenty.
- Put the lines anywhere before the first motion. Right after the program's opening comments is best.
- Emit them even when the post's "no comments" option is on, or give them their own option that defaults to on.

## `CNCSIM` (optional)

```
(CNCSIM 1 UNITS=mm)
```

`1` is the format version. `UNITS` is `mm` or `in`, matching the G20/G21 the program uses. If this line is missing, the viewer uses the program's G20/G21 state.

## `Stock` (required for the solid view and simulated probing)

```
(Stock: XMIN=0 XMAX=300 YMIN=0 YMAX=200 ZMIN=-19.05 ZMAX=0)
```

- These are the stock's bounding box **in the same coordinates as the G-code moves**. If Z0 is the stock top, then `ZMAX=0` and `ZMIN` is minus the thickness. If Z0 is the spoilboard, then `ZMIN=0`.
- All six values are required, and each max must be greater than its min. Otherwise the line is ignored and a warning is logged to the browser console.
- If the post shifts or offsets coordinates on output (a work offset option, for example), apply the same shift to these bounds.
- With a `Stock` line, a `G38.2`/`G38.3` straight down in Z is simulated: it stops on the stock as cut so far, or on a touch plate of thickness `P` lying on it, and with `P` the work Z is set so the contact point reads `P`, as FluidNC does. Without one, probes are drawn to their programmed end.
- This describes the stock before **any** cutting. If the job is split into several files that build on each other, list the earlier ones with `PriorJob` (below), and give every file in the chain the same `Stock` line.
- Use the program's output units.

## `PriorJob` (optional, for jobs split across files)

```
(PriorJob: SandwichSign_T1_quarter.nc)
(PriorJob: SandwichSign_T2_eighth.nc)
```

When a job is split into files that run one after another, for example one file per bit, each file lists **every** file that runs before it, one line each, **oldest first**. The viewer carves those files into the stock first, then this file on top.

- The value is the rest of the line: a file name in the **same folder** as this file. Paths are ignored, and matching is case-insensitive. Spaces are allowed, but parentheses aren't.
- List the whole chain, not just the previous file. The third file lists the first and the second. The viewer doesn't follow `PriorJob` lines inside the earlier files.
- Each earlier file is carved with its own `ToolDef` lines, so it needs a complete header too. Moves by a tool it doesn't define are skipped.
- All files in a chain must use the same coordinates and units, and should have the same `Stock` line.
- The file that runs first, and a combined all-tools file, have no `PriorJob` lines.

How the viewer finds the files:
- **VS Code extension:** reads them from the file's folder automatically.
- **FluidNC extension:** reads them from the same SD card folder automatically, when the machine is Idle.
- **Standalone viewer:** can't read files by itself. The panel lists the jobs as "Not found", and you choose them with **Add files…**. Several can be chosen at once, and each fills the listed job with the same name.

Files added without a `PriorJob` line are put at the end of the list, in name order. Every entry can be moved up or removed.

## `ToolDef` (one per tool that cuts)

```
(ToolDef N: SHAPE=<shape> D=<diameter> [ANGLE=<deg>] [TIP=<diameter>] [CR=<radius>] [FLUTES=<count>] [LEN=<length>] [OAL=<length>] [NAME=<text to end of line>])
```

- `N` is the **T number**, the one used in `T<N> M6`, not the order tools appear in the file. Emit one line per T number that has cutting moves. Files without T words number tools differently; see [Files without T words](#files-without-t-words).
- `D` is the cutting diameter, in the program's units. It is required: a `ToolDef` without `D > 0` is ignored.
- `FLUTES` (optional, any shape) is the number of flutes, a positive whole number. It only changes how the tool is drawn during the animation, with helical flutes (straight for `vbit` and `chamfer`); it doesn't affect the cut.
- `LEN` (optional) is the flute length: the cutting edge height measured from the tip. The drawn flutes end there. A cutting move that goes deeper than `LEN` below the stock top (`Stock` `ZMAX`) is flagged in the panel, because the shank would rub.
- `OAL` (optional) is the overall length of the bit, used only for drawing. Above `LEN` the bit is drawn as a shank of diameter `D` up to `OAL`, since the shank diameter isn't given.
- `NAME` (optional) is the bit's description and must come **last**: it runs to the end of the line and may contain spaces. Everything before ` NAME=` is read as fields, so a name like `D=6 bit` can't change the diameter. When present, it replaces the `(Required tools:)` and `(Tool N: …)` names in the tool panel. Don't put parentheses in it.
- Unknown keys are ignored. If two `ToolDef` lines have the same `N`, the first is used and the others are logged as warnings in the browser console.

| `SHAPE` | Meaning | Extra fields |
|---|---|---|
| `flat` (default) | Flat end mill | none |
| `ball` | Ball nose; radius `D/2` | none |
| `bullnose` | Flat end with rounded corners | `CR`: corner radius (0 to `D/2`) |
| `vbit` | V-bit / engraving bit | `ANGLE`: **included** angle in degrees (60 for a 60° bit). `TIP`: flat tip diameter, default 0 |
| `chamfer` | Chamfer mill | Same as `vbit` |
| `taperball` | Tapered ball nose: a ball tip blending into a cone that widens to `D` | `ANGLE`: **included** taper angle in degrees. `TIP`: ball diameter |

- An unknown `SHAPE` is treated as `flat`.
- A missing or invalid `ANGLE` on `vbit`, `chamfer` or `taperball` defaults to 90.
- `taperball` with ball radius `r = TIP/2` and half-angle `a = ANGLE/2` has this profile, where R(z) is the radius at height z above the tip:
  - The ball meets the cone at `z_t = r·(1 − sin a)`, where the radius is `r·cos a`.
  - For `0 ≤ z ≤ z_t`: `R(z) = sqrt(r² − (r − z)²)`.
  - For `z > z_t`: `R(z) = min(D/2, r·cos a + (z − z_t)·tan a)`.
  - `ANGLE=0` gives a cylinder of radius `r`. `D ≤ TIP` is treated as a ball nose of diameter `D`.
- The simulation models a vertical tool on a 3-axis machine and can't show undercuts, so dovetail and slotting cutters can only be approximated.

### Files without T words

Programs for machines without a tool changer often skip `T` words and stop with `M0` for each bit change. In these files, `ToolDef N` refers to the viewer's **sequential tool number**:

- Tool 1 is in use from the start of the program.
- Each `M0` whose comment mentions "tool" (any case) moves to the next tool, for example `M0 (MSG, Change to Tool T2 1/8in upcut)`.
- `M0`s whose comments don't mention a tool, such as `M0 (MSG, Attach Probe)`, don't change it.
- An `M0` that mentions "tool" before the first bit's cuts makes that bit tool 2, with tool 1 an unused placeholder. That's fine as long as the `ToolDef` uses the same number. A file split per bit is clearer with T words, though: a bare `T<N>` (no `M6`) only sets the tool number on FluidNC, and lets each bit keep its own number in every file. The FreeCAD FluidNC post does this.
- Use `NAME=` for the tool names. Other CAM programs' `(Required tools:)` lists are still read (entry N is tool N), but `NAME=` takes precedence.
- A `T` word anywhere switches the file to T numbers from that point on, so don't mix the two styles. Don't use the `(Tool N: name)` comments described below in this style either, because they change how tools are counted.

```gcode
(ToolDef 1: SHAPE=flat D=6.35 NAME=1/4in 1-flute upcut)
(ToolDef 2: SHAPE=taperball D=3.175 ANGLE=10 TIP=1 NAME=tapered ball nose R0.5 10 deg)
...
M0 (MSG, Change to Tool T2 tapered ball nose and Attach Probe)
```

## `Tool` names (optional, existing format)

The viewer already reads `(Tool N: <name> #RRGGBB)` comments for the names and colours in its tool panel. They're independent of `ToolDef`, but emitting both gives the nicest result. The `#RRGGBB` colour is optional.

## Mapping from FreeCAD

FreeCAD property names have changed between versions, so check these against the FreeCAD version you're using.

**Stock**
- `job.Stock.Shape.BoundBox` gives `XMin`, `XMax`, `YMin`, `YMax`, `ZMin`, `ZMax`.
- FreeCAD writes toolpaths in the same document coordinates, so the bounding box maps directly unless the post transforms coordinates.
- Values are in mm internally. Divide by 25.4 for inch output.

**Tools**
- Each ToolController used by the exported operations has `ToolNumber` and `Tool` (the ToolBit).
- Lengths on the ToolBit are `Quantity` values, so use `.Value` to get mm.
- Map the bit's shape like this. In FreeCAD 1.1 the shape is `ToolBit.ShapeID`; older versions have `ShapeName`, or the `BitShape` file name without `.fcstd`.

| FreeCAD shape | `SHAPE` | Fields |
|---|---|---|
| `endmill` | `flat` | `D = Diameter` |
| `ballend` | `ball` | `D = Diameter` |
| `bullnose` | `bullnose` | `D = Diameter`, `CR = CornerRadius` (older bits: `Diameter/2 − FlatRadius`) |
| `v-bit` | `vbit` | `D = Diameter`, `ANGLE = CuttingEdgeAngle`, `TIP = TipDiameter` |
| `chamfer` | `chamfer` | `D = Diameter`, `ANGLE = CuttingEdgeAngle`, `TIP = TipDiameter` |
| `taperedballnose` | `taperball` | `D = TaperDiameter`, `ANGLE = TaperAngle` (included angle), `TIP = Diameter` (ball diameter) |
| `drill` | `vbit` | `D = Diameter`, `ANGLE = TipAngle` (often 118) |
| anything else | `flat` | `D = Diameter` (approximation) |

- Angles are in degrees and aren't converted between units.
- Every bit also gets `FLUTES = Flutes`, `LEN = CuttingEdgeHeight`, `OAL = Length` and `NAME = Label` (with parentheses turned into `[ ]`).
- If two tool controllers share a T number but have different bits, emit the first one and write a warning comment. The viewer can only tell them apart by T number.

Sketch of the export code:

```python
def sim_header(job, tool_controllers, inches):
    k = 1 / 25.4 if inches else 1.0
    bb = job.Stock.Shape.BoundBox
    lines = ["(CNCSIM 1 UNITS=%s)" % ("in" if inches else "mm"),
             "(Stock: XMIN=%.4f XMAX=%.4f YMIN=%.4f YMAX=%.4f ZMIN=%.4f ZMAX=%.4f)" %
             tuple(v * k for v in (bb.XMin, bb.XMax, bb.YMin, bb.YMax, bb.ZMin, bb.ZMax))]
    seen = set()
    for tc in tool_controllers:
        if tc.ToolNumber in seen:
            continue
        seen.add(tc.ToolNumber)
        lines.append("(ToolDef %d: %s)" % (tc.ToolNumber, tool_fields(tc.Tool, k)))
    return lines
```

`tool_fields()` applies the shape mapping table above and formats the fields as `SHAPE=... D=...` with the unit factor `k` applied to lengths.

## Checking the output

Open the file in the viewer (`src/gcodeviewer.html`) and look at the **Stock Simulation** panel:

| Panel status | Meaning |
|---|---|
| ✓ Stock and tools from the file header. | Everything was read |
| Stock from the file header; tool sizes guessed from their names… | A T number with cutting moves has no `ToolDef` |
| Estimated from the toolpaths… | No valid `Stock` line. Check the browser console for "Ignoring incomplete or invalid Stock comment" |

Each `PriorJob` appears under **Earlier jobs** with ✓ and its move count once it's loaded, or with a warning: not found, no `ToolDef` for a tool, different `Stock` bounds or units, or an earlier job it depends on that isn't listed.

With "Show machined stock" ticked, the panel also lists any rapid (G0) moves that cut into the stock. That usually means a wrong safe height or wrong stock bounds.

`examples/stock_sim_demo.nc` is a complete reference file.
