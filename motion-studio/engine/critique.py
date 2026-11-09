#!/usr/bin/env python3
"""Self-critique: watch every rendered frame and grade each scene.

Usage: python3 motion-studio/engine/critique.py <composition-folder> [--out name]

A frame is dead if nothing on screen moves. Each scene is scored out of 10:
  - dead frames and long frozen stretches cost points
  - every cut and every hit must sit on the beat grid (off-grid costs points)
  - hard stops (motion that slams to zero instead of settling like a spring) cost points
  - banned basic CSS motion (transitions, keyframes, easing) fails the whole piece
Writes report.json, report.png (motion per frame, like a seismograph) and a contact sheet per scene.
Re-render until every scene is 8/10 or better.
"""
import json, re, sys, glob, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

DEAD = 0.10        # mean absolute pixel change (0-255) below which a frame counts as dead
PASS = 8.0

args = sys.argv[1:]
if not args:
    sys.exit(__doc__)
comp = os.path.abspath(args[0])
name = args[args.index('--out') + 1] if '--out' in args else os.path.basename(comp)
studio = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
out = os.path.join(studio, 'out', name)
tl = json.load(open(os.path.join(out, 'timeline.json')))
fps, bpm = tl['fps'], tl['bpm']
beat = 60.0 / bpm

