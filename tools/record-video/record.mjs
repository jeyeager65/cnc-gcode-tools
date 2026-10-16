#!/usr/bin/env node
/**
 * Records the standalone viewer (src/gcodeviewer.html) animating a G-code file to an MP4.
 *
 * The page runs on a virtual clock: requestAnimationFrame and performance.now are replaced,
 * and each video frame advances time by exactly 1/fps, runs the page's frame callbacks and
 * takes a screenshot that is piped to ffmpeg. The video plays smoothly however slowly the
 * page renders (WebGL, stock simulation) and is the same from run to run.
 *
 * Usage:  node record.mjs <file.nc> [options]      (see --help)
 * Needs:  ffmpeg on PATH; `npm install` and `npx playwright install chromium` in this folder
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

const defaults = {
    out: null,              // default: <file>.mp4 next to the G-code
    width: 1920,
    height: 1080,
    fps: 30,
    theme: 'dark',          // dark | light
    view: '3d',             // 3d | 2d
    stock: true,            // show the machined stock (needs stock/tool metadata in the file)
    duration: 90,           // seconds of machining in the video (M0 holds and lead-in/out extra)
    speed: null,            // playback speed (x real time); overrides --duration
    m0Hold: 2,              // seconds an M0 prompt stays up before Resume is clicked
    leadIn: 1.5,            // seconds before Play
    leadOut: 3,             // seconds after the animation ends
    crf: 18,
    headed: false,
};

const help = `Usage: node record.mjs <file.nc> [options]

  --out <file.mp4>     Output file (default: next to the G-code, same name, .mp4)
  --size <WxH>         Viewport size (default ${defaults.width}x${defaults.height})
  --fps <n>            Frame rate (default ${defaults.fps})
  --theme <dark|light> (default ${defaults.theme})
  --view <3d|2d>       (default ${defaults.view})
  --no-stock           Don't show the machined stock
  --duration <s>       Seconds of machining in the video; sets the speed (default ${defaults.duration})
  --speed <x>          Playback speed as a multiple of real time (overrides --duration)
  --m0-hold <s>        Seconds each M0 prompt shows before auto-resume (default ${defaults.m0Hold})
  --lead-in <s>        Seconds before playback starts (default ${defaults.leadIn})
  --lead-out <s>       Seconds held on the finished result (default ${defaults.leadOut})
  --crf <n>            x264 quality, lower is better (default ${defaults.crf})
  --headed             Show the browser window while recording
`;

function parseArgs(argv) {
    const o = { ...defaults, file: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const val = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        switch (a) {
            case '-h': case '--help': console.log(help); process.exit(0);
            case '--out': o.out = val(); break;
            case '--size': {
                const m = /^(\d+)x(\d+)$/i.exec(val());
                if (!m) throw new Error('--size must look like 1920x1080');
                o.width = +m[1]; o.height = +m[2];
                break;
            }
            case '--fps': o.fps = +val(); break;
            case '--theme': o.theme = val(); break;
            case '--view': o.view = val(); break;
            case '--no-stock': o.stock = false; break;
            case '--duration': o.duration = +val(); break;
            case '--speed': o.speed = +val(); break;
            case '--m0-hold': o.m0Hold = +val(); break;
            case '--lead-in': o.leadIn = +val(); break;
            case '--lead-out': o.leadOut = +val(); break;
            case '--crf': o.crf = +val(); break;
            case '--headed': o.headed = true; break;
            default:
                if (a.startsWith('-') || o.file) throw new Error(`Unexpected argument: ${a}`);
                o.file = a;
        }
    }
    if (!o.file) throw new Error('No G-code file given');
    o.file = path.resolve(o.file);
    if (!existsSync(o.file)) throw new Error(`Not found: ${o.file}`);
    if (!o.out) o.out = o.file.replace(/\.[^.\\/]+$/, '') + '.mp4';
    o.out = path.resolve(o.out);
    if (!['dark', 'light'].includes(o.theme)) throw new Error('--theme must be dark or light');
    if (!['3d', '2d'].includes(o.view)) throw new Error('--view must be 3d or 2d');
    return o;
}

/** Runs in the page before its scripts: the virtual clock and saved viewer settings */
function pageSetup({ theme, stock }) {
    let now = 0;
    let queue = [];
    let nextId = 1;
    performance.now = () => now;
    window.requestAnimationFrame = (cb) => { const id = nextId++; queue.push({ id, cb }); return id; };
    window.cancelAnimationFrame = (id) => { queue = queue.filter(q => q.id !== id); };
    window.__advance = (ms) => {
        now += ms;
        const run = queue;
        queue = [];
        for (const { cb } of run) {
            try { cb(now); } catch (e) { console.error(e); }
        }
    };
    try {
        localStorage.setItem('theme', theme);
        localStorage.setItem('stockSimVisible', String(stock));
        localStorage.setItem('simShowMessages', 'true');
        localStorage.setItem('simPauseAtM0', 'true');
        localStorage.setItem('simProbeCloseUp', 'true');
    } catch (e) { /* storage unavailable */ }
}

