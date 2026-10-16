/**
 * GCode Parser Module
 * Streams and parses GCode files with modal state tracking and adaptive arc tessellation
 */

class GCodeParser {
    constructor() {
        // Machine values (e.g. from a FluidNC config.yaml via parseFluidNCConfig) used when
        // expanding parametric files. Kept across files, so not part of reset().
        this.machineValues = null;
        // User-entered values for parameters set outside the file (FluidNC globals such as
        // #<_tool_radius>), keyed like machineValues. Only fill in what nothing else sets.
        this.inputValues = {};
        this.reset();
    }

    reset() {
        // Modal state
        this.position = { x: 0, y: 0, z: 0 };
        this.units = 'mm'; // mm or inches
        this.absolute = true; // G90/G91
        this.plane = 'XY'; // G17/G18/G19
        this.feedRate = 0;
        this.currentTool = 1; // Start at Tool 1
        this.motionMode = null; // 0, 1, 2, 3 or 38 (G38.x probe) - modal command

        // Work offsets. Segments are drawn in the frame of the file's starting work
        // coordinate system, so a job that never changes offsets draws exactly as written.
        // `position` is in that frame; a line's coordinates are relative to the active
        // work offset: wcsOffsets[wcs] (G54-G59.3, set by G10 L2/L20) plus g92 (G92).
        this.wcs = 1; // 1 = G54 ... 6 = G59, 7-9 = G59.1-G59.3
        this.wcsOffsets = Array.from({ length: 10 }, () => ({ x: 0, y: 0, z: 0 }));
        this.g92 = { x: 0, y: 0, z: 0 };
        this.g92Saved = null; // G92.2 suspends G92, G92.3 restores it
        this.lineMachineCoords = false; // G53 on the current line

        // Tool names extracted from comments
        this.toolNames = [];
        this.toolColors = []; // Custom colors for tools (hex format)
        this.parsingToolList = false;
        this.inlineToolMap = new Map(); // Maps tool number to array of sequential indices for inline format
        this.inlineToolOccurrence = new Map(); // Tracks which occurrence of each tool number we're on
        this.lastToolChangeType = null; // 'M0' for manual, 'M6' for automatic, null for none
        
        // Parametric expansion info for the last parse (null for plain G-code)
        this.expansion = null;

        // Output
        this.segments = [];
        this.bounds = {
            minX: Infinity, maxX: -Infinity,
            minY: Infinity, maxY: -Infinity,
            minZ: Infinity, maxZ: -Infinity
        };
    }

    /**
     * Parse GCode file with progress callbacks
     * @param {File} file - File object from input
     * @param {Function} onProgress - Callback (percent)
     * @returns {Promise<Array>} Array of segments
     */
    async parseString(gcodeString, onProgress) {
        this.reset();

        // Expand parametric G-code (variables, O-word if/while) into plain moves.
        // Segment lineNum values then refer to lines of expansion.output, and
        // expansion.sourceMap maps those back to lines of the original source.
        if (typeof isParametricGCode === 'function' && isParametricGCode(gcodeString)) {
            const sourceLines = gcodeString.split(/\r?\n/);
            try {
                const result = expandLines(sourceLines, 'parametric source', {
                    keepComments: true,
                    machineValues: this.machineValues,
                    inputs: this.inputValues
                });
                this.expansion = {
                    sourceText: gcodeString,
                    output: result.output,
                    sourceMap: result.sourceMap,
                    warnings: result.warnings,
                    external: result.external,
                    error: null
                };
                gcodeString = result.output;
            } catch (e) {
                console.error('Failed to expand parametric G-code:', e);
                this.expansion = {
                    sourceText: gcodeString,
                    output: null,
                    sourceMap: null,
                    warnings: [],
                    external: [],
                    error: e.message
                };
            }
        }

        const lines = gcodeString.split('\n');
        const totalLines = lines.length;
        
        for (let i = 0; i < totalLines; i++) {
            this.parseLine(lines[i].trim(), i + 1);
            
            // Report progress periodically
            if (onProgress && i % 1000 === 0) {
                onProgress(Math.min(100, ((i + 1) / totalLines) * 100));
            }
        }
        
        // Final progress update
        if (onProgress) {
            onProgress(100);
        }
        
        return this.segments;
    }

    /**
     * Parse GCode file
     * @param {File} file - File object to parse
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Array>} Array of segments
     */
    async parseFile(file, onProgress) {
        this.reset();
        
        // Read entire file as text to avoid chunking issues
        // Modern browsers can handle files up to 10MB+ easily
        const text = await file.text();
        
        // Use the string parser which is more reliable
        return this.parseString(text, onProgress);
    }

