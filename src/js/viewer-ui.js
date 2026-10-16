/**
 * Viewer layout, shared by the standalone viewer, the FluidNC WebUI extension, the
 * VS Code viewer and the FigUI plugin.
 *
 * mount() builds the page into <div id="viewer-root"> before the Controller starts. It
 * keeps the element ids the Controller already uses (canvas2d, btn-play, line-slider,
 * tool-list, grid-width, ...) and handles the parts that are only layout: the phone tab
 * bar, the popovers (file, view and playback settings), collapsible sidebar sections,
 * the G-code column and whole-window file drops.
 *
 * Desktop: header, G-code column | view with transport bar | sidebar.
 * Phone (820 px and narrower): one pane at a time, chosen with the bottom tab bar
 * (Files, View, Job, G-code). The file pane is a popover on desktop and a tab on a phone.
 */

const VIEWER_HOSTS = {
    // files: 'local' = file picker, recent files and config.yaml; 'sd' = SD card browser
    standalone: { brand: 'CNC GCode Viewer', files: 'local', github: true, run: false, codeHidden: false },
    fluidnc: { brand: 'GCode Viewer', files: 'sd', github: false, run: true, codeHidden: false },
    vscode: { brand: null, files: null, github: false, run: false, codeHidden: true },
    figui: { brand: null, files: 'sd', github: false, run: false, follow: true, openInHost: true, codeHidden: true }
};

const VIEWER_ICONS = {
    file: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    logo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V3l18 18z"/><path d="M7 17v-5l5 5z"/></svg>',
    sun: '<svg class="vw-icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg class="vw-icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    start: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5v14"/><path d="M19 5L9 12l10 7z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    play: '<svg class="vw-icon-play" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
    pause: '<svg class="vw-icon-pause" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    chevron: '<svg class="vw-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    code: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    tabFiles: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    tabView: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
    tabJob: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
    tabCode: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/></svg>'
};