function gitVersion() {
    try {
        return execSync('git describe --tags --abbrev=0', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim() || 'dev';
    } catch (e) {
        return 'dev';
    }
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    const frameMs = 1000 / o.fps;
    const pageUrl = pathToFileURL(path.join(repo, 'src', 'gcodeviewer.html')).href;

    const browser = await chromium.launch({
        headless: !o.headed,
        // Hardware WebGL where available; falls back to SwiftShader
        args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    });
    const context = await browser.newContext({
        viewport: { width: o.width, height: o.height },
        deviceScaleFactor: 1,
        colorScheme: o.theme,
    });
    const page = await context.newPage();
    page.on('pageerror', e => console.error('[page error]', e.message));
    page.on('dialog', d => { console.error('[page dialog]', d.message()); d.dismiss(); });
    await context.addInitScript(pageSetup, { theme: o.theme, stock: o.stock });

    await page.goto(pageUrl);
    const advance = (n = 1) => page.evaluate(([n, ms]) => { for (let i = 0; i < n; i++) window.__advance(ms); }, [n, frameMs]);

    // Keep a handle on the controller (it isn't stored globally)
    await page.evaluate((version) => {
        const load = Controller.prototype.loadFile;
        Controller.prototype.loadFile = function (file) { window.__ctl = this; return load.call(this, file); };
        document.title = document.title.replace('{{VERSION}}', version);
        document.querySelectorAll('footer div').forEach(d => { d.textContent = d.textContent.replace('{{VERSION}}', version); });
    }, gitVersion());

    console.log(`Loading ${o.file}`);
    await page.setInputFiles('#file-input', o.file);
    await page.waitForFunction(() => window.__ctl && window.__ctl.animator.segments.length > 0, null, { timeout: 120000 });
    // Let the progress bar (a real 500 ms timeout) go away and the stock build
    await page.waitForTimeout(800);
    await advance(10);

    const info = await page.evaluate(({ view, stock }) => {
        const c = window.__ctl;
        if (c.stockVisible !== stock) {
            const box = document.getElementById('stock-visible');
            if (box) box.click();
        }
        if (c.currentView !== view) c.toggleView();
        const a = c.animator;
        return {
            segments: a.segments.length,
            seconds: a.totalAnimTime > 0 ? a.totalAnimTime : a.estimatedTotalTime,
            m0s: (c.simPauses || []).length,
            stockShown: !!c.stockVisible,
            view: c.currentView,
        };
    }, { view: o.view, stock: o.stock });

    const speed = o.speed || Math.max(0.1, info.seconds / o.duration);
    const machining = info.seconds / speed;
    const estimate = o.leadIn + machining + info.m0s * o.m0Hold + o.leadOut;
    console.log(`${info.segments} segments, ${(info.seconds / 60).toFixed(1)} min estimated run time, ${info.m0s} M0 pauses`);
    console.log(`View ${info.view}, stock ${info.stockShown ? 'shown' : 'hidden'}, speed ${speed.toFixed(1)}x, ` +
        `about ${estimate.toFixed(0)} s of video (${Math.round(estimate * o.fps)} frames)`);

    // Set the speed directly: the slider stops at 500x. Show it on the label like the slider does.
    await page.evaluate((speed) => {
        const a = window.__ctl.animator;
        a.speed = speed;
        const label = document.getElementById('speed-label');
        if (label) label.textContent = (speed >= 10 ? speed.toFixed(0) : speed.toFixed(1)) + 'x';
    }, speed);
    await advance(Math.round(o.fps)); // settle the camera after the view change

    const ffmpeg = spawn('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'png', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf), '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', o.out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const ffmpegDone = new Promise((resolve, reject) => {
        ffmpeg.on('error', reject);
        ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)));
    });

    const cdp = await context.newCDPSession(page);
    let frames = 0;
    const capture = async () => {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
        const buf = Buffer.from(data, 'base64');
        if (!ffmpeg.stdin.write(buf)) await new Promise(r => ffmpeg.stdin.once('drain', r));
        frames++;
    };
    const step = async () => { await advance(1); await capture(); };
    const started = Date.now();
    const progress = (label) => {
        const secs = (Date.now() - started) / 1000;
        process.stdout.write(`\r${label} ${frames} frames (${(frames / o.fps).toFixed(1)} s video) in ${secs.toFixed(0)} s   `);
    };

    for (let i = 0; i < Math.round(o.leadIn * o.fps); i++) await step();
    await page.click('#btn-play');

    // Play until done, holding each M0 prompt for m0Hold seconds before clicking Resume
    let held = 0;
    const holdFrames = Math.round(o.m0Hold * o.fps);
    const maxFrames = Math.round((estimate + 60) * o.fps);
    for (;;) {
        await step();
        const s = await page.evaluate(() => {
            const c = window.__ctl;
            const prompt = document.querySelector('.sim-prompt');
            return {
                playing: c.animator.getIsPlaying(),
                prompt: !!prompt && !prompt.classList.contains('hidden'),
                done: c.animator.currentIndex >= c.animator.segments.length,
            };
        });
        if (s.prompt) {
            if (++held >= holdFrames) {
                held = 0;
                await page.click('.sim-prompt button');
            }
        } else {
            held = 0;
            if (!s.playing && s.done) break;
            if (!s.playing) await page.click('#btn-play'); // stopped by something else: carry on
        }
        if (frames % o.fps === 0) progress('Recording');
        if (frames > maxFrames) { console.warn('\nStopping: ran well past the expected length'); break; }
    }

    for (let i = 0; i < Math.round(o.leadOut * o.fps); i++) await step();
    progress('Recorded');
    console.log();

    ffmpeg.stdin.end();
    await ffmpegDone;
    await browser.close();
    console.log(`Wrote ${o.out}`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
