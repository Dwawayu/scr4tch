/* Scr4tch project page. Plain JavaScript, no dependencies. */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Camera x time explorer scenes. Each sprite is one image holding a
  // rows x cols grid of renders: rows = time, columns = camera.
  // Add more scenes here; a scene picker appears when there is more than one.
  // ------------------------------------------------------------------
  const TIMEVIEW_SCENES = [
    {
      name: 'Skateboarder',
      rows: 7,
      cols: 7,
      ours: 'static/images/timeview/skate_ours.jpg',
      baseline: 'static/images/timeview/skate_rayder.jpg',
      baselineName: 'RayDer',
    },
  ];

  // Appearance-leakage probe states (augmentation-tokens).
  const PROBE = {
    'on-1': {
      img: 'aug_1', state: 'ok', setting: 'augmentation on, 1 token',
      text: '<b>No leak.</b> One motion token restores the moving subject, with colors taken from the clean context views rather than the stylized target.',
    },
    'on-0': {
      img: 'aug_0', state: 'neutral', setting: 'augmentation on, 0 tokens',
      text: '<b>No motion tokens.</b> The same renderer falls back to the static scene, and the moving subject disappears.',
    },
    'on-64': {
      img: 'aug_64', state: 'leak', setting: 'augmentation on, 64 tokens',
      text: '<b>Partial leak.</b> With 64 tokens, spare capacity carries the stylized colors back into the reconstruction.',
    },
    'off-1': {
      img: 'noaug_1', state: 'leak', setting: 'augmentation off, 1 token',
      text: '<b>Leak.</b> Trained without augmentation, even a single motion token carries the stylized colors.',
    },
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function segmented(group, onChange) {
    const buttons = $$('button', group);
    const set = (value) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
    buttons.forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      set(b.dataset.value);
      onChange(b.dataset.value, b);
    }));
    return { set, buttons };
  }

  // ------------------------------------------------------------------
  // Media slots: a placeholder stays until the file at data-src loads.
  // Drop a file at that path and it replaces the placeholder automatically.
  // ------------------------------------------------------------------
  function initSlots() {
    const slots = $$('[data-slot]');
    if (!slots.length) return;

    const load = (slot) => {
      const kind = slot.dataset.slot;
      const el = document.createElement(kind === 'video' ? 'video' : 'img');
      const reveal = () => {
        slot.replaceChildren(el);
        slot.classList.add('is-loaded');
        if (kind === 'video' && !reduceMotion) el.play().catch(() => {});
      };
      if (kind === 'video') {
        el.muted = true;
        el.loop = true;
        el.playsInline = true;
        el.setAttribute('muted', '');
        el.setAttribute('playsinline', '');
        el.preload = 'auto';
        if (reduceMotion) el.controls = true;
        el.addEventListener('loadeddata', reveal, { once: true });
      } else {
        el.alt = slot.dataset.alt || '';
        el.addEventListener('load', reveal, { once: true });
      }
      el.src = slot.dataset.src; // a missing file fires "error" and the placeholder stays
      slot._media = el;
    };

    if (!('IntersectionObserver' in window)) { slots.forEach(load); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (isIntersecting && !target._media) load(target);
        const v = target._media;
        if (v && v.tagName === 'VIDEO' && target.classList.contains('is-loaded') && !reduceMotion) {
          if (isIntersecting) v.play().catch(() => {}); else v.pause();
        }
      });
    }, { rootMargin: '300px 0px' });
    slots.forEach((s) => io.observe(s));
  }

  // ------------------------------------------------------------------
  // Teaser: plays muted on its own; with reduced motion it waits for the viewer.
  // ------------------------------------------------------------------
  function initTeaser() {
    const video = $('[data-teaser]');
    if (!video || !reduceMotion) return;
    video.removeAttribute('autoplay');
    video.pause();
    video.controls = true;
  }

  // ------------------------------------------------------------------
  // Section rail: highlight the section being read.
  // ------------------------------------------------------------------
  function initRail() {
    const links = $$('.rail a');
    if (!links.length) return;
    const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
    let ticking = false;
    const update = () => {
      ticking = false;
      const line = window.innerHeight * 0.3;
      let current = sections[0];
      sections.forEach((s) => { if (s.getBoundingClientRect().top <= line) current = s; });
      links.forEach((a) => a.setAttribute('aria-current', String(a.hash === '#' + current.id)));
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  // ------------------------------------------------------------------
  // Camera x time explorer
  // ------------------------------------------------------------------
  function initTimeView() {
    const root = $('[data-timeview]');
    if (!root) return;
    const frames = [$('[data-tv-frame="ours"]', root), $('[data-tv-frame="baseline"]', root)];
    const pad = $('[data-tv-pad]', root);
    const cursor = $('[data-tv-cursor]', root);
    const ranges = { camera: $('[data-tv-range="camera"]', root), time: $('[data-tv-range="time"]', root) };
    const outs = { camera: $('[data-tv-out="camera"]', root), time: $('[data-tv-out="time"]', root) };
    const live = $('[data-tv-live]', root);
    const baselineName = $('[data-tv-baseline-name]', root);
    const sweepButtons = $$('[data-tv-sweep]', root);
    sweepButtons.forEach((b) => { b.dataset.label = b.textContent; b.setAttribute('aria-pressed', 'false'); });

    const colBand = document.createElement('div');
    colBand.className = 'tv__band tv__band--col';
    const rowBand = document.createElement('div');
    rowBand.className = 'tv__band tv__band--row';
    pad.prepend(colBand, rowBand);

    let scene = null;
    let c = 0;
    let r = 0;
    let timer = null;
    let sweepAxis = null;
    let touched = false;

    const pct = (i, n) => (n > 1 ? (i / (n - 1)) * 100 : 0);

    function render(announce) {
      const pos = `${pct(c, scene.cols)}% ${pct(r, scene.rows)}%`;
      frames.forEach((f) => { f.style.backgroundPosition = pos; });
      root.style.setProperty('--c', c);
      root.style.setProperty('--r', r);
      ranges.camera.value = c;
      ranges.time.value = r;
      outs.camera.textContent = `${c + 1} of ${scene.cols}`;
      outs.time.textContent = `${r + 1} of ${scene.rows}`;
      frames[0].setAttribute('aria-label', `Scr4tch rendering with the camera of view ${c + 1} at time ${r + 1}`);
      frames[1].setAttribute('aria-label', `${scene.baselineName} rendering with the camera of view ${c + 1} at time ${r + 1}`);
      if (announce) live.textContent = `Camera ${c + 1}, time ${r + 1}`;
    }

    function loadScene(i) {
      scene = TIMEVIEW_SCENES[i];
      root.style.setProperty('--cols', scene.cols);
      root.style.setProperty('--rows', scene.rows);
      frames[0].style.backgroundImage = `url('${scene.ours}')`;
      frames[1].style.backgroundImage = `url('${scene.baseline}')`;
      pad.style.backgroundImage = `url('${scene.ours}')`;
      cursor.style.backgroundImage = `url('${scene.ours}')`;
      ranges.camera.max = scene.cols - 1;
      ranges.time.max = scene.rows - 1;
      baselineName.textContent = scene.baselineName;
      c = Math.min(c, scene.cols - 1);
      r = Math.min(r, scene.rows - 1);
      render();
    }

    function stopSweep() {
      clearInterval(timer);
      timer = null;
      sweepButtons.forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.textContent = b.dataset.label; });
      sweepAxis = null;
    }

    function sweep(axis, cycles = Infinity) {
      if (sweepAxis === axis) { stopSweep(); return; }
      stopSweep();
      sweepAxis = axis;
      const btn = sweepButtons.find((b) => b.dataset.tvSweep === axis);
      if (btn) { btn.setAttribute('aria-pressed', 'true'); btn.textContent = 'Stop'; }
      let dir = 1;
      let turns = 0;
      timer = setInterval(() => {
        const n = axis === 'camera' ? scene.cols : scene.rows;
        let v = axis === 'camera' ? c : r;
        if (v + dir > n - 1 || v + dir < 0) {
          dir = -dir;
          turns += 1;
          if (turns >= cycles * 2) { stopSweep(); return; }
        }
        v += dir;
        if (axis === 'camera') c = v; else r = v;
        render();
      }, 320);
    }

    const userAction = () => { touched = true; stopSweep(); };

    function fromPointer(e) {
      const rect = pad.getBoundingClientRect();
      const x = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 0.9999);
      const y = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 0.9999);
      const nc = Math.floor(x * scene.cols);
      const nr = Math.floor(y * scene.rows);
      if (nc !== c || nr !== r) { c = nc; r = nr; render(); }
    }
    pad.addEventListener('pointerdown', (e) => {
      userAction();
      pad.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (pad.hasPointerCapture(e.pointerId) || e.pointerType === 'mouse') {
        if (e.pointerType === 'mouse' && !touched) userAction();
        fromPointer(e);
      }
    });
    pad.addEventListener('keydown', (e) => {
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!moves[e.key]) return;
      e.preventDefault();
      userAction();
      c = Math.min(Math.max(c + moves[e.key][0], 0), scene.cols - 1);
      r = Math.min(Math.max(r + moves[e.key][1], 0), scene.rows - 1);
      render(true);
    });
    ranges.camera.addEventListener('input', () => { userAction(); c = +ranges.camera.value; render(); });
    ranges.time.addEventListener('input', () => { userAction(); r = +ranges.time.value; render(); });
    sweepButtons.forEach((b) => b.addEventListener('click', () => { touched = true; sweep(b.dataset.tvSweep); }));

    const picker = $('[data-tv-scenes]', root);
    if (TIMEVIEW_SCENES.length > 1 && picker) {
      picker.hidden = false;
      picker.setAttribute('role', 'group');
      picker.setAttribute('aria-label', 'Scene');
      TIMEVIEW_SCENES.forEach((s, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.value = String(i);
        b.textContent = s.name;
        b.setAttribute('aria-pressed', String(i === 0));
        picker.append(b);
      });
      segmented(picker, (v) => { stopSweep(); loadScene(+v); });
    }

    loadScene(0);

    // One demonstration pass of the camera axis the first time the explorer is seen.
    if (!reduceMotion && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          io.disconnect();
          setTimeout(() => { if (!touched) sweep('camera', 1); }, 500);
        }
      }, { threshold: 0.6 });
      io.observe(pad);
    }
  }

  // ------------------------------------------------------------------
  // Camera interpolation scrubber
  // ------------------------------------------------------------------
  function initInterp() {
    const root = $('[data-interp]');
    if (!root) return;
    const n = +root.dataset.frames || 9;
    root.style.setProperty('--frames', n);
    const range = $('[data-interp-range]', root);
    const out = $('[data-interp-out]', root);
    const play = $('[data-interp-play]', root);
    range.max = n - 1;
    play.setAttribute('aria-pressed', 'false');
    let i = 0;
    let dir = 1;
    let timer = null;
    const label = (k) => (k === 0 ? 't1 (context)' : k === n - 1 ? `t${n} (context)` : `t${k + 1}`);
    const render = () => { root.style.setProperty('--i', i); range.value = i; out.textContent = label(i); };
    const stop = () => { clearInterval(timer); timer = null; play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); };
    range.addEventListener('input', () => { stop(); i = +range.value; render(); });
    play.addEventListener('click', () => {
      if (timer) { stop(); return; }
      play.textContent = 'Pause';
      play.setAttribute('aria-pressed', 'true');
      timer = setInterval(() => {
        if (i + dir > n - 1 || i + dir < 0) dir = -dir;
        i += dir;
        render();
      }, 280);
    });
    render();
  }

  // ------------------------------------------------------------------
  // Appearance-leakage probe
  // ------------------------------------------------------------------
  function initProbe() {
    const root = $('[data-probe]');
    if (!root) return;
    const img = $('[data-probe-img]', root);
    const verdict = $('[data-probe-verdict]', root);
    const setting = $('[data-probe-setting]', root);
    let aug = 'on';
    let tokens = '1';
    let tokenSeg = null;

    const render = () => {
      const s = PROBE[`${aug}-${tokens}`];
      img.src = `static/images/leakage/${s.img}.jpg`;
      img.alt = `Scr4tch reconstruction, ${s.setting}`;
      setting.textContent = s.setting;
      verdict.innerHTML = s.text;
      verdict.dataset.state = s.state;
    };

    segmented($('[data-probe-aug]', root), (v) => {
      aug = v;
      // Only the 1-token model was trained without augmentation.
      tokenSeg.buttons.forEach((b) => { b.disabled = aug === 'off' && b.dataset.value !== '1'; });
      if (aug === 'off') { tokens = '1'; tokenSeg.set('1'); }
      render();
    });
    tokenSeg = segmented($('[data-probe-tokens]', root), (v) => { tokens = v; render(); });
    render();
  }

  // ------------------------------------------------------------------
  // Depth wipe comparison
  // ------------------------------------------------------------------
  function initCompare() {
    const root = $('[data-compare]');
    if (!root) return;
    const range = $('[data-compare-range]', root);
    const base = $('[data-compare-base]', root);
    const rgb = $('[data-compare-rgb]');
    const names = $$('[data-compare-name]');
    range.addEventListener('input', () => root.style.setProperty('--pos', `${range.value}%`));
    const pick = $('[data-compare-pick]');
    if (!pick) return;
    segmented(pick, (value, btn) => {
      const name = btn.dataset.name;
      base.src = `static/images/static_nvs/${value}_depth.jpg`;
      base.alt = `${name} rendered depth`;
      if (rgb) { rgb.src = `static/images/static_nvs/${value}_rgb.jpg`; rgb.alt = `${name} rendering of the target view`; }
      names.forEach((el) => { el.textContent = name; });
    });
  }

  // ------------------------------------------------------------------
  // Camera trajectory viewer. Data: static/data/pose_cases.js, made by
  // _source/pose/prep_pose.py. Poses are in the first reference camera's
  // frame (OpenCV axes: +X right, +Y down, +Z forward).
  // ------------------------------------------------------------------
  function initPose() {
    const root = $('[data-pose]');
    const CASES = window.POSE_CASES;
    if (!root || !CASES || !CASES.length) return;
    const canvas = $('[data-pose-canvas]', root);
    const ctx = canvas.getContext('2d');
    const img = $('[data-pose-img]', root);
    const out = $('[data-pose-out]', root);
    const strip = $('[data-pose-strip]', root);
    const play = $('[data-pose-play]', root);
    const baseName = $('[data-pose-name]', root);
    const NAMES = { neoverse: 'NeoVerse', monst3r: 'MonST3R', erayzer: 'E-RayZer' };
    const RATE = 1.6;          // input frames per second while playing
    const HOLD = 1.6;          // seconds the finished trajectory stays before the clip restarts
    const HOME = { az: 58, el: 30 };
    const FOV = 30 * Math.PI / 180;
    const FRUSTUM = { depth: 0.3, half: 0.5 };   // decorative, in units of the mean reference radius

    let cs = null;
    let base = 'monst3r';
    let t = 0;
    let hold = 0;
    let playing = !reduceMotion;
    let az = HOME.az;
    let el = HOME.el;
    let rotated = false;
    let sway = 0;
    let visible = false;
    let raf = 0;
    let last = 0;
    let shown = -1;
    let fit = null;
    let colors = null;

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
    // OpenCV world to a y-up display frame: a 180 degree turn about X, so nothing is mirrored.
    const disp = (p) => [p[0], -p[1], -p[2]];
    const camPoint = (pose, v) => {
      const R = pose.R;
      return disp([
        pose.c[0] + R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
        pose.c[1] + R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
        pose.c[2] + R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
      ]);
    };

    function readColors() {
      const s = getComputedStyle(root);
      const v = (name) => s.getPropertyValue(name).trim();
      colors = { ours: v('--camera'), base: v('--mark'), ref: v('--ink'), grid: v('--rule'), bg: v('--plate') };
    }

    function frustumPoints(pose) {
      const d = FRUSTUM.depth;
      const h = FRUSTUM.half * d;
      return [[-h, -h, d], [h, -h, d], [h, h, d], [-h, h, d]].map((v) => camPoint(pose, v));
    }

    function fitCase() {
      // Frame every method of the clip, so switching the baseline does not move the view.
      const pts = [];
      const sets = [cs.ref, ...Object.values(cs.methods).map((m) => m.poses)];
      sets.forEach((poses) => poses.forEach((p) => pts.push(disp(p.c), ...frustumPoints(p))));
      const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
      const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
      const target = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
      const radius = Math.max(...pts.map((p) => Math.hypot(...sub(p, target))));
      fit = { pts, target, radius, lo, hi, floor: lo[1] - 0.3 };
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    }

    function camera() {
      const a = (az + sway) * Math.PI / 180;
      const e = el * Math.PI / 180;
      const W = canvas.width;
      const H = canvas.height;
      const dist = fit.radius / Math.sin(FOV / 2);
      const eye = [
        fit.target[0] + dist * Math.cos(e) * Math.sin(a),
        fit.target[1] + dist * Math.sin(e),
        fit.target[2] + dist * Math.cos(e) * Math.cos(a),
      ];
      const Z = norm(sub(eye, fit.target));
      const X = norm(cross([0, 1, 0], Z));
      const Y = cross(Z, X);
      const raw = (q) => {
        const v = sub(q, eye);
        const depth = -dot(v, Z);
        return depth < 1e-3 ? null : [dot(v, X) / depth, dot(v, Y) / depth];
      };
      // Zoom and center on the cameras as they appear from this angle,
      // leaving the top-left corner to the legend.
      const box = [0.05 * W, 0.24 * H, 0.95 * W, 0.93 * H];
      const ps = fit.pts.map(raw).filter(Boolean);
      const x0 = Math.min(...ps.map((p) => p[0]));
      const x1 = Math.max(...ps.map((p) => p[0]));
      const y0 = Math.min(...ps.map((p) => p[1]));
      const y1 = Math.max(...ps.map((p) => p[1]));
      const f = Math.min((box[2] - box[0]) / Math.max(x1 - x0, 1e-6), (box[3] - box[1]) / Math.max(y1 - y0, 1e-6));
      const cx = (box[0] + box[2]) / 2 - f * (x0 + x1) / 2;
      const cy = (box[1] + box[3]) / 2 + f * (y0 + y1) / 2;
      return (q) => {
        const p = raw(q);
        return p && [cx + f * p[0], cy - f * p[1]];
      };
    }

    function line(project, a, b) {
      const p = project(a);
      const q = project(b);
      if (!p || !q) return;
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    }

    function drawGrid(project, s) {
      const step = 0.5;
      const pad = 0.5;
      const x0 = Math.floor((fit.lo[0] - pad) / step) * step;
      const x1 = Math.ceil((fit.hi[0] + pad) / step) * step;
      const z0 = Math.floor((fit.lo[2] - pad) / step) * step;
      const z1 = Math.ceil((fit.hi[2] + pad) / step) * step;
      const y = fit.floor;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1e-6; x += step) line(project, [x, y, z0], [x, y, z1]);
      for (let z = z0; z <= z1 + 1e-6; z += step) line(project, [x0, y, z], [x1, y, z]);
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = s;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.stroke();
    }

    function drawFrustum(project, pose, color, s, current, dashed, faint) {
      const d = FRUSTUM.depth;
      const h = FRUSTUM.half * d;
      const apex = disp(pose.c);
      const corners = frustumPoints(pose);
      const up = camPoint(pose, [0, -h * 1.7, d]);   // marks the top of the image (-Y in OpenCV)
      ctx.beginPath();
      corners.forEach((c) => line(project, apex, c));
      corners.forEach((c, i) => line(project, c, corners[(i + 1) % 4]));
      line(project, corners[0], up);
      line(project, up, corners[1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = (current ? 2 : 1.2) * s;
      ctx.setLineDash(dashed ? [4 * s, 3 * s] : []);
      ctx.globalAlpha = current ? 1 : faint;
      ctx.stroke();
      if (current) {
        const pts = corners.map(project);
        if (pts.every(Boolean)) {
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.globalAlpha = dashed ? 0.08 : 0.16;
          ctx.fill();
        }
      }
    }

    function drawPath(project, poses, color, s, width, dashed, upto) {
      const n = poses.length;
      const k = Math.floor(upto);
      ctx.beginPath();
      for (let i = 0; i <= Math.min(k, n - 1); i += 1) {
        const p = project(disp(poses[i].c));
        if (!p) continue;
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      const frac = upto - k;
      if (frac > 0 && k + 1 < n) {
        const a = poses[k].c;
        const b = poses[k + 1].c;
        const p = project(disp([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac]));
        if (p) ctx.lineTo(p[0], p[1]);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width * s;
      ctx.setLineDash(dashed ? [5 * s, 4 * s] : []);
      ctx.globalAlpha = 1;
      ctx.stroke();
    }

    function draw() {
      if (!colors) readColors();
      resize();
      const s = canvas.width / Math.max(canvas.clientWidth, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const project = camera();
      const cur = Math.min(cs.n - 1, Math.floor(t + 1e-6));
      const sets = [
        { poses: cs.ref, color: colors.ref, dashed: true, width: 1.6, faint: 0.35 },
        { poses: cs.methods[base].poses, color: colors.base, dashed: false, width: 2.2, faint: 0.35 },
        { poses: cs.methods.exp254.poses, color: colors.ours, dashed: false, width: 2.6, faint: 0.55 },
      ];

      drawGrid(project, s);
      // the whole reference path stays faintly visible as the target
      ctx.save();
      ctx.globalAlpha = 0.25;
      drawPath(project, cs.ref, colors.ref, s, 1.2, true, cs.n - 1);
      ctx.restore();
      sets.forEach((set) => {
        for (let i = 0; i <= cur; i += 1) drawFrustum(project, set.poses[i], set.color, s, i === cur, set.dashed, set.faint);
        drawPath(project, set.poses, set.color, s, set.width, set.dashed, t);
      });
      // dotted links from the reference to each estimate at the current frame
      const r = project(disp(cs.ref[cur].c));
      [sets[1], sets[2]].forEach((set) => {
        const p = project(disp(set.poses[cur].c));
        if (!r || !p) return;
        ctx.beginPath();
        ctx.moveTo(r[0], r[1]);
        ctx.lineTo(p[0], p[1]);
        ctx.strokeStyle = set.color;
        ctx.lineWidth = 1.2 * s;
        ctx.setLineDash([1.5 * s, 3 * s]);
        ctx.globalAlpha = 0.9;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      if (cur !== shown) {
        shown = cur;
        img.src = cs.frames[cur];
        img.alt = `Clip ${cs.label}, input frame ${cur + 1} of ${cs.n}`;
        out.textContent = `${cur + 1} of ${cs.n}`;
        $$('button', strip).forEach((b, i) => {
          b.setAttribute('aria-current', String(i === cur));
          b.classList.toggle('is-seen', i < cur);
        });
      }
    }

    function tick(now) {
      raf = 0;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      if (playing) {
        if (t < cs.n - 1) t = Math.min(cs.n - 1, t + dt * RATE);
        else if ((hold += dt) > HOLD) { t = 0; hold = 0; }
        if (!rotated) sway = 9 * Math.sin(now / 1000 * 0.45);
      }
      draw();
      if (playing && visible) raf = requestAnimationFrame(tick);
    }
    const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } };

    function setPlaying(on) {
      playing = on;
      play.textContent = on ? 'Pause' : 'Play';
      play.setAttribute('aria-pressed', String(on));
      if (on && t >= cs.n - 1) { t = 0; hold = 0; }
      kick();
    }

    function loadCase(i) {
      cs = CASES[i];
      fitCase();
      strip.replaceChildren(...cs.frames.map((src, k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Show frame ${k + 1}`);
        const im = document.createElement('img');
        im.src = src;
        im.alt = '';
        im.width = 256;
        im.height = 256;
        b.append(im);
        b.addEventListener('click', () => { setPlaying(false); t = k; hold = 0; draw(); });
        return b;
      }));
      t = playing ? 0 : cs.n - 1;
      hold = 0;
      shown = -1;
      draw();
    }

    const clips = $('[data-pose-clips]', root);
    CASES.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = String(i);
      b.textContent = c.label;
      b.setAttribute('aria-pressed', String(i === 0));
      clips.append(b);
    });
    segmented(clips, (v) => { loadCase(+v); kick(); });
    segmented($('[data-pose-cmp]', root), (v) => { base = v; baseName.textContent = NAMES[v]; draw(); });
    play.addEventListener('click', () => setPlaying(!playing));

    // Drag (or arrow keys) to orbit; double-click returns to the default view.
    let drag = null;
    const takeOver = () => { rotated = true; az += sway; sway = 0; };
    canvas.addEventListener('pointerdown', (e) => {
      takeOver();
      drag = { x: e.clientX, y: e.clientY, az, el };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      az = drag.az - (e.clientX - drag.x) * 0.4;
      el = Math.min(85, Math.max(5, drag.el + (e.clientY - drag.y) * 0.3));
      draw();
    });
    const endDrag = () => { drag = null; canvas.classList.remove('is-dragging'); };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('dblclick', () => { az = HOME.az; el = HOME.el; rotated = false; draw(); });
    canvas.addEventListener('keydown', (e) => {
      const keys = { ArrowLeft: [-6, 0], ArrowRight: [6, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
      if (!keys[e.key]) return;
      e.preventDefault();
      takeOver();
      az += keys[e.key][0];
      el = Math.min(85, Math.max(5, el + keys[e.key][1]));
      draw();
    });

    if ('ResizeObserver' in window) new ResizeObserver(() => draw()).observe(canvas);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) kick();
      }).observe(root);
    } else {
      visible = true;
    }

    loadCase(0);
    setPlaying(playing);
  }

  // ------------------------------------------------------------------
  // Small toggles: motion masks, table views
  // ------------------------------------------------------------------
  function initToggles() {
    const maskToggle = $('[data-mask-toggle]');
    const masks = $('[data-masks]');
    if (maskToggle && masks) segmented(maskToggle, (v) => masks.classList.toggle('show-mask', v === 'mask'));

    $$('[data-table-toggle]').forEach((group) => {
      segmented(group, (v) => {
        $$('[data-table]', group.parentElement).forEach((t) => { t.hidden = t.dataset.table !== v; });
      });
    });
  }

  // ------------------------------------------------------------------
  // Bar chart tooltips
  // ------------------------------------------------------------------
  function initBars() {
    $$('[data-bars]').forEach((chart) => {
      const tip = $('[data-tip-el]', chart);
      if (!tip) return;
      const show = (bar, x, y) => {
        tip.textContent = bar.dataset.tip;
        tip.hidden = false;
        const box = chart.getBoundingClientRect();
        const w = tip.offsetWidth;
        let left = x - box.left + 14;
        if (left + w > box.width) left = x - box.left - w - 14;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = `${y - box.top - 40}px`;
      };
      $$('.bar', chart).forEach((bar) => {
        bar.addEventListener('pointermove', (e) => show(bar, e.clientX, e.clientY));
        bar.addEventListener('pointerleave', () => { tip.hidden = true; });
        bar.addEventListener('focus', () => {
          const f = $('.bar__fill', bar).getBoundingClientRect();
          show(bar, f.right, f.top + f.height / 2);
        });
        bar.addEventListener('blur', () => { tip.hidden = true; });
      });
    });
  }

  // ------------------------------------------------------------------
  // Misc: copy BibTeX, inert "coming soon" links
  // ------------------------------------------------------------------
  function initMisc() {
    $$('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
      const el = $(btn.dataset.copy);
      const text = el.innerText.trim();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
      }
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    }));

    $$('a[aria-disabled="true"]').forEach((a) => {
      a.setAttribute('tabindex', '-1');
      a.addEventListener('click', (e) => e.preventDefault());
    });
  }

  initTeaser();
  initSlots();
  initRail();
  initTimeView();
  initInterp();
  initProbe();
  initCompare();
  initPose();
  initToggles();
  initBars();
  initMisc();
})();
