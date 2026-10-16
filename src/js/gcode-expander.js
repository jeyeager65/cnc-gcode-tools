/**
 * gcode-expander.js  –  FluidNC parametric G-code expander
 * ==========================================================
 * Evaluates FluidNC parameters and expressions and its O-word flow control
 * (if / elseif / else, while, do-while, repeat, break, continue), producing
 * plain G-code any standard sender can use.
 * Reference: http://wiki.fluidnc.com/en/features/gcode_parameters_expressions
 *
 * Globally scoped (no ES6 modules) so it can be inlined by build.ps1.
 * Also exported via module.exports so the VS Code extension can require it.
 *
 * Public API:
 *   expandLines(sourceLines, filename, options)
 *     Returns { output, lineCount, warnings, sourceMap }
 *   isParametricGCode(text)
 *     True if the text uses parameters or O-word control flow
 *   highlightParametricGCodeLine(line)
 *     Syntax-highlighted HTML for one line of parametric G-code
 *   parseFluidNCConfig(yamlText, source)
 *     Machine values from a FluidNC config.yaml, for expandLines' machineValues option
 */

// ---------------------------------------------------------------------------
// Expression evaluator
// ---------------------------------------------------------------------------
// A small recursive-descent parser for RS274 / FluidNC expressions. Expressions
// come from the G-code file, so they are never handed to eval / new Function:
// that would let a file run arbitrary JavaScript, and is blocked by strict
// Content Security Policies such as the VS Code webview's.
//
// Precedence, lowest to highest (LinuxCNC / FluidNC):
//   AND OR XOR  <  EQ NE LT GT LE GE  <  + -  <  * / MOD  <  **  <  unary + -
//
// Parameters are stored in one object: named parameters (#<name>) under their
// lower-cased name, since FluidNC names are case-insensitive, and numbered
// parameters (#123) under '#123'.

const _DEG = Math.PI / 180;

// Unary functions; trig works in degrees. ATAN[y]/[x] and EXISTS[...] are handled separately.
const _EXPANDER_FUNCS = {
    ABS:   Math.abs,
    ACOS:  x => Math.acos(x) / _DEG,
    ASIN:  x => Math.asin(x) / _DEG,
    ATAN:  x => Math.atan(x) / _DEG,
    COS:   x => Math.cos(x * _DEG),
    EXP:   Math.exp,
    FIX:   Math.floor,  // RS274 FIX = floor (toward -inf)
    FUP:   Math.ceil,
    LN:    Math.log,
    ROUND: Math.round,
    SIN:   x => Math.sin(x * _DEG),
    SQRT:  Math.sqrt,
    TAN:   x => Math.tan(x * _DEG),
};

const _EXPANDER_BINARY_OPS = [
    { AND: (a, b) => (a && b) ? 1 : 0, OR: (a, b) => (a || b) ? 1 : 0, XOR: (a, b) => (!a !== !b) ? 1 : 0 },
    { EQ: (a, b) => a === b ? 1 : 0, NE: (a, b) => a !== b ? 1 : 0,
      LT: (a, b) => a <  b ? 1 : 0, GT: (a, b) => a >  b ? 1 : 0,
      LE: (a, b) => a <= b ? 1 : 0, GE: (a, b) => a >= b ? 1 : 0 },
    { '+': (a, b) => a + b, '-': (a, b) => a - b },
    { '*': (a, b) => a * b, '/': (a, b) => a / b, MOD: (a, b) => a - b * Math.floor(a / b) },
];

