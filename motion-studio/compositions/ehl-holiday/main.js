/* EHL Holiday — 26 s, 120 BPM, 13 bars. Every cut lands on a bar line, every pop on the 16th-note grid. */
const { at, sp, ring, clamp, noise, hit, scene, sinceGrid, beatLen, rng } = Studio;
Studio.config({ width: 1080, height: 1920, fps: 30, bpm: 120, duration: 26 });
const B = beatLen();
const $ = id => document.getElementById(id);

// ---------- helpers ----------
function letters(el) {
  const out = [];
  const walk = node => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const ch of n.textContent) {
          const s = document.createElement('span');
          s.className = 'ch'; s.textContent = ch === ' ' ? ' ' : ch;
          frag.appendChild(s); out.push(s);
        }
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1 && !n.classList.contains('strike')) walk(n);
    }
  };
  walk(el);
  return out;
}
/** Letters rise one after another, each on its own spring. */
function rise(spans, t, t0, o = {}) {
  const st = o.stagger ?? 0.022, dy = o.dy ?? 100;
  spans.forEach((s, i) => {
    const p = sp(t, t0 + i * st, 0, 1, o.preset || 'snappy');
    s.style.transform = `translate3d(0, ${((1 - p) * dy).toFixed(2)}px, 0)`;
    s.style.opacity = clamp(p * 1.7).toFixed(3);
  });
}
/** A whole element springs in. */
function show(el, t, t0, o = {}) {
  const p = sp(t, t0, 0, 1, o.preset || 'snappy');
  el.style.opacity = clamp(p * 1.6).toFixed(3);
  el.style.transform = `translate3d(${((1 - p) * (o.dx || 0)).toFixed(2)}px, ${((1 - p) * (o.dy ?? 60)).toFixed(2)}px, 0) ${o.extra || ''}`;
  return p;
}
const beatPulse = (t, k = 7) => Math.exp(-k * sinceGrid(t, 1));
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, u) => { const A = hex(a), Bc = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (Bc[i] - v) * u)).join(',')})`; };
const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;

/** Light sweep: reveal `layer` left to right behind a gold band. X runs from about -0.2 to 1.25. */
function sweep(layer, band, X, w, h) {
  const s = 0.35 * w, x = X * (w + s);
  layer.style.clipPath = `polygon(0 0, ${x.toFixed(1)}px 0, ${(x - s).toFixed(1)}px ${h}px, 0 ${h}px)`;
  band.style.transform = `translate3d(${(x - s / 2 - 90).toFixed(1)}px, 0, 0) skewX(${(-Math.atan2(s, h) * 180 / Math.PI).toFixed(2)}deg)`;
  band.style.opacity = clamp(Math.min(X + 0.15, 1.2 - X) * 3).toFixed(3);
}

// ---------- C9 bulbs ----------
const PAL = {
  warm:   { glass: '#ffcf73', core: '#fff7e0', glow: '#ffb84d', off: '#2e2414' },
  red:    { glass: '#ff4f4f', core: '#ffe3de', glow: '#ff2d2d', off: '#2e1010' },
  green:  { glass: '#45e07f', core: '#e8fff0', glow: '#22c55e', off: '#0f2a19' },
  blue:   { glass: '#6a96ff', core: '#e8efff', glow: '#3d7bff', off: '#111a33' },
  orange: { glass: '#ffb04a', core: '#fff1dc', glow: '#ff9f1a', off: '#2e200d' },
  gold:   { glass: '#ffd54f', core: '#fffbe6', glow: '#ffc83d', off: '#2e2810' },
};
const GLOW = {};
for (const [k, p] of Object.entries(PAL)) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, rgba(p.glow, 0.85)); gr.addColorStop(0.22, rgba(p.glow, 0.42)); gr.addColorStop(0.55, rgba(p.glow, 0.10)); gr.addColorStop(1, rgba(p.glow, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); GLOW[k] = c;
}

function drawBulb(g, x, y, ang, pk, b) {
  const p = PAL[pk], lit = clamp(b);
  g.save(); g.translate(x, y); g.rotate(ang);
  if (b > 0.01) {
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(0.8 * b);
    const R = 150 * (0.7 + 0.3 * Math.min(b, 1.3));
    g.drawImage(GLOW[pk], -R, 52 - R, 2 * R, 2 * R);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = '#16351f';
  g.beginPath(); g.roundRect(-10, 0, 20, 25, 4); g.fill();
  g.beginPath(); g.moveTo(-13, 23); g.bezierCurveTo(-22, 41, -11, 69, 0, 83); g.bezierCurveTo(11, 69, 22, 41, 13, 23); g.closePath();
  const gr = g.createRadialGradient(-3, 48, 2, 0, 52, 36);
  gr.addColorStop(0, mix(p.off, p.core, lit)); gr.addColorStop(0.45, mix(p.off, p.glass, lit)); gr.addColorStop(1, mix('#0d0d0d', p.glow, lit * 0.9));
  g.fillStyle = gr; g.fill();
  g.strokeStyle = `rgba(255,255,255,${0.16 + 0.22 * lit})`; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(-7, 31); g.quadraticCurveTo(-11, 47, -5, 63); g.stroke();
  g.restore();
}

/** A festoon strand that drops in on a spring; bulbs swing like damped pendulums and light on the grid. */
function drawStrand(g, t, s) {
  const dt = t - s.drop;
  const dy = sp(t, s.drop, -470, 0, 'bouncy');
  const sag = s.sag + ring(dt - 0.1, 42, 10, 0.22);
  const P = u => [s.x0 + (s.x1 - s.x0) * u, s.y0 + (s.y1 - s.y0) * u + sag * 4 * u * (1 - u) + dy];
  g.save(); g.lineWidth = 5; g.lineCap = 'round'; g.strokeStyle = '#173b24';
  g.beginPath();
  for (let k = 0; k <= 64; k++) { const [x, y] = P(k / 64); k ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke(); g.restore();
  for (let i = 0; i < s.n; i++) {
    const [x, y] = P((i + 0.5) / s.n);
    const ang = ring(dt, 0.55, 7, 0.16, i * 0.5) + 0.05 * Math.sin(1.25 * t + i * 0.9) + 0.04 * (noise(t * 0.8, i + 3) - 0.5);
    let b = t >= s.on[i] ? Math.min(1.3, Math.max(0, sp(t, s.on[i], 0, 1, 'bouncy'))) : 0;
    if (b > 0) b *= 0.9 + 0.1 * noise(t * 3 + i * 1.7, i);
    if (b > 0 && t >= s.chaseFrom) b += 0.32 * Math.exp(-9 * sinceGrid(t - i * 0.028, 1));
    if (b > 0 && s.flash != null && t >= s.flash) b += 0.8 * Math.exp(-3.2 * (t - s.flash));
    drawBulb(g, x, y, ang, s.colors[i % s.colors.length], b);
  }
}

// ---------- bokeh ----------
const DISC = {};
for (const k of ['warm', 'gold', 'orange', 'red', 'green']) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64), col = PAL[k].glow;
  gr.addColorStop(0, rgba(col, 0.75)); gr.addColorStop(0.62, rgba(col, 0.5)); gr.addColorStop(0.86, rgba(col, 0.2)); gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); DISC[k] = c;
}
const BOKEH = Array.from({ length: 44 }, (_, i) => {
  const r = rng(300 + i);
  return { x: r() * 1080, y: r() * 2100, rad: 22 + r() * 92, v: 14 + r() * 40, ph: r() * 6.28,
           col: ['warm', 'gold', 'orange', 'red', 'green', 'warm'][Math.floor(r() * 6)], a: 0.10 + r() * 0.22 };
});
function drawBokeh(g, t, lt) {
  g.clearRect(0, 0, 1080, 1920);
  g.globalCompositeOperation = 'lighter';
  const pulse = 1 + 0.45 * beatPulse(t, 6);
  BOKEH.forEach((b, i) => {
    const y = (((b.y - b.v * lt) % 2100) + 2100) % 2100 - 90;
    const x = b.x + 26 * Math.sin(0.33 * t + b.ph);
    g.globalAlpha = clamp(b.a * (0.7 + 0.3 * noise(t * 0.9 + i, i)) * pulse);
    g.drawImage(DISC[b.col], x - b.rad, y - b.rad, b.rad * 2, b.rad * 2);
  });
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}

// =====================================================================
// 1 · HOOK  (bars 0-1)
// =====================================================================
const c1 = $('c1').getContext('2d');
const S1 = { drop: hit('strand drops', 0), n: 14, x0: -60, y0: 300, x1: 1140, y1: 336, sag: 190, colors: ['warm'],
  on: Array.from({ length: 14 }, (_, i) => hit(`bulb ${i + 1}`, at(0, 0, 2) + i * B / 4)), chaseFrom: at(1) };
const T1 = { k: hit('kicker', at(0, 1)), a: hit('Your house,', at(0, 2)), b: hit('lit up.', at(1)), sub: hit('subline', at(1, 2)) };
const L1a = letters($('l1a')), L1b = letters($('l1b'));
scene('hook', 0, at(2), $('s1'), (lt, t) => {
  c1.clearRect(0, 0, 1080, 1920);
  drawStrand(c1, t, S1);
  show($('k1'), t, T1.k, { dy: 28 });
  rise(L1a, t, T1.a, { dy: 120 });
  rise(L1b, t, T1.b, { dy: 120, preset: 'bouncy', stagger: 0.03 });
  const p = t >= T1.b ? 0.5 + 0.5 * beatPulse(t, 5) : 0;
  $('l1b').style.textShadow = `0 0 ${(26 + 34 * p).toFixed(1)}px rgba(255,200,61,${(0.42 * p).toFixed(3)})`;
  show($('sub1'), t, T1.sub, { dy: 40 });
});

// =====================================================================
// 2 · REAL SHOT  (bars 2-3)
// =====================================================================
const T2 = { card: hit('photo lands', at(2)), sweep: hit('lights sweep on', at(2, 1)), k: hit('what we light', at(2, 1)),
  words: [at(2, 2), at(2, 3), at(3, 0), at(3, 1)].map((x, i) => hit(`word ${i + 1}`, x)) };
const W2 = [...document.querySelectorAll('#w2 .w')];
const card2Imgs = [...document.querySelectorAll('#card2 img')], glow2 = document.querySelector('#lit2 .glow');
scene('real-shot', at(2), at(4), $('s2'), (lt, t) => {
  const y = sp(t, T2.card, 700, 0, 'heavy'), r = sp(t, T2.card, 4.5, -1.2, 'heavy');
  $('card2').style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(3)}deg)`;
  const kb = 1.12 - 0.07 * clamp(lt / 4);
  card2Imgs.forEach(im => { im.style.transform = `scale(${kb.toFixed(4)})`; im.style.transformOrigin = '50% 75%'; });
  sweep($('lit2'), $('band2'), sp(t, T2.sweep, -0.2, 1.25, 'soft'), 904, 904);
  glow2.style.opacity = (0.45 + 0.55 * beatPulse(t, 6)).toFixed(3);
  show($('k2'), t, T2.k, { dy: 24 });
  W2.forEach((w, i) => show(w, t, T2.words[i], { dy: 80, preset: 'bouncy' }));
});

