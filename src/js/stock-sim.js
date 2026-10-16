/**
 * Stock Simulation
 * Carves a heightmap of the stock with each move's tool shape, so the 3D view can show
 * what the machined part looks like. A 3-axis machine with a vertical tool can't cut
 * undercuts, so the top surface describes the part fully; accuracy is set by the grid.
 */

const STOCK_TOOL_SHAPES = ['flat', 'ball', 'bullnose', 'vbit', 'chamfer', 'taperball'];

/**
 * Tool geometry -> { radius, profile(d), flutes }, where profile is how far above the tool
 * tip the cutting edge is at distance d from the tool axis. Returns null if it can't cut.
 * @param {Object} def - { shape, diameter, angle, tip, cornerRadius, flutes }
 */
function compileStockTool(def) {
    const tool = compileStockToolProfile(def);
    if (tool) {
        // Only for drawing the tool: flute count (0 = unknown), straight for V and chamfer bits
        tool.flutes = def.flutes > 0 ? Math.min(Math.round(def.flutes), 12) : 0;
        tool.straightFlutes = def.shape === 'vbit' || def.shape === 'chamfer';
        tool.fluteLength = def.fluteLength > 0 ? def.fluteLength : null;
        tool.overallLength = def.overallLength > 0 ? def.overallLength : null;
    }
    return tool;
}

function compileStockToolProfile(def) {
    if (!def || !(def.diameter > 0)) return null;
    const r = def.diameter / 2;
    switch (def.shape) {
        case 'ball':
            return { radius: r, flat: false, profile: (d) => r - Math.sqrt(Math.max(0, r * r - d * d)) };
        case 'bullnose': {
            const cr = Math.min(Math.max(def.cornerRadius || 0, 0), r);
            const f = r - cr;
            return {
                radius: r, flat: cr === 0,
                profile: (d) => d <= f ? 0 : cr - Math.sqrt(Math.max(0, cr * cr - (d - f) * (d - f)))
            };
        }
        case 'taperball': {
            // Ball tip of diameter TIP blending into a cone of included ANGLE, up to diameter D
            const angle = typeof def.angle === 'number' && def.angle >= 0 && def.angle < 180 ? def.angle : 90;
            const ballR = (def.tip || 0) / 2;
            if (def.diameter <= (def.tip || 0) || angle === 0) {
                // No taper left: a ball nose of the smaller size
                const br = angle === 0 ? Math.min(ballR, r) : r;
                if (!(br > 0)) return null;
                return { radius: br, flat: false, profile: (d) => br - Math.sqrt(Math.max(0, br * br - d * d)) };
            }
            const a = angle / 2 * Math.PI / 180;
            const zt = ballR * (1 - Math.sin(a)); // height where the ball meets the cone
            const rt = ballR * Math.cos(a);       // radius there
            const slope = 1 / Math.tan(a);
            return {
                radius: r, flat: false,
                profile: (d) => d <= rt
                    ? ballR - Math.sqrt(Math.max(0, ballR * ballR - d * d))
                    : zt + (d - rt) * slope
            };
        }
        case 'vbit':
        case 'chamfer': {
            const angle = def.angle > 0 && def.angle < 180 ? def.angle : 90;
            const slope = 1 / Math.tan(angle / 2 * Math.PI / 180);
            const t = Math.min(Math.max((def.tip || 0) / 2, 0), r);
            return { radius: r, flat: false, profile: (d) => d <= t ? 0 : (d - t) * slope };
        }
        default: // flat end mill
            return { radius: r, flat: true, profile: () => 0 };
    }
}

class StockSimulator {
    /**
     * @param {Object} stock - { xmin, xmax, ymin, ymax, zmin, zmax } in the file's coordinates
     * @param {Map<number, Object>} tools - T number -> tool definition (see compileStockTool)
     * @param {Object} [options] - { maxCells: grid size limit, snapshots: false to keep
     *   none (for carving forward only) }
     */
    constructor(stock, tools, options = {}) {
        this.stock = stock;
        this.useSnapshots = options.snapshots !== false;
        const width = stock.xmax - stock.xmin;
        const length = stock.ymax - stock.ymin;
        const maxCells = options.maxCells || 1e6;
        const cell = Math.sqrt(width * length / maxCells);
        this.nx = Math.max(1, Math.floor(width / cell));
        this.ny = Math.max(1, Math.floor(length / cell));
        this.dx = width / this.nx;
        this.dy = length / this.ny;
        this.vx = this.nx + 1; // vertices per row
        this.vy = this.ny + 1;
        this.heights = new Float32Array(this.vx * this.vy);
        // Heights are float32, so compare against the float32 bottom
        this.bottom = Math.fround(stock.zmin);

        this.tools = StockSimulator.compileTools(tools);
        // Moves with a T number that has no definition (e.g. rapids before the first
        // tool change) use the first tool
        this.defaultTool = this.tools.values().next().value || null;

        this.base = null; // heights after earlier jobs, the starting point for this one
        this.hiddenTools = new Set(); // segment.tool values (the tool panel's) not carved
        this.segments = [];
        this.snapshots = new Map(); // segment index -> heights after carving [0, index)
        this.gouges = new Set(); // indices of rapid moves that cut into the stock
        this.reset();
    }

    static compileTools(defs) {
        const tools = new Map();
        for (const [num, def] of defs) {
            const tool = compileStockTool(def);
            if (tool) tools.set(num, tool);
        }
        return tools;
    }

    /**
     * Carve jobs that run before this one (oldest first) into the starting stock, e.g.
     * one file per bit. Each has its own tools; moves by tools it doesn't define are skipped.
     * @param {Array<{segments: Array, tools: Map}>} jobs
     */
    setPriorJobs(jobs) {
        this.base = null;
        this.heights.fill(this.stock.zmax);
        for (const job of jobs) {
            const tools = StockSimulator.compileTools(job.tools);
            for (let i = 0; i < job.segments.length; i++) {
                this.carveMove(job.segments, i, tools, null);
            }
        }
        if (jobs.length > 0) this.base = this.heights.slice();
        this.snapshots.clear();
        this.gouges.clear();
        this.reset();
    }

    /**
     * Leave out the moves of these tools (keyed like the tool panel: segment.tool),
     * re-carving from the start if that changes anything
     */
    setHiddenTools(hidden) {
        const next = new Set(hidden);
        if (next.size === this.hiddenTools.size && [...next].every(t => this.hiddenTools.has(t))) return;
        this.hiddenTools = next;
        this.snapshots.clear();
        this.gouges.clear();
        this.reset();
    }

