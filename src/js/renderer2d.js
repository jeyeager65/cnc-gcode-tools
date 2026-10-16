/**
 * 2D Canvas Renderer
 * Renders GCode toolpaths on 2D canvas with pan/zoom and grid overlay
 */

class Renderer2D {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = camera;
        this.segments = [];
        this.bounds = null;
        this.layerFilter = { min: -Infinity, max: Infinity };
        this.hoveredPoint = null;
        this.maxSegmentIndex = Infinity;
        this.toolStates = new Map(); // { toolNum: { visible, color } }
        this.rapidMovesVisible = true; // Show rapid moves by default
        this.rapidMoveColor = '#999999'; // Default gray color
        
        this.resizeCanvas();
    }

    /**
     * Resize canvas to match display size
     */
    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }

    /**
     * Set segments to render
     */
    setSegments(segments, bounds) {
        this.segments = segments;
        this.bounds = bounds;
        this.maxSegmentIndex = segments.length;
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
     * Update buffers (for compatibility with 3D renderer)
     */
    updateBuffers() {
        // 2D renderer doesn't need to update buffers
    }

    /**
     * Set layer filter
     */
    setLayerFilter(min, max) {
        this.layerFilter.min = min;
        this.layerFilter.max = max;
    }

    /**
     * Set maximum segment index for animation
     */
    setMaxSegmentIndex(index, segmentProgress = 1) {
        this.maxSegmentIndex = index;
        this.segmentProgress = segmentProgress;
    }

    /**
     * Render frame
     */
    render() {
        this.resizeCanvas();
        this.clear();
        
        if (this.segments.length === 0) {
            this.drawWelcomeMessage();
            return;
        }
        
        const transform = this.camera.get2DTransform(this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        this.ctx.translate(transform.translateX, transform.translateY);
        this.ctx.scale(transform.scale, -transform.scale); // Flip Y axis
        
        this.drawGrid(transform);
        this.drawSegments();
        this.drawCurrentPositionMarker();
        
        this.ctx.restore();
        
        // Draw grid labels after restoring transform (in screen space)
        this.drawGridLabels(transform);
        
        this.drawCoordinateAxes();
    }

    /**
     * Clear canvas
     */
    clear() {
        const theme = document.documentElement.getAttribute('data-theme');
        this.ctx.fillStyle = theme === 'dark' ? '#252525' : '#fafafa';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Draw welcome message
     */
    drawWelcomeMessage() {
        this.ctx.save();
        this.ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-color');
        this.ctx.font = '16px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(
            'Load a GCode file to visualize',
            this.canvas.width / 2,
            this.canvas.height / 2
        );
        this.ctx.restore();
    }

    /**
     * Draw grid overlay
     */
    drawGrid(transform) {
        const theme = document.documentElement.getAttribute('data-theme');
        const gridColor = theme === 'dark' ? '#3a3a3a' : '#e0e0e0';
        
        // Calculate grid spacing
        const zoom = transform.scale;
        let gridSize = 10;
        
        // Adaptive grid size based on zoom
        if (zoom < 0.5) gridSize = 100;
        else if (zoom < 2) gridSize = 50;
        else if (zoom > 10) gridSize = 1;
        else if (zoom > 5) gridSize = 5;
        
        const viewLeft = -transform.translateX / zoom;
        const viewRight = (this.canvas.width - transform.translateX) / zoom;
        const viewTop = transform.translateY / zoom;
        const viewBottom = (transform.translateY - this.canvas.height) / zoom;
        
        this.ctx.strokeStyle = gridColor;
        this.ctx.lineWidth = 1 / zoom;
        
        // Vertical lines
        const startX = Math.floor(viewLeft / gridSize) * gridSize;
        const endX = Math.ceil(viewRight / gridSize) * gridSize;
        
        for (let x = startX; x <= endX; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, viewBottom);
            this.ctx.lineTo(x, viewTop);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        const startY = Math.floor(viewBottom / gridSize) * gridSize;
        const endY = Math.ceil(viewTop / gridSize) * gridSize;
        
        for (let y = startY; y <= endY; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(viewLeft, y);
            this.ctx.lineTo(viewRight, y);
            this.ctx.stroke();
        }
        
        // Draw origin
        this.ctx.strokeStyle = theme === 'dark' ? '#666666' : '#999999';
        this.ctx.lineWidth = 2 / zoom;
        
        // X axis
        this.ctx.beginPath();
        this.ctx.moveTo(0, viewBottom);
        this.ctx.lineTo(0, viewTop);
        this.ctx.stroke();
        
        // Y axis
        this.ctx.beginPath();
        this.ctx.moveTo(viewLeft, 0);
        this.ctx.lineTo(viewRight, 0);
        this.ctx.stroke();
    }

    /**
     * Draw all segments
     */
    drawSegments() {
        const theme = document.documentElement.getAttribute('data-theme');
        
        // Tool colors - matching 3D renderer
        const toolColors = [
            theme === 'dark' ? '#00ccff' : '#0066cc',   // Tool 0: Cyan/Blue
            theme === 'dark' ? '#00ff88' : '#00cc66',   // Tool 1: Green
            theme === 'dark' ? '#ff4dff' : '#cc00cc',   // Tool 2: Magenta
            theme === 'dark' ? '#ffff00' : '#cccc00',   // Tool 3: Yellow
            theme === 'dark' ? '#ff8800' : '#ff6600',   // Tool 4: Orange
            theme === 'dark' ? '#8888ff' : '#4d4dff',   // Tool 5: Blue
            theme === 'dark' ? '#ff0088' : '#ff0066',   // Tool 6: Red-Pink
            theme === 'dark' ? '#00ffff' : '#00b3b3',   // Tool 7: Cyan
        ];
        
        const zoom = this.camera.zoom2d;
        const lineWidth = Math.max(0.5, 1.5 / zoom);
        
        // Group segments by type and tool for batched rendering
        const rapidSegments = [];
        const probeSegments = []; // G38.x, drawn to full travel since the contact point isn't known
        const cutSegmentsByTool = {}; // { toolNum: [segments] }
        let partialSegment = null;
        
        for (let i = 0; i < Math.min(this.segments.length, this.maxSegmentIndex); i++) {
            const seg = this.segments[i];
            
            // Apply layer filter
            if (seg.start.z < this.layerFilter.min || seg.start.z > this.layerFilter.max) {
                continue;
            }
            
            if (seg.type === 'rapid') {
                // Only add rapid moves if they're visible
                if (this.rapidMovesVisible) {
                    rapidSegments.push(seg);
                }
            } else if (seg.type === 'probe') {
                probeSegments.push(seg);
            } else {
                const tool = seg.tool || 0;
                
                // Skip if tool is hidden
                if (this.toolStates.has(tool) && !this.toolStates.get(tool).visible) {
                    continue;
                }
                
                if (!cutSegmentsByTool[tool]) {
                    cutSegmentsByTool[tool] = [];
                }
                cutSegmentsByTool[tool].push(seg);
            }
        }
        
        // Handle partial segment (current segment being animated)
        if (this.maxSegmentIndex < this.segments.length && this.segmentProgress > 0 && this.segmentProgress < 1) {
            const seg = this.segments[this.maxSegmentIndex];
            if (seg.type === 'cut' && seg.start.z >= this.layerFilter.min && seg.start.z <= this.layerFilter.max) {
                const tool = seg.tool || 0;
                if (!this.toolStates.has(tool) || this.toolStates.get(tool).visible) {
                    partialSegment = { seg, tool };
                }
            }
        }
        
        // Draw rapid moves (if visible)
        if (this.rapidMovesVisible && rapidSegments.length > 0) {
            this.ctx.strokeStyle = this.rapidMoveColor;
            this.ctx.lineWidth = lineWidth * 0.7;
            this.ctx.setLineDash([5 / zoom, 5 / zoom]);
            this.drawSegmentBatch(rapidSegments);
        }
        
        // Draw cut moves by tool
        this.ctx.lineWidth = lineWidth;
        this.ctx.setLineDash([]);
        
        for (const tool in cutSegmentsByTool) {
            const toolNum = parseInt(tool);
            
            // Use custom color if tool state exists, otherwise use default
            if (this.toolStates.has(toolNum)) {
                this.ctx.strokeStyle = this.toolStates.get(toolNum).color;
            } else {
                const toolIndex = toolNum % toolColors.length;
                this.ctx.strokeStyle = toolColors[toolIndex];
            }
            
            this.drawSegmentBatch(cutSegmentsByTool[tool]);
        }

        // Draw probe moves, dashed: they stop at contact, somewhere along the line
        if (probeSegments.length > 0) {
            this.ctx.strokeStyle = theme === 'dark' ? '#ff6b6b' : '#d62828';
            this.ctx.setLineDash([3 / zoom, 3 / zoom]);
            this.drawSegmentBatch(probeSegments);
            this.ctx.setLineDash([]);
        }

        // Draw partial segment
        if (partialSegment) {
            const { seg, tool } = partialSegment;
            
            // Set color for partial segment
            if (this.toolStates.has(tool)) {
                this.ctx.strokeStyle = this.toolStates.get(tool).color;
            } else {
                const toolIndex = tool % toolColors.length;
                this.ctx.strokeStyle = toolColors[toolIndex];
            }
            
            // Interpolate end point based on progress
            const endX = seg.start.x + (seg.end.x - seg.start.x) * this.segmentProgress;
            const endY = seg.start.y + (seg.end.y - seg.start.y) * this.segmentProgress;
            const endZ = seg.start.z + (seg.end.z - seg.start.z) * this.segmentProgress;
            
            this.ctx.beginPath();
            this.ctx.moveTo(seg.start.x, seg.start.y);
            this.ctx.lineTo(endX, endY);
            this.ctx.stroke();
        }
    }

    /**
     * Draw batch of segments efficiently
     */
    drawSegmentBatch(segments) {
        if (segments.length === 0) return;
        
        this.ctx.beginPath();
        
        for (const seg of segments) {
            this.ctx.moveTo(seg.start.x, seg.start.y);
            this.ctx.lineTo(seg.end.x, seg.end.y);
        }
        
        this.ctx.stroke();
    }

    /**
     * Draw current position marker
     */
    drawCurrentPositionMarker() {
        if (this.maxSegmentIndex >= this.segments.length || this.maxSegmentIndex === Infinity) return;
        
        const currentSeg = this.segments[this.maxSegmentIndex];
        if (!currentSeg) return;
        
        // Interpolate position based on segment progress
        const progress = this.segmentProgress;
        const pos = {
            x: currentSeg.start.x + (currentSeg.end.x - currentSeg.start.x) * progress,
            y: currentSeg.start.y + (currentSeg.end.y - currentSeg.start.y) * progress,
            z: currentSeg.start.z + (currentSeg.end.z - currentSeg.start.z) * progress
        };
        const zoom = this.camera.zoom2d;
        const radius = 5 / zoom;
        
        // Draw circle at current position
        this.ctx.save();
        this.ctx.fillStyle = '#ff0000';
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2 / zoom;
        
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        
        this.ctx.restore();
    }

    /**
     * Draw grid labels in screen space
     */
    drawGridLabels(transform) {
        const theme = document.documentElement.getAttribute('data-theme');
        
        // Calculate grid spacing (match adaptive grid)
        const zoom = transform.scale;
        let gridSize = 10;
        
        if (zoom < 0.5) gridSize = 100;
        else if (zoom < 2) gridSize = 50;
        else if (zoom > 10) gridSize = 1;
        else if (zoom > 5) gridSize = 5;
        
        // Use a minimum label spacing of 10mm even if grid is smaller
        const labelSpacing = Math.max(gridSize, 10);
        
        const viewLeft = -transform.translateX / zoom;
        const viewRight = (this.canvas.width - transform.translateX) / zoom;
        // Account for flipped Y-axis (transform uses + instead of -)
        const viewTop = (transform.translateY) / zoom;
        const viewBottom = (transform.translateY - this.canvas.height) / zoom;
        
        this.ctx.save();
        this.ctx.fillStyle = theme === 'dark' ? '#aaa' : '#555';
        this.ctx.font = '11px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // Helper to convert world coordinates to screen coordinates
        const toScreenX = (worldX) => transform.translateX + worldX * zoom;
        // Account for flipped Y-axis
        const toScreenY = (worldY) => transform.translateY - worldY * zoom;
        
        // Draw X-axis labels
        const startX = Math.floor(viewLeft / labelSpacing) * labelSpacing;
        const endX = Math.ceil(viewRight / labelSpacing) * labelSpacing;
        
        for (let x = startX; x <= endX; x += labelSpacing) {
            const screenX = toScreenX(x);
            const screenY = toScreenY(0);
            
            // Position label below X axis or at bottom if axis not visible
            let labelY = screenY + 15;
            if (screenY < 0) labelY = 15;
            else if (screenY > this.canvas.height) labelY = this.canvas.height - 5;
            
            if (screenX >= 0 && screenX <= this.canvas.width) {
                this.ctx.fillText(x.toString(), screenX, labelY);
            }
        }
        
        // Draw Y-axis labels
        const startY = Math.floor(viewBottom / labelSpacing) * labelSpacing;
        const endY = Math.ceil(viewTop / labelSpacing) * labelSpacing;
        
        this.ctx.textAlign = 'right';
        
        for (let y = startY; y <= endY; y += labelSpacing) {
            const screenX = toScreenX(0);
            const screenY = toScreenY(y);
            
            // Position label left of Y axis or at left edge if axis not visible
            let labelX = screenX - 10;
            if (screenX < 0) labelX = 50;
            else if (screenX > this.canvas.width) labelX = this.canvas.width - 10;
            
            if (screenY >= 0 && screenY <= this.canvas.height) {
                this.ctx.fillText(y.toString(), labelX, screenY);
            }
        }
        
        this.ctx.restore();
    }

    /**
     * Draw coordinate axes in corner
     */
    drawCoordinateAxes() {
        const size = 40;
        const margin = 20;
        const x = margin + size;
        const y = this.canvas.height - margin - size;
        
        this.ctx.save();
        this.ctx.translate(x, y);
        
        // X axis (red)
        this.ctx.strokeStyle = '#ff0000';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(size, 0);
        this.ctx.stroke();
        
        this.ctx.fillStyle = '#ff0000';
        this.ctx.font = '12px sans-serif';
        this.ctx.fillText('X', size + 5, 5);
        
        // Y axis (green)
        this.ctx.strokeStyle = '#00ff00';
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(0, -size);
        this.ctx.stroke();
        
        this.ctx.fillStyle = '#00ff00';
        this.ctx.fillText('Y', 5, -size - 5);
        
        this.ctx.restore();
    }

    /**
     * Convert canvas coordinates to world coordinates
     */
    canvasToWorld(canvasX, canvasY) {
        const transform = this.camera.get2DTransform(this.canvas.width, this.canvas.height);
        
        const worldX = (canvasX - transform.translateX) / transform.scale;
        const worldY = -(canvasY - transform.translateY) / transform.scale;
        
        return { x: worldX, y: worldY };
    }

    /**
     * Find nearest point to mouse
     */
    findNearestPoint(canvasX, canvasY, threshold = 10) {
        const world = this.canvasToWorld(canvasX, canvasY);
        const thresholdWorld = threshold / this.camera.zoom2d;
        
        let nearest = null;
        let minDist = thresholdWorld;
        
        for (let i = 0; i < Math.min(this.segments.length, this.maxSegmentIndex); i++) {
            const seg = this.segments[i];
            
            // Check start point
            const distStart = Math.sqrt(
                Math.pow(seg.start.x - world.x, 2) + 
                Math.pow(seg.start.y - world.y, 2)
            );
            
            if (distStart < minDist) {
                minDist = distStart;
                nearest = { ...seg.start, lineNum: seg.lineNum };
            }
            
            // Check end point
            const distEnd = Math.sqrt(
                Math.pow(seg.end.x - world.x, 2) + 
                Math.pow(seg.end.y - world.y, 2)
            );
            
            if (distEnd < minDist) {
                minDist = distEnd;
                nearest = { ...seg.end, lineNum: seg.lineNum };
            }
        }
        
        return nearest;
    }
}
