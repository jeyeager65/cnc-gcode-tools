# Record a video of the viewer

Records the standalone viewer (`src/gcodeviewer.html`) animating a G-code file to an MP4.
The page runs on a virtual clock and is captured frame by frame, so the video is smooth
however slowly the page renders.

## Setup (once)

Needs Node and `ffmpeg` on the PATH.

```sh
cd tools/record-video
npm install
npx playwright install chromium
```

## Run

```sh
node record.mjs path/to/file.nc
```

The defaults are 1920x1080 at 30 fps, dark theme, 3D view and the machined stock shown,
with 90 s of machining. Each M0 prompt stays up for 2 s, then Resume is clicked. The MP4
is written next to the G-code file. `node record.mjs --help` lists the options, e.g.:

```sh
node record.mjs part.nc --duration 60 --m0-hold 3 --fps 60 --out demo.mp4
node record.mjs part.nc --theme light --view 2d --no-stock --speed 20
```
