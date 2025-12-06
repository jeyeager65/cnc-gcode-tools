/**
 * Main Controller
 * Integrates all modules and handles user interactions
 */

class Controller {
    constructor() {
        // Initialize modules
        this.parser = new GCodeParser();
        this.camera = new Camera();
        this.animator = new Animator();
        
        // Get canvas elements
        this.canvas2d = document.getElementById('canvas2d');
        this.canvas3d = document.getElementById('canvas3d');
        this.canvas3dOverlay = document.getElementById('canvas3d-overlay');
        
        // Initialize renderers
        this.renderer2d = new Renderer2D(this.canvas2d, this.camera);
        this.renderer3d = new Renderer3D(this.canvas3d, this.camera, this.canvas3dOverlay);
        
        // State
        this.currentView = '2d';
        this.segments = [];
        this.bounds = null;
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.isShiftPressed = false;
        
        // Tool state
        this.tools = new Map(); // { toolNum: { visible: bool, color: string } }
        this.toolColors = [
            '#00ccff', '#00ff88', '#ff4dff', '#ffff00',
            '#ff8800', '#8888ff', '#ff0088', '#00ffff'
        ];
        
        // Rapid move (G0) state
        this.rapidMovesVisible = true;
        this.rapidMoveColor = '#999999'; // Default gray color
        
        // SpaceMouse state
        this.spaceMouseConnected = false;
        this.spaceMouseIndex = -1;
        
        // Touch state
        this.touches = [];
        this.lastPinchDistance = 0;
        this.lastTouchCenter = null;
        
        // Setup UI
        this.setupEventListeners();
        this.setupAnimator();
        this.setupSpaceMouse();
        this.startRenderLoop();
    }

    /**
     * Setup SpaceMouse/3D mouse support via Gamepad API
     */
    setupSpaceMouse() {
        // Check for gamepad connection
        window.addEventListener('gamepadconnected', (e) => {
            const gamepad = e.gamepad;
            // SpaceMouse devices typically have "3Dconnexion" or "SpaceMouse" in their ID
            if (gamepad.id.toLowerCase().includes('3dconnexion') || 
                gamepad.id.toLowerCase().includes('spacemouse') ||
                gamepad.id.toLowerCase().includes('space')) {
                this.spaceMouseConnected = true;
                this.spaceMouseIndex = gamepad.index;
                console.log('SpaceMouse connected:', gamepad.id);
            }
        });
        
        window.addEventListener('gamepaddisconnected', (e) => {
            if (e.gamepad.index === this.spaceMouseIndex) {
                this.spaceMouseConnected = false;
                this.spaceMouseIndex = -1;
                console.log('SpaceMouse disconnected');
            }
        });
    }
    
