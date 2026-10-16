/**
 * FluidNC Controller Extension
 * Extends the base Controller with the FluidNC WebUI extension's features: the SD card
 * browser, Preview and Run, and following a job while it runs (started here or anywhere
 * else), with a feed hold button.
 *
 * It talks to the machine through an API object: FluidNCAPI (WebUI v3 postMessage) here,
 * or the FigUI plugin bridge (figui-api.js) with the same methods: listSDFiles,
 * readSDFile, runSDFile, sendCommandNoWait, readSetting, queryParameter, getMaxTravelX/Y,
 * getMotionParameters and on('stream').
 */

class FluidNCController extends Controller {
    constructor(api) {
        super();
        this.fluidAPI = api;
        this.currentPath = '/';
        this.selectedFile = null;
        this.isRunning = false; // True while a followed job is moving (State Run)
        this.following = false; // Following a job on the machine (running or held)
        this.runningFilePath = null; // The file the machine is running (from its status)
        this.currentFilePath = null; // Track current loaded file path
        this.machineState = null;
        this.setupFluidNCListeners();
        this.loadSDFiles();
        this.syncGridFromFluidNC(); // Auto-sync grid dimensions on load
        this.setupStatusMonitoring(); // Monitor FluidNC status messages
        this.restoreViewerState(); // Restore previous state if available
    }

    /**
     * Setup FluidNC-specific event listeners
     */
    setupFluidNCListeners() {
        const on = (id, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', handler);
        };
        on('btn-load-file', () => { if (this.selectedFile) this.loadSDFile(this.selectedFile); });
        on('btn-run-file', () => { if (this.selectedFile) this.runSDFile(this.selectedFile); });
        on('btn-sd-refresh', () => this.loadSDFiles(this.currentPath));
        on('btn-pause-resume', () => this.togglePauseResume());
        on('btn-follow-running', () => this.showRunningFile());
    }

    /**
     * Setup status monitoring from FluidNC stream messages
     */
    setupStatusMonitoring() {
        this.fluidAPI.on('stream', (content) => {
            this.handleStatusUpdate(content);
        });
    }

    /**
     * Status reports from FluidNC:
     * <Run|MPos:X,Y,Z|FS:feed,speed|WCO:X,Y,Z|SD:percent,/sd/file.nc>
     * They give the state, the position and, while a file runs from the SD card, how far
     * through it the machine is (by bytes read).
     */
    handleStatusUpdate(content) {
        if (typeof content !== 'string') return;
        const report = content.match(/<([^>]*)>/);
        if (!report) return;
        const fields = report[1].split('|');
        const state = fields[0].split(':')[0];
        this.machineState = state;

        // Work position: WPos, or MPos less the last work offset (WCO, sent now and then)
        const values = (name) => {
            const field = fields.find(f => f.startsWith(name + ':'));
            if (!field) return null;
            const v = field.slice(name.length + 1).split(',').map(Number);
            return v.length >= 3 && v.every(isFinite) ? v : null;
        };
        const wco = values('WCO');
        if (wco) this.workOffset = wco;
        const wpos = values('WPos');
        const mpos = values('MPos');
        const pos = wpos || (mpos && this.workOffset ? mpos.map((v, i) => v - this.workOffset[i]) : null);

        let sdPercent = null, sdPath = null;
        const sd = fields.find(f => f.startsWith('SD:'));
        if (sd) {
            const m = sd.match(/^SD:([\d.]+),(.+)$/);
            if (m) {
                sdPercent = parseFloat(m[1]);
                sdPath = this.normalizeSDPath(m[2].trim());
            }
        }

        const active = state === 'Run' || state === 'Hold' || state === 'Door';
        if (sdPath && active) {
            const loaded = this.currentFilePath ? this.normalizeSDPath(this.currentFilePath) : null;
            if (!this.following && loaded === sdPath && this.gcodeText) {
                // A job on the loaded file, started here or from elsewhere: follow it
                this.startFollowing(this.currentFilePath, sdPercent);
            }
            if (this.following && this.normalizeSDPath(this.runningFilePath) === sdPath) {
                // M6 and other macro files report their own name: only the job's counts
                this.onRunProgress(sdPercent);
            }
            this.setRunningBanner(this.following ? null : sdPath);
        } else if (!active && state !== 'Home') {
            this.setRunningBanner(null);
        }

        if (this.following) {
            this.isRunning = state === 'Run';
            if (pos) {
                this.machinePosition = { x: pos[0], y: pos[1], z: pos[2] };
                this.updateCoordinateDisplay(pos[0], pos[1], pos[2]);
            }
            this.updatePauseButton();
            // Finished, stopped or alarmed
            if (state === 'Idle' || state === 'Alarm') this.stopFollowing();
        }
    }

