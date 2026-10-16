// extension.js — CNC GCode Tools for FluidNC (VS Code extension)
'use strict';

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');

// ---------------------------------------------------------------------------
// Expander (shared with the web tools: src/js/gcode-expander.js)
// ---------------------------------------------------------------------------

// install-vscode-extension.ps1 copies it into viewer/; fall back to the repo copy when
// running the extension straight from the repo (Extension Development Host).
function _loadExpander() {
    for (const rel of ['viewer/gcode-expander.js', '../src/js/gcode-expander.js']) {
        const p = path.join(__dirname, rel);
        if (fs.existsSync(p)) return require(p);
    }
    throw new Error('gcode-expander.js not found - run install-vscode-extension.ps1');
}

const { expandLines, isParametricGCode, parseFluidNCConfig } = _loadExpander();

// ---------------------------------------------------------------------------
// FluidNC config.yaml (machine values for parametric files)
// ---------------------------------------------------------------------------

/**
 * Read the FluidNC config.yaml for a G-code document: the cncGcode.fluidncConfig
 * setting if set, otherwise a config.yaml next to the file or at the root of its
 * workspace folder. Returns parseFluidNCConfig()'s result, or null if there is none.
 */
function loadMachineConfig(doc) {
    const setting = vscode.workspace.getConfiguration('cncGcode', doc.uri).get('fluidncConfig', '').trim();
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const folderPath = folder ? folder.uri.fsPath : null;
    const fileDir = doc.uri.scheme === 'file' ? path.dirname(doc.uri.fsPath) : null;

    const candidates = [];
    if (setting) {
        const expanded = setting.replace(/\$\{workspaceFolder\}/g, folderPath || '');
        const base = folderPath || fileDir;
        candidates.push(path.isAbsolute(expanded) || !base ? expanded : path.join(base, expanded));
    } else {
        if (fileDir) candidates.push(path.join(fileDir, 'config.yaml'));
        if (folderPath) candidates.push(path.join(folderPath, 'config.yaml'));
    }

    for (const p of candidates) {
        if (!fs.existsSync(p)) continue;
        try {
            return parseFluidNCConfig(fs.readFileSync(p, 'utf8'), path.basename(p));
        } catch (e) {
            vscode.window.showWarningMessage(`Could not read FluidNC config ${p}: ${e.message}`);
            return null;
        }
    }
    if (setting) {
        vscode.window.showWarningMessage(`FluidNC config not found: ${candidates[0]} (from the cncGcode.fluidncConfig setting)`);
    }
    return null;
}

// ---------------------------------------------------------------------------
// GCode Validator
// ---------------------------------------------------------------------------

// FluidNC supported G-codes (numeric values, e.g. 38.2, 43.1)
const FLUIDNC_GCODES = new Set([
    0, 1, 2, 3, 4, 10,
    17, 18, 19, 20, 21,
    28, 28.1, 30, 30.1,
    38.2, 38.3, 38.4, 38.5, 38.6, 38.7, 38.8, 38.9,
    40, 43.1, 49,
    53, 54, 55, 56, 57, 58, 59,
    90, 91, 92, 92.1, 93, 94
]);

// FluidNC supported M-codes
const FLUIDNC_MCODES = new Set([
    0, 2, 30,
    3, 4, 5, 6,
    7, 8, 9,
    61, 62, 63, 64, 65, 66, 67
]);

// FluidNC does NOT support LinuxCNC subroutine keywords
const UNSUPPORTED_FLOW = new Set(['sub', 'endsub', 'call', 'return']);

function validateGCode(source, filename, machineValues) {
    const lines = source.split('\n');
    const issues = []; // { line (0-based), col, severity: 'error'|'warning'|'info', message }

    const isParametric = isParametricGCode(source);

    // ---- Static checks on every line ----
    lines.forEach((raw, i) => {
        const line = raw.replace(/\r$/, '');

        // Strip inline paren comment for code analysis
        const semiIdx  = line.indexOf(';');
        const openIdx  = line.indexOf('(');
        const closeIdx = line.lastIndexOf(')');
        const codeSection = semiIdx >= 0 ? line.slice(0, semiIdx)
                          : (openIdx >= 0 && closeIdx > openIdx) ? line.slice(0, openIdx) + line.slice(closeIdx + 1)
                          : line;

        // Unmatched parentheses (skip parametric — [ ] are used heavily)
        if (!isParametric) {
            const opens  = (line.match(/\(/g) || []).length;
            const closes = (line.match(/\)/g) || []).length;
            if (opens !== closes) {
                issues.push({ line: i, col: 0, severity: 'warning',
                    message: 'Unmatched parentheses on this line' });
            }
        }

        // G2/G3 arc must have I, J, K, or R (or [ for parametric expressions)
        if (/\bG[23]\b/i.test(codeSection)) {
            const arcParams = /[IJKR\[]/i.test(codeSection);
            if (!arcParams) {
                issues.push({ line: i, col: 0, severity: 'error',
                    message: 'G2/G3 arc command is missing required I, J, K, or R parameter' });
            }
        }

        // Bare unresolved expression left in output (shouldn't happen in expanded files)
        if (!isParametric && /\[/.test(codeSection)) {
            issues.push({ line: i, col: line.indexOf('['), severity: 'warning',
                message: 'Unexpected [ expression — file may be parametric and need expanding' });
        }

        // Unsupported G-codes
        for (const gm of [...codeSection.matchAll(/\bG(\d+(?:\.\d+)?)\b/gi)]) {
            const n = parseFloat(gm[1]);
            if (!FLUIDNC_GCODES.has(n)) {
                issues.push({ line: i, col: 0, severity: 'warning',
                    message: `G${gm[1]} is not listed as supported by FluidNC` });
            }
        }

        // Unsupported M-codes
        for (const mm of [...codeSection.matchAll(/\bM(\d+(?:\.\d+)?)\b/gi)]) {
            const n = parseFloat(mm[1]);
            if (!FLUIDNC_MCODES.has(n)) {
                issues.push({ line: i, col: 0, severity: 'warning',
                    message: `M${mm[1]} is not listed as supported by FluidNC` });
            }
        }

        // Unsupported axis words: U, V, W (FluidNC only supports X Y Z A B C)
        for (const am of [...codeSection.matchAll(/\b([UVW])([+\-]?[\d.])/gi)]) {
            issues.push({ line: i, col: 0, severity: 'warning',
                message: `Axis '${am[1].toUpperCase()}' is not supported by FluidNC (supported axes: X Y Z A B C)` });
        }
    });

    // ---- Parametric-specific checks ----
    // The expander reports block structure (unclosed or mismatched O-word blocks,
    // unsupported subroutines) as well as expression and variable errors
    if (isParametric) {
        try {
            const result = expandLines(lines, filename, { machineValues });
            result.warnings.forEach(w => {
                // Expander warnings look like "Line 5: message"
                const m = w.match(/^Line (\d+): (.*)$/i);
                const lineIdx = m ? parseInt(m[1]) - 1 : 0;
                const message = m ? m[2] : w;
                // Machine state and config values only exist on the controller, so they
                // aren't errors in the file
                const severity = /not known offline/.test(message) ? 'info' : 'error';
                issues.push({ line: lineIdx, col: 0, severity, message });
            });
        } catch(e) {
            issues.push({ line: 0, col: 0, severity: 'error',
                message: 'Expansion error: ' + e.message });
        }
    }

    return { issues, isParametric };
}

// ---------------------------------------------------------------------------
// GCode Viewer webview
// ---------------------------------------------------------------------------

function getViewerHtml(webview, context, filename, theme) {
    function viewerUri(file) {
        return webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'viewer', file)));
    }
    const cssUri        = viewerUri('common.css');
    const viewerCssUri  = viewerUri('viewer.css');
    const prefsUri      = viewerUri('prefs.js');
    const viewerUiUri   = viewerUri('viewer-ui.js');
    const expanderUri   = viewerUri('gcode-expander.js');
    const parserUri     = viewerUri('parser.js');
    const cameraUri     = viewerUri('camera.js');
    const renderer2dUri = viewerUri('renderer2d.js');
    const stockSimUri   = viewerUri('stock-sim.js');
    const renderer3dUri = viewerUri('renderer3d.js');
    const animatorUri   = viewerUri('animator.js');
    const controllerUri = viewerUri('controller.js');
    const csp = webview.cspSource;
    const fileEsc = filename.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp} 'unsafe-inline'; img-src ${csp} data: blob:; worker-src blob:;">
