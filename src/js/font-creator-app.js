// Font Creator Application Initialization
// Handles tab switching, preview controller setup, and GCode loading

// Global instances
let fontCreatorController;
let previewController;

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    // Restore theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    // Initialize font creator controller
    fontCreatorController = new FontCreatorController();
    fontCreatorController.setupCanvas();
    fontCreatorController.setupCharacterSet();
    fontCreatorController.setupFontCreatorControls();
    fontCreatorController.setupTextToGCodeControls();
    fontCreatorController.loadFromLocalStorage();
    fontCreatorController.render();
    
    // Initialize preview controller
    // Wait until elements are available
    setTimeout(() => {
        previewController = new Controller();
        
        // Setup download button (Controller doesn't handle this)
        const downloadBtn = document.getElementById('download-gcode');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                if (fontCreatorController && fontCreatorController.downloadGCode) {
                    fontCreatorController.downloadGCode();
                }
            });
        }
    }, 100);
    
    // Theme toggle button
    document.getElementById('theme-toggle').onclick = () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        html.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
        localStorage.setItem('theme', html.getAttribute('data-theme'));
        fontCreatorController.render();
        if (previewController && previewController.is3DView) {
            previewController.renderer3d.render();
        } else if (previewController) {
            previewController.renderer2d.render();
        }
    };
});

// Tab switching functionality
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const targetTab = button.dataset.tab;
        
        // Update buttons
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // Update content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(targetTab).classList.add('active');
        
        // If switching to preview tab, load generated GCode
        if (targetTab === 'gcode-preview' && fontCreatorController && fontCreatorController.generatedGCode) {
            setTimeout(() => {
                loadGCodeIntoPreview(fontCreatorController.generatedGCode);
            }, 50);
        }
    });
});

// Helper function to load GCode into preview controller
async function loadGCodeIntoPreview(gcodeString) {
    if (!gcodeString || !previewController) return;
    
    try {
        // Load GCode string into preview controller
        await previewController.loadGCodeFromString(gcodeString);
        
    } catch (error) {
        console.error('Error loading GCode into preview:', error);
    }
}