// =====================================================================
// 3 · PACKAGES  (bars 4-6): the same house, one more layer of light per bar
// =====================================================================
const T3 = { card: hit('house lands', at(4)), lab: [at(4, 1), at(5), at(6)].map((x, i) => hit(`option ${i + 1}`, x)) };
const LAB = ['lab1', 'lab2', 'lab3'].map(id => ({ el: $(id), ch: letters($(id)) }));
const K3 = ['k3a', 'k3b', 'k3c'].map($);
const optImgs = ['o1', 'o2', 'o3'].map(id => [...$(id).querySelectorAll('img')]);
const glow3 = [...document.querySelectorAll('#card3 .glow')];
scene('packages', at(4), at(7), $('s3'), (lt, t) => {
  const y = sp(t, T3.card, 760, 0, 'heavy'), r = sp(t, T3.card, -4, 0.8, 'heavy');
  $('card3').style.transform = `translate3d(0, ${(y + 6 * Math.sin(1.1 * lt)).toFixed(1)}px, 0) rotate(${(r + 0.35 * Math.sin(0.8 * lt)).toFixed(3)}deg)`;
  // a slow camera push-in that restarts with every new option (constant velocity, no easing)
  optImgs.forEach((imgs, i) => {
    const t0 = i === 0 ? at(4) : T3.lab[i];
    const u = clamp((t - t0) / (2 * 4 * B));
    const kb = 1.16 - 0.12 * u, px = -14 + 28 * u;
    imgs.forEach(im => { im.style.transform = `translate3d(${px.toFixed(2)}px, 0, 0) scale(${kb.toFixed(4)})`; im.style.transformOrigin = '50% 72%'; });
  });
  const X2 = sp(t, T3.lab[1], -0.2, 1.25, 'soft'), X3 = sp(t, T3.lab[2], -0.2, 1.25, 'soft');
  sweep($('o2'), $('band3'), X2, 852, 1055);
  if (t >= T3.lab[2]) sweep($('o3'), $('band3'), X3, 852, 1055);
  else $('o3').style.clipPath = 'polygon(0 0, 0 0, 0 0)';
  glow3.forEach(g => { g.style.opacity = (0.35 + 0.45 * beatPulse(t, 3.5) + 0.2 * noise(t * 2.2, 9)).toFixed(3); });
  LAB.forEach((L, i) => {
    rise(L.ch, t, T3.lab[i], { dy: 110, stagger: 0.016 });
    const te = T3.lab[i + 1];
    const pe = te != null && t >= te ? sp(t, te, 0, 1, 'snappy') : 0;
    L.el.style.transform = `translate3d(0, ${(-110 * pe).toFixed(1)}px, 0)`;
    L.el.style.opacity = (1 - clamp(pe * 1.4)).toFixed(3);
    const k = K3[i];
    const pk = show(k, t, T3.lab[i], { dy: 20 });
    if (pe > 0) { k.style.opacity = (clamp(pk * 1.6) * (1 - clamp(pe * 1.4))).toFixed(3); }
  });
});