    setSegments(segments) {
        this.segments = segments;
        // Snapshots, so stepping the animation backward doesn't re-carve everything.
        // Up to 8 of them, within about 160 MB, however fine the grid
        const count = Math.max(1, Math.min(8, Math.floor(160e6 / this.heights.byteLength)));
        this.snapshotInterval = this.useSnapshots ? Math.max(256, Math.ceil(segments.length / count)) : Infinity;
        this.snapshots.clear();
        this.gouges.clear();
        this.reset();
    }

    reset() {
        this.partial = null;
        if (this.base) this.heights.set(this.base);
        else this.heights.fill(this.stock.zmax);
        this.carvedIndex = 0;
        this.markAllDirty();
    }

    // Changed area since the renderer last looked: vertex rows dirtyMin..dirtyMax and
    // columns dirtyMinI..dirtyMaxI
    markAllDirty() {
        this.dirtyMin = 0;
        this.dirtyMax = this.vy - 1;
        this.dirtyMinI = 0;
        this.dirtyMaxI = this.vx - 1;
    }

    clearDirty() {
        this.dirtyMin = Infinity;
        this.dirtyMax = -Infinity;
        this.dirtyMinI = Infinity;
        this.dirtyMaxI = -Infinity;
    }

    get isDirty() {
        return this.dirtyMin <= this.dirtyMax;
    }

    /**
     * Carve segments until segments [0, target) are cut, or the time budget runs out.
     * Going backward restores the nearest snapshot and carves forward from it.
     * @returns {boolean} true when the stock is up to date
     */
    advanceTo(target, budgetMs = Infinity, progress = 0) {
        target = Math.max(0, Math.min(target, this.segments.length));
        // A move carved part way (see carvePartial) that the position is now before
        const p = this.partial;
        if (p && (target < p.index || (target === p.index && progress < p.progress))) {
            this.partial = null;
            this.rewind(target);
        } else if (target < this.carvedIndex) {
            this.rewind(target);
        }

        const deadline = performance.now() + budgetMs;
        while (this.carvedIndex < target) {
            // Snapshots hold whole moves only, never one carved part way
            if (this.carvedIndex > 0 && this.carvedIndex % this.snapshotInterval === 0 &&
                !this.snapshots.has(this.carvedIndex) && !(this.partial && this.partial.index === this.carvedIndex)) {
                this.snapshots.set(this.carvedIndex, this.heights.slice());
            }
            this.carveSegment(this.carvedIndex);
            if (this.partial && this.partial.index === this.carvedIndex) this.partial = null;
            this.carvedIndex++;
            if ((this.carvedIndex & 63) === 0 && performance.now() > deadline) break;
        }
        const done = this.carvedIndex >= target;
        if (done && progress > 0 && progress < 1 && target < this.segments.length) this.carvePartial(target, progress);
        return done;
    }

    /**
     * Carve move `index` from its start to `progress` (0-1) of the way, so the stock keeps
     * up with the tool during long moves. Each call only carves on from where the last one
     * got to, as the tool's swept area along a line is the union of its pieces.
     */
    carvePartial(index, progress) {
        const seg = this.segments[index];
        if (seg.type === 'probe') return;
        if (this.hiddenTools.size > 0 && this.hiddenTools.has(seg.tool || 0)) return;
        const p = this.partial && this.partial.index === index ? this.partial : null;
        if (p && progress <= p.progress) return;
        const at = (t) => ({
            x: seg.start.x + (seg.end.x - seg.start.x) * t,
            y: seg.start.y + (seg.end.y - seg.start.y) * t,
            z: seg.start.z + (seg.end.z - seg.start.z) * t
        });
        const piece = { ...seg, start: p ? at(p.progress) : seg.start, end: at(progress) };
        // Only the first piece follows a probe (see carveMove)
        const prev = p ? piece : this.segments[index - 1];
        this.carveOne(piece, prev, this.tools, this.defaultTool);
        this.partial = { index, progress };
    }

    rewind(target) {
        let best = 0;
        for (const index of this.snapshots.keys()) {
            if (index <= target && index > best) best = index;
        }
        if (best > 0) {
            this.heights.set(this.snapshots.get(best));
            this.carvedIndex = best;
            this.markAllDirty();
        } else {
            this.reset();
        }
    }

    carveSegment(index) {
        // Same tool key as the 3D view uses for hidden toolpaths
        if (this.hiddenTools.size > 0 && this.hiddenTools.has(this.segments[index].tool || 0)) return;
        if (this.carveMove(this.segments, index, this.tools, this.defaultTool) &&
            this.segments[index].type === 'rapid') {
            this.gouges.add(index);
        }
    }

    /**
     * Carve move `index` of `segments` with its tool
     * @returns {boolean} true if any material was removed
     */
    carveMove(segments, index, tools, fallbackTool) {
        return this.carveOne(segments[index], segments[index - 1], tools, fallbackTool);
    }

    /**
     * Carve one move, given the move before it
     * @returns {boolean} true if any material was removed
     */
    carveOne(seg, prev, tools, fallbackTool) {
        // Probe moves stop on contact, so they never cut
        if (seg.type === 'probe') return false;
        const tool = tools.get(seg.toolNumber) || fallbackTool;
        if (!tool) return false;

        let s = seg.start;
        const e = seg.end;
        // A probe stops on contact somewhere along its move, but is drawn to its programmed
        // end, so the move after it (usually a retract) doesn't really start there
        if (prev && prev.type === 'probe' && s.z < e.z) s = { x: s.x, y: s.y, z: e.z };
        if (Math.min(s.z, e.z) >= this.stock.zmax) return false; // entirely above the stock

        return this.sweep(s.x, s.y, s.z, e.x, e.y, e.z, tool);
    }

    /**
     * Lower the heightmap to the tool's swept volume along a straight move.
     * Level moves are exact. Moves that change Z are cut in pieces no longer than a
     * cell, each at its own height, so the error is at most one cell's worth of slope.
     * @returns {boolean} true if any material was removed
     */
    sweep(x0, y0, z0, x1, y1, z1, tool) {
        const lx = x1 - x0, ly = y1 - y0, lz = z1 - z0;
        const lengthXY = Math.hypot(lx, ly);
        const step = Math.min(this.dx, this.dy);
        const pieces = Math.abs(lz) > 1e-9 && lengthXY > step
            ? Math.min(Math.ceil(lengthXY / step), 100000)
            : 1;

        let cut = false;
        for (let p = 0; p < pieces; p++) {
            const t0 = p / pieces, t1 = (p + 1) / pieces;
            if (this.sweepPiece(x0 + lx * t0, y0 + ly * t0, z0 + lz * t0,
                                x0 + lx * t1, y0 + ly * t1, z0 + lz * t1, tool)) {
                cut = true;
            }
        }
        return cut;
    }

