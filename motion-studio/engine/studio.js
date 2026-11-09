/* Motion Studio runtime.
 *
 * Every pixel and every sound is a pure function of time t (seconds):
 *   - Studio.renderFrame(t) paints one frame; the renderer calls it for every frame.
 *   - Studio.renderAudio() synthesizes the whole soundtrack in code (OscillatorNode + noise, zero samples).
 *
 * Rules the critic enforces on compositions:
 *   - no CSS transitions, animations or keyframes, no requestAnimationFrame, no Math.random, no Date
 *   - motion comes from closed-form springs (Studio.spring), never from easing curves
 *   - every cut and every hit sits on the beat grid (Studio.at)
 */
(function (global) {
  'use strict';

  const S = {
    width: 1080, height: 1920, fps: 30, bpm: 120, duration: 24,
    scenes: [], hits: [], music: null, readyFlag: false,
  };

  // ---------- beat grid ----------
  const beatLen = () => 60 / S.bpm;
  /** Time of a grid position: bar, beat (0-3), sixteenth (0-3). */
  const at = (bar, beat = 0, sixteenth = 0) => (bar * 4 + beat + sixteenth / 4) * beatLen();
  /** Seconds since the most recent beat (or subdivision) at or before t. */
  const sinceGrid = (t, div = 1) => {
    const step = beatLen() / div;
    return t < 0 ? Infinity : t - Math.floor(t / step + 1e-9) * step;
  };

  // ---------- closed-form damped spring ----------
  /** Position of a damped spring released at t=0 from `from` toward `to`.
   *  k = stiffness, c = damping, m = mass, v0 = initial velocity. Exact solution, no integration. */
  function spring(t, o = {}) {
    const from = o.from ?? 0, to = o.to ?? 1, k = o.k ?? 170, c = o.c ?? 26, m = o.m ?? 1, v0 = o.v0 ?? 0;
    if (t <= 0) return from;
    const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m)), x0 = from - to;
    let x;
    if (z < 0.999) {
      const wd = w0 * Math.sqrt(1 - z * z);
      x = Math.exp(-z * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + z * w0 * x0) / wd) * Math.sin(wd * t));
    } else if (z <= 1.001) {
      x = Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
    } else {
      const s = w0 * Math.sqrt(z * z - 1), r1 = -z * w0 + s, r2 = -z * w0 - s;
      const B = (v0 - r1 * x0) / (r2 - r1), A = x0 - B;
      x = A * Math.exp(r1 * t) + B * Math.exp(r2 * t);
    }
    return to + x;
  }
  const SPRINGS = {
    snappy: { k: 380, c: 30 },          // zeta 0.77, settles ~0.3 s
    bouncy: { k: 260, c: 14 },          // zeta 0.43, ~22% overshoot
    soft: { k: 110, c: 21 },            // critically damped, ~0.5 s
    heavy: { k: 140, c: 18, m: 1.6 },   // zeta 0.6, weighty
  };
  /** Spring that starts at absolute time `start`. */
  const sp = (t, start, from, to, preset = 'snappy', extra) =>
    spring(t - start, Object.assign({ from, to }, SPRINGS[preset] || preset, extra));
  /** Damped oscillation (a struck pendulum): amplitude A, angular freq w, damping ratio z. */
  const ring = (t, A, w, z, phase = 0) => (t <= 0 ? 0 : A * Math.exp(-z * w * t) * Math.sin(w * Math.sqrt(1 - z * z) * t + phase));

  // ---------- deterministic randomness ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (i, seed = 0) => rng((i * 2654435761) ^ (seed * 974634881))();
  /** Smooth 1-D value noise in [0,1]. */
  function noise(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
  }

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;

  // ---------- scenes ----------
  /** Register a scene shown from `start` to `end` (absolute seconds). draw(localT, t) paints it. */
  function scene(name, start, end, el, draw) { S.scenes.push({ name, start, end, el, draw }); }
  /** Register a visual hit (a moment something lands) so the critic can check it is on the grid. */
  function hit(name, t) { S.hits.push({ name, t }); return t; }

  function renderFrame(t) {
    for (const sc of S.scenes) {
      const on = t >= sc.start - 1e-9 && t < sc.end - 1e-9;
      sc.el.style.visibility = on ? 'visible' : 'hidden';
      if (on) sc.draw(t - sc.start, t);
    }
    if (S.overlay) S.overlay(t);
  }

  function meta() {
    return {
      width: S.width, height: S.height, fps: S.fps, bpm: S.bpm, duration: S.duration,
      scenes: S.scenes.map(s => ({ name: s.name, start: s.start, end: s.end })),
      hits: S.hits.slice().sort((a, b) => a.t - b.t),
    };
  }

  // ---------- synthesized audio (zero samples) ----------
  function makeSynth(ctx) {
    const sr = ctx.sampleRate;
    const r = rng(7);
    const noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }

    // master: bus -> compressor -> out ; reverb send with a generated impulse response
    const master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.18;
    master.connect(comp); comp.connect(ctx.destination);
    const verb = ctx.createConvolver();
    {
      const len = Math.floor(sr * 2.4), ir = ctx.createBuffer(2, len, sr), rr = rng(11);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (rr() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      verb.buffer = ir;
    }
    const verbIn = ctx.createGain(); verbIn.gain.value = 0.32; verbIn.connect(verb); verb.connect(master);

    const env = (g, t, peak, a, d) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    };
    const out = (node, send = 0, pan = 0) => {
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      node.connect(p); p.connect(master);
      if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(verbIn); }
    };
    const noiseSrc = (t, dur) => { const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.start(t, (t * 0.37) % 1.5); n.stop(t + dur + 0.05); return n; };

    const A = {
      ctx,
      kick(t, v = 1) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
        env(g, t, v, 0.002, 0.42); o.connect(g); out(g); o.start(t); o.stop(t + 0.5);
        const n = noiseSrc(t, 0.02), hp = ctx.createBiquadFilter(), g2 = ctx.createGain();
        hp.type = 'highpass'; hp.frequency.value = 2500; env(g2, t, v * 0.25, 0.001, 0.012);
        n.connect(hp); hp.connect(g2); out(g2);
      },
      snap(t, v = 0.35) {
        const n = noiseSrc(t, 0.25), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.8;
        env(g, t, v, 0.002, 0.16); n.connect(bp); bp.connect(g); out(g, 0.35, 0.05);
      },
      hat(t, v = 0.1, open = false) {
        const n = noiseSrc(t, 0.3), hp = ctx.createBiquadFilter(), g = ctx.createGain();
        hp.type = 'highpass'; hp.frequency.value = 7500;
        env(g, t, v, 0.001, open ? 0.22 : 0.04); n.connect(hp); hp.connect(g); out(g, 0.05, -0.2);
      },
      sleigh(t, v = 0.06) {
        for (let i = 0; i < 3; i++) {
          const tt = t + i * 0.011, n = noiseSrc(tt, 0.1), bp = ctx.createBiquadFilter(), g = ctx.createGain();
          bp.type = 'bandpass'; bp.frequency.value = 8200 + i * 900; bp.Q.value = 5;
          env(g, tt, v * (1 - i * 0.25), 0.001, 0.07); n.connect(bp); bp.connect(g); out(g, 0.15, 0.3);
        }
      },
      /** Glockenspiel-like bell: FM carrier + inharmonic partial. */
      bell(t, f, v = 0.16, dur = 1.6, pan = 0) {
        const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
        c.frequency.value = f; m.frequency.value = f * 3.5;
        mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.4);
        m.connect(mg); mg.connect(c.frequency);
        env(g, t, v, 0.002, dur); c.connect(g);
        const p = ctx.createOscillator(), pg = ctx.createGain(); p.frequency.value = f * 2.756;
        env(pg, t, v * 0.25, 0.001, dur * 0.35); p.connect(pg);
        out(g, 0.45, pan); out(pg, 0.45, pan);
        for (const o of [c, m, p]) { o.start(t); o.stop(t + dur + 0.1); }
      },
      pluck(t, f, v = 0.11, dur = 0.45, pan = 0) {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        o1.type = 'triangle'; o2.type = 'sawtooth'; o1.frequency.value = f; o2.frequency.value = f * 1.004;
        lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.25);
        const g2 = ctx.createGain(); g2.gain.value = 0.35; o2.connect(g2); g2.connect(lp); o1.connect(lp);
        lp.connect(g); env(g, t, v, 0.003, dur); out(g, 0.25, pan);
        for (const o of [o1, o2]) { o.start(t); o.stop(t + dur + 0.1); }
      },
      bass(t, f, dur, v = 0.32) {
        const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f;
        lp.type = 'lowpass'; lp.frequency.value = 380;
        const g2 = ctx.createGain(); g2.gain.value = 0.4; o2.connect(g2); g2.connect(lp); o.connect(lp); lp.connect(g);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01);
        g.gain.setValueAtTime(v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        out(g); for (const x of [o, o2]) { x.start(t); x.stop(t + dur + 0.05); }
      },
      pad(t, freqs, dur, v = 0.05) {
        for (const f of freqs) {
          for (const det of [-7, 7]) {
            const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
            o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
            lp.type = 'lowpass'; lp.frequency.value = 1100;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.35);
            g.gain.setValueAtTime(v, t + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
            o.connect(lp); lp.connect(g); out(g, 0.5, det < 0 ? -0.35 : 0.35);
            o.start(t); o.stop(t + dur + 0.5);
          }
        }
      },
      riser(t0, t1, v = 0.14) {
        const n = noiseSrc(t0, t1 - t0), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        bp.type = 'bandpass'; bp.Q.value = 3;
        bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(7000, t1);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t1 - 0.01); g.gain.linearRampToValueAtTime(0, t1);
        n.connect(bp); bp.connect(g); out(g, 0.3);
      },
      whoosh(t, v = 0.12) {
        const n = noiseSrc(t, 0.6), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        bp.type = 'bandpass'; bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(5000, t); bp.frequency.exponentialRampToValueAtTime(400, t + 0.5);
        env(g, t, v, 0.04, 0.45); n.connect(bp); bp.connect(g); out(g, 0.3);
      },
      impact(t, v = 0.35) {
        const n = noiseSrc(t, 1), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(250, t + 0.7);
        env(g, t, v * 0.6, 0.002, 0.9); n.connect(lp); lp.connect(g); out(g, 0.5);
        const o = ctx.createOscillator(), g2 = ctx.createGain();
        o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.6);
        env(g2, t, v, 0.003, 0.8); o.connect(g2); out(g2); o.start(t); o.stop(t + 0.9);
      },
    };
    return A;
  }

  async function renderAudio() {
    const sr = 48000, n = Math.ceil(S.duration * sr);
    const ctx = new OfflineAudioContext(2, n, sr);
    if (S.music) S.music(makeSynth(ctx), { at, bpm: S.bpm, beat: beatLen() });
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const gain = 0.89 / peak;
    // 16-bit PCM WAV
    const bytes = new Uint8Array(44 + n * 4), dv = new DataView(bytes.buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++, o += 4) {
      dv.setInt16(o, Math.round(clamp(L[i] * gain, -1, 1) * 32767), true);
      dv.setInt16(o + 2, Math.round(clamp(R[i] * gain, -1, 1) * 32767), true);
    }
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  global.Studio = {
    S, at, sinceGrid, beatLen, spring, SPRINGS, sp, ring, rng, hash, noise, clamp, lerp,
    scene, hit, renderFrame, meta, renderAudio,
    config(o) { Object.assign(S, o); },
    music(fn) { S.music = fn; },
    overlay(fn) { S.overlay = fn; },
    async ready(extra = []) {
      await document.fonts.ready;
      await Promise.all([...document.images].map(im => (im.decode ? im.decode().catch(() => {}) : null)).concat(extra));
      S.readyFlag = true;
    },
    isReady: () => S.readyFlag,
  };
})(window);