// =====================================================================
// 4 · PROMISE  (bars 7-8)
// =====================================================================
const c4 = $('c4').getContext('2d');
const T4 = { k: hit('easy way', at(7)), neg: [at(7), at(7, 1), at(7, 2)].map((x, i) => hit(`no ${i + 1}`, x)),
  strike: [at(7, 0, 2), at(7, 1, 2), at(7, 2, 2)].map((x, i) => hit(`strike ${i + 1}`, x)),
  shift: hit('turn', at(8)), pos: [at(8), at(8, 1), at(8, 2)].map((x, i) => hit(`yes ${i + 1}`, x)) };
const NEG = ['n1', 'n2', 'n3'].map(id => ({ el: $(id), ch: letters($(id)), st: $(id).querySelector('.strike') }));
const POS = ['p1', 'p2', 'p3'].map(id => ({ el: $(id), ch: letters($(id)) }));
scene('promise', at(7), at(9), $('s4'), (lt, t) => {
  drawBokeh(c4, t, lt);
  const ps = sp(t, T4.shift, 0, 1, 'heavy');
  const pk = show($('k4'), t, T4.k, { dy: 24 });
  $('k4').style.opacity = (clamp(pk * 1.6) * (1 - clamp(ps * 1.5))).toFixed(3);
  NEG.forEach((n, i) => {
    rise(n.ch, t, T4.neg[i], { dy: 90, stagger: 0.012 });
    const s = Math.max(0, sp(t, T4.strike[i], 0, 1, 'snappy'));
    n.st.style.transform = `scaleX(${s.toFixed(4)})`;
    n.el.style.transform = `translate3d(0, ${(-70 * ps).toFixed(1)}px, 0)`;
    n.el.style.opacity = (1 - 0.68 * clamp(ps)).toFixed(3);
  });
  POS.forEach((p, i) => rise(p.ch, t, T4.pos[i], { dy: 110, stagger: 0.016, preset: i === 2 ? 'bouncy' : 'snappy' }));
});