    sweepPiece(ax, ay, az, bx, by, bz, tool) {
        const S = this.stock, h = this.heights;
        const r = tool.radius, r2 = r * r;
        const dx = this.dx, dy = this.dy, vx = this.vx;

        const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - r - S.xmin) / dx));
        const i1 = Math.min(this.nx, Math.floor((Math.max(ax, bx) + r - S.xmin) / dx));
        const j0 = Math.max(0, Math.ceil((Math.min(ay, by) - r - S.ymin) / dy));
        const j1 = Math.min(this.ny, Math.floor((Math.max(ay, by) + r - S.ymin) / dy));
        if (i0 > i1 || j0 > j1) return false;

        const ux = bx - ax, uy = by - ay;
        const len2 = ux * ux + uy * uy;
        const hasLength = len2 > 1e-18;
        const zLow = Math.min(az, bz); // a plunge cuts at its lowest point
        const bottom = this.bottom;
        const flat = tool.flat, profile = tool.profile;

        let cut = false;
        for (let j = j0; j <= j1; j++) {
            const py = S.ymin + j * dy - ay;
            const row = j * vx;
            for (let i = i0; i <= i1; i++) {
                const px = S.xmin + i * dx - ax;
                let t = hasLength ? (px * ux + py * uy) / len2 : 0;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                const qx = px - t * ux, qy = py - t * uy;
                const d2 = qx * qx + qy * qy;
                if (d2 > r2) continue;

                let z = hasLength ? az + (bz - az) * t : zLow;
                if (!flat) z += profile(Math.sqrt(d2));
                if (z < bottom) z = bottom;
                const k = row + i;
                if (z < h[k] - 1e-6) {
                    h[k] = z;
                    cut = true;
                }
            }
        }
        if (cut) {
            if (j0 < this.dirtyMin) this.dirtyMin = j0;
            if (j1 > this.dirtyMax) this.dirtyMax = j1;
            if (i0 < this.dirtyMinI) this.dirtyMinI = i0;
            if (i1 > this.dirtyMaxI) this.dirtyMaxI = i1;
        }
        return cut;
    }
}

/**
 * Where a probe stops on the stock, for simulating G38.x Z probes while parsing: the stock
 * is carved by the moves parsed so far (segments grows as the parser adds to it).
 */
class StockProbe {
    constructor(stock, tools) {
        this.sim = new StockSimulator(stock, tools, { maxCells: 250000, snapshots: false });
        this.segments = null;
    }

    /**
     * Tool tip height where a probe straight down at (x, y) stops: on a touch plate of
     * thickness `plate` lying on the stock (resting on the highest point under the tool),
     * or with plate 0 on the stock itself, touching it with the tool's own shape. Off the
     * stock it's the table, taken as the stock bottom.
     */
    contactZ(segments, x, y, toolNumber, plate = 0) {
        const sim = this.sim;
        if (this.segments !== segments) {
            sim.setSegments(segments);
            this.segments = segments;
        }
        sim.advanceTo(segments.length);

        const tool = sim.tools.get(toolNumber) || sim.defaultTool;
        const r = tool ? tool.radius : 0;
        const S = sim.stock;
        const i0 = Math.max(0, Math.ceil((x - r - S.xmin) / sim.dx));
        const i1 = Math.min(sim.nx, Math.floor((x + r - S.xmin) / sim.dx));
        const j0 = Math.max(0, Math.ceil((y - r - S.ymin) / sim.dy));
        const j1 = Math.min(sim.ny, Math.floor((y + r - S.ymin) / sim.dy));
        let top = -Infinity;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const d = Math.hypot(S.xmin + i * sim.dx - x, S.ymin + j * sim.dy - y);
                if (d > r) continue;
                const h = sim.heights[j * sim.vx + i];
                const z = plate > 0 || !tool ? h : h - tool.profile(d);
                if (z > top) top = z;
            }
        }
        if (top === -Infinity) {
            // Narrower than a cell: the nearest grid point, if it's on the stock
            const i = Math.round((x - S.xmin) / sim.dx), j = Math.round((y - S.ymin) / sim.dy);
            top = i >= 0 && i <= sim.nx && j >= 0 && j <= sim.ny ? sim.heights[j * sim.vx + i] : S.zmin;
        }
        return top + plate;
    }
}

/**
 * Draws a StockSimulator's heightmap as a lit solid with WebGL 1. Smooth normals are
 * worked out from the heights; as the stock is carved, only the changed rows of heights
 * and normals are uploaded.
 */
class StockMeshRenderer {
    constructor(gl) {
        this.gl = gl;
        this.sim = null;
        this.buffers = {
            skirtXY: gl.createBuffer(), skirtZ: gl.createBuffer(), skirtNormal: gl.createBuffer()
        };
        this.tiles = [];
        this.tileShapes = new Map(); // "WxH" -> { ij, index, count } shared by tiles that size
        this.initProgram();
    }

