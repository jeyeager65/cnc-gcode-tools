/**
 * 3D WebGL Renderer
 * Renders GCode toolpaths using WebGL with depth testing
 */

class Renderer3D {
    constructor(canvas, camera, overlayCanvas) {
        this.canvas = canvas;
        this.camera = camera;
        this.overlayCanvas = overlayCanvas;
        this.overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;
        this.gl = null;
        this.program = null;
        this.buffers = {};
        this.segments = [];
        this.bounds = null;
        this.layerFilter = { min: -Infinity, max: Infinity };
        this.maxSegmentIndex = Infinity;
        this.toolStates = new Map(); // { toolNum: { visible, color } }
        this.rapidMovesVisible = true; // Show rapid moves by default
        this.rapidMoveColor = '#999999'; // Default gray color

        // Stock simulation (see stock-sim.js): the machined part drawn as a solid
        this.stockMesh = null;
        this.stockVisible = false;
        this.stockShowPaths = true;
        this.onStockProgress = null; // Called each frame with the simulator while shown

        this.initWebGL();
        this.resizeCanvas();
    }

    /**
     * Initialize WebGL context and shaders
     */
    initWebGL() {
        this.gl = this.canvas.getContext('webgl', { 
            alpha: false,
            antialias: true,
            preserveDrawingBuffer: true 
        }) || this.canvas.getContext('experimental-webgl');
        
        if (!this.gl) {
            console.error('WebGL not supported');
            return;
        }
        
        console.log('WebGL context created successfully');
        const gl = this.gl;
        
        // Vertex shader
        const vertexShaderSource = `
            attribute vec3 aPosition;
            attribute vec3 aColor;
            uniform mat4 uMVP;
            varying vec3 vColor;
            
            void main() {
                gl_Position = uMVP * vec4(aPosition, 1.0);
                gl_PointSize = 10.0;
                vColor = aColor;
            }
        `;
        
        // Fragment shader
        const fragmentShaderSource = `
            precision mediump float;
            varying vec3 vColor;
            
            void main() {
                gl_FragColor = vec4(vColor, 1.0);
            }
        `;
        
        // Compile shaders
        const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);
        
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(this.program));
            return;
        }
        
        console.log('Shader program linked successfully');
        
        // Get attribute and uniform locations
        this.locations = {
            aPosition: gl.getAttribLocation(this.program, 'aPosition'),
            aColor: gl.getAttribLocation(this.program, 'aColor'),
            uMVP: gl.getUniformLocation(this.program, 'uMVP')
        };
        
        // Enable depth testing
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        // Toolpath buffers are created by updateBuffers()
    }

    /**
     * Compile shader
     */
    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }

    /**
     * Resize canvas
     */
    resizeCanvas() {
        // Draw at the screen's pixel density (up to 2x) so it's sharp with display scaling.
        // Only resize when the size changes: setting a canvas's size reallocates it.
        const rect = this.canvas.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        this.pixelRatio = ratio;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            // Overlay canvas for the grid labels matches it
            if (this.overlayCanvas) {
                this.overlayCanvas.width = width;
                this.overlayCanvas.height = height;
            }
        }
        
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /**
     * Set segments to render
     */
    setSegments(segments, bounds) {
        this.segments = segments;
        this.bounds = bounds;
        this.maxSegmentIndex = segments.length;
        this.layerStart = Renderer3D.findLayerStarts(segments);
        this.updateBuffers();
    }

    /**
     * For each move, where its layer starts: the move after the last level cut of the
     * tool's previous Z level, so the plunge or ramp into a layer belongs to it. A tool
     * change starts afresh. Moves that only change Z don't start a layer by themselves.
     */
    static findLayerStarts(segments) {
        const starts = new Uint32Array(segments.length);
        const eps = 1e-4;
        let start = 0, level = null, lastLevelCut = -1, tool = null;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === 'cut') {
                if (seg.tool !== tool) {
                    tool = seg.tool;
                    start = i;
                    level = null;
                    lastLevelCut = -1;
                }
                if (Math.abs(seg.end.z - seg.start.z) < eps) {
                    if (level !== null && Math.abs(seg.end.z - level) > eps) start = lastLevelCut + 1;
                    level = seg.end.z;
                    lastLevelCut = i;
                }
            }
            starts[i] = start;
        }
        return starts;
    }

    /**
     * Set the stock simulator to draw (null to stop). Its grid must fit stockMaxCells.
     */
    setStockSimulator(sim) {
        if (!this.gl) return;
        if (!this.stockMesh) {
            if (!sim) return;
            this.stockMesh = new StockMeshRenderer(this.gl);
        }
        this.stockMesh.setSimulator(sim);
    }

    /**
     * Largest stock grid the 3D view draws (it's drawn in tiles, so this is for memory)
     */
    get stockMaxCells() {
        return this.gl ? 12e6 : 0;
    }

    /**
     * Touch plate to draw (null for none): { x, y, surface, thickness, size, touched },
     * lying on the stock at `surface`, centred under the probe; green once touched
     */
    setProbePlate(plate) {
        this.probePlate = plate;
    }

    drawProbePlate(mvp) {
        const plate = this.probePlate;
        if (!plate || !(plate.thickness > 0) || !this.gl) return;
        // Solids are drawn by the stock renderer (made here if the stock isn't shown)
        if (!this.stockMesh) this.stockMesh = new StockMeshRenderer(this.gl);
        const half = plate.size / 2;
        const color = plate.touched ? [0.35, 0.8, 0.45] : [0.72, 0.74, 0.78];
        this.stockMesh.drawBox(mvp, this.camera, { x: plate.x - half, y: plate.y - half, z: plate.surface },
            [plate.size, plate.size, plate.thickness], color);
    }

    setStockDisplay(visible, showPaths, layerOnly = false) {
        this.stockVisible = visible;
        this.stockShowPaths = showPaths;
        this.stockLayerOnly = layerOnly;
    }

    /**
     * Turn of the drawn tool: clockwise seen from above, like a router, at a visible
     * 1 rev/s while toolSpinning is set (the controller sets it while the animation plays
     * or a job runs); still otherwise
     */
    toolSpinAngle() {
        const now = performance.now();
        const dt = Math.min((now - (this.spinLastFrame || now)) / 1000, 0.1);
        this.spinLastFrame = now;
        if (this.toolSpinning) {
            this.spinAngle = ((this.spinAngle || 0) - dt * 2 * Math.PI) % (2 * Math.PI);
        }
        return this.spinAngle || 0;
    }

    /**
     * Height of the XY grid: Z0, or the bottom of the stock while it's shown, so the
     * grid is the table under the stock rather than lines drawn across its top
     */
    gridZ() {
        const sim = this.stockVisible && this.stockMesh && this.stockMesh.sim;
        return sim ? sim.stock.zmin : 0;
    }

    /**
     * Set tool visibility and color states
     */
    setToolStates(toolStates) {
        this.toolStates = toolStates;
    }

    /**
     * Set rapid move (G0) visibility and color
     */
    setRapidMoveSettings(visible, color) {
        this.rapidMovesVisible = visible;
        this.rapidMoveColor = color;
    }

    /**
     * Set layer filter
     */
    setLayerFilter(min, max) {
        this.layerFilter.min = min;
        this.layerFilter.max = max;
        this.updateBuffers();
    }

    /**
     * Set maximum segment index for animation. The toolpath buffers hold every move, so
     * this only chooses how many of them to draw, plus the move in progress.
     */
    setMaxSegmentIndex(index, segmentProgress = 1) {
        this.maxSegmentIndex = index;
        this.segmentProgress = segmentProgress;
    }

    /**
     * Build the toolpath buffers once: every visible move, with rapids and cuts apart (cuts
     * are drawn after rapids, so a cut isn't hidden by a rapid along the same line), each
     * in move order, and how many vertices come before each move so that drawing up to the
     * animation position is just a vertex count. Call when the moves, filters, colors or
     * theme change; not as the animation moves.
     */
    updateBuffers() {
        if (!this.gl || this.segments.length === 0) return;

        const gl = this.gl;
        const theme = document.documentElement.getAttribute('data-theme');
        const segments = this.segments;
        const n = segments.length;

        // Convert custom rapid move color to RGB
        const rapidColor = this.hexToRgb(this.rapidMoveColor);
        // G38.x probe moves (matches the 2D renderer)
        const probeColor = theme === 'dark' ? [1.0, 0.42, 0.42] : [0.84, 0.16, 0.16];

        // Tool colors - each tool gets a distinct color
        const toolColors = [
            theme === 'dark' ? [0.0, 0.8, 1.0] : [0.0, 0.4, 0.8],   // Tool 0: Cyan/Blue
            theme === 'dark' ? [0.0, 1.0, 0.5] : [0.0, 0.8, 0.4],   // Tool 1: Green
            theme === 'dark' ? [1.0, 0.3, 1.0] : [0.8, 0.0, 0.8],   // Tool 2: Magenta
            theme === 'dark' ? [1.0, 1.0, 0.0] : [0.8, 0.8, 0.0],   // Tool 3: Yellow
            theme === 'dark' ? [1.0, 0.5, 0.0] : [1.0, 0.4, 0.0],   // Tool 4: Orange
            theme === 'dark' ? [0.5, 0.5, 1.0] : [0.3, 0.3, 1.0],   // Tool 5: Blue
            theme === 'dark' ? [1.0, 0.0, 0.5] : [1.0, 0.0, 0.4],   // Tool 6: Red-Pink
            theme === 'dark' ? [0.0, 1.0, 1.0] : [0.0, 0.7, 0.7],   // Tool 7: Cyan
        ];
        const toolRgb = new Map();
        for (const [toolNum, state] of this.toolStates) toolRgb.set(toolNum, this.hexToRgb(state.color));

        // Whether a move is drawn, and its color (kept for the move in progress)
        this.segmentVisible = (seg) => {
            if (seg.start.z < this.layerFilter.min || seg.start.z > this.layerFilter.max) return false;
            if (seg.type === 'rapid' && !this.rapidMovesVisible) return false;
            const toolNum = seg.tool || 0;
            if (seg.type === 'cut' && this.toolStates.has(toolNum) && !this.toolStates.get(toolNum).visible) return false;
            return true;
        };
        this.segmentColor = (seg) => {
            if (seg.type === 'rapid') return rapidColor;
            if (seg.type === 'probe') return probeColor;
            const toolNum = seg.tool || 0;
            return toolRgb.get(toolNum) || toolColors[toolNum % toolColors.length];
        };

        let rapidMoves = 0, cutMoves = 0;
        const shown = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            if (!this.segmentVisible(segments[i])) continue;
            shown[i] = 1;
            if (segments[i].type === 'rapid') rapidMoves++; else cutMoves++;
        }

        const rapid = { position: new Float32Array(rapidMoves * 6), color: new Float32Array(rapidMoves * 6) };
        const cut = { position: new Float32Array(cutMoves * 6), color: new Float32Array(cutMoves * 6) };
        // Vertices of each kind before move i; [n] is the total
        this.rapidBefore = new Uint32Array(n + 1);
        this.cutBefore = new Uint32Array(n + 1);
        let r = 0, c = 0;
        for (let i = 0; i < n; i++) {
            this.rapidBefore[i] = r;
            this.cutBefore[i] = c;
            if (!shown[i]) continue;
            const seg = segments[i];
            const target = seg.type === 'rapid' ? rapid : cut;
            const k = (seg.type === 'rapid' ? r : c) * 3;
            const color = this.segmentColor(seg);
            target.position[k] = seg.start.x; target.position[k + 1] = seg.start.y; target.position[k + 2] = seg.start.z;
            target.position[k + 3] = seg.end.x; target.position[k + 4] = seg.end.y; target.position[k + 5] = seg.end.z;
            target.color[k] = target.color[k + 3] = color[0];
            target.color[k + 1] = target.color[k + 4] = color[1];
            target.color[k + 2] = target.color[k + 5] = color[2];
            if (seg.type === 'rapid') r += 2; else c += 2;
        }
        this.rapidBefore[n] = r;
        this.cutBefore[n] = c;
        this.vertexCount = r + c;

        const upload = (buffer, data) => {
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        };
        if (!this.buffers.rapidPosition) {
            for (const name of ['rapidPosition', 'rapidColor', 'cutPosition', 'cutColor', 'partialPosition', 'partialColor']) {
                this.buffers[name] = gl.createBuffer();
            }
        }
        upload(this.buffers.rapidPosition, rapid.position);
        upload(this.buffers.rapidColor, rapid.color);
        upload(this.buffers.cutPosition, cut.position);
        upload(this.buffers.cutColor, cut.color);
    }

    /**
     * Draw the moves before the animation position, and the move in progress up to where
     * the tool is. Uses the line program, already in use with its MVP set.
     */
    drawToolpaths() {
        const gl = this.gl;
        const L = this.locations;
        const n = this.segments.length;
        const index = Math.max(0, Math.min(this.maxSegmentIndex, n));

        // With the stock shown while animating, earlier layers are cut into the stock, so
        // only the current layer's lines are drawn (stockLayerOnly)
        const layerOnly = this.stockVisible && this.stockLayerOnly && this.stockMesh && this.stockMesh.sim &&
            index < n && this.layerStart;
        const from = layerOnly ? this.layerStart[index] : 0;

        const draw = (positionBuffer, colorBuffer, count, first = 0) => {
            if (count <= 0) return;
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.vertexAttribPointer(L.aPosition, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
            gl.vertexAttribPointer(L.aColor, 3, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.LINES, first, count);
        };
        draw(this.buffers.rapidPosition, this.buffers.rapidColor, this.rapidBefore[index] - this.rapidBefore[from], this.rapidBefore[from]);
        draw(this.buffers.cutPosition, this.buffers.cutColor, this.cutBefore[index] - this.cutBefore[from], this.cutBefore[from]);

        // The move in progress, from its start to the tool
        const progress = this.segmentProgress;
        if (index < n && progress > 0 && progress < 1) {
            const seg = this.segments[index];
            if (this.segmentVisible(seg)) {
                const color = this.segmentColor(seg);
                const position = new Float32Array([
                    seg.start.x, seg.start.y, seg.start.z,
                    seg.start.x + (seg.end.x - seg.start.x) * progress,
                    seg.start.y + (seg.end.y - seg.start.y) * progress,
                    seg.start.z + (seg.end.z - seg.start.z) * progress
                ]);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.partialPosition);
                gl.bufferData(gl.ARRAY_BUFFER, position, gl.DYNAMIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.partialColor);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...color, ...color]), gl.DYNAMIC_DRAW);
                draw(this.buffers.partialPosition, this.buffers.partialColor, 2);
            }
        }
    }

    /**
     * Convert hex color to RGB array
     */
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        ] : [1, 1, 1];
    }

    /**
     * Render frame
     */
    render() {
        if (!this.gl) {
            console.error('No WebGL context');
            return;
        }
        
        this.resizeCanvas();
        
        const gl = this.gl;
        const theme = document.documentElement.getAttribute('data-theme');
        
        // Clear with theme color
        if (theme === 'dark') {
            gl.clearColor(0.15, 0.15, 0.15, 1.0);
        } else {
            gl.clearColor(0.98, 0.98, 0.98, 1.0);
        }
        
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        if (!this.vertexCount || this.vertexCount === 0) {
            return;
        }

        const aspect = this.canvas.width / this.canvas.height;
        const mvp = this.camera.getMVPMatrix(aspect);

        // Machined stock, carved up to the animation position a little each frame
        const showStock = this.stockVisible && this.stockMesh && this.stockMesh.sim;
        if (showStock) {
            const sim = this.stockMesh.sim;
            // Up to the tool: the moves done, and the one in progress as far as it's got
            sim.advanceTo(Math.min(this.maxSegmentIndex, this.segments.length), 25, this.segmentProgress || 0);
            this.stockMesh.update();
            this.stockMesh.draw(mvp, this.camera, theme);
            if (this.onStockProgress) this.onStockProgress(sim);
        }

        // Line program, also used by the grid and axes below
        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.locations.uMVP, false, mvp);
        gl.enableVertexAttribArray(this.locations.aPosition);
        gl.enableVertexAttribArray(this.locations.aColor);

        if (!showStock || this.stockShowPaths) this.drawToolpaths();
        
        // Draw grid
        this.drawGrid(mvp);
        
        // Draw coordinate axes
        this.drawAxes(mvp);
        
        // Touch plate while probing
        this.drawProbePlate(mvp);

        // Draw current position marker
        this.drawCurrentPositionMarker(mvp);
        
        // Draw grid labels on overlay
        this.drawGridLabels(mvp);
    }

    /**
     * Draw 3D coordinate axes
     */
    /**
     * Draw XY grid plane
     */
    drawGrid(mvp) {
        const gl = this.gl;
        
        // Check if grid is enabled
        const gridEnabled = document.getElementById('grid-enabled')?.checked;
        if (!gridEnabled) return;
        
        // Get grid dimensions from UI
        const gridWidth = parseFloat(document.getElementById('grid-width')?.value || 1000);
        const gridHeight = parseFloat(document.getElementById('grid-height')?.value || 600);
        
        if (gridWidth <= 0 || gridHeight <= 0) return;
        
        // Theme-aware colors
        const theme = document.documentElement.getAttribute('data-theme');
        const lightGray = theme === 'dark' ? [0.3, 0.3, 0.3] : [0.85, 0.85, 0.85]; // Light lines
        const darkGray = theme === 'dark' ? [0.5, 0.5, 0.5] : [0.7, 0.7, 0.7];     // Major lines
        const borderColor = theme === 'dark' ? [0.7, 0.7, 0.7] : [0.5, 0.5, 0.5];  // Border
        
        const gridPositions = [];
        const gridColors = [];
        
        // Minor grid lines (every 10mm)
        for (let x = 0; x <= gridWidth; x += 10) {
            if (x % 100 !== 0) { // Skip major grid positions
                gridPositions.push(x, 0, 0, x, gridHeight, 0);
                gridColors.push(...lightGray, ...lightGray);
            }
        }
        
        for (let y = 0; y <= gridHeight; y += 10) {
            if (y % 100 !== 0) { // Skip major grid positions
                gridPositions.push(0, y, 0, gridWidth, y, 0);
                gridColors.push(...lightGray, ...lightGray);
            }
        }
        
        // Major grid lines (every 100mm)
        for (let x = 0; x <= gridWidth; x += 100) {
            gridPositions.push(x, 0, 0, x, gridHeight, 0);
            gridColors.push(...darkGray, ...darkGray);
        }
        
        for (let y = 0; y <= gridHeight; y += 100) {
            gridPositions.push(0, y, 0, gridWidth, y, 0);
            gridColors.push(...darkGray, ...darkGray);
        }
        
        // Border (brightest)
        gridPositions.push(
            0, 0, 0, gridWidth, 0, 0,           // Bottom
            gridWidth, 0, 0, gridWidth, gridHeight, 0,  // Right
            gridWidth, gridHeight, 0, 0, gridHeight, 0, // Top
            0, gridHeight, 0, 0, 0, 0           // Left
        );
        for (let i = 0; i < 8; i++) {
            gridColors.push(...borderColor);
        }

        const gridZ = this.gridZ();
        if (gridZ !== 0) {
            for (let i = 2; i < gridPositions.length; i += 3) gridPositions[i] = gridZ;
        }

        // Create temporary buffers
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridPositions), gl.STATIC_DRAW);
        gl.vertexAttribPointer(this.locations.aPosition, 3, gl.FLOAT, false, 0, 0);
        
        const colBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridColors), gl.STATIC_DRAW);
        gl.vertexAttribPointer(this.locations.aColor, 3, gl.FLOAT, false, 0, 0);
        
        // Draw grid
        gl.drawArrays(gl.LINES, 0, gridPositions.length / 3);
        
        // Clean up
        gl.deleteBuffer(posBuffer);
        gl.deleteBuffer(colBuffer);
    }

    /**
     * Draw coordinate axes
     */
    drawAxes(mvp) {
        const gl = this.gl;
        
        if (!this.bounds) return;
        
        const size = 100; // Fixed 100mm length
        
        const axesPositions = [
            // X axis (red)
            0, 0, 0,  size, 0, 0,
            // Y axis (green)
            0, 0, 0,  0, size, 0,
            // Z axis (blue)
            0, 0, 0,  0, 0, size
        ];
        
        const axesColors = [
            1, 0, 0,  1, 0, 0,  // Red
            0, 1, 0,  0, 1, 0,  // Green
            0, 0, 1,  0, 0, 1   // Blue
        ];
        
        // Create temporary buffers for axes
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(axesPositions), gl.STATIC_DRAW);
        gl.vertexAttribPointer(this.locations.aPosition, 3, gl.FLOAT, false, 0, 0);
        
        const colBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(axesColors), gl.STATIC_DRAW);
        gl.vertexAttribPointer(this.locations.aColor, 3, gl.FLOAT, false, 0, 0);
        
        // Draw axes
        gl.drawArrays(gl.LINES, 0, 6);
        
        // Clean up temporary buffers
        gl.deleteBuffer(posBuffer);
        gl.deleteBuffer(colBuffer);
    }

    /**
     * Draw current position marker as a sphere
     */
    drawCurrentPositionMarker(mvp) {
        if (this.maxSegmentIndex >= this.segments.length || this.maxSegmentIndex === Infinity) return;
        
        const currentSeg = this.segments[this.maxSegmentIndex];
        if (!currentSeg) return;
        
        const gl = this.gl;
        // Interpolate position based on segment progress
        const progress = this.segmentProgress;
        const center = {
            x: currentSeg.start.x + (currentSeg.end.x - currentSeg.start.x) * progress,
            y: currentSeg.start.y + (currentSeg.end.y - currentSeg.start.y) * progress,
            z: currentSeg.start.z + (currentSeg.end.z - currentSeg.start.z) * progress
        };

        // With the stock shown, draw the actual tool, tip at the current position
        const sim = this.stockVisible && this.stockMesh && this.stockMesh.sim;
        const tool = sim && (sim.tools.get(currentSeg.toolNumber) || sim.defaultTool);
        if (tool) {
            const state = this.toolStates.get(currentSeg.tool || 0);
            const color = state && state.color ? this.hexToRgb(state.color) : [0.85, 0.2, 0.2];
            this.stockMesh.drawTool(mvp, this.camera, center, tool, color, this.toolSpinAngle());
            return;
        }

        const radius = 1.5; // Size of the sphere
        
        // Generate sphere geometry with normals for lighting
        const positions = [];
        const normals = [];
        const segments = 16; // Latitude/longitude segments
        
        for (let lat = 0; lat <= segments; lat++) {
            const theta = (lat * Math.PI) / segments;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            
            for (let lon = 0; lon <= segments; lon++) {
                const phi = (lon * 2 * Math.PI) / segments;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);
                
                // Normal (unit vector from center)
                const nx = cosPhi * sinTheta;
                const ny = sinPhi * sinTheta;
                const nz = cosTheta;
                
                // Position
                const x = center.x + radius * nx;
                const y = center.y + radius * ny;
                const z = center.z + radius * nz;
                
                positions.push(x, y, z);
                normals.push(nx, ny, nz);
            }
        }
        
        // Generate indices for triangles
        const indices = [];
        for (let lat = 0; lat < segments; lat++) {
            for (let lon = 0; lon < segments; lon++) {
                const first = lat * (segments + 1) + lon;
                const second = first + segments + 1;
                
                indices.push(first, second, first + 1);
                indices.push(second, second + 1, first + 1);
            }
        }
        
        // Create and use sphere shader if not already created
        if (!this.sphereProgram) {
            const vertexShaderSource = `
                attribute vec3 aPosition;
                attribute vec3 aNormal;
                uniform mat4 uMVP;
                varying vec3 vNormal;
                
                void main() {
                    gl_Position = uMVP * vec4(aPosition, 1.0);
                    vNormal = aNormal;
                }
            `;
            
            const fragmentShaderSource = `
                precision mediump float;
                varying vec3 vNormal;
                
                void main() {
                    vec3 lightDir = normalize(vec3(0.5, 0.3, 1.0));
                    float diffuse = max(dot(vNormal, lightDir), 0.0);
                    float ambient = 0.3;
                    float lighting = ambient + diffuse * 0.7;
                    
                    vec3 color = vec3(1.0, 0.0, 0.0) * lighting;
                    gl_FragColor = vec4(color, 1.0);
                }
            `;
            
            const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
            const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
            
            this.sphereProgram = gl.createProgram();
            gl.attachShader(this.sphereProgram, vertexShader);
            gl.attachShader(this.sphereProgram, fragmentShader);
            gl.linkProgram(this.sphereProgram);
            
            this.sphereLocations = {
                aPosition: gl.getAttribLocation(this.sphereProgram, 'aPosition'),
                aNormal: gl.getAttribLocation(this.sphereProgram, 'aNormal'),
                uMVP: gl.getUniformLocation(this.sphereProgram, 'uMVP')
            };
        }
        
        gl.useProgram(this.sphereProgram);
        gl.uniformMatrix4fv(this.sphereLocations.uMVP, false, mvp);
        
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
        gl.vertexAttribPointer(this.sphereLocations.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.sphereLocations.aPosition);
        
        const normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
        gl.vertexAttribPointer(this.sphereLocations.aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.sphereLocations.aNormal);
        
        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        
        // Draw sphere
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
        
        gl.deleteBuffer(posBuffer);
        gl.deleteBuffer(normalBuffer);
        gl.deleteBuffer(indexBuffer);
    }

    /**
     * Draw grid labels on 2D overlay canvas
     */
    drawGridLabels(mvp) {
        if (!this.overlayCtx) return;
        
        const ctx = this.overlayCtx;
        // Clear (also when the grid is off), then draw in CSS pixels
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        const ratio = this.pixelRatio || 1;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const cssWidth = this.overlayCanvas.width / ratio;
        const cssHeight = this.overlayCanvas.height / ratio;
        const gridEnabled = document.getElementById('grid-enabled')?.checked;
        if (!gridEnabled) return;
        
        // Get grid dimensions
        const gridWidth = parseFloat(document.getElementById('grid-width')?.value || 1000);
        const gridHeight = parseFloat(document.getElementById('grid-height')?.value || 600);
        
        if (gridWidth <= 0 || gridHeight <= 0) return;
        
        const gridZ = this.gridZ();
        
        // Theme-aware text color
        const theme = document.documentElement.getAttribute('data-theme');
        ctx.fillStyle = theme === 'dark' ? '#aaa' : '#555';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Project 3D grid points to 2D screen coordinates
        const project = (x, y, z) => {
            // Apply MVP matrix
            const pos = [x, y, z, 1];
            const result = [0, 0, 0, 0];
            
            for (let i = 0; i < 4; i++) {
                for (let j = 0; j < 4; j++) {
                    result[i] += mvp[j * 4 + i] * pos[j];
                }
            }
            
            // Perspective divide
            const w = result[3];
            const ndcX = result[0] / w;
            const ndcY = result[1] / w;
            
            // Convert to screen coordinates
            const screenX = (ndcX + 1) * 0.5 * cssWidth;
            const screenY = (1 - ndcY) * 0.5 * cssHeight;
            
            return { x: screenX, y: screenY, visible: w > 0 };
        };
        
        // Draw X-axis labels (every 100mm)
        for (let x = 0; x <= gridWidth; x += 100) {
            const pos = project(x, 0, gridZ);
            if (pos.visible && pos.x >= 0 && pos.x <= cssWidth && 
                pos.y >= 0 && pos.y <= cssHeight) {
                ctx.fillText(x.toString(), pos.x, pos.y + 15);
            }
        }
        
        // Draw Y-axis labels (every 100mm)
        for (let y = 0; y <= gridHeight; y += 100) {
            const pos = project(0, y, gridZ);
            if (pos.visible && pos.x >= 0 && pos.x <= cssWidth && 
                pos.y >= 0 && pos.y <= cssHeight) {
                ctx.fillText(y.toString(), pos.x - 20, pos.y);
            }
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (!this.gl) return;
        
        const gl = this.gl;
        for (const buffer of Object.values(this.buffers)) gl.deleteBuffer(buffer);
        gl.deleteProgram(this.program);
        if (this.stockMesh) this.stockMesh.destroy();
    }
}