// =====================================================================
// 5 · TEXT US  (bars 9-10)
// =====================================================================
const T5 = { a: hit('text us', at(9)), b: hit('address', at(9, 0, 2)), phone: at(9),
  out: hit('customer texts', at(9, 2)), typing: hit('typing', at(9, 3)), inn: hit('mock-up arrives', at(10)),
  txt: hit('reply text', at(10, 1)), k: hit('see it before you buy', at(10, 2)) };
const H5a = letters($('h5a')), H5b = letters($('h5b'));
const dots = [...document.querySelectorAll('#typ i')];
const b2img = document.querySelector('#b2 img');
b2img.style.transformOrigin = '50% 70%';
scene('text-us', at(9), at(11), $('s5'), (lt, t) => {
  rise(H5a, t, T5.a, { dy: 110 });
  rise(H5b, t, T5.b, { dy: 110, preset: 'bouncy' });
  const py = sp(t, T5.phone, 1150, 0, 'heavy');
  const push = 1 + 0.045 * clamp(lt / 4);   // the phone keeps drifting toward the viewer
  $('phone').style.transformOrigin = '50% 40%';
  $('phone').style.transform = `translate3d(0, ${(py + 9 * Math.sin(1.3 * lt)).toFixed(1)}px, 0) rotate(${(sp(t, T5.phone, 6, 0, 'heavy') + 0.8 * Math.sin(0.9 * lt)).toFixed(3)}deg) scale(${push.toFixed(4)})`;
  const ub = clamp((t - T5.inn) / 2);
  b2img.style.transform = `scale(${(1.18 - 0.14 * ub).toFixed(4)}) translate3d(${(-10 + 20 * ub).toFixed(2)}px, 0, 0)`;
  const pb1 = sp(t, T5.out, 0, 1, 'bouncy');
  $('b1').style.transform = `scale(${Math.max(0, 0.35 + 0.65 * pb1).toFixed(4)})`; $('b1').style.opacity = clamp(pb1 * 2).toFixed(3);
  const pin = sp(t, T5.typing, 0, 1, 'bouncy'), pout = sp(t, T5.inn, 0, 1, 'snappy');
  const typ = $('typ');
  typ.style.transform = `scale(${Math.max(0, (0.4 + 0.6 * pin) * (1 - pout)).toFixed(4)})`;
  typ.style.opacity = (clamp(pin * 2) * (1 - clamp(pout * 1.5))).toFixed(3);
  dots.forEach((d, j) => { d.style.transform = `translateY(${(-9 * Math.max(0, Math.sin(2 * Math.PI * (lt * 2.4 - j * 0.18)))).toFixed(2)}px)`; });
  const pb2 = sp(t, T5.inn, 0, 1, 'bouncy');
  $('b2').style.transform = `scale(${Math.max(0, 0.3 + 0.7 * pb2).toFixed(4)})`; $('b2').style.opacity = clamp(pb2 * 2).toFixed(3);
  show($('b2t'), t, T5.txt, { dy: 20 });
  show($('k5'), t, T5.k, { dy: 22 });
  $('phone').style.boxShadow = `0 50px 140px rgba(0,0,0,.75), 0 0 0 2px #2b2b31, 0 0 ${(70 + 60 * beatPulse(t, 5)).toFixed(0)}px rgba(255,200,61,${(0.08 + 0.12 * beatPulse(t, 5)).toFixed(3)})`;
});