    initProgram() {
        const gl = this.gl;
        // Grid tiles give each vertex's column and row in the tile, placed by uOrigin and
        // uCell; the perimeter walls give x, y directly (uOrigin 0, uCell 1)
        const vertexSource = `
            attribute vec2 aXY;
            attribute float aZ;
            attribute vec3 aNormal;
            uniform mat4 uMVP;
            uniform vec2 uOrigin;
            uniform vec2 uCell;
            uniform float uThroughZ;
            uniform float uBottomFace; // 1: draw the tile at the stock bottom, facing down
            uniform float uBottomZ;
            varying vec3 vPos;
            varying vec3 vNormal;
            varying float vThrough;

            void main() {
                bool bottom = uBottomFace > 0.5;
                vPos = vec3(uOrigin + aXY * uCell, bottom ? uBottomZ : aZ);
                vNormal = bottom ? vec3(0.0, 0.0, -1.0) : aNormal;
                vThrough = aZ <= uThroughZ ? 1.0 : 0.0;
                gl_Position = uMVP * vec4(vPos, 1.0);
            }
        `;
        // Triangles with every corner at the stock bottom are cut through: leave a hole
        const fragmentSource = `
            #ifdef GL_FRAGMENT_PRECISION_HIGH
            precision highp float;
            #else
            precision mediump float;
            #endif
            varying vec3 vPos;
            varying vec3 vNormal;
            varying float vThrough;
            uniform vec3 uLight;
            uniform vec3 uView;
            uniform vec3 uStockColor;
            uniform vec3 uCutColor;
            uniform float uTop;
            uniform float uBottom;
            uniform float uSkirt;

            void main() {
                if (vThrough > 0.999) discard;
                vec3 n = normalize(vNormal);
                if (dot(n, uView) < 0.0) n = -n;
                float range = max(uTop - uBottom, 1e-6);
                float depth = clamp((uTop - vPos.z) / range, 0.0, 1.0);
                // The outside walls are uncut stock; machined surfaces darken with depth
                vec3 base = depth < 1e-4 || uSkirt > 0.5 ? uStockColor : mix(uCutColor, uCutColor * 0.55, depth);
                // Light from near the viewer, plus more ambient on surfaces facing up (sky)
                float diffuse = max(dot(n, uLight), 0.0);
                float sky = 0.5 + 0.5 * n.z;
                gl_FragColor = vec4(base * (0.22 + 0.18 * sky + 0.62 * diffuse), 1.0);
            }
        `;

        const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('Stock shader compile error:', gl.getShaderInfoLog(shader));
            }
            return shader;
        };
        this.program = gl.createProgram();
        gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(this.program);
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Stock program link error:', gl.getProgramInfoLog(this.program));
        }

        const p = this.program;
        this.locations = {
            aXY: gl.getAttribLocation(p, 'aXY'),
            aZ: gl.getAttribLocation(p, 'aZ'),
            aNormal: gl.getAttribLocation(p, 'aNormal'),
            uMVP: gl.getUniformLocation(p, 'uMVP'),
            uOrigin: gl.getUniformLocation(p, 'uOrigin'),
            uCell: gl.getUniformLocation(p, 'uCell'),
            uThroughZ: gl.getUniformLocation(p, 'uThroughZ'),
            uBottomFace: gl.getUniformLocation(p, 'uBottomFace'),
            uBottomZ: gl.getUniformLocation(p, 'uBottomZ'),
            uLight: gl.getUniformLocation(p, 'uLight'),
            uView: gl.getUniformLocation(p, 'uView'),
            uStockColor: gl.getUniformLocation(p, 'uStockColor'),
            uCutColor: gl.getUniformLocation(p, 'uCutColor'),
            uTop: gl.getUniformLocation(p, 'uTop'),
            uBottom: gl.getUniformLocation(p, 'uBottom'),
            uSkirt: gl.getUniformLocation(p, 'uSkirt')
        };
    }

    /**
     * Build the buffers for a simulator (or release them with null). The grid is drawn in
     * tiles of up to TILE x TILE cells, so 16-bit indices do and grids of millions of cells
     * fit: each tile only stores its heights and normals (8 bytes a vertex).
     */
    setSimulator(sim) {
        const gl = this.gl;
        // Tool meshes are keyed by the simulator's tools, so they go with it
        for (const mesh of (this.toolMeshes || new Map()).values()) {
            gl.deleteBuffer(mesh.position);
            gl.deleteBuffer(mesh.normal);
        }
        this.toolMeshes = new Map();
        for (const tile of this.tiles) {
            gl.deleteBuffer(tile.z);
            gl.deleteBuffer(tile.normal);
        }
        this.tiles = [];
        this.sim = sim;
        if (!sim) {
            this.rawNormals = this.normals = null;
            return;
        }
        const { vx, vy, nx, ny, dx, dy, stock } = sim;

        // Smooth normals, 4 bytes per vertex (x, y, z, padding)
        this.rawNormals = new Int8Array(vx * vy * 4);
        this.normals = new Int8Array(vx * vy * 4);
        this.computeNormals(0, vy - 1, 0, vx - 1);
        this.smoothWalls(0, vy - 1, 0, vx - 1);

        const T = StockMeshRenderer.TILE;
        for (let j0 = 0; j0 < ny; j0 += T) {
            for (let i0 = 0; i0 < nx; i0 += T) {
                const i1 = Math.min(i0 + T, nx), j1 = Math.min(j0 + T, ny);
                const tile = { i0, i1, j0, j1, shape: this.tileShape(i1 - i0, j1 - j0), z: gl.createBuffer(), normal: gl.createBuffer() };
                this.tiles.push(tile);
                this.uploadTile(tile, true);
            }
        }
        this.staging = null;
        sim.clearDirty();

        // Perimeter walls: x, y of each edge vertex, drawn from the surface down to the bottom
        this.edge = [];
        for (let i = 0; i < nx; i++) this.edge.push([i, 0, i + 1, 0]);
        for (let j = 0; j < ny; j++) this.edge.push([nx, j, nx, j + 1]);
        for (let i = nx; i > 0; i--) this.edge.push([i, ny, i - 1, ny]);
        for (let j = ny; j > 0; j--) this.edge.push([0, j, 0, j - 1]);
        const skirtXY = new Float32Array(this.edge.length * 12);
        let k = 0;
        for (const [i0, j0, i1, j1] of this.edge) {
            const ax = stock.xmin + i0 * dx, ay = stock.ymin + j0 * dy;
            const bx = stock.xmin + i1 * dx, by = stock.ymin + j1 * dy;
            // Two triangles: top a, top b, bottom b / top a, bottom b, bottom a
            skirtXY.set([ax, ay, bx, by, bx, by, ax, ay, bx, by, ax, ay], k);
            k += 12;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.skirtXY);
        gl.bufferData(gl.ARRAY_BUFFER, skirtXY, gl.STATIC_DRAW);
        // Each wall faces straight out
        const skirtNormal = new Int8Array(this.edge.length * 6 * 4);
        k = 0;
        for (const [i0, j0, i1, j1] of this.edge) {
            const n = j0 === j1 ? [0, j0 === 0 ? -127 : 127, 0] : [i0 === 0 ? -127 : 127, 0, 0];
            for (let v = 0; v < 6; v++, k += 4) skirtNormal.set(n, k);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.skirtNormal);
        gl.bufferData(gl.ARRAY_BUFFER, skirtNormal, gl.STATIC_DRAW);
        this.skirtZ = new Float32Array(this.edge.length * 6);
        this.updateSkirt();
    }

    /**
     * Column/row and index buffers for a tile of w x h cells, shared by every tile that size
     */
    tileShape(w, h) {
        const key = w + 'x' + h;
        let shape = this.tileShapes.get(key);
        if (shape) return shape;
        const gl = this.gl;
        const ij = new Uint8Array((w + 1) * (h + 1) * 2);
        for (let j = 0, k = 0; j <= h; j++) {
            for (let i = 0; i <= w; i++) { ij[k++] = i; ij[k++] = j; }
        }
        const indices = new Uint16Array(w * h * 6);
        for (let j = 0, k = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const a = j * (w + 1) + i, b = a + 1, c = a + w + 1, d = c + 1;
                indices[k++] = a; indices[k++] = b; indices[k++] = d;
                indices[k++] = a; indices[k++] = d; indices[k++] = c;
            }
        }
        shape = { ij: gl.createBuffer(), index: gl.createBuffer(), count: indices.length };
        gl.bindBuffer(gl.ARRAY_BUFFER, shape.ij);
        gl.bufferData(gl.ARRAY_BUFFER, ij, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shape.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        this.tileShapes.set(key, shape);
        return shape;
    }

    /**
     * Copy a tile's heights and normals out of the full grid and upload them
     */
    uploadTile(tile, create = false) {
        const gl = this.gl;
        const { heights, vx } = this.sim;
        const w = tile.i1 - tile.i0 + 1, h = tile.j1 - tile.j0 + 1;
        const T1 = StockMeshRenderer.TILE + 1;
        if (!this.staging) this.staging = { z: new Float32Array(T1 * T1), n: new Int8Array(T1 * T1 * 4) };
        const z = this.staging.z.subarray(0, w * h), n = this.staging.n.subarray(0, w * h * 4);
        for (let j = 0; j < h; j++) {
            const from = (tile.j0 + j) * vx + tile.i0;
            z.set(heights.subarray(from, from + w), j * w);
            n.set(this.normals.subarray(from * 4, (from + w) * 4), j * w * 4);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, tile.z);
        if (create) gl.bufferData(gl.ARRAY_BUFFER, z, gl.DYNAMIC_DRAW);
        else gl.bufferSubData(gl.ARRAY_BUFFER, 0, z);
        gl.bindBuffer(gl.ARRAY_BUFFER, tile.normal);
        if (create) gl.bufferData(gl.ARRAY_BUFFER, n, gl.DYNAMIC_DRAW);
        else gl.bufferSubData(gl.ARRAY_BUFFER, 0, n);
    }

    updateSkirt() {
        const { heights, vx, bottom } = this.sim;
        const z = this.skirtZ;
        let k = 0;
        for (const [i0, j0, i1, j1] of this.edge) {
            const za = heights[j0 * vx + i0], zb = heights[j1 * vx + i1];
            z[k++] = za; z[k++] = zb; z[k++] = bottom;
            z[k++] = za; z[k++] = bottom; z[k++] = bottom;
        }
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.skirtZ);
        gl.bufferData(gl.ARRAY_BUFFER, z, gl.DYNAMIC_DRAW);
    }

    /**
     * Normals for vertex rows j0..j1 from the heights around them. The 3x3 (Sobel) slope
     * averages over the grid's stair-steps, so curved walls shade smoothly.
     */
    computeNormals(j0, j1, c0, c1) {
        const { heights: h, vx, nx, ny, dx, dy } = this.sim;
        const out = this.rawNormals;
        c0 = Math.max(0, c0);
        c1 = Math.min(nx, c1);
        for (let j = Math.max(0, j0); j <= Math.min(ny, j1); j++) {
            const jd = j > 0 ? j - 1 : j, ju = j < ny ? j + 1 : j;
            const rd = jd * vx, r = j * vx, ru = ju * vx;
            const sy = (ju - jd) * dy * 4;
            for (let i = c0; i <= c1; i++) {
                const il = i > 0 ? i - 1 : i, ir = i < nx ? i + 1 : i;
                const sx = (ir - il) * dx * 4;
                const gx = sx > 0 ? (h[rd + ir] + 2 * h[r + ir] + h[ru + ir] - h[rd + il] - 2 * h[r + il] - h[ru + il]) / sx : 0;
                const gy = sy > 0 ? (h[ru + il] + 2 * h[ru + i] + h[ru + ir] - h[rd + il] - 2 * h[rd + i] - h[rd + ir]) / sy : 0;
                const scale = 127 / Math.sqrt(gx * gx + gy * gy + 1);
                const k = (r + i) * 4;
                out[k] = Math.round(-gx * scale);
                out[k + 1] = Math.round(-gy * scale);
                out[k + 2] = Math.round(scale);
            }
        }
    }

    /**
     * Final normals for rows j0..j1. On walls (steep normals) the grid's stair-steps along
     * a curve are longer than the 3x3 slope sees, which shows as vertical stripes, so wall
     * normals are averaged with the other wall normals within WALL_SMOOTH cells. Floors,
     * tops and their edges keep their own normals, so they stay crisp.
     */
    smoothWalls(j0, j1, c0, c1) {
        const { vx, nx, ny } = this.sim;
        const raw = this.rawNormals, out = this.normals;
        const R = StockMeshRenderer.WALL_SMOOTH;
        const steep = 76; // z below 0.6 (of 127): steeper than about 53 degrees
        j0 = Math.max(0, j0);
        j1 = Math.min(ny, j1);
        c0 = Math.max(0, c0);
        c1 = Math.min(nx, c1);
        for (let j = j0; j <= j1; j++) {
            for (let i = c0; i <= c1; i++) {
                const k = (j * vx + i) * 4;
                if (raw[k + 2] >= steep) {
                    out[k] = raw[k]; out[k + 1] = raw[k + 1]; out[k + 2] = raw[k + 2];
                    continue;
                }
                let sx = 0, sy = 0, sz = 0;
                for (let jj = Math.max(0, j - R); jj <= Math.min(ny, j + R); jj++) {
                    for (let ii = Math.max(0, i - R); ii <= Math.min(nx, i + R); ii++) {
                        const q = (jj * vx + ii) * 4;
                        if (raw[q + 2] >= steep) continue;
                        sx += raw[q]; sy += raw[q + 1]; sz += raw[q + 2];
                    }
                }
                const len = Math.hypot(sx, sy, sz) || 1;
                out[k] = Math.round(sx / len * 127);
                out[k + 1] = Math.round(sy / len * 127);
                out[k + 2] = Math.round(sz / len * 127);
            }
        }
    }

    /**
     * Upload the tiles carved since the last update, with their normals (which also depend
     * on the heights around them)
     */
    update() {
        const sim = this.sim;
        if (!sim || !sim.isDirty) return;
        // Slopes use the vertices either side; wall smoothing a few more
        this.computeNormals(sim.dirtyMin - 1, sim.dirtyMax + 1, sim.dirtyMinI - 1, sim.dirtyMaxI + 1);
        const reach = 1 + StockMeshRenderer.WALL_SMOOTH;
        const j0 = sim.dirtyMin - reach, j1 = sim.dirtyMax + reach;
        const c0 = sim.dirtyMinI - reach, c1 = sim.dirtyMaxI + reach;
        this.smoothWalls(j0, j1, c0, c1);
        for (const tile of this.tiles) {
            if (tile.i1 < c0 || tile.i0 > c1 || tile.j1 < j0 || tile.j0 > j1) continue;
            this.uploadTile(tile);
        }
        this.updateSkirt();
        sim.clearDirty();
    }

    draw(mvp, camera, theme) {
        const sim = this.sim;
        if (!sim) return;
        const gl = this.gl;
        const L = this.locations;
        const { back, up, right } = camera.getBasis();
        // Light from just above and left of the viewer, so walls facing any way are lit
        const light = [
            back.x + up.x * 0.6 - right.x * 0.3,
            back.y + up.y * 0.6 - right.y * 0.3,
            back.z + up.z * 0.6 - right.z * 0.3
        ];
        const len = Math.hypot(light[0], light[1], light[2]) || 1;

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(L.uMVP, false, mvp);
        gl.uniform3f(L.uLight, light[0] / len, light[1] / len, light[2] / len);
        gl.uniform3f(L.uView, back.x, back.y, back.z);
        gl.uniform1f(L.uTop, sim.stock.zmax);
        gl.uniform1f(L.uBottom, sim.stock.zmin);
        gl.uniform1f(L.uThroughZ, sim.bottom + (sim.stock.zmax - sim.stock.zmin) * 1e-5);
        if (theme === 'dark') {
            gl.uniform3f(L.uStockColor, 0.80, 0.68, 0.50);
            gl.uniform3f(L.uCutColor, 0.70, 0.55, 0.38);
        } else {
            gl.uniform3f(L.uStockColor, 0.87, 0.75, 0.56);
            gl.uniform3f(L.uCutColor, 0.76, 0.60, 0.42);
        }

        // Push the solid back a little so toolpaths drawn on its surface stay visible
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 1);

        gl.enableVertexAttribArray(L.aXY);
        gl.enableVertexAttribArray(L.aZ);
        gl.enableVertexAttribArray(L.aNormal);

        gl.uniform2f(L.uCell, sim.dx, sim.dy);
        gl.uniform1f(L.uBottomZ, sim.stock.zmin);
        const drawTiles = () => {
            let shape = null;
            for (const tile of this.tiles) {
                if (tile.shape !== shape) {
                    shape = tile.shape;
                    gl.bindBuffer(gl.ARRAY_BUFFER, shape.ij);
                    gl.vertexAttribPointer(L.aXY, 2, gl.UNSIGNED_BYTE, false, 0, 0);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shape.index);
                }
                gl.uniform2f(L.uOrigin, sim.stock.xmin + tile.i0 * sim.dx, sim.stock.ymin + tile.j0 * sim.dy);
                gl.bindBuffer(gl.ARRAY_BUFFER, tile.z);
                gl.vertexAttribPointer(L.aZ, 1, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, tile.normal);
                gl.vertexAttribPointer(L.aNormal, 3, gl.BYTE, true, 4, 0);
                gl.drawElements(gl.TRIANGLES, shape.count, gl.UNSIGNED_SHORT, 0);
            }
        };
        // Top surface
        gl.uniform1f(L.uSkirt, 0);
        gl.uniform1f(L.uBottomFace, 0);
        drawTiles();
        // Bottom: the same tiles flattened to the stock bottom, so it isn't see-through;
        // they're still left out where the top is cut through, so holes stay open
        gl.uniform1f(L.uSkirt, 1);
        gl.uniform1f(L.uBottomFace, 1);
        drawTiles();
        gl.uniform1f(L.uBottomFace, 0);

        gl.uniform1f(L.uSkirt, 1);
        gl.uniform2f(L.uOrigin, 0, 0);
        gl.uniform2f(L.uCell, 1, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.skirtXY);
        gl.vertexAttribPointer(L.aXY, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.skirtZ);
        gl.vertexAttribPointer(L.aZ, 1, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.skirtNormal);
        gl.vertexAttribPointer(L.aNormal, 3, gl.BYTE, true, 4, 0);
        gl.drawArrays(gl.TRIANGLES, 0, this.skirtZ.length);

        gl.disableVertexAttribArray(L.aXY);
        gl.disableVertexAttribArray(L.aZ);
        gl.disableVertexAttribArray(L.aNormal);
        gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    /**
     * Draw a tool (from compileStockTool) as a solid with its tip at `tip`: the cutting
     * part in `color`, a grey shank above it, turned `spin` radians about its axis
     */
    drawTool(mvp, camera, tip, tool, color, spin = 0) {
        const gl = this.gl;
        if (!this.toolProgram) this.initToolProgram();
        if (!this.toolMeshes) this.toolMeshes = new Map();
        let mesh = this.toolMeshes.get(tool);
        if (!mesh) {
            mesh = this.buildToolMesh(tool);
            this.toolMeshes.set(tool, mesh);
        }
        this.drawMesh(mvp, camera, mesh, tip, color, spin);
    }

    /**
     * Draw a box (a touch plate) from corner `min` with sides `size` [x, y, z]
     */
    drawBox(mvp, camera, min, size, color) {
        if (!this.toolProgram) this.initToolProgram();
        if (!this.boxMeshes) this.boxMeshes = new Map();
        const key = size.join(',');
        let mesh = this.boxMeshes.get(key);
        if (!mesh) {
            const [sx, sy, sz] = size;
            const positions = [], normals = [];
            const face = (corners, normal) => {
                for (const k of [0, 1, 2, 0, 2, 3]) {
                    positions.push(...corners[k]);
                    normals.push(...normal);
                }
            };
            face([[0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz]], [0, 0, 1]);
            face([[0, 0, 0], [0, sy, 0], [sx, sy, 0], [sx, 0, 0]], [0, 0, -1]);
            face([[0, 0, 0], [sx, 0, 0], [sx, 0, sz], [0, 0, sz]], [0, -1, 0]);
            face([[0, sy, 0], [0, sy, sz], [sx, sy, sz], [sx, sy, 0]], [0, 1, 0]);
            face([[0, 0, 0], [0, 0, sz], [0, sy, sz], [0, sy, 0]], [-1, 0, 0]);
            face([[sx, 0, 0], [sx, sy, 0], [sx, sy, sz], [sx, 0, sz]], [1, 0, 0]);
            const gl = this.gl;
            mesh = { position: gl.createBuffer(), normal: gl.createBuffer(), count: positions.length / 3 };
            mesh.cutterCount = mesh.count;
            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
            this.boxMeshes.set(key, mesh);
        }
        this.drawMesh(mvp, camera, mesh, min, color, 0);
    }

    /**
     * Draw a lit mesh at `offset`: its first cutterCount vertices in `color`, the rest grey
     */
    drawMesh(mvp, camera, mesh, offset, color, spin) {
        const gl = this.gl;
        const tip = offset;
        const L = this.toolLocations;
        const { back, up, right } = camera.getBasis();
        const light = [back.x + up.x * 0.6 - right.x * 0.3, back.y + up.y * 0.6 - right.y * 0.3, back.z + up.z * 0.6 - right.z * 0.3];
        const len = Math.hypot(light[0], light[1], light[2]) || 1;

        gl.useProgram(this.toolProgram);
        gl.uniformMatrix4fv(L.uMVP, false, mvp);
        gl.uniform3f(L.uOffset, tip.x, tip.y, tip.z);
        gl.uniform2f(L.uSpin, Math.cos(spin), Math.sin(spin));
        gl.uniform3f(L.uLight, light[0] / len, light[1] / len, light[2] / len);
        gl.uniform3f(L.uView, back.x, back.y, back.z);
        gl.enableVertexAttribArray(L.aPosition);
        gl.enableVertexAttribArray(L.aNormal);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
        gl.vertexAttribPointer(L.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
        gl.vertexAttribPointer(L.aNormal, 3, gl.FLOAT, false, 0, 0);

        gl.uniform3f(L.uColor, color[0], color[1], color[2]);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.cutterCount);
        gl.uniform3f(L.uColor, 0.62, 0.64, 0.67);
        gl.drawArrays(gl.TRIANGLES, mesh.cutterCount, mesh.count - mesh.cutterCount);

        gl.disableVertexAttribArray(L.aPosition);
        gl.disableVertexAttribArray(L.aNormal);
    }

    initToolProgram() {
        const gl = this.gl;
        const vertexSource = `
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            uniform mat4 uMVP;
            uniform vec3 uOffset;
            uniform vec2 uSpin; // cos, sin of the turn about the tool axis
            varying vec3 vNormal;

            vec3 spin(vec3 v) {
                return vec3(uSpin.x * v.x - uSpin.y * v.y, uSpin.y * v.x + uSpin.x * v.y, v.z);
            }

            void main() {
                vNormal = spin(aNormal);
                gl_Position = uMVP * vec4(spin(aPosition) + uOffset, 1.0);
            }
        `;
        const fragmentSource = `
            precision mediump float;
            varying vec3 vNormal;
            uniform vec3 uLight;
            uniform vec3 uView;
            uniform vec3 uColor;

            void main() {
                vec3 n = normalize(vNormal);
                float diffuse = max(dot(n, uLight), 0.0);
                float sky = 0.5 + 0.5 * n.z;
                float specular = pow(max(dot(reflect(-uLight, n), uView), 0.0), 24.0);
                gl_FragColor = vec4(uColor * (0.22 + 0.16 * sky + 0.6 * diffuse) + vec3(0.35 * specular), 1.0);
            }
        `;
        const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('Tool shader compile error:', gl.getShaderInfoLog(shader));
            }
            return shader;
        };
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(p);
        this.toolProgram = p;
        this.toolLocations = {
            aPosition: gl.getAttribLocation(p, 'aPosition'),
            aNormal: gl.getAttribLocation(p, 'aNormal'),
            uMVP: gl.getUniformLocation(p, 'uMVP'),
            uOffset: gl.getUniformLocation(p, 'uOffset'),
            uSpin: gl.getUniformLocation(p, 'uSpin'),
            uLight: gl.getUniformLocation(p, 'uLight'),
            uView: gl.getUniformLocation(p, 'uView'),
            uColor: gl.getUniformLocation(p, 'uColor')
        };
    }

    /**
     * The tool as a solid: tip and cutting edge from its profile, the fluted part up to a
     * little above the cutting edge (with helical flutes when the count is known), then
     * the shank
     */
    buildToolMesh(tool) {
        const r = tool.radius;
        const d = 2 * r;
        const edgeTop = tool.profile(r); // where the cutting edge reaches full diameter
        // Flute length (LEN) and overall length (OAL) when known, else in proportion
        const fluteTop = tool.fluteLength || Math.max(edgeTop + d * 1.5, d * 2.5);
        const shankTop = Math.max(tool.overallLength || fluteTop + d * 2, fluteTop);

        // Outline as (radius, height) from the tip outward and up, to the top of the flutes
        const steps = tool.flat ? 8 : 32;
        const cutter = [];
        for (let i = 0; i <= steps; i++) {
            const radius = r * i / steps;
            const z = tool.profile(radius);
            if (z > fluteTop) break;
            cutter.push([radius, z]);
        }
        let topRadius = r;
        if (edgeTop > fluteTop) {
            // Flutes end partway up the cone: find the radius there (the profile rises with radius)
            let lo = 0, hi = r;
            for (let k = 0; k < 40; k++) {
                const mid = (lo + hi) / 2;
                if (tool.profile(mid) < fluteTop) lo = mid; else hi = mid;
            }
            topRadius = lo;
            cutter.push([topRadius, fluteTop]);
        } else {
            const rows = 48;
            for (let i = 1; i <= rows; i++) cutter.push([r, edgeTop + (fluteTop - edgeTop) * i / rows]);
        }
        // Shank of the cutting diameter (the post doesn't give a shank size)
        const shank = [[topRadius, fluteTop], [r, fluteTop], [r, shankTop], [0, shankTop]];

        const positions = [], normals = [];
        this.fluted(cutter, tool, fluteTop, positions, normals);
        const cutterCount = positions.length / 3;

        const sides = 32;
        const lathe = (outline) => {
            for (let k = 0; k + 1 < outline.length; k++) {
                const [r0, z0] = outline[k], [r1, z1] = outline[k + 1];
                // Outward normal of this band in the (radius, height) plane
                let nr = z1 - z0, nz = -(r1 - r0);
                const nl = Math.hypot(nr, nz);
                if (nl === 0) continue;
                nr /= nl; nz /= nl;
                for (let s = 0; s < sides; s++) {
                    const a0 = s / sides * 2 * Math.PI, a1 = (s + 1) / sides * 2 * Math.PI;
                    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
                    const quad = [
                        [r0 * c0, r0 * s0, z0, c0, s0], [r1 * c0, r1 * s0, z1, c0, s0], [r1 * c1, r1 * s1, z1, c1, s1],
                        [r0 * c0, r0 * s0, z0, c0, s0], [r1 * c1, r1 * s1, z1, c1, s1], [r0 * c1, r0 * s1, z0, c1, s1]
                    ];
                    for (const [x, y, z, cx, cy] of quad) {
                        positions.push(x, y, z);
                        normals.push(nr * cx, nr * cy, nz);
                    }
                }
            }
        };
        lathe(shank);

        const gl = this.gl;
        const mesh = { position: gl.createBuffer(), normal: gl.createBuffer(), cutterCount, count: positions.length / 3 };
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
        return mesh;
    }

    /**
     * Triangles for the cutting part: the outline turned about the axis, with `tool.flutes`
     * gullies cut into it that twist at a 30° helix (straight for V and chamfer bits) and
     * run out below the shank. Normals come from the surface's own slopes.
     */
    fluted(outline, tool, fluteTop, positions, normals) {
        const r = tool.radius;
        const sides = tool.flutes > 0 ? 96 : 32;
        const depth = 0.42; // gully depth, as a fraction of the radius
        const twist = tool.straightFlutes ? 0 : Math.tan(30 * Math.PI / 180) / r; // radians per unit up
        const runout = r * 1.5; // gullies fade out over this height below the top

        const point = (rad, z, theta) => {
            let scale = 1;
            if (tool.flutes > 0) {
                const fade = Math.min(1, Math.max(0, (fluteTop - z) / runout));
                const w = 0.5 + 0.5 * Math.cos(tool.flutes * (theta - z * twist));
                // Wide gullies between narrow lands with a crisp cutting edge
                const t = Math.min(1, Math.max(0, (w - 0.2) / 0.55));
                scale = 1 - depth * fade * t * t * (3 - 2 * t);
            }
            return [rad * scale * Math.cos(theta), rad * scale * Math.sin(theta), z];
        };
        const grid = outline.map(([rad, z]) => {
            const row = [];
            for (let s = 0; s <= sides; s++) row.push(point(rad, z, s / sides * 2 * Math.PI));
            return row;
        });

        // Normal = (around) x (along the outline), from neighbouring grid points
        const normalAt = (i, s) => {
            for (let k = 0; k < 2; k++, i += (i + 1 < grid.length ? 1 : -1)) {
                const row = grid[i];
                const a = row[(s + 1) % sides], b = row[(s - 1 + sides) % sides];
                const up = grid[Math.min(i + 1, grid.length - 1)][s], down = grid[Math.max(i - 1, 0)][s];
                const t1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
                const t2 = [up[0] - down[0], up[1] - down[1], up[2] - down[2]];
                const n = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
                const len = Math.hypot(n[0], n[1], n[2]);
                if (len > 1e-12) return [n[0] / len, n[1] / len, n[2] / len];
            }
            return [0, 0, -1]; // the tip point, where the surface has no slope around
        };
        const norms = grid.map((row, i) => row.map((p, s) => normalAt(i, s % sides)));

        for (let i = 0; i + 1 < grid.length; i++) {
            for (let s = 0; s < sides; s++) {
                for (const [a, b] of [[i, s], [i + 1, s], [i + 1, s + 1], [i, s], [i + 1, s + 1], [i, s + 1]]) {
                    positions.push(...grid[a][b]);
                    normals.push(...norms[a][b]);
                }
            }
        }
    }

    destroy() {
        const gl = this.gl;
        this.setSimulator(null);
        for (const buffer of Object.values(this.buffers)) gl.deleteBuffer(buffer);
        for (const shape of this.tileShapes.values()) {
            gl.deleteBuffer(shape.ij);
            gl.deleteBuffer(shape.index);
        }
        for (const mesh of [...(this.toolMeshes || new Map()).values(), ...(this.boxMeshes || new Map()).values()]) {
            gl.deleteBuffer(mesh.position);
            gl.deleteBuffer(mesh.normal);
        }
        gl.deleteProgram(this.program);
        if (this.toolProgram) gl.deleteProgram(this.toolProgram);
        this.sim = null;
    }
}

