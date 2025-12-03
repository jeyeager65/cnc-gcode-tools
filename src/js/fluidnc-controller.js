/**
 * FluidNC Controller Extension
 * Extends the base Controller class with FluidNC-specific functionality
 */

// Initialize FluidNC API
const fluidAPI = new FluidNCAPI();

// Extend Controller with FluidNC features
class FluidNCController extends Controller {
    constructor() {
        super();
        this.fluidAPI = fluidAPI;
        this.currentPath = '/';
        this.selectedFile = null;
        this.hasRefittedCamera = false; // Track if we've refitted after tab switch
        this.setupFluidNCListeners();
        this.loadSDFiles();
        this.syncGridFromFluidNC(); // Auto-sync grid dimensions on load
    }

    /**
     * Setup FluidNC-specific event listeners
     */
    setupFluidNCListeners() {
        // Load file button
        document.getElementById('btn-load-file').addEventListener('click', () => {
            if (this.selectedFile) {
                this.loadSDFile(this.selectedFile);
            }
        });

        // Run file button
        document.getElementById('btn-run-file').addEventListener('click', () => {
            if (this.selectedFile) {
                this.runSDFile(this.selectedFile);
            }
        });

        // Override file upload - disable for FluidNC
        const uploadZone = document.getElementById('upload-zone');
        const fileInput = document.getElementById('file-input');
        if (uploadZone) uploadZone.style.display = 'none';
        if (fileInput) fileInput.style.display = 'none';
    }

    /**
     * Sync grid dimensions from FluidNC settings (runs automatically on load)
     */
    async syncGridFromFluidNC() {
        try {
            const [width, height] = await Promise.all([
                this.fluidAPI.getMaxTravelX(),
                this.fluidAPI.getMaxTravelY()
            ]);

            const widthInput = document.getElementById('grid-width');
            const heightInput = document.getElementById('grid-height');
            
            widthInput.value = Math.round(width);
            heightInput.value = Math.round(height);
            
            // Trigger input events so the renderers pick up the change
            widthInput.dispatchEvent(new Event('input', { bubbles: true }));
            heightInput.dispatchEvent(new Event('input', { bubbles: true }));

            console.log('Grid dimensions synced from FluidNC:', width, 'x', height);
        } catch (error) {
            console.error('Failed to sync grid dimensions:', error);
        }
    }

    /**
     * Load files from SD card
     */
    async loadSDFiles(path = '/') {
        this.currentPath = path;
        const browser = document.getElementById('file-browser');
        browser.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.7;">Loading files...</div>';

        try {
            const files = await this.fluidAPI.listSDFiles(path);
            this.renderFileBrowser(files);
            this.updateBreadcrumb(path);
        } catch (error) {
            console.error('Failed to load SD files:', error);
            browser.innerHTML = '<div style="padding: 20px; text-align: center; color: #f44336;">Failed to load files</div>';
        }
    }

