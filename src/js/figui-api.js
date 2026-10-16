/**
 * FigUI plugin bridge (FigUI: a web UI for FluidNC, github.com/figamore/FigUI).
 *
 * A FigUI plugin runs in a sandboxed iframe and reaches the machine with postMessage
 * requests ({ type: 'fluid-request', id, method, params }), answered with
 * 'fluid-response'; subscribed events arrive as 'fluid-event' (see FigUI's
 * plugins/PLUGIN_GUIDE.md). FigUIAPI wraps that with the methods FluidNCController uses
 * (the same as FluidNCAPI's), so the WebUI extension's features work in FigUI too.
 *
 * SD card paths here are relative to the card ("/jobs/part.nc"); FigUI's own open and
 * run paths start with /sd.
 */

class FigUIBridge {
    constructor() {
        this.nextId = 0;
        this.pending = new Map();
        this.eventHandlers = new Map();
        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'fluid-response') {
                const p = this.pending.get(msg.id);
                if (!p) return;
                this.pending.delete(msg.id);
                if (msg.error) p.reject(new Error(msg.error));
                else p.resolve(msg.result);
            } else if (msg.type === 'fluid-event') {
                (this.eventHandlers.get(msg.event) || []).forEach(fn => fn(msg.data));
            } else if (msg.type === 'fluid-theme' && this.onTheme) {
                // FigUI sets the new theme variables itself; this is the cue to follow them
                requestAnimationFrame(() => this.onTheme());
            }
        });
    }

    /**
     * Call a FigUI plugin API method. Rejects with FigUI's error, or after timeoutMs.
     */
    call(method, params = {}, timeoutMs = 20000) {
        return new Promise((resolve, reject) => {
            const id = String(++this.nextId);
            this.pending.set(id, { resolve, reject });
            window.parent.postMessage({ type: 'fluid-request', id, method, params }, '*');
            setTimeout(() => {
                if (this.pending.delete(id)) reject(new Error(`FigUI ${method} timed out`));
            }, timeoutMs);
        });
    }

    async subscribe(event, handler) {
        if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
        this.eventHandlers.get(event).push(handler);
        await this.call('subscribe', { event });
    }
}

class FigUIAPI {
    constructor(bridge) {
        this.bridge = bridge;
        this.isInIframe = window !== window.parent;
        this.streamHandlers = [];
        this.machineSettings = null;
        // Raw lines from the controller, status reports included: FluidNCController
        // reads the state, position and SD progress from them
        bridge.subscribe('line', (line) => {
            if (typeof line === 'string') this.streamHandlers.forEach(fn => fn(line));
        }).catch(e => console.warn('[FigUI] No line events:', e));
    }

    on(type, callback) {
        if (type === 'stream') this.streamHandlers.push(callback);
    }

    off(type, callback) {
        if (type === 'stream') this.streamHandlers = this.streamHandlers.filter(fn => fn !== callback);
    }

    sdPath(path) {
        return '/sd' + (path.startsWith('/') ? path : '/' + path);
    }

    async listSDFiles(path = '/') {
        const result = await this.bridge.call('listFiles', { path, fs: 'sd' });
        const base = path.endsWith('/') ? path : path + '/';
        return (result && result.files || []).map(f => f.isDir
            ? { type: 'dir', name: f.name, path: base + f.name }
            : { type: 'file', name: f.name, size: f.size, path: base + f.name });
    }

    async readSDFile(path, onProgress = null) {
        if (onProgress) onProgress(10);
        // A large file: allow for a slow card
        const text = await this.bridge.call('readFile', { path, fs: 'sd' }, 180000);
        if (onProgress) onProgress(100);
        return text;
    }

    /**
     * Open a file in FigUI's own G-code viewer (where it's run from)
     */
    openInHost(path) {
        return this.bridge.call('openFile', { path: this.sdPath(path) });
    }

    runSDFile(path) {
        return this.bridge.call('sendCommand', { command: `$SD/Run=${path}` });
    }

    /**
     * Feed hold (!) and cycle start (~) are realtime bytes; anything else is a line
     */
    sendCommandNoWait(command) {
        if (command === '!' || command === '~' || command === '?') {
            this.bridge.call('sendRealtime', { byte: command.charCodeAt(0) }).catch(e => console.warn(e));
        } else {
            this.bridge.call('sendCommand', { command }).catch(e => console.warn(e));
        }
    }

    async query(command, parseLine) {
        try {
            const text = await this.bridge.call('sendQuery', { command }, 5000);
            for (const raw of String(text || '').split(/\r?\n/)) {
                const value = parseLine(raw.trim());
                if (value !== undefined) return { value, timedOut: false };
            }
            return { value: null, timedOut: false };
        } catch (e) {
            return { value: null, timedOut: /timed out/i.test(e.message) };
        }
    }

    readSetting(path) {
        const command = '$' + path;
        return this.query(command, (line) =>
            line.startsWith(command + '=') ? line.slice(command.length + 1).trim() : undefined);
    }

    queryParameter(ref) {
        return this.query('D' + ref, (line) => {
            const m = line.match(/\[MSG:INFO: Value is ([^\]]+)\]/i);
            return m ? parseFloat(m[1]) : undefined;
        });
    }

    async settings() {
        if (!this.machineSettings) {
            try {
                this.machineSettings = await this.bridge.call('getMachineSettings') || {};
            } catch (e) {
                this.machineSettings = {};
            }
        }
        return this.machineSettings;
    }

    async getMaxTravelX() {
        return (await this.settings()).maxTravelX || 300;
    }

    async getMaxTravelY() {
        return (await this.settings()).maxTravelY || 300;
    }

    async getMotionParameters() {
        const s = await this.settings();
        return {
            accelX: s.accelX || 200, accelY: s.accelY || 200, accelZ: s.accelZ || 80,
            maxRateX: s.maxRateX || 3000, maxRateY: s.maxRateY || 3000, maxRateZ: s.maxRateZ || 2000
        };
    }
}

/**
 * Viewer preferences kept on the device with the plugin's getSettings / saveSettings
 * (the iframe has no localStorage). Writes are batched.
 */
class FigUISettingsStore {
    constructor(bridge, initial) {
        this.bridge = bridge;
        this.values = initial && typeof initial === 'object' ? { ...initial } : {};
        this.timer = null;
    }

    get(key) {
        return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
    }

    set(key, value) {
        if (this.values[key] === value) return;
        this.values[key] = value;
        this.save();
    }

    remove(key) {
        if (!(key in this.values)) return;
        delete this.values[key];
        this.save();
    }

    save() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.bridge.call('saveSettings', { data: this.values }).catch(e => console.warn('[FigUI] Settings not saved:', e));
        }, 1000);
    }
}
