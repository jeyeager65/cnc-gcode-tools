// Font Creator Controller - Handles character editing, arc detection, and text-to-GCode generation
class FontCreatorController {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.font = {}; // { 'A': { strokes: [...], bounds: {...} }, ... }
        this.kerning = {}; // { 'AV': -2, 'To': -1, ... }
        this.fontMetrics = { unitsPerEm: 1000, ascent: 800, descent: -200, capHeight: 800, xHeight: 500 };
        this.currentChar = null;
        this.currentFontId = null; // ID of currently loaded font
        this.charArray = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`~!@#$%^&*()-_=+[{]}\\|;:\'",<.>/? \u2018\u2019\u201C\u201D\u2014'.split('');
        this.strokes = []; // Current character strokes
        this.showGuides = true;
        // Guide line positions (as percentage of canvas height, 0-100)
        this.guidePositions = { ascent: 15, capHeight: 25, xHeight: 45, baseline: 75, descender: 85 };
        this.currentStroke = null;
        this.isDrawing = false;
        this.history = [];
        this.historyIndex = -1;
        this.generatedGCode = '';
        this.gridSize = 30;
    }

    // Initialize character drawing canvas
    setupCanvas() {
        this.canvas = document.getElementById('drawing-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        const container = this.canvas.parentElement;
        // Calculate available space
        const availableWidth = container.clientWidth - 40;
        const availableHeight = container.clientHeight - 40;
        // Use the smaller dimension to keep it square, max 600px
        const size = Math.min(availableWidth, availableHeight, 600);
        
        // Set canvas pixel dimensions (buffer size)
        this.canvas.width = size;
        this.canvas.height = size;
        // Also set CSS dimensions to match (prevents stretching/blurring)
        this.canvas.style.width = size + 'px';
        this.canvas.style.height = size + 'px';
        this.gridSize = size / 20; // 20x20 grid

        // Drawing events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseleave', () => this.stopDrawing());

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startDrawing(e.touches[0]);
        }, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e.touches[0]);
        }, { passive: false });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopDrawing();
        }, { passive: false });

        // Window resize (throttled)
        let fontCreatorResizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(fontCreatorResizeTimeout);
            fontCreatorResizeTimeout = setTimeout(() => {
                this.setupCanvas();
                this.render();
            }, 100);
        });
    }

    // Setup character set grid buttons
    setupCharacterSet() {
        const grid = document.getElementById('char-grid');
        grid.innerHTML = '';
        
        this.charArray.forEach(char => {
            const btn = document.createElement('button');
            btn.className = 'char-button';
            btn.textContent = char === ' ' ? '' : char;
            btn.dataset.char = char;
            btn.onclick = () => this.selectCharacter(char);
            grid.appendChild(btn);
        });
    }

    // Setup event listeners for font creator tab controls
    setupFontCreatorControls() {
        document.getElementById('clear-char').onclick = () => this.clearCharacter();
        document.getElementById('prev-char').onclick = () => this.navigateCharacter(-1);
        document.getElementById('next-char').onclick = () => this.navigateCharacter(1);
        document.getElementById('undo').onclick = () => this.undo();
        document.getElementById('redo').onclick = () => this.redo();
        
        // Font management toolbar
        document.getElementById('new-font').onclick = () => this.newFont();
        document.getElementById('save-font').onclick = () => this.saveFont();
        document.getElementById('preview-font').onclick = () => this.previewFont();
        document.getElementById('delete-font').onclick = () => this.deleteFont();
        document.getElementById('import-font-btn').onclick = () => document.getElementById('import-font').click();
        document.getElementById('import-svg-font-btn').onclick = () => document.getElementById('import-svg-font').click();
        document.getElementById('export-font').onclick = () => this.exportFont();
        
        // Collapsible sections
        document.getElementById('char-set-header').onclick = () => {
            const header = document.getElementById('char-set-header');
            const content = document.getElementById('char-grid');
            header.classList.toggle('collapsed');
            content.classList.toggle('collapsed');
        };
        
        document.getElementById('font-settings-header').onclick = () => {
            const header = document.getElementById('font-settings-header');
            const content = document.getElementById('font-settings-content');
            header.classList.toggle('collapsed');
            content.classList.toggle('collapsed');
        };
        
        document.getElementById('kerning-header').onclick = () => {
            const header = document.getElementById('kerning-header');
            const content = document.getElementById('kerning-content');
            header.classList.toggle('collapsed');
            content.classList.toggle('collapsed');
        };
        
        // Font selector in toolbar
        document.getElementById('font-selector-editor').onchange = (e) => {
            const fontId = e.target.value;
            if (!fontId) return;
            
            const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
            const selectedFont = fonts[fontId];
            if (selectedFont) {
                const currentChar = this.currentChar; // Remember current character
                
                // Clear current state before loading new font
                this.strokes = [];
                this.history = [];
                this.historyIndex = -1;
                
                this.loadFontData(selectedFont);
                localStorage.setItem('currentFontId', fontId);
                
                // If we had a character selected, reload it from the new font
                if (currentChar && this.font[currentChar]) {
                    // Character exists in new font - load it
                    this.currentChar = currentChar;
                    this.strokes = this.font[currentChar].strokes ? JSON.parse(JSON.stringify(this.font[currentChar].strokes)) : [];
                    this.history = [JSON.parse(JSON.stringify(this.strokes))];
                    this.historyIndex = 0;
                    document.getElementById('current-char').textContent = currentChar === ' ' ? '(space)' : currentChar;
                    document.querySelectorAll('.char-button').forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.char === currentChar);
                    });
                    this.render();
                    this.updateStatus(`Loaded font: ${selectedFont.name} - Drawing: ${currentChar === ' ' ? 'SPACE' : currentChar}`);
                } else if (currentChar) {
                    // Character doesn't exist in new font, show empty canvas
                    this.currentChar = currentChar;
                    this.render();
                    document.getElementById('current-char').textContent = currentChar;
                    document.querySelectorAll('.char-button').forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.char === currentChar);
                    });
                    this.updateStatus(`Loaded font: ${selectedFont.name} - Character '${currentChar}' not defined in this font`);
                } else {
                    // No character was selected
                    this.render();
                    this.updateStatus(`Loaded font: ${selectedFont.name}`);
                }
            }
        };
        
        document.getElementById('import-font').onchange = (e) => this.importFont(e);
        document.getElementById('import-svg-font').onchange = (e) => this.importSVGFont(e);
        document.getElementById('toggle-guides').onclick = () => this.toggleGuides();
        document.getElementById('add-kerning').onclick = () => this.addKerning();
        
        // Guide position inputs
        document.getElementById('ascent-pos').oninput = (e) => this.updateGuidePosition('ascent', parseFloat(e.target.value));
        document.getElementById('cap-height-pos').oninput = (e) => this.updateGuidePosition('capHeight', parseFloat(e.target.value));
        document.getElementById('x-height-pos').oninput = (e) => this.updateGuidePosition('xHeight', parseFloat(e.target.value));
        document.getElementById('baseline-pos').oninput = (e) => this.updateGuidePosition('baseline', parseFloat(e.target.value));
        document.getElementById('descender-pos').oninput = (e) => this.updateGuidePosition('descender', parseFloat(e.target.value));
        document.getElementById('reset-guides').onclick = () => this.resetGuidePositions();
        
        // Preview modal
        document.getElementById('close-preview').onclick = () => {
            document.getElementById('font-preview-modal').style.display = 'none';
        };
        
        // Close modal on background click
        document.getElementById('font-preview-modal').onclick = (e) => {
            if (e.target.id === 'font-preview-modal') {
                document.getElementById('font-preview-modal').style.display = 'none';
            }
        };
    }

    // Setup event listeners for text-to-gcode tab controls
    setupTextToGCodeControls() {
        document.getElementById('preview-gcode-btn').onclick = () => {
            this.generateGCode();
            // Switch to GCode Preview tab
            document.querySelector('.tab-button[data-tab="gcode-preview"]').click();
        };
        document.getElementById('export-image').onclick = () => this.exportImage();
        document.getElementById('export-svg').onclick = () => this.exportSVG();
        document.getElementById('export-dxf').onclick = () => this.exportDXF();
        document.getElementById('export-svg-font').onclick = () => this.exportSVGFont();
        document.getElementById('font-selector').onchange = () => this.loadSelectedFont();
    }

    // Get canvas coordinates from mouse/touch event
    getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    // Start drawing a new stroke
    startDrawing(e) {
        if (!this.currentChar) {
            this.updateStatus('Please select a character first');
            return;
        }

        this.isDrawing = true;
        const pos = this.getCanvasCoords(e);
        this.currentStroke = [{ x: pos.x, y: pos.y }];
    }

    // Continue drawing current stroke
    draw(e) {
        if (!this.isDrawing || !this.currentStroke) return;

        const pos = this.getCanvasCoords(e);
        this.currentStroke.push({ x: pos.x, y: pos.y });
        this.render();

        // Draw temporary stroke
        this.ctx.strokeStyle = '#4CAF50';
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(this.currentStroke[0].x, this.currentStroke[0].y);
        for (let i = 1; i < this.currentStroke.length; i++) {
            this.ctx.lineTo(this.currentStroke[i].x, this.currentStroke[i].y);
        }
        this.ctx.stroke();
    }

    // Stop drawing and finalize stroke
    stopDrawing() {
        if (!this.isDrawing || !this.currentStroke) return;

        this.isDrawing = false;
        if (this.currentStroke.length > 1) {
            const tolerance = parseFloat(document.getElementById('simplify-tolerance').value);
            this.strokes.push(this.simplifyPath(this.currentStroke, tolerance));
            this.saveToHistory();
            this.updateCharacterInFont();
        }
        this.currentStroke = null;
        this.render();
    }

    // Simplify path using Douglas-Peucker algorithm
    simplifyPath(points, tolerance) {
        if (points.length < 3) return points;
        return this.douglasPeucker(points, tolerance);
    }

    // Douglas-Peucker line simplification algorithm
    douglasPeucker(points, tolerance) {
        if (points.length < 3) return points;

        let maxDist = 0;
        let maxIndex = 0;
        const start = points[0];
        const end = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const dist = this.calculateDistanceToLine(points[i], start, end);
            if (dist > maxDist) {
                maxDist = dist;
                maxIndex = i;
            }
        }

        if (maxDist > tolerance) {
            const left = this.douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
            const right = this.douglasPeucker(points.slice(maxIndex), tolerance);
            return left.slice(0, -1).concat(right);
        } else {
            return [start, end];
        }
    }

    // Calculate perpendicular distance from point to line
    calculateDistanceToLine(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
        
        const u = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (mag * mag);
        const closestX = lineStart.x + u * dx;
        const closestY = lineStart.y + u * dy;
        return Math.sqrt((point.x - closestX) ** 2 + (point.y - closestY) ** 2);
    }

    // Detect circular arcs in a stroke for G2/G3 conversion
    detectArcs(stroke) {
        if (stroke.length < 5) return [{ type: 'line', points: stroke }];
        
        const segments = [];
        let i = 0;
        
        while (i < stroke.length) {
            // Try to fit an arc starting from current point
            const arcResult = this.fitArc(stroke, i);
            
            if (arcResult && arcResult.endIndex - i >= 3) {
                // Found a valid arc
                segments.push({
                    type: 'arc',
                    start: stroke[i],
                    end: stroke[arcResult.endIndex],
                    center: arcResult.center,
                    radius: arcResult.radius,
                    clockwise: arcResult.clockwise
                });
                i = arcResult.endIndex;
            } else {
                // No arc found, create line segment
                const lineEnd = Math.min(i + 1, stroke.length - 1);
                segments.push({
                    type: 'line',
                    points: stroke.slice(i, lineEnd + 1)
                });
                // Always advance at least one point to prevent infinite loop
                i = (i === lineEnd) ? i + 1 : lineEnd;
            }
        }
        
        return segments;
    }

    // Try to fit an arc to a subset of stroke points
    fitArc(stroke, startIdx) {
        const arcTolerance = parseFloat(document.getElementById('arc-tolerance').value);
        const maxPoints = Math.min(startIdx + 20, stroke.length);
        
        for (let endIdx = maxPoints - 1; endIdx > startIdx + 2; endIdx--) {
            const points = stroke.slice(startIdx, endIdx + 1);
            
            // Check if points are collinear (straight line) before attempting arc fit
            if (this.isCollinear(points, arcTolerance)) {
                continue; // Skip arc fitting for straight lines
            }
            
            const circle = this.fitCircle(points);
            
            if (!circle) continue;
            
            // Validate radius is reasonable (not too large or too small)
            // Large radii indicate nearly straight lines, which should not be arcs
            if (circle.r < 0.5 || circle.r > 50) continue;
            
            // Check if all points fit the circle within tolerance
            let allFit = true;
            let maxError = 0;
            for (const pt of points) {
                const dist = Math.sqrt((pt.x - circle.cx) ** 2 + (pt.y - circle.cy) ** 2);
                const error = Math.abs(dist - circle.r);
                maxError = Math.max(maxError, error);
                if (error > arcTolerance) {
                    allFit = false;
                    break;
                }
            }
            
            if (allFit) {
                // Determine if clockwise or counterclockwise
                const clockwise = this.isClockwise(points, circle);
                console.log(`Arc fitted: radius=${circle.r.toFixed(2)}, maxError=${maxError.toFixed(3)}, CW=${clockwise}`);
                return {
                    endIndex: endIdx,
                    center: { x: circle.cx, y: circle.cy },
                    radius: circle.r,
                    clockwise: clockwise
                };
            }
        }
        
        return null;
    }

    // Fit a circle to a set of points using algebraic method
    fitCircle(points) {
        if (points.length < 3) return null;
        
        let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
        let sumX3 = 0, sumY3 = 0, sumX2Y = 0, sumXY2 = 0;
        
        for (const pt of points) {
            const x = pt.x;
            const y = pt.y;
            const x2 = x * x;
            const y2 = y * y;
            
            sumX += x;
            sumY += y;
            sumX2 += x2;
            sumY2 += y2;
            sumXY += x * y;
            sumX3 += x2 * x;
            sumY3 += y2 * y;
            sumX2Y += x2 * y;
            sumXY2 += x * y2;
        }
        
        const n = points.length;
        const A = n * sumX2 - sumX * sumX;
        const B = n * sumXY - sumX * sumY;
        const C = n * sumY2 - sumY * sumY;
        const D = 0.5 * (n * sumXY2 - sumX * sumY2 + n * sumX3 - sumX * sumX2);
        const E = 0.5 * (n * sumY3 - sumY * sumY2 + n * sumX2Y - sumY * sumX2);
        
        const denominator = A * C - B * B;
        if (Math.abs(denominator) < 1e-10) return null;
        
        const cx = (D * C - B * E) / denominator;
        const cy = (A * E - B * D) / denominator;
        
        // Calculate radius as average distance from center
        let sumR = 0;
        for (const pt of points) {
            sumR += Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
        }
        const r = sumR / n;
        
        return { cx, cy, r };
    }

    // Check if points are collinear (form a straight line)
    isCollinear(points, tolerance) {
        if (points.length < 3) return true;
        
        const start = points[0];
        const end = points[points.length - 1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
        
        if (lineLength < 0.1) return true; // Points too close together
        
        // Check if all intermediate points are close to the line
        for (let i = 1; i < points.length - 1; i++) {
            const pt = points[i];
            // Calculate perpendicular distance from point to line
            const distance = Math.abs((dy * pt.x - dx * pt.y + end.x * start.y - end.y * start.x) / lineLength);
            if (distance > tolerance) {
                return false; // Point is too far from the line
            }
        }
        
        return true; // All points are close to the line
    }

    // Determine if arc is clockwise or counterclockwise
    isClockwise(points, circle) {
        if (points.length < 2) return false;
        
        const start = points[0];
        const end = points[points.length - 1];
        const mid = points[Math.floor(points.length / 2)];
        
        // Calculate angles from center to each point
        const angleStart = Math.atan2(start.y - circle.cy, start.x - circle.cx);
        const angleMid = Math.atan2(mid.y - circle.cy, mid.x - circle.cx);
        const angleEnd = Math.atan2(end.y - circle.cy, end.x - circle.cx);
        
        // Normalize angles to be relative to start
        let midRel = angleMid - angleStart;
        let endRel = angleEnd - angleStart;
        
        // Normalize to [-PI, PI]
        while (midRel > Math.PI) midRel -= 2 * Math.PI;
        while (midRel < -Math.PI) midRel += 2 * Math.PI;
        while (endRel > Math.PI) endRel -= 2 * Math.PI;
        while (endRel < -Math.PI) endRel += 2 * Math.PI;
        
        // If mid angle is negative, we're going clockwise
        return midRel < 0;
    }

    // Navigate to previous/next character
    navigateCharacter(direction) {
        if (!this.currentChar) {
            // Start with first character if none selected
            this.selectCharacter(this.charArray[0]);
            return;
        }
        
        const currentIndex = this.charArray.indexOf(this.currentChar);
        if (currentIndex === -1) return;
        
        let newIndex = currentIndex + direction;
        // Wrap around
        if (newIndex < 0) newIndex = this.charArray.length - 1;
        if (newIndex >= this.charArray.length) newIndex = 0;
        
        this.selectCharacter(this.charArray[newIndex]);
    }

    // Select a character to edit
    selectCharacter(char) {
        // Save current character first
        if (this.currentChar && this.strokes.length > 0) {
            this.updateCharacterInFont();
        }

        this.currentChar = char;
        this.strokes = this.font[char]?.strokes ? JSON.parse(JSON.stringify(this.font[char].strokes)) : [];
        this.history = [JSON.parse(JSON.stringify(this.strokes))];
        this.historyIndex = 0;
        
        document.getElementById('current-char').textContent = char === ' ' ? '(space)' : char;
        document.querySelectorAll('.char-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.char === char);
        });
        
        this.render();
        this.updateStatus(`Drawing: ${char === ' ' ? 'SPACE' : char}`);
    }

    // Update character data in font dictionary
    updateCharacterInFont() {
        if (!this.currentChar) return;

        const bounds = this.calculateBounds(this.strokes);
        this.font[this.currentChar] = {
            strokes: JSON.parse(JSON.stringify(this.strokes)),
            bounds: bounds
        };

        // Update UI
        const btn = Array.from(document.querySelectorAll('.char-button')).find(b => b.dataset.char === this.currentChar);
        if (btn) btn.classList.add('defined');

        this.saveToLocalStorage();
    }

    // Calculate bounding box of strokes
    calculateBounds(strokes) {
        if (!strokes || strokes.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        strokes.forEach(stroke => {
            if (!stroke || stroke.length === 0) return;
            stroke.forEach(point => {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            });
        });
        
        // Handle case where no valid points were found
        if (minX === Infinity || minY === Infinity) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
        }

        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }

    // Render canvas with grid, guides, and strokes
    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw grid
        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= 20; i++) {
            const pos = i * this.gridSize;
            this.ctx.beginPath();
            this.ctx.moveTo(pos, 0);
            this.ctx.lineTo(pos, this.canvas.height);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(0, pos);
            this.ctx.lineTo(this.canvas.width, pos);
            this.ctx.stroke();
        }
        
        // Draw guide lines if enabled
        if (this.showGuides) {
            const ascentY = this.canvas.height * (this.guidePositions.ascent / 100);
            const capHeightY = this.canvas.height * (this.guidePositions.capHeight / 100);
            const xHeightY = this.canvas.height * (this.guidePositions.xHeight / 100);
            const baselineY = this.canvas.height * (this.guidePositions.baseline / 100);
            const descenderY = this.canvas.height * (this.guidePositions.descender / 100);
            
            this.ctx.setLineDash([5, 5]);
            this.ctx.lineWidth = 2;
            this.ctx.font = '12px sans-serif';
            
            // Ascent (purple)
            this.ctx.strokeStyle = 'rgba(128, 0, 128, 0.5)';
            this.ctx.fillStyle = 'rgba(128, 0, 128, 0.7)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, ascentY);
            this.ctx.lineTo(this.canvas.width, ascentY);
            this.ctx.stroke();
            this.ctx.fillText('Ascent', 5, ascentY - 5);
            
            // Cap height (blue)
            this.ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
            this.ctx.fillStyle = 'rgba(0, 0, 255, 0.7)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, capHeightY);
            this.ctx.lineTo(this.canvas.width, capHeightY);
            this.ctx.stroke();
            this.ctx.fillText('Cap', 5, capHeightY - 5);
            
            // X-height (green)
            this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, xHeightY);
            this.ctx.lineTo(this.canvas.width, xHeightY);
            this.ctx.stroke();
            this.ctx.fillText('x-height', 5, xHeightY - 5);
            
            // Baseline (red)
            this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            this.ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, baselineY);
            this.ctx.lineTo(this.canvas.width, baselineY);
            this.ctx.stroke();
            this.ctx.fillText('Baseline', 5, baselineY + 15);
            
            // Descender (orange)
            this.ctx.strokeStyle = 'rgba(255, 165, 0, 0.5)';
            this.ctx.fillStyle = 'rgba(255, 165, 0, 0.7)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, descenderY);
            this.ctx.lineTo(this.canvas.width, descenderY);
            this.ctx.stroke();
            this.ctx.fillText('Descender', 5, descenderY + 15);
            
            this.ctx.setLineDash([]);
        }

        // Draw strokes
        this.ctx.strokeStyle = '#333333';
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.strokes.forEach((stroke, idx) => {
            if (stroke.length < 2) return;
            
            this.ctx.beginPath();
            this.ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let i = 1; i < stroke.length; i++) {
                this.ctx.lineTo(stroke[i].x, stroke[i].y);
            }
            this.ctx.stroke();

            // Draw start point (green) and stroke number
            this.ctx.fillStyle = '#4CAF50';
            this.ctx.beginPath();
            this.ctx.arc(stroke[0].x, stroke[0].y, 4, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw stroke number
            this.ctx.fillStyle = '#4CAF50';
            this.ctx.font = '12px sans-serif';
            this.ctx.fillText(idx + 1, stroke[0].x + 8, stroke[0].y - 8);
            
            // Draw end point (red)
            this.ctx.fillStyle = '#f44336';
            this.ctx.beginPath();
            this.ctx.arc(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    // Clear current character
    clearCharacter() {
        this.strokes = [];
        this.history = [];
        this.historyIndex = -1;
        if (this.currentChar) {
            delete this.font[this.currentChar];
            const btn = Array.from(document.querySelectorAll('.char-button')).find(b => b.dataset.char === this.currentChar);
            if (btn) btn.classList.remove('defined');
        }
        this.render();
        this.saveToLocalStorage();
    }

    // Clear canvas (undo-able)
    clearCanvas() {
        this.strokes = [];
        this.saveToHistory();
        this.render();
    }

    // Save current state to history
    saveToHistory() {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(JSON.parse(JSON.stringify(this.strokes)));
        this.historyIndex++;
        if (this.history.length > 50) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    // Undo last stroke
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.strokes = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
            this.updateCharacterInFont();
            this.render();
        }
    }

    // Redo last undone stroke
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.strokes = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
            this.updateCharacterInFont();
            this.render();
        }
    }

    // Save font to localStorage
    saveFont() {
        this.updateCharacterInFont();
        this.saveToLocalStorage();
        this.updateStatus('Font saved!');
        setTimeout(() => this.updateStatus('Ready'), 2000);
    }

    // Create a new font
    newFont() {
        if (Object.keys(this.font).length > 0) {
            if (!confirm('Starting a new font will clear your current work. Continue?')) {
                return;
            }
        }
        
        this.font = {};
        this.kerning = {};
        this.currentFontId = 'font_' + Date.now();
        document.getElementById('font-name').value = 'New Font';
        this.strokes = [];
        this.currentChar = null;
        this.history = [];
        this.historyIndex = -1;
        
        // Clear UI
        document.querySelectorAll('.char-button').forEach(btn => btn.classList.remove('defined', 'active'));
        document.getElementById('current-char').textContent = '-';
        this.updateKerningList();
        this.render();
        
        this.saveToLocalStorage();
        this.updateFontSelector();
        this.updateStatus('New font created');
    }

    // Delete current font
    deleteFont() {
        if (!this.currentFontId) {
            alert('No font to delete');
            return;
        }
        
        const fontName = document.getElementById('font-name').value;
        if (!confirm(`Delete font "${fontName}"? This cannot be undone.`)) {
            return;
        }
        
        // Get all fonts
        const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
        
        // Delete current font
        delete fonts[this.currentFontId];
        
        // Save updated fonts list
        localStorage.setItem('gcodeFonts', JSON.stringify(fonts));
        
        // Load another font or create new one
        if (Object.keys(fonts).length > 0) {
            const firstFont = Object.values(fonts)[0];
            this.loadFontData(firstFont);
            localStorage.setItem('currentFontId', firstFont.id);
        } else {
            this.newFont();
        }
        
        this.updateFontSelector();
        this.updateStatus(`Font "${fontName}" deleted`);
    }

    // Load font from localStorage list
    loadFontFromList() {
        const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
        const fontList = Object.values(fonts).sort((a, b) => a.name.localeCompare(b.name));
        
        if (fontList.length === 0) {
            alert('No saved fonts found. Create a new font or import one.');
            return;
        }
        
        // Create a simple selection dialog
        let message = 'Select a font to load:\n\n';
        fontList.forEach((font, idx) => {
            message += `${idx + 1}. ${font.name}\n`;
        });
        message += '\nEnter the number of the font to load:';
        
        const selection = prompt(message);
        if (!selection) return;
        
        const index = parseInt(selection) - 1;
        if (index >= 0 && index < fontList.length) {
            const selectedFont = fontList[index];
            this.loadFontData(selectedFont);
            localStorage.setItem('currentFontId', selectedFont.id);
            this.updateStatus(`Loaded font: ${selectedFont.name}`);
        } else {
            alert('Invalid selection');
        }
    }

    // Persist font data to localStorage (multi-font system)
    saveToLocalStorage() {
        // Get all fonts
        const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
        
        // Use current font ID or create new one
        if (!this.currentFontId) {
            this.currentFontId = 'font_' + Date.now();
        }
        
        // Save current font
        fonts[this.currentFontId] = {
            id: this.currentFontId,
            name: document.getElementById('font-name').value,
            font: this.font,
            kerning: this.kerning,
            lastModified: new Date().toISOString()
        };
        
        localStorage.setItem('gcodeFonts', JSON.stringify(fonts));
        localStorage.setItem('currentFontId', this.currentFontId);
        
        this.updateFontSelector();
    }

    // Load font from localStorage
    loadFromLocalStorage() {
        const currentFontId = localStorage.getItem('currentFontId');
        const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
        
        if (currentFontId && fonts[currentFontId]) {
            this.loadFontData(fonts[currentFontId]);
        } else if (Object.keys(fonts).length > 0) {
            // Load the first font if no current font
            const firstFont = Object.values(fonts)[0];
            this.loadFontData(firstFont);
        } else {
            // Create a default font if none exist
            this.newFont();
        }
        
        this.updateFontSelector();
    }

    // Load font data into editor
    loadFontData(fontData) {
        this.currentFontId = fontData.id;
        this.font = fontData.font || {};
        this.kerning = fontData.kerning || {};
        document.getElementById('font-name').value = fontData.name || 'Custom Font';
        
        // Update UI
        document.querySelectorAll('.char-button').forEach(btn => btn.classList.remove('defined'));
        Object.keys(this.font).forEach(char => {
            const btn = Array.from(document.querySelectorAll('.char-button')).find(b => b.dataset.char === char);
            if (btn) btn.classList.add('defined');
        });
        
        this.updateKerningList();
    }

    // Update font selector dropdowns (both editor and text-to-gcode tab)
    updateFontSelector() {
        const editorSelector = document.getElementById('font-selector-editor');
        const gcodeSelector = document.getElementById('font-selector');
        const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
        const currentFontId = localStorage.getItem('currentFontId');
        
        // Update editor selector
        if (editorSelector) {
            editorSelector.innerHTML = '<option value="">Select a font...</option>';
            Object.values(fonts).sort((a, b) => a.name.localeCompare(b.name)).forEach(font => {
                const option = document.createElement('option');
                option.value = font.id;
                option.textContent = font.name;
                if (font.id === currentFontId) {
                    option.selected = true;
                }
                editorSelector.appendChild(option);
            });
        }
        
        // Update text-to-gcode selector
        if (gcodeSelector) {
            gcodeSelector.innerHTML = '<option value="">Select a font...</option>';
            Object.values(fonts).sort((a, b) => a.name.localeCompare(b.name)).forEach(font => {
                const option = document.createElement('option');
                option.value = font.id;
                option.textContent = font.name;
                if (font.id === currentFontId) {
                    option.selected = true;
                }
                gcodeSelector.appendChild(option);
            });
        }
    }

    // Load selected font for GCode generation
    loadSelectedFont() {
        const selector = document.getElementById('font-selector');
        const fontId = selector.value;
        
        if (!fontId) {
            this.updateStatus('Please select a font');
            return;
        }
        
        const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
        if (fonts[fontId]) {
            this.loadFontData(fonts[fontId]);
            this.updateStatus(`Loaded font: ${fonts[fontId].name}`);
        }
    }

    // Export font as JSON file
    exportFont() {
        const fontData = {
            name: document.getElementById('font-name').value,
            font: this.font,
            kerning: this.kerning,
            version: '1.1'
        };

        const blob = new Blob([JSON.stringify(fontData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fontData.name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Preview all characters in font
    previewFont() {
        const modal = document.getElementById('font-preview-modal');
        const canvas = document.getElementById('preview-canvas');
        const ctx = canvas.getContext('2d');
        
        // Get defined characters
        const chars = Object.keys(this.font).sort();
        
        if (chars.length === 0) {
            alert('No characters defined in font');
            return;
        }
        
        // Layout parameters
        const charSize = 80;
        const padding = 20;
        const cols = Math.floor((canvas.width - padding * 2) / (charSize + padding));
        const rows = Math.ceil(chars.length / cols);
        
        // Adjust canvas height to fit all characters (but keep reasonable max)
        canvas.height = Math.min(2400, Math.max(800, padding + rows * (charSize + padding + 20) + padding));
        
        // Clear canvas
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-color');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-color');
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-color');
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        
        // Draw each character
        chars.forEach((char, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const x = padding + col * (charSize + padding);
            const y = padding + row * (charSize + padding + 20);
            
            // Draw character label
            ctx.fillText(char, x + charSize / 2, y + charSize + 15);
            
            // Draw character strokes
            const charData = this.font[char];
            if (!charData || !charData.strokes) return;
            
            const scaleX = charSize / this.canvas.height;
            const scaleY = charSize / this.canvas.height;
            
            charData.strokes.forEach(stroke => {
                if (stroke.length < 2) return;
                
                ctx.beginPath();
                stroke.forEach((point, i) => {
                    const px = x + point.x * scaleX;
                    const py = y + point.y * scaleY;
                    
                    if (i === 0) {
                        ctx.moveTo(px, py);
                    } else {
                        ctx.lineTo(px, py);
                    }
                });
                ctx.stroke();
            });
        });
        
        modal.style.display = 'flex';
    }

    // Import font from JSON file
    importFont(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                
                // Check if font with same ID already exists
                const fonts = JSON.parse(localStorage.getItem('gcodeFonts') || '{}');
                const importedId = data.id;
                
                if (importedId && fonts[importedId]) {
                    // Font with this ID exists - ask user if they want to replace it
                    const existingName = fonts[importedId].name;
                    const importedName = data.name || 'Imported Font';
                    if (!confirm(`A font with ID "${importedId}" already exists (${existingName}).\n\nReplace it with "${importedName}"?`)) {
                        // User cancelled - create new font with different ID
                        this.currentFontId = 'font_' + Date.now();
                    } else {
                        // User confirmed - use existing ID to replace
                        this.currentFontId = importedId;
                    }
                } else if (importedId) {
                    // Font ID doesn't exist yet - use it
                    this.currentFontId = importedId;
                } else {
                    // No ID in imported file - create new one
                    this.currentFontId = 'font_' + Date.now();
                }
                
                this.font = data.font || {};
                this.kerning = data.kerning || {};
                document.getElementById('font-name').value = data.name || 'Imported Font';
                
                // Update UI
                document.querySelectorAll('.char-button').forEach(btn => btn.classList.remove('defined'));
                Object.keys(this.font).forEach(char => {
                    const btn = Array.from(document.querySelectorAll('.char-button')).find(b => b.dataset.char === char);
                    if (btn) btn.classList.add('defined');
                });
                
                this.updateKerningList();
                this.saveToLocalStorage();
                this.updateStatus(`Font loaded: ${data.name || 'Imported Font'}`);
            } catch (err) {
                alert('Error loading font: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // Import SVG font and convert to GCode font format
    importSVGFont(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                // Parse SVG XML
                const parser = new DOMParser();
                const doc = parser.parseFromString(event.target.result, 'image/svg+xml');
                
                // Check for parse errors
                const parserError = doc.querySelector('parsererror');
                if (parserError) {
                    throw new Error('Invalid SVG file');
                }
                
                // Find font element
                const fontElement = doc.querySelector('font');
                if (!fontElement) {
                    throw new Error('No font found in SVG file');
                }
                
                // Get font metrics
                const fontFace = fontElement.querySelector('font-face');
                const unitsPerEm = parseFloat(fontFace?.getAttribute('units-per-em') || '1000');
                const fontFamily = fontFace?.getAttribute('font-family') || 'Imported SVG Font';
                
                // Scale from font units to canvas coordinates
                const canvasHeight = this.canvas.height;
                const scale = canvasHeight / unitsPerEm;
                
                // Parse glyphs
                const glyphs = fontElement.querySelectorAll('glyph');
                const importedFont = {};
                let glyphCount = 0;
                
                glyphs.forEach(glyph => {
                    const unicode = glyph.getAttribute('unicode');
                    if (!unicode || unicode.length === 0) return;
                    
                    const pathData = glyph.getAttribute('d');
                    
                    // Get horizontal advance (spacing to next character)
                    const horizAdvX = parseFloat(glyph.getAttribute('horiz-adv-x') || fontElement.getAttribute('horiz-adv-x') || '1000');
                    
                    // Convert SVG path to strokes (may be empty for space character)
                    const strokes = pathData ? this.parseSVGPath(pathData, scale, canvasHeight) : [];
                    
                    // Calculate bounds for this character (will be zero-size for space)
                    const bounds = strokes.length > 0 ? this.calculateBounds(strokes) : { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
                    
                    importedFont[unicode] = {
                        strokes: strokes,
                        bounds: bounds,
                        horizAdvX: horizAdvX * scale // Store in scaled canvas units
                    };
                    glyphCount++;
                });
                
                if (glyphCount === 0) {
                    throw new Error('No valid glyphs found in SVG font');
                }
                
                // Create new font ID
                this.currentFontId = 'font_' + Date.now();
                this.font = importedFont;
                this.kerning = {}; // SVG font kerning would need separate parsing
                document.getElementById('font-name').value = fontFamily;
                
                // Update UI
                document.querySelectorAll('.char-button').forEach(btn => btn.classList.remove('defined'));
                Object.keys(this.font).forEach(char => {
                    const btn = Array.from(document.querySelectorAll('.char-button')).find(b => b.dataset.char === char);
                    if (btn) btn.classList.add('defined');
                });
                
                this.saveToLocalStorage();
                this.updateStatus(`SVG Font imported: ${fontFamily} (${glyphCount} characters)`);
                
            } catch (err) {
                alert('Error importing SVG font: ' + err.message);
            }
        };
        reader.readAsText(file);
    }
    
    // Parse SVG path data and convert to strokes (supports M, L, Q commands)
    parseSVGPath(pathData, scale, canvasHeight) {
        const strokes = [];
        let currentStroke = [];
        let currentX = 0, currentY = 0;
        let startX = 0, startY = 0;
        
        // Parse path commands
        const commands = pathData.match(/[MmLlHhVvQqTtCcSsAaZz][^MmLlHhVvQqTtCcSsAaZz]*/g);
        if (!commands) return strokes;
        
        commands.forEach(cmd => {
            const type = cmd[0];
            const values = cmd.slice(1).trim().split(/[\s,]+/).filter(v => v).map(parseFloat);
            
            switch (type) {
                case 'M': // Absolute moveto
                    if (currentStroke.length > 0) {
                        strokes.push(currentStroke);
                        currentStroke = [];
                    }
                    currentX = values[0];
                    currentY = values[1];
                    startX = currentX;
                    startY = currentY;
                    currentStroke.push({
                        x: currentX * scale,
                        y: canvasHeight - (currentY * scale) // Flip Y axis
                    });
                    break;
                    
                case 'm': // Relative moveto
                    if (currentStroke.length > 0) {
                        strokes.push(currentStroke);
                        currentStroke = [];
                    }
                    currentX += values[0];
                    currentY += values[1];
                    startX = currentX;
                    startY = currentY;
                    currentStroke.push({
                        x: currentX * scale,
                        y: canvasHeight - (currentY * scale)
                    });
                    break;
                    
                case 'L': // Absolute lineto
                    for (let i = 0; i < values.length; i += 2) {
                        currentX = values[i];
                        currentY = values[i + 1];
                        currentStroke.push({
                            x: currentX * scale,
                            y: canvasHeight - (currentY * scale)
                        });
                    }
                    break;
                    
                case 'l': // Relative lineto
                    for (let i = 0; i < values.length; i += 2) {
                        currentX += values[i];
                        currentY += values[i + 1];
                        currentStroke.push({
                            x: currentX * scale,
                            y: canvasHeight - (currentY * scale)
                        });
                    }
                    break;
                    
                case 'H': // Absolute horizontal lineto
                    values.forEach(x => {
                        currentX = x;
                        currentStroke.push({
                            x: currentX * scale,
                            y: canvasHeight - (currentY * scale)
                        });
                    });
                    break;
                    
                case 'h': // Relative horizontal lineto
                    values.forEach(dx => {
                        currentX += dx;
                        currentStroke.push({
                            x: currentX * scale,
                            y: canvasHeight - (currentY * scale)
                        });
                    });
                    break;
                    
                case 'V': // Absolute vertical lineto
                    values.forEach(y => {
                        currentY = y;
                        currentStroke.push({
                            x: currentX * scale,
                            y: canvasHeight - (currentY * scale)
                        });
                    });
                    break;
                    
                case 'v': // Relative vertical lineto
                    values.forEach(dy => {
                        currentY += dy;
                        currentStroke.push({
                            x: currentX * scale,
                            y: canvasHeight - (currentY * scale)
                        });
                    });
                    break;
                    
                case 'Q': // Absolute quadratic bezier
                    for (let i = 0; i < values.length; i += 4) {
                        const cx = values[i];
                        const cy = values[i + 1];
                        const x = values[i + 2];
                        const y = values[i + 3];
                        
                        // Tessellate quadratic bezier into line segments
                        const steps = 10;
                        for (let t = 1; t <= steps; t++) {
                            const ratio = t / steps;
                            const inv = 1 - ratio;
                            const bx = inv * inv * currentX + 2 * inv * ratio * cx + ratio * ratio * x;
                            const by = inv * inv * currentY + 2 * inv * ratio * cy + ratio * ratio * y;
                            currentStroke.push({
                                x: bx * scale,
                                y: canvasHeight - (by * scale)
                            });
                        }
                        currentX = x;
                        currentY = y;
                    }
                    break;
                    
                case 'q': // Relative quadratic bezier
                    for (let i = 0; i < values.length; i += 4) {
                        const cx = currentX + values[i];
                        const cy = currentY + values[i + 1];
                        const x = currentX + values[i + 2];
                        const y = currentY + values[i + 3];
                        
                        const steps = 10;
                        for (let t = 1; t <= steps; t++) {
                            const ratio = t / steps;
                            const inv = 1 - ratio;
                            const bx = inv * inv * currentX + 2 * inv * ratio * cx + ratio * ratio * x;
                            const by = inv * inv * currentY + 2 * inv * ratio * cy + ratio * ratio * y;
                            currentStroke.push({
                                x: bx * scale,
                                y: canvasHeight - (by * scale)
                            });
                        }
                        currentX = x;
                        currentY = y;
                    }
                    break;
                    
                case 'Z':
                case 'z': // Close path
                    if (currentStroke.length > 0) {
                        // Add line back to start if not already there
                        const lastPoint = currentStroke[currentStroke.length - 1];
                        const firstPoint = currentStroke[0];
                        if (Math.abs(lastPoint.x - firstPoint.x) > 0.1 || Math.abs(lastPoint.y - firstPoint.y) > 0.1) {
                            currentStroke.push({ x: firstPoint.x, y: firstPoint.y });
                        }
                    }
                    currentX = startX;
                    currentY = startY;
                    break;
            }
        });
        
        // Add final stroke
        if (currentStroke.length > 0) {
            strokes.push(currentStroke);
        }
        
        return strokes;
    }

    // Generate GCode from text input with kerning support
    generateGCode() {
        const text = document.getElementById('text-input').value;
        let outputSize = parseFloat(document.getElementById('output-size').value);
        const charSpacing = parseFloat(document.getElementById('char-spacing').value);
        const spaceWidth = parseFloat(document.getElementById('space-width').value);
        const lineGap = parseFloat(document.getElementById('line-spacing').value);
        const maxWidth = parseFloat(document.getElementById('max-width').value);
        const maxHeight = parseFloat(document.getElementById('max-height').value);
        const autoFit = document.getElementById('auto-fit').checked;
        const feedRate = parseFloat(document.getElementById('feed-rate').value);
        const plungeRate = parseFloat(document.getElementById('plunge-rate').value);
        const safeZ = parseFloat(document.getElementById('safe-z').value);
        const engraveDepth = parseFloat(document.getElementById('engrave-depth').value);
        
        // Use consistent scaling based on canvas height
        // All characters scale relative to the full canvas height to preserve relative sizes
        const referenceHeight = this.canvas.height;
        let scale = outputSize / referenceHeight;
        
        // Line spacing = character height + gap between lines
        let lineSpacing = outputSize + lineGap;

        let gcode = [];
        let lastGCodeLine = ''; // Track last line to prevent duplicates
        
        // Helper function to add GCode line only if different from last
        const addGCode = (line) => {
            if (line !== lastGCodeLine) {
                gcode.push(line);
                lastGCodeLine = line;
            }
        };
        
        gcode.push('; GCode Font Creator Output');
        gcode.push(`; Font: ${document.getElementById('font-name').value}`);
        
        // Add text with each line properly commented
        const textLines = text.split('\n');
        if (textLines.length === 1) {
            gcode.push(`; Text: ${text}`);
        } else {
            gcode.push('; Text:');
            textLines.forEach(line => gcode.push(`;   ${line}`));
        }
        
        gcode.push(`; Generated: ${new Date().toISOString()}`);
        gcode.push('');
        gcode.push('G21 ; mm mode');
        gcode.push('G90 ; Absolute positioning');
        gcode.push('G17 ; XY plane');
        gcode.push(`G0 Z${safeZ} F${plungeRate} ; Move to safe Z`);
        lastGCodeLine = `G0 Z${safeZ} F${plungeRate} ; Move to safe Z`; // Initialize tracker
        gcode.push('');

        // Process text with word wrapping if max width is set
        const inputLines = text.split('\n');
        let wrappedLines = [];
        
        if (maxWidth > 0) {
            // Word wrap enabled
            inputLines.forEach(inputLine => {
                const words = inputLine.split(' ');
                let currentLine = '';
                let currentWidth = 0;
                
                words.forEach((word, wordIdx) => {
                    // Calculate word width
                    let wordWidth = 0;
                    for (let i = 0; i < word.length; i++) {
                        const char = word[i];
                        const charData = this.font[char];
                        if (charData) {
                            const bounds = charData.bounds;
                            wordWidth += bounds.width * scale + charSpacing;
                        } else {
                            wordWidth += outputSize * 0.5 + charSpacing;
                        }
                    }
                    
                    // Account for space character width (use configured value)
                    const spaceWidthTotal = spaceWidth + charSpacing;
                    
                    // Check if adding this word exceeds max width
                    if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                        // Start new line
                        wrappedLines.push(currentLine);
                        currentLine = word;
                        currentWidth = wordWidth;
                    } else {
                        // Add word to current line
                        if (currentLine.length > 0) {
                            currentLine += ' ' + word;
                            currentWidth += spaceWidthTotal + wordWidth;
                        } else {
                            currentLine = word;
                            currentWidth = wordWidth;
                        }
                    }
                });
                
                // Add remaining line (including empty lines for blank input lines)
                wrappedLines.push(currentLine);
            });
        } else {
            // No wrapping, use original lines
            wrappedLines.push(...inputLines);
        }

        const lines = wrappedLines;
        
        // Auto-fit: Iteratively find the largest size that fits within constraints
        if (autoFit && (maxWidth > 0 || maxHeight > 0)) {
            const maxTextSize = parseFloat(document.getElementById('max-text-size').value);
            
            // Helper function to calculate dimensions for a given size
            const calculateDimensions = (testSize) => {
                const testScale = testSize / referenceHeight;
                const testLineSpacing = testSize + lineGap;
                
                // Re-wrap text with test size
                const testWrappedLines = [];
                if (maxWidth > 0) {
                    inputLines.forEach(inputLine => {
                        const words = inputLine.split(' ');
                        let currentLine = '';
                        let currentWidth = 0;
                        
                        words.forEach((word) => {
                            let wordWidth = 0;
                            for (let i = 0; i < word.length; i++) {
                                const char = word[i];
                                const charData = this.font[char];
                                if (charData) {
                                    const bounds = charData.bounds;
                                    wordWidth += bounds.width * testScale + charSpacing;
                                } else {
                                    wordWidth += testSize * 0.5 + charSpacing;
                                }
                            }
                            
                            const spaceWidthTotal = spaceWidth + charSpacing;
                            
                            if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                                testWrappedLines.push(currentLine);
                                currentLine = word;
                                currentWidth = wordWidth;
                            } else {
                                if (currentLine.length > 0) {
                                    currentLine += ' ' + word;
                                    currentWidth += spaceWidthTotal + wordWidth;
                                } else {
                                    currentLine = word;
                                    currentWidth = wordWidth;
                                }
                            }
                        });
                        
                        // Add remaining line (including empty lines)
                        testWrappedLines.push(currentLine);
                    });
                } else {
                    testWrappedLines.push(...inputLines);
                }
                
                // Calculate max width and height (accounting for blank line spacing)
                let maxLineWidth = 0;
                testWrappedLines.forEach(line => {
                    let lineWidth = 0;
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        const charData = this.font[char];
                        if (charData) {
                            lineWidth += charData.bounds.width * testScale + charSpacing;
                        } else {
                            lineWidth += (char === ' ' ? spaceWidth : testSize * 0.5) + charSpacing;
                        }
                    }
                    maxLineWidth = Math.max(maxLineWidth, lineWidth);
                });
                
                // Calculate height accounting for blank lines
                let totalHeight = testSize; // First line height
                for (let i = 1; i < testWrappedLines.length; i++) {
                    // Blank lines use 50% of output size, normal lines use full lineSpacing
                    totalHeight += testWrappedLines[i].length === 0 ? testSize * 0.5 : testLineSpacing;
                }
                
                return { width: maxLineWidth, height: totalHeight, wrappedLines: testWrappedLines };
            };
            
            // Iteratively find the largest size that fits
            let bestSize = outputSize;
            let bestWrappedLines = wrappedLines;
            
            // Start with initial size and go up
            for (let testSize = outputSize; testSize <= maxTextSize; testSize += 0.5) {
                const dims = calculateDimensions(testSize);
                
                // Check if it fits
                const fitsWidth = maxWidth <= 0 || dims.width <= maxWidth;
                const fitsHeight = maxHeight <= 0 || dims.height <= maxHeight;
                
                if (fitsWidth && fitsHeight) {
                    bestSize = testSize;
                    bestWrappedLines = dims.wrappedLines;
                } else {
                    // Once it doesn't fit, we've found the max
                    break;
                }
            }
            
            outputSize = bestSize;
            wrappedLines = bestWrappedLines;
            scale = outputSize / referenceHeight;
            lineSpacing = outputSize + lineGap;
        }
        
        // Calculate total height needed to keep all Y values positive (accounting for blank lines)
        let totalHeight = outputSize; // First line height
        for (let i = 1; i < wrappedLines.length; i++) {
            totalHeight += wrappedLines[i].length === 0 ? outputSize * 0.5 : lineSpacing;
        }
        let currentY = totalHeight; // Start at top, will decrease

        wrappedLines.forEach((line, lineIdx) => {
            let currentX = 0;
            
            // Add comment for the line
            gcode.push('');
            gcode.push(`; Line ${lineIdx + 1}: "${line}"`);

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const charData = this.font[char];

                if (!charData) {
                    // Skip undefined characters, but advance X
                    // Use space width for space character, half output size for others
                    currentX += (char === ' ' ? spaceWidth : outputSize * 0.5) + charSpacing;
                    continue;
                }
                
                // Add comment for the character
                gcode.push(`; Character: '${char}'`);

                // Get character bounds (but don't use bounds.height for scaling)
                const bounds = charData.bounds;

                let isAtSafeZ = true; // Track Z position to avoid duplicate moves
                charData.strokes.forEach(stroke => {
                    const segments = this.detectArcs(stroke);
                    console.log(`Character '${char}' segments:`, segments.map(s => s.type));
                    
                    let isFirstSegment = true;
                    segments.forEach(segment => {
                        if (segment.type === 'arc') {
                            // Arc segment - use G2/G3
                            // Transform all points from canvas space to GCode space
                            // Use actual canvas Y coordinates to preserve baseline positioning
                            const startX = (segment.start.x - bounds.minX) * scale + currentX;
                            const startY = currentY - segment.start.y * scale;
                            const endX = (segment.end.x - bounds.minX) * scale + currentX;
                            const endY = currentY - segment.end.y * scale;
                            const centerX = (segment.center.x - bounds.minX) * scale + currentX;
                            const centerY = currentY - segment.center.y * scale;
                            
                            if (isFirstSegment) {
                                if (!isAtSafeZ) {
                                    addGCode(`G0 Z${safeZ}`);
                                }
                                addGCode(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)} F${feedRate}`);
                                addGCode(`G1 Z${engraveDepth} F${plungeRate}`);
                                isFirstSegment = false;
                                isAtSafeZ = false;
                            }
                            
                            // I and J are OFFSETS from start point to center
                            const i = centerX - startX;
                            const j = centerY - startY;
                            const radius = Math.sqrt(i*i + j*j);
                            
                            // Validate arc makes sense
                            const endToCenter = Math.sqrt((endX - centerX)**2 + (endY - centerY)**2);
                            if (Math.abs(radius - endToCenter) > 0.01) {
                                console.warn(`Arc validation failed: start radius ${radius.toFixed(3)} != end radius ${endToCenter.toFixed(3)}`);
                            }
                            
                            // Y-axis is inverted (canvas Y down, GCode Y up), so flip direction
                            // Canvas clockwise becomes GCode counterclockwise (G3) and vice versa
                            const gcode_cmd = segment.clockwise ? 'G3' : 'G2';
                            addGCode(`${gcode_cmd} X${endX.toFixed(3)} Y${endY.toFixed(3)} I${i.toFixed(3)} J${j.toFixed(3)} F${feedRate}`);
                        } else {
                            // Line segment - use G1
                            segment.points.forEach((point, ptIdx) => {
                                const x = (point.x - bounds.minX) * scale + currentX;
                                const y = currentY - point.y * scale;

                                if (isFirstSegment && ptIdx === 0) {
                                    if (!isAtSafeZ) {
                                        addGCode(`G0 Z${safeZ}`);
                                    }
                                    addGCode(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate}`);
                                    addGCode(`G1 Z${engraveDepth} F${plungeRate}`);
                                    isFirstSegment = false;
                                    isAtSafeZ = false;
                                } else {
                                    addGCode(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate}`);
                                }
                            });
                        }
                    });
                    
                    // Pen up after each stroke
                    addGCode(`G0 Z${safeZ}`);
                    isAtSafeZ = true;
                });

                // Apply kerning if next character exists
                let spacing = charSpacing;
                if (i < line.length - 1) {
                    const nextChar = line[i + 1];
                    const kerningKey = char + nextChar;
                    if (this.kerning[kerningKey] !== undefined) {
                        spacing += this.kerning[kerningKey];
                    }
                }
                
                // Use horizontal advance if available (from SVG font), otherwise use visual width
                // horizAdvX is stored in canvas units, so we need to scale it to output size
                const charWidth = charData.horizAdvX !== undefined ? charData.horizAdvX * scale : bounds.width * scale;
                currentX += charWidth + spacing;
            }

            // Use smaller spacing for blank lines (baseline to cap height = 50% of output size)
            const lineAdvance = line.length === 0 ? outputSize * 0.5 : lineSpacing;
            currentY -= lineAdvance; // Move down (decrease Y) for next line
        });

        gcode.push('');
        addGCode(`G0 Z${safeZ} ; Return to safe Z`);
        addGCode('G0 X0 Y0 ; Return to origin');
        gcode.push('M2 ; End program');

        this.generatedGCode = gcode.join('\n');
        this.updateStatus('GCode generated!');
    }

    // Export text as image (PNG) for printing
    exportImage() {
        const text = document.getElementById('text-input').value;
        let outputSize = parseFloat(document.getElementById('output-size').value);
        const charSpacing = parseFloat(document.getElementById('char-spacing').value);
        const spaceWidth = parseFloat(document.getElementById('space-width').value);
        const lineGap = parseFloat(document.getElementById('line-spacing').value);
        const maxWidth = parseFloat(document.getElementById('max-width').value);
        const maxHeight = parseFloat(document.getElementById('max-height').value);
        const autoFit = document.getElementById('auto-fit').checked;
        
        if (!text) {
            alert('Please enter text to export');
            return;
        }

        // Use consistent scaling
        const referenceHeight = this.canvas.height;
        let scale = outputSize / referenceHeight;
        let lineSpacing = outputSize + lineGap;

        // Calculate text dimensions for canvas size
        const inputLines = text.split('\n');
        let wrappedLines = [];
        
        if (maxWidth > 0) {
            inputLines.forEach(inputLine => {
                const words = inputLine.split(' ');
                let currentLine = '';
                let currentWidth = 0;
                
                words.forEach((word, wordIdx) => {
                    let wordWidth = 0;
                    for (let i = 0; i < word.length; i++) {
                        const char = word[i];
                        const charData = this.font[char];
                        if (charData) {
                            const bounds = charData.bounds;
                            wordWidth += bounds.width * scale + charSpacing;
                        } else {
                            wordWidth += outputSize * 0.5 + charSpacing;
                        }
                    }
                    
                    const spaceWidthTotal = spaceWidth + charSpacing;
                    
                    if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                        wrappedLines.push(currentLine);
                        currentLine = word;
                        currentWidth = wordWidth;
                    } else {
                        if (currentLine.length > 0) {
                            currentLine += ' ' + word;
                            currentWidth += spaceWidthTotal + wordWidth;
                        } else {
                            currentLine = word;
                            currentWidth = wordWidth;
                        }
                    }
                });
                
                // Add remaining line (including empty lines)
                wrappedLines.push(currentLine);
            });
        } else {
            wrappedLines.push(...inputLines);
        }

        // Auto-fit: Iteratively find the largest size that fits within constraints
        if (autoFit && (maxWidth > 0 || maxHeight > 0)) {
            const maxTextSize = parseFloat(document.getElementById('max-text-size').value);
            
            // Helper function to calculate dimensions for a given size
            const calculateDimensions = (testSize) => {
                const testScale = testSize / referenceHeight;
                const testLineSpacing = testSize + lineGap;
                
                // Re-wrap text with test size
                const testWrappedLines = [];
                if (maxWidth > 0) {
                    inputLines.forEach(inputLine => {
                        const words = inputLine.split(' ');
                        let currentLine = '';
                        let currentWidth = 0;
                        
                        words.forEach((word) => {
                            let wordWidth = 0;
                            for (let i = 0; i < word.length; i++) {
                                const char = word[i];
                                const charData = this.font[char];
                                if (charData) {
                                    const bounds = charData.bounds;
                                    wordWidth += bounds.width * testScale + charSpacing;
                                } else {
                                    wordWidth += testSize * 0.5 + charSpacing;
                                }
                            }
                            
                            const spaceWidthTotal = spaceWidth + charSpacing;
                            
                            if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                                testWrappedLines.push(currentLine);
                                currentLine = word;
                                currentWidth = wordWidth;
                            } else {
                                if (currentLine.length > 0) {
                                    currentLine += ' ' + word;
                                    currentWidth += spaceWidthTotal + wordWidth;
                                } else {
                                    currentLine = word;
                                    currentWidth = wordWidth;
                                }
                            }
                        });
                        
                        // Add remaining line (including empty lines)
                        testWrappedLines.push(currentLine);
                    });
                } else {
                    testWrappedLines.push(...inputLines);
                }
                
                // Calculate max width and height
                let maxLineWidth = 0;
                testWrappedLines.forEach(line => {
                    let lineWidth = 0;
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        const charData = this.font[char];
                        if (charData) {
                            lineWidth += charData.bounds.width * testScale + charSpacing;
                        } else {
                            lineWidth += (char === ' ' ? spaceWidth : testSize * 0.5) + charSpacing;
                        }
                    }
                    maxLineWidth = Math.max(maxLineWidth, lineWidth);
                });
                
                // Calculate height accounting for blank lines
                let totalHeight = testSize; // First line height
                for (let i = 1; i < testWrappedLines.length; i++) {
                    // Blank lines use 50% of output size, normal lines use full lineSpacing
                    totalHeight += testWrappedLines[i].length === 0 ? testSize * 0.5 : testLineSpacing;
                }
                
                return { width: maxLineWidth, height: totalHeight, wrappedLines: testWrappedLines };
            };
            
            // Iteratively find the largest size that fits
            let bestSize = outputSize;
            let bestWrappedLines = wrappedLines;
            
            // Start with initial size and go up
            for (let testSize = outputSize; testSize <= maxTextSize; testSize += 0.5) {
                const dims = calculateDimensions(testSize);
                
                // Check if it fits
                const fitsWidth = maxWidth <= 0 || dims.width <= maxWidth;
                const fitsHeight = maxHeight <= 0 || dims.height <= maxHeight;
                
                if (fitsWidth && fitsHeight) {
                    bestSize = testSize;
                    bestWrappedLines = dims.wrappedLines;
                } else {
                    // Once it doesn't fit, we've found the max
                    break;
                }
            }
            
            outputSize = bestSize;
            wrappedLines = bestWrappedLines;
            scale = outputSize / referenceHeight;
            lineSpacing = outputSize + lineGap;
        }

        // Calculate total dimensions
        let maxLineWidth = 0;
        wrappedLines.forEach(line => {
            let lineWidth = 0;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const charData = this.font[char];
                if (charData) {
                    lineWidth += charData.bounds.width * scale + charSpacing;
                } else {
                    lineWidth += (char === ' ' ? spaceWidth : outputSize * 0.5) + charSpacing;
                }
            }
            maxLineWidth = Math.max(maxLineWidth, lineWidth);
        });

        // Calculate height accounting for blank lines
        let totalHeight = outputSize; // First line height
        for (let i = 1; i < wrappedLines.length; i++) {
            totalHeight += wrappedLines[i].length === 0 ? outputSize * 0.5 : lineSpacing;
        }
        
        // Add padding
        const padding = 20;
        const canvasWidth = Math.ceil(maxLineWidth + padding * 2);
        const canvasHeight = Math.ceil(totalHeight + padding * 2);

        // Create temporary canvas with high DPI for better quality
        const dpiScale = 3; // 3x resolution for crisp printing
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvasWidth * dpiScale;
        exportCanvas.height = canvasHeight * dpiScale;
        const ctx = exportCanvas.getContext('2d');
        
        // Scale context to match DPI
        ctx.scale(dpiScale, dpiScale);

        // White background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Draw text with anti-aliasing
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.5; // Thinner line for cleaner print output
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        let currentY = padding;

        wrappedLines.forEach((line) => {
            let currentX = padding;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const charData = this.font[char];

                if (!charData) {
                    currentX += (char === ' ' ? spaceWidth : outputSize * 0.5) + charSpacing;
                    continue;
                }

                const bounds = charData.bounds;
                charData.strokes.forEach(stroke => {
                    if (stroke.length < 2) return;
                    
                    ctx.beginPath();
                    const firstPoint = stroke[0];
                    const x0 = (firstPoint.x - bounds.minX) * scale + currentX;
                    const y0 = firstPoint.y * scale + currentY;
                    ctx.moveTo(x0, y0);
                    
                    for (let j = 1; j < stroke.length; j++) {
                        const x = (stroke[j].x - bounds.minX) * scale + currentX;
                        const y = stroke[j].y * scale + currentY;
                        ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                });

                currentX += bounds.width * scale + charSpacing;
            }

            // Use smaller spacing for blank lines (baseline to cap height = 50% of output size)
            const lineAdvance = line.length === 0 ? outputSize * 0.5 : lineSpacing;
            currentY += lineAdvance;
        });

        // Download image
        exportCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const fontName = document.getElementById('font-name').value.replace(/\s+/g, '_');
            a.download = `${fontName}_text.png`;
            a.click();
            URL.revokeObjectURL(url);
        });

        this.updateStatus('Image exported!');
    }

    // Export text as SVG for vector graphics
    exportSVG() {
        const text = document.getElementById('text-input').value;
        let outputSize = parseFloat(document.getElementById('output-size').value);
        const charSpacing = parseFloat(document.getElementById('char-spacing').value);
        const spaceWidth = parseFloat(document.getElementById('space-width').value);
        const lineGap = parseFloat(document.getElementById('line-spacing').value);
        const maxWidth = parseFloat(document.getElementById('max-width').value);
        const maxHeight = parseFloat(document.getElementById('max-height').value);
        const autoFit = document.getElementById('auto-fit').checked;
        
        if (!text) {
            alert('Please enter text to export');
            return;
        }

        // Use consistent scaling
        const referenceHeight = this.canvas.height;
        let scale = outputSize / referenceHeight;
        
        // Calculate actual maximum character height in the font (in canvas coordinates)
        let maxCharHeight = 0;
        for (const char in this.font) {
            const charData = this.font[char];
            if (charData && charData.bounds) {
                maxCharHeight = Math.max(maxCharHeight, charData.bounds.height);
            }
        }
        
        // If no characters have height, fall back to reference height
        if (maxCharHeight === 0) maxCharHeight = referenceHeight;
        
        // Line spacing based on actual character height, not reference canvas height
        // This ensures visual spacing matches the rendered character size
        let actualCharHeightMM = maxCharHeight * scale;
        let lineSpacing = actualCharHeightMM + lineGap;

        // Calculate text dimensions (reuse same wrapping logic as exportImage)
        const inputLines = text.split('\n');
        let wrappedLines = [];
        
        if (maxWidth > 0) {
            inputLines.forEach(inputLine => {
                const words = inputLine.split(' ');
                let currentLine = '';
                let currentWidth = 0;
                
                words.forEach((word) => {
                    let wordWidth = 0;
                    for (let i = 0; i < word.length; i++) {
                        const char = word[i];
                        const charData = this.font[char];
                        if (charData) {
                            const bounds = charData.bounds;
                            wordWidth += bounds.width * scale + charSpacing;
                        } else {
                            wordWidth += outputSize * 0.5 + charSpacing;
                        }
                    }
                    
                    const spaceWidthTotal = spaceWidth + charSpacing;
                    
                    if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                        wrappedLines.push(currentLine);
                        currentLine = word;
                        currentWidth = wordWidth;
                    } else {
                        if (currentLine.length > 0) {
                            currentLine += ' ' + word;
                            currentWidth += spaceWidthTotal + wordWidth;
                        } else {
                            currentLine = word;
                            currentWidth = wordWidth;
                        }
                    }
                });
                
                wrappedLines.push(currentLine);
            });
        } else {
            wrappedLines.push(...inputLines);
        }

        // Auto-fit: same logic as exportImage
        if (autoFit && (maxWidth > 0 || maxHeight > 0)) {
            const maxTextSize = parseFloat(document.getElementById('max-text-size').value);
            
            const calculateDimensions = (testSize) => {
                const testScale = testSize / referenceHeight;
                const testActualCharHeightMM = maxCharHeight * testScale;
                const testLineSpacing = testActualCharHeightMM + lineGap;
                
                const testWrappedLines = [];
                if (maxWidth > 0) {
                    inputLines.forEach(inputLine => {
                        const words = inputLine.split(' ');
                        let currentLine = '';
                        let currentWidth = 0;
                        
                        words.forEach((word) => {
                            let wordWidth = 0;
                            for (let i = 0; i < word.length; i++) {
                                const char = word[i];
                                const charData = this.font[char];
                                if (charData) {
                                    const bounds = charData.bounds;
                                    wordWidth += bounds.width * testScale + charSpacing;
                                } else {
                                    wordWidth += testSize * 0.5 + charSpacing;
                                }
                            }
                            
                            const spaceWidthTotal = spaceWidth + charSpacing;
                            
                            if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                                testWrappedLines.push(currentLine);
                                currentLine = word;
                                currentWidth = wordWidth;
                            } else {
                                if (currentLine.length > 0) {
                                    currentLine += ' ' + word;
                                    currentWidth += spaceWidthTotal + wordWidth;
                                } else {
                                    currentLine = word;
                                    currentWidth = wordWidth;
                                }
                            }
                        });
                        
                        testWrappedLines.push(currentLine);
                    });
                } else {
                    testWrappedLines.push(...inputLines);
                }
                
                let maxLineWidth = 0;
                testWrappedLines.forEach(line => {
                    let lineWidth = 0;
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        const charData = this.font[char];
                        if (charData) {
                            lineWidth += charData.bounds.width * testScale + charSpacing;
                        } else {
                            lineWidth += (char === ' ' ? spaceWidth : testSize * 0.5) + charSpacing;
                        }
                    }
                    maxLineWidth = Math.max(maxLineWidth, lineWidth);
                });
                
                let totalHeight = testSize;
                for (let i = 1; i < testWrappedLines.length; i++) {
                    totalHeight += testWrappedLines[i].length === 0 ? testSize * 0.5 : testLineSpacing;
                }
                
                return { width: maxLineWidth, height: totalHeight, wrappedLines: testWrappedLines };
            };
            
            let bestSize = outputSize;
            let bestWrappedLines = wrappedLines;
            
            for (let testSize = outputSize; testSize <= maxTextSize; testSize += 0.5) {
                const dims = calculateDimensions(testSize);
                const fitsWidth = maxWidth <= 0 || dims.width <= maxWidth;
                const fitsHeight = maxHeight <= 0 || dims.height <= maxHeight;
                
                if (fitsWidth && fitsHeight) {
                    bestSize = testSize;
                    bestWrappedLines = dims.wrappedLines;
                } else {
                    break;
                }
            }
            
            outputSize = bestSize;
            wrappedLines = bestWrappedLines;
            scale = outputSize / referenceHeight;
            actualCharHeightMM = maxCharHeight * scale;
            lineSpacing = actualCharHeightMM + lineGap;
        }

        // Calculate total dimensions
        let maxLineWidth = 0;
        wrappedLines.forEach(line => {
            let lineWidth = 0;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const charData = this.font[char];
                if (charData) {
                    lineWidth += charData.bounds.width * scale + charSpacing;
                } else {
                    lineWidth += (char === ' ' ? spaceWidth : outputSize * 0.5) + charSpacing;
                }
            }
            maxLineWidth = Math.max(maxLineWidth, lineWidth);
        });

        // Recalculate in case scale changed without auto-fit
        actualCharHeightMM = maxCharHeight * scale;
        let totalHeight = actualCharHeightMM;
        for (let i = 1; i < wrappedLines.length; i++) {
            totalHeight += wrappedLines[i].length === 0 ? actualCharHeightMM * 0.5 : lineSpacing;
        }
        
        const padding = 20;
        const mmWidth = maxLineWidth + padding * 2;
        const mmHeight = totalHeight + padding * 2;
        
        // Scale mm to pixels for display (3.78 pixels per mm at 96 DPI, using 4x for better visibility)
        const mmToPixel = 4;
        const canvasWidth = mmWidth * mmToPixel;
        const canvasHeight = mmHeight * mmToPixel;

        // Build SVG with proper scaling
        let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${mmWidth} ${mmHeight}">\n`;
        svg += `  <rect width="100%" height="100%" fill="white"/>\n`;
        svg += `  <g stroke="black" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round" fill="none">\n`;

        let currentY = padding;

        wrappedLines.forEach((line) => {
            let currentX = padding;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const charData = this.font[char];

                if (!charData) {
                    currentX += (char === ' ' ? spaceWidth : outputSize * 0.5) + charSpacing;
                    continue;
                }

                const bounds = charData.bounds;
                charData.strokes.forEach(stroke => {
                    if (stroke.length < 2) return;
                    
                    let pathData = '';
                    const firstPoint = stroke[0];
                    const x0 = (firstPoint.x - bounds.minX) * scale + currentX;
                    const y0 = firstPoint.y * scale + currentY;
                    pathData += `M ${x0.toFixed(2)} ${y0.toFixed(2)}`;
                    
                    for (let j = 1; j < stroke.length; j++) {
                        const x = (stroke[j].x - bounds.minX) * scale + currentX;
                        const y = stroke[j].y * scale + currentY;
                        pathData += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
                    }
                    
                    svg += `    <path d="${pathData}"/>\n`;
                });

                currentX += bounds.width * scale + charSpacing;
            }

            const lineAdvance = line.length === 0 ? outputSize * 0.5 : lineSpacing;
            currentY += lineAdvance;
        });

        svg += `  </g>\n`;
        svg += `</svg>`;

        // Download SVG
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fontName = document.getElementById('font-name').value.replace(/\s+/g, '_');
        a.download = `${fontName}_text.svg`;
        a.click();
        URL.revokeObjectURL(url);

        this.updateStatus('SVG exported!');
    }

    // Export text as DXF for CAD/CAM software
    exportDXF() {
        const text = document.getElementById('text-input').value;
        let outputSize = parseFloat(document.getElementById('output-size').value);
        const charSpacing = parseFloat(document.getElementById('char-spacing').value);
        const spaceWidth = parseFloat(document.getElementById('space-width').value);
        const lineGap = parseFloat(document.getElementById('line-spacing').value);
        const maxWidth = parseFloat(document.getElementById('max-width').value);
        const maxHeight = parseFloat(document.getElementById('max-height').value);
        const autoFit = document.getElementById('auto-fit').checked;
        
        if (!text) {
            alert('Please enter text to export');
            return;
        }

        // Use consistent scaling
        const referenceHeight = this.canvas.height;
        let scale = outputSize / referenceHeight;
        
        // Calculate actual maximum character height in the font (in canvas coordinates)
        let maxCharHeight = 0;
        for (const char in this.font) {
            const charData = this.font[char];
            if (charData && charData.bounds) {
                maxCharHeight = Math.max(maxCharHeight, charData.bounds.height);
            }
        }
        
        // If no characters have height, fall back to reference height
        if (maxCharHeight === 0) maxCharHeight = referenceHeight;
        
        // Line spacing based on actual character height, not reference canvas height
        let actualCharHeightMM = maxCharHeight * scale;
        let lineSpacing = actualCharHeightMM + lineGap;

        // Calculate text dimensions (same wrapping logic)
        const inputLines = text.split('\n');
        let wrappedLines = [];
        
        if (maxWidth > 0) {
            inputLines.forEach(inputLine => {
                const words = inputLine.split(' ');
                let currentLine = '';
                let currentWidth = 0;
                
                words.forEach((word) => {
                    let wordWidth = 0;
                    for (let i = 0; i < word.length; i++) {
                        const char = word[i];
                        const charData = this.font[char];
                        if (charData) {
                            const bounds = charData.bounds;
                            wordWidth += bounds.width * scale + charSpacing;
                        } else {
                            wordWidth += outputSize * 0.5 + charSpacing;
                        }
                    }
                    
                    const spaceWidthTotal = spaceWidth + charSpacing;
                    
                    if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                        wrappedLines.push(currentLine);
                        currentLine = word;
                        currentWidth = wordWidth;
                    } else {
                        if (currentLine.length > 0) {
                            currentLine += ' ' + word;
                            currentWidth += spaceWidthTotal + wordWidth;
                        } else {
                            currentLine = word;
                            currentWidth = wordWidth;
                        }
                    }
                });
                
                wrappedLines.push(currentLine);
            });
        } else {
            wrappedLines.push(...inputLines);
        }

        // Auto-fit logic
        if (autoFit && (maxWidth > 0 || maxHeight > 0)) {
            const maxTextSize = parseFloat(document.getElementById('max-text-size').value);
            
            const calculateDimensions = (testSize) => {
                const testScale = testSize / referenceHeight;
                const testLineSpacing = testSize + lineGap;
                
                const testWrappedLines = [];
                if (maxWidth > 0) {
                    inputLines.forEach(inputLine => {
                        const words = inputLine.split(' ');
                        let currentLine = '';
                        let currentWidth = 0;
                        
                        words.forEach((word) => {
                            let wordWidth = 0;
                            for (let i = 0; i < word.length; i++) {
                                const char = word[i];
                                const charData = this.font[char];
                                if (charData) {
                                    const bounds = charData.bounds;
                                    wordWidth += bounds.width * testScale + charSpacing;
                                } else {
                                    wordWidth += testSize * 0.5 + charSpacing;
                                }
                            }
                            
                            const spaceWidthTotal = spaceWidth + charSpacing;
                            
                            if (currentLine.length > 0 && currentWidth + spaceWidthTotal + wordWidth > maxWidth) {
                                testWrappedLines.push(currentLine);
                                currentLine = word;
                                currentWidth = wordWidth;
                            } else {
                                if (currentLine.length > 0) {
                                    currentLine += ' ' + word;
                                    currentWidth += spaceWidthTotal + wordWidth;
                                } else {
                                    currentLine = word;
                                    currentWidth = wordWidth;
                                }
                            }
                        });
                        
                        testWrappedLines.push(currentLine);
                    });
                } else {
                    testWrappedLines.push(...inputLines);
                }
                
                let maxLineWidth = 0;
                testWrappedLines.forEach(line => {
                    let lineWidth = 0;
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        const charData = this.font[char];
                        if (charData) {
                            lineWidth += charData.bounds.width * testScale + charSpacing;
                        } else {
                            lineWidth += (char === ' ' ? spaceWidth : testSize * 0.5) + charSpacing;
                        }
                    }
                    maxLineWidth = Math.max(maxLineWidth, lineWidth);
                });
                
                const testActualCharHeightMM = maxCharHeight * testScale;
                let totalHeight = testActualCharHeightMM;
                for (let i = 1; i < testWrappedLines.length; i++) {
                    totalHeight += testWrappedLines[i].length === 0 ? testActualCharHeightMM * 0.5 : testLineSpacing;
                }
                
                return { width: maxLineWidth, height: totalHeight, wrappedLines: testWrappedLines };
            };
            
            let bestSize = outputSize;
            let bestWrappedLines = wrappedLines;
            
            for (let testSize = outputSize; testSize <= maxTextSize; testSize += 0.5) {
                const dims = calculateDimensions(testSize);
                const fitsWidth = maxWidth <= 0 || dims.width <= maxWidth;
                const fitsHeight = maxHeight <= 0 || dims.height <= maxHeight;
                
                if (fitsWidth && fitsHeight) {
                    bestSize = testSize;
                    bestWrappedLines = dims.wrappedLines;
                } else {
                    break;
                }
            }
            
            outputSize = bestSize;
            wrappedLines = bestWrappedLines;
            scale = outputSize / referenceHeight;
            actualCharHeightMM = maxCharHeight * scale;
            lineSpacing = actualCharHeightMM + lineGap;
        }

        // Calculate total height for Y-axis flipping
        // Recalculate in case scale changed without auto-fit
        actualCharHeightMM = maxCharHeight * scale;
        let totalHeight = actualCharHeightMM;
        for (let i = 1; i < wrappedLines.length; i++) {
            totalHeight += wrappedLines[i].length === 0 ? actualCharHeightMM * 0.5 : lineSpacing;
        }

        // Build DXF file
        let dxf = '';
        
        // DXF Header
        dxf += '0\nSECTION\n';
        dxf += '2\nHEADER\n';
        dxf += '9\n$INSUNITS\n70\n4\n'; // Units: 4 = mm
        dxf += '0\nENDSEC\n';
        
        // DXF Entities
        dxf += '0\nSECTION\n';
        dxf += '2\nENTITIES\n';

        let currentY = 0;
        let handleCounter = 100; // DXF handle counter

        wrappedLines.forEach((line) => {
            let currentX = 0;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const charData = this.font[char];

                if (!charData) {
                    currentX += (char === ' ' ? spaceWidth : outputSize * 0.5) + charSpacing;
                    continue;
                }

                const bounds = charData.bounds;
                charData.strokes.forEach(stroke => {
                    if (stroke.length < 2) return;
                    
                    // Use LWPOLYLINE for efficiency
                    dxf += '0\nLWPOLYLINE\n';
                    dxf += `5\n${(handleCounter++).toString(16).toUpperCase()}\n`; // Handle
                    dxf += '100\nAcDbEntity\n';
                    dxf += '8\n0\n'; // Layer 0
                    dxf += '100\nAcDbPolyline\n';
                    dxf += `90\n${stroke.length}\n`; // Vertex count
                    dxf += '70\n0\n'; // Open polyline
                    
                    stroke.forEach(point => {
                        const x = (point.x - bounds.minX) * scale + currentX;
                        // Flip Y coordinate: DXF Y-axis points up, canvas Y-axis points down
                        const y = totalHeight - (point.y * scale + currentY);
                        dxf += `10\n${x.toFixed(4)}\n`; // X coordinate
                        dxf += `20\n${y.toFixed(4)}\n`; // Y coordinate
                    });
                });

                currentX += bounds.width * scale + charSpacing;
            }

            const lineAdvance = line.length === 0 ? outputSize * 0.5 : lineSpacing;
            currentY += lineAdvance;
        });

        // DXF Footer
        dxf += '0\nENDSEC\n';
        dxf += '0\nEOF\n';

        // Download DXF
        const blob = new Blob([dxf], { type: 'application/dxf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fontName = document.getElementById('font-name').value.replace(/\s+/g, '_');
        a.download = `${fontName}_text.dxf`;
        a.click();
        URL.revokeObjectURL(url);

        this.updateStatus('DXF exported!');
    }

    // Download generated GCode as file
    downloadGCode() {
        if (!this.generatedGCode) {
            alert('Please generate GCode first');
            return;
        }

        const blob = new Blob([this.generatedGCode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'font_output.gcode';
        a.click();
        URL.revokeObjectURL(url);
    }

    // Export font as SVG Font format (for use in Inkscape, Safari, etc.)
    exportSVGFont() {
        if (Object.keys(this.font).length === 0) {
            alert('No characters in font. Please draw some characters first.');
            return;
        }

        const fontName = document.getElementById('font-name').value || 'CustomFont';
        const fontId = fontName.replace(/\s+/g, '_').toLowerCase();
        
        // SVG fonts use units-per-em coordinate system (typically 1000)
        const unitsPerEm = 1000;
        const ascent = 800;  // Typical ascent
        const descent = -200; // Typical descent
        
        // Calculate scale from canvas coordinates to font units
        const canvasHeight = this.canvas.height;
        const scale = unitsPerEm / canvasHeight;
        
        // Add spacing between characters (as percentage of em)
        const sideBearings = unitsPerEm * 0.1; // 10% spacing on each side
        
        // Calculate average character width for default horiz-adv-x
        let totalWidth = 0;
        let charCount = 0;
        for (const char in this.font) {
            const charData = this.font[char];
            if (charData && charData.bounds) {
                totalWidth += charData.bounds.width * scale + sideBearings;
                charCount++;
            }
        }
        const avgWidth = charCount > 0 ? Math.round(totalWidth / charCount) : 500;
        
        // Build SVG font
        let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg">\n`;
        svg += `  <defs>\n`;
        svg += `    <font id="${fontId}" horiz-adv-x="${avgWidth}">\n`;
        svg += `      <font-face font-family="${fontName}" units-per-em="${unitsPerEm}" ascent="${ascent}" descent="${descent}"/>\n`;
        svg += `      <missing-glyph horiz-adv-x="500"/>\n`;
        
        // Add each character as a glyph
        for (const char in this.font) {
            const charData = this.font[char];
            if (!charData || !charData.strokes || charData.strokes.length === 0) continue;
            
            const bounds = charData.bounds;
            // Add side bearings (spacing) to character advance width
            const horizAdvX = Math.round(bounds.width * scale + sideBearings);
            
            // Build path data for this glyph
            let pathData = '';
            charData.strokes.forEach(stroke => {
                if (stroke.length < 2) return;
                
                // Convert first point
                const firstPoint = stroke[0];
                const x0 = (firstPoint.x - bounds.minX) * scale;
                // Flip Y axis: SVG fonts use bottom-left origin, canvas uses top-left
                const y0 = (canvasHeight - firstPoint.y) * scale;
                pathData += `M ${x0.toFixed(1)} ${y0.toFixed(1)} `;
                
                // Convert remaining points
                for (let i = 1; i < stroke.length; i++) {
                    const x = (stroke[i].x - bounds.minX) * scale;
                    const y = (canvasHeight - stroke[i].y) * scale;
                    pathData += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
                }
            });
            
            // Escape special XML characters in unicode attribute
            const unicodeAttr = char.replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;')
                                    .replace(/"/g, '&quot;')
                                    .replace(/'/g, '&apos;');
            
            svg += `      <glyph unicode="${unicodeAttr}" horiz-adv-x="${horizAdvX}" d="${pathData.trim()}"/>\n`;
        }
        
        // Add kerning pairs if any exist
        if (Object.keys(this.kerning).length > 0) {
            for (const pair in this.kerning) {
                if (pair.length === 2) {
                    const u1 = pair[0].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
                    const u2 = pair[1].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
                    // Kerning value needs to be scaled and negated (SVG font kerning convention)
                    const kernValue = Math.round(-this.kerning[pair] * scale);
                    svg += `      <hkern u1="${u1}" u2="${u2}" k="${kernValue}"/>\n`;
                }
            }
        }
        
        svg += `    </font>\n`;
        svg += `  </defs>\n`;
        svg += `</svg>`;
        
        // Download SVG font file
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fontName.replace(/\s+/g, '_')}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.updateStatus('SVG Font exported! Note: SVG fonts work in Safari, Inkscape, and Illustrator.');
    }

    // Toggle typography guide lines
    toggleGuides() {
        this.showGuides = !this.showGuides;
        this.render();
    }

    // Update guide line position
    updateGuidePosition(guide, value) {
        this.guidePositions[guide] = value;
        this.render();
    }

    // Reset guide positions to defaults
    resetGuidePositions() {
        this.guidePositions = { ascent: 15, capHeight: 25, xHeight: 45, baseline: 75, descender: 85 };
        this.updateGuidePositionInputs();
        this.render();
    }

    // Update guide position input values (called when loading font)
    updateGuidePositionInputs() {
        document.getElementById('ascent-pos').value = this.guidePositions.ascent;
        document.getElementById('cap-height-pos').value = this.guidePositions.capHeight;
        document.getElementById('x-height-pos').value = this.guidePositions.xHeight;
        document.getElementById('baseline-pos').value = this.guidePositions.baseline;
        document.getElementById('descender-pos').value = this.guidePositions.descender;
    }

    // Add kerning pair
    addKerning() {
        const pair = document.getElementById('kerning-pair').value;
        const value = parseFloat(document.getElementById('kerning-value').value);
        
        if (pair.length !== 2) {
            alert('Please enter exactly 2 characters');
            return;
        }
        
        this.kerning[pair] = value;
        this.updateKerningList();
        this.saveToLocalStorage();
        document.getElementById('kerning-pair').value = '';
    }

    // Update kerning list UI
    updateKerningList() {
        const list = document.getElementById('kerning-list');
        list.innerHTML = '';
        
        Object.entries(this.kerning).forEach(([pair, value]) => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 5px; border-bottom: 1px solid var(--border-color);';
            item.innerHTML = `
                <span><strong>${pair}</strong>: ${value}mm</span>
                <button onclick="fontCreatorController.removeKerning('${pair}')" style="padding: 2px 8px; font-size: 11px;">✖</button>
            `;
            list.appendChild(item);
        });
    }

    // Remove kerning pair
    removeKerning(pair) {
        delete this.kerning[pair];
        this.updateKerningList();
        this.saveToLocalStorage();
    }

    // Update status message
    updateStatus(message) {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = message;
    }
}
