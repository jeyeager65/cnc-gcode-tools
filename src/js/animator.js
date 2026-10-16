/**
 * Animation Controller
 * Manages playback of GCode toolpath animation
 */

class Animator {
    constructor() {
        this.segments = [];
        this.currentIndex = 0;
        this.segmentProgress = 0; // 0-1 progress within current segment
        this.isPlaying = false;
        this.speed = 1.0;
        this.lastTime = 0;
        this.accumulatedTime = 0;
        this.estimatedTotalTime = 0;
        this.toolTimes = new Map(); // Per-tool time estimates in seconds
        
        // Machine settings for time estimation
        this.rapidSpeed = 3000; // mm/min - default/fallback
        this.maxRateX = 3000; // mm/min - per-axis rapid speeds
        this.maxRateY = 3000; // mm/min
        this.maxRateZ = 2000; // mm/min
        this.accelX = 200; // mm/s²
        this.accelY = 200; // mm/s²
        this.accelZ = 80;  // mm/s²
        this.manualToolChangeTime = 30; // seconds for M0 tool changes
        this.autoToolChangeTime = 10;   // seconds for M6 tool changes
        
        this.onUpdate = null; // Callback when index changes
    }

    /**
     * Set machine motion parameters
     */
    setMotionParameters(params) {
        if (params.accelX !== undefined) this.accelX = params.accelX;
        if (params.accelY !== undefined) this.accelY = params.accelY;
        if (params.accelZ !== undefined) this.accelZ = params.accelZ;
        if (params.maxRateX !== undefined) this.maxRateX = params.maxRateX;
        if (params.maxRateY !== undefined) this.maxRateY = params.maxRateY;
        if (params.maxRateZ !== undefined) this.maxRateZ = params.maxRateZ;
        
        console.log('[Animator] Motion parameters updated:', {
            accel: { X: this.accelX, Y: this.accelY, Z: this.accelZ },
            maxRate: { X: this.maxRateX, Y: this.maxRateY, Z: this.maxRateZ }
        });
    }

    /**
     * Set segments for animation
     */
    setSegments(segments) {
        this.segments = segments;
        this.currentIndex = 0;
        this.segmentProgress = 0;
        this.accumulatedTime = 0;
        this.calculateTotalTime();
        this.calculateDistances();
    }

    /**
     * Build the animation timeline from the move times
     */
    calculateDistances() {
        // The animation plays each move in its estimated time (calculateTotalTime), so 1x
        // is real time. segmentEndTimes[i] is when move i ends, in seconds.
        const n = this.segments.length;
        this.segmentEndTimes = new Float64Array(n);
        let time = 0;
        for (let i = 0; i < n; i++) {
            time += this.segmentMoveTimes ? this.segmentMoveTimes[i] : 0;
            this.segmentEndTimes[i] = time;
        }
        this.totalAnimTime = time;
    }

    /**
     * Time at which move `index` starts on the animation timeline
     */
    segmentStartTime(index) {
        return index > 0 && this.segmentEndTimes ? this.segmentEndTimes[Math.min(index, this.segments.length) - 1] : 0;
    }