    normalizeSDPath(path) {
        return (path || '').replace(/^\/sd(?=\/)/, '');
    }

    /**
     * Feed hold (!) while running, cycle start (~) while held
     */
    togglePauseResume() {
        const held = (this.machineState || '').startsWith('Hold') || this.machineState === 'Door';
        this.fluidAPI.sendCommandNoWait(held ? '~' : '!');
    }

    updatePauseButton() {
        const btn = document.getElementById('btn-pause-resume');
        if (!btn) return;
        const held = this.machineState === 'Hold' || this.machineState === 'Door';
        btn.classList.toggle('vw-held', held);
        const label = btn.querySelector('span');
        if (label) label.textContent = held ? 'Resume (cycle start)' : 'Pause (feed hold)';
    }

    /**
     * Sync grid dimensions from FluidNC settings (runs automatically on load)
     */
    async syncGridFromFluidNC() {
        // Opened on its own, not inside the WebUI: there's no machine to ask
        if (this.fluidAPI.isInIframe === false) return;
        try {
            const [width, height, motionParams] = await Promise.all([
                this.fluidAPI.getMaxTravelX(),
                this.fluidAPI.getMaxTravelY(),
                this.fluidAPI.getMotionParameters()
            ]);

            const widthInput = document.getElementById('grid-width');
            const heightInput = document.getElementById('grid-height');

            widthInput.value = Math.round(width);
            heightInput.value = Math.round(height);
            this.gridFromMachine = true; // the real bed: not sized from the stock
            this.updateGridSize();

            // Trigger input events so the renderers pick up the change
            widthInput.dispatchEvent(new Event('input', { bubbles: true }));
            heightInput.dispatchEvent(new Event('input', { bubbles: true }));

            // Apply motion parameters to animator
            this.animator.setMotionParameters(motionParams);
            if (this.segments.length > 0) {
                // Times depend on them: estimate the loaded file again
                this.animator.setSegments(this.segments);
                this.updateStatistics();
                this.updateToolPanel();
            }

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
        browser.innerHTML = '<div class="vw-empty-note">Loading files…</div>';

        try {
            const files = await this.fluidAPI.listSDFiles(path);
            this.renderFileBrowser(files);
            this.updateBreadcrumb(path);
        } catch (error) {
            console.error('Failed to load SD files:', error);
            browser.innerHTML = '<div class="vw-empty-note">Couldn\'t read the SD card</div>';
        }
    }

    /**
     * Render file browser UI
     */
    renderFileBrowser(files) {
        const browser = document.getElementById('file-browser');

        if (files.length === 0) {
            browser.innerHTML = '<div class="vw-empty-note">No G-code files here</div>';
            return;
        }

        browser.innerHTML = '';

        // Sort: directories first, then files
        files.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { numeric: true });
        });

        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'file-item' + (file.type === 'dir' ? ' vw-dir' : '');
            item.setAttribute('role', 'button');
            item.tabIndex = 0;

            const icon = document.createElement('div');
            icon.className = 'file-icon';
            icon.textContent = file.type === 'dir' ? '▸' : 'NC';

            const info = document.createElement('div');
            info.className = 'file-info';

            const name = document.createElement('div');
            name.className = 'file-name';
            name.textContent = file.name;
            info.appendChild(name);

            const size = document.createElement('div');
            size.className = 'file-size';
            size.textContent = file.type === 'dir' ? 'folder' : this.formatFileSize(file.size);
            info.appendChild(size);

            item.appendChild(icon);
            item.appendChild(info);
            if (this.selectedFile && this.selectedFile.path === file.path) item.classList.add('selected');

            const open = () => {
                if (file.type === 'dir') this.loadSDFiles(file.path);
                else this.selectFile(file, item);
            };
            item.addEventListener('click', open);
            item.addEventListener('dblclick', () => { if (file.type !== 'dir') this.loadSDFile(file); });
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
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
            item.textContent = part || 'SD card';
            currentPath += (part ? '/' + part : '');
            const targetPath = currentPath || '/';
            item.setAttribute('data-path', targetPath);

            if (index < parts.length - 1) {
                item.setAttribute('role', 'button');
                item.tabIndex = 0;
                item.addEventListener('click', () => this.loadSDFiles(targetPath));
            }

            breadcrumb.appendChild(item);
        });
    }

    /**
     * Select a file
     */
    selectFile(file, element) {
        document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
        element.classList.add('selected');
        this.selectedFile = file;

        const name = document.getElementById('sd-selected-name');
        const meta = document.getElementById('sd-selected-meta');
        if (name) name.textContent = file.name;
        if (meta) meta.textContent = this.formatFileSize(file.size);
        for (const id of ['btn-load-file', 'btn-run-file', 'btn-open-host']) {
            const button = document.getElementById(id);
            if (button) button.disabled = false;
        }
    }

    /**
     * Load file from SD card
     */
    async loadSDFile(file) {
        const progressBar = document.getElementById('progress-bar');
        const progressFill = document.getElementById('progress-fill');

        progressBar.classList.remove('hidden');
        progressFill.style.width = '0%';

        try {
            // Download file with progress updates
            const content = await this.fluidAPI.readSDFile(file.path, (percent) => {
                progressFill.style.width = percent + '%';
            });

            // Switch to parsing progress
            progressFill.style.width = '0%';

            // Process the GCode content using existing loadFile logic
            this.loadingFilePath = file.path; // folder for earlier jobs (readPriorJob)
            await this.processGCode(content, file.name);

            // Store current file path, cache file, and clear any previous execution state
            this.currentFilePath = file.path;
            await this.cacheFile(this.currentFilePath, content); // Cache for potential state restoration
            this.clearViewerState(); // Clear execution state from previous file
            this.saveViewerState();

            progressFill.style.width = '100%';
            setTimeout(() => {
                progressBar.classList.add('hidden');
            }, 500);

        } catch (error) {
            console.error('Failed to load SD file:', error);
            alert('Failed to load file from SD card: ' + error.message);
            progressBar.classList.add('hidden');
        }
    }

    /**
     * Read the machine values a parametric file refers to straight from the controller:
     * config values (#</axes/x/max_travel_mm>) with $/ setting queries, and globals
     * (#<_x>) and numbered parameters (#5221) with the D word. The values are a snapshot
     * of the machine now, so the preview matches the start of the job.
     * Only queries while the machine is Idle. Returns machineValues for the expander, or null.
     */
    async readMachineValues(text) {
        if (this.machineState && this.machineState !== 'Idle') {
            console.log('[FluidNC] Not reading machine values while', this.machineState);
            return null;
        }

        // Parameter references outside comments: #</config/path>, #<_global>, #123
        const refs = new Map();  // expander key -> { kind, ref }
        for (const line of text.split('\n')) {
            const code = line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '');
            for (const m of code.matchAll(/#<\s*([_/][^>]*?)\s*>|#(\d+)/g)) {
                if (m[1] !== undefined) {
                    const name = m[1];
                    refs.set(name.toLowerCase(), name[0] === '/'
                        ? { kind: 'setting', ref: name }
                        : { kind: 'param', ref: '#<' + name + '>' });
                } else {
                    refs.set('#' + parseInt(m[2], 10), { kind: 'param', ref: '#' + parseInt(m[2], 10) });
                }
            }
        }
        if (refs.size === 0) return null;

        const MAX_QUERIES = 50;
        const values = {};
        let paramQueriesWork = true;  // stop D queries if the controller doesn't answer one
        let count = 0;
        for (const [key, { kind, ref }] of [...refs].slice(0, MAX_QUERIES)) {
            let value = null;
            if (kind === 'setting') {
                const raw = ((await this.fluidAPI.readSetting(ref)).value || '').trim();
                if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(raw)) value = parseFloat(raw);
                else if (/^true$/i.test(raw)) value = 1;
                else if (/^false$/i.test(raw)) value = 0;
            } else if (paramQueriesWork) {
                const result = await this.fluidAPI.queryParameter(ref);
                if (result.timedOut) paramQueriesWork = false;
                value = result.value;
            }
            if (value !== null && !isNaN(value)) {
                values[key] = value;
                count++;
            }
        }
        console.log(`[FluidNC] Read ${count} of ${refs.size} machine values from the controller`, values);
        return { values, source: 'the controller', live: true, count };
    }

    /**
     * Earlier jobs for the stock simulation are read from the SD card folder of the file
     * being previewed, only while the machine is Idle
     */
    async readPriorJob(name) {
        const current = this.loadingFilePath || this.currentFilePath;
        if (!current) return null;
        if (this.machineState && this.machineState !== 'Idle') {
            console.log('[FluidNC] Not reading earlier jobs while', this.machineState);
            return null;
        }
        const folder = current.slice(0, current.lastIndexOf('/')) || '/';
        // A download of a missing file gets no reply, so check the folder first
        const wanted = name.split(/[\\/]/).pop().toLowerCase();
        const files = await this.fluidAPI.listSDFiles(folder);
        const file = files.find(f => f.type === 'file' && f.name.toLowerCase() === wanted);
        return file ? this.fluidAPI.readSDFile(file.path) : null;
    }

    /**
     * Re-expand and redraw the current file (after entering outside values)
     */
    reloadCurrentGCode() {
        const filename = (this.currentFilePath || '').split('/').pop() || 'file.nc';
        return this.processGCode(this.gcodeText, filename);
    }

    /**
     * Process GCode content (reusing existing logic)
     */
    async processGCode(text, filename) {
        const progressFill = document.getElementById('progress-fill');

        // Parametric files: read the machine values they refer to from the controller
        this.parser.machineValues = typeof isParametricGCode === 'function' && isParametricGCode(text)
            ? await this.readMachineValues(text)
            : null;

        const segments = await this.parser.parseString(text, (percent) => {
            progressFill.style.width = percent + '%';
        });
        const bounds = this.parser.getBounds();

        this.segments = segments;
        this.bounds = bounds;
        this.gcodeText = text;
        this.segmentBytePositions = null; // Recalculated lazily for the new file

        // Detect tools used in the file
        this.detectTools(segments);

        // Update renderers
        this.renderer2d.setSegments(segments, bounds);
        this.renderer3d.setSegments(segments, bounds);

        // Update renderers with tool states (colors and visibility)
        this.updateRenderers();

        // Update animator. Its timeline (feeds, rapid rates and acceleration) also
        // predicts where a running job is between progress reports
        this.animator.setSegments(segments);
        this.calculateSegmentExecutionTimes();

        this.updateStatistics();
        this.displayGCode(text);
        this.updateToolPanel();
        this.setupStockSimulation();
        this.setupSimEvents();
        this.initializeLayerSliders();
        document.getElementById('animation-panel').style.display = 'block';
        document.getElementById('tool-panel').style.display = 'block';
        document.getElementById('btn-reset-view').disabled = false;
        const welcomePanel = document.getElementById('gcode-welcome');
        if (welcomePanel) welcomePanel.style.display = 'none';

        const lineSlider = document.getElementById('line-slider');
        lineSlider.max = segments.length;
        lineSlider.value = 0;
        document.getElementById('total-lines').textContent = segments.length;
        this.onFileLoaded(filename);
    }

    /**
     * Run file on CNC
     */
    async runSDFile(file) {
        if (!confirm(`Run ${file.name} on the CNC?\n\nThis will start the job immediately.`)) return;

        const btn = document.getElementById('btn-run-file');
        btn.disabled = true;

        try {
            // Preview what will run, so the job can be followed
            if (this.normalizeSDPath(this.currentFilePath) !== this.normalizeSDPath(file.path)) {
                await this.loadSDFile(file);
            }
            this.fluidAPI.runSDFile(file.path);
            this.startFollowing(file.path, 0);
            this.switchMobileTab('view');
        } catch (error) {
            console.error('Failed to run SD file:', error);
            alert('Failed to run file: ' + error.message);
            this.stopFollowing();
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Follow a job on the machine: the animation shows where it is, predicted from the
     * timeline between progress reports (SD percent, by bytes read) and corrected by them.
     * Time only advances while the machine moves (not in a hold or at an M0).
     * @param {string} filePath - the running file
     * @param {number} percent - how far it is now (0 when it was just started)
     */
    startFollowing(filePath, percent = 0) {
        if (this.following) this.stopFollowing();
        this.following = true;
        this.runningFilePath = filePath;
        this.runPredicted = 0; // seconds into the job on the timeline
        this.runStarted = Date.now();
        this.runPercent = percent || 0;
        if (percent > 0) {
            const index = this.gcodeExpansion ? -1 : this.findSegmentByBytePosition(percent / 100 * this.fileByteLength());
            if (index >= 0) this.runPredicted = this.segmentExecutionTimes[Math.max(0, index - 1)] || 0;
            // Started before we saw it: count elapsed time from where it is
            this.runStarted = Date.now() - this.runPredicted * 1000;
        }

        this.animator.pause();
        this.animator.currentIndex = 0;
        this.animator.segmentProgress = 0;
        this.renderer2d.setMaxSegmentIndex(0, 0);
        this.renderer3d.setMaxSegmentIndex(0, 0);
        this.showRunUI();

        let last = performance.now();
        let shown = 0;
        const animate = (now) => {
            if (!this.following) return;
            const dt = Math.min(0.5, (now - last) / 1000);
            last = now;
            if (this.machineState === 'Run') this.runPredicted += dt;

            const predicted = this.findSegmentByElapsedTime(this.runPredicted);
            // Ease toward the prediction, never backward
            const target = Math.max(shown, predicted);
            shown = target - shown > 0.01 ? shown + (target - shown) * 0.15 : target;
            const index = Math.floor(shown);
            this.animator.currentIndex = index;
            this.animator.segmentProgress = shown % 1;
            if (this.animator.onUpdate) this.animator.onUpdate(index, shown % 1);
            this.updateRunUI(index);
            this.runAnimationId = requestAnimationFrame(animate);
        };
        this.runAnimationId = requestAnimationFrame(animate);
        this.runStateSaved = Date.now();
    }

    /**
     * A progress report: line the prediction up with where the machine really is.
     * FluidNC reports progress through the file as read, which for a parametric file is
     * the source (loops make it non-monotonic), so those rely on the prediction alone.
     */
    onRunProgress(percent) {
        if (!this.following || percent === null) return;
        this.runPercent = percent;
        if (!this.gcodeExpansion) {
            const index = this.findSegmentByBytePosition(percent / 100 * this.fileByteLength());
            if (index >= 0) {
                // The planner reads ahead of the moves, so the read position is a little ahead
                const actual = this.segmentExecutionTimes[Math.max(0, index - 1)] || 0;
                if (Math.abs(actual - this.runPredicted) > 2) this.runPredicted = actual;
            }
        }
        if (Date.now() - this.runStateSaved > 5000) {
            this.runStateSaved = Date.now();
            this.saveViewerState();
        }
    }

    stopFollowing() {
        if (!this.following) return;
        this.following = false;
        this.isRunning = false;
        this.machinePosition = null;
        if (this.runAnimationId) cancelAnimationFrame(this.runAnimationId);
        this.runAnimationId = null;
        this.runningFilePath = null;
        this.hideRunUI();
    }

    fileByteLength() {
        if (this.fileBytes === undefined || this.fileBytesText !== this.gcodeText) {
            this.fileBytesText = this.gcodeText;
            this.fileBytes = new TextEncoder().encode(this.gcodeText || '').length;
        }
        return this.fileBytes;
    }

    /**
     * The running job's strip and progress bar replace the transport bar
     */
    showRunUI() {
        if (this.ui) this.ui.classList.add('is-running');
        for (const id of ['run-strip', 'run-bar']) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        }
        ViewerUI.closePopover();
        this.updatePauseButton();
    }

    hideRunUI() {
        if (this.ui) this.ui.classList.remove('is-running');
        for (const id of ['run-strip', 'run-bar']) {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        }
        // The whole job again, as after loading
        if (this.segments.length > 0) this.animator.setCurrentLine(this.segments.length);
        this.clearViewerState();
    }

    /**
     * Running job: tool, last message, line, progress, elapsed and remaining time, and the
     * time to the next M0 (the machine waits there until it's resumed)
     */
    updateRunUI(index) {
        const n = this.segments.length;
        if (n === 0) return;
        const seg = this.segments[Math.min(index, n - 1)];
        const state = this.tools.get(seg.tool || 1);
        const toolEl = document.getElementById('run-tool');
        if (toolEl) {
            const number = state && state.number !== undefined ? state.number : (seg.tool || 1);
            const name = state ? this.shortToolName(state.name, number) : '';
            const held = this.machineState === 'Hold' || this.machineState === 'Door';
            toolEl.textContent = (held ? 'On hold · ' : '') + `T${number}${name ? ' ' + name : ''}`;
        }
        const sub = document.getElementById('run-sub');
        if (sub) {
            let message = '';
            for (const e of this.simEvents || []) {
                if (e.index > index) break;
                if (e.kind === 'msg' || e.kind === 'print') message = e.text;
            }
            // Line numbers as the G-code pane shows them (expanded or source)
            const line = this.toDisplayLine(seg.lineNum);
            const lines = this.gcodeLines ? this.gcodeLines.length : 0;
            sub.textContent = [message, line ? `line ${line} of ${lines}` : ''].filter(Boolean).join(' · ');
        }

        const total = this.animator.totalAnimTime || 0;
        const fraction = total > 0 ? Math.min(1, this.runPredicted / total) : index / n;
        // The machine's own report when there is one (bytes read), else the prediction
        const percent = this.runPercent > 0 && !this.gcodeExpansion ? this.runPercent : fraction * 100;
        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        const fill = document.getElementById('run-fill');
        if (fill) fill.style.width = Math.min(100, percent).toFixed(1) + '%';
        set('run-percent', Math.floor(percent) + '%');
        set('run-elapsed', this.formatClock((Date.now() - this.runStarted) / 1000));
        set('run-left', total > 0 ? `${this.formatClock(Math.max(0, total - this.runPredicted))} left` : '');

        const nextPause = (this.simPauses || []).find(p => p.index > index);
        let nextText = '';
        if (nextPause) {
            const at = this.segmentExecutionTimes[Math.max(0, nextPause.index - 1)] || 0;
            nextText = ` · next M0 in ${this.formatClock(Math.max(0, at - this.runPredicted))}`;
        }
        set('run-next-m0', nextText);
    }

    /**
     * The Files pane says when the machine is running another file, with a button to
     * preview and follow it
     */
    setRunningBanner(sdPath) {
        const banner = document.getElementById('running-banner');
        if (!banner) return;
        this.otherRunningPath = sdPath;
        banner.classList.toggle('hidden', !sdPath);
        const name = document.getElementById('running-name');
        if (name && sdPath) name.textContent = sdPath.split('/').pop();
    }

    async showRunningFile() {
        const path = this.otherRunningPath;
        if (!path) return;
        // Reading a file while a job runs from the card is fine: the job reads its own copy
        const name = path.split('/').pop();
        await this.loadSDFile({ path, name, type: 'file' });
        this.switchMobileTab('view');
    }

    /**
     * Find segment index based on byte position in file
     */
    findSegmentByBytePosition(bytePosition) {
        if (!this.segments || this.segments.length === 0) return -1;

        // If we don't have byte positions cached, calculate them
        if (!this.segmentBytePositions) {
            this.calculateSegmentBytePositions();
        }

        // Binary search to find the segment
        let left = 0;
        let right = this.segmentBytePositions.length - 1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (this.segmentBytePositions[mid] <= bytePosition) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        return Math.min(right, this.segments.length - 1);
    }

    /**
     * Calculate cumulative byte positions for each segment
     */
    calculateSegmentBytePositions() {
        if (!this.gcodeText || !this.segments) return;

        const lines = this.gcodeText.split('\n');
        this.segmentBytePositions = [];
        const encoder = new TextEncoder();

        // Pre-calculate byte length of each line (including newline)
        const lineByteLengths = [];
        let cumulativeBytes = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineBytes = encoder.encode(lines[i] + '\n').length;
            cumulativeBytes += lineBytes;
            lineByteLengths.push(cumulativeBytes);
        }

        // Map segment line numbers to byte positions
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const lineNum = seg.lineNum || 0;

            if (lineNum > 0 && lineNum <= lineByteLengths.length) {
                this.segmentBytePositions.push(lineByteLengths[lineNum - 1]);
            } else {
                this.segmentBytePositions.push(cumulativeBytes);
            }
        }
    }

    /**
     * When each move ends, in seconds from the start of the job: the animator's timeline,
     * which allows for acceleration and the machine's rapid rates
     */
    calculateSegmentExecutionTimes() {
        this.segmentExecutionTimes = this.animator.segmentEndTimes
            ? Array.from(this.animator.segmentEndTimes) : [];
    }

    /**
     * Find segment index based on elapsed time using predictive estimation
     */
    findSegmentByElapsedTime(elapsedSeconds) {
        const times = this.segmentExecutionTimes;
        if (!this.segments || this.segments.length === 0 || !times || times.length === 0) return 0;

        // The first move that ends after this time
        let left = 0;
        let right = times.length - 1;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (times[mid] <= elapsedSeconds) left = mid + 1;
            else right = mid;
        }
        const start = left > 0 ? times[left - 1] : 0;
        const span = times[left] - start;
        const within = span > 0 ? Math.min(1, Math.max(0, (elapsedSeconds - start) / span)) : 1;
        return Math.min(this.segments.length, left + within);
    }

    /**
     * Override setupAnimator to add periodic state saving
     */
    setupAnimator() {
        super.setupAnimator();

        // Save original onUpdate callback
        const originalOnUpdate = this.animator.onUpdate;
        let lastSaveIndex = 0;

        // Wrap onUpdate to save state periodically (every 100 segments)
        this.animator.onUpdate = (index, segmentProgress = 1) => {
            // Call original update
            originalOnUpdate.call(this, index, segmentProgress);

            // Save state every 100 segments to avoid excessive writes
            if (this.currentFilePath && Math.abs(index - lastSaveIndex) >= 100) {
                lastSaveIndex = index;
                this.saveViewerState();
            }
        };
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        return this.formatBytes(bytes || 0);
    }

    /**
     * IndexedDB helper - Open or create database
     */
    openDB() {
        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open('FluidNCViewer', 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('files')) {
                        db.createObjectStore('files', { keyPath: 'path' });
                    }
                };
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e); // IndexedDB unavailable (a sandboxed iframe)
            }
        });
    }

    /**
     * Cache file content to IndexedDB
     */
    async cacheFile(filePath, fileContent) {
        try {
            const db = await this.openDB();
            const tx = db.transaction('files', 'readwrite');
            tx.objectStore('files').put({
                path: filePath,
                content: fileContent,
                timestamp: Date.now()
            });
        } catch (error) {
            console.warn('Failed to cache file:', error);
        }
    }

    /**
     * Get cached file from IndexedDB
     */
    async getCachedFile(filePath) {
        try {
            const db = await this.openDB();
            return await new Promise((resolve, reject) => {
                const request = db.transaction('files', 'readonly').objectStore('files').get(filePath);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Failed to get cached file:', error);
            return null;
        }
    }

    /**
     * Remember the previewed file and the view (the file itself is cached in IndexedDB),
     * so reopening the WebUI comes back to it
     */
    saveViewerState() {
        if (!this.currentFilePath) return;
        Prefs.setJSON('fluidnc-viewer-state', {
            filePath: this.currentFilePath,
            animationIndex: this.animator.currentIndex,
            toolStates: Array.from(this.tools.entries()),
            currentView: this.currentView,
            rapidMovesVisible: this.rapidMovesVisible,
            rapidMoveColor: this.rapidMoveColor,
            timestamp: Date.now()
        });
    }

    /**
     * Restore viewer state from cache
     */
    async restoreViewerState() {
        try {
            const state = Prefs.getJSON('fluidnc-viewer-state');
            if (!state) return;
            const ageHours = (Date.now() - state.timestamp) / 3600000;

            // Clear if older than 24 hours
            if (ageHours > 24) {
                this.clearViewerState();
                return;
            }

            // Try to load from IndexedDB cache
            const cached = await this.getCachedFile(state.filePath);
            if (!cached || !cached.content) {
                this.clearViewerState();
                return;
            }

            const progressBar = document.getElementById('progress-bar');
            const progressFill = document.getElementById('progress-fill');
            if (progressBar) progressBar.classList.remove('hidden');
            if (progressFill) progressFill.style.width = '0%';

            // Parse the cached file
            const filename = state.filePath.split('/').pop();
            this.loadingFilePath = state.filePath;
            await this.processGCode(cached.content, filename);

            // Restore viewer settings
            this.currentFilePath = state.filePath;
            this.rapidMovesVisible = state.rapidMovesVisible !== undefined ? state.rapidMovesVisible : true;
            this.rapidMoveColor = state.rapidMoveColor || '#999999';

            // Restore tool states
            if (state.toolStates && Array.isArray(state.toolStates)) {
                state.toolStates.forEach(([toolNum, toolState]) => {
                    if (this.tools.has(toolNum)) {
                        this.tools.set(toolNum, toolState);
                    }
                });
            }

            this.updateToolPanel();
            this.updateRenderers();
            if (state.currentView) this.setView(state.currentView);
            if (!this.following) this.animator.setCurrentLine(state.animationIndex || 0);
            this.render();

            if (progressFill) progressFill.style.width = '100%';
            setTimeout(() => {
                if (progressBar) progressBar.classList.add('hidden');
            }, 500);
        } catch (error) {
            console.error('Failed to restore viewer state:', error);
            this.clearViewerState();
        }
    }

    /**
     * Clear viewer state (called when job completes or file is closed)
     */
    clearViewerState() {
        Prefs.remove('fluidnc-viewer-state');
    }
}

// The WebUI extension: talks to FluidNC through the WebUI (FigUI makes its own)
window.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.host === 'fluidnc') {
        new FluidNCController(new FluidNCAPI());
    }
});
