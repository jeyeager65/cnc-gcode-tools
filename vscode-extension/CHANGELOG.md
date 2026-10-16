# Changelog

## 0.6.0

The version now matches the web viewer, the FluidNC extension and the FigUI plugin, which are released together.

- Viewer: new layout. It opens in 3D, with a transport bar under the view (scrub bar with tool-change and M0 marks, speed menu, keyboard shortcuts), the view's own toolbar (2D/3D, Fit, view settings, zoom buttons) and a compact sidebar (summary, toolpaths with the rapids and Z layers, stock simulation, warnings). The G-code pane can be shown beside the view. Narrow panels get a tabbed phone layout.

- Viewer: the animation plays in real time (1x), from each move's estimated time, with a 0.1x to 500x speed range. Probes are shown descending onto a touch plate, with an optional close-up view.

- Viewer: the animation shows `(MSG, …)` and `(PRINT, …)` messages (with parameter values) as a controller UI would, can stop at each `M0` with its prompt, and simulates Z probing against the stock with the `P` plate thickness. Expanding a parametric file fills in the values in `(PRINT, …)` and `(DEBUG, …)` comments.

- Viewer: **Stock Simulation** panel shows the machined part as a 3D solid, carved as the animation plays. Stock and tool sizes come from `(Stock: ...)` / `(ToolDef N: ...)` header comments or are entered in the panel. Rapid moves that cut into the stock are flagged. Jobs split across files are carved in order: `(PriorJob: ...)` comments name the earlier files, which are read from the same folder.

## 0.3.0

- Renamed to **CNC GCode Tools for FluidNC**, with a new icon
- **View GCode** expands parametric files before drawing, using the same expander as the web viewer, and lists expansion warnings in the viewer
- **Expand GCode** opens the result as a normal editor tab with the extension's syntax highlighting
- Expressions are evaluated by a dedicated parser instead of JavaScript `eval`, so files can't run code, and the viewer works under VS Code's content security policy
- Added `MOD`, `XOR`, `**`, two-argument `ATAN[y]/[x]` and `EXISTS[...]`
- The expander now covers the rest of FluidNC's flow control: `do` / `while`, `repeat` / `endrepeat`, `break` and `continue`, with no space needed before the bracket (`o101 repeat[3]`)
- Numbered (`#31`) and computed (`#[30 + 1]`) parameters, several assignments per line, and assignments on a G-code line taking effect after the move
- `X-#<a>` and `X2#<a>`, which FluidNC rejects, are flagged instead of silently accepted
- New `cncGcode.fluidncConfig` setting: point it at your FluidNC `config.yaml` (or keep one next to your G-code or in the workspace root) and config values like `#</axes/x/max_travel_mm>` are filled in when expanding, viewing and validating
- **Validate GCode**: fixed a false "never closed" error on `do` / `while` loops, and machine values like `#5221` are reported as information rather than errors
- Syntax highlighting: variables are colored in any theme, assignments and arithmetic operators are marked, and `do` / `repeat` / `break` / `continue` / `sub` keywords are recognized
- Folding and auto-indent for O-word blocks
- 3D viewer: Z-up turntable orbit, smoother and frame-rate independent 3D mouse control, and cutting moves drawn on top of rapids
- Viewer layout works in narrow editor panes