    /**
     * Calculate total estimated time from feed rates
     */
    calculateTotalTime() {
        this.estimatedTotalTime = 0;
        this.toolTimes.clear();
        // Each move's own time, without tool change allowances (the animation timeline)
        this.segmentMoveTimes = new Float64Array(this.segments.length);
        
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const prevSeg = i > 0 ? this.segments[i - 1] : null;
            const nextSeg = i < this.segments.length - 1 ? this.segments[i + 1] : null;
            
            let segmentTime = 0;
            
            // Calculate move time based on type with junction velocities
            if ((seg.type === 'cut' || seg.type === 'probe') && seg.feedRate > 0) {
                // Probe moves run at the feed rate. Simulated ones end at contact; others
                // are their full travel, an upper bound
                const feedRate = seg.feedRate;
                const prevFeedRate = prevSeg && prevSeg.type === 'cut' ? prevSeg.feedRate : 0;
                const nextFeedRate = nextSeg && nextSeg.type === 'cut' ? nextSeg.feedRate : 0;
                
                const entryVel = this.calculateJunctionVelocity(prevSeg, seg, prevFeedRate, feedRate);
                const exitVel = this.calculateJunctionVelocity(seg, nextSeg, feedRate, nextFeedRate);
                
                segmentTime += this.calculateMoveTime(seg, feedRate, entryVel, exitVel);
            } else if (seg.type === 'rapid') {
                // Calculate rapid feedrate based on move direction and per-axis limits
                const dx = seg.end.x - seg.start.x;
                const dy = seg.end.y - seg.start.y;
                const dz = seg.end.z - seg.start.z;
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                if (distance > 0) {
                    // Calculate the maximum feedrate for this move based on axis limits
                    let rapidFeedRate = Infinity;
                    
                    if (Math.abs(dx) > 0.001) {
                        const timeX = Math.abs(dx) / (this.maxRateX / 60);
                        const requiredFeedRate = (distance / timeX) * 60;
                        rapidFeedRate = Math.min(rapidFeedRate, requiredFeedRate);
                    }
                    if (Math.abs(dy) > 0.001) {
                        const timeY = Math.abs(dy) / (this.maxRateY / 60);
                        const requiredFeedRate = (distance / timeY) * 60;
                        rapidFeedRate = Math.min(rapidFeedRate, requiredFeedRate);
                    }
                    if (Math.abs(dz) > 0.001) {
                        const timeZ = Math.abs(dz) / (this.maxRateZ / 60);
                        const requiredFeedRate = (distance / timeZ) * 60;
                        rapidFeedRate = Math.min(rapidFeedRate, requiredFeedRate);
                    }
                    
                    if (rapidFeedRate === Infinity) {
                        rapidFeedRate = this.rapidSpeed;
                    }
                    
                    const prevIsRapid = prevSeg && prevSeg.type === 'rapid';
                    const nextIsRapid = nextSeg && nextSeg.type === 'rapid';
                    
                    const entryVel = prevIsRapid ? this.calculateJunctionVelocity(prevSeg, seg, rapidFeedRate, rapidFeedRate) : 0;
                    const exitVel = nextIsRapid ? this.calculateJunctionVelocity(seg, nextSeg, rapidFeedRate, rapidFeedRate) : 0;
                    
                    segmentTime += this.calculateMoveTime(seg, rapidFeedRate, entryVel, exitVel);
                }
            }
            
            this.segmentMoveTimes[i] = segmentTime;

            // Add tool change time if this segment has a tool change
            if (seg.toolChangeType === 'M0') {
                segmentTime += this.manualToolChangeTime;
            } else if (seg.toolChangeType === 'M6') {
                segmentTime += this.autoToolChangeTime;
            }

            this.estimatedTotalTime += segmentTime;
            
            // Track per-tool time (only for cutting moves)
            if (seg.type === 'cut') {
                const tool = seg.tool || 1;
                const currentToolTime = this.toolTimes.get(tool) || 0;
                this.toolTimes.set(tool, currentToolTime + segmentTime);
            }
        }
    }

    /**
     * Calculate time for a move considering acceleration and entry/exit velocities
     * Uses trapezoidal velocity profile with entry and exit velocities
     */
    calculateMoveTime(seg, feedRate, entryVelocity = 0, exitVelocity = 0) {
        const dx = seg.end.x - seg.start.x;
        const dy = seg.end.y - seg.start.y;
        const dz = seg.end.z - seg.start.z;
        
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (distance === 0) return 0;
        
        // Target velocity in mm/s
        const targetVelocity = feedRate / 60;
        
        // Calculate effective acceleration based on move direction
        // Use the limiting (lowest) acceleration for the move
        let effectiveAccel = Infinity;
        
        if (Math.abs(dx) > 0.001) {
            const xAccel = this.accelX;
            effectiveAccel = Math.min(effectiveAccel, xAccel);
        }
        if (Math.abs(dy) > 0.001) {
            const yAccel = this.accelY;
            effectiveAccel = Math.min(effectiveAccel, yAccel);
        }
        if (Math.abs(dz) > 0.001) {
            const zAccel = this.accelZ;
            effectiveAccel = Math.min(effectiveAccel, zAccel);
        }
        
        // If no acceleration limit applies, use X/Y default
        if (effectiveAccel === Infinity) {
            effectiveAccel = this.accelX;
        }
        
        // Clamp entry and exit velocities to target velocity
        entryVelocity = Math.min(entryVelocity, targetVelocity);
        exitVelocity = Math.min(exitVelocity, targetVelocity);
        
        // Distance to accelerate from entry to target
        const accelDistance = (targetVelocity * targetVelocity - entryVelocity * entryVelocity) / (2 * effectiveAccel);
        
        // Distance to decelerate from target to exit
        const decelDistance = (targetVelocity * targetVelocity - exitVelocity * exitVelocity) / (2 * effectiveAccel);
        
        const totalAccelDistance = accelDistance + decelDistance;
        
        if (totalAccelDistance >= distance) {
            // Can't reach target velocity - calculate peak velocity
            const peakVelocitySq = (entryVelocity * entryVelocity + exitVelocity * exitVelocity) / 2 + effectiveAccel * distance;
            const peakVelocity = Math.sqrt(Math.max(0, peakVelocitySq));
            
            const accelTime = (peakVelocity - entryVelocity) / effectiveAccel;
            const decelTime = (peakVelocity - exitVelocity) / effectiveAccel;
            return accelTime + decelTime;
        } else {
            // Reaches target velocity
            const accelTime = (targetVelocity - entryVelocity) / effectiveAccel;
            const decelTime = (targetVelocity - exitVelocity) / effectiveAccel;
            const constantVelocityDistance = distance - totalAccelDistance;
            const constantVelocityTime = constantVelocityDistance / targetVelocity;
            return accelTime + constantVelocityTime + decelTime;
        }
    }
    
    /**
     * Calculate the safe junction velocity between two segments
     * Based on angle between moves and acceleration limits
     */
    calculateJunctionVelocity(seg1, seg2, feedRate1, feedRate2) {
        // Quick rejection checks first
        if (!seg1 || !seg2) return 0;
        if (seg1.tool !== seg2.tool || seg1.type !== seg2.type) return 0;
        
        // Check connection
        const dx = seg1.end.x - seg2.start.x;
        const dy = seg1.end.y - seg2.start.y;
        const dz = seg1.end.z - seg2.start.z;
        if ((dx*dx + dy*dy + dz*dz) >= 0.000001) return 0; // Not connected
        
        // Calculate direction vectors
        const dx1 = seg1.end.x - seg1.start.x;
        const dy1 = seg1.end.y - seg1.start.y;
        const dz1 = seg1.end.z - seg1.start.z;
        const len1Sq = dx1*dx1 + dy1*dy1 + dz1*dz1;
        
        const dx2 = seg2.end.x - seg2.start.x;
        const dy2 = seg2.end.y - seg2.start.y;
        const dz2 = seg2.end.z - seg2.start.z;
        const len2Sq = dx2*dx2 + dy2*dy2 + dz2*dz2;
        
        if (len1Sq === 0 || len2Sq === 0) return 0;
        
        const len1 = Math.sqrt(len1Sq);
        const len2 = Math.sqrt(len2Sq);
        
        // Normalize
        const ux1 = dx1 / len1, uy1 = dy1 / len1, uz1 = dz1 / len1;
        const ux2 = dx2 / len2, uy2 = dy2 / len2, uz2 = dz2 / len2;
        
        // Dot product gives cosine of angle
        const cosAngle = ux1*ux2 + uy1*uy2 + uz1*uz2;
        
        // If moving in same direction (cosAngle near 1), can maintain full speed
        if (cosAngle > 0.999) {
            return Math.min(feedRate1, feedRate2) / 60; // Convert to mm/s
        }
        
        // For other angles, calculate safe junction velocity
        const angleFactor = (1 + cosAngle) / 2; // 0 at 180°, 1 at 0°
        const targetVel = Math.min(feedRate1, feedRate2) / 60;
        
        return targetVel * angleFactor;
    }


    /**
     * Calculate time for a move considering acceleration and entry/exit velocities
     * Uses trapezoidal velocity profile with entry and exit velocities
     */
    /**
     * Format time duration in seconds to human readable string
     */
    formatDuration(timeInSeconds) {
        if (timeInSeconds === 0) {
            return '-';
        }
        
        const totalSeconds = Math.floor(timeInSeconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    /**
     * Get formatted total time
     */
    getFormattedTime() {
        return this.formatDuration(this.estimatedTotalTime);
    }
    
    /**
     * Get formatted time for specific tool
     */
    getToolTime(toolNum) {
        const time = this.toolTimes.get(toolNum) || 0;
        return this.formatDuration(time);
    }
    
    /**
     * Get all tool times
     */
    getToolTimes() {
        return this.toolTimes;
    }

    /**
     * Get segment index at given time
     */
    /**
     * Start playback
     */
    play() {
        if (this.segments.length === 0) return;
        // Carry on from the current position (it may have been moved by stepping or the
        // slider since playback last ran)
        if (this.currentIndex >= this.segments.length) this.currentIndex = 0;
        const index = Math.floor(this.currentIndex);
        const start = this.segmentStartTime(index);
        const end = index < this.segments.length ? this.segmentEndTimes[index] : start;
        if (!(this.accumulatedTime >= start && this.accumulatedTime <= end)) this.accumulatedTime = start;
        
        this.isPlaying = true;
        this.lastTime = performance.now();
        this.animate();
    }

    /**
     * Pause playback
     */
    pause() {
        this.isPlaying = false;
    }

    /**
     * Reset to beginning
     */
    reset() {
        this.currentIndex = 0;
        this.accumulatedTime = 0;
        this.isPlaying = false;
        
        if (this.onUpdate) {
            this.onUpdate(this.currentIndex);
        }
    }

    /**
     * Set playback speed, as a multiple of real time (0.1x to 500x)
     */
    setSpeed(speed) {
        this.speed = Math.max(0.1, Math.min(500, speed));
    }

    /**
     * Get speed from slider value (-10 to 10)
     */
    static sliderToSpeed(value) {
        // 1x is real time. Exponential, so the slider covers 0.1x (-10) to 500x (10)
        if (value >= 0) return Math.pow(500, value / 10);
        return Math.pow(10, value / 10);
    }

    /**
     * Step to next segment
     */
    stepNext() {
        if (this.currentIndex < this.segments.length) {
            this.currentIndex++;
            
            if (this.onUpdate) {
                this.onUpdate(this.currentIndex);
            }
        }
    }

    /**
     * Step to previous segment
     */
    stepPrev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            
            if (this.onUpdate) {
                this.onUpdate(this.currentIndex);
            }
        }
    }

    /**
     * Set current line directly (for slider)
     */
    setCurrentLine(lineNum) {
        const index = Math.max(0, Math.min(lineNum, this.segments.length));
        if (index !== this.currentIndex) {
            this.currentIndex = index;
            this.isPlaying = false; // Pause playback when manually seeking
            
            if (this.onUpdate) {
                this.onUpdate(this.currentIndex);
            }
        }
    }

    /**
     * Animation loop
     */
    animate() {
        if (!this.isPlaying) return;
        
        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = currentTime;
        
        // Each move takes its estimated time (1x = real time)
        if (this.totalAnimTime > 0) {
            this.accumulatedTime += deltaTime * this.speed;
            const targetTime = this.accumulatedTime;

            // The move in progress: the first that ends after targetTime
            let left = 0;
            let right = this.segmentEndTimes.length - 1;
            while (left < right) {
                const mid = Math.floor((left + right) / 2);
                if (this.segmentEndTimes[mid] <= targetTime) {
                    left = mid + 1;
                } else {
                    right = mid;
                }
            }
            const targetIndex = left;

            // How far through it
            const segStart = this.segmentStartTime(targetIndex);
            const segTime = this.segmentEndTimes[targetIndex] - segStart;
            this.segmentProgress = segTime > 0 ? Math.min(1, Math.max(0, (targetTime - segStart) / segTime)) : 1;
            this.currentIndex = targetIndex;

            if (this.onUpdate) {
                this.onUpdate(this.currentIndex, this.segmentProgress);
            }

            // Check if finished
            if (this.accumulatedTime >= this.totalAnimTime) {
                this.currentIndex = this.segments.length;
                this.segmentProgress = 1;
                this.isPlaying = false;

                if (this.onUpdate) {
                    this.onUpdate(this.currentIndex, 1);
                }
                return;
            }
        } else {
            // Fallback to time-based animation
            if (this.estimatedTotalTime > 0) {
                this.accumulatedTime += deltaTime * this.speed;
                
                const progress = this.accumulatedTime / this.estimatedTotalTime;
                const targetIndex = Math.floor(progress * this.segments.length);
                
                if (targetIndex !== this.currentIndex && targetIndex <= this.segments.length) {
                    this.currentIndex = targetIndex;
                    this.segmentProgress = 1;
                    
                    if (this.onUpdate) {
                        this.onUpdate(this.currentIndex, 1);
                    }
                }
                
                // Check if finished
                if (this.currentIndex >= this.segments.length) {
                    this.currentIndex = this.segments.length;
                    this.segmentProgress = 1;
                    this.isPlaying = false;
                    
                    if (this.onUpdate) {
                        this.onUpdate(this.currentIndex, 1);
                    }
                    return;
                }
            } else {
                // Line-based animation (fallback when no feed rates)
                const linesPerSecond = 100 * this.speed;
                const linesToAdvance = linesPerSecond * deltaTime;
                
                this.currentIndex += linesToAdvance;
                this.segmentProgress = 1;
                
                if (this.onUpdate) {
                    this.onUpdate(Math.floor(this.currentIndex), 1);
                }
                
                // Check if finished
                if (this.currentIndex >= this.segments.length) {
                    this.currentIndex = this.segments.length;
                    this.segmentProgress = 1;
                    this.isPlaying = false;
                    
                    if (this.onUpdate) {
                        this.onUpdate(this.currentIndex, 1);
                    }
                    return;
                }
            }
        }
        
        requestAnimationFrame(() => this.animate());
    }

    /**
     * Get current progress (0-100)
     */
    getProgress() {
        if (this.segments.length === 0) return 0;
        return (this.currentIndex / this.segments.length) * 100;
    }

    /**
     * Get current index
     */
    getCurrentIndex() {
        return Math.floor(this.currentIndex);
    }

    /**
     * Get total segments
     */
    getTotalSegments() {
        return this.segments.length;
    }

    /**
     * Is currently playing
     */
    getIsPlaying() {
        return this.isPlaying;
    }
}