    /**
     * Read chunk from file
     */
    readChunk(file, offset, length) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            const blob = file.slice(offset, offset + length);
            
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(blob);
        });
    }

    /**
     * Parse single line of GCode
     */
    parseLine(line, lineNum) {
        // Check for tool list in comments
        if (line.startsWith(';') || line.startsWith('(')) {
            const comment = line.replace(/^[;(]/, '').replace(/\)$/, '').trim();
            
            // Check for inline tool definition: (Tool N: tool name)
            const inlineToolMatch = comment.match(/^Tool\s+(\d+)\s*:\s*(.+)$/i);
            if (inlineToolMatch) {
                // First inline tool - add "No Tool" at index 0 and reset currentTool
                if (this.toolNames.length === 0) {
                    this.toolNames.push('No Tool');
                    this.toolColors.push(null);
                    this.currentTool = 0; // Start at 0 for inline format
                }
                
                const toolNum = parseInt(inlineToolMatch[1]);
                const toolName = inlineToolMatch[2].trim();
                
                // Extract hex color if present (format: #RRGGBB)
                const hexMatch = toolName.match(/#([0-9A-Fa-f]{6})\b/);
                const cleanToolName = hexMatch ? toolName.replace(/#[0-9A-Fa-f]{6}\b/, '').trim() : toolName;
                const color = hexMatch ? '#' + hexMatch[1] : null;
                
                // Track which sequential index this tool number maps to
                if (!this.inlineToolMap.has(toolNum)) {
                    this.inlineToolMap.set(toolNum, []);
                }
                
                const occurrences = this.inlineToolMap.get(toolNum);
                const sequentialIndex = this.toolNames.length; // Tool 0 is at index 0, so this starts at 1
                occurrences.push(sequentialIndex);
                
                if (occurrences.length === 1) {
                    this.toolNames.push(`Tool ${toolNum}: ${cleanToolName}`);
                } else {
                    this.toolNames.push(`Tool ${toolNum}: ${cleanToolName} (${occurrences.length})`);
                }
                this.toolColors.push(color);
                
                return;
            }
            
            // Check if we're starting the tool list (Estlcam format)
            if (/required tools?:/i.test(comment)) {
                this.parsingToolList = true;
                return;
            }
            
            // If we're in the tool list, capture tool names
            if (this.parsingToolList) {
                // Stop parsing tool list if we hit an empty comment or non-tool comment
                if (!comment || comment.length === 0) {
                    this.parsingToolList = false;
                    return;
                }
                // Add tool name if it looks like a tool description
                if (comment.length > 0 && !comment.toLowerCase().includes('required')) {
                    // Extract hex color if present (format: #RRGGBB)
                    const hexMatch = comment.match(/#([0-9A-Fa-f]{6})\b/);
                    
                    if (hexMatch) {
                        this.toolColors.push('#' + hexMatch[1]);
                        // Remove color from tool name
                        const cleanName = comment.replace(/#[0-9A-Fa-f]{6}\b/, '').trim();
                        this.toolNames.push(cleanName);
                    } else {
                        this.toolColors.push(null); // No custom color
                        this.toolNames.push(comment);
                    }
                }
                return;
            }
            return; // Skip other comment lines
        }
        
        if (!line || line.startsWith('%')) {
            return; // Skip empty lines and program boundaries
        }
        
        // Check for M0 with "tool" in comment (manual tool change)
        const originalLine = line;
        const hasM0 = /M0\b/i.test(line);
        const commentMatch = originalLine.match(/[;(](.*)$/);
        const comment = commentMatch ? commentMatch[1].toLowerCase() : '';
        
        if (hasM0 && comment.includes('tool')) {
            // Manual tool change detected - increment tool number (Estlcam format)
            // This happens BEFORE any segments on this line, so next segments use new tool
            this.currentTool++;
            this.lastToolChangeType = 'M0';
        }
        
        // Remove inline comments
        line = line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
        if (!line) return;
        
        // Extract words (letter + number pairs)
        const words = this.extractWords(line);
        if (words.length === 0) return;
        
        // Process commands. motionProcessed: the line's axis words have been used, either by
        // a motion command or by a command that takes axis words as arguments (G10, G28,
        // G30, G92), so the modal motion mode must not turn them into a move.
        let motionProcessed = false;
        this.lineMachineCoords = words.some(([letter, value]) => letter === 'G' && value === 53);
        // A feed rate applies to the move on its own line, wherever the F word is
        const feedWord = words.find(([letter]) => letter === 'F');
        if (feedWord) this.feedRate = feedWord[1];

        for (const [letter, value] of words) {
            switch (letter) {
                case 'G':
                    const gcode = Math.floor(value);
                    if (gcode <= 3 || gcode === 38 || gcode === 10 || gcode === 28 || gcode === 30 || gcode === 92) {
                        motionProcessed = true;
                    }
                    this.processGCode(gcode, words, lineNum, value);
                    break;
                case 'M':
                    this.processMCode(Math.floor(value), words, lineNum);
                    break;
                case 'T':
                    const toolNum = Math.floor(value);
                    
                    // If using inline tool format, map tool number to sequential index
                    if (this.inlineToolMap.size > 0 && this.inlineToolMap.has(toolNum)) {
                        const occurrences = this.inlineToolMap.get(toolNum);
                        
                        // Track which occurrence of this tool number we're using
                        const currentOccurrence = this.inlineToolOccurrence.get(toolNum) || 0;
                        const occurrenceIndex = Math.min(currentOccurrence, occurrences.length - 1);
                        
                        this.currentTool = occurrences[occurrenceIndex];
                        this.inlineToolOccurrence.set(toolNum, currentOccurrence + 1);
                    } else {
                        // Standard sequential tool numbering (Estlcam style)
                        this.currentTool = toolNum;
                    }
                    break;
            }
        }
        
        // If no motion was processed but we have a modal motion mode, apply it to any coordinates
        if (!motionProcessed && this.motionMode !== null) {
            // Check if position coordinates are present (X/Y/Z)
            const hasPositionCoords = words.some(([letter]) => 
                letter === 'X' || letter === 'Y' || letter === 'Z'
            );
            
            if (hasPositionCoords) {
                // Only apply modal motion for linear and probe moves (G0/G1/G38.x)
                // Arc moves (G2/G3) require explicit I/J/K parameters each time
                if (this.motionMode === 0 || this.motionMode === 1 || this.motionMode === 38) {
                    this.processGCode(this.motionMode, words, lineNum);
                } else if (this.motionMode === 2 || this.motionMode === 3) {
                    // For arcs, check if I/J/K parameters are present
                    const hasArcParams = words.some(([letter]) => 
                        letter === 'I' || letter === 'J' || letter === 'K'
                    );
                    if (hasArcParams) {
                        this.processGCode(this.motionMode, words, lineNum);
                    }
                }
            }
        }
    }

    /**
     * Extract word pairs from line
     */
    extractWords(line) {
        const words = [];
        const regex = /([A-Z])([+-]?\d+\.?\d*)/gi;
        let match;
        
        while ((match = regex.exec(line)) !== null) {
            words.push([match[1].toUpperCase(), parseFloat(match[2])]);
        }
        
        return words;
    }

    /**
     * Process M-code command
     */
    processMCode(code, words, lineNum) {
        switch (code) {
            case 6: // Tool change
                // Tool number is typically set by T command before M6
                // currentTool is already updated by T command
                this.lastToolChangeType = 'M6';
                break;
        }
    }

    /**
     * Process G-code command
     */
    processGCode(code, words, lineNum, value = code) {
        // Sub-codes: G38.2, G59.1, G92.1, ... (tenths, rounded against float noise)
        const sub = Math.round((value - code) * 10);
        switch (code) {
            case 38: // Probe toward the target, stopping at contact (G38.2-G38.5).
                // Where it touches isn't known, so the full programmed move is drawn.
                if (sub < 2 || sub > 5) return false;
                this.motionMode = 38;
                return this.linearMove(words, 'probe', lineNum);
            case 10: // Set work offsets
                return this.setWorkOffset(words);
            case 28: // Go to the stored G28/G30 position, via an intermediate point
            case 30:
                // G28.1 / G30.1 store the position; the stored position itself isn't
                // known, so only the move to the intermediate point is drawn
                if (sub === 0) this.linearMove(words, 'rapid', lineNum);
                return false;
            case 92:
                this.setG92(sub, words);
                return false;
            case 54: case 55: case 56: case 57: case 58:
                this.wcs = code - 53;
                return false;
            case 59: // G59, G59.1, G59.2, G59.3
                this.wcs = 6 + Math.min(sub, 3);
                return false;
            case 0: // Rapid move
                this.motionMode = 0;
                return this.linearMove(words, 'rapid', lineNum);
            case 1: // Linear move
                this.motionMode = 1;
                return this.linearMove(words, 'cut', lineNum);
            case 2: // Clockwise arc
                this.motionMode = 2;
                return this.arcMove(words, 'cw', lineNum);
            case 3: // Counter-clockwise arc
                this.motionMode = 3;
                return this.arcMove(words, 'ccw', lineNum);
            case 17: // XY plane
                this.plane = 'XY';
                return false;
            case 18: // ZX plane
                this.plane = 'ZX';
                return false;
            case 19: // YZ plane
                this.plane = 'YZ';
                return false;
            case 20: // Inches
                this.units = 'inches';
                return false;
            case 21: // Millimeters
                this.units = 'mm';
                return false;
            case 90: // Absolute positioning
                this.absolute = true;
                return false;
            case 91: // Relative positioning
                this.absolute = false;
                return false;
            default:
                return false;
        }
    }

    /**
     * Total offset of the active work coordinate system from the drawing frame
     */
    workOffset() {
        const w = this.wcsOffsets[this.wcs];
        return { x: w.x + this.g92.x, y: w.y + this.g92.y, z: w.z + this.g92.z };
    }

    /**
     * G10 L2 Pn: set coordinate system n's offset to the given values.
     * G10 L20 Pn: set it so the current position has the given coordinates in system n.
     * P0 (or no P) is the active system. Axes that aren't given keep their offset.
     * The tool doesn't move; later coordinates are read against the new offset.
     */
    setWorkOffset(words) {
        const word = (letter) => { const w = words.find(([l]) => l === letter); return w ? w[1] : null; };
        const l = word('L'), p = Math.round(word('P') || 0);
        if ((l !== 2 && l !== 20) || p < 0 || p > 9) return false;
        const offset = this.wcsOffsets[p || this.wcs];
        for (const [letter, value] of words) {
            const axis = letter.toLowerCase();
            if (axis !== 'x' && axis !== 'y' && axis !== 'z') continue;
            offset[axis] = l === 2 ? value : this.position[axis] - this.g92[axis] - value;
        }
        return false;
    }

    /**
     * G92: offset the current position to the given coordinates; G92.1 clears it,
     * G92.2 suspends it and G92.3 restores it
     */
    setG92(sub, words) {
        if (sub === 0) {
            const w = this.wcsOffsets[this.wcs];
            for (const [letter, value] of words) {
                const axis = letter.toLowerCase();
                if (axis !== 'x' && axis !== 'y' && axis !== 'z') continue;
                this.g92[axis] = this.position[axis] - w[axis] - value;
            }
        } else if (sub === 1) {
            this.g92 = { x: 0, y: 0, z: 0 };
            this.g92Saved = null;
        } else if (sub === 2) {
            this.g92Saved = this.g92;
            this.g92 = { x: 0, y: 0, z: 0 };
        } else if (sub === 3 && this.g92Saved) {
            this.g92 = this.g92Saved;
            this.g92Saved = null;
        }
    }

    /**
     * Process linear move (G0/G1)
     */
    linearMove(words, type, lineNum) {
        const target = this.extractTarget(words);
        
        if (target.x === this.position.x && 
            target.y === this.position.y && 
            target.z === this.position.z) {
            return false; // No movement
        }
        
        this.addSegment({
            type,
            start: { ...this.position },
            end: { ...target },
            feedRate: this.feedRate,
            tool: this.currentTool,
            toolChangeType: this.lastToolChangeType,
            lineNum
        });
        
        // Clear tool change type after adding segment
        this.lastToolChangeType = null;
        
        this.position = target;
        this.updateBounds(target);
        return true;
    }

    /**
     * Process arc move (G2/G3)
     */
    arcMove(words, direction, lineNum) {
        const target = this.extractTarget(words);
        const offset = this.extractOffset(words);
        
        if (!offset) {
            console.error(`Arc command at line ${lineNum} missing I/J/K parameters`);
            return false;
        }
        
        // Calculate arc segments
        const segments = this.tessellateArc(
            this.position,
            target,
            offset,
            direction === 'cw'
        );
        
        // Add each segment
        for (const seg of segments) {
            this.addSegment({
                type: 'cut',
                start: seg.start,
                end: seg.end,
                feedRate: this.feedRate,
                tool: this.currentTool,
                lineNum
            });
            this.updateBounds(seg.end);
        }
        
        this.position = target;
        return segments.length > 0;
    }

    /**
     * Extract target position from words
     */
    extractTarget(words) {
        const target = { ...this.position };
        // Absolute coordinates are in the active work coordinate system, or in machine
        // coordinates with G53 (taken here as the drawing frame with no offsets)
        const offset = this.lineMachineCoords ? { x: 0, y: 0, z: 0 } : this.workOffset();

        for (const [letter, value] of words) {
            const axis = letter.toLowerCase();
            const actualValue = this.absolute || this.lineMachineCoords
                ? value + offset[axis]
                : this.position[axis] + value;

            switch (letter) {
                case 'X':
                    target.x = actualValue;
                    break;
                case 'Y':
                    target.y = actualValue;
                    break;
                case 'Z':
                    target.z = actualValue;
                    break;
            }
        }
        
        return target;
    }

    /**
     * Extract arc offset (I, J, K)
     */
    extractOffset(words) {
        let offset = null;
        
        for (const [letter, value] of words) {
            if (letter === 'I' || letter === 'J' || letter === 'K') {
                if (!offset) offset = { i: 0, j: 0, k: 0 };
                offset[letter.toLowerCase()] = value;
            }
        }
        
        return offset;
    }

    /**
     * Tessellate arc into line segments with adaptive quality
     */
    tessellateArc(start, end, offset, clockwise) {
        // Calculate center point based on plane
        let centerX, centerY, startX, startY, endX, endY;
        
        if (this.plane === 'XY') {
            centerX = start.x + offset.i;
            centerY = start.y + offset.j;
            startX = start.x;
            startY = start.y;
            endX = end.x;
            endY = end.y;
        } else if (this.plane === 'ZX') {
            centerX = start.z + offset.k;
            centerY = start.x + offset.i;
            startX = start.z;
            startY = start.x;
            endX = end.z;
            endY = end.x;
        } else { // YZ
            centerX = start.y + offset.j;
            centerY = start.z + offset.k;
            startX = start.y;
            startY = start.z;
            endX = end.y;
            endY = end.z;
        }
        
        // Calculate radius and angles
        const radius = Math.sqrt(
            Math.pow(startX - centerX, 2) + 
            Math.pow(startY - centerY, 2)
        );
        
        const startAngle = Math.atan2(startY - centerY, startX - centerX);
        const endAngle = Math.atan2(endY - centerY, endX - centerX);
        
        // Calculate arc angle
        let arcAngle = endAngle - startAngle;
        if (clockwise) {
            if (arcAngle >= 0) arcAngle -= 2 * Math.PI;
        } else {
            if (arcAngle <= 0) arcAngle += 2 * Math.PI;
        }
        
        // Adaptive tessellation: more segments for larger arcs
        const numSegments = Math.max(8, Math.min(64, 
            Math.floor(Math.sqrt(radius) * Math.abs(arcAngle) * 4)
        ));
        
        // Generate segments
        const segments = [];
        let prevPoint = { ...start };
        
        for (let i = 1; i <= numSegments; i++) {
            const t = i / numSegments;
            const angle = startAngle + arcAngle * t;
            
            const point = { ...start };
            
            if (this.plane === 'XY') {
                point.x = centerX + radius * Math.cos(angle);
                point.y = centerY + radius * Math.sin(angle);
                point.z = start.z + (end.z - start.z) * t;
            } else if (this.plane === 'ZX') {
                point.z = centerX + radius * Math.cos(angle);
                point.x = centerY + radius * Math.sin(angle);
                point.y = start.y + (end.y - start.y) * t;
            } else { // YZ
                point.y = centerX + radius * Math.cos(angle);
                point.z = centerY + radius * Math.sin(angle);
                point.x = start.x + (end.x - start.x) * t;
            }
            
            segments.push({
                start: prevPoint,
                end: point
            });
            
            prevPoint = point;
        }
        
        return segments;
    }

    /**
     * Add segment to list
     */
    addSegment(segment) {
        this.segments.push(segment);
    }

    /**
     * Update bounding box
     */
    updateBounds(point) {
        // Check for invalid coordinates
        if (isNaN(point.x) || isNaN(point.y) || isNaN(point.z)) {
            console.error('Invalid point in updateBounds:', point);
            return;
        }
        
        this.bounds.minX = Math.min(this.bounds.minX, point.x);
        this.bounds.maxX = Math.max(this.bounds.maxX, point.x);
        this.bounds.minY = Math.min(this.bounds.minY, point.y);
        this.bounds.maxY = Math.max(this.bounds.maxY, point.y);
        this.bounds.minZ = Math.min(this.bounds.minZ, point.z);
        this.bounds.maxZ = Math.max(this.bounds.maxZ, point.z);
    }

    /**
     * Get bounds
     */
    getBounds() {
        return this.bounds;
    }

    /**
     * Get segments
     */
    getSegments() {
        return this.segments;
    }

    /**
     * Get tool names
     */
    getToolNames() {
        return this.toolNames;
    }

    /**
     * Get tool colors
     */
    getToolColors() {
        return this.toolColors;
    }
    
    /**
     * Check if using inline tool format
     */
    get usingInlineToolFormat() {
        return this.inlineToolMap.size > 0;
    }
}
