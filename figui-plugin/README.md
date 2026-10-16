# G-code Simulator for FigUI

A [FigUI](https://github.com/figamore/FigUI) plugin built from the CNC GCode Tools viewer. It opens in FigUI's workspace (the DRO and jog controls stay on the left; full screen on tablets and phones) and adds what FigUI's own viewer doesn't have:

- **Stock simulation**: the part as a 3D solid, carved with each tool's shape as the animation plays, from `(Stock: …)` / `(ToolDef N: …)` header comments or sizes entered in the panel, with earlier jobs (`PriorJob`) carved first
- **Parametric G-code**: FluidNC expressions, loops and conditionals expanded, with machine values read from the controller
- **Playback** in real time with `(MSG, …)` messages, `M0` stops and simulated probing
- **Following the running job**: when FigUI runs the file being previewed, the view follows it from the machine's status reports, with progress, time left and the time to the next `M0`

Pick a file from the SD card, then **Preview** it here or **Open in FigUI** to run it from FigUI. The theme follows FigUI's.

## Install

Build the repo (`build.ps1`); the plugin is in `dist/figui-plugin/`: `plugin.json`, `index.html` (everything inlined) and `icon.png`.

- In FigUI: **Plugins** tab → **Add** → choose the `figui-plugin` folder, or
- Copy the folder to `/sd/plugins/` on the SD card and refresh the Plugins tab.

Settings (view options, folded sections, the last file previewed) are saved on the device with the plugin.

## Source

`src/gcodeviewer-figui.html` with `src/js/figui-api.js` (the plugin bridge) and `src/js/figui-controller.js`; the rest is shared with the standalone viewer and the FluidNC WebUI extension.
