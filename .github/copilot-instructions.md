# CNC GCode Viewer - AI Coding Agent Instructions

## Project Overview
A lightweight, zero-dependency web-based CNC GCode viewer with 2D/3D visualization. Built as **pure vanilla JavaScript** with no frameworks or external libraries. Three versions: **standalone** (local file viewing), **FluidNC** (embedded ESP32/FluidNC integration with SD card browser), and **Font Creator** (tool for creating CNC-engraved fonts).

**Critical constraint:** Total uncompressed size must stay under **135KB** (~45KB gzipped). Currently at ~133KB.

**Philosophy:** Every byte counts. Prioritize code size over abstractions. Inline small functions, reuse variables, use ternary operators. No frameworks, no dependencies, no polyfills.

## Architecture

### Module Structure (ES6 Classes)
All classes are **globally scoped** (no modules/imports) for single-file HTML inlining. Each file defines exactly one class:

**Core Architecture (`src/js/`):**
- `parser.js` → `GCodeParser` - Streams GCode in 50KB chunks, converts to segments with modal state tracking
- `camera.js` → `Camera` - Shared view transforms for both renderers (pan/zoom/rotate)
- `renderer2d.js` → `Renderer2D` - Canvas 2D with manual matrix math
- `renderer3d.js` → `Renderer3D` - WebGL with MVP matrix, custom shaders, depth testing
- `animator.js` → `Animator` - Frame-by-frame playback via `requestAnimationFrame`
- `controller.js` → `Controller` - Main app logic, owns parser/camera/renderers/animator

**Extensions:**
- `fluidnc-api.js` → `FluidNCAPI` - REST client for ESP32/FluidNC devices
- `fluidnc-controller.js` → `FluidNCController` - Extends `Controller`, adds SD card browser
- `font-creator-controller.js` → `FontCreatorController` - Character glyph editor with canvas drawing, arc detection, Douglas-Peucker path simplification, kerning management
- `font-creator-app.js` - App initialization for Font Creator (no class, just init code)

**Font Creator Features:**
- **Canvas-based drawing:** Click-drag to draw character strokes on 600x600 grid
- **Arc detection:** Converts freehand curves to G2/G3 arc commands (min radius 5mm)
- **Path simplification:** Douglas-Peucker algorithm with configurable tolerance
- **Font metrics:** SVG font units (1000 units/em) with ascent/descent/cap-height guides
- **Kerning editor:** Pair-based spacing adjustments (e.g., "AV": -2)
- **Text-to-GCode:** Generates CNC toolpaths with user-defined parameters (feed rate, plunge depth, etc.)
- **Font import/export:** JSON format with character strokes, metrics, and kerning data

**Data flow:** File → `GCodeParser.parseFile()` → `segments[]` → `Controller.loadSegments()` → `Renderer*.render()` → Canvas

### Build System (`build.ps1`)
PowerShell script that creates three single-file HTML distributions:
1. **FluidNC Extension** (`dist/gcodeviewer.html.gz`) - ESP32 device integration, includes: fluidnc-api, fluidnc-controller. HTML deleted after gzip.
2. **Standalone Version** (`dist/gcodeviewer.html`) - Local file viewer, includes: parser, camera, renderer2d, renderer3d, animator, controller
3. **Font Creator** (`dist/fontcreator.html`) - Font design tool, adds: font-creator-controller, font-creator-app
4. **Landing Page** (`dist/index.html`) - GitHub Pages landing page copied from `src/index.html`

**Build process:**
1. Reads HTML template from `src/gcodeviewer{-fluidnc,}.html` or `src/fontcreator.html`
2. Inlines CSS from `src/css/common.css` (+ `fluidnc.css`/`font-creator.css` if applicable) into `<style>` tags
3. Concatenates JS files in dependency order (see `$builds` array in `build.ps1`)
4. Minifies JS with Terser (3 passes: `--compress passes=3`)
5. Removes CSS/HTML comments and strips whitespace
6. Creates `.gz` versions for embedded deployment (FluidNC only)

**Run:** `.\build.ps1` (requires `npm install -g terser`)
**Output:** `dist/*.html` + `dist/*.html.gz` (check file sizes in console output)

## Key Development Patterns

### 1. Streaming Parser Architecture
GCode files are parsed in **50KB chunks** to handle large files without freezing:
```javascript
// parser.js - Never load entire file into memory
async parseFile(file, onProgress) {
    const chunkSize = 50 * 1024; // 50KB chunks
    while (offset < totalSize) {
        const chunk = await this.readChunk(file, offset, chunkSize);
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line
        // Process complete lines...
    }
}
```