// number | #<name> | #123 | # before [ (computed parameter number) | operator / bracket | word
const _RE_EXP_TOKEN = /\s*(?:(\d+\.?\d*|\.\d+)|#<([^>]+)>|#(\d+)|(#)(?=\s*\[)|(\*\*|[-+*\/\[\]])|([A-Za-z_]+))/y;

function _expanderNamedKey(name) { return name.trim().toLowerCase(); }

// Set on the variables object when machine values were supplied: { source, live }
// (a config.yaml, or values read live from the controller)
const _EXP_MACHINE_SOURCE = Symbol('machineSource');
// Also on the variables object:
//   _EXP_INPUTS     - values entered by the user for parameters set outside the file
//                     ({ key: value }), used only when the file hasn't set them itself
//   _EXP_EXTERNAL   - Map of key -> display for every outside parameter the file read,
//                     whether or not a value was available (what to ask the user for)
//   _EXP_UNRESOLVED - key -> { line, root } for parameters whose assignment failed, so
//                     later uses can name the real cause instead of "undefined"
const _EXP_INPUTS = Symbol('inputs');
const _EXP_EXTERNAL = Symbol('external');
const _EXP_UNRESOLVED = Symbol('unresolved');

// Parameters that can be set outside the file: FluidNC globals (#<_name>), config
// values (#</path>) and numbered parameters. Other named parameters are local to the file.
function _expanderIsExternal(key) {
    return key[0] === '_' || key[0] === '/' || key[0] === '#';
}

// Read a parameter's value, or throw a descriptive error (with .undefinedVar set)
function _expanderLookup(key, display, variables) {
    if (key in variables) return variables[key];
    const external = variables[_EXP_EXTERNAL];
    if (external && _expanderIsExternal(key)) external.set(key, display);
    const inputs = variables[_EXP_INPUTS];
    if (inputs && key in inputs) return inputs[key];
    throw _expanderUndefined(key, display, variables);
}

function _expanderUndefined(key, display, variables) {
    let err;
    const unresolved = variables[_EXP_UNRESOLVED] && variables[_EXP_UNRESOLVED][key];
    if (unresolved) {
        // Assigned earlier, but from a value that wasn't known
        err = new Error(display + ' is unknown because ' + unresolved.root +
            ' was not defined when it was set on line ' + unresolved.line);
        err.root = unresolved.root;
    } else {
        // Machine state and config values only exist on the controller
        const machine = variables[_EXP_MACHINE_SOURCE];
        const isMachineKey = (key[0] === '#' && parseInt(key.slice(1), 10) >= 5000) || key[0] === '_' || key[0] === '/';
        let hint = '';
        if (isMachineKey && machine && machine.live) hint = ' (not available from ' + machine.source + ')';
        else if (key[0] === '/' && machine) hint = ' (not set in ' + machine.source + ')';
        else if (key[0] === '#' && isMachineKey) hint = ' (machine parameter, not known offline)';
        else if (isMachineKey) hint = ' (machine value, not known offline)';
        err = new Error('Undefined variable: ' + display + hint);
        err.root = display;
    }
    err.undefinedVar = true;
    return err;
}

// Tokenize text from `start`, stopping quietly at the first character that can't
// start a token (callers parsing part of a line decide whether that is an error)
function _expanderTokenize(text, start) {
    const tokens = [];
    _RE_EXP_TOKEN.lastIndex = start;
    while (_RE_EXP_TOKEN.lastIndex < text.length) {
        const m = _RE_EXP_TOKEN.exec(text);
        if (!m) break;
        let tok;
        if (m[1] !== undefined)      tok = { type: 'num', value: parseFloat(m[1]) };
        else if (m[2] !== undefined) tok = { type: 'var', key: _expanderNamedKey(m[2]), display: '#<' + m[2].trim() + '>' };
        else if (m[3] !== undefined) tok = { type: 'var', key: '#' + parseInt(m[3], 10), display: '#' + m[3] };
        else if (m[4] !== undefined) tok = { type: 'op',  value: '#' };
        else if (m[5] !== undefined) tok = { type: 'op',  value: m[5] };
        else                         tok = { type: 'op',  value: m[6].toUpperCase() };
        tok.end = _RE_EXP_TOKEN.lastIndex;
        tokens.push(tok);
    }
    return tokens;
}

/**
 * Parse and evaluate an expression in text, starting at `start`.
 *   mode 'full'  - the rest of the text must be exactly one expression
 *   mode 'expr'  - parse the longest expression there and stop (assignment values)
 *   mode 'value' - parse one value: number, parameter, [expression] or function call
 * Returns { value, end }, where end is the index just past the last character used.
 */
function _expanderParse(text, start, variables, mode) {
    try {
        const tokens = _expanderTokenize(text, start);
        let pos = 0;

        const peek    = () => tokens[pos];
        const tokText = (t) => t.display || String(t.value);
        const isOp    = (value) => pos < tokens.length && tokens[pos].type === 'op' && tokens[pos].value === value;
        const expect  = (value) => {
            if (!isOp(value)) throw new Error("Expected '" + value + "'");
            pos++;
        };

        const parseBinary = (level) => {
            if (level === _EXPANDER_BINARY_OPS.length) return parsePower();
            const ops = _EXPANDER_BINARY_OPS[level];
            let left = parseBinary(level + 1);
            while (pos < tokens.length && peek().type === 'op' && ops.hasOwnProperty(peek().value)) {
                const op = ops[tokens[pos++].value];
                left = op(left, parseBinary(level + 1));
            }
            return left;
        };

        const parsePower = () => {
            const base = parseUnary();
            if (isOp('**')) { pos++; return Math.pow(base, parsePower()); }  // right-associative
            return base;
        };

        const parseUnary = () => {
            if (isOp('-')) { pos++; return -parseUnary(); }
            if (isOp('+')) { pos++; return parseUnary(); }
            return parsePrimary();
        };

        const parseBracketed = () => {
            expect('[');
            const value = parseBinary(0);
            expect(']');
            return value;
        };

        // A parameter reference without reading its value: #<name>, #123 or #[expr]
        const parseRef = () => {
            const tok = peek();
            if (tok && tok.type === 'var') { pos++; return { key: tok.key, display: tok.display }; }
            if (tok && tok.value === '#') {
                pos++;
                const n = Math.round(parseBracketed());
                return { key: '#' + n, display: '#' + n };
            }
            return null;
        };

        const parsePrimary = () => {
            const tok = peek();
            if (!tok) throw new Error('Unexpected end of expression');
            if (tok.type === 'num') { pos++; return tok.value; }
            const ref = parseRef();
            if (ref) return _expanderLookup(ref.key, ref.display, variables);
            if (tok.value === '[') return parseBracketed();
            if (tok.value === 'EXISTS') {
                pos++;
                expect('[');
                const target = parseRef();
                if (!target) throw new Error('EXISTS needs a parameter, e.g. EXISTS[#<name>]');
                expect(']');
                const inputs = variables[_EXP_INPUTS];
                return target.key in variables || (inputs && target.key in inputs) ? 1 : 0;
            }
            if (_EXPANDER_FUNCS.hasOwnProperty(tok.value)) {
                pos++;
                const arg = parseBracketed();
                // Two-argument form ATAN[y]/[x] -> atan2
                if (tok.value === 'ATAN' && isOp('/') && tokens[pos + 1] && tokens[pos + 1].value === '[') {
                    pos++;
                    return Math.atan2(arg, parseBracketed()) / _DEG;
                }
                return _EXPANDER_FUNCS[tok.value](arg);
            }
            throw new Error("Unexpected '" + tokText(tok) + "'");
        };

        const value = mode === 'value' ? parsePrimary() : parseBinary(0);
        const end = pos > 0 ? tokens[pos - 1].end : start;
        if (mode === 'full') {
            if (pos < tokens.length) throw new Error("Unexpected '" + tokText(tokens[pos]) + "'");
            const rest = text.slice(end).trim();
            if (rest) throw new Error("Unexpected '" + rest[0] + "'");
        }
        return { value, end };
    } catch (e) {
        if (e.undefinedVar) throw e;
        throw new Error("Failed to evaluate '" + text.slice(start).trim() + "': " + e.message);
    }
}

function _expanderEval(expr, variables) {
    return _expanderParse(expr, 0, variables, 'full').value;
}

function _expanderFmt(value) {
    let s = value.toFixed(4);
    if (s.indexOf('.') !== -1) s = s.replace(/\.?0+$/, '');
    return s;
}

// Split a line into code and comments. ( ) comments can appear anywhere in a
// line; a ; comment runs to the end of it. Comments are never substituted, so
// FluidNC messages such as (print, x=%d#<x>) pass through unchanged.
function _expanderSplitComments(line) {
    let code = '';
    const comments = [];
    let i = 0;
    while (i < line.length) {
        const c = line[i];
        if (c === ';') { comments.push(line.slice(i).trim()); break; }
        if (c === '(') {
            const close = line.indexOf(')', i);
            const end = close < 0 ? line.length : close + 1;
            comments.push(line.slice(i, end));
            i = end;
            continue;
        }
        code += c;
        i++;
    }
    return { code: code.trim(), comment: comments.join(' ') };
}

// ---------------------------------------------------------------------------
// Program structure
// ---------------------------------------------------------------------------

// O-word line: label, keyword and the rest (condition / count / comment).
// FluidNC's own examples omit the space before the bracket: o101 repeat[#<n>]
const _RE_EXP_OWORD_LINE = /^\s*O(\d+|<[^>]+>)\s*(if|elseif|else|endif|while|endwhile|do|repeat|endrepeat|break|continue|sub|endsub|call|return)\b(.*)$/i;

// Used to decide whether a file needs expanding before it can be visualized:
// a parameter (#<name>, #123, #[expr]) or a block-opening O-word outside a comment
const _RE_EXP_PARAMETRIC = /^[^;(\n]*?(?:#(?:<|\d|\[)|\bO(?:\d+|<[^>]+>)\s*(?:if|while|do|repeat)\b)/im;

// Safety limits so a runaway loop can't hang the page
const _EXPANDER_MAX_ITER = 100000;
const _EXPANDER_MAX_OUTPUT = 2000000;

// ---------------------------------------------------------------------------
// Interpreter class
// ---------------------------------------------------------------------------

class GCodeExpander {
    /**
     * @param {Object}  [options]
     * @param {boolean} [options.keepComments=false] - Pass comments through to the output
     * @param {Object}  [options.machineValues] - Starting values for machine parameters:
     *   { values: {...}, source: 'config.yaml' } from parseFluidNCConfig(), or
     *   { values, source: 'the controller', live: true } when read from a connected machine
     * @param {Object}  [options.inputs] - User-entered values for parameters set outside the
     *   file ({ key: value }, keys as in machineValues). Used only where neither the file
     *   nor machineValues sets the parameter; nothing is added to the output.
     */
    constructor(options) {
        options = options || {};
        this.keepComments = !!options.keepComments;
        this.variables    = Object.create(null);  // no inherited keys like "constructor"
        this.variables[_EXP_INPUTS] = options.inputs || null;
        this.variables[_EXP_EXTERNAL] = new Map();
        this.variables[_EXP_UNRESOLVED] = Object.create(null);
        if (options.machineValues) {
            Object.assign(this.variables, options.machineValues.values);
            this.variables[_EXP_MACHINE_SOURCE] = {
                source: options.machineValues.source || 'config.yaml',
                live: !!options.machineValues.live
            };
        }
        this.outputLines  = [];
        this.sourceLines  = [];  // 1-based source line number for each output line
        this.warnings     = [];
        this._warned      = new Set();
        this._loopLabels  = [];  // labels of the loops currently running, innermost last
    }

    _eval(expr) { return _expanderEval(expr, this.variables); }

    // Warnings are de-duplicated, so a problem inside a loop is reported once
    _warn(lineNo, message) {
        const text = 'Line ' + lineNo + ': ' + message;
        if (this._warned.has(text)) return;
        this._warned.add(text);
        this.warnings.push(text);
    }

    _emit(text, sourceLine) {
        if (this.outputLines.length >= _EXPANDER_MAX_OUTPUT) {
            throw { flow: 'abort', lineNo: sourceLine };
        }
        this.outputLines.push(text);
        this.sourceLines.push(sourceLine);
    }

    run(lines) {
        const program = this._parse(lines);
        try {
            this._run(program);
        } catch (signal) {
            if (signal && signal.flow === 'abort') {
                this._warn(signal.lineNo, 'Output exceeded ' + _EXPANDER_MAX_OUTPUT + ' lines — expansion stopped.');
            } else {
                throw signal;
            }
        }
    }

    // ---- Parsing: pair O-word lines into nested blocks by label ----

    _parse(lines) {
        const root = [];
        const stack = [{ kind: 'root', label: null, body: root }];
        const top = () => stack[stack.length - 1];

        const open = (node, kind, label, body) => {
            top().body.push(node);
            stack.push({ kind, label, node, body });
        };
        const close = (kind, label, lineNo) => {
            const t = top();
            if (t.kind === kind && t.label === label) stack.pop();
            else this._warn(lineNo, 'O' + label + ' end' + kind + ' has no matching O' + label + ' ' + kind);
        };

        lines.forEach((raw, idx) => {
            const lineNo = idx + 1;
            const line = raw.replace(/\r$/, '');
            const m = line.match(_RE_EXP_OWORD_LINE);
            if (!m) {
                top().body.push({ type: 'line', text: line, lineNo });
                return;
            }
            const label = m[1].toLowerCase();
            const keyword = m[2].toLowerCase();
            const arg = _expanderSplitComments(m[3]).code;  // condition or repeat count
            const t = top();

            switch (keyword) {
                case 'if': {
                    const node = { type: 'if', label, lineNo, branches: [{ cond: arg, lineNo, body: [] }] };
                    open(node, 'if', label, node.branches[0].body);
                    break;
                }
                case 'elseif':
                case 'else': {
                    if (t.kind !== 'if' || t.label !== label) {
                        this._warn(lineNo, 'O' + label + ' ' + keyword + ' has no matching O' + label + ' if');
                        break;
                    }
                    const branch = { cond: keyword === 'else' ? null : arg, lineNo, body: [] };
                    t.node.branches.push(branch);
                    t.body = branch.body;
                    break;
                }
                case 'endif':
                    close('if', label, lineNo);
                    break;
                case 'while':
                    // "oN while" closes an open "oN do"; otherwise it starts a while loop
                    if (t.kind === 'do' && t.label === label) {
                        t.node.cond = arg;
                        t.node.condLine = lineNo;
                        stack.pop();
                    } else {
                        const node = { type: 'while', label, cond: arg, lineNo, body: [] };
                        open(node, 'while', label, node.body);
                    }
                    break;
                case 'endwhile':
                    close('while', label, lineNo);
                    break;
                case 'do': {
                    const node = { type: 'do', label, lineNo, body: [] };
                    open(node, 'do', label, node.body);
                    break;
                }
                case 'repeat': {
                    const node = { type: 'repeat', label, count: arg, lineNo, body: [] };
                    open(node, 'repeat', label, node.body);
                    break;
                }
                case 'endrepeat':
                    close('repeat', label, lineNo);
                    break;
                case 'break':
                case 'continue':
                    t.body.push({ type: keyword, label, lineNo });
                    break;
                default:
                    // sub / endsub / call / return
                    this._warn(lineNo, 'O-word ' + keyword + ' (subroutines) is not supported by FluidNC — line skipped');
            }
        });

        // Unclosed blocks still run to the end of the file
        while (stack.length > 1) {
            const s = stack.pop();
            this._warn(s.node.lineNo, 'O' + s.label + ' ' + s.kind + ' is never closed');
        }
        return root;
    }

    // ---- Execution ----

    _run(statements) {
        for (const s of statements) this._exec(s);
    }

    _cond(expr, lineNo) {
        try {
            return !!this._eval(expr);
        } catch (e) {
            // Treat an unevaluable condition as false and keep going
            this._warn(lineNo, e.message);
            return false;
        }
    }

    // Run one pass of a loop body. Returns false if the loop should stop (break).
    _iterate(node) {
        this._loopLabels.push(node.label);
        try {
            this._run(node.body);
        } catch (signal) {
            if (signal && (signal.flow === 'break' || signal.flow === 'continue') && signal.label === node.label) {
                return signal.flow === 'continue';
            }
            throw signal;
        } finally {
            this._loopLabels.pop();
        }
        return true;
    }

    _tooMany(count, node) {
        if (count <= _EXPANDER_MAX_ITER) return false;
        this._warn(node.lineNo, 'Loop exceeded ' + _EXPANDER_MAX_ITER + ' iterations — aborted.');
        return true;
    }

    _exec(s) {
        switch (s.type) {
            case 'line':
                this._line(s.text, s.lineNo);
                return;

            case 'if':
                for (const branch of s.branches) {
                    if (branch.cond === null || this._cond(branch.cond, branch.lineNo)) {
                        this._run(branch.body);
                        return;
                    }
                }
                return;

            case 'while': {
                let count = 0;
                while (this._cond(s.cond, s.lineNo)) {
                    if (this._tooMany(++count, s) || !this._iterate(s)) break;
                }
                return;
            }

            case 'do': {
                // Body first, then the condition on the closing "while" line
                let count = 0;
                do {
                    if (this._tooMany(++count, s) || !this._iterate(s)) break;
                } while (s.cond !== undefined && this._cond(s.cond, s.condLine));
                return;
            }

            case 'repeat': {
                let times = 0;
                try {
                    times = Math.floor(this._eval(s.count));
                } catch (e) {
                    this._warn(s.lineNo, e.message);
                }
                for (let k = 1; k <= times; k++) {
                    if (this._tooMany(k, s) || !this._iterate(s)) break;
                }
                return;
            }

            case 'break':
            case 'continue':
                if (this._loopLabels.indexOf(s.label) < 0) {
                    this._warn(s.lineNo, 'O' + s.label + ' ' + s.type + ' is not inside an O' + s.label + ' loop — ignored');
                    return;
                }
                throw { flow: s.type, label: s.label };
        }
    }

    // ---- One line of G-code: assignments and words ----
    //
    // FluidNC semantics: all assignments on a line are computed from the current
    // values and take effect together, after the line's G-code has run. So in
    //   #<x>=5 G0 X#<x>
    // the move uses the old value of #<x>.
    _line(text, lineNo) {
        if (!text.trim()) return;
        const { code, comment } = _expanderSplitComments(text);
        const keptComment = this.keepComments ? comment : '';

        if (!code) {
            if (keptComment) this._emit(keptComment, lineNo);
            return;
        }

        // System commands ($H, $Alarm/Send=3, ...) pass through untouched
        if (code[0] === '$') {
            this._emit(code + (keptComment ? ' ' + keptComment : ''), lineNo);
            return;
        }

        const pending = [];  // [key, value] assignments applied after the line
        let out = '';
        let hasWords = false;
        try {
            let i = 0;
            while (i < code.length) {
                const c = code[i];
                if (c === '#' || c === '[') {
                    // Assignment target?  #<name> = ...  /  #123 = ...  /  #[expr] = ...
                    if (c === '#' && /\s$|^$/.test(out)) {
                        const target = this._assignmentTarget(code, i);
                        if (target) {
                            let rhs;
                            try {
                                rhs = _expanderParse(code, target.valueStart, this.variables, 'expr');
                            } catch (e) {
                                // Later uses of the target report what was missing here
                                if (e.undefinedVar) this.variables[_EXP_UNRESOLVED][target.key] = { line: lineNo, root: e.root };
                                throw e;
                            }
                            pending.push([target.key, rhs.value]);
                            i = rhs.end;
                            continue;
                        }
                    }
                    // FluidNC rejects a sign or digits joined to a parameter: X-#<a>, X2#<a>
                    if (/[-+0-9.]$/.test(out)) {
                        throw new Error("FluidNC doesn't allow '" + out.slice(-1) + "' directly before a parameter or expression — use X[-#<a>] instead");
                    }
                    const v = _expanderParse(code, i, this.variables, 'value');
                    out += _expanderFmt(v.value);
                    i = v.end;
                    hasWords = true;
                    continue;
                }
                if (!/\s/.test(c)) hasWords = true;
                out += c;
                i++;
            }
        } catch (e) {
            this._warn(lineNo, e.message);
            // A line with G-code on it would fail on the machine: keep a marker in the output
            if (hasWords || !pending.length) this._emit('; UNRESOLVED: ' + code, lineNo);
            return;
        }

        out = out.replace(/\s+/g, ' ').trim();
        if (out) this._emit(out + (keptComment ? ' ' + keptComment : ''), lineNo);
        else if (keptComment) this._emit(keptComment, lineNo);

        for (const [key, value] of pending) {
            this.variables[key] = value;
            delete this.variables[_EXP_UNRESOLVED][key];
        }
    }

    // If code[i..] is an assignment target followed by '=', return its key and
    // where the value starts; otherwise null
    _assignmentTarget(code, i) {
        const simple = code.slice(i).match(/^#(?:<([^>]+)>|(\d+))\s*=/);
        if (simple) {
            const key = simple[1] !== undefined ? _expanderNamedKey(simple[1]) : '#' + parseInt(simple[2], 10);
            return { key, valueStart: i + simple[0].length };
        }
        if (/^#\s*\[/.test(code.slice(i))) {
            // #[expr] = value: evaluate the parameter number first
            const open = code.indexOf('[', i);
            let depth = 0, j = open;
            for (; j < code.length; j++) {
                if (code[j] === '[') depth++;
                else if (code[j] === ']' && --depth === 0) break;
            }
            const after = code.slice(j + 1).match(/^\s*=/);
            if (j < code.length && after) {
                const n = Math.round(_expanderEval(code.slice(open, j + 1), this.variables));
                return { key: '#' + n, valueStart: j + 1 + after[0].length };
            }
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Syntax highlighting for parametric source
// ---------------------------------------------------------------------------

// Named-capture regex — order = priority (first branch wins at each position)
const _EXP_TOKEN_RE = new RegExp(
    '(?<pcomment>\\([^)]*\\))'                                            + // (paren comment)
    '|(?<scomment>;.*)'                                                    + // ; comment to EOL
    '|(?<variable>#<[^>]+>|#\\d+)'                                         + // #<variable> / #123
    '|(?<keyword>\\b(?:elseif|endif|endwhile|endrepeat|else|while|if|do|repeat|break|continue)\\b)' +
    '|(?<oword>\\bO\\d+)'                                                + // O010 / O001
    '|(?<func>\\b(?:FUP|FIX|ROUND|ABS|SQRT|SIN|COS|TAN|ASIN|ACOS|ATAN|EXP|LN|EXISTS)\\b)' +
    '|(?<relop>\\b(?:EQ|NE|LT|GT|LE|GE|AND|OR|XOR|MOD)\\b)'               + // relational / logical
    '|(?<system>\\$[A-Za-z0-9\/=]+)'                                     + // $system
    '|(?<gcode>\\bG\\d+(?:\\.\\d+)?)'                                   + // G0 G1 G2 …
    '|(?<mcode>\\bM\\d+(?:\\.\\d+)?)'                                   + // M3 M5 …
    '|(?<tcode>T(?:\\d+|(?=[\\[#])))'                                    + // T1 or T[expr]
    '|(?<scode>S(?:\\d+(?:\\.\\d+)?|(?=[\\[#])))'                       + // S1000 or S[expr]
    '|(?<xaxis>X(?:[-+]?\\d+(?:\\.\\d+)?|(?=[\\[#])))'                  + // X or X[expr]
    '|(?<yaxis>Y(?:[-+]?\\d+(?:\\.\\d+)?|(?=[\\[#])))'                  +
    '|(?<zaxis>Z(?:[-+]?\\d+(?:\\.\\d+)?|(?=[\\[#])))'                  +
    '|(?<coord>[ABCIJK](?:[-+]?\\d+(?:\\.\\d+)?|(?=[\\[#])))'           +
    '|(?<fcode>F(?:\\d+(?:\\.\\d+)?|(?=[\\[#])))'                       + // F600 or F[expr]
    '|(?<bracket>[\\[\\]])'                                              + // [ ]
    '|(?<number>[-+]?\\d+(?:\\.\\d+)?)',                                // bare numeric value
    'gi'
);

const _EXP_TOKEN_CLS = {
    pcomment: 'gcode-comment',  scomment: 'gcode-comment',
    variable: 'gcode-variable', keyword:  'gcode-keyword',
    oword:    'gcode-oword',    func:     'gcode-function',
    relop:    'gcode-operator', system:   'gcode-system',
    gcode:    'gcode-g-code',   mcode:    'gcode-m-code',
    tcode:    'gcode-t-code',   scode:    'gcode-s-code',
    xaxis:    'gcode-x-axis',   yaxis:    'gcode-y-axis',
    zaxis:    'gcode-z-axis',   coord:    'gcode-coordinate',
    fcode:    'gcode-f-code',   bracket:  'gcode-bracket',
    number:   'gcode-number',
};

function _expanderEscapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Syntax-highlight one line of parametric G-code.
 * Uses a single-pass tokeniser so tokens never overlap or double-highlight.
 * @param {string} lineText
 * @returns {string} HTML
 */
function highlightParametricGCodeLine(lineText) {
    let result = '', lastIdx = 0;
    for (const m of lineText.matchAll(_EXP_TOKEN_RE)) {
        if (m.index > lastIdx) result += _expanderEscapeHtml(lineText.slice(lastIdx, m.index));
        const g = m.groups, raw = _expanderEscapeHtml(m[0]);
        let cls = '';
        for (const k in g) { if (g[k] !== undefined) { cls = _EXP_TOKEN_CLS[k] || ''; break; } }
        result += cls ? '<span class="' + cls + '">' + raw + '</span>' : raw;
        lastIdx = m.index + m[0].length;
    }
    if (lastIdx < lineText.length) result += _expanderEscapeHtml(lineText.slice(lastIdx));
    return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the numeric settings from a FluidNC config.yaml, keyed the way G-code
 * refers to them: axes: x: max_travel_mm: 300  ->  #</axes/x/max_travel_mm> = 300.
 * Handles the YAML subset FluidNC uses (nested keys, scalars, comments).
 * Booleans become 1 / 0; non-numeric values such as pin names are skipped.
 * @param {string} text - config.yaml contents
 * @param {string} [source='config.yaml'] - name used in "not set in ..." messages
 * @returns {{ values: Object<string, number>, source: string, count: number }}
 */
function parseFluidNCConfig(text, source) {
    const values = {};
    const stack = [];  // { indent, key } for the mappings enclosing the current line
    let count = 0;

    for (const raw of text.split(/\r?\n/)) {
        // Strip a comment: # at the start or after whitespace, outside quotes
        let line = '', quote = null;
        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            if (quote) { if (c === quote) quote = null; }
            else if (c === '"' || c === "'") quote = c;
            else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) break;
            line += c;
        }
        if (!line.trim() || /^\s*-/.test(line)) continue;  // blank lines and list items

        const m = line.match(/^(\s*)([^:]+?)\s*:(?:\s+(.*?))?\s*$/);
        if (!m) continue;
        const indent = m[1].replace(/\t/g, '    ').length;
        const key = m[2].trim().replace(/^["']|["']$/g, '').toLowerCase();
        const value = m[3];

        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        if (value === undefined || value === '') {
            stack.push({ indent, key });  // a nested mapping follows
            continue;
        }

        const scalar = value.replace(/^["']|["']$/g, '');
        let n = null;
        if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(scalar)) n = parseFloat(scalar);
        else if (/^(?:true|yes|on)$/i.test(scalar)) n = 1;
        else if (/^(?:false|no|off)$/i.test(scalar)) n = 0;
        if (n === null) continue;

        values['/' + stack.map(s => s.key).concat(key).join('/')] = n;
        count++;
    }
    return { values, source: source || 'config.yaml', count };
}

/**
 * True if the text uses parameters or O-word control flow.
 * @param {string} text
 * @returns {boolean}
 */
function isParametricGCode(text) {
    return _RE_EXP_PARAMETRIC.test(text);
}

/**
 * Expand parametric G-code source lines into plain G-code.
 * @param {string[]} sourceLines
 * @param {string}   [filename]
 * @param {Object}   [options]
 * @param {boolean}  [options.keepComments=false] - Pass comments through to the output
 * @param {Object}   [options.machineValues] - Machine values from parseFluidNCConfig()
 * @param {Object}   [options.inputs] - User-entered values for parameters set outside the file
 * @returns {{ output: string, lineCount: number, warnings: string[], sourceMap: Array<number|null>,
 *             external: Array<{key: string, display: string, known: boolean}> }}
 *   sourceMap[n] is the 1-based source line that produced output line n + 1 (null for header lines).
 *   external lists the parameters the file reads that are set outside it (globals such as
 *   #<_tool_radius>, config values, numbered parameters); known is false for those that had
 *   no value from the file, machineValues or inputs.
 */
function expandLines(sourceLines, filename, options) {
    filename = filename || 'input';
    const expander = new GCodeExpander(options);
    expander.run(sourceLines);
    const header = [
        '; Expanded from: ' + filename,
        '; Generated by GCode Expander (cnc-gcode-tools)',
        '',
    ];
    const output = header.concat(expander.outputLines).join('\n') + '\n';
    const sourceMap = header.map(() => null).concat(expander.sourceLines);
    const vars = expander.variables, inputs = vars[_EXP_INPUTS];
    const external = [...vars[_EXP_EXTERNAL]].map(([key, display]) => ({
        key, display, known: key in vars || !!(inputs && key in inputs)
    }));
    return { output, lineCount: expander.outputLines.length, warnings: expander.warnings, sourceMap, external };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { expandLines, isParametricGCode, highlightParametricGCodeLine, parseFluidNCConfig };
}
