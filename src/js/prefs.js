/**
 * Viewer preferences (theme, panel states, options), kept in localStorage.
 *
 * Every read and write is guarded: storage can be missing or throw (private windows,
 * blocked site data, or a sandboxed iframe such as a FigUI plugin, where localStorage
 * throws). Values then live in memory for the session. A host can supply its own
 * store with Prefs.useBackend({ get, set, remove }) - FigUI keeps them on the device.
 */
const Prefs = {
    memory: new Map(),
    backend: null,

    useBackend(backend) {
        this.backend = backend;
    },

    get(key, fallback = null) {
        try {
            const value = this.backend ? this.backend.get(key) : localStorage.getItem(key);
            if (value !== null && value !== undefined) return value;
        } catch (e) {
            if (this.memory.has(key)) return this.memory.get(key);
        }
        return this.memory.has(key) ? this.memory.get(key) : fallback;
    },

    set(key, value) {
        const text = String(value);
        this.memory.set(key, text);
        try {
            if (this.backend) this.backend.set(key, text);
            else localStorage.setItem(key, text);
        } catch (e) { /* storage unavailable: kept in memory */ }
    },

    remove(key) {
        this.memory.delete(key);
        try {
            if (this.backend) this.backend.remove(key);
            else localStorage.removeItem(key);
        } catch (e) { /* storage unavailable */ }
    },

    getBool(key, fallback) {
        const value = this.get(key);
        return value === null ? fallback : value === 'true';
    },

    getJSON(key, fallback = null) {
        const value = this.get(key);
        if (value === null) return fallback;
        try { return JSON.parse(value); } catch (e) { return fallback; }
    },

    setJSON(key, value) {
        this.set(key, JSON.stringify(value));
    }
};