    /**
     * Render file browser UI
     */
    renderFileBrowser(files) {
        const browser = document.getElementById('file-browser');

        if (files.length === 0) {
            browser.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.7;">No files found</div>';
            return;
        }

        browser.innerHTML = '';

        // Sort: directories first, then files
        files.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'file-item';

            const icon = document.createElement('div');
            icon.className = 'file-icon';
            icon.textContent = file.type === 'dir' ? '📁' : '📄';

            const info = document.createElement('div');
            info.className = 'file-info';

            const name = document.createElement('div');
            name.className = 'file-name';
            name.textContent = file.name;

            info.appendChild(name);

            if (file.type === 'file') {
                const size = document.createElement('div');
                size.className = 'file-size';
                size.textContent = this.formatFileSize(file.size);
                info.appendChild(size);
            }

            item.appendChild(icon);
            item.appendChild(info);

            item.addEventListener('click', () => {
                if (file.type === 'dir') {
                    this.loadSDFiles(file.path);
                } else {
                    this.selectFile(file, item);
                }
            });

            browser.appendChild(item);
        });
    }

    /**
     * Update breadcrumb navigation
     */
    updateBreadcrumb(path) {
        const breadcrumb = document.getElementById('breadcrumb');
        breadcrumb.innerHTML = '';

        const parts = path.split('/').filter(p => p);
        parts.unshift('');

        let currentPath = '';
        parts.forEach((part, index) => {
            if (index > 0) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = '/';
                breadcrumb.appendChild(sep);
            }

            const item = document.createElement('span');
            item.className = 'breadcrumb-item';
            item.textContent = part || 'SD Card';
            currentPath += (part ? '/' + part : '');
            const targetPath = currentPath || '/';
            item.setAttribute('data-path', targetPath);

            item.addEventListener('click', () => {
                this.loadSDFiles(targetPath);
            });

            breadcrumb.appendChild(item);
        });
    }

    /**
     * Select a file
     */
    selectFile(file, element) {
        // Remove previous selection
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('selected');
        });

        element.classList.add('selected');
        this.selectedFile = file;

        document.getElementById('btn-load-file').disabled = false;
        document.getElementById('btn-run-file').disabled = false;
    }

    /**
     * Load file from SD card
     */
    async loadSDFile(file) {
        const progressBar = document.getElementById('progress-bar');
        const progressFill = document.getElementById('progress-fill');

        progressBar.classList.remove('hidden');
        progressFill.style.width = '0%';
        
        // Add indeterminate animation class during download
        progressBar.classList.add('indeterminate');

        try {
            const content = await this.fluidAPI.readSDFile(file.path);
            
            // Remove indeterminate animation, switch to determinate progress
            progressBar.classList.remove('indeterminate');
            progressFill.style.width = '0%';

            // Process the GCode content using existing loadFile logic
            await this.processGCode(content, file.name);

            progressFill.style.width = '100%';
            setTimeout(() => {
                progressBar.classList.add('hidden');
            }, 500);

        } catch (error) {
            console.error('Failed to load SD file:', error);
            alert('Failed to load file from SD card: ' + error.message);
            progressBar.classList.remove('indeterminate');
            progressBar.classList.add('hidden');
        }
    }

    /**
     * Process GCode content (reusing existing logic)
     */
    async processGCode(text, filename) {
        // This reuses the existing file processing logic from Controller
        const progressBar = document.getElementById('progress-bar');
        const progressFill = document.getElementById('progress-fill');

        try {
            // Create a Blob from the text to use parseFile
            const blob = new Blob([text], { type: 'text/plain' });
            const file = new File([blob], filename, { type: 'text/plain' });
            
            // Parse GCode using the parser's parseFile method
            const segments = await this.parser.parseFile(file, (percent) => {
                progressFill.style.width = percent + '%';
            });

            const bounds = this.parser.getBounds();

            this.segments = segments;
            this.bounds = bounds;
            this.gcodeText = text;
            this.hasRefittedCamera = false; // Reset flag for new file

            // Detect tools used in the file
            this.detectTools(segments);

            // Update renderers
            this.renderer2d.setSegments(segments, bounds);
            this.renderer3d.setSegments(segments, bounds);

            // Update animator
            this.animator.setSegments(segments);

            // Update UI first to ensure canvas is visible
            this.updateStatistics();
            this.displayGCode(text);
            this.updateToolPanel();
            document.getElementById('animation-panel').style.display = 'block';
            const gcodePanel = document.getElementById('gcode-panel');
            gcodePanel.style.display = 'block';
            gcodePanel.style.visibility = 'visible';
            gcodePanel.style.position = 'relative';
            document.getElementById('tool-panel').style.display = 'block';
            const rapidMovesPanel = document.getElementById('rapid-moves-panel');
            if (rapidMovesPanel) rapidMovesPanel.style.display = 'block';
            document.getElementById('btn-reset-view').disabled = false;
            
            // Hide welcome panel
            const welcomePanel = document.getElementById('gcode-welcome');
            if (welcomePanel) welcomePanel.style.display = 'none';
            
            // Setup line slider
            const lineSlider = document.getElementById('line-slider');
            lineSlider.max = segments.length;
            lineSlider.value = 0;

            // Fit camera to bounds - use requestAnimationFrame to wait for layout
            const fitCamera = () => {
                // Force canvas resize first
                this.renderer2d.resizeCanvas();
                
                // Try to get dimensions from multiple sources
                let width = this.canvas2d.width;
                let height = this.canvas2d.height;
                
                // If canvas dimensions are 0, try the container or use viewport
                if (!width || !height) {
                    const container = this.canvas2d.parentElement;
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        width = rect.width;
                        height = rect.height;
                    }
                    
                    // Still no dimensions? Use a reasonable portion of viewport
                    if (!width || !height) {
                        width = window.innerWidth * 0.6;  // Assume canvas takes ~60% of width
                        height = window.innerHeight * 0.8; // Assume canvas takes ~80% of height
                    }
                    
                    // Set canvas to calculated dimensions
                    if (width && height) {
                        this.canvas2d.width = width;
                        this.canvas2d.height = height;
                    }
                }
                
                console.log('FluidNC: Fitting to bounds with canvas size:', width, 'x', height);
                this.camera.fitToBounds(bounds, 0.1, width, height);
                this.updateZoomSlider();
            };
            
            // Use requestAnimationFrame to wait for layout, then set timeouts as backup
            requestAnimationFrame(() => {
                fitCamera();
                setTimeout(fitCamera, 200); // Retry after 200ms
                setTimeout(fitCamera, 500); // Final retry after 500ms for slower devices
            });

        } catch (error) {
            console.error('Error processing GCode:', error);
            throw error;
        }
    }

    /**
     * Run file on CNC
     */
    async runSDFile(file) {
        if (!confirm(`Run ${file.name} on the CNC?\n\nThis will start the job immediately.`)) {
            return;
        }

        const btn = document.getElementById('btn-run-file');
        btn.disabled = true;
        btn.textContent = 'Running...';

        try {
            await this.fluidAPI.runSDFile(file.path);
            btn.textContent = '✓ Started';
            setTimeout(() => {
                btn.textContent = 'Run on CNC';
                btn.disabled = false;
            }, 3000);
        } catch (error) {
            console.error('Failed to run SD file:', error);
            alert('Failed to run file: ' + error.message);
            btn.textContent = '✗ Failed';
            setTimeout(() => {
                btn.textContent = 'Run on CNC';
                btn.disabled = false;
            }, 3000);
        }
    }

    /**
     * Override switchMobileTab to refit camera when switching to display
     */
    switchMobileTab(tabName) {
        super.switchMobileTab(tabName);
        
        // When switching to display tab for the first time with a loaded file, refit camera
        if (tabName === 'display' && this.bounds && !this.hasRefittedCamera) {
            this.hasRefittedCamera = true;
            setTimeout(() => {
                this.renderer2d.resizeCanvas();
                const width = this.canvas2d.width || this.canvas2d.clientWidth;
                const height = this.canvas2d.height || this.canvas2d.clientHeight;
                console.log('FluidNC: Refitting on tab switch with canvas size:', width, 'x', height);
                this.camera.fitToBounds(this.bounds, 0.1, width, height);
                this.updateZoomSlider();
            }, 100);
        }
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
}

// Initialize FluidNC Controller when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    new FluidNCController();
});
