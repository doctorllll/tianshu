"use strict";

/**
 * 天枢 launch intro: the Northern Dipper lights up, the view dives into 天枢, which cuts the mark
 * by laser and ignites it. Runs in a worker on an OffscreenCanvas so the loading app cannot stall
 * it (`TianshuIntro.start` is the page fallback); the sky and sprites are drawn once.
 */
(() => {
  const MARK_URL = "/brand/tianshu-mark-dark.svg";
  const VIEW_W = 1161.9;
  const VIEW_H = 1000;

  // The Northern Dipper, 天枢 first and the rest in the order they are named, as [x, y, brightness]
  // in degrees on a north-up sky chart (east to the left), from each star's right ascension and
  // declination. 天枢 is an orange giant; the other six are blue-white.
  const DIPPER = [
    [11.22, -5.75, 1],
    [11.48, -0.38, 0.78],
    [4.21, 2.31, 0.78],
    [1.2, -1.03, 0.5],
    [-4.2, 0.04, 1],
    [-8.37, 1.07, 0.88],
    [-11.68, 6.69, 0.92],
  ];
  // The bowl runs 天枢-天璇-天玑-天权 and closes on 天枢; the handle runs 天权-玉衡-开阳-摇光.
  const LINKS = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [3, 4],
    [4, 5],
    [5, 6],
  ];
  const DIPPER_W = 23.16;
  const DIPPER_H = 12.44;
  const DIPPER_MID = [-0.1, 0.47];
  const DUBHE_LABEL = "α UMa · DUBHE";
  const DUBHE_COORDS = "RA 11h 03m 43.7s   DEC +61° 45′ 03″";

  // Timeline, in ms from the start.
  const STAR_AT = DIPPER.map((_, k) => 140 + 90 * k);
  const LINK_MS = 80;
  const RETICLE = [700, 980];
  const DIVE = [920, 1440];
  const DIVE_ZOOM = 7;
  const TRACE_START = 1120;
  const TRACE_SPREAD = 460;
  const SLASH_START = 1600;
  const RING = [1580, 1980];
  const IGNITE = 2260;
  const FILL = [2280, 2760];
  const ORBIT_MS = 2800;
  const EXIT_MS = 560;

  const TAU = Math.PI * 2;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const span = (t, [a, b]) => clamp((t - a) / (b - a));
  const easeOutCubic = (x) => 1 - (1 - x) ** 3;
  const easeInOutCubic = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a)})`;

  function surface(w, h) {
    return typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
  }

  /** A contour as a polyline with the distance along it at every point. */
  function track(flat) {
    const n = flat.length / 2;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const at = new Float32Array(n);
    let length = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = flat[2 * k];
      const y = flat[2 * k + 1];
      if (k > 0) length += Math.hypot(x - xs[k - 1], y - ys[k - 1]);
      xs[k] = x;
      ys[k] = y;
      at[k] = length;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return {
      xs,
      ys,
      at,
      length,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      minX,
      maxX,
      minY,
      maxY,
    };
  }

  /** The closed contours of absolute M/L/C/Z path data, the commands potrace writes. */
  function contours(d) {
    const tokens = d.match(/[MLCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
    const result = [];
    let points = null;
    let command = "M";
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let i = 0;
    const next = () => Number(tokens[i++]);
    while (i < tokens.length) {
      const token = tokens[i];
      if (/^[MLCZ]$/i.test(token)) {
        command = token.toUpperCase();
        i++;
        if (command === "Z") {
          if (points) points.push(sx, sy);
          x = sx;
          y = sy;
          continue;
        }
      }
      if (command === "M") {
        x = next();
        y = next();
        sx = x;
        sy = y;
        points = [x, y];
        result.push(points);
        command = "L";
      } else if (command === "L" && points) {
        x = next();
        y = next();
        points.push(x, y);
      } else if (command === "C" && points) {
        const x1 = next();
        const y1 = next();
        const x2 = next();
        const y2 = next();
        const x3 = next();
        const y3 = next();
        const estimate =
          Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
        const steps = Math.max(3, Math.ceil(estimate / 6));
        for (let k = 1; k <= steps; k++) {
          const u = k / steps;
          const v = 1 - u;
          const a = v * v * v;
          const b = 3 * v * v * u;
          const c = 3 * v * u * u;
          const e = u * u * u;
          points.push(a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3);
        }
        x = x3;
        y = y3;
      } else {
        i++;
      }
    }
    return result.filter((flat) => flat.length >= 4).map(track);
  }

  function makeSprite(color, size = 96) {
    const sprite = surface(size, size);
    const c = sprite.getContext("2d");
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, rgba([255, 255, 255], 1));
    g.addColorStop(0.12, rgba(color, 0.9));
    g.addColorStop(0.35, rgba(color, 0.32));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    return sprite;
  }

  /** A small seeded generator, so a held preview frame comes out the same every time. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The ellipse an orbit runs round: its centre, semi-axes and tilt, from its outline's points. */
  function fitEllipse(parts) {
    const cx = (Math.min(...parts.map((c) => c.minX)) + Math.max(...parts.map((c) => c.maxX))) / 2;
    const cy = (Math.min(...parts.map((c) => c.minY)) + Math.max(...parts.map((c) => c.maxY))) / 2;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const c of parts) {
      for (let k = 0; k < c.xs.length; k++) {
        const dx = c.xs[k] - cx;
        const dy = c.ys[k] - cy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
    }
    const tilt = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    let a = 0;
    let b = 0;
    for (const c of parts) {
      for (let k = 0; k < c.xs.length; k++) {
        const dx = c.xs[k] - cx;
        const dy = c.ys[k] - cy;
        a = Math.max(a, Math.abs(dx * cos + dy * sin));
        b = Math.max(b, Math.abs(-dx * sin + dy * cos));
      }
    }
    return { cx, cy, a, b, tilt };
  }

  function start(canvas, options, post) {
    const ctx = canvas.getContext("2d", { alpha: false });
    const seek = typeof options.seek === "number" ? options.seek : null;
    const rand = mulberry32(seek === null ? Date.now() : 7);
    const raf =
      typeof requestAnimationFrame === "function"
        ? (f) => requestAnimationFrame(f)
        : (f) => setTimeout(() => f(performance.now()), 16);
    const startEpoch = options.start;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let L = null;
    let geo = null;
    let sky = null;
    let stopped = false;
    let frameZero = null;
    let offset = 0;
    let lastT = null;
    let exitAt = null;
    let failed = false;

    const cyan = makeSprite([90, 205, 255]);
    const gold = makeSprite([255, 186, 88]);
    const ice = makeSprite([150, 185, 255]);
    const white = makeSprite([196, 214, 255]);

    const sparks = [];
    // The nearer stars, drawn live so they can twinkle and streak past in the dive.
    const motes = [];

    function resize(w, h, ratio) {
      W = w;
      H = h;
      dpr = ratio;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      const logoH = Math.min(H * 0.62, (W * 0.52 * VIEW_H) / VIEW_W, 700);
      const s = logoH / VIEW_H;
      L = {
        s,
        ox: (W - VIEW_W * s) / 2,
        oy: (H - logoH) / 2 - H * 0.01,
        u: Math.min((W * 0.74) / DIPPER_W, (H * 0.6) / DIPPER_H),
        px: Math.max(0.7, Math.min(W, H) / 900),
        diag: Math.hypot(W, H) / 2,
      };
      if (motes.length === 0) {
        for (let k = 0; k < 90; k++) {
          motes.push({
            fx: rand(),
            fy: rand(),
            r: rand() ** 3,
            phase: rand() * TAU,
            speed: 0.4 + rand() * 1.2,
            warm: rand() < 0.22,
          });
        }
      }
      sky = bakeSky();
    }

    /** The far sky, drawn once per size: deep blue haze, faint stars, a vignette and fine grain. */
    function bakeSky() {
      const layer = surface(canvas.width, canvas.height);
      const g = layer.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#03050b";
      g.fillRect(0, 0, W, H);
      const haze = g.createRadialGradient(W * 0.64, H * 0.3, 0, W * 0.64, H * 0.3, L.diag * 1.1);
      haze.addColorStop(0, "rgba(46,70,150,0.22)");
      haze.addColorStop(0.45, "rgba(22,32,82,0.12)");
      haze.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = haze;
      g.fillRect(0, 0, W, H);
      const low = g.createRadialGradient(W * 0.2, H * 0.85, 0, W * 0.2, H * 0.85, L.diag * 0.7);
      low.addColorStop(0, "rgba(18,86,110,0.1)");
      low.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = low;
      g.fillRect(0, 0, W, H);
      // Faint stars, a third of them crowded into a soft diagonal band.
      const count = Math.round(clamp((W * H) / 1400, 400, 1600));
      for (let k = 0; k < count; k++) {
        let x = rand() * W;
        let y = rand() * H;
        if (k % 3 === 0) {
          const along = rand();
          x = along * W;
          y = H * 0.95 - along * H * 0.9 + (rand() - 0.5) * H * 0.35 * rand();
        }
        const warm = rand() < 0.2;
        g.fillStyle = rgba(warm ? [255, 220, 190] : [200, 215, 255], 0.12 + rand() ** 2 * 0.6);
        g.beginPath();
        g.arc(x, y, 0.25 + rand() ** 4 * 0.9, 0, TAU);
        g.fill();
      }
      const vignette = g.createRadialGradient(
        W / 2,
        H / 2,
        L.diag * 0.35,
        W / 2,
        H / 2,
        L.diag * 1.05,
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.7)");
      g.fillStyle = vignette;
      g.fillRect(0, 0, W, H);
      // Grain, so the dark gradients do not band.
      const tile = surface(96, 96);
      const tc = tile.getContext("2d");
      const noise = tc.createImageData(96, 96);
      for (let i = 0; i < noise.data.length; i += 4) {
        const v = rand() * 255;
        noise.data[i] = v;
        noise.data[i + 1] = v;
        noise.data[i + 2] = v;
        noise.data[i + 3] = 255;
      }
      tc.putImageData(noise, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.022;
      g.fillStyle = g.createPattern(tile, "repeat");
      g.fillRect(0, 0, layer.width, layer.height);
      return layer;
    }

    // Logo space to screen, with the exit zoom.
    let zoom = 1;
    const X = (x) => W / 2 + (L.ox + x * L.s - W / 2) * zoom;
    const Y = (y) => H / 2 + (L.oy + y * L.s - H / 2) * zoom;

    function loadMark() {
      fetch(MARK_URL)
        .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
        .then((svg) => {
          const groups = {};
          for (const m of svg.matchAll(/<path fill="([^"]+)"[^>]*?\sd="([^"]+)"/g)) {
            const key = m[1].includes("#dg")
              ? "glyph"
              : m[1].includes("#dh")
                ? "slash"
                : m[1].includes("#dr")
                  ? "ring"
                  : "star";
            groups[key] = m[2];
          }
          if (!groups.glyph || !groups.ring || !groups.star) throw new Error("mark");
          geo = plan(groups);
          post({ type: "ready" });
        })
        .catch(() => {
          failed = true;
          post({ type: "failed" });
        });
    }

    function plan(groups) {
      const glyph = contours(groups.glyph);
      const slash = groups.slash ? contours(groups.slash) : [];
      const ring = contours(groups.ring);
      const starParts = contours(groups.star).sort((a, b) => b.length - a.length);
      const lo = Math.min(...glyph.map((c) => c.cx));
      const hi = Math.max(...glyph.map((c) => c.cx));
      const longest = Math.max(...glyph.map((c) => c.length));
      for (const c of glyph) {
        c.begin = TRACE_START + ((c.cx - lo) / Math.max(1, hi - lo)) * TRACE_SPREAD + rand() * 60;
        c.duration = 300 + 260 * (c.length / longest);
      }
      slash.forEach((c, k) => {
        c.begin = SLASH_START + k * 70;
        c.duration = 320;
      });
      // The orbit goes round from its left end, the way a body falls into orbit.
      const orbit = fitEllipse(ring);
      const turn = (c) => (Math.atan2(c.cy - orbit.cy, c.cx - orbit.cx) - Math.PI + TAU * 2) % TAU;
      for (const c of ring) {
        c.begin = RING[0] + (turn(c) / TAU) * (RING[1] - RING[0]) * 0.72;
        c.duration = 300;
      }
      const glyphFill = ctx.createLinearGradient(0, 80, 0, 960);
      glyphFill.addColorStop(0, "#ffffff");
      glyphFill.addColorStop(0.55, "#d7deea");
      glyphFill.addColorStop(1, "#9aa7bd");
      const slashFill = ctx.createLinearGradient(0, 80, 0, 960);
      slashFill.addColorStop(0, "#f6cd7a");
      slashFill.addColorStop(1, "#d1922f");
      const ringFill = ctx.createLinearGradient(0, 0, VIEW_W, 0);
      ringFill.addColorStop(0, "rgba(125,155,224,0.25)");
      ringFill.addColorStop(0.5, "rgba(169,196,245,0.85)");
      ringFill.addColorStop(0.806, "#f1f6ff");
      ringFill.addColorStop(1, "rgba(169,196,245,0.6)");
      return {
        glyph,
        slash,
        ring,
        orbit,
        star: starParts[0],
        paths: {
          glyph: new Path2D(groups.glyph),
          slash: groups.slash ? new Path2D(groups.slash) : null,
          ring: new Path2D(groups.ring),
          star: new Path2D(groups.star),
        },
        fills: { glyph: glyphFill, slash: slashFill, ring: ringFill },
      };
    }

    /** Where the mark's star sits on screen, which is where 天枢 comes to rest. */
    function starPoint() {
      return geo ? [X(geo.star.cx), Y(geo.star.cy)] : [W * 0.62, H * 0.45];
    }

    /** The Dipper's place on screen at `t`: 天枢's position, the scale, and its slight turn. */
    function dipperView(t) {
      const e = easeInOutCubic(span(t, DIVE));
      const x0 = W / 2 + (DIPPER[0][0] - DIPPER_MID[0]) * L.u;
      const y0 = H * 0.47 + (DIPPER[0][1] - DIPPER_MID[1]) * L.u;
      const [sx, sy] = starPoint();
      const k = DIVE_ZOOM ** e;
      return {
        x: x0 + (sx - x0) * e,
        y: y0 + (sy - y0) * e,
        u: L.u * k,
        k,
        e,
        turn: -0.06 * (1 - easeOutCubic(span(t, [0, 1300]))),
      };
    }

    function dipperPoint(view, k) {
      const dx = DIPPER[k][0] - DIPPER[0][0];
      const dy = DIPPER[k][1] - DIPPER[0][1];
      const c = Math.cos(view.turn);
      const s = Math.sin(view.turn);
      return [view.x + (dx * c - dy * s) * view.u, view.y + (dx * s + dy * c) * view.u];
    }

    function strokeRing(x, y, r, color, width) {
      if (r <= 0) return;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    /** A four-point star flare. */
    function spike(x, y, len, color, a) {
      if (a <= 0.01 || len <= 1) return;
      const w = Math.max(1, 1.2 * L.px);
      const h = ctx.createLinearGradient(x - len, 0, x + len, 0);
      h.addColorStop(0, rgba(color, 0));
      h.addColorStop(0.5, rgba(color, a));
      h.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = h;
      ctx.fillRect(x - len, y - w / 2, len * 2, w);
      const v = ctx.createLinearGradient(0, y - len * 0.8, 0, y + len * 0.8);
      v.addColorStop(0, rgba(color, 0));
      v.addColorStop(0.5, rgba(color, a));
      v.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = v;
      ctx.fillRect(x - w / 2, y - len * 0.8, w, len * 1.6);
    }

    /** A streak from where a point was a moment ago, stretched so motion reads as speed. */
    function trail(x, y, bx, by, color, a, width) {
      const dx = x - bx;
      const dy = y - by;
      if (Math.hypot(dx, dy) < 2 || a <= 0.01) return;
      const g = ctx.createLinearGradient(x - dx * 4, y - dy * 4, x, y);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(1, rgba(color, a));
      ctx.beginPath();
      ctx.moveTo(x - dx * 4, y - dy * 4);
      ctx.lineTo(x, y);
      ctx.strokeStyle = g;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    function drawSky(t, view) {
      const s = view.k ** 0.08 * zoom;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = easeOutCubic(span(t, [0, 520]));
      ctx.translate(view.x * dpr, view.y * dpr);
      ctx.scale(s, s);
      ctx.translate(-view.x * dpr, -view.y * dpr);
      ctx.drawImage(sky, 0, 0);
      ctx.restore();
    }

    function drawMotes(t, view, before) {
      const s = view.k ** 0.3;
      const s0 = before.k ** 0.3;
      const fadeIn = easeOutCubic(span(t, [80, 700]));
      const streaks = [];
      for (const m of motes) {
        const bx = m.fx * W;
        const by = m.fy * H;
        const x = view.x + (bx - view.x) * s;
        const y = view.y + (by - view.y) * s;
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        const twinkle = 0.5 + 0.5 * Math.sin((t / 1000) * m.speed * Math.PI + m.phase);
        const size = (5 + 9 * m.r) * L.px;
        ctx.globalAlpha = (0.22 + 0.6 * twinkle) * fadeIn;
        ctx.drawImage(m.warm ? gold : white, x - size / 2, y - size / 2, size, size);
        const x0 = before.x + (bx - before.x) * s0;
        const y0 = before.y + (by - before.y) * s0;
        if (Math.hypot(x - x0, y - y0) > 1.5)
          streaks.push(x - (x - x0) * 4, y - (y - y0) * 4, x, y);
      }
      ctx.globalAlpha = 1;
      if (streaks.length === 0) return;
      ctx.beginPath();
      for (let i = 0; i < streaks.length; i += 4) {
        ctx.moveTo(streaks[i], streaks[i + 1]);
        ctx.lineTo(streaks[i + 2], streaks[i + 3]);
      }
      ctx.strokeStyle = "rgba(200,220,255,0.32)";
      ctx.lineWidth = Math.max(1, L.px);
      ctx.stroke();
    }

    function linkWindow(b) {
      return b === 0 ? [STAR_AT[3], STAR_AT[3] + 150] : [STAR_AT[b] - LINK_MS, STAR_AT[b]];
    }

    function drawDipper(t, view, before) {
      const alpha = 1 - view.e;
      if (alpha <= 0.01) return;
      const pts = DIPPER.map((_, k) => dipperPoint(view, k));
      const was = DIPPER.map((_, k) => dipperPoint(before, k));
      for (const [a, b] of LINKS) {
        const [t0, t1] = linkWindow(b);
        const p = easeInOutCubic(span(t, [t0, t1]));
        if (p <= 0) continue;
        const [x1, y1] = pts[a];
        const [x2, y2] = pts[b];
        const hx = x1 + (x2 - x1) * p;
        const hy = y1 + (y2 - y1) * p;
        const settle = p < 1 ? 1 : 0.5 + 0.5 * Math.exp(-(t - t1) / 260);
        const la = settle * alpha ** 1.4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(hx, hy);
        ctx.strokeStyle = rgba([110, 160, 255], 0.13 * la);
        ctx.lineWidth = 6 * L.px;
        ctx.stroke();
        ctx.strokeStyle = rgba([150, 195, 255], 0.38 * la);
        ctx.lineWidth = 2.2 * L.px;
        ctx.stroke();
        ctx.strokeStyle = rgba([235, 245, 255], 0.85 * la);
        ctx.lineWidth = Math.max(0.8, 0.9 * L.px);
        ctx.stroke();
        if (p < 1) {
          const size = 34 * L.px;
          ctx.drawImage(ice, hx - size / 2, hy - size / 2, size, size);
        }
      }
      for (let k = 1; k < DIPPER.length; k++) {
        const tau = t - STAR_AT[k];
        if (tau < 0) continue;
        const [x, y] = pts[k];
        const b = DIPPER[k][2];
        const pop = tau < 70 ? tau / 70 : Math.exp(-(tau - 70) / 260);
        const steady = clamp(tau / 120) * (0.55 + 0.1 * Math.sin(t / 170 + k * 1.7));
        const I = Math.max(pop, steady) * alpha;
        const glow = (18 + 34 * b) * L.px * (0.7 + 0.6 * I);
        trail(x, y, was[k][0], was[k][1], [200, 220, 255], 0.6 * alpha, (1 + 1.5 * b) * L.px);
        ctx.globalAlpha = clamp(I);
        ctx.drawImage(white, x - glow / 2, y - glow / 2, glow, glow);
        ctx.globalAlpha = 1;
        spike(x, y, (14 + (40 + 60 * b) * pop) * L.px, [215, 230, 255], 0.75 * I);
        if (tau < 520) {
          const w = tau / 520;
          const r = (4 + 34 * easeOutCubic(w)) * L.px;
          strokeRing(x, y, r, rgba([200, 220, 255], 0.5 * (1 - w) ** 2 * alpha), 1.2 * L.px);
        }
        ctx.fillStyle = rgba([255, 255, 255], 0.6 + 0.4 * I);
        ctx.beginPath();
        ctx.arc(x, y, (1.1 + 1.1 * b) * L.px, 0, TAU);
        ctx.fill();
      }
    }

    /** A sighting reticle closes round 天枢, with its catalogue line typed out beside it. */
    function drawReticle(t, view) {
      const p = easeOutCubic(span(t, RETICLE));
      const a = p * (1 - span(t, [DIVE[0] + 120, DIVE[0] + 360]));
      if (a <= 0.01) return;
      const { x, y } = view;
      const r = (30 + 16 * (1 - p)) * L.px * (1 + view.e * 0.6);
      const spin = t / 1400;
      ctx.lineWidth = Math.max(1, 1.1 * L.px);
      ctx.beginPath();
      for (let q = 0; q < 4; q++) {
        const s0 = spin + (q * TAU) / 4 + 0.25;
        ctx.moveTo(x + Math.cos(s0) * r, y + Math.sin(s0) * r);
        ctx.arc(x, y, r, s0, s0 + TAU / 4 - 0.5);
      }
      ctx.strokeStyle = rgba([150, 200, 255], 0.75 * a);
      ctx.stroke();
      ctx.beginPath();
      const ticks = 36;
      for (let q = 0; q < ticks * p; q++) {
        const angle = -spin * 0.6 + (q * TAU) / ticks;
        const r1 = r + 5 * L.px;
        const r2 = r1 + (q % 9 === 0 ? 7 : 3) * L.px;
        ctx.moveTo(x + Math.cos(angle) * r1, y + Math.sin(angle) * r1);
        ctx.lineTo(x + Math.cos(angle) * r2, y + Math.sin(angle) * r2);
      }
      for (let q = 0; q < 4; q++) {
        const angle = (q * TAU) / 4;
        ctx.moveTo(x + Math.cos(angle) * (r + 14 * L.px), y + Math.sin(angle) * (r + 14 * L.px));
        ctx.lineTo(x + Math.cos(angle) * (r + 26 * L.px), y + Math.sin(angle) * (r + 26 * L.px));
      }
      ctx.strokeStyle = rgba([150, 200, 255], 0.45 * a);
      ctx.stroke();
      const size = Math.max(10, 12 * L.px);
      const tx = x - r - 34 * L.px;
      ctx.beginPath();
      ctx.moveTo(x - r - 28 * L.px, y);
      ctx.lineTo(tx - 4 * L.px, y);
      ctx.strokeStyle = rgba([150, 200, 255], 0.35 * a);
      ctx.stroke();
      const typed = (text, window) => text.slice(0, Math.floor(text.length * span(t, window)));
      ctx.font = `500 ${size}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rgba([196, 222, 255], 0.9 * a);
      ctx.fillText(
        typed(DUBHE_LABEL, [RETICLE[0] + 30, RETICLE[0] + 150]),
        tx - 10 * L.px,
        y - size * 0.8,
      );
      ctx.fillStyle = rgba([140, 170, 220], 0.65 * a);
      ctx.fillText(
        typed(DUBHE_COORDS, [RETICLE[0] + 80, RETICLE[0] + 260]),
        tx - 10 * L.px,
        y + size * 0.9,
      );
    }

    /** 天枢 itself, from its first light to the moment it ignites in the mark. */
    function drawTianshu(t, view, before) {
      const tau = t - STAR_AT[0];
      if (tau < 0) return;
      const { x, y } = view;
      const pop = tau < 70 ? tau / 70 : Math.exp(-(tau - 70) / 300);
      const charge = span(t, [IGNITE - 700, IGNITE]) ** 2;
      const steady = clamp(tau / 120) * (0.62 + 0.08 * Math.sin(t / 160));
      const I = Math.max(pop, steady) + charge * 0.9;
      trail(x, y, before.x, before.y, [255, 214, 160], 0.7, 2.4 * L.px);
      const glow = (30 + 46 * I) * L.px;
      ctx.drawImage(gold, x - glow / 2, y - glow / 2, glow, glow);
      spike(x, y, (20 + 110 * pop + 70 * charge) * L.px, [255, 214, 160], 0.8 * clamp(I));
      if (tau < 600) {
        const w = tau / 600;
        const r = (5 + 48 * easeOutCubic(w)) * L.px;
        strokeRing(x, y, r, rgba([255, 200, 130], 0.55 * (1 - w) ** 2), 1.4 * L.px);
      }
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x, y, (2.2 + 1.4 * charge) * L.px, 0, TAU);
      ctx.fill();
    }

    function tracePart(c, distance, heads) {
      const { xs, ys, at } = c;
      ctx.moveTo(X(xs[0]), Y(ys[0]));
      let k = 1;
      for (; k < xs.length && at[k] <= distance; k++) ctx.lineTo(X(xs[k]), Y(ys[k]));
      if (k >= xs.length) return;
      const f = (distance - at[k - 1]) / Math.max(1e-6, at[k] - at[k - 1]);
      const hx = X(xs[k - 1] + (xs[k] - xs[k - 1]) * f);
      const hy = Y(ys[k - 1] + (ys[k] - ys[k - 1]) * f);
      ctx.lineTo(hx, hy);
      heads.push(hx, hy);
    }

    const lasers = {
      glyph: { glow: [70, 200, 255], core: [236, 252, 255], sprite: cyan, spark: [150, 230, 255] },
      slash: { glow: [255, 150, 40], core: [255, 242, 214], sprite: gold, spark: [255, 200, 120] },
      ring: { glow: [120, 160, 255], core: [236, 242, 255], sprite: ice, spark: [190, 210, 255] },
    };

    function drawLaserGroup(contourList, style, t, fade, source) {
      const heads = [];
      ctx.beginPath();
      let any = false;
      for (const c of contourList) {
        const p = easeInOutCubic(span(t, [c.begin, c.begin + c.duration]));
        if (p <= 0) continue;
        any = true;
        tracePart(c, p * c.length, heads);
      }
      if (!any) return;
      const width = Math.max(1.1, L.s * 2.4);
      ctx.strokeStyle = rgba(style.glow, 0.16 * fade);
      ctx.lineWidth = width * 6.5;
      ctx.stroke();
      ctx.strokeStyle = rgba(style.glow, 0.42 * fade);
      ctx.lineWidth = width * 2.2;
      ctx.stroke();
      ctx.strokeStyle = rgba(style.core, 0.95 * fade);
      ctx.lineWidth = width;
      ctx.stroke();
      if (heads.length === 0) return;
      // 天枢 drives the cutting: a faint beam from it to every other head.
      if (source) {
        ctx.beginPath();
        for (let i = 0; i < heads.length; i += 4) {
          ctx.moveTo(source[0], source[1]);
          ctx.lineTo(heads[i], heads[i + 1]);
        }
        ctx.strokeStyle = rgba(style.glow, 0.09);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      const size = Math.max(22, L.s * 58);
      for (let i = 0; i < heads.length; i += 2) {
        ctx.drawImage(style.sprite, heads[i] - size / 2, heads[i + 1] - size / 2, size, size);
        if (sparks.length < 600 && rand() < 0.8) {
          const a = rand() * TAU;
          const v = 0.04 + rand() * 0.3;
          const life = 220 + rand() * 420;
          sparks.push({
            x: heads[i],
            y: heads[i + 1],
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            life,
            max: life,
            color: style.spark,
          });
        }
      }
    }

    function drawSparks(dt) {
      const groups = new Map();
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        const drag = 0.985 ** (dt / 16);
        s.vx *= drag;
        s.vy *= drag;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const bright = s.life / s.max > 0.5;
        const key = `${s.color.join(",")}|${bright ? 1 : 0}`;
        if (!groups.has(key)) groups.set(key, { color: s.color, bright, segs: [] });
        groups.get(key).segs.push(s.x, s.y, s.x - s.vx * 14, s.y - s.vy * 14);
      }
      for (const g of groups.values()) {
        ctx.beginPath();
        for (let i = 0; i < g.segs.length; i += 4) {
          ctx.moveTo(g.segs[i], g.segs[i + 1]);
          ctx.lineTo(g.segs[i + 2], g.segs[i + 3]);
        }
        ctx.strokeStyle = rgba(g.color, g.bright ? 0.85 : 0.38);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /** Draws in the mark's own coordinates. */
    function inMark(body) {
      const k = L.s * zoom;
      ctx.save();
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * X(0), dpr * Y(0));
      body();
      ctx.restore();
    }

    function drawFill(t) {
      const f = easeOutCubic(span(t, FILL));
      if (f <= 0) return;
      inMark(() => {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = f;
        ctx.fillStyle = geo.fills.ring;
        ctx.fill(geo.paths.ring);
        ctx.fillStyle = geo.fills.glyph;
        ctx.fill(geo.paths.glyph);
        if (geo.paths.slash) {
          ctx.fillStyle = geo.fills.slash;
          ctx.fill(geo.paths.slash);
        }
        ctx.fillStyle = "#ffd98a";
        ctx.fill(geo.paths.star);
        const sweep = span(t, [FILL[0], FILL[1] + 120]);
        if (sweep >= 1) return;
        // A band of light passes over the glyphs as they fill.
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
        ctx.clip(geo.paths.glyph);
        const bx = -260 + (VIEW_W + 520) * easeInOutCubic(sweep);
        const band = ctx.createLinearGradient(bx - 150, 0, bx + 150, 0);
        band.addColorStop(0, "rgba(170,230,255,0)");
        band.addColorStop(0.5, "rgba(205,242,255,0.9)");
        band.addColorStop(1, "rgba(170,230,255,0)");
        ctx.fillStyle = band;
        ctx.fillRect(bx - 150, 0, 300, VIEW_H);
      });
    }

    /** Once the mark is lit, a glint keeps going round the orbit, inside the ring's own band. */
    function drawOrbitGlint(t) {
      const a = span(t, [FILL[0] + 150, FILL[1] + 100]);
      if (a <= 0) return;
      const o = geo.orbit;
      const ra = o.a - 12;
      const rb = o.b - 12;
      const phi = 2.2 + ((t - FILL[0]) / ORBIT_MS) * TAU;
      const gx =
        o.cx + ra * Math.cos(phi) * Math.cos(o.tilt) - rb * Math.sin(phi) * Math.sin(o.tilt);
      const gy =
        o.cy + ra * Math.cos(phi) * Math.sin(o.tilt) + rb * Math.sin(phi) * Math.cos(o.tilt);
      let onRing = false;
      inMark(() => {
        ctx.globalCompositeOperation = "lighter";
        onRing = ctx.isPointInPath(geo.paths.ring, dpr * X(gx), dpr * Y(gy));
        ctx.clip(geo.paths.ring);
        ctx.lineWidth = 40;
        for (let i = 0; i < 12; i++) {
          ctx.beginPath();
          ctx.ellipse(o.cx, o.cy, ra, rb, o.tilt, phi - (i + 1) * 0.05, phi - i * 0.05);
          ctx.strokeStyle = rgba([210, 232, 255], a * 0.8 * (1 - i / 12) ** 2);
          ctx.stroke();
        }
      });
      if (!onRing) return;
      const size = Math.max(18, L.s * 70);
      ctx.globalAlpha = a * 0.85;
      ctx.drawImage(ice, X(gx) - size / 2, Y(gy) - size / 2, size, size);
      ctx.globalAlpha = 1;
    }

    function drawIgnition(tau, t) {
      const [sx, sy] = starPoint();
      if (tau < 700) {
        // A bloom round the star, not a flash over the whole screen.
        const a = 0.2 * (1 - tau / 700) ** 2;
        const bloom = ctx.createRadialGradient(sx, sy, 0, sx, sy, L.diag * 0.75);
        bloom.addColorStop(0, rgba([255, 236, 200], a));
        bloom.addColorStop(0.3, rgba([255, 200, 140], a * 0.3));
        bloom.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = bloom;
        ctx.fillRect(0, 0, W, H);
      }
      const wave = tau / 1100;
      if (wave < 1) {
        const r = easeOutCubic(wave) * L.diag * 1.1;
        const a = (1 - wave) ** 2;
        strokeRing(sx, sy, r, rgba([255, 200, 130], a * 0.35), (1 + 3 * (1 - wave)) * L.px);
        strokeRing(sx, sy, r * 0.94, rgba([120, 200, 255], a * 0.22), (1 + 2 * (1 - wave)) * L.px);
      }
      const burst = tau < 110 ? tau / 110 : Math.exp(-(tau - 110) / 420);
      const twinkle = 0.2 + 0.06 * Math.sin(t / 150) + (exitAt === null ? 0 : 0.2);
      const I = Math.max(burst, twinkle);
      const glow = (60 + 260 * I) * L.px;
      ctx.drawImage(gold, sx - glow / 2, sy - glow / 2, glow, glow);
      // Anamorphic lens streak.
      const len = 40 + W * 0.45 * I;
      const streak = ctx.createLinearGradient(sx - len, 0, sx + len, 0);
      streak.addColorStop(0, "rgba(110,180,255,0)");
      streak.addColorStop(0.5, rgba([230, 244, 255], 0.95 * I));
      streak.addColorStop(1, "rgba(110,180,255,0)");
      ctx.fillStyle = streak;
      ctx.fillRect(sx - len, sy - 1.2, len * 2, 2.4);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(sx - len, sy - 6, len * 2, 12);
      ctx.globalAlpha = 1;
      spike(sx, sy, (24 + H * 0.2 * I) * 0.8, [255, 226, 186], 0.6 * I);
    }

    function draw(t, dt) {
      zoom = exitAt === null ? 1 : 1 + 0.07 * easeOutCubic(span(t, [exitAt, exitAt + EXIT_MS]));
      const view = dipperView(t);
      const before = dipperView(Math.max(0, t - 28));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      drawSky(t, view);
      ctx.globalCompositeOperation = "lighter";
      drawMotes(t, view, before);
      if (t < DIVE[1] + 40) {
        drawDipper(t, view, before);
        drawReticle(t, view);
      }
      if (geo) {
        const fade = 1 - span(t, [FILL[0] + 80, FILL[1] + 260]) * 0.85;
        const source = t < IGNITE ? [view.x, view.y] : null;
        drawLaserGroup(geo.glyph, lasers.glyph, t, fade, source);
        if (geo.slash.length) drawLaserGroup(geo.slash, lasers.slash, t, fade, source);
        drawLaserGroup(geo.ring, lasers.ring, t, fade, source);
        drawSparks(dt);
        drawFill(t);
        ctx.globalCompositeOperation = "lighter";
        if (t >= IGNITE) {
          drawOrbitGlint(t);
          drawIgnition(t - IGNITE, t);
        }
      }
      if (t < IGNITE) drawTianshu(t, view, before);
    }

    function frame(now) {
      if (stopped) return;
      if (seek !== null) {
        // Preview: run the timeline up to `seek` in fixed steps and hold that frame.
        if (!geo && !failed) {
          raf(frame);
          return;
        }
        for (let t = 0; t <= seek; t += 16) draw(t, 16);
        stopped = true;
        post({ type: "held" });
        return;
      }
      if (frameZero === null) {
        frameZero = now;
        offset = Date.now() - startEpoch;
      }
      const t = offset + (now - frameZero);
      const dt = lastT === null ? 16 : clamp(t - lastT, 0, 50);
      lastT = t;
      if (!failed) draw(t, dt);
      if (exitAt !== null && t - exitAt > EXIT_MS + 60) {
        stopped = true;
        post({ type: "done" });
        return;
      }
      raf(frame);
    }

    resize(options.w, options.h, options.dpr);
    loadMark();
    raf(frame);
    return {
      message(m) {
        if (m.type === "resize") resize(m.w, m.h, m.dpr);
        else if (m.type === "exit" && exitAt === null) exitAt = lastT ?? 0;
      },
      stop() {
        stopped = true;
      },
    };
  }

  const isWorker =
    typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope;
  if (isWorker) {
    let intro = null;
    globalThis.addEventListener("message", (event) => {
      const m = event.data;
      if (m.type === "init") intro = start(m.canvas, m, (msg) => globalThis.postMessage(msg));
      else intro?.message(m);
    });
  } else {
    globalThis.TianshuIntro = { start };
  }
})();
