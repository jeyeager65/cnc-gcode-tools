/**
 * The viewer as a FigUI plugin: FluidNCController's SD card browser and job following,
 * through the FigUI plugin bridge (figui-api.js).
 *
 * Differences from the WebUI extension: files are run from FigUI ("Open in FigUI" loads
 * the selected file in FigUI's own viewer), the theme follows FigUI's, settings are kept
 * on the device, and the last previewed file is read again from the SD card when the
 * plugin opens (the iframe has no IndexedDB).
 */

class FigUIController extends FluidNCController {
    setupFluidNCListeners() {
        super.setupFluidNCListeners();
        const open = document.getElementById('btn-open-host');
        if (open) {
            open.addEventListener('click', async () => {
                if (!this.selectedFile) return;
                try {
                    await this.fluidAPI.openInHost(this.selectedFile.path);
                } catch (e) {
                    alert('FigUI could not open the file: ' + e.message);
                }
            });
        }
    }

    /**
     * The sandbox can't download files: the expanded copy goes next to the original on
     * the SD card instead (part.nc -> part.expanded.nc), ready to run from FigUI
     */
    async saveExpanded() {
        const file = this.expandedFile();
        const button = document.getElementById('btn-download-expanded');
        if (!file || !this.currentFilePath || !button) return;
        const folder = this.currentFilePath.slice(0, this.currentFilePath.lastIndexOf('/') + 1) || '/';
        const label = button.textContent;
        button.disabled = true;
        try {
            await this.fluidAPI.writeSDFile(folder + file.name, file.text);
            button.textContent = `Saved as ${file.name}`;
            if (this.currentPath === folder.replace(/\/$/, '') || (folder === '/' && this.currentPath === '/')) {
                this.loadSDFiles(this.currentPath);
            }
        } catch (e) {
            button.textContent = 'Couldn\'t save: ' + e.message;
        }
        setTimeout(() => {
            button.textContent = label;
            button.disabled = false;
        }, 3000);
    }

    // Preview a running file again from the card: no local cache in the plugin's iframe
    async cacheFile() { }

    async getCachedFile(filePath) {
        try {
            return { content: await this.fluidAPI.readSDFile(filePath) };
        } catch (e) {
            return null;
        }
    }
}

/**
 * FigUI's colors as the viewer's: the plugin page gets FigUI's theme variables
 * (--bg, --surface, --accent, ...), and data-theme follows how dark its background is,
 * for the toolpath and grid colors drawn in the views
 */
function applyFigUITheme(controller) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    let dark = true;
    const probe = document.createElement('span');
    probe.style.color = bg || '#000';
    document.body.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/(\d+(?:\.\d+)?)/g);
    probe.remove();
    if (m && m.length >= 3) {
        const [r, g, b] = m.map(Number);
        dark = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
    }
    const theme = dark ? 'dark' : 'light';
    if (controller && controller.setTheme) controller.setTheme(theme, false);
    else document.documentElement.setAttribute('data-theme', theme);
}

window.addEventListener('DOMContentLoaded', async () => {
    if (document.body.dataset.host !== 'figui') return;
    const bridge = new FigUIBridge();
    // Settings first: the layout's folded sections and the view options come from them
    let saved = {};
    try {
        saved = await bridge.call('getSettings', {}, 4000) || {};
    } catch (e) {
        console.warn('[FigUI] No saved settings:', e);
    }
    Prefs.useBackend(new FigUISettingsStore(bridge, saved));
    ViewerUI.restoreSections();
    ViewerUI.applyCodeVisibility();
    applyFigUITheme(null);
    const controller = new FigUIController(new FigUIAPI(bridge));
    applyFigUITheme(controller);
    bridge.onTheme = () => applyFigUITheme(controller);
});