def font(size, bold=False):
    for f in (['/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'] if bold else []) + ['/usr/share/fonts/opentype/inter/Inter-Regular.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()

# ---------- 1. banned motion in the source ----------
banned = [(r'transition\s*:', 'CSS transition'), (r'animation\s*:', 'CSS animation'), (r'@keyframes', 'CSS keyframes'),
          (r'requestAnimationFrame', 'requestAnimationFrame'), (r'Math\.random', 'Math.random (not deterministic)'),
          (r'Date\.now|new Date', 'wall-clock time'), (r'\bease(-in|-out|-in-out)?\b', 'easing curve')]
violations = []
for f in glob.glob(os.path.join(comp, '*.html')) + glob.glob(os.path.join(comp, '*.js')) + glob.glob(os.path.join(comp, '*.css')):
    src = open(f, encoding='utf-8').read()
    for pat, what in banned:
        for m in re.finditer(pat, src):
            line = src.count('\n', 0, m.start()) + 1
            violations.append(f'{os.path.basename(f)}:{line} {what}')

# ---------- 2. watch every frame ----------
frames = sorted(glob.glob(os.path.join(out, 'frames', 'f_*.png')))
idx = [int(os.path.basename(f)[2:7]) for f in frames]
prev, motion = None, {}
for i, f in zip(idx, frames):
    g = np.asarray(Image.open(f).convert('L').resize((270, 480), Image.BILINEAR), dtype=np.float32)
    motion[i] = float(np.mean(np.abs(g - prev))) if prev is not None else None
    prev = g
first = idx[0]
motion[first] = motion.get(first + 1, 0.0) if motion.get(first) is None else motion[first]

def grid_off_ms(t, step):
    k = round(t / step)
    return abs(t - k * step) * 1000

scenes = []
for sc in tl['scenes']:
    a, b = round(sc['start'] * fps), round(sc['end'] * fps)
    fr = [i for i in range(a, b) if i in motion]
    if not fr:
        continue
    m = np.array([motion[i] for i in fr])
    dead = m < DEAD
    run = best = 0
    for d in dead:
        run = run + 1 if d else 0
        best = max(best, run)
    hard = 0
    for j in range(1, len(fr)):
        if fr[j] == a:
            continue
        if m[j - 1] > 3.0 and m[j] < 0.12 * m[j - 1]:
            hard += 1
    cut_off = grid_off_ms(sc['start'], beat)
    hits = [h for h in tl['hits'] if sc['start'] <= h['t'] < sc['end']]
    off = [h for h in hits if grid_off_ms(h['t'], beat / 4) > 1.0]
    live = 1.0 - float(dead.mean())
    score = 10.0
    score -= (1 - live) * 15                      # 10% dead frames = -1.5
    score -= max(0, best - 6) / 6                 # frozen longer than 0.2 s
    score -= min(2.0, 0.5 * hard)
    score -= 2.0 if (cut_off > 1.0 or off) else 0
    score = round(max(0.0, min(10.0, score)), 1)
    scenes.append(dict(name=sc['name'], start=sc['start'], end=sc['end'], frames=len(fr), live=round(live, 3),
                       dead_frames=int(dead.sum()), longest_freeze=best, hard_stops=hard, cut_offbeat_ms=round(cut_off, 2),
                       hits=len(hits), offgrid_hits=[h['name'] for h in off], mean_motion=round(float(m.mean()), 2),
                       score=score, passed=score >= PASS))

ok = not violations and all(s['passed'] for s in scenes)
report = dict(passed=ok, dead_threshold=DEAD, violations=violations, scenes=scenes,
              cuts=len(tl['scenes']), offbeat_cuts_ms=max([s['cut_offbeat_ms'] for s in scenes] or [0]))
json.dump(report, open(os.path.join(out, 'report.json'), 'w'), indent=1)

# ---------- 3. seismograph chart ----------
W, H, top, base = 1600, 560, 120, 440
img = Image.new('RGB', (W, H), (247, 245, 240))
d = ImageDraw.Draw(img)
d.text((40, 28), f'Watching all {len(frames)} frames. A frame is dead if nothing on screen moves.', fill=(30, 30, 30), font=font(26, True))
d.text((40, 66), f'{bpm} BPM · cuts on the beat: {"yes" if report["offbeat_cuts_ms"] <= 1 else "NO"} · banned CSS: {len(violations)}',
       fill=(90, 90, 90), font=font(20))
lo, hi = idx[0], idx[-1] + 1
xs = lambda i: 40 + (i - lo) * (W - 80) / max(1, hi - lo)
mx = max(1e-6, max(motion.values()))
for i in idx:
    v = motion[i]
    h = (np.log1p(v * 4) / np.log1p(mx * 4)) * (base - top - 30)
    sc = next((s for s in scenes if round(s['start'] * fps) <= i < round(s['end'] * fps)), None)
    col = (200, 70, 60) if v < DEAD else ((70, 150, 90) if (sc and sc['passed']) else (214, 120, 90))
    x = xs(i)
    d.rectangle([x, base - max(1, h), x + max(1, (W - 80) / (hi - lo) - 0.6), base], fill=col)
for s in scenes:
    x = xs(round(s['start'] * fps))
    d.line([x, top - 10, x, base + 8], fill=(160, 160, 160), width=1)
    badge = f"{s['score']:.0f}/10" if s['score'] == int(s['score']) else f"{s['score']}/10"
    col = (46, 125, 70) if s['passed'] else (190, 60, 50)
    d.rounded_rectangle([x + 6, top - 12, x + 92, top + 16], 8, fill=col)
    d.text((x + 14, top - 10), badge, fill=(255, 255, 255), font=font(20, True))
    d.text((x + 6, base + 14), s['name'], fill=(70, 70, 70), font=font(17))
d.text((40, H - 46), 'PASS' if ok else 'RE-RENDER: ' + '; '.join(
    [f"{s['name']} {s['score']}/10" for s in scenes if not s['passed']] + violations[:3]), fill=(46, 125, 70) if ok else (190, 60, 50), font=font(22, True))
img.save(os.path.join(out, 'report.png'))

# ---------- 4. contact sheets for the eye ----------
for s in scenes:
    a, b = round(s['start'] * fps), round(s['end'] * fps)
    pick = [i for i in np.linspace(a, b - 1, 12).round().astype(int) if i in motion]
    tw, th = 180, 320
    sheet = Image.new('RGB', (tw * 6, (th + 26) * 2), (20, 20, 20))
    sd = ImageDraw.Draw(sheet)
    for k, i in enumerate(pick):
        im = Image.open(os.path.join(out, 'frames', f'f_{i:05d}.png')).convert('RGB').resize((tw, th))
        x, y = (k % 6) * tw, (k // 6) * (th + 26)
        sheet.paste(im, (x, y))
        sd.text((x + 6, y + th + 4), f'{i / fps:.2f}s  m={motion[i]:.2f}', fill=(220, 220, 220), font=font(15))
    sheet.save(os.path.join(out, f"sheet_{s['name']}.jpg"), quality=88)

for s in scenes:
    print(f"{'PASS' if s['passed'] else 'FAIL'} {s['name']:<12} {s['score']:>4}/10  live {s['live']*100:5.1f}%  freeze {s['longest_freeze']}f  hard {s['hard_stops']}  cut {s['cut_offbeat_ms']}ms  offgrid {len(s['offgrid_hits'])}  mean {s['mean_motion']}")
for v in violations:
    print('BANNED', v)
print('OVERALL', 'PASS' if ok else 'RE-RENDER')