// =====================================================================
// 6 · CALL  (bars 11-12)
// =====================================================================
const c6 = $('c6').getContext('2d');
const S6 = { drop: hit('strand 2 drops', at(11)), n: 16, x0: -60, y0: 330, x1: 1140, y1: 300, sag: 160,
  colors: ['red', 'green', 'blue', 'orange', 'gold'],
  on: Array.from({ length: 16 }, (_, i) => hit(`bulb ${i + 15}`, at(11, 0, 1) + i * B / 4)), chaseFrom: at(11), flash: hit('final', at(12)) };
const T6 = { logo: hit('logo', at(11, 1)), h: hit('call or text', at(11, 2)), num: [at(11, 3), at(11, 3, 1), at(11, 3, 2)].map((x, i) => hit(`number ${i + 1}`, x)),
  k: hit('company', at(12)), bk: hit('booking', at(12, 1)) };
const H6 = letters($('h6'));
const NUM = [...document.querySelectorAll('#num6 span')];
scene('call', at(11), at(13), $('s6'), (lt, t) => {
  c6.clearRect(0, 0, 1080, 1920);
  drawStrand(c6, t, S6);
  const pl = sp(t, T6.logo, 0, 1, 'bouncy');
  $('logo6').style.transform = `scale(${Math.max(0, 0.45 + 0.55 * pl).toFixed(4)}) rotate(${((1 - pl) * -10 + 1.2 * Math.sin(1.1 * lt)).toFixed(3)}deg)`;
  $('logo6').style.opacity = clamp(pl * 2).toFixed(3);
  rise(H6, t, T6.h, { dy: 110 });
  NUM.forEach((n, i) => show(n, t, T6.num[i], { dy: 90, preset: 'bouncy' }));
  const g = t >= T6.num[0] ? 0.45 + 0.55 * beatPulse(t, 5) : 0;
  $('num6').style.textShadow = `0 0 ${(24 + 30 * g).toFixed(1)}px rgba(255,200,61,${(0.38 * g).toFixed(3)})`;
  show($('k6'), t, T6.k, { dy: 22 });
  show($('bk6'), t, T6.bk, { dy: 40 });
});

