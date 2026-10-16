# CNC GCode Tools

![Version](https://img.shields.io/github/v/release/jeyeager65/cnc-gcode-tools?style=flat-square)
![License](https://img.shields.io/github/license/jeyeager65/cnc-gcode-tools?style=flat-square)
![Size](https://img.shields.io/badge/size-~60--68KB%20gzipped-blue?style=flat-square)

A lightweight, zero-dependency web-based CNC GCode viewer for FluidNC and GRBL CNC machines. It shows the toolpaths in 3D (or 2D), carves the stock as the job plays in real time, expands parametric G-code, and follows a running job. It runs entirely client-side: in a browser, in the FluidNC WebUI on the controller itself, as a FigUI plugin and in VS Code, on a desktop or a phone.

## ✨ Features

- ✅ **2D & 3D Visualization** - Opens in WebGL 3D; switch to Canvas 2D for a top view
- ✅ **Multi-Tool Support** - Color-coded toolpaths with individual tool visibility controls
- ✅ **Rapid Move Control** - Toggle visibility and customize color of G0 travel moves
- ✅ **Layer-by-Layer Animation** - Play, pause, and step through toolpath execution
- ✅ **Adaptive Arc Tessellation** - Smooth arc rendering with optimized segment count
- ✅ **Light & Dark Themes** - Eye-friendly themes with localStorage persistence
- ✅ **Pan, Zoom, & Rotate** - Intuitive mouse and touch controls
- ✅ **Layer Filtering** - Show/hide specific Z-height ranges
- ✅ **GCode Syntax Highlighting** - Color-coded GCode display with line numbers
- ✅ **Stock Simulation** - See the machined part as a 3D solid, carved as the animation plays, from stock and tool sizes in the file header or entered in the viewer
- ✅ **Parametric GCode Preview** - FluidNC parameters, conditionals and loops are expanded automatically, with an Expanded/Source toggle and a download of the expanded G-code
- ✅ **Completely Offline** - No data transmission, all processing is local
- ✅ **Touch Optimized** - Pinch zoom, two-finger rotate/pan for tablets
- ✅ **FluidNC WebUI v3 Extension** - Custom build for FluidNC WebUI v3, with a phone layout
- ✅ **FigUI Plugin** - The viewer inside FigUI, following FigUI's running job

## 🖼️ Screenshots

![The viewer on a desktop](docs/viewer-desktop.png)
*The demo job part-way through: G-code, the stock carved in 3D, toolpaths and the stock simulation*

<img src="docs/viewer-phone.png" alt="The viewer on a phone" width="300">

*On a phone: one pane at a time, with tabs along the bottom*

## 🚀 Quick Start

### Hosted Version
Visit the hosted version: [CNC GCode Tools](https://jeyeager65.github.io/cnc-gcode-tools/)
Try it with the demo job: [gcodeviewer.html?demo](https://jeyeager65.github.io/cnc-gcode-tools/gcodeviewer.html?demo), a board with one feature per bit type (flat, bull nose, ball, V-bit, drill, chamfer, tapered ball), probing and M0 bit changes, from the FreeCAD FluidNC post. `?demo=ViewerDemo_T4_vbit.nc` opens one bit's file, which picks up the cuts of the bits before it. The file menu lists the whole job and each bit's file under **Demo job**.

### Local Usage
1. Download `gcodeviewer.html` from the [latest release](https://github.com/jeyeager65/cnc-gcode-tools/releases/latest)
2. Open directly in any modern browser (Chrome, Edge, Firefox, Safari)
3. Drag and drop your GCode file or use the file picker

### VS Code Extension
**CNC GCode Tools for FluidNC** adds syntax highlighting, completions, parametric expansion, validation and the 2D/3D viewer to VS Code (also Cursor and VSCodium).
1. Download the `.vsix` from the [latest release](https://github.com/jeyeager65/cnc-gcode-tools/releases/latest), or [`cnc-gcode-tools.vsix`](https://jeyeager65.github.io/cnc-gcode-tools/cnc-gcode-tools.vsix) from the hosted site
2. In VS Code: Extensions view → `…` menu → **Install from VSIX…**, or run `code --install-extension cnc-gcode-tools.vsix`

To work on the extension itself, run `vscode-extension/install-vscode-extension.ps1`, which installs it straight from the repo.

### FigUI Plugin
The viewer also runs as a plugin for [FigUI](https://github.com/figamore/FigUI), a web UI for FluidNC: it fills FigUI's workspace beside the DRO and jog controls, previews files from the SD card with the stock simulation, and follows the job FigUI is running.
1. Download `figui-plugin.zip` from the [latest release](https://github.com/jeyeager65/cnc-gcode-tools/releases/latest) and unzip it (or build it: `dist/figui-plugin/`)
2. In FigUI: **Plugins** → **Add** → choose the `figui-plugin` folder (or copy it to `/sd/plugins/`)

See [figui-plugin/README.md](figui-plugin/README.md).

### Embedded Device Deployment (ESP32/FluidNC)

#### Upload to Device
```bash
# Download the FluidNC-optimized gzipped file
curl -LO https://github.com/jeyeager65/cnc-gcode-tools/releases/latest/download/gcodeviewer.html.gz

# Upload to FluidNC via web interface
curl -F "file=@gcodeviewer.html.gz" http://your-device-ip/files
```

#### Add it to the WebUI
FluidNC serves gzipped files, so the file is `/gcodeviewer.html` on the controller. Add it to WebUI v3 as an extension panel with that page as its source. It talks to the machine through the WebUI, so opened on its own (`http://your-device-ip/gcodeviewer.html`) it can't list the SD card or follow a job.

The FluidNC version includes:
- SD card file browser with folder navigation, **Preview** and **Run on machine**
- Following a running job: the view shows where the machine is, with progress, time left, time to the next M0 and a feed hold / resume button, whether the job was started here or elsewhere
- A phone layout, as the WebUI is often used on one
- Optimized for space-constrained devices

## 📊 File Sizes

| Version | Minified | Gzipped | Use Case |
|---------|----------|---------|----------|
| **Standalone** | ~221KB | **~60KB** | Local use, feature-complete |
| **FluidNC** | ~248KB | **~68KB** | FluidNC WebUI v3 Extension with SD card browser |

Both versions include:
- All visualization features (2D/3D)
- Multi-tool support with color controls
- Rapid move visibility toggle
- Animation and layer filtering
- GCode syntax highlighting

## 🎮 Usage Guide

### Layout
- **Header:** the loaded file (click it for the file menu), and the theme button.
- **G-code** (left): the program, following the animation. Click a line to jump there. Hide it with the arrow at its top right and bring it back with **G-code** on the view's toolbar; it starts hidden on narrower windows and in VS Code.
- **View** (middle): opens in 3D. The toolbar at the top right has **2D / 3D**, **Fit** and the view settings (grid size, axes, tool marker, zoom, theme); **+ / −** zoom at the bottom right. The transport bar under the view plays the job.
- **Sidebar** (right): a one-line summary (time, segments, tools, X/Y/Z ranges), **Toolpaths**, **Stock simulation** and **Warnings**. Sections fold, and stay as you leave them.
- **Phone** (820 px wide and narrower): one pane at a time, chosen with the tab bar at the bottom: **Files**, **View**, **Job** and **G-code**. Menus open as sheets from the bottom.

### Loading Files

**Standalone Version:**
- **Drag & Drop**: drop a GCode file anywhere on the page
- **Browse**: **Open…** in the header, or **Choose file…** in the file menu
- **Recent**: the file menu lists the last six files opened (kept in the browser, up to 25 MB each), to open again with one click
- **config.yaml**: the header's config button loads a FluidNC `config.yaml` for parametric files and the bed size

**FluidNC Version:**
- Browse the SD card in the file menu (the **Files** tab on a phone)
- Navigate folders with the path at the top
- Click **Preview** (or double-click a file) to visualize the toolpath
- Click **Run on machine** to run the file on your CNC; the view then follows the job

### Toolpaths
- **Multi-Tool Jobs**: each tool (T1, T2, etc.) gets its own color, with its estimated time. The tool cutting at the animation's position is outlined
- **Visibility**: the checkboxes show or hide each tool's paths, and the **Rapids** row the G0 travel moves. In the stock simulation, a hidden tool's cuts are left out too
- **Color**: click a color swatch to change it
- **Z layers**: the slider below the list shows only paths between two heights

### 2D View Controls
- **Pan**: Click and drag
- **Zoom**: Mouse wheel (zooms to cursor position), or **+ / −**
- **Reset**: **Fit**, or double-click

### 3D View Controls
The 3D view opens, and Fit returns, at an angle from the front-right, 35° above the work, so depth shows.
- **Rotate**: Click and drag to orbit camera
- **Pan**: Right-click and drag
- **Zoom**: Mouse wheel, or **+ / −**
- **Reset**: **Fit**, or double-click

### Touch Controls
- **Pan/Rotate**: Single finger drag
- **Zoom**: Pinch to zoom
- **Pan 3D**: Two-finger drag (while in 3D mode)

### Transport Bar
- **Play/Pause**, **Back to start** and **Step back / forward**
- **Scrub bar**: drag to any point in the job. Colored ticks mark tool changes and diamonds the M0 pauses. Below it: time on the timeline, segment and file line
- **Speed**: 1x is real time. Each move takes its estimated time from its feed rate, the rapid rates and acceleration, so slow moves such as probing look slow. The menu goes from 0.1x to 500x. The summary's total also allows time for tool changes (30 s at an M0, 10 s at an M6), which the timeline doesn't play
- **Playback settings** (⚙): messages, M0 stops and the probe close-up (below)
- **Keyboard**: <kbd>Space</kbd> play / pause, <kbd>←</kbd> <kbd>→</kbd> step, <kbd>Home</kbd> / <kbd>End</kbd> start and end, <kbd>[</kbd> <kbd>]</kbd> slower / faster, <kbd>V</kbd> 2D / 3D

### Messages, M0 Pauses and Probing
While the animation runs, the viewer shows what a controller UI such as FluidTouch or the WebUI would show, using FluidNC's rules:
- **Messages:** `(MSG, …)` comments (`MSG` is case-sensitive) and `(PRINT, …)` comments, with `#parameters` filled in using `%d`, `%f` or `%.Nf` formats. They appear in a small console at the bottom of the view. `DEBUG` messages only show at FluidNC's debug log level, so they're left out.
- **M0 pauses:** with **Stop at M0 pauses** on (in the playback settings), playback stops at each `M0` and shows its prompt with the last message, until you click **Resume** or **Play**. `M1` is ignored, as FluidNC ignores it, and `M2`/`M30` end the program.
- **Probing:** when the stock is known from a `Stock` header, a `G38.2`/`G38.3` straight down in Z stops where it touches, instead of running to its programmed end. It touches the stock as cut so far, or a touch plate of thickness `P` lying on it. With a `P` word the work Z is then set so the contact point reads `P`, as FluidNC does, so probing over an area that's already been cut shows up as cuts that go too deep. `G38.2` with nothing to touch is reported as a probe-fail alarm. The probe plays at its feed rate onto a touch plate drawn under the bit, which turns green on contact and stays until the next M0 (usually "remove the probe"). With **Close-up on probing** on, playback moves the 3D view in close on each probe and back afterwards. The probe's starting height isn't known (it's usually jogged by hand), so a plate above the start is probed from 5 mm (0.2 in) above it. Cuts from earlier jobs (`PriorJob`) aren't considered when probing.

### Stock Simulation
The **Stock simulation** section shows the machined stock as a solid in the 3D view. It's on (**Show**) whenever the file describes its stock and tools. It carves the stock with each tool's shape and keeps pace with the animation, so stepping or scrubbing shows the part at that point in the job. The current position is drawn as the tool itself, to scale.

It needs the size of the stock and of every tool that cuts. A post processor can write these into the file header:

```gcode
(CNCSIM 1 UNITS=mm)
(Stock: XMIN=0 XMAX=300 YMIN=0 YMAX=200 ZMIN=-19.05 ZMAX=0)
(ToolDef 1: SHAPE=flat D=6.35)
(ToolDef 2: SHAPE=ball D=3.175)
(ToolDef 3: SHAPE=vbit D=12.7 ANGLE=60 TIP=0)
(ToolDef 4: SHAPE=bullnose D=6 CR=1)
```

- `Stock` gives the bounds in the file's own coordinates, so where Z0 is (stock top or spoilboard) and where the XY origin is don't matter
- `ToolDef N` matches the T number of `T1 M6`, not the order tools appear in
- `SHAPE` is `flat`, `ball`, `bullnose` (`CR` = corner radius), `vbit` or `chamfer` (`ANGLE` = included angle in degrees, `TIP` = flat tip diameter), or `taperball` (`ANGLE` = included taper angle, `TIP` = ball diameter)
- `FLUTES=<count>` is optional on any ToolDef and only changes how the tool is drawn.
- `CNCSIM` is optional. All sizes are in the file's units (G20/G21).
- For a job split into files that build on each other (one per bit, say), each file lists the files that run before it with `(PriorJob: <file name>)`, oldest first. Their cuts are made first. VS Code and the FluidNC extension read them from the same folder; in the standalone viewer, choose them under **Earlier jobs** with **Add files…**.

For files without these comments, the panel estimates the stock from the toolpaths and guesses tool sizes from names like `1/4" flat end mill` or `6mm ball nose`. Check or enter the values under **Stock and tool sizes**, then click **Apply**. **Detail** sets the grid resolution. **Auto** sizes the cells to about 1/8 of the smallest tool's cutting feature (a tapered ball's tip, half a V-bit, otherwise the diameter), using 1 to 6 million cells. Draft, Normal, Fine and Ultra use 0.5, 2, 5 and 10 million cells. Finer grids show small details more accurately, but use more memory and take longer to carve.

With **Current layer only** on (under "Show toolpaths on the stock"), the animation only draws the toolpaths of the layer being cut, from where the tool started that Z level. Earlier layers are already visible in the stock.

While the stock is shown, **Fit** and double-click frame the whole stock. The 3D grid stands for the machine bed. It's sized from the machine's max travel (read from the connected machine in the FluidNC extension, or from a loaded `config.yaml`), or else made a little larger than the stock. A size you type in yourself is kept.

Rapid (G0) moves that cut into the stock, and cuts deeper than a tool's flute length, are listed under **Warnings**. A machine with a vertical tool can't cut undercuts, so the top surface describes the part fully. Accuracy is limited by the grid: the cell size is shown in the panel.

See `examples/stock_sim_demo.nc` for a sample, and [docs/stock-simulation-metadata.md](docs/stock-simulation-metadata.md) for the full format and how to produce it from a post processor.

## 🛠️ Development

### Prerequisites
- Modern web browser with WebGL support
- Text editor (VS Code, Sublime, etc.)
- Optional: Local web server for testing

### Project Structure
```
cnc-gcode-tools/
├── src/
│   ├── index.html                # GitHub Pages landing page
│   ├── gcodeviewer.html          # Standalone viewer UI
│   ├── gcodeviewer-fluidnc.html  # FluidNC WebUI extension with SD browser
│   ├── gcodeviewer-figui.html    # FigUI plugin
│   ├── fontcreator.html          # Font Creator UI
│   ├── js/
│   │   ├── prefs.js              # Settings storage (localStorage, or the host's)
│   │   ├── viewer-ui.js          # Viewer layout shared by every host (tabs, popovers, sections)
│   │   ├── gcode-expander.js     # Parametric GCode expander (shared with VS Code extension)
│   │   ├── parser.js             # GCode streaming parser
│   │   ├── camera.js             # Camera transformations
│   │   ├── renderer2d.js         # Canvas 2D renderer
│   │   ├── stock-sim.js          # Stock simulation (heightmap carving and solid mesh)
│   │   ├── renderer3d.js         # WebGL renderer
│   │   ├── animator.js           # Animation controller
│   │   ├── controller.js         # Main application logic
│   │   ├── fluidnc-api.js        # FluidNC WebUI API client
│   │   ├── fluidnc-controller.js # FluidNC-specific logic
│   │   ├── figui-api.js          # FigUI plugin bridge
│   │   ├── figui-controller.js   # FigUI plugin (extends the FluidNC controller)
│   │   ├── font-creator-app.js        # Font Creator app
│   │   └── font-creator-controller.js # Font Creator logic
│   └── css/
│       ├── common.css            # Shared styles
│       ├── viewer.css            # Viewer layout (desktop and phone)
│       ├── fluidnc.css           # FluidNC-specific styles
│       ├── figui.css             # FigUI plugin colors
│       └── font-creator.css      # Font Creator styles
├── figui-plugin/                # FigUI plugin manifest and icon (built to dist/figui-plugin)
├── vscode-extension/             # VS Code extension (packaged to .vsix by build.ps1)
├── examples/
│   ├── parametric_bolt_circle.nc # Parametric GCode demo
│   ├── modal_test.nc             # Modal G0/G1/G2/G3 demo
│   ├── stock_sim_demo.nc         # Stock simulation demo (header with stock and tool sizes)
│   ├── viewer-demo/              # Demo job from the FreeCAD FluidNC post: 7 bit types, probing, M0s; all-in-one and one file per bit (PriorJob)
│   └── *-font.json               # Sample Font Creator fonts
├── docs/                         # Screenshots (README, landing page) and the stock simulation metadata format
├── tools/                        # set-version.ps1, record-video/
├── VERSION                       # The version of everything here
├── dist/                         # Build output (generated)
├── build.ps1                     # Build script
├── localtest.ps1                 # Local build & deploy (git-ignored)
├── .github/
│   └── workflows/
│       └── release.yml           # Build & release automation
├── README.md
├── LICENSE
└── CONTRIBUTING.md
```

### Local Development
```bash
# Clone repository
git clone https://github.com/jeyeager65/cnc-gcode-tools.git
cd cnc-gcode-tools

# Open in browser
# Simply open src/gcodeviewer.html in your browser (the FluidNC and FigUI pages need their host)
# Or use a local server (recommended for FluidNC version):
python -m http.server 8000
# Then visit http://localhost:8000/src/gcodeviewer.html or gcodeviewer-fluidnc.html
```

### Making Changes
1. Edit files in `src/` directory
2. CSS is in `src/css/` - `common.css` and `viewer.css` are shared, `fluidnc.css` and `figui.css` are host-only
3. JavaScript is in `src/js/` - organized by functionality
4. Test in browser (refresh to see changes)
5. Check browser console for errors

### Building for Distribution
```powershell
# Local build (creates dist/ folder with all tools and the VS Code .vsix)
.\build.ps1

# Local build + upload to FluidNC device (customize localtest.ps1)
.\localtest.ps1
```

The build process:
- Inlines all CSS and JavaScript into single HTML files
- Minifies CSS (removes comments, whitespace)
- Minifies JavaScript with Terser (3 compression passes)
- Removes HTML comments and excess whitespace
- Creates a gzipped FluidNC version for deployment
- Packages the VS Code extension with `vsce` (needs Node.js 20+)
- Output: `gcodeviewer.html` (standalone), `gcodeviewer.html.gz` (FluidNC), `figui-plugin/` and `figui-plugin.zip` (FigUI), `fontcreator.html`, and `cnc-gcode-tools-<version>.vsix`

### Versioning
Everything here shares one version: the standalone viewer, the FluidNC extension, the FigUI plugin, the VS Code extension and the landing page. It lives in the `VERSION` file; `build.ps1` stamps it into the pages and the plugin's `plugin.json`, and stops if `vscode-extension/package.json` doesn't match. To change it:
```powershell
.\tools\set-version.ps1 0.7.0   # updates VERSION and the VS Code extension's package.json
```
Then add a section for it to `vscode-extension/CHANGELOG.md`.

### Building for Release
Builds are automated via GitHub Actions when you push a version tag. The tag must match `VERSION`, or the release stops:
```bash
git tag v0.6.0
git push origin v0.6.0
```

This automatically:
- Runs the build.ps1 script using PowerShell
- Minifies and inlines all CSS and JavaScript
- Creates the standalone viewer, the FluidNC extension, the FigUI plugin, the Font Creator and the VS Code extension
- Generates changelog from commit messages
- Deploys to GitHub Pages
- Creates GitHub Release with all build artifacts

## 🌐 Browser Requirements

- **Modern Browser**: Chrome 90+, Edge 90+, Firefox 88+, Safari 14+
- **WebGL Support**: Required for 3D visualization
- **JavaScript**: ES6+ features used throughout
- **File API**: Required for file upload
- **Canvas 2D**: Required for 2D visualization

Check compatibility at: `about:gpu` (Chrome/Edge) or `about:support` (Firefox)

## 🔒 Privacy

This application is **100% client-side** and **completely offline**:
- ✅ No data is sent to any server
- ✅ No analytics or tracking
- ✅ No external dependencies or CDN calls
- ✅ All GCode processing happens in your browser
- ✅ Works without internet connection

## 📝 Supported GCode Commands

| Command | Description | Support |
|---------|-------------|---------|
| G0 | Rapid positioning | ✅ Full (with visibility toggle) |
| G1 | Linear interpolation | ✅ Full |
| G2 | Clockwise arc | ✅ Full |
| G3 | Counter-clockwise arc | ✅ Full |
| G17 | XY plane selection | ✅ Full |
| G18 | ZX plane selection | ✅ Full |
| G19 | YZ plane selection | ✅ Full |
| G20 | Inches mode | ✅ Full |
| G21 | Millimeters mode | ✅ Full |
| G90 | Absolute positioning | ✅ Full |
| G91 | Relative positioning | ✅ Full |
| G38.2–G38.5 | Probe | ✅ With the stock known, Z probes stop on the stock or a `P` touch plate (see Messages, M0 Pauses and Probing); otherwise drawn to the full programmed travel |
| G10 L2/L20, G92 | Set work offsets | ✅ Later coordinates use the new offset; nothing is drawn |
| G54–G59.3 | Work coordinate systems | ✅ Full |
| G53 | Machine coordinates | ⚠️ Taken relative to the work origin the file starts in |
| G28/G30 | Go to stored position | ⚠️ Only the move to the intermediate point is drawn |
| T | Tool selection | ✅ Multi-tool support with colors |
| M3/M4/M5 | Spindle control | ⚠️ Parsed, not visualized |
| F | Feed rate | ✅ Used in time calculation |

### Parametric GCode

Files that use [FluidNC's parametric syntax](http://wiki.fluidnc.com/en/features/gcode_parameters_expressions) are expanded into plain moves before they are drawn, in the standalone viewer, the FluidNC extension and the VS Code extension:

- Parameters: named `#<depth>` (case-insensitive), numbered `#31` and computed `#[30 + 1]`, used as `Z#<depth>` or inside expressions
- Assignments: `#<depth> = 3`, several per line, or on a G-code line (the new values apply after the move, as on the controller)
- Expressions in square brackets: `X[#<cx> + #<r> * COS[#<angle>]]`
- Functions: `ABS`, `SQRT`, `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN` (degrees), `EXP`, `LN`, `ROUND`, `FIX`, `FUP`, `EXISTS`
- Operators: `+ - * /`, `**` (power), `MOD`, `EQ`, `NE`, `LT`, `GT`, `LE`, `GE`, `AND`, `OR`, `XOR`; `ATAN[y]/[x]` gives the two-argument arctangent
- Control flow: `if` / `elseif` / `else` / `endif`, `while` / `endwhile`, `do` / `while`, `repeat` / `endrepeat`, `break`, `continue`

Config values such as `#</axes/x/max_travel_mm>` can be read from your FluidNC `config.yaml`: use the **config.yaml** button in the standalone viewer's header (it's remembered in the browser), or the `cncGcode.fluidncConfig` setting in the VS Code extension. Live machine state such as `#<_x>` and numbered system parameters such as `#5221` only exist on the controller, so those viewers report lines that use them as unresolved.

The FluidNC WebUI extension needs no config file: when you preview a parametric file, it reads every machine value the file uses straight from the controller (config values with `$/...` queries, globals and numbered parameters with the `D` word). The values are a snapshot taken when you preview, so they match the start of the job. They're only read while the machine is Idle.

The GCode panel shows the **Expanded** code by default. Switch to **Source** to see the original file: the line that produced the current move is highlighted, and clicking a line jumps to the next move it produces (click again to step through loop iterations). Expansion warnings, such as undefined variables, are listed above the code.

**Download expanded G-code** (under the summary, for parametric files) saves the program as plain G-code, as it's drawn: with the machine and entered values used for the preview, and its comments and messages kept. Use it with senders that can't expand parametric files. The file is named after the original, `part.nc` → `part.expanded.nc`. The FigUI plugin can't download files, so it saves the copy next to the original on the SD card instead; in VS Code, use the **Expand GCode** command.

In the FluidNC extension, progress tracking for a running parametric file is based on estimated time only, because FluidNC reports progress through the source file rather than the expanded moves.

See `examples/parametric_bolt_circle.nc` for a sample.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by [cncjs/gcode-parser](https://github.com/cncjs/gcode-parser)
- Arc tessellation algorithms based on LinuxCNC implementation
- UI design influenced by modern CNC control interfaces

## 📧 Contact

- **Issues**: [GitHub Issues](https://github.com/jeyeager65/cnc-gcode-tools/issues)

---

**⭐ Star this repository if you find it useful!**
