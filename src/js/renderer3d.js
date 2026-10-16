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
        
        // Create buffers
        this.buffers.position = gl.createBuffer();
        this.buffers.color = gl.createBuffer();
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
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        // Resize overlay canvas to match
        if (this.overlayCanvas) {
            this.overlayCanvas.width = rect.width;
            this.overlayCanvas.height = rect.height;
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
        this.updateBuffers();
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
     * Set maximum segment index for animation
     */
    setMaxSegmentIndex(index, segmentProgress = 1) {
        this.maxSegmentIndex = index;
        this.segmentProgress = segmentProgress;
        this.updateBuffers();
    }

    /**
     * Update vertex buffers
     */
    updateBuffers() {
        if (!this.gl || this.segments.length === 0) return;
        
        const gl = this.gl;
        const theme = document.documentElement.getAttribute('data-theme');
        
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
        
        // Rapids and cuts are collected separately and the cuts drawn last, so a cut
        // isn't hidden by a rapid along the same line (e.g. a plunge and its retract)
        const rapid = { positions: [], colors: [] };
        const cut = { positions: [], colors: [] };
        
        for (let i = 0; i < Math.min(this.segments.length, this.maxSegmentIndex); i++) {
            const seg = this.segments[i];
            
            // Apply layer filter
            if (seg.start.z < this.layerFilter.min || seg.start.z > this.layerFilter.max) {
                continue;
            }
            
            // Skip rapid moves if not visible
            if (seg.type === 'rapid' && !this.rapidMovesVisible) {
                continue;
            }
            
            // Skip if tool is hidden
            const toolNum = seg.tool || 0;
            if (seg.type === 'cut' && this.toolStates.has(toolNum)) {
                const toolState = this.toolStates.get(toolNum);
                if (!toolState.visible) {
                    continue;
                }
            }

            // Choose color based on segment type and tool
            let color;
            if (seg.type === 'rapid') {
                color = rapidColor;
            } else if (seg.type === 'probe') {
                color = probeColor;
            } else {
                // Use custom color if tool state exists, otherwise use default
                if (this.toolStates.has(toolNum)) {
                    const hexColor = this.toolStates.get(toolNum).color;
                    color = this.hexToRgb(hexColor);
                } else {
                    const toolIndex = toolNum % toolColors.length;
                    color = toolColors[toolIndex];
                }
            }
            
            const target = seg.type === 'rapid' ? rapid : cut;
            
            // Start vertex
            target.positions.push(seg.start.x, seg.start.y, seg.start.z);
            target.colors.push(...color);
            
            // End vertex
            target.positions.push(seg.end.x, seg.end.y, seg.end.z);
            target.colors.push(...color);
        }
        
        // Handle partial segment (current segment being animated)
        if (this.maxSegmentIndex < this.segments.length && this.segmentProgress > 0 && this.segmentProgress < 1) {
            const seg = this.segments[this.maxSegmentIndex];
            
            // Check if segment should be rendered
            if (seg.start.z >= this.layerFilter.min && seg.start.z <= this.layerFilter.max) {
                // Skip rapid moves if not visible
                if (seg.type !== 'rapid' || this.rapidMovesVisible) {
                    const toolNum = seg.tool || 0;
                    let shouldRender = true;
                    
                    // Skip if tool is hidden
                    if (seg.type === 'cut' && this.toolStates.has(toolNum)) {
                        shouldRender = this.toolStates.get(toolNum).visible;
                    }

                    if (shouldRender) {
                        // Choose color
                        let color;
                        if (seg.type === 'rapid') {
                            color = rapidColor;
                        } else if (seg.type === 'probe') {
                            color = probeColor;
                        } else {
                            if (this.toolStates.has(toolNum)) {
                                const hexColor = this.toolStates.get(toolNum).color;
                                color = this.hexToRgb(hexColor);
                            } else {
                                const toolIndex = toolNum % toolColors.length;
                                color = toolColors[toolIndex];
                            }
                        }
                        
                        // Interpolate end point based on progress
                        const endX = seg.start.x + (seg.end.x - seg.start.x) * this.segmentProgress;
                        const endY = seg.start.y + (seg.end.y - seg.start.y) * this.segmentProgress;
                        const endZ = seg.start.z + (seg.end.z - seg.start.z) * this.segmentProgress;
                        
                        const target = seg.type === 'rapid' ? rapid : cut;
                        
                        // Start vertex
                        target.positions.push(seg.start.x, seg.start.y, seg.start.z);
                        target.colors.push(...color);
                        
                        // Partial end vertex
                        target.positions.push(endX, endY, endZ);
                        target.colors.push(...color);
                    }
                }
            }
        }
        
        const positions = rapid.positions.concat(cut.positions);
        const colors = rapid.colors.concat(cut.colors);
        this.vertexCount = positions.length / 3;
        
        // Update position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
        
        // Update color buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
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
        
        // Use program
        gl.useProgram(this.program);
        
        // Set MVP matrix
        const aspect = this.canvas.width / this.canvas.height;
        const mvp = this.camera.getMVPMatrix(aspect);
        gl.uniformMatrix4fv(this.locations.uMVP, false, mvp);
        
        // Bind position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.vertexAttribPointer(this.locations.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.locations.aPosition);
        
        // Bind color buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.vertexAttribPointer(this.locations.aColor, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.locations.aColor);
        
        // Draw lines
        gl.drawArrays(gl.LINES, 0, this.vertexCount);
        
        // Draw grid
        this.drawGrid(mvp);
        
        // Draw coordinate axes
        this.drawAxes(mvp);
        
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
        const gridEnabled = document.getElementById('grid-enabled')?.checked;
        if (!gridEnabled) return;
        
        // Get grid dimensions
        const gridWidth = parseFloat(document.getElementById('grid-width')?.value || 1000);
        const gridHeight = parseFloat(document.getElementById('grid-height')?.value || 600);
        
        if (gridWidth <= 0 || gridHeight <= 0) return;
        
        // Clear overlay
        ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
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
            const screenX = (ndcX + 1) * 0.5 * this.overlayCanvas.width;
            const screenY = (1 - ndcY) * 0.5 * this.overlayCanvas.height;
            
            return { x: screenX, y: screenY, visible: w > 0 };
        };
        
        // Draw X-axis labels (every 100mm)
        for (let x = 0; x <= gridWidth; x += 100) {
            const pos = project(x, 0, 0);
            if (pos.visible && pos.x >= 0 && pos.x <= this.overlayCanvas.width && 
                pos.y >= 0 && pos.y <= this.overlayCanvas.height) {
                ctx.fillText(x.toString(), pos.x, pos.y + 15);
            }
        }
        
        // Draw Y-axis labels (every 100mm)
        for (let y = 0; y <= gridHeight; y += 100) {
            const pos = project(0, y, 0);
            if (pos.visible && pos.x >= 0 && pos.x <= this.overlayCanvas.width && 
                pos.y >= 0 && pos.y <= this.overlayCanvas.height) {
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
        gl.deleteBuffer(this.buffers.position);
        gl.deleteBuffer(this.buffers.color);
        gl.deleteProgram(this.program);
    }
}