const ViewerUI = {
    host: null,
    config: null,
    root: null,
    openPopover: null,
    phoneQuery: null,

    /**
     * Build the layout for a host into #viewer-root (no-op without it).
     * @param {string} host - 'standalone' | 'fluidnc' | 'vscode' | 'figui'
     * @param {object} [options] - { title, fileName, version }
     */
    mount(host, options = {}) {
        const target = document.getElementById('viewer-root');
        if (!target || this.root) return this.root;
        this.host = host;
        this.config = VIEWER_HOSTS[host] || VIEWER_HOSTS.standalone;
        target.outerHTML = this.markup(this.config, options);
        this.root = document.getElementById('vw');
        document.body.classList.add('vw-body');
        this.phoneQuery = window.matchMedia('(max-width: 820px)');
        this.bind();
        return this.root;
    },

    isPhone() {
        return !!(this.phoneQuery && this.phoneQuery.matches);
    },

    markup(cfg, options) {
        const i = VIEWER_ICONS;
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const version = options.version ? esc(options.version) : '';
        const tabs = [
            cfg.files ? ['files', 'Files', i.tabFiles] : null,
            ['view', 'View', i.tabView],
            ['job', 'Job', i.tabJob],
            ['code', 'G-code', i.tabCode]
        ].filter(Boolean);

        const filesPane = cfg.files === 'local' ? `
            <div class="vw-pane-title">File</div>
            <div class="vw-drop-zone" id="upload-zone" role="button" tabindex="0" aria-label="Choose a G-code file">
                <span>Drop a G-code file anywhere</span>
                <span class="vw-muted">or</span>
                <span class="vw-btn vw-primary">Choose file…</span>
                <input type="file" id="file-input" accept=".nc,.gcode,.ngc,.gco,.tap,.txt" hidden>
            </div>
            <div class="vw-label">Recent</div>
            <ul class="vw-recent" id="recent-list"><li class="vw-muted">Files you open appear here.</li></ul>
            <div class="vw-divider"></div>
            <div class="vw-config-row machine-config">
                <span class="vw-config-label">Machine config</span>
                <span id="machine-config-status" class="vw-muted">none</span>
                <button type="button" id="btn-clear-config" class="vw-btn vw-small hidden" aria-label="Stop using this config">✕</button>
                <button type="button" id="btn-load-config" class="vw-btn vw-small">Load config.yaml</button>
                <input type="file" id="config-input" accept=".yaml,.yml" hidden>
            </div>
            <div class="vw-help">Gives #&lt;/…&gt; values for parametric files and the bed size for the grid.</div>`
            : cfg.files === 'sd' ? `
            <div class="vw-sd-head">
                <div class="breadcrumb" id="breadcrumb"><span class="breadcrumb-item" data-path="/">SD card</span></div>
                <button type="button" id="btn-sd-refresh" class="vw-icon-btn" aria-label="Refresh the file list">${i.refresh}</button>
            </div>
            <div class="vw-running-banner hidden" id="running-banner">
                <span>Running: <b id="running-name"></b></span>
                <button type="button" id="btn-follow-running" class="vw-btn vw-small vw-primary">Show it</button>
            </div>
            <div class="file-browser" id="file-browser"><div class="vw-empty-note">Loading files…</div></div>
            <div class="vw-sd-actions">
                <div class="vw-sd-selected"><span id="sd-selected-name">No file selected</span><span id="sd-selected-meta" class="vw-muted"></span></div>
                <div class="vw-sd-buttons">
                    <button type="button" id="btn-load-file" class="vw-btn" disabled>Preview</button>
                    ${cfg.openInHost ? '<button type="button" id="btn-open-host" class="vw-btn vw-primary" disabled>Open in FigUI</button>'
                        : '<button type="button" id="btn-run-file" class="vw-btn vw-primary" disabled>Run on machine</button>'}
                </div>
            </div>` : '';

        const emptyAction = cfg.files === 'local' ? '<button type="button" class="vw-btn vw-primary" data-action="choose-file">Choose file…</button>'
            : cfg.files === 'sd' ? '<button type="button" class="vw-btn vw-primary" data-action="open-files">Browse the SD card</button>' : '';

        return `
<div class="vw" id="vw" data-host="${esc(this.host)}" data-tab="${cfg.files ? 'files' : 'view'}">
    <div class="vw-header">
        ${cfg.brand ? `<div class="vw-brand">${i.logo}<span>${esc(cfg.brand)}</span></div>` : ''}
        <button type="button" class="vw-file" id="btn-files" ${cfg.files ? 'aria-haspopup="dialog" aria-expanded="false"' : 'disabled'} aria-label="${cfg.files ? 'Files' : 'File'}">
            ${i.file}
            <span class="vw-file-text">
                <span class="vw-file-name" id="file-name">${esc(options.fileName || 'No file loaded')}</span>
                <span class="vw-file-meta" id="file-meta"></span>
            </span>
        </button>
        ${cfg.files === 'local' ? '<button type="button" class="vw-btn vw-hide-phone" id="btn-open">Open…</button>' : ''}
        ${cfg.files === 'local' ? '<button type="button" class="vw-btn vw-chip vw-hide-phone" id="btn-config-chip">config.yaml: none</button>' : ''}
        <div class="vw-spacer"></div>
        <button type="button" class="vw-icon-btn vw-hide-phone" id="btn-theme" aria-label="Switch theme">${i.sun}${i.moon}</button>
        ${cfg.github ? '<a class="vw-link vw-hide-phone" href="https://github.com/jeyeager65/cnc-gcode-tools" target="_blank" rel="noopener">GitHub</a>' : ''}
        <div class="vw-progress progress-bar hidden" id="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
    </div>

    <div class="vw-body">
        ${cfg.files ? `<section class="vw-pane vw-files" id="files-pane" data-pane="files" aria-label="Files">${filesPane}</section>` : ''}

        <section class="vw-pane vw-code" data-pane="code" aria-label="G-code">
            <div id="gcode-panel">
                <h3 class="vw-code-head">G-code <span id="gcode-line-indicator" class="vw-muted"></span></h3>
                <button type="button" class="vw-icon-btn vw-code-hide vw-hide-phone" id="btn-hide-code" aria-label="Hide G-code">${i.collapse}</button>
                <div id="gcode-container"></div>
            </div>
            <div id="gcode-welcome" class="vw-empty-note">The program appears here once a file is loaded. Click a line to jump to it.</div>
        </section>

        <main class="vw-pane vw-main" data-pane="view">
            ${cfg.run || cfg.follow ? `
            <div class="vw-run-strip hidden" id="run-strip">
                <div class="vw-run-info"><span id="run-tool">Running</span><span id="run-sub" class="vw-run-sub"></span></div>
            </div>` : ''}
            <div class="vw-canvas canvas-container" id="canvas-container">
                <canvas id="canvas2d" class="hidden"></canvas>
                <canvas id="canvas3d"></canvas>
                <canvas id="canvas3d-overlay"></canvas>
                <div class="vw-coords" id="coordinates"></div>
                <div class="vw-toolbar">
                    <button type="button" class="vw-tool-btn vw-hide-phone hidden" id="btn-show-code" aria-label="Show G-code">${i.code}<span>G-code</span></button>
                    <div class="vw-seg" role="group" aria-label="View">
                        <button type="button" id="view-2d" aria-pressed="false">2D</button>
                        <button type="button" id="view-3d" aria-pressed="true">3D</button>
                    </div>
                    <button type="button" class="vw-tool-btn" id="btn-reset-view" disabled>Fit</button>
                    <button type="button" class="vw-tool-btn vw-square" id="btn-view-settings" data-pop="pop-view" aria-haspopup="dialog" aria-expanded="false" aria-label="View settings">${i.sliders}</button>
                </div>
                <div class="vw-zoom" role="group" aria-label="Zoom">
                    <button type="button" id="btn-zoom-in" aria-label="Zoom in">+</button>
                    <button type="button" id="btn-zoom-out" aria-label="Zoom out">−</button>
                </div>
                <div class="vw-empty" id="vw-empty">
                    <div class="vw-empty-title">${cfg.files ? 'Open a G-code file to preview it' : 'Loading…'}</div>
                    ${emptyAction}
                </div>
            </div>

            <div class="vw-transport" id="animation-panel" style="display: none;">
                <div class="vw-tp-buttons">
                    <button type="button" class="vw-round" id="btn-reset" aria-label="Back to start">${i.start}</button>
                    <button type="button" class="vw-round" id="btn-prev" aria-label="Step back">${i.prev}</button>
                    <button type="button" class="vw-play" id="btn-play" aria-label="Play">${i.play}${i.pause}</button>
                    <button type="button" class="vw-round" id="btn-next" aria-label="Step forward">${i.next}</button>
                </div>
                <div class="vw-tp-scrub">
                    <div class="vw-scrub">
                        <div class="vw-scrub-marks" id="scrub-marks"></div>
                        <input type="range" id="line-slider" min="0" max="0" step="1" value="0" aria-label="Position in the job">
                    </div>
                    <div class="vw-tp-read">
                        <span id="tp-time">0:00 / 0:00</span>
                        <span>seg <span id="current-line">0</span> / <span id="total-lines">0</span></span>
                        <span>line <span id="current-file-line">-</span></span>
                    </div>
                </div>
                <label class="vw-tp-speed"><span class="vw-hide-phone">Speed</span>
                    <select id="speed-select" aria-label="Playback speed">
                        <option value="0.1">0.1x</option><option value="0.25">0.25x</option><option value="0.5">0.5x</option>
                        <option value="1" selected>1x</option><option value="2">2x</option><option value="5">5x</option>
                        <option value="10">10x</option><option value="20">20x</option><option value="50">50x</option>
                        <option value="100">100x</option><option value="200">200x</option><option value="500">500x</option>
                    </select>
                </label>
                <button type="button" class="vw-round vw-square" id="btn-playback-settings" data-pop="pop-playback" aria-haspopup="dialog" aria-expanded="false" aria-label="Playback settings">${i.gear}</button>
            </div>

            ${cfg.run || cfg.follow ? `
            <div class="vw-runbar hidden" id="run-bar">
                <div class="vw-run-track"><div class="vw-run-fill" id="run-fill"></div><div class="vw-scrub-marks" id="run-marks"></div></div>
                <div class="vw-run-times">
                    <span><b id="run-percent">0%</b> <span class="vw-muted">· <span id="run-elapsed">0:00</span> elapsed</span></span>
                    <span class="vw-muted"><span id="run-left"></span><span id="run-next-m0"></span></span>
                </div>
                ${cfg.run ? `<button type="button" class="vw-hold" id="btn-pause-resume">${i.pause}<span>Pause (feed hold)</span></button>` : ''}
            </div>` : ''}
        </main>

        <aside class="vw-pane vw-side" data-pane="job" aria-label="Job">
            <div class="vw-summary" id="summary">
                <div class="vw-sum-main"><span class="vw-sum-time" id="sum-time">–</span><span class="vw-muted" id="sum-meta">No file loaded</span></div>
                <div class="vw-sum-ranges" id="sum-ranges"></div>
                ${this.host === 'vscode' ? '' : `<div class="vw-sum-actions" id="sum-actions" hidden>
                    <button type="button" class="vw-btn vw-small" id="btn-download-expanded"
                        title="The parametric file as plain G-code, as drawn here (with the machine values used for this preview), for senders that can't expand it">${
                        cfg.openInHost ? 'Save expanded copy to the SD card' : 'Download expanded G-code'}</button>
                </div>`}
            </div>
            <section class="vw-section" id="tool-panel" data-section="toolpaths" style="display: none;">
                <button type="button" class="vw-section-head" aria-expanded="true">${i.chevron}<span>Toolpaths</span></button>
                <div class="vw-section-body">
                    <div id="tool-list" class="vw-tool-list"></div>
                    <div class="vw-layers">
                        <div class="vw-layers-head"><span>Z layers</span><span class="vw-mono"><span id="layer-min-value">-</span> … <span id="layer-max-value">-</span></span></div>
                        <div class="dual-range-slider">
                            <div class="range-highlight" id="layer-range-highlight"></div>
                            <input type="range" id="layer-slider-min" class="range-min" step="0.1" aria-label="Lowest Z shown">
                            <input type="range" id="layer-slider-max" class="range-max" step="0.1" aria-label="Highest Z shown">
                        </div>
                    </div>
                </div>
            </section>
            <div id="stock-mount"></div>
            <section class="vw-section collapsed" id="warn-section" data-section="warnings" style="display: none;">
                <button type="button" class="vw-section-head" aria-expanded="false">${i.chevron}<span>Warnings</span><span class="vw-badge" id="warn-count">0</span></button>
                <div class="vw-section-body"><ul class="vw-warn-list" id="warn-list"></ul></div>
            </section>
            <div class="vw-side-foot"><span>Processed locally, nothing is sent</span><span>${version}</span></div>
        </aside>
    </div>

    <nav class="vw-tabs" aria-label="Viewer">
        ${tabs.map(([tab, label, icon]) => `<button type="button" class="vw-tab" data-tab="${tab}">${icon}<span>${label}</span></button>`).join('')}
    </nav>

    <div class="vw-pop" id="pop-view" role="dialog" aria-label="View settings" hidden>
        <div class="vw-pop-title">View</div>
        <label class="vw-check"><input type="checkbox" id="grid-enabled" checked> Show grid (machine bed)</label>
        <div class="vw-grid2">
            <label class="vw-field">Width X<input type="number" id="grid-width" step="10" value="1200" min="0"></label>
            <label class="vw-field">Depth Y<input type="number" id="grid-height" step="10" value="2400" min="0"></label>
        </div>
        <div class="vw-help" id="grid-source">Sized from the stock until a machine size is known.</div>
        <div class="vw-divider"></div>
        <label class="vw-check"><input type="checkbox" id="show-axes" checked> Show axes and origin</label>
        <label class="vw-check"><input type="checkbox" id="show-tool" checked> Show tool at current position</label>
        <div class="vw-row"><span>Zoom</span><span class="vw-mono" id="zoom-value">100%</span><button type="button" class="vw-btn vw-small" id="btn-fit-pop">Fit</button></div>
        <div class="vw-row"><span>Theme</span>
            <div class="vw-seg vw-seg-small" role="group" aria-label="Theme">
                <button type="button" id="theme-light">Light</button><button type="button" id="theme-dark">Dark</button>
            </div>
        </div>
    </div>

    <div class="vw-pop" id="pop-playback" role="dialog" aria-label="Playback settings" hidden>
        <div class="vw-pop-title">Playback</div>
        <div id="playback-options" class="vw-playback-options"></div>
        <div class="vw-help" id="playback-none">This file has no messages, M0 pauses or probes.</div>
        <div class="vw-divider vw-keys-divider"></div>
        <div class="vw-label vw-keys-label">Keyboard</div>
        <div class="vw-keys">
            <span><kbd>Space</kbd> play / pause</span><span><kbd>← →</kbd> step</span>
            <span><kbd>Home</kbd> start</span><span><kbd>End</kbd> end</span>
            <span><kbd>[ ]</kbd> speed</span><span><kbd>V</kbd> 2D / 3D</span>
        </div>
    </div>

    <div class="vw-backdrop" id="vw-backdrop" hidden></div>
    ${cfg.files === 'local' ? '<div class="vw-drop" id="vw-drop" hidden><div>Drop the file to open it</div></div>' : ''}
</div>`;
    },

    bind() {
        const root = this.root;

        // Tabs (phone)
        root.querySelectorAll('.vw-tab').forEach(button => {
            button.addEventListener('click', () => this.setTab(button.dataset.tab));
        });
        this.setTab(root.dataset.tab);

        // Popovers
        root.querySelectorAll('[data-pop]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePopover(button.dataset.pop, button);
            });
        });
        const files = document.getElementById('btn-files');
        if (files && this.config.files) {
            files.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isPhone()) this.setTab('files');
                else this.togglePopover('files-pane', files);
            });
        }
        root.querySelectorAll('[data-action="open-files"]').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isPhone()) this.setTab('files');
                else this.togglePopover('files-pane', files);
            });
        });
        root.querySelectorAll('[data-action="choose-file"]').forEach(button => {
            button.addEventListener('click', () => {
                const input = document.getElementById('file-input');
                if (input) input.click();
            });
        });
        const open = document.getElementById('btn-open');
        if (open) open.addEventListener('click', () => document.getElementById('file-input').click());

        document.addEventListener('click', (e) => {
            if (!this.openPopover) return;
            const pop = document.getElementById(this.openPopover);
            if (pop && !pop.contains(e.target)) this.closePopover();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.openPopover) this.closePopover();
        });
        document.getElementById('vw-backdrop').addEventListener('click', () => this.closePopover());
        this.phoneQuery.addEventListener('change', () => {
            this.closePopover();
            this.applyCodeVisibility();
            // Desktop shows every pane; a phone shows the current tab (View if it was Files)
            this.setTab(root.dataset.tab);
        });
        window.addEventListener('resize', () => {
            if (this.openPopover && !this.isPhone()) this.positionPopover();
        });

        // Collapsible sections, remembered per section
        root.addEventListener('click', (e) => {
            const head = e.target.closest('.vw-section-head');
            if (!head || e.target.closest('input, select, a, label')) return;
            const section = head.closest('.vw-section');
            this.setSectionOpen(section, section.classList.contains('collapsed'));
        });
        this.restoreSections();

        // G-code column
        document.getElementById('btn-hide-code').addEventListener('click', () => this.setCodeHidden(true));
        document.getElementById('btn-show-code').addEventListener('click', () => this.setCodeHidden(false));
        this.applyCodeVisibility();

        // Theme button: shows the theme it switches to
        const theme = document.getElementById('btn-theme');
        if (theme) {
            theme.addEventListener('click', () => {
                const dark = document.documentElement.getAttribute('data-theme') === 'dark';
                document.getElementById(dark ? 'theme-light' : 'theme-dark').click();
            });
        }

        // Whole-window file drop (standalone)
        const drop = document.getElementById('vw-drop');
        if (drop) {
            let depth = 0;
            const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
            window.addEventListener('dragenter', (e) => {
                if (!hasFiles(e)) return;
                depth++;
                drop.hidden = false;
            });
            window.addEventListener('dragleave', () => {
                depth = Math.max(0, depth - 1);
                if (depth === 0) drop.hidden = true;
            });
            window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
            window.addEventListener('drop', (e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth = 0;
                drop.hidden = true;
                if (e.dataTransfer.files.length > 0 && this.onFileDrop) this.onFileDrop(e.dataTransfer.files[0]);
            });
        }
    },

    /**
     * Phone pane: 'files' | 'view' | 'job' | 'code'. On a desktop every pane is shown and
     * this only remembers the tab for when the window gets narrow.
     */
    setTab(tab) {
        const root = this.root;
        if (!root.querySelector(`.vw-tab[data-tab="${tab}"]`)) tab = 'view';
        if (!this.isPhone() && tab === 'files') tab = 'view';
        root.dataset.tab = tab;
        root.querySelectorAll('.vw-tab').forEach(button => {
            const on = button.dataset.tab === tab;
            button.classList.toggle('active', on);
            if (on) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        this.closePopover();
        if (this.onTabChange) this.onTabChange(tab);
    },

    togglePopover(id, anchor) {
        if (this.openPopover === id) {
            this.closePopover();
            return;
        }
        this.closePopover();
        const pop = document.getElementById(id);
        if (!pop) return;
        this.openPopover = id;
        this.popoverAnchor = anchor;
        pop.hidden = false;
        pop.classList.add('vw-open');
        if (anchor) anchor.setAttribute('aria-expanded', 'true');
        document.getElementById('vw-backdrop').hidden = !this.isPhone();
        this.positionPopover();
    },

    closePopover() {
        if (!this.openPopover) return;
        const pop = document.getElementById(this.openPopover);
        if (pop) {
            pop.classList.remove('vw-open');
            // The file pane is also the Files tab: it stays in the page, just not as a popover
            if (pop.classList.contains('vw-pop')) pop.hidden = true;
            pop.style.left = pop.style.top = pop.style.right = '';
        }
        if (this.popoverAnchor) this.popoverAnchor.setAttribute('aria-expanded', 'false');
        this.openPopover = null;
        this.popoverAnchor = null;
        document.getElementById('vw-backdrop').hidden = true;
    },

    /**
     * Desktop: below (or above, near the bottom) the button that opened it, kept on screen.
     * Phone: CSS makes it a bottom sheet.
     */
    positionPopover() {
        const pop = this.openPopover && document.getElementById(this.openPopover);
        if (!pop || this.isPhone()) return;
        const anchor = this.popoverAnchor;
        if (!anchor) return;
        const a = anchor.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        let left = Math.min(Math.max(8, a.right - w), vw - w - 8);
        if (pop.id === 'files-pane') left = Math.min(Math.max(8, a.left), vw - w - 8);
        let top = a.bottom + 6;
        if (top + h > vh - 8) top = Math.max(8, a.top - h - 6);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
    },

    setSectionOpen(section, open) {
        section.classList.toggle('collapsed', !open);
        const head = section.querySelector('.vw-section-head');
        if (head) head.setAttribute('aria-expanded', String(open));
        if (section.dataset.section) Prefs.set('vwSection.' + section.dataset.section, open);
    },

    restoreSections() {
        this.root.querySelectorAll('.vw-section[data-section]').forEach(section => this.restoreSection(section));
    },

    restoreSection(section) {
        const saved = Prefs.getBool('vwSection.' + section.dataset.section, null);
        if (saved !== null) this.setSectionOpen(section, saved);
    },

    /**
     * The G-code column: hidden by the user, or by default on narrower desktops and in
     * hosts that show the code elsewhere (VS Code, FigUI)
     */
    codeHidden() {
        const saved = Prefs.getBool('vwCodeHidden.' + this.host, null);
        if (saved !== null) return saved;
        return this.config.codeHidden || window.innerWidth < 1180;
    },

    setCodeHidden(hidden) {
        Prefs.set('vwCodeHidden.' + this.host, hidden);
        this.applyCodeVisibility();
    },

    applyCodeVisibility() {
        const hidden = this.codeHidden();
        this.root.classList.toggle('vw-code-hidden', hidden);
        document.getElementById('btn-show-code').classList.toggle('hidden', !hidden);
    }
};

// Build the layout as soon as this script runs (it comes before controller.js), for
// pages that ask for it with <body data-host="..."> and a #viewer-root placeholder
(function autoMount() {
    const host = document.body && document.body.dataset.host;
    if (host && document.getElementById('viewer-root')) {
        ViewerUI.mount(host, { version: document.body.dataset.version || '', fileName: document.body.dataset.fileName || '' });
    }
})();