### 2. Modal State Tracking
GCode parser maintains modal state (position, units, plane, tool) across lines:
- Absolute (`G90`) vs relative (`G91`) positioning
- Units: `mm` (`G21`) or `inches` (`G20`)
- Plane selection: `XY` (`G17`), `ZX` (`G18`), `YZ` (`G19`)
- Current tool number for multi-tool coloring

### 3. Adaptive Arc Tessellation
Arcs (`G2`/`G3`) are converted to line segments with segment count based on arc length and radius:
```javascript
// parser.js - More segments for larger/longer arcs
const segmentLength = 1.0; // mm per segment
const numSegments = Math.max(8, Math.ceil(arcLength / segmentLength));
```

### 4. Dual Renderer Pattern
Both renderers share the same `Camera` instance for consistent view transforms:
- **2D:** Canvas 2D context with manual matrix math for pan/zoom
- **3D:** WebGL with MVP matrix uniform, depth testing enabled
- Switch via `Controller.toggleView()` which swaps canvas visibility

### 5. Tool Color Management
Multi-tool jobs assign colors from predefined palette:
```javascript
// controller.js
this.toolColors = ['#00ccff', '#00ff88', '#ff4dff', '#ffff00', ...];
// Each tool gets checkbox + color picker in UI
this.tools.set(toolNum, { visible: true, color: this.toolColors[index] });
```

### 6. Theming with CSS Custom Properties
All colors defined in `:root[data-theme="light/dark"]` in `common.css`:
```css
:root[data-theme="light"] { --bg-color: #ffffff; --text-color: #333333; }
:root[data-theme="dark"] { --bg-color: #1e1e1e; --text-color: #e0e0e0; }
```
Theme persisted in `localStorage`, applied to `<html data-theme="...">` attribute.

### 7. SpaceMouse/3D Mouse Integration
Controller supports 3Dconnexion SpaceMouse via Gamepad API:
- Detects devices with "3dconnexion", "spacemouse", or "space" in gamepad ID
- Polls axes during render loop for smooth camera control
- Maps axes to pan/zoom/rotate operations in 3D view
- No configuration UI - auto-detects and enables when connected

## Critical Code Conventions

### File Size Discipline
**Every change must justify its bytes:**
- Use ternary operators over if/else when shorter
- Reuse variables instead of creating new ones
- Inline small functions (< 3 lines) if called once
- Avoid duplicate logic - extract to shared functions
- Check build output sizes after every feature: `.\build.ps1`

### No External Dependencies
**Never use:**
- npm packages (except build tools: `terser`)
- CDN libraries (Three.js, jQuery, etc.)
- Polyfills (target modern browsers only)
- Web Workers (adds complexity for minimal benefit at this size)