    /**
     * Poll SpaceMouse input
     */
    pollSpaceMouse() {
        if (!this.spaceMouseConnected || this.currentView !== '3d') return;
        
        const gamepads = navigator.getGamepads();
        if (!gamepads || !gamepads[this.spaceMouseIndex]) return;
        
        const gamepad = gamepads[this.spaceMouseIndex];
        
        // SpaceMouse axes (actual mapping for this device):
        // 0: X translation (pan left/right)
        // 1: Z translation (zoom in/out)
        // 2: Y translation (pan up/down)
        // 3: X rotation (pitch - up/down rotation)
        // 4: Y rotation (yaw - left/right rotation)
        // 5: Z rotation (roll)
        
        const deadzone = 0.05;
        const panSensitivity = 0.5;
        const zoomSensitivity = 0.05;     // Increased from 0.0002
        const rotateSensitivity = 15.0;
        
        // Debug: Log all axes that exceed deadzone
        const activeAxes = [];
        for (let i = 0; i < gamepad.axes.length; i++) {
            if (Math.abs(gamepad.axes[i]) > deadzone) {
                activeAxes.push(`axis${i}=${gamepad.axes[i].toFixed(2)}`);
            }
        }
        if (activeAxes.length > 0) {
            console.log('Active axes:', activeAxes.join(', '));
        }
        
        // Pan left/right (axis 0) and up/down (axis 2)
        if (gamepad.axes.length >= 3) {
            const tx = Math.abs(gamepad.axes[0]) > deadzone ? gamepad.axes[0] : 0;
            const ty = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
            
            if (tx !== 0 || ty !== 0) {
                this.camera.pan3D(-tx * panSensitivity, -ty * panSensitivity);
            }
        }
        
        // Zoom (axis 1)
        if (gamepad.axes.length >= 2) {
            const tz = Math.abs(gamepad.axes[1]) > deadzone ? gamepad.axes[1] : 0;
            if (tz !== 0) {
                this.camera.zoom3D(tz * zoomSensitivity);
                this.updateZoomSlider();
            }
        }
        
        // Rotation: pitch (axis 3) and yaw (axis 4)
        if (gamepad.axes.length >= 5) {
            const rx = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;
            const ry = Math.abs(gamepad.axes[4]) > deadzone ? gamepad.axes[4] : 0;
            
            if (rx !== 0 || ry !== 0) {
                // rx (axis 3) = pitch (up/down orbit) - this is deltaY in rotate()
                // ry (axis 4) = yaw (left/right orbit) - this is deltaX in rotate()
                this.camera.rotate(ry * rotateSensitivity, -rx * rotateSensitivity);
            }
        }
        
        // Rotation roll (tilt camera up vector - not yet implemented)
        // Would require modifying the view matrix's up vector
        if (gamepad.axes.length >= 6) {
            const rz = Math.abs(gamepad.axes[5]) > deadzone ? gamepad.axes[5] : 0;
            if (rz !== 0) {
                // TODO: Implement roll by rotating the camera's up vector
                // This would require adding roll support to the camera class
            }
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Mobile tabs
        const tabButtons = document.querySelectorAll('.mobile-tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabName = button.getAttribute('data-tab');
                this.switchMobileTab(tabName);
            });
        });
        
        // Handle window resize (throttled)
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // Resize canvases
                this.renderer2d.resizeCanvas();
                this.renderer3d.resizeCanvas();
                
                // Handle mobile/desktop layout
                if (window.innerWidth > 968) {
                    // Show all content on desktop
                    document.querySelectorAll('.mobile-tab-content').forEach(content => {
                        content.classList.add('active');
                    });
                } else {
                    // On mobile, ensure only the currently selected tab is active
                    const activeTab = document.querySelector('.mobile-tab-button.active');
                    if (activeTab) {
                        const tabName = activeTab.getAttribute('data-tab');
                        this.switchMobileTab(tabName);
                    }
                }
            }, 100);
        });
        
        // File upload (only if elements exist - not in FluidNC version)
        const uploadZone = document.getElementById('upload-zone');
        const fileInput = document.getElementById('file-input');
        
        if (uploadZone && fileInput) {
            uploadZone.addEventListener('click', () => fileInput.click());
            
            uploadZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadZone.classList.add('drag-over');
            });
            
            uploadZone.addEventListener('dragleave', () => {
                uploadZone.classList.remove('drag-over');
            });
            
            uploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZone.classList.remove('drag-over');
                
                if (e.dataTransfer.files.length > 0) {
                    this.loadFile(e.dataTransfer.files[0]);
                }
            });
            
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.loadFile(e.target.files[0]);
                }
            });
        }
        
        // View toggle
        const btnToggleView = document.getElementById('btn-toggle-view');
        if (btnToggleView) {
            btnToggleView.addEventListener('click', () => {
                this.toggleView();
            });
        }
        
        // Reset view button
        const btnResetView = document.getElementById('btn-reset-view');
        if (btnResetView) {
            btnResetView.addEventListener('click', () => {
                if (this.segments.length > 0) {
                    this.camera.fitToBounds(this.bounds, 0.1, this.canvas2d.width, this.canvas2d.height);
                    this.updateZoomSlider();
                }
            });
        }
        
        // Animation controls
        const btnPlay = document.getElementById('btn-play');
        if (btnPlay) {
            btnPlay.addEventListener('click', () => {
                this.togglePlayback();
            });
        }
        
        const btnReset = document.getElementById('btn-reset');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.animator.reset();
            });
        }
        
        const btnNext = document.getElementById('btn-next');
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                this.animator.stepNext();
            });
        }
        
        const btnPrev = document.getElementById('btn-prev');
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                this.animator.stepPrev();
            });
        }
        
        const speedSlider = document.getElementById('speed-slider');
        const speedLabel = document.getElementById('speed-label');
        if (speedSlider && speedLabel) {
            speedSlider.addEventListener('input', (e) => {
                const speed = Animator.sliderToSpeed(parseFloat(e.target.value));
                this.animator.setSpeed(speed);
                speedLabel.textContent = speed.toFixed(1) + 'x';
            });
        }
        
        // Line slider
        const lineSlider = document.getElementById('line-slider');
        if (lineSlider) {
            lineSlider.addEventListener('input', (e) => {
                const lineNum = parseInt(e.target.value);
                this.animator.setCurrentLine(lineNum);
            });
        }
        
        // Layer filter
        const layerMin = document.getElementById('layer-min');
        const layerMax = document.getElementById('layer-max');
        if (layerMin) {
            layerMin.addEventListener('input', () => {
                this.updateLayerFilter();
            });
        }
        if (layerMax) {
            layerMax.addEventListener('input', () => {
                this.updateLayerFilter();
            });
        }
        
        // Zoom slider
        const zoomSlider = document.getElementById('zoom-slider');
        const zoomValue = document.getElementById('zoom-value');
        if (zoomSlider && zoomValue) {
            zoomSlider.addEventListener('input', (e) => {
                const relativeZoom = parseFloat(e.target.value);
                // Convert relative zoom to absolute zoom
                if (this.currentView === '2d') {
                    const absoluteZoom = relativeZoom * this.camera.initialZoom2d;
                    this.setZoom(absoluteZoom);
                } else {
                    const absoluteScale = this.camera.initialOrthoScale / relativeZoom;
                    this.camera.orthoScale = absoluteScale;
                    this.render();
                }
                zoomValue.textContent = Math.round(relativeZoom * 100) + '%';
            });
        }
        
        // Theme toggle buttons
        const themeLightBtn = document.getElementById('theme-light');
        const themeDarkBtn = document.getElementById('theme-dark');
        
        if (themeLightBtn && themeDarkBtn) {
            // Set initial theme from localStorage or default to light
            const savedTheme = localStorage.getItem('theme') || 'light';
            document.documentElement.setAttribute('data-theme', savedTheme);
            
            themeLightBtn.addEventListener('click', () => {
                document.documentElement.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
                this.render();
            });
            
            themeDarkBtn.addEventListener('click', () => {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
                this.render();
            });
        }
        
        // Grid controls (no action needed - renderer checks these values each frame)
        const gridEnabled = document.getElementById('grid-enabled');
        if (gridEnabled) {
            gridEnabled.addEventListener('change', () => {
                // Render loop will automatically pick up the change
            });
        }
        
        const gridWidth = document.getElementById('grid-width');
        if (gridWidth) {
            gridWidth.addEventListener('input', () => {
                // Render loop will automatically pick up the change
            });
        }
        
        const gridHeight = document.getElementById('grid-height');
        if (gridHeight) {
            gridHeight.addEventListener('input', () => {
                // Render loop will automatically pick up the change
            });
        }
        
        // Rapid moves (G0) controls
        const rapidVisibleCheckbox = document.getElementById('rapid-moves-visible');
        const rapidColorPicker = document.getElementById('rapid-move-color');
        
        if (rapidVisibleCheckbox) {
            rapidVisibleCheckbox.addEventListener('change', () => {
                this.rapidMovesVisible = rapidVisibleCheckbox.checked;
                this.updateRenderers();
            });
        }
        
        if (rapidColorPicker) {
            rapidColorPicker.addEventListener('input', () => {
                this.rapidMoveColor = rapidColorPicker.value;
                this.updateRenderers();
            });
        }
        
        // Mouse events for canvas
        this.setupCanvasEvents();
        
        // Keyboard events
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') this.isShiftPressed = true;
        });
        
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') this.isShiftPressed = false;
        });
    }

    /**
     * Setup canvas mouse/touch events
     */
    setupCanvasEvents() {
        const canvas2d = this.canvas2d;
        const canvas3d = this.canvas3d;
        
        // Mouse events
        const onMouseDown = (e) => {
            this.isDragging = true;
            this.dragButton = e.button; // 0 = left, 2 = right
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            
            // Prevent context menu on right-click
            if (e.button === 2) {
                e.preventDefault();
            }
        };
        
        const onMouseMove = (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                
                if (this.currentView === '2d') {
                    this.camera.pan2D(dx, dy);
                } else {
                    // In 3D: left-click = rotate, right-click = pan
                    if (this.dragButton === 2) {
                        this.camera.pan3D(dx, dy);
                    } else {
                        this.camera.rotate(dx, dy);
                    }
                }
                
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
            } else if (this.currentView === '2d') {
                // Update coordinate display
                const rect = canvas2d.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const world = this.renderer2d.canvasToWorld(x, y);
                this.updateCoordinateDisplay(world.x, world.y, 0);
            }
        };
        
        const onMouseUp = () => {
            this.isDragging = false;
        };
        
        const onWheel = (e) => {
            e.preventDefault();
            
            if (this.currentView === '2d') {
                const rect = canvas2d.getBoundingClientRect();
                const canvasX = e.clientX - rect.left;
                const canvasY = e.clientY - rect.top;
                
                this.camera.zoom2D(e.deltaY, canvasX, canvasY, canvas2d.width, canvas2d.height);
            } else {
                this.camera.zoom3D(e.deltaY);
            }
            this.updateZoomSlider();
        };
        
        const onDoubleClick = () => {
            if (this.bounds) {
                this.camera.fitToBounds(this.bounds);
            }
        };
        
        const onContextMenu = (e) => {
            e.preventDefault(); // Prevent right-click menu
        };
        
        // Add listeners to both canvases
        [canvas2d, canvas3d].forEach(canvas => {
            canvas.addEventListener('mousedown', onMouseDown);
            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('mouseup', onMouseUp);
            canvas.addEventListener('mouseleave', onMouseUp);
            canvas.addEventListener('wheel', onWheel, { passive: false });
            canvas.addEventListener('dblclick', onDoubleClick);
            canvas.addEventListener('contextmenu', onContextMenu);
        });
        
        // Touch events
        const onTouchStart = (e) => {
            e.preventDefault();
            this.touches = Array.from(e.touches);
            
            if (this.touches.length === 1) {
                this.isDragging = true;
                this.lastMouseX = this.touches[0].clientX;
                this.lastMouseY = this.touches[0].clientY;
            } else if (this.touches.length === 2) {
                this.lastPinchDistance = this.getTouchDistance(this.touches[0], this.touches[1]);
                this.lastTouchCenter = this.getTouchCenter(this.touches[0], this.touches[1]);
            }
        };
        
        const onTouchMove = (e) => {
            e.preventDefault();
            this.touches = Array.from(e.touches);
            
            if (this.touches.length === 1 && this.isDragging) {
                const dx = this.touches[0].clientX - this.lastMouseX;
                const dy = this.touches[0].clientY - this.lastMouseY;
                
                if (this.currentView === '2d') {
                    this.camera.pan2D(dx, dy);
                } else {
                    // Single finger = rotate in 3D (with touch-friendly sensitivity)
                    this.camera.rotate(dx * 1.5, dy * 1.5);
                }
                
                this.lastMouseX = this.touches[0].clientX;
                this.lastMouseY = this.touches[0].clientY;
            } else if (this.touches.length === 2) {
                const distance = this.getTouchDistance(this.touches[0], this.touches[1]);
                const center = this.getTouchCenter(this.touches[0], this.touches[1]);
                const delta = distance - this.lastPinchDistance;
                
                if (this.currentView === '2d') {
                    // Only zoom if delta is reasonable (not first move with huge delta)
                    if (Math.abs(delta) < 100 && Math.abs(delta) > 0.5) {
                        const rect = canvas2d.getBoundingClientRect();
                        const canvasX = center.x - rect.left;
                        const canvasY = center.y - rect.top;
                        const world = this.renderer2d.canvasToWorld(canvasX, canvasY);
                        
                        // Use delta for smooth pinch zoom (pass true for touch input)
                        this.camera.zoom2D(-delta, canvasX, canvasY, rect.width, rect.height, true);
                    }
                } else {
                    // Two-finger pan in 3D (prioritize pan over zoom)
                    if (this.lastTouchCenter) {
                        const dx = center.x - this.lastTouchCenter.x;
                        const dy = center.y - this.lastTouchCenter.y;
                        const panDistance = Math.sqrt(dx * dx + dy * dy);
                        
                        // If moving significantly, treat as pan
                        if (panDistance > 2) {
                            this.camera.pan3D(dx * 2, dy * 2);
                        }
                    }
                    
                    // Two-finger pinch = zoom in 3D (inverted and increased sensitivity)
                    if (Math.abs(delta) > 5) {
                        this.camera.zoom3D(-delta * 0.003);
                    }
                }
                
                this.lastPinchDistance = distance;
                this.lastTouchCenter = center;
            }
        };
        
        const onTouchEnd = () => {
            this.isDragging = false;
            this.touches = [];
            this.lastTouchCenter = null;
        };
        
        [canvas2d, canvas3d].forEach(canvas => {
            canvas.addEventListener('touchstart', onTouchStart, { passive: false });
            canvas.addEventListener('touchmove', onTouchMove, { passive: false });
            canvas.addEventListener('touchend', onTouchEnd, { passive: false });
        });
    }

    /**
     * Get distance between two touches
     */
    getTouchDistance(touch1, touch2) {
        const dx = touch2.clientX - touch1.clientX;
        const dy = touch2.clientY - touch1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get center point between two touches
     */
    getTouchCenter(touch1, touch2) {
        return {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2
        };
    }

    /**
     * Setup animator callbacks
     */
    setupAnimator() {
        this.animator.onUpdate = (index, segmentProgress = 1) => {
            this.renderer2d.setMaxSegmentIndex(index, segmentProgress);
            this.renderer3d.setMaxSegmentIndex(index, segmentProgress);
            
            document.getElementById('current-line').textContent = index;
            document.getElementById('line-slider').value = index;
            
            // Update current position and file line number
            if (index < this.segments.length) {
                const segment = this.segments[index];
                this.currentPosition = { x: segment.x1, y: segment.y1, z: segment.z1 };
                this.highlightGCodeLine(segment.lineNum);
                document.getElementById('current-file-line').textContent = segment.lineNum || '-';
                
                // Update active tool highlighting if tool changed
                const currentTool = segment.tool || 0;
                if (this.currentActiveTool !== currentTool) {
                    this.currentActiveTool = currentTool;
                    this.updateActiveToolHighlight();
                }
            } else {
                document.getElementById('current-file-line').textContent = '-';
            }
            
            const playBtn = document.getElementById('btn-play');
            playBtn.textContent = this.animator.getIsPlaying() ? 'Pause' : 'Play';
        };
    }

    /**
     * Load GCode file
     */
    async loadFile(file) {
        const progressBar = document.getElementById('progress-bar');
        const progressFill = document.getElementById('progress-fill');
        
        progressBar.classList.remove('hidden');
        progressFill.style.width = '0%';
        
        try {
            // Read file text for display
            const text = await file.text();
            this.gcodeText = text;
            
            const segments = await this.parser.parseFile(file, (percent) => {
                progressFill.style.width = percent + '%';
            });
            
            this.segments = segments;
            this.bounds = this.parser.getBounds();
            
            // Detect tools used in the file
            this.detectTools(segments);
            
            // Update renderers
            this.renderer2d.setSegments(segments, this.bounds);
            this.renderer3d.setSegments(segments, this.bounds);
            
            // Update renderers with tool states (colors and visibility)
            this.updateRenderers();
            
            // Update animator
            this.animator.setSegments(segments);
            
            // Fit camera to bounds
            this.camera.fitToBounds(this.bounds, 0.1, this.canvas2d.width, this.canvas2d.height);
            
            // Update UI
            this.updateStatistics();
            this.displayGCode(text);
            this.updateToolPanel();
            const gcodePanel = document.getElementById('gcode-panel');
            gcodePanel.style.visibility = 'visible';
            gcodePanel.style.position = 'static';
            document.getElementById('animation-panel').style.display = 'block';
            document.getElementById('tool-panel').style.display = 'block';
            const rapidMovesPanel = document.getElementById('rapid-moves-panel');
            if (rapidMovesPanel) rapidMovesPanel.style.display = 'block';
            document.getElementById('btn-reset-view').disabled = false;
            
            // Show GCode sidebar and hide welcome panel
            const leftSidebar = document.querySelector('.left-sidebar');
            if (leftSidebar) leftSidebar.classList.remove('gcode-hidden');
            const welcomePanel = document.getElementById('gcode-welcome');
            if (welcomePanel) welcomePanel.style.display = 'none';
            
            // Setup line slider
            const lineSlider = document.getElementById('line-slider');
            lineSlider.max = segments.length;
            lineSlider.value = 0;
            document.getElementById('total-lines').textContent = segments.length;
            
            setTimeout(() => {
                progressBar.classList.add('hidden');
            }, 500);
            
        } catch (error) {
            console.error('Error loading file:', error);
            alert('Error loading GCode file. Please check the console for details.');
            progressBar.classList.add('hidden');
        }
    }

    /**
     * Load GCode from a string (for generated GCode, no file upload)
     * @param {string} gcodeText - The GCode text to parse and display
     * @param {string} idPrefix - Optional prefix for element IDs (e.g., 'preview-')
     */
    async loadGCodeFromString(gcodeText, idPrefix = '') {
        const progressBar = document.getElementById(`${idPrefix}progress-bar`);
        const progressFill = document.getElementById(`${idPrefix}progress-fill`);
        
        // Debug: Check if string is corrupted on entry
        const problemLines = gcodeText.split('\n').filter(line => /Y\d{5,}/.test(line));
        if (problemLines.length > 0) {
            console.error(`CONTROLLER ERROR: String has ${problemLines.length} bad lines:`, problemLines.slice(0, 2));
        } else {
            console.log('✓ Controller OK: String is clean in loadGCodeFromString');
        }
        
        if (progressBar) {
            progressBar.classList.remove('hidden');
            progressFill.style.width = '0%';
        }
        
        try {
            this.gcodeText = gcodeText;
            
            // Parse string directly instead of going through Blob/File/FileReader
            // to avoid chunking corruption issues
            const segments = await this.parser.parseString(gcodeText, (percent) => {
                if (progressFill) progressFill.style.width = percent + '%';
            });
            
            this.segments = segments;
            this.bounds = this.parser.getBounds();
            
            // Detect tools used in the file
            this.detectTools(segments);
            
            // Update renderers
            this.renderer2d.setSegments(segments, this.bounds);
            this.renderer3d.setSegments(segments, this.bounds);
            
            // Update renderers with tool states (colors and visibility)
            this.updateRenderers();
            
            // Update animator
            this.animator.setSegments(segments);
            
            // Fit camera to bounds
            this.camera.fitToBounds(this.bounds, 0.1, this.canvas2d.width, this.canvas2d.height);
            
            // Update UI
            this.updateStatistics(idPrefix);
            this.displayGCode(gcodeText, idPrefix);
            this.updateToolPanel(idPrefix);
            
            const gcodePanel = document.getElementById(`${idPrefix}gcode-panel`);
            if (gcodePanel) {
                gcodePanel.style.visibility = 'visible';
                gcodePanel.style.position = 'static';
            }
            
            const animationPanel = document.getElementById(`${idPrefix}animation-panel`);
            if (animationPanel) animationPanel.style.display = 'block';
            
            const toolPanel = document.getElementById(`${idPrefix}tool-panel`);
            if (toolPanel) toolPanel.style.display = 'block';
            
            const rapidMovesPanel = document.getElementById(`${idPrefix}rapid-moves-panel`);
            if (rapidMovesPanel) rapidMovesPanel.style.display = 'block';
            
            const resetBtn = document.getElementById(`${idPrefix}btn-reset-view`);
            if (resetBtn) resetBtn.disabled = false;
            
            // Show GCode sidebar and hide welcome panel
            const leftSidebar = document.querySelector(idPrefix ? `.${idPrefix}left-sidebar` : '.left-sidebar');
            if (leftSidebar) leftSidebar.classList.remove('gcode-hidden');
            
            const welcomePanel = document.getElementById(`${idPrefix}gcode-welcome`);
            if (welcomePanel) welcomePanel.style.display = 'none';
            
            // Setup line slider
            const lineSlider = document.getElementById(`${idPrefix}line-slider`);
            if (lineSlider) {
                lineSlider.max = segments.length;
                lineSlider.value = 0;
            }
            
            const totalLinesSpan = document.getElementById(`${idPrefix}total-lines`);
            if (totalLinesSpan) totalLinesSpan.textContent = segments.length;
            
            // Render initial view
            if (this.is3DView) {
                this.renderer3d.render();
            } else {
                this.renderer2d.render();
            }
            
            if (progressBar) {
                setTimeout(() => {
                    progressBar.classList.add('hidden');
                }, 500);
            }
            
        } catch (error) {
            console.error('Error loading GCode:', error);
            alert('Error parsing GCode. Please check the console for details.');
            if (progressBar) progressBar.classList.add('hidden');
        }
    }
    
    /**
     * Detect tools used in segments
     */
    detectTools(segments) {
        const toolSet = new Set();
        for (const seg of segments) {
            if (seg.type !== 'rapid') {
                toolSet.add(seg.tool || 1);
            }
        }
        
        // Get tool names and custom colors from parser
        const toolNames = this.parser.getToolNames();
        const toolColors = this.parser.getToolColors();
        const usingInlineFormat = this.parser.usingInlineToolFormat;
        
        // Initialize tool states
        // Estlcam: tool numbers 1-based, array 0-based, so tool-1 for index
        // Inline: "No Tool" is tool 0 at index 0, other tools at indices 1, 2, 3...
        this.tools.clear();
        const sortedTools = Array.from(toolSet).sort((a, b) => a - b);
        for (const tool of sortedTools) {
            const toolIndex = usingInlineFormat ? tool : tool - 1; // Inline uses direct index, Estlcam uses tool-1
            const customColor = toolColors[toolIndex];
            const colorIndex = tool % this.toolColors.length;
            const defaultColor = this.toolColors[colorIndex];
            
            this.tools.set(tool, {
                visible: true,
                color: customColor || defaultColor,
                name: toolNames[toolIndex] || `Tool ${tool}`
            });
        }
    }
    
    /**
     * Update tool panel UI
     */
    updateToolPanel(idPrefix = '') {
        const toolList = document.getElementById(`${idPrefix}tool-list`);
        if (!toolList) return;
        
        toolList.innerHTML = '';
        
        if (this.tools.size === 0) {
            toolList.innerHTML = '<div style="padding: 10px; opacity: 0.7; font-size: 12px;">No tools detected</div>';
            return;
        }
        
        for (const [toolNum, toolState] of this.tools) {
            const toolDiv = document.createElement('div');
            toolDiv.className = 'tool-item';
            toolDiv.setAttribute('data-tool', toolNum);
            toolDiv.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px; background: var(--canvas-bg); border-radius: 4px; transition: border 0.2s, box-shadow 0.2s;';
            
            // Visibility checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = toolState.visible;
            checkbox.onchange = () => {
                toolState.visible = checkbox.checked;
                this.updateRenderers();
            };
            
            // Color picker
            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.value = toolState.color;
            colorPicker.style.cssText = 'width: 32px; height: 24px; border: none; cursor: pointer;';
            colorPicker.onchange = () => {
                toolState.color = colorPicker.value;
                this.updateRenderers();
            };
            
            // Tool label with estimated time
            const infoDiv = document.createElement('div');
            infoDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';
            
            const nameSpan = document.createElement('span');
            const toolName = toolState.name ? `Tool ${toolNum} - ${toolState.name}` : `Tool ${toolNum}`;
            nameSpan.textContent = toolName;
            nameSpan.style.cssText = 'font-size: 13px;';
            
            const timeSpan = document.createElement('span');
            const toolTime = this.animator.getToolTime(toolNum);
            timeSpan.textContent = `Est. Time: ${toolTime}`;
            timeSpan.style.cssText = 'font-size: 11px; opacity: 0.7;';
            
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(timeSpan);
            
            toolDiv.appendChild(checkbox);
            toolDiv.appendChild(colorPicker);
            toolDiv.appendChild(infoDiv);
            toolList.appendChild(toolDiv);
        }
    }
    
    /**
     * Update active tool highlighting in tool panel
     */
    updateActiveToolHighlight() {
        // Remove highlighting from all tools
        const toolItems = document.querySelectorAll('.tool-item');
        toolItems.forEach(item => {
            item.style.border = 'none';
            item.style.boxShadow = 'none';
        });
        
        // Add highlighting to active tool
        if (this.currentActiveTool !== undefined) {
            const activeToolItem = document.querySelector(`.tool-item[data-tool="${this.currentActiveTool}"]`);
            if (activeToolItem) {
                activeToolItem.style.border = '2px solid var(--cut-color)';
                activeToolItem.style.boxShadow = '0 0 8px rgba(0, 204, 255, 0.3)';
            }
        }
    }
    
    /**
     * Update renderers with current tool states
     */
    updateRenderers() {
        this.renderer2d.setToolStates(this.tools);
        this.renderer3d.setToolStates(this.tools);
        this.renderer2d.setRapidMoveSettings(this.rapidMovesVisible, this.rapidMoveColor);
        this.renderer3d.setRapidMoveSettings(this.rapidMovesVisible, this.rapidMoveColor);
        this.renderer2d.updateBuffers();
        this.renderer3d.updateBuffers();
    }
    
    /**
     * Update statistics panel
     */
    updateStatistics(idPrefix = '') {
        const statLines = document.getElementById(`${idPrefix}stat-lines`);
        const statTime = document.getElementById(`${idPrefix}stat-time`);
        const statX = document.getElementById(`${idPrefix}stat-x`);
        const statY = document.getElementById(`${idPrefix}stat-y`);
        const statZ = document.getElementById(`${idPrefix}stat-z`);
        const totalLines = document.getElementById(`${idPrefix}total-lines`);
        const currentLine = document.getElementById(`${idPrefix}current-line`);
        const layerMin = document.getElementById(`${idPrefix}layer-min`);
        const layerMax = document.getElementById(`${idPrefix}layer-max`);
        
        if (statLines) statLines.textContent = this.segments.length;
        if (statTime) statTime.textContent = this.animator.getFormattedTime();
        
        if (statX) statX.textContent = 
            `${this.bounds.minX.toFixed(1)} to ${this.bounds.maxX.toFixed(1)}`;
        if (statY) statY.textContent = 
            `${this.bounds.minY.toFixed(1)} to ${this.bounds.maxY.toFixed(1)}`;
        if (statZ) statZ.textContent = 
            `${this.bounds.minZ.toFixed(1)} to ${this.bounds.maxZ.toFixed(1)}`;
        
        if (totalLines) totalLines.textContent = this.segments.length;
        if (currentLine) currentLine.textContent = '0';
        
        // Set layer filter defaults
        if (layerMin) layerMin.placeholder = this.bounds.minZ.toFixed(1);
        if (layerMax) layerMax.placeholder = this.bounds.maxZ.toFixed(1);
    }

    /**
     * Update coordinate display
     */
    updateCoordinateDisplay(x, y, z) {
        const coordsElement = document.getElementById('coordinates');
        if (coordsElement) {
            coordsElement.textContent = `X: ${x.toFixed(2)} Y: ${y.toFixed(2)} Z: ${z.toFixed(2)}`;
        }
    }

    /**
     * Display GCode text with virtual scrolling for large files
     */
    displayGCode(text, idPrefix = '') {
        const container = document.getElementById(`${idPrefix}gcode-container`);
        if (!container) return;
        
        const lines = text.split('\n');
        const totalLines = lines.length;
        
        // Store data for virtual scrolling
        this.gcodeLines = lines;
        this.gcodeLineHeight = 17;
        this.gcodeCurrentHighlight = null;
        
        const lineIndicator = document.getElementById(`${idPrefix}gcode-line-indicator`);
        if (lineIndicator) {
            lineIndicator.textContent = `(${totalLines} lines)`;
        }
        
        // Create structure with proper scrollable height (add extra lines for buffer)
        container.innerHTML = `
            <div style="min-height: ${(totalLines + 10) * this.gcodeLineHeight}px; position: relative; width: max-content; min-width: 100%;">
                <div id="${idPrefix}gcode-viewport" style="position: absolute; top: 0; left: 0; will-change: transform;">
                    <div style="display: flex;">
                        <div class="gcode-line-numbers" id="${idPrefix}gcode-line-numbers"></div>
                        <div class="gcode-code" id="${idPrefix}gcode-display"></div>
                    </div>
                </div>
            </div>
        `;
        
        const viewport = document.getElementById(`${idPrefix}gcode-viewport`);
        const displayDiv = document.getElementById(`${idPrefix}gcode-display`);
        const lineNumbersDiv = document.getElementById(`${idPrefix}gcode-line-numbers`);
        
        let lastStartLine = -1;
        
        const renderVisibleLines = (force = false) => {
            const scrollTop = container.scrollTop;
            let containerHeight = container.clientHeight;
            
            // Fallback if container height is not available yet
            if (!containerHeight || containerHeight === 0) {
                containerHeight = container.offsetHeight || window.innerHeight * 0.5;
            }
            
            const startLine = Math.max(0, Math.floor(scrollTop / this.gcodeLineHeight) - 50);
            const endLine = Math.min(totalLines, startLine + Math.ceil(containerHeight / this.gcodeLineHeight) + 150);
            
            // Only re-render if we've scrolled significantly or forced
            if (!force && startLine === lastStartLine) return;
            lastStartLine = startLine;
            
            // Position viewport
            viewport.style.transform = `translateY(${startLine * this.gcodeLineHeight}px)`;
            
            // Build line numbers
            const lineNumbersHTML = [];
            for (let i = startLine; i < endLine; i++) {
                const highlight = this.gcodeCurrentHighlight === (i + 1) ? ' highlight' : '';
                lineNumbersHTML.push(`<div class="gcode-line${highlight}" data-line="${i + 1}">${i + 1}</div>`);
            }
            lineNumbersDiv.innerHTML = lineNumbersHTML.join('');
            
            // Build code with syntax highlighting
            const codeHTML = [];
            for (let i = startLine; i < endLine; i++) {
                const highlight = this.gcodeCurrentHighlight === (i + 1) ? ' highlight' : '';
                const highlighted = this.syntaxHighlightGCode(lines[i]);
                codeHTML.push(`<div class="gcode-line${highlight}" data-line="${i + 1}">${highlighted || '&nbsp;'}</div>`);
            }
            displayDiv.innerHTML = codeHTML.join('');
        };
        
        // Store render function for use in highlightGCodeLine
        this.gcodeRenderVisibleLines = renderVisibleLines;
        
        // Scroll event with requestAnimationFrame for smooth performance
        let ticking = false;
        container.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    renderVisibleLines();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
        
        // Initial render - use requestAnimationFrame and timeout to ensure container has dimensions
        renderVisibleLines(true);
        requestAnimationFrame(() => renderVisibleLines(true));
        setTimeout(() => renderVisibleLines(true), 100);
        
        // Click handler with event delegation
        container.addEventListener('click', (e) => {
            const lineDiv = e.target.closest('.gcode-line');
            if (!lineDiv) return;
            
            const lineNumber = parseInt(lineDiv.dataset.line);
            if (!lineNumber) return;
            
            const segmentIndex = this.segments.findIndex(seg => seg.lineNum >= lineNumber);
            if (segmentIndex !== -1) {
                this.animator.currentIndex = segmentIndex;
                this.animator.onUpdate(segmentIndex);
                
                if (this.currentView === '2d') {
                    this.renderer2d.render();
                } else {
                    this.renderer3d.render();
                }
                
                this.highlightGCodeLine(lineNumber);
            }
        });
    }
    
    /**
     * Syntax highlight a single GCode line
     */
    syntaxHighlightGCode(line) {
        // Handle comments - both semicolon and parenthesis styles
        let result = line;
        let parts = [];
        let currentPos = 0;
        
        // Find all comment sections
        const semiIndex = line.indexOf(';');
        const parenStart = line.indexOf('(');
        const parenEnd = line.indexOf(')');
        
        // Handle parenthesis comments first (can be inline)
        if (parenStart !== -1 && parenEnd !== -1 && parenEnd > parenStart) {
            // Before comment
            parts.push({ text: line.substring(0, parenStart), isComment: false });
            // Comment
            parts.push({ text: line.substring(parenStart, parenEnd + 1), isComment: true });
            // After comment
            parts.push({ text: line.substring(parenEnd + 1), isComment: false });
        }
        // Handle semicolon comments (rest of line is comment)
        else if (semiIndex !== -1) {
            parts.push({ text: line.substring(0, semiIndex), isComment: false });
            parts.push({ text: line.substring(semiIndex), isComment: true });
        }
        // No comments
        else {
            parts.push({ text: line, isComment: false });
        }
        
        // Process each part
        result = parts.map(part => {
            if (part.isComment) {
                return `<span class="gcode-comment">${this.escapeHtml(part.text)}</span>`;
            }
            
            let code = part.text;
            
            // Highlight system commands ($ at start of word)
            code = code.replace(/\$([A-Za-z0-9\/=]+)/g, '<span class="gcode-system">$$$1</span>');
            
            // Highlight G-codes
            code = code.replace(/\b([GM])(\d+(\.\d+)?)/gi, (match, letter, number) => {
                const className = letter.toUpperCase() === 'G' ? 'gcode-g-code' : 'gcode-m-code';
                return `<span class="${className}">${letter}${number}</span>`;
            });
            
            // Highlight T-codes (tool changes) - no word boundary needed after letter
            code = code.replace(/\b(T)(\d+)/gi, '<span class="gcode-t-code">$1$2</span>');
            
            // Highlight S-codes (spindle speed) - no word boundary needed after letter
            code = code.replace(/\b(S)(\d+(\.\d+)?)/gi, '<span class="gcode-s-code">$1$2</span>');
            
            // Highlight coordinates - X, Y, Z get their own colors, others use generic coordinate color
            code = code.replace(/([X])([-+]?\d+(\.\d+)?)/gi, '<span class="gcode-x-axis">$1$2</span>');
            code = code.replace(/([Y])([-+]?\d+(\.\d+)?)/gi, '<span class="gcode-y-axis">$1$2</span>');
            code = code.replace(/([Z])([-+]?\d+(\.\d+)?)/gi, '<span class="gcode-z-axis">$1$2</span>');
            code = code.replace(/([ABCIJK])([-+]?\d+(\.\d+)?)/gi, '<span class="gcode-coordinate">$1$2</span>');
            
            // Highlight F-codes (feed rate) - must come after coordinates since F can follow them without space
            code = code.replace(/([F])(\d+(\.\d+)?)/gi, '<span class="gcode-f-code">$1$2</span>');
            
            return code;
        }).join('');
        
        return result;
    }
    
    /**
     * Escape HTML special characters
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Highlight specific line in GCode display
     */
    highlightGCodeLine(lineNum) {
        const container = document.getElementById('gcode-container');
        
        if (lineNum < 1 || !container) return;
        
        // Store current highlight
        this.gcodeCurrentHighlight = lineNum;
        
        // Check if highlighted line is visible in current viewport (with smaller buffer)
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight || 600;
        const lineTop = (lineNum - 1) * this.gcodeLineHeight;
        const lineBottom = lineTop + this.gcodeLineHeight;
        const viewportTop = scrollTop;
        const viewportBottom = scrollTop + containerHeight;
        
        // Keep line in center 60% of viewport
        const bufferZone = containerHeight * 0.2;
        const isVisible = lineTop >= viewportTop + bufferZone && 
                         lineBottom <= viewportBottom - bufferZone;
        
        if (isVisible && this.gcodeRenderVisibleLines) {
            // Line is visible, force a re-render to update highlights properly
            this.gcodeRenderVisibleLines(true);
        } else {
            // Line not visible, scroll to center it (will trigger re-render via scroll event)
            const targetScroll = lineTop - containerHeight / 2 + this.gcodeLineHeight / 2;
            container.scrollTop = Math.max(0, targetScroll);
        }
    }

    /**
     * Update layer filter
     */
    updateLayerFilter() {
        const minInput = document.getElementById('layer-min');
        const maxInput = document.getElementById('layer-max');
        
        const min = minInput.value ? parseFloat(minInput.value) : -Infinity;
        const max = maxInput.value ? parseFloat(maxInput.value) : Infinity;
        
        this.renderer2d.setLayerFilter(min, max);
        this.renderer3d.setLayerFilter(min, max);
    }

    /**
     * Set zoom level
     */
    setZoom(zoom) {
        if (this.currentView === '2d') {
            this.camera.zoom2d = zoom;
            this.camera.targetZoom2d = zoom;
        } else {
            // For 3D, adjust ortho scale
            const baseScale = 100; // Base scale when zoom = 1
            this.camera.orthoScale = baseScale / zoom;
        }
    }

    /**
     * Toggle between 2D and 3D views
     */
    toggleView() {
        if (this.currentView === '2d') {
            this.currentView = '3d';
            this.canvas2d.classList.add('hidden');
            this.canvas3d.classList.remove('hidden');
            this.canvas3dOverlay.classList.remove('hidden');
            document.getElementById('btn-toggle-view').textContent = '2D View';
        } else {
            this.currentView = '2d';
            this.canvas3d.classList.add('hidden');
            this.canvas3dOverlay.classList.add('hidden');
            this.canvas2d.classList.remove('hidden');
            document.getElementById('btn-toggle-view').textContent = '3D View';
        }
        
        // Update zoom slider to reflect current view's zoom
        this.updateZoomSlider();
    }

    /**
     * Update zoom slider to reflect current zoom level
     */
    updateZoomSlider() {
        const slider = document.getElementById('zoom-slider');
        const display = document.getElementById('zoom-value');
        
        let relativeZoom;
        if (this.currentView === '2d') {
            // Relative to initial fit-to-bounds zoom
            relativeZoom = this.camera.zoom2d / this.camera.initialZoom2d;
        } else {
            // Relative to initial orthoScale (smaller orthoScale = more zoomed in)
            relativeZoom = this.camera.initialOrthoScale / this.camera.orthoScale;
        }
        
        slider.value = relativeZoom;
        display.textContent = Math.round(relativeZoom * 100) + '%';
    }

    /**
     * Toggle animation playback
     */
    togglePlayback() {
        if (this.animator.getIsPlaying()) {
            this.animator.pause();
        } else {
            this.animator.play();
        }
    }

    /**
     * Switch mobile tab
     */
    switchMobileTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.mobile-tab-button').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
        });
        
        // Update tab content
        document.querySelectorAll('.mobile-tab-content').forEach(content => {
            content.classList.toggle('active', content.getAttribute('data-tab-content') === tabName);
        });
    }

    /**
     * Main render loop
     */
    startRenderLoop() {
        const render = () => {
            // Poll SpaceMouse input
            this.pollSpaceMouse();
            
            this.camera.update();
            
            if (this.currentView === '2d') {
                this.renderer2d.render();
            } else {
                this.renderer3d.render();
            }
            
            requestAnimationFrame(render);
        };
        
        render();
    }
}

// Initialize on page load (only for standalone viewer, not font-creator)
window.addEventListener('DOMContentLoaded', () => {
    // Check if this is the font-creator page by looking for the text-to-gcode tab
    if (!document.getElementById('text-to-gcode')) {
        new Controller();
    }
});