// =====================================================================
// SOUNDTRACK — synthesized in code, locked to the same grid as the pictures
// =====================================================================
const CH = [
  { root: 146.83, pad: [293.66, 369.99, 440.0], arp: [587.33, 739.99, 880.0, 1174.66] },   // D
  { root: 123.47, pad: [246.94, 293.66, 369.99], arp: [493.88, 587.33, 739.99, 987.77] },  // Bm
  { root: 98.0, pad: [196.0, 246.94, 293.66], arp: [392.0, 493.88, 587.33, 783.99] },      // G
  { root: 110.0, pad: [220.0, 277.18, 329.63], arp: [440.0, 554.37, 659.25, 880.0] },      // A
];
const BELLS1 = [587.33, 739.99, 880, 987.77, 1174.66, 1479.98, 1760, 987.77, 1174.66, 1318.51, 1479.98, 1760, 1975.53, 2349.32];
const BELLS6 = [587.33, 739.99, 880, 1174.66, 739.99, 880, 1174.66, 1479.98, 880, 1174.66, 1479.98, 1760, 1174.66, 1479.98, 1760, 2349.32];

Studio.music(A => {
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let bar = 0; bar < 13; bar++) {
    const c = CH[bar % 4];
    A.pad(at(bar), c.pad, 2.0, bar === 0 ? 0.03 : 0.042);
    const groove = bar >= 1 && bar <= 11 && bar !== 7;          // bar 7 drops out under "No ladders"
    if (groove) {
      A.kick(at(bar, 0)); A.kick(at(bar, 2), 0.85);
      if (bar % 2 === 1) A.kick(at(bar, 3, 2), 0.55);
      [0, 1, 2].forEach(b => A.bass(at(bar, b), c.root, 0.44, 0.2));
      A.bass(at(bar, 3), c.root * 1.5, 0.44, 0.2);
    }
    if (bar >= 2 && bar <= 11) { A.snap(at(bar, 1)); A.snap(at(bar, 3)); }
    if (bar >= 1 && bar <= 11) for (let e = 0; e < 8; e++) A.hat(at(bar, 0, e * 2), e % 2 ? 0.1 : 0.05);
    if (bar >= 1) for (let s = 0; s < 16; s++) A.sleigh(at(bar, 0, s), (s % 4 === 0 ? 0.07 : 0.032) * (bar === 12 ? Math.max(0, 1 - s / 10) : 1));
    if (bar >= 2 && bar <= 11 && bar !== 7) {
      for (let e = 0; e < 8; e++) A.pluck(at(bar, 0, e * 2), c.arp[ARP[e]], bar === 11 ? 0.055 : 0.09, 0.38, e % 2 ? 0.3 : -0.3);
    }
  }
  // the end: one last D-major chord rings out
  A.pad(at(12), CH[0].pad, 2.2, 0.05); A.bass(at(12), 73.42, 1.6, 0.22);

  // risers into every cut, impacts on the downbeats that matter
  [[at(1, 2), at(2)], [at(3, 2), at(4)], [at(6, 2), at(7)], [at(8, 2), at(9)], [at(10, 2), at(11)]].forEach(([a, b]) => A.riser(a, b));
  A.whoosh(0, 0.1);
  [at(1), at(2), at(4), at(8), at(10), at(11)].forEach(t => A.impact(t, 0.3));
  A.impact(at(12), 0.45);

  // every bulb that lights rings a bell at the same instant
  S1.on.forEach((t, i) => A.bell(t, BELLS1[i], 0.17, 1.3, -0.5 + i / 13));
  S6.on.forEach((t, i) => A.bell(t, BELLS6[i], 0.15, 1.2, -0.5 + i / 15));
  [987.77, 1174.66, 1108.73, 1318.51].forEach((f, i) => A.bell(T2.words[i], f, 0.12, 1.0));
  A.bell(T3.lab[0], 1174.66, 0.1, 1.4); A.bell(T3.lab[0], 1479.98, 0.08, 1.4);
  A.whoosh(T3.lab[1], 0.12); A.bell(T3.lab[1], 987.77, 0.1, 1.4); A.bell(T3.lab[1], 1174.66, 0.08, 1.4);
  A.whoosh(T3.lab[2], 0.12); A.bell(T3.lab[2], 987.77, 0.1, 1.4); A.bell(T3.lab[2], 1567.98, 0.08, 1.4);
  T4.neg.forEach((t, i) => A.bell(t, [880, 1108.73, 1318.51][i], 0.1, 0.9));
  T4.strike.forEach(t => A.snap(t, 0.42));
  T4.pos.forEach((t, i) => A.bell(t, [1174.66, 1479.98, 1760][i], 0.11, 1.1));
  A.bell(T5.out, 1760, 0.09, 0.5); A.bell(T5.out + B / 4, 2349.32, 0.08, 0.6);
  A.bell(T5.inn, 1479.98, 0.1, 0.9); A.bell(T5.inn + B / 4, 1975.53, 0.08, 0.9);
  T6.num.forEach((t, i) => A.pluck(t, [880, 1108.73, 1318.51][i], 0.1, 0.5));
  [587.33, 739.99, 880, 1174.66].forEach(f => A.bell(at(12), f, 0.1, 2.0));
});

Studio.ready([
  document.fonts.load("400 100px 'Instrument Serif'"), document.fonts.load("italic 400 100px 'Instrument Serif'"),
  document.fonts.load("600 40px 'Manrope'"), document.fonts.load("700 40px 'Manrope'"), document.fonts.load("800 40px 'Manrope'"),
  document.fonts.load("500 26px 'JetBrains Mono'"),
]);
