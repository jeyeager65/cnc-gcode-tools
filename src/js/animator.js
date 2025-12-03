/**
 * Animation Controller
 * Manages playback of GCode toolpath animation
 */

class Animator {
    constructor() {
        this.segments = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.speed = 1.0;
        this.lastTime = 0;
        this.accumulatedTime = 0;
        this.estimatedTotalTime = 0;
        
        this.onUpdate = null; // Callback when index changes
    }

    /**
     * Set segments for animation
     */
    setSegments(segments) {
        this.segments = segments;
        this.currentIndex = 0;
        this.accumulatedTime = 0;
        this.calculateTotalTime();
    }

    /**
     * Calculate total estimated time from feed rates
     */
    calculateTotalTime() {
        this.estimatedTotalTime = 0;
        
        for (const seg of this.segments) {
            if (seg.type === 'cut' && seg.feedRate > 0) {
                const distance = Math.sqrt(
                    Math.pow(seg.end.x - seg.start.x, 2) +
                    Math.pow(seg.end.y - seg.start.y, 2) +
                    Math.pow(seg.end.z - seg.start.z, 2)
                );
                
                // Time in minutes
                this.estimatedTotalTime += distance / seg.feedRate;
            }
        }
        
        // Convert to seconds
        this.estimatedTotalTime *= 60;
    }

    /**
     * Get formatted total time
     */
    getFormattedTime() {
        if (this.estimatedTotalTime === 0) {
            return '-';
        }
        
        const minutes = Math.floor(this.estimatedTotalTime / 60);
        const seconds = Math.floor(this.estimatedTotalTime % 60);
        
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    /**
     * Start playback
     */
    play() {
        if (this.segments.length === 0) return;
        
        // Sync accumulated time with current index to resume from current position
        if (this.estimatedTotalTime > 0) {
            this.accumulatedTime = (this.currentIndex / this.segments.length) * this.estimatedTotalTime;
        }
        
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
     * Set playback speed (0.1x to 10x)
     */
    setSpeed(speed) {
        this.speed = Math.max(0.1, Math.min(10, speed));
    }

    /**
     * Get speed from slider value (-10 to 10)
     */
    static sliderToSpeed(value) {
        // Logarithmic scale
        if (value === 0) return 1;
        if (value > 0) {
            return 1 + (value / 10) * 9; // 1x to 10x
        } else {
            return 1 + (value / 10) * 0.9; // 0.1x to 1x
        }
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
        
        // Calculate how many segments to advance
        if (this.estimatedTotalTime > 0) {
            // Time-based animation
            this.accumulatedTime += deltaTime * this.speed;
            
            const progress = this.accumulatedTime / this.estimatedTotalTime;
            const targetIndex = Math.floor(progress * this.segments.length);
            
            if (targetIndex !== this.currentIndex && targetIndex <= this.segments.length) {
                this.currentIndex = targetIndex;
                
                if (this.onUpdate) {
                    this.onUpdate(this.currentIndex);
                }
            }
        } else {
            // Line-based animation (fallback when no feed rates)
            const linesPerSecond = 100 * this.speed;
            const linesToAdvance = linesPerSecond * deltaTime;
            
            this.currentIndex += linesToAdvance;
            
            if (this.onUpdate) {
                this.onUpdate(Math.floor(this.currentIndex));
            }
        }
        
        // Check if animation is complete
        if (this.currentIndex >= this.segments.length) {
            this.currentIndex = this.segments.length;
            this.isPlaying = false;
            
            if (this.onUpdate) {
                this.onUpdate(this.currentIndex);
            }
            
            return;
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
