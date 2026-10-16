# CNC GCode Tools for FluidNC

Edit, check and preview G-code for [FluidNC](https://github.com/bdring/FluidNC) CNC controllers, including FluidNC's parametric syntax: parameters, expressions, conditionals and loops.

> Community project, not affiliated with or endorsed by the FluidNC project.

## Features

### Syntax highlighting
- G, M, T, S and F words, plus distinct colors for X, Y and Z
- `$` system commands and settings
- Named variables (`#<depth>`), numbered parameters (`#5`) and assignments
- O-word control flow: `if` / `elseif` / `else` / `endif`, `while` / `endwhile`, `do`, `repeat` / `endrepeat`, `break`, `continue`
- Expression functions (`SIN`, `COS`, `ATAN`, `SQRT`, `FIX`, ...) and operators (`EQ`, `LT`, `AND`, `MOD`, `**`, ...)
- Comments in both `;` and `( )` styles

Works with any color theme. Two matching themes are included: **CNC GCode Dark** and **CNC GCode Light**.

### Editing
- **Completions** for G and M codes and for FluidNC `$` commands and settings
- **Outline** (and breadcrumbs) showing O-word blocks, comment headings and variable assignments
- **Folding** for `if`, `while` and `repeat` blocks
- **Auto-indent** inside blocks: lines after `o100 if` are indented, and `else` / `endif` move back out

### Commands
Available from the Command Palette (`Ctrl+Shift+P`), the editor title bar and the right-click menu:

| Command | What it does |
|---|---|
| **CNC GCode: Expand GCode** | Expands a parametric file into plain G-code in a new tab beside it. `Ctrl+S` saves it as `<name>.expanded.gcode`. |
| **CNC GCode: View GCode** | Opens a 2D / 3D toolpath viewer. Parametric files are expanded automatically before drawing. |
| **CNC GCode: Validate GCode** | Checks the file against what FluidNC supports and lists the results in the Problems panel: unsupported G/M codes and axes, unbalanced O-word blocks, subroutines (which FluidNC doesn't support), undefined variables and bad expressions. Machine values such as `#5221` or `#<_x>` are noted as information, since they only exist on the controller. |

### Toolpath viewer
The same viewer as the [web version](https://jeyeager65.github.io/cnc-gcode-tools/), beside the editor:
- Opens in 3D, at an angle that shows depth; **2D** gives the machine's top view (X right, Y up)
- 3D orbit that keeps machine Z upright: drag to rotate, right-drag to pan, scroll or **+ / −** to zoom
- **3D mouse support** (3Dconnexion SpaceMouse) through the browser Gamepad API
- A transport bar: real-time playback from each move's estimated time (0.1x to 500x), a scrub bar with tool changes and `M0` pauses marked, and keyboard shortcuts (Space, arrows, Home/End, `[ ]`, V)
- `(MSG, …)` messages, `M0` stops and simulated Z probing as the job plays
- Per-tool colors, visibility and times, rapid moves (G0), and a Z-height layer filter
- **Stock simulation**: the machined part as a 3D solid, carved as the job plays, from `(Stock: ...)` and `(ToolDef N: ...)` header comments or sizes entered in the viewer, with earlier files of a split job (`PriorJob`) read from the same folder
- The G-code pane is hidden by default (the editor shows the file); **G-code** on the view's toolbar shows it
- A narrow panel gets the phone layout, with tabs for View, Job and G-code

## Parametric G-code

FluidNC can run G-code that computes its own values. For example:

```gcode
#<holes>  = 6
#<radius> = 25
#<i>      = 0
o100 while [#<i> LT #<holes>]
  #<angle> = [360 / #<holes> * #<i>]
  G0 X[#<radius> * COS[#<angle>]] Y[#<radius> * SIN[#<angle>]]
  G1 Z-2 F300
  G0 Z5
  #<i> = [#<i> + 1]
o100 endwhile
```

**Expand GCode** and the viewer evaluate this into plain moves, so you can see the real toolpath before running it, or produce a file for senders that don't support parametric code.

Supported by the expander, following the [FluidNC wiki](http://wiki.fluidnc.com/en/features/gcode_parameters_expressions):
- Named parameters `#<name>` (case-insensitive), numbered parameters `#31`, and computed ones `#[30 + 1]`
- Assignments: `#<name> = expression`, several on one line (`#<a>=1 #<b>=2`), or together with G-code, in which case the new values apply after the line's move, as on the controller
- Operators: `+ - * /`, `**`, `MOD`, `EQ NE LT GT LE GE`, `AND OR XOR`
- Functions: `ABS ACOS ASIN ATAN COS EXP FIX FUP LN ROUND SIN SQRT TAN` (angles in degrees), `ATAN[y]/[x]` and `EXISTS[#<name>]`
- Control flow: `if` / `elseif` / `else` / `endif`, `while` / `endwhile`, `do` / `while`, `repeat` / `endrepeat`, `break` and `continue`

### Machine config values

Config values such as `#</axes/x/max_travel_mm>` come from your machine's FluidNC `config.yaml`. Point the extension at a copy of it and Expand, View and Validate fill them in, with no controller needed:

- Setting **`cncGcode.fluidncConfig`**: the path to your `config.yaml`. Relative paths start from the workspace folder, and `${workspaceFolder}` is accepted.
- With the setting empty, a `config.yaml` next to the G-code file, or at the root of its workspace folder, is used automatically.

Numeric settings and `true` / `false` (as 1 / 0) are read. Settings your file leaves out use firmware defaults the extension can't know, so they're still reported. Keep the copy in step with the machine, or the preview will quietly use old values.

Live machine state (`#<_x>`, `#<_current_tool>`) and the controller's stored values (`#5221` and other numbered system parameters) aren't in `config.yaml`. They only exist on the controller, so lines that depend on them are reported as unknown and can't be previewed.

## File types

The extension handles `.gcode`, `.nc`, `.gco` and `.ngc` files. If another G-code extension also claims these, set the language for a file from the status bar, or add it to your settings:

```json
"files.associations": {
    "*.nc": "fluidnc",
    "*.gcode": "fluidnc"
}
```

## Links

- Source code and the browser-based viewer: [github.com/jeyeager65/cnc-gcode-tools](https://github.com/jeyeager65/cnc-gcode-tools)
- FluidNC: [github.com/bdring/FluidNC](https://github.com/bdring/FluidNC)
