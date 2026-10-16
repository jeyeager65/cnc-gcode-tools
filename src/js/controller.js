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

        // The viewer layout (viewer-ui.js), or null on pages with their own markup (Font Creator)
        this.ui = document.getElementById('vw');

        // Setup UI
        this.setupEventListeners();
        this.setupAnimator();
        this.setupSpaceMouse();
        this.setupMachineConfig();
        this.loadInputValues();
        if (this.ui) this.setupViewerUI();
        this.startRenderLoop();
    }

    /**
     * Values the user entered for parameters set outside a parametric file (FluidNC
     * globals such as #<_tool_radius>). Remembered across files and visits.
     */
    loadInputValues() {
        const saved = Prefs.getJSON('gcodeInputValues');
        if (saved && typeof saved === 'object') this.parser.inputValues = saved;
    }

    saveInputValues(values) {
        this.parser.inputValues = values;
        Prefs.setJSON('gcodeInputValues', values);
    }

    /**
     * The viewer layout's controls that the older page markup doesn't have: 2D/3D buttons,
     * zoom buttons, speed menu, view options, keyboard shortcuts, recent files. Opens in 3D.
     */
    setupViewerUI() {
        this.setView('3d');

        const on = (id, event, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(event, handler);
        };
        on('view-2d', 'click', () => this.setView('2d'));
        on('view-3d', 'click', () => this.setView('3d'));
        on('btn-fit-pop', 'click', () => this.fitView());
        on('btn-zoom-in', 'click', () => this.zoomStep(-1));
        on('btn-zoom-out', 'click', () => this.zoomStep(1));
        on('speed-select', 'change', (e) => this.animator.setSpeed(parseFloat(e.target.value)));
        on('btn-download-expanded', 'click', () => this.saveExpanded());

        // Axes and the tool marker can be hidden; remembered
        for (const [id, key, prop] of [['show-axes', 'vwShowAxes', 'showAxes'], ['show-tool', 'vwShowTool', 'showToolMarker']]) {
            const box = document.getElementById(id);
            if (!box) continue;
            box.checked = Prefs.getBool(key, true);
            this.renderer2d[prop] = this.renderer3d[prop] = box.checked;
            box.addEventListener('change', () => {
                Prefs.set(key, box.checked);
                this.renderer2d[prop] = this.renderer3d[prop] = box.checked;
            });
        }

        ViewerUI.onTabChange = (tab) => {
            // A file loaded while the view was hidden was fitted to a guessed size
            if (tab === 'view' && this.needsFit && this.bounds) {
                requestAnimationFrame(() => this.fitView());
            }
        };
        ViewerUI.onFileDrop = (file) => this.loadFile(file);

        window.addEventListener('keydown', (e) => this.handleShortcut(e));
        this.renderRecentFiles();
        this.setupDemo();
    }

    /**
     * The demo files (the build copies examples/viewer-demo to demo/ beside the page).
     * gcodeviewer.html?demo opens the whole job, ?demo=ViewerDemo_T4_vbit.nc one bit's
     * file, which builds on the earlier ones. Only over http(s): a page opened as a file
     * can't fetch them.
     */
    setupDemo() {
        if (!/^https?:$/.test(location.protocol) || !document.getElementById('upload-zone')) return;
        const empty = document.querySelector('#vw-empty');
        if (empty && !empty.querySelector('[data-action="demo"]')) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'vw-btn';
            button.dataset.action = 'demo';
            button.textContent = 'Try the demo file';
            button.addEventListener('click', () => this.loadDemo());
            empty.appendChild(button);
        }
        const demo = new URLSearchParams(location.search).get('demo');
        if (demo !== null) this.loadDemo(demo || undefined);
    }

    async loadDemo(name = 'ViewerDemo_ALL.nc') {
        await this.loadFromURL('demo/' + name.split(/[\\/]/).pop());
    }

    /**
     * Open a G-code file from a URL. Earlier jobs (PriorJob) are read from the same folder.
     */
    async loadFromURL(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            const name = decodeURIComponent(url.split('/').pop());
            await this.loadFile(new File([text], name, { type: 'text/plain' }), new URL('.', new URL(url, location.href)).href);
        } catch (e) {
            console.error('Could not open', url, e);
            alert(`Could not open ${url}: ${e.message}`);
        }
    }

    /**
     * Recent files (standalone viewer): the last few files opened, kept in IndexedDB so
     * they can be opened again (a browser can't reopen a file by its path). Files over
     * 25 MB aren't kept.
     */
    recentDB() {
        if (this.recentDBPromise) return this.recentDBPromise;
        this.recentDBPromise = new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open('cnc-gcode-viewer', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('recent', { keyPath: 'name' });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
        return this.recentDBPromise;
    }

    async recentFiles() {
        try {
            const db = await this.recentDB();
            const all = await new Promise((resolve, reject) => {
                const request = db.transaction('recent', 'readonly').objectStore('recent').getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
            return all.sort((a, b) => b.opened - a.opened);
        } catch (e) {
            return [];
        }
    }

    async rememberRecentFile(name, text) {
        if (!document.getElementById('recent-list') || text.length > 25 * 1024 * 1024) return;
        try {
            const db = await this.recentDB();
            const store = db.transaction('recent', 'readwrite').objectStore('recent');
            store.put({ name, text, size: text.length, opened: Date.now() });
            const keep = 6;
            const all = (await this.recentFiles()).filter(f => f.name !== name);
            if (all.length >= keep) {
                const old = db.transaction('recent', 'readwrite').objectStore('recent');
                all.slice(keep - 1).forEach(f => old.delete(f.name));
            }
        } catch (e) { /* IndexedDB unavailable: no recent files */ }
        this.renderRecentFiles();
    }

    async renderRecentFiles() {
        const list = document.getElementById('recent-list');
        if (!list) return;
        const files = await this.recentFiles();
        if (files.length === 0) {
            list.innerHTML = '<li class="vw-muted">Files you open appear here.</li>';
            return;
        }
        const ago = (t) => {
            const minutes = Math.round((Date.now() - t) / 60000);
            if (minutes < 1) return 'just now';
            if (minutes < 60) return `${minutes} min ago`;
            const hours = Math.round(minutes / 60);
            if (hours < 24) return `${hours} h ago`;
            return new Date(t).toLocaleDateString();
        };
        list.innerHTML = files.map(f => `<li><button type="button" data-name="${this.escapeHtml(f.name)}"` +
            `${f.name === this.fileName ? ' class="vw-recent-current"' : ''}>` +
            `<span class="vw-recent-name">${this.escapeHtml(f.name)}</span>` +
            `<span class="vw-recent-meta">${this.formatBytes(f.size)} · ${ago(f.opened)}</span></button></li>`).join('');
        list.querySelectorAll('button[data-name]').forEach(button => {
            button.addEventListener('click', async () => {
                const file = (await this.recentFiles()).find(f => f.name === button.dataset.name);
                if (file) this.loadFile(new File([file.text], file.name, { type: 'text/plain' }));
            });
        });
    }

    formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /**
     * A parametric file as plain G-code, expanded as it's drawn here (same machine and
     * entered values), with its comments and messages, for senders that can't expand it.
     * Returns { name, text } (part.nc -> part.expanded.nc), or null for a plain file.
     */
    expandedFile() {
        const exp = this.gcodeExpansion;
        if (!exp || !exp.output || typeof expandLines !== 'function') return null;
        const source = this.fileName || 'program.nc';
        const { output } = expandLines(exp.sourceText.split(/\r?\n/), source, {
            keepComments: true,
            machineValues: this.parser.machineValues,
            inputs: this.parser.inputValues
        });
        const name = /\.[^./\\]+$/.test(source)
            ? source.replace(/(\.[^./\\]+)$/, '.expanded$1')
            : source + '.expanded.nc';
        return { name, text: output };
    }

    /**
     * Download the expanded G-code. Hosts that can't download (the FigUI plugin's
     * sandbox) save it their own way.
     */
    saveExpanded() {
        const file = this.expandedFile();
        if (!file) return;
        const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Keyboard shortcuts: Space play/pause, arrows step, Home/End, [ ] speed, V 2D/3D.
     * Not while typing in a field or with a modifier key held.
     */
    handleShortcut(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const target = e.target;
        if (target && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) &&
            !(target.type === 'range' || target.type === 'checkbox')) return;
        if (this.segments.length === 0 || this.isRunning) return;
        const a = this.animator;
        switch (e.key) {
            case ' ':
                this.togglePlayback();
                break;
            case 'ArrowRight':
                a.pause();
                a.stepNext();
                break;
            case 'ArrowLeft':
                a.pause();
                a.stepPrev();
                break;
            case 'Home':
                a.reset();
                break;
            case 'End':
                a.setCurrentLine(this.segments.length);
                break;
            case '[':
            case ']':
                this.stepSpeed(e.key === ']' ? 1 : -1);
                break;
            case 'v':
            case 'V':
                this.setView(this.currentView === '2d' ? '3d' : '2d');
                break;
            default:
                return;
        }
        e.preventDefault();
    }

    /**
     * Next or previous entry of the speed menu
     */
    stepSpeed(direction) {
        const select = document.getElementById('speed-select');
        if (!select) return;
        const index = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + direction));
        select.selectedIndex = index;
        this.animator.setSpeed(parseFloat(select.value));
    }

    /**
     * Zoom buttons: one wheel notch in or out, about the middle of the view
     */
    zoomStep(direction) {
        if (this.currentView === '2d') {
            const w = this.canvas2d.width, h = this.canvas2d.height;
            this.camera.zoom2D(direction * 100, w / 2, h / 2, w, h);
        } else {
            this.camera.zoom3D(direction * 100);
        }
        this.updateZoomSlider();
    }

    /**
     * Fit the view to the toolpaths, or to the stock while it's shown, using the size of
     * the view as laid out now
     */
    fitView() {
        const bounds = this.viewBounds();
        if (!bounds) return;
        const box = this.canvas3d.parentElement.getBoundingClientRect();
        const width = box.width || this.canvas2d.width;
        const height = box.height || this.canvas2d.height;
        // Hidden (another phone tab): fit again when the view is shown
        this.needsFit = !(box.width > 0 && box.height > 0);
        this.camera.fitToBounds(bounds, 0.1, width, height);
        this.updateZoomSlider();
    }

    /**
     * Re-expand and redraw the current file, e.g. after entering outside values.
     * The FluidNC controller overrides this to go through its own loading path.
     */
    reloadCurrentGCode() {
        return this.loadGCodeFromString(this.gcodeText, this.gcodeIdPrefix || '');
    }

    /**
     * "Load config.yaml": FluidNC config values (#</axes/x/max_travel_mm> etc.) for
     * expanding parametric files offline. Remembered in localStorage across visits.
     * Only pages with the #btn-load-config control (the standalone viewer) use it.
     */
    setupMachineConfig() {
        const button = document.getElementById('btn-load-config');
        const input = document.getElementById('config-input');
        const clear = document.getElementById('btn-clear-config');
        if (!button || !input || typeof parseFluidNCConfig !== 'function') return;

        button.addEventListener('click', () => input.click());
        const chip = document.getElementById('btn-config-chip');
        if (chip) chip.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            const text = await file.text();
            this.setMachineConfig(text, file.name);
            Prefs.setJSON('machineConfig', { name: file.name, text });
            input.value = '';
        });
        if (clear) {
            clear.addEventListener('click', () => {
                this.setMachineConfig(null);
                Prefs.remove('machineConfig');
            });
        }

        const saved = Prefs.getJSON('machineConfig');
        if (saved && saved.text) this.setMachineConfig(saved.text, saved.name, false);
    }

    /**
     * Use (or, with null, stop using) a FluidNC config.yaml when expanding parametric files
     * @param {string|null} text - config.yaml contents
     * @param {string} [name] - file name, shown in the panel and in warnings
     * @param {boolean} [reload=true] - re-expand the current file so config values take effect
     */
    setMachineConfig(text, name, reload = true) {
        const config = text ? parseFluidNCConfig(text, name) : null;
        this.parser.machineValues = config;

        const status = document.getElementById('machine-config-status');
        const clear = document.getElementById('btn-clear-config');
        if (status) {
            status.textContent = !config ? (this.ui ? 'none' : 'No machine config loaded')
                : config.count ? `${name} (${config.count} values)`
                : `${name} (no numeric settings found)`;
            status.title = config ? 'Used for #</...> config values in parametric files' : '';
        }
        if (clear) clear.classList.toggle('hidden', !config);
        const chip = document.getElementById('btn-config-chip');
        if (chip) {
            chip.textContent = config ? name : 'config.yaml: none';
            chip.title = config ? `Machine config: ${name}. Click to load another` : 'Load a FluidNC config.yaml';
            chip.classList.toggle('vw-loaded', !!config);
        }
        this.updateGridSize();

        if (reload && this.gcodeText && this.parser.expansion) {
            this.loadGCodeFromString(this.gcodeText);
        }
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

        // "Object mode": the model follows the cap. Raw 3Dconnexion HID axis order is
        // X (right), Y (toward you), Z (down), then rotation about each of those:
        // Rx = tilt toward/away, Ry = tilt left/right (roll), Rz = twist.
        // If a motion feels reversed on your device, flip its `sign`; if it is on the
        // wrong control, change its `axis` (set window.spaceMouseDebug = true to log axes).
        const MAP = {
            panX:  { axis: 0, sign:  1 },  // push right -> model moves right
            panY:  { axis: 2, sign:  1 },  // push down  -> model moves down
            zoom:  { axis: 1, sign:  1 },  // pull toward you -> zoom out
            tilt:  { axis: 3, sign:  1 },  // tilt toward you -> top of the model tips toward you
            spin:  { axis: 5, sign: -1 },  // twist clockwise -> model turns clockwise about the screen's vertical
            roll:  { axis: 4, sign: -1 },  // tilt right -> model rolls clockwise on screen
        };
        // Rotations are about the screen axes, as in CAD programs

        // Speeds at full deflection, per second (so they don't depend on the frame rate).
        // `speed` scales all of them at once.
        const speed = 1.5;
        const deadzone = 0.05;
        const rotateDegPerSec = 120 * speed;   // spin / tilt
        const panViewsPerSec = 0.5 * speed;    // fraction of the view height per second
        const zoomPerSec = 0.7 * speed;        // compounds per frame: e^0.7 ≈ 2x zoom per second

        const now = performance.now();
        const dt = this.spaceMouseLastPoll ? Math.min((now - this.spaceMouseLastPoll) / 1000, 0.1) : 0;
        this.spaceMouseLastPoll = now;

        // Rescale past the deadzone, then square (keeping the sign) so light pressure
        // gives fine control and only a hard push moves fast
        const read = ({ axis, sign }) => {
            const v = gamepad.axes[axis];
            if (v === undefined || Math.abs(v) <= deadzone) return 0;
            const t = (Math.abs(v) - deadzone) / (1 - deadzone);
            return Math.sign(v) * sign * t * t;
        };

        if (window.spaceMouseDebug) {
            const activeAxes = [];
            for (let i = 0; i < gamepad.axes.length; i++) {
                if (Math.abs(gamepad.axes[i]) > deadzone) {
                    activeAxes.push(`axis${i}=${gamepad.axes[i].toFixed(2)}`);
                }
            }
            if (activeAxes.length > 0) {
                console.log('SpaceMouse axes:', activeAxes.join(', '));
            }
        }

        if (dt === 0) return;

        // pan3D() moves orthoScale * 0.002 per unit and the view is 2 * orthoScale tall,
        // so one view height is 1000 units
        const panX = read(MAP.panX), panY = read(MAP.panY);
        if (panX !== 0 || panY !== 0) {
            const units = 1000 * panViewsPerSec * dt;
            this.camera.pan3D(panX * units, panY * units);
        }

        const zoom = read(MAP.zoom);
        if (zoom !== 0) {
            this.camera.zoom3D(zoom * zoomPerSec * dt);
            this.updateZoomSlider();
        }

        // rotateView() turns the camera, so the model turns the opposite way: the model
        // tips toward you (+tilt), turns counter-clockwise seen from above (+spin) and
        // rolls clockwise on screen (+roll)
        const tilt = read(MAP.tilt), spin = read(MAP.spin), roll = read(MAP.roll);
        if (tilt !== 0 || spin !== 0 || roll !== 0) {
            const rad = rotateDegPerSec * Math.PI / 180 * dt;
            this.camera.rotateView(-tilt * rad, -spin * rad, roll * rad);
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
                if (this.segments.length > 0) this.fitView();
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
        
        // Layer filter - dual range slider
        const layerSliderMin = document.getElementById('layer-slider-min');
        const layerSliderMax = document.getElementById('layer-slider-max');
        const layerMinValue = document.getElementById('layer-min-value');
        const layerMaxValue = document.getElementById('layer-max-value');
        
        if (layerSliderMin && layerSliderMax) {
            // Initialize with default range (will be updated when file is loaded)
            layerSliderMin.min = 0;
            layerSliderMin.max = 100;
            layerSliderMin.value = 0;
            layerSliderMax.min = 0;
            layerSliderMax.max = 100;
            layerSliderMax.value = 100;
            if (layerMinValue) layerMinValue.textContent = '0.0';
            if (layerMaxValue) layerMaxValue.textContent = '100.0';
            
            // Update highlight bar
            this.updateRangeHighlight();
            
            // Prevent sliders from crossing
            layerSliderMin.addEventListener('input', () => {
                const minVal = parseFloat(layerSliderMin.value);
                const maxVal = parseFloat(layerSliderMax.value);
                if (minVal > maxVal) {
                    layerSliderMin.value = maxVal;
                }
                if (layerMinValue) {
                    layerMinValue.textContent = layerSliderMin.value;
                }
                this.updateRangeHighlight();
                this.updateLayerFilter();
            });
            
            layerSliderMax.addEventListener('input', () => {
                const minVal = parseFloat(layerSliderMin.value);
                const maxVal = parseFloat(layerSliderMax.value);
                if (maxVal < minVal) {
                    layerSliderMax.value = minVal;
                }
                if (layerMaxValue) {
                    layerMaxValue.textContent = layerSliderMax.value;
                }
                this.updateRangeHighlight();
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
                    this.camera.setOrthoScale(absoluteScale);
                    this.render();
                }
                zoomValue.textContent = Math.round(relativeZoom * 100) + '%';
            });
        }
        
        // Theme toggle buttons
        const themeLightBtn = document.getElementById('theme-light');
        const themeDarkBtn = document.getElementById('theme-dark');
        
        if (themeLightBtn && themeDarkBtn) {
            // Set initial theme from the saved one, else the page's (light by default)
            const savedTheme = Prefs.get('theme') || document.documentElement.getAttribute('data-theme') || 'light';
            const setTheme = (theme, save = true) => {
                document.documentElement.setAttribute('data-theme', theme);
                if (save) Prefs.set('theme', theme);
                themeLightBtn.setAttribute('aria-pressed', String(theme === 'light'));
                themeDarkBtn.setAttribute('aria-pressed', String(theme === 'dark'));
                const toggle = document.getElementById('btn-theme');
                if (toggle) toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
                // Toolpath colors depend on the theme and are built into the buffers
                this.updateRenderers();
                this.render();
            };
            this.setTheme = setTheme;
            setTheme(savedTheme, false);
            themeLightBtn.addEventListener('click', () => setTheme('light'));
            themeDarkBtn.addEventListener('click', () => setTheme('dark'));
        }
        
        // Grid controls (no action needed - renderer checks these values each frame)
        const gridEnabled = document.getElementById('grid-enabled');
        if (gridEnabled) {
            gridEnabled.addEventListener('change', () => {
                // Render loop will automatically pick up the change
            });
        }
        
        // The render loop picks up grid size changes. One typed in by hand is kept rather
        // than sized from the machine or the stock (see updateGridSize).
        for (const id of ['grid-width', 'grid-height']) {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', (e) => {
                    if (e.isTrusted) {
                        this.gridUserSet = true;
                        this.updateGridSize();
                    }
                });
            }
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
                this.mouseOverView = true;
                this.updateCoordinateDisplay(world.x, world.y, null);
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
            if (this.bounds) this.fitView();
        };
        
        const onContextMenu = (e) => {
            e.preventDefault(); // Prevent right-click menu
        };
        
        // Add listeners to both canvases
        const onMouseLeave = () => {
            onMouseUp();
            if (this.mouseOverView) {
                this.mouseOverView = false;
                if (this.ui && this.segments.length > 0) {
                    this.updateTransport(this.animator.getCurrentIndex(), this.animator.segmentProgress);
                }
            }
        };

        [canvas2d, canvas3d].forEach(canvas => {
            canvas.addEventListener('mousedown', onMouseDown);
            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('mouseup', onMouseUp);
            canvas.addEventListener('mouseleave', onMouseLeave);
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
            // Messages and M0 prompts, as a controller UI shows them (may stop at an M0)
            ({ index, segmentProgress } = this.handleSimEvents(index, segmentProgress));
            this.renderer2d.setMaxSegmentIndex(index, segmentProgress);
            this.renderer3d.setMaxSegmentIndex(index, segmentProgress);
            
            document.getElementById('current-line').textContent = index;
            document.getElementById('line-slider').value = index;
            
            // Update current position and file line number
            if (index < this.segments.length) {
                const segment = this.segments[index];
                this.currentPosition = { x: segment.x1, y: segment.y1, z: segment.z1 };
                // Stopped at an M0: its line, not the next move's
                const lineNum = this.simPromptAt !== null && this.simPromptLine ? this.simPromptLine : segment.lineNum;
                this.gcodeCurrentSegmentLine = lineNum;
                const displayLine = this.toDisplayLine(lineNum);
                this.highlightGCodeLine(displayLine);
                document.getElementById('current-file-line').textContent = displayLine || '-';
                
                // Update active tool highlighting if tool changed
                const currentTool = segment.tool || 0;
                if (this.currentActiveTool !== currentTool) {
                    this.currentActiveTool = currentTool;
                    this.updateActiveToolHighlight();
                }
            } else {
                document.getElementById('current-file-line').textContent = '-';
            }

            this.updatePlayButton();
            if (this.ui) this.updateTransport(index, segmentProgress);
        };
    }

    updatePlayButton() {
        const playBtn = document.getElementById('btn-play');
        if (!playBtn) return;
        const playing = this.animator.getIsPlaying();
        if (this.ui) {
            playBtn.classList.toggle('is-playing', playing);
            playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        } else {
            playBtn.textContent = playing ? 'Pause' : 'Play';
        }
    }

    /**
     * Transport bar readouts: time on the animation timeline, the scrub bar's filled
     * part, and the position of the tool
     */
    updateTransport(index, segmentProgress = 1) {
        const a = this.animator;
        const n = this.segments.length;
        let time = 0;
        if (a.segmentEndTimes && n > 0) {
            const i = Math.min(index, n);
            const start = a.segmentStartTime(i);
            const end = i < n ? a.segmentEndTimes[i] : start;
            time = start + (end - start) * (i < n ? segmentProgress : 0);
        }
        const timeLabel = document.getElementById('tp-time');
        if (timeLabel) timeLabel.textContent = `${this.formatClock(time)} / ${this.formatClock(a.totalAnimTime || 0)}`;
        const slider = document.getElementById('line-slider');
        if (slider) slider.style.setProperty('--vw-fill', (n > 0 ? Math.min(100, index / n * 100) : 0) + '%');

        // Where the tool is (a mouse over the 2D view shows the point under it instead)
        if (n > 0 && !this.mouseOverView) {
            const seg = this.segments[Math.min(index, n - 1)];
            const t = index >= n ? 1 : segmentProgress;
            const p = seg.start && seg.end ? {
                x: seg.start.x + (seg.end.x - seg.start.x) * t,
                y: seg.start.y + (seg.end.y - seg.start.y) * t,
                z: seg.start.z + (seg.end.z - seg.start.z) * t
            } : null;
            if (p && !this.machinePosition) this.updateCoordinateDisplay(p.x, p.y, p.z);
        }
    }

    /**
     * Seconds as m:ss or h:mm:ss
     */
    formatClock(seconds) {
        const s = Math.max(0, Math.round(seconds || 0));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${m}:${String(sec).padStart(2, '0')}`;
    }

    /**
     * Messages and program stops from the parser (parser.events: MSG, PRINT, probe results,
     * M0, M2/M30), shown over the canvas as the animation reaches them, like a controller UI
     * such as FluidTouch or the WebUI. Call after a new file's segments are set.
     */
    setupSimEvents() {
        // DEBUG messages only appear at FluidNC's debug log level
        this.simEvents = (this.parser.events || []).filter(e => e.kind !== 'debug');
        this.simPauses = [];
        this.simEvents.forEach((e, pos) => { if (e.kind === 'pause') this.simPauses.push({ index: e.index, pos }); });
        this.simPauseNext = 0;
        this.simShownCount = -1;

        // Simulated probes: from the M0 that asks for the plate (the probe's own position)
        // until the next M0 soon after (taking it away), or the retract
        this.probeWindows = [];
        this.segments.forEach((seg, i) => {
            if (seg.type !== 'probe' || !seg.probe) return;
            const remove = this.simPauses.find(p => p.index > i && p.index <= i + 3);
            this.probeWindows.push({ start: i, end: remove ? remove.index : i + 2, seg });
        });
        this.probeCamera = null;
        this.probing = false;
        this.renderer3d.setProbePlate(null);

        const ui = this.getSimUI();
        if (!ui) return;
        this.hideSimPrompt();
        ui.options.style.display = this.simEvents.length > 0 ? '' : 'none';
        const none = document.getElementById('playback-none');
        if (none) none.style.display = this.simEvents.length > 0 ? 'none' : '';
        this.renderScrubMarks();
        // After loading, the whole job is drawn
        this.updateSimMessages(this.segments.length);
    }

    /**
     * Message console and M0 prompt over the canvas, and their options in the Animation panel
     */
    getSimUI() {
        if (this.simUI) return this.simUI;
        const container = this.canvas3d ? this.canvas3d.parentElement : null;
        const animation = document.getElementById('playback-options') ||
            document.querySelector('#animation-panel .animation-controls');
        if (!container || !animation) return null;

        const console_ = document.createElement('div');
        console_.className = 'sim-console';
        const prompt = document.createElement('div');
        prompt.className = 'sim-prompt hidden';
        prompt.innerHTML = '<div class="sim-prompt-title">⏸ Program paused (M0)</div>' +
            '<div class="sim-prompt-text"></div><button type="button">Resume</button>';
        container.appendChild(console_);
        container.appendChild(prompt);

        const options = document.createElement('div');
        options.className = 'sim-options';
        options.innerHTML = this.ui
            ? '<label><input type="checkbox" id="sim-show-messages"><span>Show messages' +
              '<small>(MSG, …) and (PRINT, …) in the console</small></span></label>' +
              '<label><input type="checkbox" id="sim-pause-m0"><span>Stop at M0 pauses' +
              '<small>Waits for Resume, like the pendant</small></span></label>' +
              '<label><input type="checkbox" id="sim-probe-closeup"><span>Close-up on probing' +
              '<small>3D view moves in on each G38 probe</small></span></label>'
            : '<label title="MSG and PRINT messages, probe results and program stops, as a controller UI shows them">' +
              '<input type="checkbox" id="sim-show-messages"> Show messages</label>' +
              '<label title="Stop at each M0 and show its prompt with the last message, until Resume">' +
              '<input type="checkbox" id="sim-pause-m0"> Stop at M0 pauses</label>' +
              '<label title="While playing, move the 3D view in close on each probe, then back">' +
              '<input type="checkbox" id="sim-probe-closeup"> Close-up on probing</label>';
        if (this.ui) options.className += ' vw-playback-options';
        animation.appendChild(options);

        const pref = (key, fallback) => Prefs.getBool(key, fallback);
        const showMessages = options.querySelector('#sim-show-messages');
        const pauseAtM0 = options.querySelector('#sim-pause-m0');
        const probeCloseUp = options.querySelector('#sim-probe-closeup');
        showMessages.checked = pref('simShowMessages', true);
        pauseAtM0.checked = pref('simPauseAtM0', true);
        probeCloseUp.checked = pref('simProbeCloseUp', true);
        const save = (key, value) => Prefs.set(key, value);
        showMessages.addEventListener('change', () => {
            save('simShowMessages', showMessages.checked);
            this.simShownCount = -1;
            this.updateSimMessages(this.simShownIndex || 0);
        });
        pauseAtM0.addEventListener('change', () => {
            save('simPauseAtM0', pauseAtM0.checked);
            if (!pauseAtM0.checked && this.simPromptAt !== null) this.resumeSim();
        });
        probeCloseUp.addEventListener('change', () => {
            save('simProbeCloseUp', probeCloseUp.checked);
            if (!probeCloseUp.checked) this.restoreProbeCamera();
        });
        prompt.querySelector('button').addEventListener('click', () => this.resumeSim());

        this.simUI = { console: console_, prompt, options, showMessages, pauseAtM0, probeCloseUp };
        return this.simUI;
    }

    /**
     * Called with each animation position: while playing, stops at the next M0 (if that
     * option is on); otherwise (seeking, stepping) works out which M0 comes next.
     * Returns the position to show, which is the M0's when it stopped there.
     */
    handleSimEvents(index, segmentProgress) {
        if (!this.simEvents || this.simEvents.length === 0) return { index, segmentProgress };
        const ui = this.simUI;
        const playing = this.animator.getIsPlaying();
        if (playing) {
            while (this.simPauseNext < this.simPauses.length && this.simPauses[this.simPauseNext].index <= index) {
                const pause = this.simPauses[this.simPauseNext++];
                if (ui && ui.pauseAtM0.checked) {
                    this.pauseAnimatorAt(pause.index);
                    index = pause.index;
                    segmentProgress = 0;
                    this.showSimPrompt(pause);
                    break;
                }
            }
        } else {
            // Pauses before this point are passed; one right here comes next
            this.simPauseNext = this.simPauses.filter(p => p.index < index).length;
            if (this.simPromptAt !== null && index !== this.simPromptAt) this.hideSimPrompt();
        }
        this.updateSimMessages(index);
        this.updateProbeView(index, playing);
        return { index, segmentProgress };
    }

    /**
     * The touch plate while a probe is in progress (from the M0 that asks for it until the
     * one that takes it away), and, while playing, a close-up of it that returns to the
     * previous view afterwards
     */
    updateProbeView(index, playing) {
        const w = (this.probeWindows || []).find(w => index >= w.start &&
            (index < w.end || (index === w.end && this.simPromptAt === w.end)));
        this.probing = !!w;
        if (!w) {
            this.renderer3d.setProbePlate(null);
            this.restoreProbeCamera();
            return;
        }

        const cfg = this.stockConfig;
        const def = cfg && cfg.tools.get(w.seg.toolNumber);
        const inches = (cfg ? cfg.units : this.parser.units) === 'inches';
        const diameter = def && def.diameter > 0 ? def.diameter : (inches ? 0.25 : 6);
        const size = Math.max(inches ? 1.2 : 30, diameter * 4);
        const probe = w.seg.probe;
        this.renderer3d.setProbePlate({
            x: w.seg.end.x, y: w.seg.end.y, surface: probe.surface, thickness: probe.plate, size,
            touched: index > w.start
        });

        const ui = this.simUI;
        if (!this.probeCamera && playing && ui && ui.probeCloseUp.checked && this.currentView === '3d') {
            const cam = this.camera;
            this.probeCamera = {
                target: { ...cam.targetTarget }, orientation: { ...cam.targetOrientation }, scale: cam.targetOrthoScale
            };
            const length = def && def.overallLength > 0 ? def.overallLength : diameter * 6;
            cam.targetTarget = { x: w.seg.end.x, y: w.seg.end.y, z: probe.surface + length * 0.35 };
            // A low view from the front: 65 degrees down from the top view
            const tilt = 65 * Math.PI / 180;
            cam.targetOrientation = { w: Math.cos(tilt / 2), x: Math.sin(tilt / 2), y: 0, z: 0 };
            cam.targetOrthoScale = Math.max(size * 0.8, length * 0.7);
        }
    }

    restoreProbeCamera() {
        const saved = this.probeCamera;
        if (!saved) return;
        this.probeCamera = null;
        const cam = this.camera;
        cam.targetTarget = saved.target;
        cam.targetOrientation = saved.orientation;
        cam.targetOrthoScale = saved.scale;
    }

    /**
     * Stop the animation exactly at the start of segment `index`, so it resumes from there
     */
    pauseAnimatorAt(index) {
        const a = this.animator;
        a.pause();
        a.currentIndex = index;
        a.segmentProgress = 0;
        if (a.totalAnimTime > 0) {
            a.accumulatedTime = a.segmentStartTime(index);
        } else if (a.estimatedTotalTime > 0 && a.segments.length > 0) {
            a.accumulatedTime = index / a.segments.length * a.estimatedTotalTime;
        }
    }

    showSimPrompt(pause) {
        const ui = this.simUI;
        // The last message before the M0, as a controller UI shows with its pause prompt
        let message = null;
        for (let i = pause.pos - 1; i >= 0 && message === null; i--) {
            const e = this.simEvents[i];
            if (e.kind === 'msg' || e.kind === 'print') message = e.text;
        }
        ui.prompt.querySelector('.sim-prompt-text').textContent = message || 'No message';
        ui.prompt.classList.remove('hidden');
        this.simPromptAt = pause.index;
        this.simPromptPos = pause.pos;
        this.simPromptLine = this.simEvents[pause.pos].lineNum;
        this.simPromptNext = this.simPauseNext;
    }

    hideSimPrompt() {
        if (this.simUI) this.simUI.prompt.classList.add('hidden');
        this.simPromptAt = null;
        this.simPromptLine = null;
    }

    resumeSim() {
        const next = this.simPromptNext;
        this.hideSimPrompt();
        this.simShownCount = -1;
        if (next !== undefined) this.simPauseNext = next;
        this.animator.play();
    }

    /**
     * The last few events up to segment `index`, newest at the bottom. While stopped at an
     * M0, only those up to it: what follows on the same position hasn't happened yet.
     */
    updateSimMessages(index) {
        const ui = this.simUI;
        if (!ui || !this.simEvents) return;
        this.simShownIndex = index;
        // Events are in order of index, so count those that have happened
        let lo = 0, hi = this.simEvents.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.simEvents[mid].index <= index) lo = mid + 1; else hi = mid;
        }
        if (this.simPromptAt !== null && this.simPromptAt !== undefined) lo = Math.min(lo, this.simPromptPos + 1);
        if (lo === this.simShownCount) return;
        this.simShownCount = lo;

        const shown = ui.showMessages.checked ? this.simEvents.slice(Math.max(0, lo - 3), lo) : [];
        const labels = { msg: 'MSG', print: 'PRINT', probe: 'PRB', alarm: 'ALARM', pause: 'M0', end: 'END' };
        ui.console.innerHTML = shown.map((e, i) =>
            `<div class="sim-line sim-${e.kind}${i < shown.length - 1 ? ' sim-old' : ''}" title="Line ${e.lineNum}">` +
            `<span class="sim-kind">${labels[e.kind] || e.kind}</span>${this.escapeHtml(e.text)}</div>`).join('');
        ui.console.style.display = shown.length > 0 ? '' : 'none';
    }

    /**
     * Tool changes (a tick in the tool's color) and M0 pauses (a diamond) along the scrub
     * bar and the running job's progress bar, at their place in the segment list
     */
    renderScrubMarks() {
        const n = this.segments.length;
        let html = '';
        if (n > 0) {
            let lastTool = null;
            this.segments.forEach((seg, i) => {
                if (seg.type !== 'cut') return;
                const tool = seg.tool || 1;
                if (lastTool !== null && tool !== lastTool) {
                    const state = this.tools.get(tool);
                    html += `<span class="vw-mark" style="left:${(i / n * 100).toFixed(2)}%;background:${state ? state.color : '#999'}" title="Tool change: T${state && state.number !== undefined ? state.number : tool}"></span>`;
                }
                lastTool = tool;
            });
            for (const pause of this.simPauses || []) {
                html += `<span class="vw-mark vw-mark-m0" style="left:${(pause.index / n * 100).toFixed(2)}%" title="M0 pause"></span>`;
            }
        }
        for (const id of ['scrub-marks', 'run-marks']) {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        }
    }

    /**
     * After a file is loaded and drawn: header, summary, scrub bar and the view's fit
     * (viewer layout only)
     * @param {string} name - file name shown in the header
     */
    onFileLoaded(name) {
        if (!this.ui) return;
        this.fileName = name || this.fileName || 'G-code';
        const lines = this.gcodeText ? this.gcodeText.split('\n').length : 0;
        const fileName = document.getElementById('file-name');
        if (fileName) {
            fileName.textContent = this.fileName;
            fileName.title = this.fileName;
        }
        const meta = document.getElementById('file-meta');
        if (meta) meta.textContent = `${lines} lines · ${this.animator.getFormattedTime()}`;
        const empty = document.getElementById('vw-empty');
        if (empty) empty.hidden = true;
        this.ui.classList.add('vw-loaded');
        const sumTime = document.getElementById('sum-time');
        if (sumTime) sumTime.title = 'Estimated run time, with time allowed for tool changes ' +
            `(${this.animator.manualToolChangeTime} s at an M0, ${this.animator.autoToolChangeTime} s at an M6). ` +
            'The transport bar plays the moves only.';
        const warn = document.getElementById('warn-section');
        if (warn) warn.style.display = '';
        const actions = document.getElementById('sum-actions');
        if (actions) actions.hidden = !(this.gcodeExpansion && this.gcodeExpansion.output);
        this.updateWarnings();
        const speed = document.getElementById('speed-select');
        if (speed) this.animator.setSpeed(parseFloat(speed.value));
        this.updateTransport(0, 0);
        this.updatePlayButton();
        if (ViewerUI.isPhone() && ViewerUI.root.dataset.tab === 'files') ViewerUI.setTab('view');
        ViewerUI.closePopover();
        requestAnimationFrame(() => this.fitView());
    }

    /**
     * Load GCode file
     */
    async loadFile(file, folderURL = null) {
        const progressBar = document.getElementById('progress-bar');
        const progressFill = document.getElementById('progress-fill');

        progressBar.classList.remove('hidden');
        progressFill.style.width = '0%';
        // Earlier jobs of a file opened from a URL come from its folder (readPriorJob)
        this.fileFolderURL = folderURL;

        try {
            // Read file text for display
            const text = await file.text();
            this.gcodeText = text;
            if (this.ui && !folderURL) this.rememberRecentFile(file.name, text);
            
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
            this.setupStockSimulation();
            this.setupSimEvents();
            this.initializeLayerSliders(); // Initialize layer filter sliders
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
            this.onFileLoaded(file.name);

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
            if (!idPrefix) {
                this.setupStockSimulation();
                this.setupSimEvents();
            }
            
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
            if (!idPrefix) {
                this.initializeLayerSliders();
                this.onFileLoaded(this.fileName);
            }

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
        // A ToolDef NAME= (stock simulation header) replaces the tool list's name
        const defNames = new Map();
        // The T number each tool list entry cuts with (the key is the parser's tool index)
        const numbers = new Map();
        const defs = this.parser.simMeta ? this.parser.simMeta.tools : new Map();
        for (const seg of segments) {
            if (seg.type === 'cut') {
                const key = seg.tool || 1;
                toolSet.add(key);
                if (!numbers.has(key) && seg.toolNumber !== undefined && seg.toolNumber !== null) numbers.set(key, seg.toolNumber);
                const def = defs.get(seg.toolNumber);
                if (def && def.name && !defNames.has(key)) defNames.set(key, def.name);
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
                name: defNames.get(tool) || toolNames[toolIndex] || `Tool ${tool}`,
                number: numbers.has(tool) ? numbers.get(tool) : tool
            });
        }
    }
    
    /**
     * Update tool panel UI
     */
    updateToolPanel(idPrefix = '') {
        const toolList = document.getElementById(`${idPrefix}tool-list`);
        if (!toolList) return;
        if (this.ui && !idPrefix) {
            this.renderToolRows(toolList);
            return;
        }

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
     * Toolpaths list (viewer layout): a row per tool and one for rapids, each with
     * visibility, color, name and estimated time
     */
    renderToolRows(toolList) {
        const esc = (s) => this.escapeHtml(String(s));
        const clock = (seconds) => this.formatClock(seconds);
        // Rapids' time: the moves' own times, from the animator's timeline
        let rapidTime = 0;
        const times = this.animator.segmentMoveTimes;
        if (times) this.segments.forEach((seg, i) => { if (seg.type === 'rapid') rapidTime += times[i] || 0; });

        const rows = [...this.tools].map(([key, state]) => {
            const t = state.number !== undefined ? state.number : key;
            return `
            <label class="vw-tool tool-item" data-tool="${key}">
                <input type="checkbox" data-role="visible"${state.visible ? ' checked' : ''} aria-label="Show T${t}">
                <input type="color" class="vw-swatch" data-role="color" value="${esc(state.color)}" aria-label="Color for T${t}">
                <span class="vw-tool-id">T${t}</span>
                <span class="vw-tool-name" title="${esc(state.name || '')}">${esc(this.shortToolName(state.name, t))}</span>
                <span class="vw-tool-time">${clock(this.animator.toolTimes.get(key) || 0)}</span>
            </label>`;
        });
        rows.push(`
            <label class="vw-tool vw-tool-rapid">
                <input type="checkbox" id="rapid-moves-visible"${this.rapidMovesVisible ? ' checked' : ''} aria-label="Show rapid moves">
                <input type="color" class="vw-swatch" id="rapid-move-color" value="${esc(this.rapidMoveColor)}" aria-label="Color for rapid moves">
                <span class="vw-tool-id">G0</span>
                <span class="vw-tool-name">Rapids</span>
                <span class="vw-tool-time">${clock(rapidTime)}</span>
            </label>`);
        toolList.innerHTML = this.tools.size === 0
            ? '<div class="vw-muted">No cutting moves</div>' + rows[rows.length - 1]
            : rows.join('');

        toolList.querySelectorAll('.tool-item').forEach(row => {
            const state = this.tools.get(parseInt(row.dataset.tool));
            row.querySelector('[data-role="visible"]').addEventListener('change', (e) => {
                state.visible = e.target.checked;
                this.updateRenderers();
            });
            row.querySelector('[data-role="color"]').addEventListener('input', (e) => {
                state.color = e.target.value;
                this.updateRenderers();
                this.renderScrubMarks();
            });
        });
        toolList.querySelector('#rapid-moves-visible').addEventListener('change', (e) => {
            this.rapidMovesVisible = e.target.checked;
            this.updateRenderers();
        });
        toolList.querySelector('#rapid-move-color').addEventListener('input', (e) => {
            this.rapidMoveColor = e.target.value;
            this.updateRenderers();
        });
        this.updateActiveToolHighlight();
    }

    /**
     * A tool's name without a leading "Tool 1:" / "T1 -", which the row shows already
     */
    shortToolName(name, num) {
        if (!name) return `Tool ${num}`;
        const short = name.replace(/^\s*(tool\s*#?\s*|t)\d+\s*[:\-–·]?\s*/i, '').trim();
        return short || name;
    }

    /**
     * Update active tool highlighting in tool panel
     */
    updateActiveToolHighlight() {
        if (this.ui) {
            document.querySelectorAll('.vw-tool.tool-item').forEach(item => {
                item.classList.toggle('active', parseInt(item.dataset.tool) === this.currentActiveTool);
            });
            return;
        }
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
        if (this.stockSim) this.stockSim.setHiddenTools(this.hiddenToolKeys());
    }

    /**
     * Tool panel keys of the tools that are unchecked
     */
    hiddenToolKeys() {
        return [...this.tools].filter(([, state]) => !state.visible).map(([key]) => key);
    }

    /**
     * Stock simulation: the machined stock drawn as a solid in the 3D view. Stock and
     * tool sizes come from the file's (Stock: ...) / (ToolDef N: ...) header comments or
     * are entered in the panel; until every tool's size is known the option stays off.
     * Call after the segments and tools of a new file are set.
     */
    setupStockSimulation() {
        if (typeof StockSimulator === 'undefined') return;
        const panel = this.getStockPanel();
        if (!panel) return;
        this.stockWarnings = [];
        this.stockWarningsKey = null;
        this.warningsShown = false;

        const meta = this.parser.simMeta;
        const units = meta.units || this.parser.units;

        // T numbers of the tools that cut, named as in the tool panel
        const names = new Map();
        for (const seg of this.segments) {
            if (seg.type !== 'cut' || names.has(seg.toolNumber)) continue;
            const state = this.tools.get(seg.tool || 1);
            names.set(seg.toolNumber, state && state.name ? state.name : `Tool ${seg.toolNumber}`);
        }

        this.stockSim = null;
        this.renderer3d.setStockSimulator(null);
        if (names.size === 0) {
            panel.style.display = 'none';
            this.stockConfig = null;
            this.updateStockDisplay();
            this.updateGridSize();
            return;
        }

        const tools = new Map();
        for (const [num, name] of names) {
            const guess = guessStockToolFromName(name, units);
            let def = meta.tools.get(num);
            // The flute count, only used to draw the tool, can come from a name like "1-flute"
            if (def && !def.flutes && guess && guess.flutes) def = { ...def, flutes: guess.flutes };
            tools.set(num, def || guess ||
                { shape: 'flat', diameter: null, angle: null, tip: 0, cornerRadius: 0, flutes: 0 });
        }
        const fromFile = !!meta.stock && [...names.keys()].every(num => meta.tools.has(num));
        this.stockConfig = {
            stock: meta.stock || this.estimateStock(tools, units),
            tools, names, units, fromFile,
            stockFromFile: !!meta.stock,
            quality: this.stockConfig ? this.stockConfig.quality : 'auto'
        };

        // The viewer layout shows the stock by default when the file describes it
        const wantVisible = Prefs.getBool('stockSimVisible', !!this.ui);
        this.stockVisible = wantVisible && fromFile;

        // Jobs that run before this one (PriorJob comments), loaded where the host can
        // read files next to this one; the rest are chosen with "Add files…"
        this.priorJobs = meta.priorJobs.map(name => ({ name, status: 'pending', warnings: [] }));
        this.priorJobsGeneration = (this.priorJobsGeneration || 0) + 1;

        panel.style.display = 'block';
        this.renderStockPanel();
        this.renderPriorJobs();
        this.updateStockDisplay();
        this.updateGridSize();
        // The file was fitted to its toolpaths; with the stock shown, frame that instead
        if (this.stockVisible && this.stockConfigProblem() === null) this.fitView();
        if (this.priorJobs.length > 0) this.autoLoadPriorJobs();
    }

    /**
     * Read a file that runs before the current one, named by a PriorJob comment.
     * Hosts that can read files next to the current one override this (FluidNC reads
     * the SD card, the VS Code extension the file's folder). Returns the text or null.
     */
    async readPriorJob(name) {
        // A file opened from a URL (the demo): its folder
        if (!this.fileFolderURL) return null;
        const response = await fetch(this.fileFolderURL + encodeURIComponent(name.split(/[\\/]/).pop()));
        return response.ok ? response.text() : null;
    }

    async autoLoadPriorJobs() {
        const generation = this.priorJobsGeneration;
        for (const job of this.priorJobs) {
            if (job.status !== 'pending') continue;
            let text = null;
            try {
                text = await this.readPriorJob(job.name);
            } catch (e) {
                console.warn('Could not read earlier job', job.name, e);
            }
            if (generation !== this.priorJobsGeneration) return; // another file was loaded
            if (typeof text === 'string') {
                await this.parsePriorJob(job, text);
                if (generation !== this.priorJobsGeneration) return;
            } else {
                job.status = 'missing';
            }
            this.renderPriorJobs();
        }
        this.priorJobsChanged();
    }

    /**
     * Parse an earlier job and check it fits this one
     */
    async parsePriorJob(job, text) {
        const parser = new GCodeParser();
        parser.machineValues = this.parser.machineValues;
        parser.inputValues = this.parser.inputValues;
        job.warnings = [];
        try {
            job.segments = await parser.parseString(text);
        } catch (e) {
            job.status = 'error';
            job.warnings = [`couldn't be read: ${e.message}`];
            return;
        }
        const meta = parser.simMeta;
        const cfg = this.stockConfig;
        job.tools = meta.tools;
        job.status = 'loaded';

        const units = meta.units || parser.units;
        if (cfg && units !== cfg.units) {
            job.status = 'error';
            job.warnings.push(`uses ${units} and this file uses ${cfg.units}, so it's left out`);
            return;
        }
        const cutTools = [...new Set(job.segments.filter(s => s.type === 'cut').map(s => s.toolNumber))];
        if (cutTools.length === 0) job.warnings.push('has no cutting moves');
        const undefinedTools = cutTools.filter(num => !meta.tools.has(num));
        if (undefinedTools.length > 0) {
            job.warnings.push(`has no ToolDef for ${undefinedTools.map(n => 'T' + n).join(', ')}, so those cuts are left out`);
        }
        if (meta.stock && cfg && ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax']
            .some(k => Math.abs(meta.stock[k] - cfg.stock[k]) > 1e-6)) {
            job.warnings.push("has different Stock bounds; it's carved into this file's stock");
        }
        const listed = new Set(this.priorJobs.map(j => this.priorJobKey(j.name)));
        const unlisted = meta.priorJobs.filter(name => !listed.has(this.priorJobKey(name)));
        if (unlisted.length > 0) {
            job.warnings.push(`runs after ${unlisted.join(', ')}, which ${unlisted.length === 1 ? "isn't" : "aren't"} in this list`);
        }
    }

    priorJobKey(name) {
        return name.split(/[\\/]/).pop().trim().toLowerCase();
    }

    /**
     * Files chosen with "Add files…": each fills the listed job of the same name, or is
     * added at the end (several at once in name order, e.g. _T1 before _T2)
     */
    async addPriorJobFiles(files) {
        const generation = this.priorJobsGeneration;
        const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const file of sorted) {
            const text = await file.text();
            if (generation !== this.priorJobsGeneration) return;
            const key = this.priorJobKey(file.name);
            let job = this.priorJobs.find(j => this.priorJobKey(j.name) === key);
            if (!job) {
                job = { name: file.name, status: 'pending', warnings: [] };
                this.priorJobs.push(job);
            }
            await this.parsePriorJob(job, text);
            if (generation !== this.priorJobsGeneration) return;
        }
        this.renderPriorJobs();
        this.priorJobsChanged();
    }

    renderPriorJobs() {
        const list = document.getElementById('stock-prior-list');
        if (!list) return;
        const jobs = this.priorJobs || [];
        if (jobs.length === 0) {
            list.innerHTML = '<li class="stock-prior-empty">None: the job starts from uncut stock.</li>';
            return;
        }
        list.innerHTML = jobs.map((job, i) => {
            const status = {
                pending: 'Loading…',
                missing: '⚠️ Not found: choose it with Add files…',
                loaded: `✓ ${job.segments ? job.segments.length : 0} moves`,
                error: '⚠️ Not used'
            }[job.status];
            const warnings = job.warnings.map(w => `<div class="stock-prior-warning">⚠️ It ${this.escapeHtml(w)}.</div>`).join('');
            return `<li data-index="${i}">
                <div class="stock-prior-row">
                    <span class="stock-prior-name" title="${this.escapeHtml(job.name)}">${this.escapeHtml(job.name)}</span>
                    <button type="button" data-action="up" title="Move earlier"${i === 0 ? ' disabled' : ''}>↑</button>
                    <button type="button" data-action="remove" title="Remove">✕</button>
                </div>
                <div class="stock-prior-status">${status}</div>${warnings}
            </li>`;
        }).join('');
    }

    /**
     * Rebuild the simulation after the earlier jobs changed
     */
    priorJobsChanged() {
        this.stockSim = null;
        this.renderer3d.setStockSimulator(null);
        this.updateStockDisplay();
    }

    /**
     * The Stock Simulation panel, added after the rapid moves panel on first use
     */
    getStockPanel() {
        let panel = document.getElementById('stock-panel');
        if (panel) return panel;
        const mount = document.getElementById('stock-mount');
        const anchor = mount || document.getElementById('rapid-moves-panel') || document.getElementById('tool-panel');
        if (!anchor) return null;

        panel = document.createElement(mount ? 'section' : 'div');
        panel.className = mount ? 'vw-section' : 'panel';
        panel.id = 'stock-panel';
        if (mount) panel.dataset.section = 'stock';
        const qualityOptions = `
                            <option value="auto">Auto (from the tools)</option>
                            <option value="500000">Draft (0.5M cells)</option>
                            <option value="2000000">Normal (2M cells)</option>
                            <option value="5000000">Fine (5M cells)</option>
                            <option value="10000000">Ultra (10M cells)</option>`;
        panel.innerHTML = mount ? `
            <div class="vw-section-head" role="button" tabindex="0" aria-expanded="true">${VIEWER_ICONS.chevron}<span>Stock simulation</span>
                <label class="vw-head-check" title="Show the machined stock as a solid (3D view)"><input type="checkbox" id="stock-visible"> Show</label>
            </div>
            <div class="vw-section-body">
                <div class="stock-status" id="stock-status"></div>
                <label class="stock-check"><input type="checkbox" id="stock-paths" checked><span>Toolpaths on the stock</span></label>
                <label class="stock-check stock-sub" title="While animating, hide the lines of earlier layers: they're already cut into the stock"><input type="checkbox" id="stock-paths-layer"><span>Current layer only</span></label>
                <div class="stock-priors">
                    <div class="stock-priors-head">
                        <span title="Files that run before this one, oldest first. Their cuts are made before this job's.">Earlier jobs</span>
                        <button type="button" id="stock-prior-add">Add…</button>
                    </div>
                    <ol class="stock-prior-list" id="stock-prior-list"></ol>
                    <input type="file" id="stock-prior-input" multiple accept=".nc,.gcode,.ngc,.gco,.tap,.txt" hidden>
                </div>
                <label class="stock-detail"><span>Detail</span>
                    <select id="stock-quality" title="Grid resolution: finer shows small details more accurately, but uses more memory and takes longer to carve">${qualityOptions}</select>
                </label>
                <div class="stock-info" id="stock-info"></div>
                <details class="stock-settings" id="stock-settings">
                    <summary>Stock and tool sizes</summary>
                    <div id="stock-form"></div>
                    <div class="stock-actions"><span class="vw-spacer"></span><button type="button" id="stock-apply">Apply</button></div>
                    <div class="stock-help">Stock bounds are in the file's coordinates. A post processor can supply these with
                        <code>(Stock: XMIN=… XMAX=… YMIN=… YMAX=… ZMIN=… ZMAX=…)</code> and
                        <code>(ToolDef N: SHAPE=flat D=…)</code> comments.</div>
                </details>
            </div>` : `
            <h3>Stock Simulation</h3>
            <div class="stock-status" id="stock-status"></div>
            <label class="stock-check"><input type="checkbox" id="stock-visible"><span>Show machined stock (3D view)</span></label>
            <label class="stock-check"><input type="checkbox" id="stock-paths" checked><span>Show toolpaths on the stock</span></label>
            <label class="stock-check stock-sub" title="While animating, hide the lines of earlier layers: they're already cut into the stock"><input type="checkbox" id="stock-paths-layer"><span>Current layer only</span></label>
            <div class="stock-info" id="stock-info"></div>
            <div class="stock-priors">
                <div class="stock-priors-head">
                    <span title="Files that run before this one, oldest first. Their cuts are made before this job's.">Earlier jobs</span>
                    <button type="button" id="stock-prior-add">Add files…</button>
                </div>
                <ol class="stock-prior-list" id="stock-prior-list"></ol>
                <input type="file" id="stock-prior-input" multiple accept=".nc,.gcode,.ngc,.gco,.tap,.txt" hidden>
            </div>
            <details class="stock-settings" id="stock-settings">
                <summary>Stock and tools</summary>
                <div id="stock-form"></div>
                <div class="stock-actions">
                    <label>Detail
                        <select id="stock-quality" title="Grid resolution: finer shows small details more accurately, but uses more memory and takes longer to carve">${qualityOptions}</select>
                    </label>
                    <button type="button" id="stock-apply">Apply</button>
                </div>
                <div class="stock-help">Stock bounds are in the file's coordinates. A post processor can supply these with
                    <code>(Stock: XMIN=… XMAX=… YMIN=… YMAX=… ZMIN=… ZMAX=…)</code> and
                    <code>(ToolDef N: SHAPE=flat D=…)</code> comments.</div>
            </details>`;
        if (mount) {
            mount.replaceWith(panel);
            ViewerUI.restoreSection(panel);
            // Detail applies straight away (the form's Apply is for sizes)
            panel.querySelector('#stock-quality').addEventListener('change', (e) => {
                const cfg = this.stockConfig;
                if (!cfg) return;
                cfg.quality = e.target.value === 'auto' ? 'auto' : parseFloat(e.target.value) || 'auto';
                this.stockSim = null;
                this.renderer3d.setStockSimulator(null);
                this.updateStockDisplay();
            });
            const head = panel.querySelector('.vw-section-head');
            head.addEventListener('keydown', (e) => {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === head) {
                    e.preventDefault();
                    ViewerUI.setSectionOpen(panel, panel.classList.contains('collapsed'));
                }
            });
        } else {
            anchor.insertAdjacentElement('afterend', panel);
        }

        panel.querySelector('#stock-visible').addEventListener('change', (e) => {
            this.stockVisible = e.target.checked;
            Prefs.set('stockSimVisible', this.stockVisible);
            if (this.stockVisible && this.currentView === '2d') this.toggleView();
            this.updateStockDisplay();
        });
        panel.querySelector('#stock-paths').addEventListener('change', () => this.updateStockDisplay());
        const layerOnly = panel.querySelector('#stock-paths-layer');
        layerOnly.checked = Prefs.get('stockPathsLayerOnly') !== 'false';
        layerOnly.addEventListener('change', () => {
            Prefs.set('stockPathsLayerOnly', layerOnly.checked);
            this.updateStockDisplay();
        });
        panel.querySelector('#stock-apply').addEventListener('click', () => this.applyStockForm());
        const priorInput = panel.querySelector('#stock-prior-input');
        panel.querySelector('#stock-prior-add').addEventListener('click', () => priorInput.click());
        priorInput.addEventListener('change', () => {
            if (priorInput.files.length > 0) this.addPriorJobFiles(priorInput.files);
            priorInput.value = '';
        });
        panel.querySelector('#stock-prior-list').addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;
            const index = parseInt(button.closest('li').dataset.index);
            const jobs = this.priorJobs;
            if (button.dataset.action === 'remove') jobs.splice(index, 1);
            else if (index > 0) [jobs[index - 1], jobs[index]] = [jobs[index], jobs[index - 1]];
            this.renderPriorJobs();
            this.priorJobsChanged();
        });
        panel.querySelector('#stock-form').addEventListener('change', (e) => {
            if (e.target.matches('select[data-field="shape"]')) this.updateStockToolFields(e.target.closest('.stock-tool'));
        });
        panel.querySelector('#stock-form').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.matches('input')) this.applyStockForm();
        });
        return panel;
    }

    renderStockPanel() {
        const cfg = this.stockConfig;
        const unit = cfg.units === 'inches' ? 'in' : 'mm';
        const value = (v) => v === null || v === undefined ? '' : String(+v.toFixed(4));
        const s = cfg.stock;
        const shapes = { flat: 'Flat end mill', ball: 'Ball nose', bullnose: 'Bull nose', vbit: 'V-bit', chamfer: 'Chamfer', taperball: 'Tapered ball nose' };

        let html = `<div class="stock-bounds"><span></span><span class="stock-head">Min (${unit})</span><span class="stock-head">Max (${unit})</span>`;
        for (const axis of ['x', 'y', 'z']) {
            html += `<span>${axis.toUpperCase()}</span>` +
                `<input type="number" step="any" data-stock="${axis}min" value="${value(s[axis + 'min'])}">` +
                `<input type="number" step="any" data-stock="${axis}max" value="${value(s[axis + 'max'])}">`;
        }
        html += '</div>';

        for (const [num, def] of cfg.tools) {
            const options = STOCK_TOOL_SHAPES.map(shape =>
                `<option value="${shape}"${shape === def.shape ? ' selected' : ''}>${shapes[shape]}</option>`).join('');
            html += `<div class="stock-tool" data-tool="${num}">
                <div class="stock-tool-name" title="${this.escapeHtml(cfg.names.get(num))}">T${num} · ${this.escapeHtml(cfg.names.get(num))}</div>
                <div class="stock-tool-fields">
                    <label class="stock-shape">Shape<select data-field="shape">${options}</select></label>
                    <label>Diameter (${unit})<input type="number" step="any" min="0" data-field="diameter" value="${value(def.diameter)}"></label>
                    <label data-shapes="vbit chamfer taperball">Angle (°)<input type="number" step="any" min="0" max="179" data-field="angle" value="${value(def.angle)}"></label>
                    <label data-shapes="vbit chamfer">Tip diameter (${unit})<input type="number" step="any" min="0" data-field="tip" value="${value(def.tip)}"></label>
                    <label data-shapes="taperball">Ball diameter (${unit})<input type="number" step="any" min="0" data-field="tip" value="${value(def.tip)}"></label>
                    <label data-shapes="bullnose">Corner radius (${unit})<input type="number" step="any" min="0" data-field="cornerRadius" value="${value(def.cornerRadius)}"></label>
                    <label title="Only used to draw the tool">Flutes<input type="number" step="1" min="0" max="12" data-field="flutes" value="${def.flutes || ''}"></label>
                    <label title="Cutting edge height from the tip: deeper cuts are flagged">Flute length (${unit})<input type="number" step="any" min="0" data-field="fluteLength" value="${value(def.fluteLength)}"></label>
                    <label title="Only used to draw the tool">Overall length (${unit})<input type="number" step="any" min="0" data-field="overallLength" value="${value(def.overallLength)}"></label>
                </div>
            </div>`;
        }
        const form = document.getElementById('stock-form');
        form.innerHTML = html;
        form.querySelectorAll('.stock-tool').forEach(row => this.updateStockToolFields(row));

        const qualitySelect = document.getElementById('stock-quality');
        qualitySelect.value = String(cfg.quality);
        if (qualitySelect.value !== String(cfg.quality)) qualitySelect.value = 'auto';
        document.getElementById('stock-visible').checked = this.stockVisible;
        // Open the form when something needs checking or filling in
        document.getElementById('stock-settings').open = !cfg.fromFile;
    }

    updateStockToolFields(row) {
        const shape = row.querySelector('select[data-field="shape"]').value;
        row.querySelectorAll('label[data-shapes]').forEach(label => {
            label.style.display = label.dataset.shapes.split(' ').includes(shape) ? '' : 'none';
        });
    }

    applyStockForm() {
        const cfg = this.stockConfig;
        if (!cfg) return;
        const form = document.getElementById('stock-form');
        const read = (input) => {
            const v = parseFloat(input.value);
            return input.value.trim() === '' || !isFinite(v) ? null : v;
        };

        const stock = {};
        form.querySelectorAll('input[data-stock]').forEach(input => { stock[input.dataset.stock] = read(input); });
        const tools = new Map();
        form.querySelectorAll('.stock-tool').forEach(row => {
            // Some fields have a label per shape (tip vs ball diameter): use the one shown
            const field = (name) => {
                const inputs = [...row.querySelectorAll(`[data-field="${name}"]`)];
                return inputs.find(el => !el.closest('label[data-shapes]') ||
                    el.closest('label').style.display !== 'none') || inputs[0];
            };
            tools.set(parseInt(row.dataset.tool), {
                shape: field('shape').value,
                diameter: read(field('diameter')),
                angle: read(field('angle')),
                tip: read(field('tip')) || 0,
                cornerRadius: read(field('cornerRadius')) || 0,
                flutes: read(field('flutes')) || 0,
                fluteLength: read(field('fluteLength')) || null,
                overallLength: read(field('overallLength')) || null,
                name: cfg.tools.get(parseInt(row.dataset.tool))?.name || null
            });
        });

        // Estimated bounds that weren't changed are estimated again, as they include the
        // tool radius, which may only just have been entered
        const keys = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'];
        const unchanged = keys.every(k => stock[k] !== null && Math.abs(stock[k] - cfg.stock[k]) < 1e-6);
        if (!unchanged) cfg.stockEdited = true;
        const reestimate = unchanged && !cfg.stockFromFile && !cfg.stockEdited;

        cfg.tools = tools;
        cfg.stock = reestimate ? this.estimateStock(tools, cfg.units) : stock;
        const quality = document.getElementById('stock-quality').value;
        cfg.quality = quality === 'auto' ? 'auto' : parseFloat(quality) || 'auto';
        cfg.fromFile = false;
        cfg.edited = true;
        this.stockSim = null;
        this.renderer3d.setStockSimulator(null);
        if (reestimate) this.renderStockPanel();

        this.updateGridSize();
        if (this.stockConfigProblem() === null) {
            this.stockVisible = true;
            document.getElementById('stock-visible').checked = true;
            Prefs.set('stockSimVisible', true);
            if (this.currentView === '2d') this.toggleView();
        }
        this.updateStockDisplay();
    }

    /**
     * Why the current stock settings can't be simulated, or null if they can
     */
    stockConfigProblem() {
        const cfg = this.stockConfig;
        if (!cfg) return 'No cutting moves to simulate';
        const s = cfg.stock;
        if (['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'].some(k => s[k] === null || s[k] === undefined)) {
            return 'Enter the stock bounds below';
        }
        if (!(s.xmax > s.xmin && s.ymax > s.ymin && s.zmax > s.zmin)) return 'Each stock max must be above its min';
        for (const [num, def] of cfg.tools) {
            if (!(def.diameter > 0)) return `Enter a diameter for T${num} below`;
        }
        return null;
    }

    /**
     * Build the simulator if it's needed and pass the display options to the 3D view
     */
    updateStockDisplay() {
        const problem = this.stockConfig ? this.stockConfigProblem() : null;
        const visibleBox = document.getElementById('stock-visible');
        const status = document.getElementById('stock-status');

        if (this.stockConfig) {
            if (visibleBox) visibleBox.disabled = problem !== null;
            if (status) {
                status.textContent = problem ? `✏️ ${problem} to simulate the cut.`
                    : this.stockConfig.fromFile ? '✓ Stock and tools from the file header.'
                    : this.stockConfig.edited ? 'Using the stock and tools entered below.'
                    : this.stockConfig.stockFromFile ? 'Stock from the file header; tool sizes guessed from their names: check them below.'
                    : 'Estimated from the toolpaths and tool names: check the stock and tools below.';
            }
        }

        const visible = !!this.stockConfig && problem === null && this.stockVisible;
        if (visible && !this.stockSim) {
            const cfg = this.stockConfig;
            const cells = cfg.quality === 'auto' ? this.autoStockCells(cfg) : cfg.quality;
            const maxCells = Math.min(cells, this.renderer3d.stockMaxCells);
            this.stockSim = new StockSimulator(cfg.stock, cfg.tools, { maxCells });
            this.stockSim.setPriorJobs((this.priorJobs || []).filter(job => job.status === 'loaded'));
            this.stockSim.setHiddenTools(this.hiddenToolKeys());
            this.stockSim.setSegments(this.segments);
            this.renderer3d.setStockSimulator(this.stockSim);
            this.stockFluteWarnings = this.findFluteLengthProblems();
            this.stockInfoText = null;
        }

        const paths = document.getElementById('stock-paths');
        const layerOnly = document.getElementById('stock-paths-layer');
        this.renderer3d.setStockDisplay(visible, paths ? paths.checked : true, layerOnly ? layerOnly.checked : false);
        if (layerOnly) layerOnly.disabled = paths ? !paths.checked : false;
        this.renderer3d.onStockProgress = visible ? (sim) => this.updateStockInfo(sim) : null;
        if (!visible) this.setStockInfo('');
        if (status) status.classList.toggle('vw-ok-text', !!this.stockConfig && !problem && this.stockConfig.fromFile);
        if (this.ui) this.updateWarnings();
    }

    /**
     * Cutting moves that go deeper below the stock top than their tool's flute length (LEN),
     * where the shank would rub: [{ tool, fluteLength, over, lines }] per tool
     */
    findFluteLengthProblems() {
        const cfg = this.stockConfig;
        if (!cfg) return [];
        const byTool = new Map();
        for (const seg of this.segments) {
            if (seg.type !== 'cut') continue;
            const def = cfg.tools.get(seg.toolNumber);
            if (!def || !(def.fluteLength > 0)) continue;
            const over = cfg.stock.zmax - Math.min(seg.start.z, seg.end.z) - def.fluteLength;
            if (over <= 1e-6) continue;
            let w = byTool.get(seg.toolNumber);
            if (!w) byTool.set(seg.toolNumber, w = { tool: seg.toolNumber, fluteLength: def.fluteLength, over: 0, lines: [] });
            w.over = Math.max(w.over, over);
            if (w.lines[w.lines.length - 1] !== seg.lineNum) w.lines.push(seg.lineNum);
        }
        return [...byTool.values()];
    }

    /**
     * Grid size for Auto detail: cells about 1/8 of the smallest cutting feature (a tapered
     * ball's tip, half a V-bit, else the diameter), from 1 to 6 million cells
     */
    autoStockCells(cfg) {
        const s = cfg.stock;
        const area = (s.xmax - s.xmin) * (s.ymax - s.ymin);
        let feature = Infinity;
        for (const def of cfg.tools.values()) {
            if (!(def.diameter > 0)) continue;
            let size = def.diameter;
            if (def.shape === 'taperball' && def.tip > 0) size = Math.min(def.diameter, def.tip);
            else if (def.shape === 'vbit' || def.shape === 'chamfer') size = def.diameter / 2;
            feature = Math.min(feature, size);
        }
        if (!isFinite(feature)) return 1e6;
        const cell = feature / 8;
        return Math.max(1e6, Math.min(6e6, area / (cell * cell)));
    }

    /**
     * Carving progress, grid size and warnings for moves that rapid into the stock or cut
     * deeper than the flutes
     */
    updateStockInfo(sim) {
        const total = Math.min(this.renderer3d.maxSegmentIndex, sim.segments.length);
        const unit = this.stockConfig.units === 'inches' ? 'in' : 'mm';
        let html = sim.carvedIndex < total
            ? `Carving… ${Math.floor(sim.carvedIndex / Math.max(total, 1) * 100)}%`
            : `${sim.nx} × ${sim.ny} grid, ${+sim.dx.toFixed(3)} ${unit} cells`;
        const prior = (this.priorJobs || []).filter(job => job.status === 'loaded').length;
        if (prior > 0) html += `, after ${prior} earlier job${prior === 1 ? '' : 's'}`;
        const warnings = [];
        for (const w of this.stockFluteWarnings || []) {
            const lines = w.lines.map(n => this.toDisplayLine(n)).filter(n => n > 0);
            const shown = lines.slice(0, 5).join(', ') + (lines.length > 5 ? ', …' : '');
            warnings.push(`T${w.tool} cuts ${+w.over.toFixed(3)} ${unit} deeper than its ` +
                `${+w.fluteLength.toFixed(3)} ${unit} flute length, so the shank would rub` +
                (shown ? ` (line${lines.length === 1 ? '' : 's'} ${shown})` : ''));
        }
        if (sim.gouges.size > 0) {
            const lines = [...sim.gouges].sort((a, b) => a - b)
                .map(i => this.toDisplayLine(sim.segments[i].lineNum)).filter(n => n > 0);
            const shown = lines.slice(0, 5).join(', ') + (lines.length > 5 ? ', …' : '');
            const count = sim.gouges.size;
            warnings.push(`${count} rapid move${count === 1 ? '' : 's'} cut${count === 1 ? 's' : ''} into the stock` +
                (shown ? ` (line${lines.length === 1 ? '' : 's'} ${shown})` : ''));
        }
        if (this.ui) {
            // Listed in the Warnings section
            this.setStockWarnings(warnings);
        } else {
            html += warnings.map(w => `<span class="stock-warning">⚠️ ${w}</span>`).join('');
        }
        this.setStockInfo(html);
    }

    setStockWarnings(warnings) {
        const key = warnings.join('\n');
        if (key === this.stockWarningsKey) return;
        this.stockWarningsKey = key;
        this.stockWarnings = warnings;
        this.updateWarnings();
    }

    /**
     * Warnings section (viewer layout): stock simulation problems (rapids into the stock,
     * cuts deeper than the flutes). The count opens the section when there are any.
     */
    updateWarnings() {
        const list = document.getElementById('warn-list');
        const count = document.getElementById('warn-count');
        if (!list || !count) return;
        const warnings = this.stockVisible ? (this.stockWarnings || []) : [];
        list.innerHTML = warnings.length > 0
            ? warnings.map(w => `<li>${this.escapeHtml(w)}</li>`).join('')
            : `<li class="vw-none">${this.stockVisible ? 'No problems found in the simulated cut.' : 'Turn on the stock simulation to check the cut.'}</li>`;
        count.textContent = warnings.length;
        count.classList.toggle('vw-warn', warnings.length > 0);
        const section = document.getElementById('warn-section');
        if (section && warnings.length > 0 && !this.warningsShown) {
            this.warningsShown = true;
            ViewerUI.setSectionOpen(section, true);
        }
    }

    setStockInfo(html) {
        if (html === this.stockInfoText) return;
        this.stockInfoText = html;
        const info = document.getElementById('stock-info');
        if (info) info.innerHTML = html;
    }

    /**
     * What Reset View and double-click frame: the stock while it's shown, else the toolpaths
     */
    viewBounds() {
        const cfg = this.stockConfig;
        if (this.stockVisible && cfg && this.stockConfigProblem() === null) {
            const s = cfg.stock;
            return { minX: s.xmin, maxX: s.xmax, minY: s.ymin, maxY: s.ymax, minZ: s.zmin, maxZ: s.zmax };
        }
        return this.bounds;
    }

    /**
     * Size the 3D grid (the machine bed): from the machine's max travel in a loaded
     * config.yaml, or else a little larger than the stock (5%, at least 10 mm / 0.5 in,
     * rounded up to 10 mm / 1 in).
     * A size typed in by hand, or read from a connected FluidNC machine, is kept.
     */
    updateGridSize() {
        const widthInput = document.getElementById('grid-width');
        const heightInput = document.getElementById('grid-height');
        if (!widthInput || !heightInput) return;
        if (!this.gridDefault) this.gridDefault = { width: widthInput.value, height: heightInput.value };
        const source = document.getElementById('grid-source');
        const setSource = (text) => { if (source) source.textContent = text; };
        if (this.gridUserSet) return setSource('Size entered by hand.');
        if (this.gridFromMachine) return setSource('The machine\'s travel, read from the controller.');

        const cfg = this.stockConfig;
        const inches = (cfg ? cfg.units : this.parser.units) === 'inches';
        const values = this.parser.machineValues && this.parser.machineValues.values;
        const travelX = values && values['/axes/x/max_travel_mm'];
        const travelY = values && values['/axes/y/max_travel_mm'];
        let width = this.gridDefault.width, height = this.gridDefault.height;
        setSource('Sized from the stock. Load a config.yaml to use the machine\'s travel.');
        if (travelX > 0 && travelY > 0) {
            width = +(inches ? travelX / 25.4 : travelX).toFixed(2);
            height = +(inches ? travelY / 25.4 : travelY).toFixed(2);
            setSource('The machine\'s travel, from the loaded config.yaml.');
        } else if (cfg && this.stockConfigProblem() === null) {
            const step = inches ? 1 : 10;
            const around = (size) => Math.max(step, Math.ceil((size + Math.max(size * 0.05, step)) / step) * step);
            width = around(cfg.stock.xmax);
            height = around(cfg.stock.ymax);
        }
        if (String(width) === widthInput.value && String(height) === heightInput.value) return;
        widthInput.value = width;
        heightInput.value = height;
        widthInput.dispatchEvent(new Event('input', { bubbles: true }));
        heightInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * Stock bounds guessed from the cutting moves: the cut area plus the largest tool
     * radius, from the deepest cut up to Z0 (or from Z0 up when the file cuts above zero)
     */
    estimateStock(tools, units) {
        const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const seg of this.segments) {
            if (seg.type !== 'cut') continue;
            for (const p of [seg.start, seg.end]) {
                b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
                b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
                b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
            }
        }
        let radius = 0;
        for (const def of tools.values()) radius = Math.max(radius, (def.diameter || 0) / 2);
        const round = (v) => {
            const f = units === 'inches' ? 1e4 : 100;
            return Math.round(v * f) / f;
        };
        const tiny = units === 'inches' ? 0.001 : 0.01;
        let zmin, zmax;
        if (b.minZ < -tiny) {
            zmin = b.minZ;
            zmax = 0;
        } else {
            zmin = 0;
            zmax = b.maxZ > tiny ? b.maxZ : (units === 'inches' ? 0.75 : 19);
        }
        return {
            xmin: round(b.minX - radius), xmax: round(b.maxX + radius),
            ymin: round(b.minY - radius), ymax: round(b.maxY + radius),
            zmin: round(zmin), zmax: round(zmax)
        };
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

        // Viewer layout: one summary line
        const sumTime = document.getElementById(`${idPrefix}sum-time`);
        if (sumTime) {
            const b = this.bounds;
            const range = (min, max) => `${this.formatCoord(min)} – ${this.formatCoord(max)}`;
            sumTime.textContent = this.animator.getFormattedTime();
            const tools = this.tools.size;
            document.getElementById(`${idPrefix}sum-meta`).textContent =
                `est. · ${this.segments.length} segments · ${tools} tool${tools === 1 ? '' : 's'}`;
            document.getElementById(`${idPrefix}sum-ranges`).innerHTML =
                `<span>X ${range(b.minX, b.maxX)}</span><span>Y ${range(b.minY, b.maxY)}</span><span>Z ${range(b.minZ, b.maxZ)}</span>`;
        }
    }

    /**
     * A coordinate with up to one decimal (three for inch files), minus sign as −
     */
    formatCoord(value, decimals) {
        if (decimals === undefined) decimals = this.parser.units === 'inches' ? 3 : 1;
        const text = (+value.toFixed(decimals)).toFixed(decimals);
        return text.replace(/^-/, '−').replace(/^−(0\.?0*)$/, '$1');
    }

    /**
     * Update coordinate display (z null: a point under the mouse in the 2D view)
     */
    updateCoordinateDisplay(x, y, z) {
        const coordsElement = document.getElementById('coordinates');
        if (!coordsElement) return;
        if (this.ui) {
            const d = this.parser.units === 'inches' ? 3 : 2;
            coordsElement.textContent = `X ${this.formatCoord(x, d)}  Y ${this.formatCoord(y, d)}` +
                (z === null || z === undefined ? '' : `  Z ${this.formatCoord(z, d)}`);
            return;
        }
        coordsElement.textContent = `X: ${x.toFixed(2)} Y: ${y.toFixed(2)} Z: ${(z || 0).toFixed(2)}`;
    }

    /**
     * Display GCode text in the GCode panel.
     * For parametric files (see parser.expansion) this shows the expanded
     * G-code by default, with a toggle to switch to the original source.
     */
    displayGCode(text, idPrefix = '') {
        const expansion = this.parser.expansion;
        this.gcodeExpansion = expansion && expansion.output ? expansion : null;
        this.gcodeRawText = text;
        this.gcodeIdPrefix = idPrefix;
        this.gcodeCurrentSegmentLine = null;
        if (!this.gcodeViewMode) this.gcodeViewMode = 'expanded';

        this.updateExpansionUI(expansion, idPrefix);
        this.renderGCodeView();
    }

    /**
     * Render the GCode panel for the current view mode (expanded or source)
     */
    renderGCodeView() {
        const exp = this.gcodeExpansion;
        const showSource = !!exp && this.gcodeViewMode === 'source';
        const text = !exp ? this.gcodeRawText : (showSource ? exp.sourceText : exp.output);
        const highlighter = showSource && typeof highlightParametricGCodeLine === 'function'
            ? highlightParametricGCodeLine
            : (line) => this.syntaxHighlightGCode(line);

        this.renderGCodeText(text, this.gcodeIdPrefix, highlighter);

        // Keep the current animation position highlighted after switching views
        if (this.gcodeCurrentSegmentLine) {
            this.highlightGCodeLine(this.toDisplayLine(this.gcodeCurrentSegmentLine));
        }
    }

    /**
     * Map a segment line number (a line of the parsed/expanded G-code) to the
     * line shown in the GCode panel. Returns 0 if the line has no source line.
     */
    toDisplayLine(lineNum) {
        const exp = this.gcodeExpansion;
        if (!exp || this.gcodeViewMode !== 'source') return lineNum;
        return exp.sourceMap[lineNum - 1] || 0;
    }

    /**
     * Show or hide the Expanded/Source toggle and the expansion warnings notice
     */
    updateExpansionUI(expansion, idPrefix = '') {
        const heading = document.querySelector(`#${idPrefix}gcode-panel h3`);

        // Expanded / Source toggle in the panel heading
        let toggle = document.getElementById(`${idPrefix}gcode-view-toggle`);
        if (expansion && expansion.output && heading) {
            if (!toggle) {
                toggle = document.createElement('span');
                toggle.id = `${idPrefix}gcode-view-toggle`;
                toggle.className = 'gcode-view-toggle';
                toggle.innerHTML =
                    '<button type="button" data-mode="expanded" title="Show the expanded G-code that is visualized">Expanded</button>' +
                    '<button type="button" data-mode="source" title="Show the original parametric source">Source</button>';
                toggle.addEventListener('click', (e) => {
                    const button = e.target.closest('button[data-mode]');
                    if (!button || button.dataset.mode === this.gcodeViewMode) return;
                    this.gcodeViewMode = button.dataset.mode;
                    this.updateViewToggleButtons();
                    this.renderGCodeView();
                });
                heading.appendChild(toggle);
            }
            this.updateViewToggleButtons();
        } else if (toggle) {
            toggle.remove();
        }

        // Warnings / error notice below the heading (or in a host-provided element)
        let notice = document.getElementById(`${idPrefix}gcode-expand-notice`);
        const external = (expansion && !expansion.error && expansion.external) || [];
        const hasProblems = expansion && (expansion.error || expansion.warnings.length > 0);
        if (!hasProblems && external.length === 0) {
            if (notice) notice.style.display = 'none';
            return;
        }
        if (!notice) {
            if (!heading) return;
            notice = document.createElement('div');
            notice.id = `${idPrefix}gcode-expand-notice`;
            notice.className = 'gcode-expand-notice';
            heading.insertAdjacentElement('afterend', notice);
        }
        if (expansion.error) {
            notice.innerHTML = `⚠️ Could not expand parametric G-code: ${this.escapeHtml(expansion.error)}. Showing the file as-is.`;
        } else {
            let html = '';
            if (external.length > 0) html += this.externalInputsHtml(external);
            const count = expansion.warnings.length;
            if (count > 0) {
                const items = expansion.warnings.map(w => `<li>${this.escapeHtml(w)}</li>`).join('');
                html += `<details><summary>⚠️ ${count} expansion warning${count === 1 ? '' : 's'}</summary><ul>${items}</ul></details>`;
            }
            notice.innerHTML = html;
            this.bindExternalInputs(notice);
        }
        notice.style.display = '';
    }

    /**
     * Form for the parameters a file reads but doesn't set (FluidNC globals, numbered
     * parameters, config values). The values are only used to draw the preview; nothing
     * is added to the file or the expanded G-code. Opens by itself while any are missing.
     */
    externalInputsHtml(external) {
        const missing = external.filter(p => !p.known).length;
        const rows = external.map(p => {
            const value = p.key in this.parser.inputValues ? this.parser.inputValues[p.key] : '';
            return `<label class="gcode-input-row"><code>${this.escapeHtml(p.display)}</code>` +
                `<input type="number" step="any" data-key="${this.escapeHtml(p.key)}" value="${value}"></label>`;
        }).join('');
        const summary = missing
            ? `✏️ Enter ${missing} value${missing === 1 ? '' : 's'} set outside this file to preview it`
            : `✏️ Values set outside this file (${external.length})`;
        return `<details class="gcode-inputs"${missing ? ' open' : ''}><summary>${summary}</summary>` +
            `<div class="gcode-inputs-help">Used only for the preview — nothing is added to the G-code.</div>` +
            `${rows}<button type="button" class="gcode-inputs-apply">Apply</button></details>`;
    }

    bindExternalInputs(notice) {
        const form = notice.querySelector('.gcode-inputs');
        if (!form) return;
        const apply = () => {
            const values = { ...this.parser.inputValues };
            form.querySelectorAll('input[data-key]').forEach(input => {
                const value = parseFloat(input.value);
                if (input.value.trim() === '' || isNaN(value)) delete values[input.dataset.key];
                else values[input.dataset.key] = value;
            });
            this.saveInputValues(values);
            this.reloadCurrentGCode();
        };
        form.querySelector('.gcode-inputs-apply').addEventListener('click', apply);
        form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) apply(); });
    }

    updateViewToggleButtons() {
        const toggle = document.getElementById(`${this.gcodeIdPrefix || ''}gcode-view-toggle`);
        if (!toggle) return;
        toggle.querySelectorAll('button[data-mode]').forEach(button => {
            button.classList.toggle('active', button.dataset.mode === this.gcodeViewMode);
        });
    }

    /**
     * Render GCode text with virtual scrolling for large files
     */
    renderGCodeText(text, idPrefix = '', highlighter = (line) => this.syntaxHighlightGCode(line)) {
        const container = document.getElementById(`${idPrefix}gcode-container`);
        if (!container) return;

        const lines = text.split(/\r?\n/);
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
                const highlighted = highlighter(lines[i]);
                codeHTML.push(`<div class="gcode-line${highlight}" data-line="${i + 1}">${highlighted || '&nbsp;'}</div>`);
            }
            displayDiv.innerHTML = codeHTML.join('');
        };
        
        // Store render function for use in highlightGCodeLine
        this.gcodeRenderVisibleLines = renderVisibleLines;
        
        // Initial render - use requestAnimationFrame and timeout to ensure container has dimensions
        renderVisibleLines(true);
        requestAnimationFrame(() => renderVisibleLines(true));
        setTimeout(() => renderVisibleLines(true), 100);

        // Container listeners are bound once and survive re-renders (new files, view toggles)
        if (container.dataset.gcodeListenersBound) return;
        container.dataset.gcodeListenersBound = 'true';

        // Scroll event with requestAnimationFrame for smooth performance
        let ticking = false;
        container.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    if (this.gcodeRenderVisibleLines) this.gcodeRenderVisibleLines();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });

        // Click handler with event delegation
        container.addEventListener('click', (e) => {
            const lineDiv = e.target.closest('.gcode-line');
            if (!lineDiv) return;

            const lineNumber = parseInt(lineDiv.dataset.line);
            if (!lineNumber) return;

            this.handleGCodeLineClick(lineNumber);
        });
    }

    /**
     * Jump the animation to the segment for a clicked line in the GCode panel
     */
    handleGCodeLineClick(lineNumber) {
        const exp = this.gcodeExpansion;
        let segmentIndex;

        if (exp && this.gcodeViewMode === 'source') {
            // A source line inside a loop produces many segments (and a skipped branch none):
            // jump to the next one after the current position, wrapping around to the start
            const fromSource = (seg) => exp.sourceMap[seg.lineNum - 1] === lineNumber;
            const current = this.animator.currentIndex;
            segmentIndex = this.segments.findIndex((seg, i) => i > current && fromSource(seg));
            if (segmentIndex === -1) segmentIndex = this.segments.findIndex(fromSource);
        } else {
            segmentIndex = this.segments.findIndex(seg => seg.lineNum >= lineNumber);
        }

        if (segmentIndex === -1) return;

        this.animator.currentIndex = segmentIndex;
        this.animator.onUpdate(segmentIndex);

        if (this.currentView === '2d') {
            this.renderer2d.render();
        } else {
            this.renderer3d.render();
        }

        this.highlightGCodeLine(lineNumber);
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
     * Update range highlight bar position
     */
    updateRangeHighlight() {
        const minSlider = document.getElementById('layer-slider-min');
        const maxSlider = document.getElementById('layer-slider-max');
        const highlight = document.getElementById('layer-range-highlight');
        
        if (!minSlider || !maxSlider || !highlight) return;
        
        const min = parseFloat(minSlider.min);
        const max = parseFloat(minSlider.max);
        const minVal = parseFloat(minSlider.value);
        const maxVal = parseFloat(maxSlider.value);
        
        // Calculate percentage positions
        const minPercent = ((minVal - min) / (max - min)) * 100;
        const maxPercent = ((maxVal - min) / (max - min)) * 100;
        
        // Update highlight position and width
        highlight.style.left = minPercent + '%';
        highlight.style.width = (maxPercent - minPercent) + '%';
    }

    /**
     * Update layer filter
     */
    updateLayerFilter() {
        const minSlider = document.getElementById('layer-slider-min');
        const maxSlider = document.getElementById('layer-slider-max');
        
        // Use slider values if available
        const min = minSlider ? parseFloat(minSlider.value) : -Infinity;
        const max = maxSlider ? parseFloat(maxSlider.value) : Infinity;
        
        this.renderer2d.setLayerFilter(min, max);
        this.renderer3d.setLayerFilter(min, max);
    }
    
    /**
     * Initialize layer filter sliders with bounds from loaded file
     */
    initializeLayerSliders() {
        if (!this.bounds) return;
        
        const minSlider = document.getElementById('layer-slider-min');
        const maxSlider = document.getElementById('layer-slider-max');
        const minValue = document.getElementById('layer-min-value');
        const maxValue = document.getElementById('layer-max-value');
        
        if (!minSlider || !maxSlider) return;
        
        // Round to 0.1 precision
        const minZ = Math.floor(this.bounds.minZ * 10) / 10;
        const maxZ = Math.ceil(this.bounds.maxZ * 10) / 10;
        
        // Set slider ranges
        minSlider.min = minZ;
        minSlider.max = maxZ;
        minSlider.value = minZ;
        
        maxSlider.min = minZ;
        maxSlider.max = maxZ;
        maxSlider.value = maxZ;
        
        // Update display values
        if (minValue) minValue.textContent = minZ.toFixed(1);
        if (maxValue) maxValue.textContent = maxZ.toFixed(1);
        
        // Update highlight bar
        this.updateRangeHighlight();
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
            this.camera.orthoScale = this.camera.targetOrthoScale = baseScale / zoom;
        }
    }

    /**
     * Draw the current view now (the render loop also redraws it every frame)
     */
    render() {
        if (this.currentView === '2d') {
            this.renderer2d.render();
        } else {
            this.renderer3d.render();
        }
    }

    /**
     * Toggle between 2D and 3D views
     */
    toggleView() {
        this.setView(this.currentView === '2d' ? '3d' : '2d');
    }

    /**
     * Show the 2D or the 3D view
     * @param {string} view - '2d' | '3d'
     */
    setView(view) {
        this.currentView = view === '3d' ? '3d' : '2d';
        const is3d = this.currentView === '3d';
        this.canvas2d.classList.toggle('hidden', is3d);
        this.canvas3d.classList.toggle('hidden', !is3d);
        this.canvas3dOverlay.classList.toggle('hidden', !is3d);
        // The pages' own markup has one toggle button; the viewer layout two
        const toggle = document.getElementById('btn-toggle-view');
        if (toggle) toggle.textContent = is3d ? '2D View' : '3D View';
        const b2 = document.getElementById('view-2d'), b3 = document.getElementById('view-3d');
        if (b2) b2.setAttribute('aria-pressed', String(!is3d));
        if (b3) b3.setAttribute('aria-pressed', String(is3d));
        if (is3d) this.mouseOverView = false;

        // Update zoom slider to reflect current view's zoom
        this.updateZoomSlider();
    }

    /**
     * Update zoom slider to reflect current zoom level
     */
    updateZoomSlider() {
        const slider = document.getElementById('zoom-slider');
        const display = document.getElementById('zoom-value');
        if (!slider && !display) return;

        let relativeZoom;
        if (this.currentView === '2d') {
            // Relative to initial fit-to-bounds zoom
            relativeZoom = this.camera.zoom2d / this.camera.initialZoom2d;
        } else {
            // Relative to initial orthoScale (smaller orthoScale = more zoomed in)
            relativeZoom = this.camera.initialOrthoScale / this.camera.targetOrthoScale;
        }
        
        if (!isFinite(relativeZoom)) relativeZoom = 1;
        if (slider) slider.value = relativeZoom;
        if (display) display.textContent = Math.round(relativeZoom * 100) + '%';
    }

    /**
     * Toggle animation playback
     */
    togglePlayback() {
        if (this.simPromptAt !== null && this.simPromptAt !== undefined && !this.animator.getIsPlaying()) {
            this.resumeSim();
            return;
        }
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
        if (this.ui) {
            // Older tab names: settings / display / gcode
            const tab = { settings: 'job', display: 'view', gcode: 'code' }[tabName] || tabName;
            ViewerUI.setTab(tab);
            return;
        }
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
            // The drawn tool spins while the animation plays (or, in FluidNC, a job runs),
            // but not while probing: the spindle is off from attaching the plate to removing it
            this.renderer3d.toolSpinning = (this.animator.getIsPlaying() || !!this.isRunning) && !this.probing;
            
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

// Initialize on page load: only the standalone viewer. Other hosts (FluidNC, VS Code,
// FigUI) create their own controller, and the Font Creator creates one for its preview.
window.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.host === 'standalone') {
        new Controller();
    }
});