<title>GCode Viewer — ${fileEsc}</title>
<link rel="stylesheet" href="${cssUri}">
<link rel="stylesheet" href="${viewerCssUri}">
</head>
<body data-host="vscode" data-file-name="${fileEsc}">
<!-- The layout is built by viewer-ui.js -->
<div id="viewer-root"></div>

<!-- Debug overlay: hidden unless something goes wrong (click to dismiss) -->
<div id="dbg" title="Click to dismiss" style="display:none;position:fixed;bottom:0;left:0;right:0;max-height:160px;overflow-y:auto;
  background:rgba(0,0,0,0.82);color:#0f0;font:11px/1.4 monospace;padding:6px 10px;
  z-index:9999;white-space:pre-wrap;cursor:pointer;"></div>

<script src="${prefsUri}"></script>
<script src="${viewerUiUri}"></script>
<script src="${expanderUri}"></script>
<script src="${parserUri}"></script>
<script src="${cameraUri}"></script>
<script src="${renderer2dUri}"></script>
<script src="${stockSimUri}"></script>
<script src="${renderer3dUri}"></script>
<script src="${animatorUri}"></script>
<script src="${controllerUri}"></script>
<script>
(function() {
  const dbg = document.getElementById('dbg');
  dbg.addEventListener('click', () => { dbg.style.display = 'none'; });
  // Every message is kept; the overlay only appears for problems (showing the history too)
  function log(msg, problem) {
    if (problem) dbg.style.display = 'block';
    dbg.textContent += new Date().toISOString().slice(11,23) + ' ' + msg + '\\n';
    dbg.scrollTop = dbg.scrollHeight;
  }

  // Capture all unhandled errors
  window.addEventListener('error', e => log('ERROR: ' + e.message + ' (' + e.filename + ':' + e.lineno + ')', true));
  window.addEventListener('unhandledrejection', e => log('REJECT: ' + e.reason, true));

  log('Scripts loaded, creating Controller...');
  let ctrl;
  try {
    ctrl = new Controller();
    ctrl.fileName = document.body.dataset.fileName;
    log('Controller OK');
  } catch(e) {
    log('Controller FAILED: ' + e, true);
    return;
  }

  // Earlier jobs for the stock simulation: the extension reads them from the file's folder
  const priorRequests = new Map();
  let priorRequestId = 0;
  ctrl.readPriorJob = (name) => new Promise(resolve => {
    const id = ++priorRequestId;
    priorRequests.set(id, resolve);
    vscode.postMessage({ command: 'readPriorJob', id, name });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg && msg.command === 'priorJob') {
      const resolve = priorRequests.get(msg.id);
      priorRequests.delete(msg.id);
      if (resolve) resolve(typeof msg.text === 'string' ? msg.text : null);
      return;
    }
    log('postMessage received: ' + (msg && msg.command) + (msg && msg.gcode ? ' (' + msg.gcode.length + ' chars)' : ''));
    if (msg && msg.command === 'loadGCode') {
      log('Calling loadGCodeFromString...');
      ctrl.parser.machineValues = msg.machineValues || null;  // FluidNC config.yaml values, if any
      ctrl.loadGCodeFromString(msg.gcode, '').then(() => {
        log('loadGCodeFromString resolved. Segments: ' + ctrl.segments.length);
        if (ctrl.segments.length === 0) log('WARNING: 0 segments', true);
      }).catch(e => {
        log('loadGCodeFromString REJECTED: ' + e, true);
      });
    }
  });

  const vscode = acquireVsCodeApi();
  log('Sending ready...');
  vscode.postMessage({ command: 'ready' });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Auto-complete: GCode commands + FluidNC $ commands/settings
// ---------------------------------------------------------------------------

function _makeCompletion(label, kind, detail, doc, insert) {
    const item = new vscode.CompletionItem(label, kind);
    item.detail = detail || '';
    if (doc)    item.documentation = new vscode.MarkdownString(doc);
    if (insert !== undefined && insert !== null)
        // Escape a leading $ so VS Code doesn't treat it as a snippet variable
        item.insertText = new vscode.SnippetString(insert.replace(/^\$/, '\\$'));
    return item;
}

function _buildCompletions() {
    const KW = vscode.CompletionItemKind.Keyword;
    const FN = vscode.CompletionItemKind.Function;
    const PR = vscode.CompletionItemKind.Property;

    const gcodeItems = [
        // --- Motion ---
        _makeCompletion('G0',  KW, 'Rapid positioning',                  'Move at maximum speed. Laser disables during G0.', 'G0 X${1:0} Y${2:0} Z${3:0}'),
        _makeCompletion('G00', KW, 'Rapid positioning (leading zero)',    null, null),
        _makeCompletion('G1',  KW, 'Linear feed move',                   'Move at current feed rate F.', 'G1 X${1:0} Y${2:0} Z${3:0} F${4:1000}'),
        _makeCompletion('G01', KW, 'Linear feed move (leading zero)',     null, null),
        _makeCompletion('G2',  KW, 'Circular arc, clockwise (CW)',        'CW arc — I/J center offset or R radius. Add Z for helix, P for turns.', 'G2 X${1:0} Y${2:0} I${3:0} J${4:0} F${5:1000}'),
        _makeCompletion('G02', KW, 'Circular arc, CW (leading zero)',     null, null),
        _makeCompletion('G3',  KW, 'Circular arc, counter-clockwise (CCW)', 'CCW arc — I/J center offset or R radius.', 'G3 X${1:0} Y${2:0} I${3:0} J${4:0} F${5:1000}'),
        _makeCompletion('G03', KW, 'Circular arc, CCW (leading zero)',    null, null),
        // --- Dwell ---
        _makeCompletion('G4',  KW, 'Dwell',                               'Synchronized pause. **P** = seconds.', 'G4 P${1:1}'),
        _makeCompletion('G04', KW, 'Dwell (leading zero)',                null, null),
        // --- Coordinate system offset ---
        _makeCompletion('G10', KW, 'Set coordinate system offset',        'L2 P1 X0 Y0 Z0: set G54 origin. L20 P0 X0: set to current position.', 'G10 L${1|2,20|} P${2:1} X${3:0} Y${4:0} Z${5:0}'),
        // --- Plane selection ---
        _makeCompletion('G17', KW, 'XY plane (default)',                  'Arc plane XY. Required for G2/G3 in XY.'),
        _makeCompletion('G18', KW, 'ZX plane',                            'Arc plane ZX. Required for G2/G3 in ZX.'),
        _makeCompletion('G19', KW, 'YZ plane',                            'Arc plane YZ. Required for G2/G3 in YZ.'),
        // --- Units ---
        _makeCompletion('G20', KW, 'Inch mode',                           'X, Y, Z converted to inches. A, B, C are unitless.'),
        _makeCompletion('G21', KW, 'Metric mode (mm)',                    'X, Y, Z in millimeters (default). A, B, C are unitless.'),
        // --- Reference positions ---
        _makeCompletion('G28',   KW, 'Rapid to G28 saved position',      'Optional pre-move to axes if specified, then rapid to stored G28 position.', 'G28 Z${1:10}'),
        _makeCompletion('G28.1', KW, 'Save current MPos as G28',          null, null),
        _makeCompletion('G30',   KW, 'Rapid to G30 saved position',       'Same behavior as G28 but uses G30 location.', 'G30 Z${1:10}'),
        _makeCompletion('G30.1', KW, 'Save current MPos as G30',          null, null),
        // --- Probing ---
        _makeCompletion('G38.2', KW, 'Probe toward (error on miss)',      'Stop on contact. Error alarm if not triggered.', 'G38.2 Z${1:-20} F${2:80}'),
        _makeCompletion('G38.3', KW, 'Probe toward (no error on miss)',   'Stop on contact. No error if not triggered.', 'G38.3 Z${1:-20} F${2:80}'),
        _makeCompletion('G38.4', KW, 'Probe away (error on miss)',        'Stop on loss of contact. Error if still touching.', 'G38.4 Z${1:20} F${2:80}'),
        _makeCompletion('G38.5', KW, 'Probe away (no error on miss)',     null, 'G38.5 Z${1:20} F${2:80}'),
        _makeCompletion('G38.6', KW, 'Probe toward incremental/mm (FluidNC v3.7.6+)', 'Like G38.2 but always incremental and mm regardless of modal state.', 'G38.6 Z${1:-20} F${2:80}'),
        _makeCompletion('G38.7', KW, 'Probe toward incremental/mm, no error', null, 'G38.7 Z${1:-20} F${2:80}'),
        _makeCompletion('G38.8', KW, 'Probe away incremental/mm',         null, null),
        _makeCompletion('G38.9', KW, 'Probe away incremental/mm, no error', null, null),
        // --- Cutter / tool compensation ---
        _makeCompletion('G40',   KW, 'Cancel cutter radius compensation', 'Only supported form — G41/G42 are NOT supported by FluidNC.'),
        _makeCompletion('G43.1', KW, 'Dynamic tool length offset',        '`G43.1 Z0.25` adds 0.25 mm to work Z. ⚠ `G43 H<n>` (table form) is NOT supported.', 'G43.1 Z${1:0}'),
        _makeCompletion('G49',   KW, 'Cancel tool length offset',         'Resets TLO to zero.'),
        // --- Machine / work coordinates ---
        _makeCompletion('G53', KW, 'Machine coordinates (one block)',     'Move in MPos for this block only. Non-modal.', 'G53 Z${1:-1}'),
        _makeCompletion('G54', KW, 'Work coordinate system 1 (G54)',      'Default WCS at startup.'),
        _makeCompletion('G55', KW, 'Work coordinate system 2 (G55)',      null, null),
        _makeCompletion('G56', KW, 'Work coordinate system 3 (G56)',      null, null),
        _makeCompletion('G57', KW, 'Work coordinate system 4 (G57)',      null, null),
        _makeCompletion('G58', KW, 'Work coordinate system 5 (G58)',      null, null),
        _makeCompletion('G59', KW, 'Work coordinate system 6 (G59)',      null, null),
        // --- Distance mode ---
        _makeCompletion('G90', KW, 'Absolute distance mode',              'Axis values are absolute positions in current WCS.'),
        _makeCompletion('G91', KW, 'Incremental distance mode',           'Axis values are distances relative to current position.'),
        // --- Coordinate offset ---
        _makeCompletion('G92',   KW, 'Coordinate offset (volatile)',      'Makes current position = specified values. Lost on reboot — prefer G10.', 'G92 X${1:0} Y${2:0} Z${3:0}'),
        _makeCompletion('G92.1', KW, 'Cancel G92 offset',                 null, null),
        // --- Feed rate mode ---
        _makeCompletion('G93', KW, 'Inverse time feed mode',              'F = 1/minutes. Must appear on every G1/G2/G3 line.'),
        _makeCompletion('G94', KW, 'Units per minute (default)',           'F = mm/min or in/min.'),
        // --- M codes ---
        _makeCompletion('M0',   KW, 'Program pause (hold)',               'Send cycle-start `~` to resume.'),
        _makeCompletion('M2',   KW, 'Program end',                        'Ends job; resets modal state (G17 G54 G90 G94 M5 M9 etc).'),
        _makeCompletion('M30',  KW, 'Program end + reset',                'Same as M2. Rewinds buffer.'),
        _makeCompletion('M3',   KW, 'Spindle CW / laser constant power',  'Start spindle clockwise at S speed.', 'M3 S${1:10000}'),
        _makeCompletion('M4',   KW, 'Spindle CCW / laser dynamic power',  'Start spindle CCW at S speed.', 'M4 S${1:10000}'),
        _makeCompletion('M5',   KW, 'Spindle / laser off',                'Disable spindle or laser.'),
        _makeCompletion('M6',   KW, 'Tool change',                        'Change to tool prepared with T word.', 'M6 T${1:1}'),
        _makeCompletion('M7',   KW, 'Mist coolant on',                    null, null),
        _makeCompletion('M7.1', KW, 'Mist coolant off (FluidNC)',         'FluidNC extension. Turns off M7 only; M9 turns off both.', null),
        _makeCompletion('M8',   KW, 'Flood coolant on',                   null, null),
        _makeCompletion('M8.1', KW, 'Flood coolant off (FluidNC)',        'FluidNC extension. Turns off M8 only; M9 turns off both.', null),
        _makeCompletion('M9',   KW, 'All coolant off',                    'Turns off both M7 and M8.'),
        _makeCompletion('M61',  KW, 'Set current tool (no motion)',       '`M61 Q2` — tells FluidNC tool 2 is loaded without a physical change.', 'M61 Q${1:1}'),
        _makeCompletion('M62',  KW, 'Digital output on (synced)',         'Synchronized with motion. P = output number.', 'M62 P${1:0}'),
        _makeCompletion('M63',  KW, 'Digital output off (synced)',        'Synchronized with motion. P = output number.', 'M63 P${1:0}'),
        _makeCompletion('M64',  KW, 'Digital output on (immediate)',      '⚠ Unsynchronized — prefer M62.', 'M64 P${1:0}'),
        _makeCompletion('M65',  KW, 'Digital output off (immediate)',     '⚠ Unsynchronized — prefer M63.', 'M65 P${1:0}'),
        _makeCompletion('M66',  KW, 'Read digital/analog input',         'L0 (IMMEDIATE) mode only supported. Result in `#5399`.', 'M66 P${1:0} L0'),
        _makeCompletion('M67',  KW, 'Set analog output (PWM)',            '`M67 E0 Q50` sets output 0 to 50% duty cycle.', 'M67 E${1:0} Q${2:50}'),
        // --- Parametric flow control (FluidNC-supported subset) ---
        // SUB/ENDSUB/CALL/RETURN are NOT supported — only file-based IF/WHILE/DO/REPEAT
        _makeCompletion('IF',        KW, 'Conditional',                  'O-word: `Onnn IF [condition]`',                    null),
        _makeCompletion('ELSEIF',    KW, 'Else-if branch',               'O-word: `Onnn ELSEIF [condition]`',                null),
        _makeCompletion('ELSE',      KW, 'Else branch',                  'O-word: `Onnn ELSE`',                              null),
        _makeCompletion('ENDIF',     KW, 'End if block',                 'O-word: `Onnn ENDIF`',                             null),
        _makeCompletion('WHILE',     KW, 'While loop',                   'O-word: `Onnn WHILE [condition]`',                 null),
        _makeCompletion('ENDWHILE',  KW, 'End while loop',               'O-word: `Onnn ENDWHILE`',                          null),
        _makeCompletion('DO',        KW, 'Do-while loop',                'O-word: `Onnn DO` ... `Onnn WHILE [cond]`',        null),
        _makeCompletion('REPEAT',    KW, 'Repeat N times',               'O-word: `Onnn REPEAT [count]`',                    null),
        _makeCompletion('ENDREPEAT', KW, 'End repeat loop',              'O-word: `Onnn ENDREPEAT`',                         null),
        _makeCompletion('BREAK',     KW, 'Break out of loop',            'O-word: `Onnn BREAK` — immediate loop exit.',       null),
        _makeCompletion('CONTINUE',  KW, 'Skip to next loop iteration',  'O-word: `Onnn CONTINUE` — skips to while test.',   null),
        // --- Word addresses ---
        _makeCompletion('F',  PR, 'Feed rate',                  'mm/min or in/min (G94); or 1/min in inverse-time mode (G93).', 'F${1:1000}'),
        _makeCompletion('S',  PR, 'Spindle speed / laser power', 'RPM for spindle; 0–max for laser PWM level.', 'S${1:10000}'),
        _makeCompletion('T',  PR, 'Tool number',                'Prepare tool for M6. Also selects spindle index on multi-spindle configs.', 'T${1:1}'),
        _makeCompletion('X',  PR, 'X axis (linear, unit-affected)', null, 'X${1:0}'),
        _makeCompletion('Y',  PR, 'Y axis (linear, unit-affected)', null, 'Y${1:0}'),
        _makeCompletion('Z',  PR, 'Z axis (linear, unit-affected)', null, 'Z${1:0}'),
        _makeCompletion('A',  PR, 'A axis (rotational, unitless)', null, 'A${1:0}'),
        _makeCompletion('B',  PR, 'B axis (rotational, unitless)', null, 'B${1:0}'),
        _makeCompletion('C',  PR, 'C axis (rotational, unitless)', null, 'C${1:0}'),
        _makeCompletion('U',  PR, 'U axis ⚠ not supported by FluidNC', 'FluidNC only supports X Y Z A B C axes.', 'U${1:0}'),
        _makeCompletion('V',  PR, 'V axis ⚠ not supported by FluidNC', 'FluidNC only supports X Y Z A B C axes.', 'V${1:0}'),
        _makeCompletion('W',  PR, 'W axis ⚠ not supported by FluidNC', 'FluidNC only supports X Y Z A B C axes.', 'W${1:0}'),
        _makeCompletion('I',  PR, 'Arc center X offset',        'X-offset of arc center from current position.', 'I${1:0}'),
        _makeCompletion('J',  PR, 'Arc center Y offset',        'Y-offset of arc center from current position.', 'J${1:0}'),
        _makeCompletion('K',  PR, 'Arc center Z offset',        'Z-offset of arc center from current position.', 'K${1:0}'),
        _makeCompletion('R',  PR, 'Arc radius',                 'Radius for G2/G3 arc (alternative to I/J/K).', 'R${1:10}'),
        _makeCompletion('P',  PR, 'Dwell / coordinate system',  'Seconds for G4; coordinate system number for G10 and G28/G30.', 'P${1:1}'),
        _makeCompletion('Q',  PR, 'Analog level / tool',        'Duty cycle % for M67; tool number for M61.', 'Q${1:50}'),
        _makeCompletion('L',  PR, 'L parameter (G10)',          'L2 = set offset; L20 = set to current position.', 'L${1|2,20|}'),
        _makeCompletion('E',  PR, 'Analog output number',       'Output number for M67. Also digital input for M66.', 'E${1:0}'),
        _makeCompletion('N',  PR, 'Line number',                'Optional block sequence number.', 'N${1:10}'),
        _makeCompletion('D',  PR, 'Debug display (FluidNC)',    '`D#<var>` or `D[expr]` prints value as INFO message. ⚠ Not for production.', 'D${1:#<var>}'),
    ];

    // FluidNC $ commands (actions / queries)
    const fluidncCmdItems = [
        _makeCompletion('$H',                  FN, 'Home all axes',                       'Homing cycle. Also `$HX`, `$HY`, `$HZ` for single axis.'),
        _makeCompletion('$HX',                 FN, 'Home X axis',                         null, null),
        _makeCompletion('$HY',                 FN, 'Home Y axis',                         null, null),
        _makeCompletion('$HZ',                 FN, 'Home Z axis',                         null, null),
        _makeCompletion('$X',                  FN, 'Alarm/Disable — unlock',              'Clear alarm state. Same as `$Alarm/Disable`.'),
        _makeCompletion('$Alarm/Disable',      FN, 'Unlock / clear alarm state',          'Tries to clear the alarm state.'),
        _makeCompletion('$A',                  FN, 'Alarms/List — list alarm codes',      null, null),
        _makeCompletion('$Alarms/List',        FN, 'List alarm code descriptions',        'Use `$A=5` for a specific number.'),
        _makeCompletion('$Alarm/Send=',        FN, 'Trigger alarm number',                'e.g. `$Alarm/Send=5`', '$Alarm/Send=${1:5}'),
        _makeCompletion('$Bye',                FN, 'Reboot the processor',                null, null),
        _makeCompletion('$I',                  FN, 'Build/Info — firmware info',          null, null),
        _makeCompletion('$Build/Info',         FN, 'Show firmware build information',     null, null),
        _makeCompletion('$CI',                 FN, 'Channel/Info — channel info',         null, null),
        _makeCompletion('$Channel/Info',       FN, 'List communication channels',         null, null),
        _makeCompletion('$CMD',                FN, 'Commands/List — show all commands',   null, null),
        _makeCompletion('$Commands/List',      FN, 'Show all available commands',         null, null),
        _makeCompletion('$C',                  FN, 'GCode/Check — toggle check mode',     'Run GCode virtually without moving. Toggle off with `$C` again.'),
        _makeCompletion('$GCode/Check',        FN, 'Toggle GCode dry-run / check mode',   null, null),
        _makeCompletion('$Gcode/Echo',         FN, 'Echo GCode input to console',         'Use `=on` / `=off`.', '$Gcode/Echo=${1:on}'),
        _makeCompletion('$G',                  FN, 'GCode/Modes — show modal state',      null, null),
        _makeCompletion('$GCode/Modes',        FN, 'Show all modal GCode states',         null, null),
        _makeCompletion('$#',                  FN, 'GCode/Offsets — show offsets',        null, null),
        _makeCompletion('$GCode/Offsets',      FN, 'Show all saved coordinate offsets',   null, null),
        _makeCompletion('$N',                  FN, 'GCode/StartupLines',                  null, null),
        _makeCompletion('$GCode/StartupLines', FN, 'Show / set startup GCode lines',      'Set: `$N0=G21` etc.'),
        _makeCompletion('$GD',                 FN, 'Gpio/Dump — GPIO state dump',         null, null),
        _makeCompletion('$Gpio/Dump',          FN, 'Show detailed GPIO pin state',        null, null),
        _makeCompletion('$L',                  FN, 'GrblNames/List — ESPxxx mappings',    null, null),
        _makeCompletion('$GrblNames/List',     FN, 'Show ESPxxx command name mappings',   null, null),
        _makeCompletion('$$',                  FN, 'GrblSettings/List — Grbl settings',   null, null),
        _makeCompletion('$GrblSettings/List',  FN, 'Show Grbl-compatible $n settings',    null, null),
        _makeCompletion('$GS',                 FN, 'Grbl/Show — output Grbl string',      null, null),
        _makeCompletion('$Grbl/Show',          FN, 'Output Grbl startup string',          null, null),
        _makeCompletion('$Heap',               FN, 'Heap/Show — show heap memory',        null, null),
        _makeCompletion('$Heap/Show',          FN, 'Show free heap memory info',          null, null),
        _makeCompletion('$Help',               FN, 'Show basic help',                     null, null),
        _makeCompletion('$Limits',             FN, 'Limits/Show — limit switch state',    null, null),
        _makeCompletion('$Limits/Show',        FN, 'View real-time limit switch status',  null, null),
        _makeCompletion('$LocalFS/Backup',     FN, 'Backup local FS to SD card',          null, null),
        _makeCompletion('$LocalFS/Delete',     FN, 'Delete file from local FS',           null, '$LocalFS/Delete=${1:filename}'),
        _makeCompletion('$LocalFS/Format',     FN, 'Format local filesystem',             null, null),
        _makeCompletion('$LocalFS/Hashes',     FN, 'List SHA-256 hashes of local files',  null, null),
        _makeCompletion('$LocalFS/List',       FN, 'List files on local FS',              null, null),
        _makeCompletion('$LocalFS/Migrate',    FN, 'Migrate local FS',                    null, null),
        _makeCompletion('$LocalFS/Rename',     FN, 'Rename file on local FS',             null, '$LocalFS/Rename=${1:old}>${2:new}'),
        _makeCompletion('$LocalFS/Restore',    FN, 'Restore local FS',                    null, null),
        _makeCompletion('$LocalFS/Run',        FN, 'Run file from local FS',              null, '$LocalFS/Run=${1:filename}'),
        _makeCompletion('$LocalFS/Show',       FN, 'Show file contents from local FS',    null, '$LocalFS/Show=${1:filename}'),
        _makeCompletion('$LocalFS/Size',       FN, 'Show local FS storage size',          null, null),
        _makeCompletion('$RM',                 FN, 'Macros/Run — run macro',              null, '$Macros/Run=${1:macroName}'),
        _makeCompletion('$Macros/Run',         FN, 'Run macro-defined in config',         null, '$Macros/Run=${1:macroName}'),
        _makeCompletion('$MD',                 FN, 'Motor/Disable — disable motors',      'Allows manual movement. Re-enables on next move.'),
        _makeCompletion('$Motor/Disable',      FN, 'Manually disable motors',             'Use `$MD=X` to disable a single axis.', '$Motor/Disable=${1:X}'),
        _makeCompletion('$ME',                 FN, 'Motor/Enable — enable motors',        'Locks motors. Use `$ME=X` for single axis.'),
        _makeCompletion('$Motor/Enable',       FN, 'Manually enable / lock motors',       null, '$Motor/Enable=${1:X}'),
        _makeCompletion('$MI',                 FN, 'Motors/Init — reinitialize motors',   'For SPI/UART motor drivers.'),
        _makeCompletion('$Motors/Init',        FN, 'Reinitialize motors (SPI/UART)',      null, null),
        _makeCompletion('$ESP600',             FN, 'Notification/Send — send notice',     null, '$Notification/Send=${1:message}'),
        _makeCompletion('$Notification/Send',  FN, 'Send notification',                   null, '$Notification/Send=${1:message}'),
        _makeCompletion('$Notification/Setup', FN, 'Configure notification',              null, null),
        _makeCompletion('$Radio/State',        FN, 'Get or set radio state',              'Values: `On` or `Off`.', '$Radio/State=${1:On}'),
        _makeCompletion('$RI',                 FN, 'Report/Interval — auto-report',       null, null),
        _makeCompletion('$Report/Interval',    FN, 'Set automatic reporting interval',    null, null),
        _makeCompletion('$SD/Delete',          FN, 'Delete file from SD card',            null, '$SD/Delete=${1:filename}'),
        _makeCompletion('$SD/List',            FN, 'List SD card files',                  null, null),
        _makeCompletion('$SD/ListJSON',        FN, 'List SD card files as JSON',          null, null),
        _makeCompletion('$SD/Rename',          FN, 'Rename SD card file',                 null, '$SD/Rename=${1:current}>${2:new}'),
        _makeCompletion('$SD/Run',             FN, 'Run GCode file from SD card',         null, '$SD/Run=${1:filename.nc}'),
        _makeCompletion('$SD/Show',            FN, 'Show SD card file contents',          null, '$SD/Show=${1:filename}'),
        _makeCompletion('$ESP200',             FN, 'SD/Status — SD card status',          null, null),
        _makeCompletion('$SD/Status',          FN, 'Show SD card status',                 null, null),
        _makeCompletion('$Files/ListGcode',    FN, 'List GCode files (for pendants)',      null, '$Files/ListGcode=${1:/}'),
        _makeCompletion('$File/ShowHash',      FN, 'Show SHA-256 hash of a file',         null, '$File/ShowHash=${1:filename}'),
        _makeCompletion('$File/ShowSome',      FN, 'Show lines from a file',              '`$File/ShowSome=10,file.nc` or `=10,20,file.nc`', '$File/ShowSome=${1:10},${2:filename}'),
        _makeCompletion('$NVX',                FN, 'Settings/Erase — erase NVS',          null, null),
        _makeCompletion('$Settings/Erase',     FN, 'Clear NVS settings storage',          null, null),
        _makeCompletion('$S',                  FN, 'Settings/List — show all settings',   null, null),
        _makeCompletion('$Settings/List',      FN, 'Show values of all settings',         null, null),
        _makeCompletion('$SC',                 FN, 'Settings/ListChanged',                null, null),
        _makeCompletion('$Settings/ListChanged', FN, 'Show settings changed from default', null, null),
        _makeCompletion('$RST',                FN, 'Settings/Restore — restore defaults', '`$RST=$` settings, `$RST=#` offsets, `$RST=*` all', '$RST=${1:*}'),
        _makeCompletion('$Settings/Restore',   FN, 'Restore settings to defaults',        null, '$Settings/Restore=${1:*}'),
        _makeCompletion('$V',                  FN, 'Settings/Stats — NVS stats',          null, null),
        _makeCompletion('$Settings/Stats',     FN, 'Show NVS storage statistics',         null, null),
        _makeCompletion('$ESP103',             FN, 'Sta/Setup — WiFi STA setup',          null, null),
        _makeCompletion('$Sta/Setup',          FN, 'WiFi station mode setup',             null, null),
        _makeCompletion('$SS',                 FN, 'Startup/Show — show startup messages', null, null),
        _makeCompletion('$Startup/Show',       FN, 'Show startup messages at any time',   null, null),
        _makeCompletion('$T',                  FN, 'State — show machine state',          null, null),
        _makeCompletion('$State',              FN, 'Show current machine state',          null, null),
        _makeCompletion('$ESP444',             FN, 'System/Control — system control',     null, null),
        _makeCompletion('$System/Control',     FN, 'System control command',              'Use `=RESTART` to reboot.', '$System/Control=${1:RESTART}'),
        _makeCompletion('$ESP111',             FN, 'System/IP — get system IP',           null, null),
        _makeCompletion('$System/IP',          FN, 'Show system IP address',              null, null),
        _makeCompletion('$SLP',                FN, 'System/Sleep — sleep mode',           null, null),
        _makeCompletion('$System/Sleep',       FN, 'Put system to sleep',                 null, null),
        _makeCompletion('$ESP420',             FN, 'System/Stats — system info',          null, null),
        _makeCompletion('$System/Stats',       FN, 'Show system statistics',              null, null),
        _makeCompletion('$ESP0',               FN, 'WebUI/Help — WebUI command help',     null, null),
        _makeCompletion('$WebUI/Help',         FN, 'WebUI command help',                  null, null),
        _makeCompletion('$ESP400',             FN, 'WebUI/List — WebUI configuration',    null, null),
        _makeCompletion('$WebUI/List',         FN, 'List WebUI configuration',            null, null),
        _makeCompletion('$ESP401',             FN, 'WebUI/Set — set WebUI setting',       null, '$WebUI/Set=P${1:setting}T${2:type}V${3:value}'),
        _makeCompletion('$WebUI/Set',          FN, 'Set WebUI setting',                   null, null),
        _makeCompletion('$WiFi/ListAPs',       FN, 'List visible WiFi access points',     null, null),
        _makeCompletion('$XR',                 FN, 'Xmodem/Receive — receive file',       null, null),
        _makeCompletion('$Xmodem/Receive',     FN, 'Receive file via Xmodem protocol',    null, null),
        _makeCompletion('$XS',                 FN, 'Xmodem/Send — send file',             null, null),
        _makeCompletion('$Xmodem/Send',        FN, 'Send file via Xmodem protocol',       null, null),
        _makeCompletion('$J',                  FN, 'Jog command',                         'e.g. `$J=G91 X10 F500`', '$J=G91 ${1:X10} F${2:500}'),
        _makeCompletion('$Jog',                FN, 'Jog command (long form)',              null, null),
    ];

    // FluidNC $ settings (writable key=value pairs)
    const fluidncSettingItems = [
        _makeCompletion('$Start/Message',           PR, 'Custom startup message',        'Substitutions: `\\V` version, `\\B` build, `\\R` radio, `\\H` help prompt.', '$Start/Message=${1:Grbl \\V [FluidNC \\B (\\R) \\H]}'),
        _makeCompletion('$Firmware/Build',          PR, 'Extra text in VER: report',    null, '$Firmware/Build=${1:}'),
        _makeCompletion('$Report/Status',           PR, 'Status report format ($10)',   '`0` work coords, `1` machine coords, `2` work+buffer, `3` machine+buffer', '$Report/Status=${1:2}'),
        _makeCompletion('$Config/Filename',         PR, 'Config YAML file to load',     null, '$Config/Filename=${1:config.yaml}'),
        _makeCompletion('$Message/Level',           PR, 'Log message reporting level',  'Valid: `None` `Error` `Warning` `Info` `Debug` `Verbose`', '$Message/Level=${1|None,Error,Warning,Info,Debug,Verbose|}'),
        _makeCompletion('$Notification/Type',       PR, 'Notification method',          'Valid: `NONE` `EMAIL` `LINE` `PUSHOVER`', '$Notification/Type=${1|NONE,EMAIL,LINE,PUSHOVER|}'),
        _makeCompletion('$Notification/T1',         PR, 'Notification token 1 (login)', null, '$Notification/T1=${1:}'),
        _makeCompletion('$Notification/T2',         PR, 'Notification token 2 (password)', null, '$Notification/T2=${1:}'),
        _makeCompletion('$Notification/TS',         PR, 'Notification server / address', 'Email format: `addr#smtp.server:port`', '$Notification/TS=${1:email@example.com#smtp.server:465}'),
        _makeCompletion('$Telnet/Enable',           PR, 'Enable Telnet on TCP port 23', null, '$Telnet/Enable=${1|true,false|}'),
        _makeCompletion('$HTTP/Enable',             PR, 'Enable HTTP server',           null, '$HTTP/Enable=${1|true,false|}'),
        _makeCompletion('$HTTP/Port',               PR, 'HTTP server port',             'Default: 80', '$HTTP/Port=${1:80}'),
        _makeCompletion('$HTTP/BlockDuringMotion',  PR, 'Block HTTP during motion',     'Prevents LocalFS serving while running.', '$HTTP/BlockDuringMotion=${1|true,false|}'),
        _makeCompletion('$WiFi/Mode',               PR, 'WiFi operating mode',          'Valid: `Off` `STA` `AP` `STA>AP`', '$WiFi/Mode=${1|Off,STA,AP,STA>AP|}'),
        _makeCompletion('$WiFi/FastScan',           PR, 'Fast WiFi scan on startup',    null, '$WiFi/FastScan=${1|true,false|}'),
        _makeCompletion('$Wifi/PsMode',             PR, 'WiFi power saving mode',       'Valid: `None` `Max` `Min`', '$Wifi/PsMode=${1|None,Min,Max|}'),
        _makeCompletion('$Sta/SSID',                PR, 'WiFi station SSID',            null, '$Sta/SSID=${1:MyNetwork}'),
        _makeCompletion('$Sta/Password',            PR, 'WiFi station password',        null, '$Sta/Password=${1:password}'),
        _makeCompletion('$Sta/IPMode',              PR, 'WiFi station IP mode',         'Valid: `DHCP` `Static`', '$Sta/IPMode=${1|DHCP,Static|}'),
        _makeCompletion('$Sta/IP',                  PR, 'Static IP (station mode)',     null, '$Sta/IP=${1:192.168.1.100}'),
        _makeCompletion('$Sta/Gateway',             PR, 'Gateway IP (station mode)',    null, '$Sta/Gateway=${1:192.168.1.1}'),
        _makeCompletion('$Sta/Netmask',             PR, 'Subnet mask (station mode)',   'Default: 255.255.255.0', '$Sta/Netmask=${1:255.255.255.0}'),
        _makeCompletion('$AP/SSID',                 PR, 'Access point SSID',            'Default: FluidNC', '$AP/SSID=${1:FluidNC}'),
        _makeCompletion('$AP/Password',             PR, 'Access point password',        'Default: 12345678', '$AP/Password=${1:12345678}'),
        _makeCompletion('$AP/IP',                   PR, 'Access point IP address',      'Default: 192.168.0.1', '$AP/IP=${1:192.168.0.1}'),
        _makeCompletion('$AP/Country',              PR, 'WiFi regulatory country code', null, '$AP/Country=${1:01}'),
        _makeCompletion('$Hostname',                PR, 'mDNS hostname',                'Access via `hostname.local`. Default: FluidNC', '$Hostname=${1:fluidnc}'),
        _makeCompletion('$Bluetooth/Name',          PR, 'Bluetooth device name',        'Default: FluidNC', '$Bluetooth/Name=${1:FluidNC}'),
        _makeCompletion('$SD/FallbackCS',           PR, 'SD card fallback chip-select', null, null),
    ];

    return { gcodeItems, fluidncCmdItems, fluidncSettingItems };
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

function activate(context) {
    // ---------------------------------------------------------------------------
    // Auto-complete provider
    // ---------------------------------------------------------------------------
    const { gcodeItems, fluidncCmdItems, fluidncSettingItems } = _buildCompletions();
    const allFluidncItems = [...fluidncCmdItems, ...fluidncSettingItems];

    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { language: 'fluidnc' },
        {
            provideCompletionItems(document, position) {
                const lineText   = document.lineAt(position).text;
                const linePrefix = lineText.substring(0, position.character);

                // Detect start of the current token so VS Code's replacement range works
                // for labels that contain $ / . characters not normally in word chars.
                const dollarMatch = linePrefix.match(/\$[^\s]*$/);
                if (dollarMatch) {
                    const start = position.character - dollarMatch[0].length;
                    const range = new vscode.Range(position.line, start, position.line, position.character);
                    return allFluidncItems.map(item => {
                        const copy = Object.assign(
                            new vscode.CompletionItem(item.label, item.kind), item);
                        copy.range = range;
                        return copy;
                    });
                }

                // GCode / word-address mode — match G/M letter+digit token or single letter
                const wordMatch = linePrefix.match(/[A-Za-z][0-9.]*$/);
                if (wordMatch || /^\s*$/.test(linePrefix)) {
                    const start = wordMatch
                        ? position.character - wordMatch[0].length
                        : position.character;
                    const range = new vscode.Range(position.line, start, position.line, position.character);
                    return gcodeItems.map(item => {
                        const copy = Object.assign(
                            new vscode.CompletionItem(item.label, item.kind), item);
                        copy.range = range;
                        return copy;
                    });
                }

                return undefined;
            }
        },
        '$', 'G', 'g', 'M', 'm', 'F', 'f', 'S', 's', 'T', 't',
        'X', 'x', 'Y', 'y', 'Z', 'z', 'I', 'J', 'K', 'R', 'N'
    );
    context.subscriptions.push(completionProvider);

    // ---------------------------------------------------------------------------
    // Document Symbol Provider — Outline view
    // ---------------------------------------------------------------------------
    // Shows in the Outline panel (View > Outline) and Ctrl+Shift+O Go to Symbol.
    // Includes:
    //   • Standalone comment lines  (; text  or  (text) )
    //   • O-word structural blocks  (if / while / do / repeat — as containers)
    //   • Parametric variable assignments  (#<name> = value)
    const symbolProvider = vscode.languages.registerDocumentSymbolProvider(
        { language: 'fluidnc' },
        {
            provideDocumentSymbols(document) {
                const symbols  = [];
                const oStack   = []; // stack of open DocumentSymbol containers
                const n        = document.lineCount;

                for (let i = 0; i < n; i++) {
                    const raw  = document.lineAt(i).text;
                    const text = raw.replace(/\r$/, '');
                    const trimmed = text.trim();
                    if (!trimmed) continue;

                    const lineRange = document.lineAt(i).range;

                    // ---- O-word structural blocks (if / while / do / repeat) ----
                    const oOpen  = trimmed.match(/^O(\d+)\s+(if|while|do|repeat)\b(.*)$/i);
                    const oClose = trimmed.match(/^O(\d+)\s+(endif|endwhile|endrepeat)\b/i);
                    if (oOpen) {
                        const kw    = oOpen[2].toUpperCase();
                        const cond  = oOpen[3].trim();
                        const label = `O${oOpen[1]} ${kw}${cond ? ' ' + cond : ''}`;
                        const sym   = new vscode.DocumentSymbol(
                            label, '', vscode.SymbolKind.Module,
                            lineRange, lineRange
                        );
                        const parent = oStack.length ? oStack[oStack.length - 1] : null;
                        if (parent) parent.children.push(sym);
                        else        symbols.push(sym);
                        oStack.push(sym);
                        continue;
                    }
                    if (oClose && oStack.length) {
                        const top = oStack[oStack.length - 1];
                        // Expand the container range to include the closing line
                        top.range = new vscode.Range(top.range.start, lineRange.end);
                        oStack.pop();
                        continue;
                    }

                    // ---- Standalone semicolon comment  ; text ----
                    const semiM = trimmed.match(/^;+\s*(.+)$/);
                    if (semiM) {
                        const label = semiM[1].trim();
                        if (label.length < 2) continue; // skip bare ";" lines
                        const sym = new vscode.DocumentSymbol(
                            label, '', vscode.SymbolKind.String,
                            lineRange, lineRange
                        );
                        const parent = oStack.length ? oStack[oStack.length - 1] : null;
                        if (parent) parent.children.push(sym);
                        else        symbols.push(sym);
                        continue;
                    }

                    // ---- Standalone paren comment  (text) ----
                    const parenM = trimmed.match(/^\(([^)]+)\)\s*$/);
                    if (parenM) {
                        const label = parenM[1].trim();
                        if (label.length < 2) continue;
                        const sym = new vscode.DocumentSymbol(
                            label, '', vscode.SymbolKind.String,
                            lineRange, lineRange
                        );
                        const parent = oStack.length ? oStack[oStack.length - 1] : null;
                        if (parent) parent.children.push(sym);
                        else        symbols.push(sym);
                        continue;
                    }

                    // ---- Inline paren comment after code  e.g. M0 (MSG text) ----
                    const inlineM = trimmed.match(/\(([^)]+)\)\s*$/);
                    if (inlineM) {
                        const label = inlineM[1].trim();
                        if (label.length < 2) continue;
                        const sym = new vscode.DocumentSymbol(
                            label, '', vscode.SymbolKind.String,
                            lineRange, lineRange
                        );
                        const parent = oStack.length ? oStack[oStack.length - 1] : null;
                        if (parent) parent.children.push(sym);
                        else        symbols.push(sym);
                        continue;
                    }

                    // ---- Parametric variable assignment  #<name> = ... ----
                    const varM = trimmed.match(/^#<([^>]+)>\s*=/);
                    if (varM) {
                        // Strip trailing comment to get the value portion
                        const afterEq = trimmed.replace(/^#<[^>]+>\s*=\s*/, '')
                            .replace(/;.*$/, '').replace(/\(.*\)/, '').trim();
                        const sym = new vscode.DocumentSymbol(
                            `#<${varM[1]}>`, afterEq,
                            vscode.SymbolKind.Variable,
                            lineRange, lineRange
                        );
                        const parent = oStack.length ? oStack[oStack.length - 1] : null;
                        if (parent) parent.children.push(sym);
                        else        symbols.push(sym);
                        continue;
                    }
                }

                return symbols;
            }
        }
    );
    context.subscriptions.push(symbolProvider);

    // Diagnostic collection for validation results
    const diagCollection = vscode.languages.createDiagnosticCollection('fluidnc');
    context.subscriptions.push(diagCollection);

    // Clear diagnostics when a file is closed
    vscode.workspace.onDidCloseTextDocument(doc => diagCollection.delete(doc.uri),
        null, context.subscriptions);

    // Command: expand current file into an untitled editor beside it. A real editor
    // (rather than a webview) gets the same grammar and theme colors as the source,
    // and Ctrl+S offers <name>.expanded.gcode next to the source file.
    const expandFileCmd = vscode.commands.registerCommand('fluidnc.expandFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }
        const doc      = editor.document;
        const filename = path.basename(doc.fileName);
        const source   = doc.getText();

        let result;
        try {
            const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            result = expandLines(lines, filename, { machineValues: loadMachineConfig(doc) });
        } catch (e) {
            vscode.window.showErrorMessage('Expansion failed: ' + e.message);
            return;
        }

        const expandedName = filename.replace(/\.[^.]+$/, '') + '.expanded.gcode';
        const target = vscode.Uri.file(path.join(path.dirname(doc.fileName), expandedName)).with({ scheme: 'untitled' });
        const outDoc = await vscode.workspace.openTextDocument(target);

        // Re-expanding reuses the same untitled document, so replace its whole content
        const edit = new vscode.WorkspaceEdit();
        edit.replace(target, new vscode.Range(0, 0, outDoc.lineCount, 0), result.output);
        await vscode.workspace.applyEdit(edit);
        if (outDoc.languageId !== 'fluidnc') {
            await vscode.languages.setTextDocumentLanguage(outDoc, 'fluidnc');
        }
        await vscode.window.showTextDocument(outDoc, { viewColumn: vscode.ViewColumn.Beside, preview: false });

        if (result.warnings.length) {
            const shown = result.warnings.slice(0, 3).join('; ');
            const more  = result.warnings.length > 3 ? ` (+${result.warnings.length - 3} more)` : '';
            vscode.window.showWarningMessage(`Expanded with ${result.warnings.length} warning(s): ${shown}${more}`);
        }
    });

    context.subscriptions.push(expandFileCmd);

    // Command: view current file in 2D/3D viewer webview
    const viewFileCmd = vscode.commands.registerCommand('fluidnc.viewFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }
        const doc      = editor.document;
        const filename = path.basename(doc.fileName);
        const source   = doc.getText().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const theme    = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? 'light' : 'dark';

        // Parametric files are expanded by the viewer's parser (src/js/gcode-expander.js),
        // which also reports expansion warnings in the panel
        const gcodeText = source;
        const viewTitle = 'View: ' + filename + (isParametricGCode(source) ? ' (expanded)' : '');

        const panel = vscode.window.createWebviewPanel(
            'fluidncViewer',
            viewTitle,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'viewer'))]
            }
        );

        panel.webview.html = getViewerHtml(panel.webview, context, filename, theme);

        // Send GCode once the webview signals it is ready
        panel.webview.onDidReceiveMessage(msg => {
            if (msg.command === 'ready') {
                panel.webview.postMessage({ command: 'loadGCode', gcode: gcodeText, machineValues: loadMachineConfig(doc) });
            } else if (msg.command === 'readPriorJob') {
                // A file named by a (PriorJob: ...) comment, from the same folder only
                const file = path.join(path.dirname(doc.fileName), path.basename(String(msg.name)));
                fs.promises.readFile(file, 'utf8')
                    .catch(() => null)
                    .then(text => panel.webview.postMessage({ command: 'priorJob', id: msg.id, text }));
            }
        }, undefined, context.subscriptions);
    });

    context.subscriptions.push(viewFileCmd);

    // Command: validate current file
    const validateCmd = vscode.commands.registerCommand('fluidnc.validateFile', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }

        const doc      = editor.document;
        const source   = doc.getText().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const filename = path.basename(doc.fileName);

        const machineValues = isParametricGCode(source) ? loadMachineConfig(doc) : null;
        const { issues, isParametric } = validateGCode(source, filename, machineValues);

        const diags = issues.map(issue => {
            const range = new vscode.Range(issue.line, issue.col, issue.line, Number.MAX_SAFE_INTEGER);
            const sev   = issue.severity === 'error'   ? vscode.DiagnosticSeverity.Error
                        : issue.severity === 'warning'  ? vscode.DiagnosticSeverity.Warning
                        :                                 vscode.DiagnosticSeverity.Information;
            const d = new vscode.Diagnostic(range, issue.message, sev);
            d.source = 'CNC GCode Tools';
            return d;
        });

        diagCollection.set(doc.uri, diags);

        const errors   = issues.filter(i => i.severity === 'error').length;
        const warnings = issues.filter(i => i.severity === 'warning').length;
        const fileType = (isParametric ? 'parametric' : 'plain') +
            (machineValues ? `, using ${machineValues.source}` : '');

        if (issues.length === 0) {
            vscode.window.showInformationMessage(
                `✓ Validation passed — ${fileType} GCode, no issues found.`);
        } else {
            vscode.window.showWarningMessage(
                `GCode validation (${fileType}): ${errors} error(s), ${warnings} warning(s).`,
                'Open Problems'
            ).then(choice => {
                if (choice === 'Open Problems')
                    vscode.commands.executeCommand('workbench.panel.markers.view.focus');
            });
        }
    });

    context.subscriptions.push(validateCmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
