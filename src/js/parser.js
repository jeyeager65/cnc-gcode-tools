/**
 * GCode Parser Module
 * Streams and parses GCode files with modal state tracking and adaptive arc tessellation
 */

class GCodeParser {
    constructor() {
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
        this.motionMode = null; // G0, G1, G2, or G3 - modal command
        
        // Tool names extracted from comments
        this.toolNames = [];
        this.toolColors = []; // Custom colors for tools (hex format)
        this.parsingToolList = false;
        this.inlineToolMap = new Map(); // Maps tool number to array of sequential indices for inline format
        this.inlineToolOccurrence = new Map(); // Tracks which occurrence of each tool number we're on
        this.lastToolChangeType = null; // 'M0' for manual, 'M6' for automatic, null for none
        
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
        
        // Process commands
        let motionProcessed = false;
        
        for (const [letter, value] of words) {
            switch (letter) {
                case 'G':
                    const gcode = Math.floor(value);
                    // Check if this is a motion command (G0/G1/G2/G3)
                    const isMotionCommand = gcode === 0 || gcode === 1 || gcode === 2 || gcode === 3;
                    if (isMotionCommand) {
                        motionProcessed = true; // Motion command found, don't apply modal later
                    }
                    this.processGCode(gcode, words, lineNum);
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
                case 'F':
                    this.feedRate = value;
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
                // Only apply modal motion for linear moves (G0/G1)
                // Arc moves (G2/G3) require explicit I/J/K parameters each time
                if (this.motionMode === 0 || this.motionMode === 1) {
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
    processGCode(code, words, lineNum) {
        switch (code) {
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
        
        for (const [letter, value] of words) {
            const actualValue = this.absolute ? value : this.position[letter.toLowerCase()] + value;
            
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