// Wall normals are averaged over this many cells each way (see smoothWalls)
StockMeshRenderer.WALL_SMOOTH = 3;
// Cells per side of a drawn tile (at most 255, so a tile's columns and rows fit in bytes)
StockMeshRenderer.TILE = 128;

/**
 * Best guess at a tool's geometry from its name, for files without ToolDef comments,
 * e.g. "6mm ball nose", "1/4\" flat end mill", "60° V-bit". Sizes are converted to the
 * file's units. Returns null if no diameter is found.
 */
function guessStockToolFromName(name, units = 'mm') {
    if (!name) return null;
    const n = name.toLowerCase();
    let shape = 'flat';
    if (/taper/.test(n) && /ball/.test(n)) shape = 'taperball';
    else if (/ball/.test(n)) shape = 'ball';
    else if (/bull|corner\s*rad/.test(n)) shape = 'bullnose';
    else if (/chamfer/.test(n)) shape = 'chamfer';
    else if (/v[\s-]?(bit|carv|groove)|engrav|°|\bdeg/.test(n)) shape = 'vbit';

    const toUnits = (value, unit) => unit === units ? value : (unit === 'mm' ? value / 25.4 : value * 25.4);
    let diameter = null;
    let m = n.match(/(\d+(?:\.\d+)?)\s*mm\b/);
    if (m) diameter = toUnits(parseFloat(m[1]), 'mm');
    else if ((m = n.match(/(\d+)\s*\/\s*(\d+)\s*(?:"|in\b|inch)?/))) {
        diameter = toUnits(parseInt(m[1]) / parseInt(m[2]), 'inches');
    } else if ((m = n.match(/(\d*\.\d+|\d+)\s*(?:"|in\b|inch)/))) {
        diameter = toUnits(parseFloat(m[1]), 'inches');
    }
    if (!(diameter > 0)) return null;

    const fluteMatch = n.match(/(\d+)[\s-]*(?:flutes?|fl\b)/); // "1-flute", "2 flute", "3FL"
    const angleMatch = n.match(/(\d+(?:\.\d+)?)\s*(?:°|deg)/);
    return {
        shape,
        diameter: Math.round(diameter * 10000) / 10000,
        angle: angleMatch ? parseFloat(angleMatch[1]) : (shape === 'vbit' || shape === 'chamfer' || shape === 'taperball' ? 90 : null),
        tip: 0,
        cornerRadius: 0,
        flutes: fluteMatch ? parseInt(fluteMatch[1]) : 0
    };
}

// Node (tests) - in the browser these are plain globals
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StockSimulator, StockProbe, compileStockTool, guessStockToolFromName, STOCK_TOOL_SHAPES };
}