### WebGL Shader Conventions
Shaders are **embedded as template strings** in `renderer3d.js`:
```javascript
const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    uniform mat4 uMVP;
    varying vec3 vColor;
    void main() { gl_Position = uMVP * vec4(aPosition, 1.0); vColor = aColor; }
`;
```
Always enable depth testing: `gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);`

### Event Listener Patterns
All event listeners set up in `Controller.setupEventListeners()`:
- Use `addEventListener` (never inline `onclick=`)
- Store drag state in controller properties (`isDragging`, `lastMouseX`, etc.)
- Handle both mouse and touch events for mobile support
- Clean up with `removeEventListener` if dynamically adding/removing

### FluidNC Extension Pattern
FluidNC version **extends** base Controller:
```javascript
class FluidNCController extends Controller {
    constructor() {
        super(); // Calls base constructor
        this.fluidAPI = new FluidNCAPI();
        this.setupFluidNCListeners(); // Add FluidNC-specific UI
    }
}
```
Instantiate `FluidNCController` instead of `Controller` in `fluidnc.html`.

**Predictive Animation System:**
During file execution, FluidNC provides progress updates every 200-500ms. To achieve smooth 60fps animation:
- `calculateSegmentExecutionTimes()` - Pre-computes expected time for each segment (distance ÷ feed rate)
- `findSegmentByElapsedTime()` - Uses binary search to predict current segment from elapsed time
- `predictiveAnimate()` - Runs at 60fps via `requestAnimationFrame`, estimates position using time
- **Time offset adjustment** - When FluidNC progress differs from prediction by >10 segments, adjusts time offset to correct drift
- Result: Smooth animation that predicts machine position between infrequent status updates

## Testing Workflow

### Local Testing
1. Edit files in `src/` directory (changes reflected immediately in browser)
2. Open `src/gcodeviewer.html` or `src/gcodeviewer-fluidnc.html` directly in browser (no server needed for standalone)
3. For FluidNC features, use local server: `python -m http.server 8000` or PowerShell's `Start-Process`

### Build Testing
```powershell
.\build.ps1  # Creates dist/gcodeviewer.html and dist/gcodeviewer.html.gz
# Open dist files in browser to test minified version
```

### FluidNC Device Testing
Create `localtest.ps1` (git-ignored) to automate upload:
```powershell
.\build.ps1
curl -F "file=@dist/gcodeviewer.html.gz" http://YOUR-DEVICE-IP/files
```

### Manual Test Checklist
**GCode Viewer (Standalone/FluidNC):**
- [ ] Load example files (`examples/simple_square.nc`, `circle_arc.nc`, `3d_toolpath.nc`)
- [ ] Toggle 2D/3D view (double-check WebGL initialization in console)
- [ ] Pan/zoom/rotate in both views
- [ ] Play/pause animation, adjust speed, step forward/backward
- [ ] Layer filter (min/max Z)
- [ ] Tool visibility toggles, color pickers
- [ ] Rapid move visibility toggle
- [ ] Light/dark theme switch (verify localStorage persistence)
- [ ] Screenshot export (Canvas 2D `toDataURL()` functionality)
- [ ] Touch controls on mobile/tablet (pinch zoom, two-finger pan)
- [ ] SpaceMouse input (if device connected)

**Font Creator Specific:**
- [ ] Draw character strokes on canvas (mouse + touch)
- [ ] Undo/redo functionality
- [ ] Clear canvas and character management
- [ ] Arc detection (toggle on/off, adjust min radius)
- [ ] Path simplification (Douglas-Peucker tolerance slider)
- [ ] Font metrics guide lines (ascent, cap height, baseline, descent)
- [ ] Preview text with current font
- [ ] Generate GCode from text (verify G-code syntax)
- [ ] Font import/export (JSON format with `.json` extension)
- [ ] Kerning pairs editor (add/edit/delete pairs)

## Common Tasks

### Adding a GCode Command
1. Add parsing logic to `GCodeParser.parseLine()` (modal state update)
2. Generate segments in `processMotion()` or handle in modal state
3. Update `Supported GCode Commands` table in `README.md`

### Adding a UI Control
1. Add HTML element to `src/gcodeviewer.html` or `src/gcodeviewer-fluidnc.html` or `src/fontcreator.html`
2. Style in `src/css/common.css` (use CSS custom properties for colors)
3. Add event listener in `Controller.setupEventListeners()` (or `FluidNCController`/`FontCreatorController`)
4. Update state and trigger re-render: `this.render()`

### Adding a New Font Creator Feature
1. Add UI controls to `src/fontcreator.html`
2. Style in `src/css/font-creator.css`
3. Implement logic in `FontCreatorController` (e.g., new drawing mode, export format)
4. Update event listeners in `font-creator-app.js` if needed
5. Test with example fonts in `examples/` directory

### Optimizing File Size
1. Run build and check sizes: `.\build.ps1`
2. Look for:
   - Duplicate code blocks (extract to functions)
   - Long variable names in hot paths (shorten after testing)
   - Unused functions or dead code
   - Comments explaining obvious code (remove)
3. Re-run build and verify size reduction
4. Test functionality hasn't broken

### Debugging Rendering Issues
- **2D:** Check `renderer2d.js` transform math, verify `Camera.applyTransform2D()` calls
- **3D:** Check WebGL errors: `gl.getError()`, verify buffer data with `console.log(positions)`
- **Both:** Verify segments array format: `[{ from: {x,y,z}, to: {x,y,z}, type: 'G0'|'G1'|..., tool: N, line: N }]`
- Enable WebGL Inspector browser extension for shader debugging

## Integration Points

### FluidNC REST API (`fluidnc-api.js`)
Key endpoints used:
- `GET /api/v1/system` - Device info, max travel dimensions
- `GET /sdfiles?path=/` - List SD card files
- `GET /sdfile?path=/foo.nc` - Download file content
- `POST /api/v1/command` - Send GCode commands (e.g., run file)

**Grid auto-sync:** `FluidNCController` calls `syncGridFromFluidNC()` on load to fetch max travel X/Y and populate grid width/height inputs.

### GitHub Actions Release (`/.github/workflows/release.yml`)
Automated on version tag push (`v*.*.*`):
1. Checkout code
2. Install Node.js + Terser
3. Run `build.ps1` via PowerShell
4. Create GitHub Release with `dist/*.html` and `dist/*.html.gz` as artifacts
5. Deploy to GitHub Pages with `index.html` landing page linking to all versions

## Documentation Standards

### Code Comments
- **JSDoc for public methods:** Include `@param`, `@returns` types
- **Inline comments:** Explain "why" (design decisions), not "what" (obvious code)
- **Complex algorithms:** Reference external docs (e.g., "LinuxCNC arc tessellation")

### README Updates
When adding features, update:
- `## Features` section (add ✅ item)
- `## Usage Guide` section (explain controls)
- `## Supported GCode Commands` table (if parser changed)
- Screenshots if UI significantly changed

### Commit Messages
Use **Conventional Commits** format:
- `feat: add G28 homing support`
- `fix: correct arc tessellation for small radii`
- `perf: optimize 2D rendering with dirty flags`
- `docs: update build instructions`

## Performance Considerations

- **Parser:** Chunk-based streaming prevents UI freeze on large files (5MB+)
- **Rendering:** Skip invisible segments (layer filter, tool visibility, animation index)
- **Animation:** Use `requestAnimationFrame()` for smooth 60fps playback
- **WebGL:** Batch geometry into single buffer upload per frame (avoid per-segment draw calls)
- **Touch:** Debounce/throttle touch events to prevent frame drops on mobile

## Known Limitations

- **File size:** 5MB recommended max (browser memory constraints)
- **WebGL support:** Falls back to 2D-only if WebGL unavailable
- **Arc precision:** Tessellation granularity may show facets on extreme zoom
- **GCode dialect:** Targets GRBL/LinuxCNC/FluidNC (may not support all variants)
- **FluidNC reload context loss:** Page reload during file execution loses viewer state (file path, playback position, tool visibility). Files cannot be re-fetched from FluidNC during execution (blocked for performance). Use IndexedDB to cache file content and localStorage for metadata.

## Future Enhancement Patterns

### FluidNC State Persistence
To handle page reloads during long jobs (hours), implement IndexedDB for file caching and localStorage for metadata:
```javascript
// In FluidNCController - IndexedDB wrapper for file caching
async cacheFile(filePath, fileContent) {
    const db = await this.openDB();
    const tx = db.transaction('files', 'readwrite');
    await tx.objectStore('files').put({
        path: filePath,
        content: fileContent,
        timestamp: Date.now()
    });
}

async getCachedFile(filePath) {
    const db = await this.openDB();
    const tx = db.transaction('files', 'readonly');
    return await tx.objectStore('files').get(filePath);
}

openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('FluidNCViewer', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            db.createObjectStore('files', { keyPath: 'path' });
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = () => reject(request.error);
    });
}

// Save state after file loads
async saveViewerState(fileContent) {
    await this.cacheFile(this.currentFilePath, fileContent);
    localStorage.setItem('fluidnc-viewer-state', JSON.stringify({
        filePath: this.currentFilePath,
        animationIndex: this.animator.currentIndex,
        layerMin: this.layerMin,
        layerMax: this.layerMax,
        toolStates: Array.from(this.tools.entries()),
        timestamp: Date.now()
    }));
}

// On controller init - restore from cache
async restoreViewerState() {
    const saved = localStorage.getItem('fluidnc-viewer-state');
    if (!saved) return;
    
    const state = JSON.parse(saved);
    const ageHours = (Date.now() - state.timestamp) / 3600000;
    if (ageHours > 24) { // 24 hour timeout
        localStorage.removeItem('fluidnc-viewer-state');
        return;
    }
    
    // Try to load from IndexedDB cache
    const cached = await this.getCachedFile(state.filePath);
    if (cached) {
        // Show UI: "Restoring previous file..."
        await this.parser.parseString(cached.content);
        this.animator.currentIndex = state.animationIndex;
        this.layerMin = state.layerMin;
        // ... restore other settings
    }
}

// Clear state when job completes or file is closed
clearViewerState() {
    localStorage.removeItem('fluidnc-viewer-state');
    // Optionally clear IndexedDB cache too, or leave for re-use
}
```
**Metadata to store in localStorage:**
- `filePath` - path on FluidNC device for reference/display
- `animationIndex` - current playback position for resume
- `layerMin`/`layerMax` - Z-height filter values
- `toolStates` - Map of tool visibility and colors: `[[toolNum, {visible, color}], ...]`
- `currentView` - '2d' or '3d' mode
- `rapidMovesVisible` - G0 travel move visibility
- `rapidMoveColor` - G0 color preference
- `timestamp` - Date.now() for staleness check

**Key constraints:** 
- IndexedDB has no practical size limit (handles multi-GB files)
- Cache file content on load, metadata in localStorage for quick access
- Clear cached files after 24h to prevent disk bloat
- Call `saveViewerState(fileContent)` after file successfully loads and periodically during playback (for animation position)
- Call `clearViewerState()` when user closes file or job completes successfully
