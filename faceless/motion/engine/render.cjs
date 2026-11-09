#!/usr/bin/env node
/* Headless render engine.
 *   1. a page paints any frame from a timestamp   (Studio.renderFrame(t) in the composition)
 *   2. a Playwright loop captures every frame in Chromium
 *   3. ffmpeg stitches the frames and the synthesized soundtrack into an MP4
 *
 * Usage: node motion-studio/engine/render.cjs <composition-folder> [--out name] [--preview] [--from s] [--to s] [--frames-only]
 *   --preview       half-size frames (540x960) for a fast look
 *   --from/--to     render only part of the timeline (seconds)
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const compDir = path.resolve(args[0] || '');
if (!args[0] || !fs.existsSync(path.join(compDir, 'index.html'))) {
  console.error('Usage: node render.cjs <composition-folder> [--out name] [--preview] [--from s] [--to s]');
  process.exit(1);
}
const STUDIO = path.resolve(__dirname, '..');
const ROOT = path.resolve(STUDIO, '..');          // repo root: compositions can use the business's real assets
const name = opt('out', path.basename(compDir));
const preview = !!opt('preview', false);
const outDir = path.join(STUDIO, 'out', name);
const frameDir = path.join(outDir, 'frames');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

const keep = !!opt('keep', false);   // re-render only --from/--to, keep the other frames, then stitch the whole piece

(async () => {
  if (!keep) fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: preview ? 0.5 : 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const rel = path.relative(ROOT, compDir).split(path.sep).join('/');
  await page.goto(`http://127.0.0.1:${port}/${rel}/index.html`);
  await page.waitForFunction(() => window.Studio && window.Studio.isReady(), null, { timeout: 60000 });
  const meta = await page.evaluate(() => window.Studio.meta());
  if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); process.exit(1); }

  const fps = meta.fps;
  const from = Math.round(Number(opt('from', 0)) * fps);
  const to = Math.min(Math.round(Number(opt('to', meta.duration)) * fps), Math.round(meta.duration * fps));
  const t0 = Date.now();
  for (let i = from; i < to; i++) {
    await page.evaluate(t => window.Studio.renderFrame(t), i / fps);
    await page.screenshot({ path: path.join(frameDir, `f_${String(i).padStart(5, '0')}.png`), type: 'png' });
    if ((i - from) % 60 === 0) process.stdout.write(`frame ${i}/${to}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  if (errors.length) { console.error('Page errors while rendering:\n' + errors.join('\n')); process.exit(1); }
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(Object.assign(meta, { rendered: { from, to, preview } }), null, 1));

  if (opt('frames-only', false)) { await browser.close(); srv.close(); return console.log('frames done'); }

  const wav = path.join(outDir, 'audio.wav');
  fs.writeFileSync(wav, Buffer.from(await page.evaluate(() => window.Studio.renderAudio()), 'base64'));
  await browser.close(); srv.close();

  const mp4 = path.join(outDir, `${name}${preview ? '_preview' : ''}.mp4`);
  const first = keep ? 0 : from;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-start_number', String(first),
    '-i', path.join(frameDir, 'f_%05d.png'), '-ss', String(first / fps), '-i', wav,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  console.log(`done ${mp4}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
})().catch(e => { console.error(e); process.exit(1); });
