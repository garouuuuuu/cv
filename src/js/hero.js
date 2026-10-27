/* hero.js: the NAME section.
   1. Banner. The figlet text in [data-banner] is redrawn as an inline SVG built at runtime from
      that same text: merged runs of full blocks plus the box-drawing shadow as thin double
      strokes, every edge on the device-pixel grid so the letters stay seamless at any DPR.
      On load a left-to-right sweep steps each cell through the shade ramp (░ ▒ ▓ █, as stepped
      dither patterns). If the text banner has already been painted, the sweep never erases it:
      each cell dips through ▓ ▒ ░ and back to █ instead of building up from nothing.
   2. Wildcard. A rotating 3D asterisk drawn with characters, donut.c style: three capsule bars
      sampled as a surface with normals, projected each frame onto a character grid with a
      per-cell z-buffer, lit by a slowly moving light and mapped to a luminance ramp. Rows are
      drawn batched by color tier. It sways on its own and always faces the viewer; a drag on it
      turns it like a dial (mouse) or a wheel (touch), and the caption reads out its rotation
      while it is held. */
(function () {
  "use strict";
  const LP = window.LP;
  if (!LP) return;

  // Has the text banner been on screen yet? hero.html sets data-painted from a frame callback
  // queued right after the banner markup; a frame seen since this script ran, or a recorded
  // paint, counts as well.
  let framed = false;
  requestAnimationFrame(() => (framed = true));
  const painted = (hero) =>
    framed ||
    hero.hasAttribute("data-painted") ||
    document.documentElement.hasAttribute("data-painted") ||
    !!(performance.getEntriesByType && performance.getEntriesByType("paint").length);

  LP.module("hero", () => {
    const hero = document.querySelector("[data-hero]");
    if (!hero) return;
    initBanner(hero);
    initWildcard(hero);
  });

  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  };

  // Calls fn whenever the device pixel ratio changes (browser zoom, a move to another screen).
  function watchResolution(fn) {
    if (!window.matchMedia) return;
    const arm = () => {
      const q = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
      if (!q.addEventListener) return;
      const on = () => {
        q.removeEventListener("change", on);
        fn();
        arm();
      };
      q.addEventListener("change", on);
    };
    arm();
  }

  /* ================================================================ banner */

  const SVG_NS = "http://www.w3.org/2000/svg";
  const SHADOW = "═║╔╗╚╝";
  const BANNER = {
    ratio: 1.7, // cell height / cell width, as in the text rendering (0.6em advance, 1.02 line height)
    maxCell: 15, // CSS px, the same cap as the text banner (25px font)
    step: 55, // ms per shade step: ░ ▒ ▓ then █
    sweep: 720, // ms for the front to cross the full banner width
    lag: 120, // ms between the two words
    colJitter: 80,
    cellJitter: 30,
  };
  // The dip a painted cell takes when the front passes: ▓ ▒ ░ ▒ ▓, then █ again.
  const PASS = [3, 2, 1, 2, 3];

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Clockwise rectangle subpath: overlapping rectangles in one path union cleanly (nonzero rule).
  const rect = (x, y, w, h) => "M" + x + " " + y + "h" + w + "v" + h + "h" + -w + "z";

  /** Double-line box-drawing glyph inside the cell at (x0, y0), as rectangles on whole device pixels. */
  function glyph(ch, x0, y0, m) {
    const { W, H, t, g } = m;
    const band = 2 * t + g;
    const x1 = x0 + Math.floor((W - band) / 2);
    const x2 = x1 + t + g;
    const y1 = y0 + Math.floor((H - band) / 2);
    const y2 = y1 + t + g;
    const R = x0 + W;
    const B = y0 + H;
    switch (ch) {
      case "═":
        return rect(x0, y1, W, t) + rect(x0, y2, W, t);
      case "║":
        return rect(x1, y0, t, H) + rect(x2, y0, t, H);
      case "╔":
        return rect(x1, y1, R - x1, t) + rect(x1, y1, t, B - y1) + rect(x2, y2, R - x2, t) + rect(x2, y2, t, B - y2);
      case "╗":
        return rect(x0, y1, x2 + t - x0, t) + rect(x2, y1, t, B - y1) + rect(x0, y2, x1 + t - x0, t) + rect(x1, y2, t, B - y2);
      case "╚":
        return rect(x1, y0, t, y2 + t - y0) + rect(x1, y2, R - x1, t) + rect(x2, y0, t, y1 + t - y0) + rect(x2, y1, R - x2, t);
      case "╝":
        return rect(x2, y0, t, y2 + t - y0) + rect(x0, y2, x2 + t - x0, t) + rect(x1, y0, t, y1 + t - y0) + rect(x0, y1, x1 + t - x0, t);
      default:
        return "";
    }
  }

  function initBanner(hero) {
    const text = hero.querySelector("[data-banner]");
    const wrap = text && text.parentElement;
    if (!text || !wrap) return;

    // Parse the figlet text into a grid of cells.
    const lines = text.textContent.replace(/\r/g, "").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const grid = lines.map((l) => Array.from(l.replace(/\s+$/, "")));
    const nRows = grid.length;
    const nCols = grid.reduce((n, r) => Math.max(n, r.length), 0);
    if (!nRows || !nCols) return;

    // Words are runs of non-empty rows; the second word sweeps in slightly later.
    const word = [];
    let w = 0;
    let gap = false;
    grid.forEach((r, y) => {
      if (!r.length) {
        word[y] = -1;
        gap = true;
        return;
      }
      if (gap && y > 0) w++;
      gap = false;
      word[y] = w;
    });

    const rnd = LP.prng(1137);
    const colJitter = new Map();
    const cells = [];
    grid.forEach((r, y) =>
      r.forEach((ch, x) => {
        const block = ch === "█";
        if (!block && !SHADOW.includes(ch)) return;
        const key = word[y] * 1000 + x;
        if (!colJitter.has(key)) colJitter.set(key, rnd() * BANNER.colJitter);
        const at = word[y] * BANNER.lag + (x / nCols) * BANNER.sweep + colJitter.get(key) + rnd() * BANNER.cellJitter;
        cells.push({ x, y, ch, block, at, s: -1, el: null, dCell: "", dFinal: "" });
      })
    );
    if (!cells.length) return;

    const svg = svgEl("svg", {
      class: "banner-svg",
      "aria-hidden": "true",
      focusable: "false",
      "shape-rendering": "crispEdges",
      preserveAspectRatio: "xMinYMin meet",
    });

    let m = null; // metrics in device pixels
    let finalG = null;
    let revealG = null;
    // "reveal" builds the name up from nothing, for a banner nobody has seen yet. "pass" runs
    // over a banner that is already on screen, so the name stays readable the whole time.
    const sweep = LP.reducedMotion() || !inViewport(wrap) ? "" : painted(hero) ? "pass" : "reveal";
    const span = (sweep === "pass" ? PASS.length : 3) * BANNER.step; // per cell, after its start
    let revealing = !!sweep;
    let revealStart = 0;

    function build(availCss) {
      if (!availCss) return false;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(3, Math.floor(Math.min(BANNER.maxCell, availCss / nCols) * dpr));
      if (m && m.W === W && m.dpr === dpr) return false;
      m = {
        W,
        H: Math.round(W * BANNER.ratio),
        dpr,
        t: Math.max(1, Math.round(W * 0.11)), // stroke
        g: Math.max(1, Math.round(W * 0.2)), // gap between the two strokes
        d: Math.max(1, Math.round(W / 5)), // dither dot
      };
      const wDev = nCols * m.W;
      const hDev = nRows * m.H;
      svg.setAttribute("viewBox", "0 0 " + wDev + " " + hDev);
      svg.style.width = wDev / dpr + "px";
      svg.style.height = hDev / dpr + "px";
      svg.textContent = "";
      svg.appendChild(buildDefs());
      finalG = buildFinal();
      svg.appendChild(finalG);
      revealG = null;
      if (revealing) {
        finalG.style.display = "none";
        revealG = buildReveal();
        svg.appendChild(revealG);
      }
      return true;
    }

    // Shade ramp as dither patterns anchored to the SVG origin, so neighbouring cells tile seamlessly.
    function buildDefs() {
      const defs = svgEl("defs");
      const d = m.d;
      const shade = {
        1: { w: 4 * d, h: 2 * d, p: rect(0, 0, d, d) + rect(2 * d, d, d, d) }, // ░ 25%
        2: { w: 2 * d, h: 2 * d, p: rect(0, 0, d, d) + rect(d, d, d, d) }, // ▒ 50%
        3: { w: 4 * d, h: 2 * d, p: rect(d, 0, 3 * d, d) + rect(0, d, 2 * d, d) + rect(3 * d, d, d, d) }, // ▓ 75%
      };
      ["b", "s"].forEach((kind) => {
        [1, 2, 3].forEach((lvl) => {
          const s = shade[lvl];
          const p = svgEl("pattern", { id: "hero-shade-" + kind + lvl, patternUnits: "userSpaceOnUse", width: s.w, height: s.h });
          p.appendChild(svgEl("path", { class: kind === "b" ? "hb-pb" : "hb-ps", d: s.p }));
          defs.appendChild(p);
        });
      });
      return defs;
    }

    // Resting geometry: one group per row (rects for merged runs of blocks, one path for the strokes).
    function buildFinal() {
      const g = svgEl("g", { class: "hb-final" });
      grid.forEach((r, y) => {
        if (!r.length) return;
        const row = svgEl("g", { class: "hb-row" });
        let strokes = "";
        for (let x = 0; x < r.length; ) {
          if (r[x] === "█") {
            let e = x;
            while (e < r.length && r[e] === "█") e++;
            row.appendChild(svgEl("rect", { class: "hb-b", x: x * m.W, y: y * m.H, width: (e - x) * m.W, height: m.H }));
            x = e;
          } else {
            if (SHADOW.includes(r[x])) strokes += glyph(r[x], x * m.W, y * m.H, m);
            x++;
          }
        }
        if (strokes) row.appendChild(svgEl("path", { class: "hb-s", d: strokes }));
        g.appendChild(row);
      });
      return g;
    }

    // Reveal geometry: one path per cell, so each cell can step through the ramp on its own.
    function buildReveal() {
      const g = svgEl("g", { class: "hb-reveal" });
      cells.forEach((c) => {
        const x = c.x * m.W;
        const y = c.y * m.H;
        c.dCell = rect(x, y, m.W, m.H);
        c.dFinal = c.block ? c.dCell : glyph(c.ch, x, y, m);
        c.el = svgEl("path", { class: c.block ? "hb-b" : "hb-s", d: c.dCell });
        // A rebuild mid-sweep (resize) keeps each cell's shade; a fresh one starts at the
        // sweep's resting end: nothing for a reveal, the full cell for a pass.
        const s = c.s >= 0 ? c.s : sweep === "pass" ? 4 : 0;
        c.s = -1;
        apply(c, s);
        g.appendChild(c.el);
      });
      return g;
    }

    /** The shade of cell c at e ms into the sweep: 0 hidden, 1-3 the dithers, 4 full. */
    function shadeAt(c, e) {
      if (e < c.at) return sweep === "pass" ? 4 : 0;
      const k = Math.floor((e - c.at) / BANNER.step);
      if (sweep === "pass") return k < PASS.length ? PASS[k] : 4;
      return Math.min(4, 1 + k);
    }

    function apply(c, s) {
      if (s === c.s || !c.el) return;
      c.s = s;
      const el = c.el;
      if (s === 0) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "";
      if (s < 4) {
        el.style.fill = "url(#hero-shade-" + (c.block ? "b" : "s") + s + ")";
        if (!c.block) el.setAttribute("d", c.dCell);
      } else {
        el.style.fill = "";
        if (!c.block) el.setAttribute("d", c.dFinal);
      }
    }

    function revealTick(now) {
      if (!revealing) return;
      if (!revealStart) revealStart = now;
      const e = now - revealStart;
      let done = true;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const s = shadeAt(c, e);
        if (s !== c.s) apply(c, s);
        if (e < c.at + span) done = false;
      }
      if (done) finishReveal();
      else requestAnimationFrame(revealTick);
    }

    function finishReveal() {
      revealing = false;
      if (revealG) revealG.remove();
      revealG = null;
      cells.forEach((c) => {
        c.el = null;
        c.s = 4;
      });
      if (finalG) finalG.style.display = "";
    }

    // Build synchronously, so the SVG takes over from the text in the same frame.
    build(wrap.getBoundingClientRect().width);
    wrap.insertBefore(svg, wrap.firstChild);
    wrap.classList.add("is-svg");

    LP.onResize(wrap, (width) => build(width));

    // A DPR change (zoom, moving the window to another screen) needs new pixel-snapped geometry.
    watchResolution(() => {
      m = null;
      build(wrap.getBoundingClientRect().width);
    });

    if (LP.onReducedMotionChange) {
      LP.onReducedMotionChange((reduced) => {
        if (reduced && revealing) finishReveal();
      });
    }

    if (revealing) requestAnimationFrame(revealTick);
  }

  /* ================================================================ wildcard */

  const RAMP = " .:-=+*#%@";
  const RAMP_CODES = Array.from(RAMP, (ch) => ch.charCodeAt(0));
  // Ramp index to color tier: 0 dim (--red-2), 1 mid (--red), 2 highlight (--fg, "@" only).
  const TIER = [-1, 0, 0, 0, 1, 1, 1, 1, 1, 2];
  const NOISE_CODES = Array.from("*+=-:.#%@/\\|<>x01", (ch) => ch.charCodeAt(0));
  const SPACE = 32;

  const OBJ = {
    radius: 0.19, // bar radius
    half: 0.8, // center to cap center; tips reach half + radius
    dist: 3.6, // camera distance
    fill: 0.9, // share of the grid the object may span
    spin: 0.22, // rad/s about the asterisk's own axis
    wobble: [0.42, 0.3], // rad, yaw and pitch amplitude of the idle sway
    yawMax: 0.44, // rad (about 25 degrees): past this the side arms start to fold onto each other
    still: { roll: 0.47, pitch: 0.3, yaw: 0.16 }, // reduced-motion pose
    readout: 1.2, // s the rotation readout stays in the caption after a drag
    resolve: 1.15, // s: load-time resolve from random characters
    fps: 30, // render cap
    grid: true, // faint graticule dots on empty cells
  };

  // Three coplanar bars at 60 degrees through the origin: the asterisk glyph, given thickness.
  const AXES = [0, 1, 2].map((k) => [Math.cos(Math.PI / 2 + (k * Math.PI) / 3), Math.sin(Math.PI / 2 + (k * Math.PI) / 3), 0]);

  /** Surface samples (positions with normals) of capsule bars: [x, y, z, nx, ny, nz] * n. */
  function asteriskSamples(spacing) {
    const R = OBJ.radius;
    const HALF = OBJ.half;
    const out = [];
    const push = (x, y, z, nx, ny, nz) => out.push(x, y, z, nx, ny, nz);
    const nP = Math.max(10, Math.ceil((2 * Math.PI * R) / spacing));
    const nS = Math.max(8, Math.ceil((2 * HALF) / spacing));
    const nB = Math.max(3, Math.ceil(((Math.PI / 2) * R) / spacing));
    AXES.forEach((a) => {
      // Orthonormal frame (a, u, v) around the bar axis.
      const ref = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      let u = [a[1] * ref[2] - a[2] * ref[1], a[2] * ref[0] - a[0] * ref[2], a[0] * ref[1] - a[1] * ref[0]];
      const ul = Math.hypot(u[0], u[1], u[2]);
      u = [u[0] / ul, u[1] / ul, u[2] / ul];
      const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
      // Cylinder, alternate rings offset by half a step for even coverage.
      for (let i = 0; i < nS; i++) {
        const s = -HALF + ((i + 0.5) * 2 * HALF) / nS;
        for (let j = 0; j < nP; j++) {
          const ph = ((j + (i & 1) * 0.5) * 2 * Math.PI) / nP;
          const c = Math.cos(ph);
          const sn = Math.sin(ph);
          const nx = c * u[0] + sn * v[0];
          const ny = c * u[1] + sn * v[1];
          const nz = c * u[2] + sn * v[2];
          push(s * a[0] + R * nx, s * a[1] + R * ny, s * a[2] + R * nz, nx, ny, nz);
        }
      }
      // Hemispherical caps, ring by ring.
      for (let sign = -1; sign <= 1; sign += 2) {
        for (let b = 0; b < nB; b++) {
          const beta = ((b + 0.5) * Math.PI) / 2 / nB;
          const cb = Math.cos(beta);
          const sb = Math.sin(beta);
          const ring = Math.max(1, Math.round(nP * sb));
          for (let j = 0; j < ring; j++) {
            const ph = ((j + (b & 1) * 0.5) * 2 * Math.PI) / ring;
            const c = Math.cos(ph);
            const sn = Math.sin(ph);
            const nx = sign * cb * a[0] + sb * (c * u[0] + sn * v[0]);
            const ny = sign * cb * a[1] + sb * (c * u[1] + sn * v[1]);
            const nz = sign * cb * a[2] + sb * (c * u[2] + sn * v[2]);
            push(sign * HALF * a[0] + R * nx, sign * HALF * a[1] + R * ny, sign * HALF * a[2] + R * nz, nx, ny, nz);
          }
        }
      }
    });
    return Float32Array.from(out);
  }

  function initWildcard(hero) {
    const fig = hero.querySelector(".hero__art");
    const canvas = fig && fig.querySelector("[data-hero-canvas]");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The caption names the object; while it is held it reads out the rotation instead.
    const hudRot = fig.querySelector("[data-hud-rot]");
    const caption = hudRot ? hudRot.textContent : "";

    const css = (name) => {
      const c = LP.color(name);
      return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + c[3] + ")";
    };
    // Tier colors: dim, mid, highlight, and load-time noise.
    const COLORS = [css("--red-2"), css("--red"), css("--fg"), css("--red-4")];
    const WEIGHTS = [500, 500, 700, 500];

    // Canvas and character grid, in device pixels.
    let cssW = 0;
    let cw = 0;
    let fontPx = 0;
    let cellW = 0;
    let cellH = 0;
    let cols = 0;
    let rows = 0;
    let gx = 0;
    let gy = 0;
    let K = 0;
    let spacing = 0;
    let samples = null;
    let zbuf = null;
    let lum = null;
    let lock = null;
    let noise = null;
    let bufs = null;
    let lines = null;
    let ready = false;

    // Orientation: M = Rx(pitch) * Ry(yaw) * Rz(roll). roll spins the asterisk about its own
    // axis (it faces the viewer at rest); pitch and yaw only sway it, within OBJ.yawMax, so all
    // six arms always read. A drag turns roll.
    let roll = OBJ.still.roll;
    let pitch = OBJ.still.pitch;
    let yaw = OBJ.still.yaw;
    let rollVel = OBJ.spin;
    let dragging = false;
    let turned = false; // this drag has actually turned the object (not just started a scroll)
    let center = null; // the canvas center in client px, read once per drag
    let dragVel = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let time = 0;
    let resolveT = OBJ.resolve; // >= OBJ.resolve means resolved
    let acc = 0;
    let hudT = -1;
    let readout = false; // the caption currently shows the rotation
    let readoutUntil = -1; // time until which it keeps showing it after a release

    function setFont(tier) {
      ctx.font = WEIGHTS[tier] + " " + fontPx + 'px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
    }

    function prepContext() {
      // Ligatures and kerning would merge pairs like "==" or "--" and break the cell grid.
      if ("textRendering" in ctx) ctx.textRendering = "optimizeSpeed";
      else if ("letterSpacing" in ctx) ctx.letterSpacing = "0.01px";
      if ("fontKerning" in ctx) ctx.fontKerning = "none";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
    }

    function layout() {
      if (!cssW || !ready) return;
      const dpr = LP.dpr(2);
      cw = Math.max(1, Math.round(cssW * dpr));
      canvas.width = cw;
      canvas.height = cw;
      prepContext();
      // About 64 columns on desktop and 40 on phones, never under 6 device px per glyph. Some
      // platforms round text advances to whole pixels, so size the font by its measured advance.
      const phone = window.innerWidth < 600;
      let target = phone ? LP.clamp(Math.round(cssW / 6.8), 32, 44) : LP.clamp(Math.round(cssW / 5.2), 44, 64);
      target = Math.max(24, Math.min(target, Math.floor(cw / 6)));
      fontPx = Math.max(6, Math.floor(cw / target / 0.6));
      for (let i = 0; i < 6; i++) {
        setFont(1);
        cellW = ctx.measureText("M".repeat(40)).width / 40 || fontPx * 0.6;
        if (Math.floor(cw / cellW) <= target + 1) break;
        fontPx++;
      }
      cellH = Math.max(fontPx + 1, Math.round(cellW * 2));
      cols = Math.floor(cw / cellW);
      rows = Math.floor(cw / cellH);
      gx = Math.floor((cw - cols * cellW) / 2);
      gy = Math.floor((cw - rows * cellH) / 2);
      // Fit the projected object into the grid (tips can swing out to their full length).
      const span = Math.min(cols * cellW, rows * cellH);
      K = (OBJ.dist * 0.5 * span * OBJ.fill) / ((OBJ.half + OBJ.radius) * 1.04);
      // Sample about twice per cell width so no cell facing the viewer is skipped.
      const cellWorld = (cellW * OBJ.dist) / K;
      const next = Math.round(cellWorld * 0.5 * 1000) / 1000;
      if (!samples || Math.abs(next - spacing) > spacing * 0.15) {
        spacing = next;
        samples = asteriskSamples(spacing);
      }
      const n = cols * rows;
      zbuf = new Float32Array(n);
      lum = new Float32Array(n);
      lock = new Float32Array(n);
      noise = new Uint8Array(n);
      const rnd = LP.prng(29);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          // The resolve front moves left to right, picking up the banner's sweep.
          lock[i] = 0.12 + 0.78 * (c / cols) + 0.24 * rnd();
          const dx = (c + 0.5) / cols - 0.5;
          const dy = (((r + 0.5) / rows - 0.5) * rows * cellH) / (cols * cellW);
          noise[i] = dx * dx + dy * dy < 0.2 && rnd() < 0.11 ? 1 : 0;
        }
      }
      bufs = [0, 1, 2, 3].map(() => new Uint16Array(cols));
      lines = [0, 1, 2, 3].map(() => new Array(rows));
      draw();
    }

    function matrix() {
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      // Ry * Rz
      const a00 = cy * cr;
      const a01 = -cy * sr;
      const a02 = sy;
      const a10 = sr;
      const a11 = cr;
      const a20 = -sy * cr;
      const a21 = sy * sr;
      const a22 = cy;
      // Rx * (Ry * Rz)
      return [a00, a01, a02, cp * a10 - sp * a20, cp * a11 - sp * a21, -sp * a22, sp * a10 + cp * a20, sp * a11 + cp * a21, cp * a22];
    }

    function draw() {
      if (!samples || !cols) return;
      const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = matrix();

      // A key light from the upper left that drifts slowly, in view space.
      const la = 2.25 + Math.sin(time * 0.19) * 0.55;
      let lx = Math.cos(la) * 0.62;
      let ly = 0.6 + Math.sin(time * 0.13) * 0.14;
      let lz = 0.7;
      let ll = Math.hypot(lx, ly, lz);
      lx /= ll;
      ly /= ll;
      lz /= ll;
      let hx = lx;
      let hy = ly;
      let hz = lz + 1;
      ll = Math.hypot(hx, hy, hz);
      hx /= ll;
      hy /= ll;
      hz /= ll;

      const D = OBJ.dist;
      const ox = (cols * cellW) / 2;
      const oy = (rows * cellH) / 2;
      const icw = 1 / cellW;
      const ich = 1 / cellH;
      const S = samples;
      zbuf.fill(0);
      for (let i = 0, n = S.length; i < n; i += 6) {
        const x = S[i];
        const y = S[i + 1];
        const z = S[i + 2];
        const Z = m20 * x + m21 * y + m22 * z;
        const ooz = 1 / (D - Z);
        const sx = ox + K * (m00 * x + m01 * y + m02 * z) * ooz;
        if (sx < 0) continue;
        const col = (sx * icw) | 0;
        if (col >= cols) continue;
        const sy = oy - K * (m10 * x + m11 * y + m12 * z) * ooz;
        if (sy < 0) continue;
        const row = (sy * ich) | 0;
        if (row >= rows) continue;
        const idx = row * cols + col;
        if (ooz <= zbuf[idx]) continue;
        zbuf[idx] = ooz;
        const nx = S[i + 3];
        const ny = S[i + 4];
        const nz = S[i + 5];
        const NX = m00 * nx + m01 * ny + m02 * nz;
        const NY = m10 * nx + m11 * ny + m12 * nz;
        const NZ = m20 * nx + m21 * ny + m22 * nz;
        // Raking key light, plus a weak fill from the viewer so faces turned toward us stay
        // readable and the silhouettes fall off to the darkest characters.
        const d = NX * lx + NY * ly + NZ * lz;
        let l = 0.05 + (NZ > 0 ? 0.28 * NZ : 0);
        if (d > 0) {
          l += 0.5 * d;
          const s = NX * hx + NY * hy + NZ * hz;
          if (s > 0.85) {
            const s2 = s * s;
            const s4 = s2 * s2;
            const s8 = s4 * s4;
            const s16 = s8 * s8;
            l += 0.5 * s16 * s16; // s^32: a tight glint
          }
        }
        // Depth cue: the far side of the object sits slightly dimmer.
        l *= 0.74 + 0.26 * LP.clamp((Z + 1) * 0.5, 0, 1);
        lum[idx] = l;
      }

      const resolving = resolveT < OBJ.resolve;
      for (let r = 0; r < rows; r++) {
        bufs[0].fill(SPACE);
        bufs[1].fill(SPACE);
        bufs[2].fill(SPACE);
        bufs[3].fill(SPACE);
        let used = 0;
        const base = r * cols;
        for (let c = 0; c < cols; c++) {
          const i = base + c;
          let tier = -1;
          let code = SPACE;
          if (zbuf[i] > 0) {
            const k = 1 + Math.min(8, Math.max(0, (lum[i] * 9) | 0));
            tier = TIER[k];
            code = RAMP_CODES[k];
          }
          if (resolving && resolveT < lock[i]) {
            if (tier >= 0) {
              code = NOISE_CODES[(Math.random() * NOISE_CODES.length) | 0];
              tier = tier > 1 ? 1 : tier;
            } else if (noise[i]) {
              tier = 3;
              code = NOISE_CODES[(Math.random() * NOISE_CODES.length) | 0];
            }
          }
          if (tier < 0 && OBJ.grid && r % 3 === 1 && c % 6 === 3) {
            tier = 3;
            code = 0xb7; // graticule dot
          }
          if (tier >= 0) {
            bufs[tier][c] = code;
            used |= 1 << tier;
          }
        }
        for (let t = 0; t < 4; t++) lines[t][r] = used & (1 << t) ? String.fromCharCode.apply(null, bufs[t]) : null;
      }

      ctx.clearRect(0, 0, cw, cw);
      for (let t = 0; t < 4; t++) {
        ctx.fillStyle = COLORS[t];
        setFont(t);
        const L = lines[t];
        for (let r = 0; r < rows; r++) {
          if (L[r]) ctx.fillText(L[r], gx, Math.round(gy + r * cellH + cellH / 2));
        }
      }
    }

    const deg = (a, w) => {
      let d = ((a * 180) / Math.PI) % 360;
      if (d > 180) d -= 360;
      if (d <= -180) d += 360;
      return d.toFixed(1).padStart(w, " ");
    };

    // At rest the caption; while held (and briefly after) the rotation, as the object reports it.
    function hud(force) {
      if (!hudRot) return;
      if (!(dragging && turned) && time >= readoutUntil) {
        if (readout || force) hudRot.textContent = caption;
        readout = false;
        return;
      }
      if (!force && readout && time - hudT < 0.1) return;
      readout = true;
      hudT = time;
      hudRot.textContent = "rot x" + deg(pitch, 6) + "° y" + deg(yaw, 6) + "° z" + deg(roll, 7) + "°";
    }

    function step(dt) {
      time += dt;
      if (resolveT < OBJ.resolve) resolveT += dt;
      if (!dragging) {
        // Any spin given by a drag eases back to the idle rate.
        const idle = OBJ.spin * (rollVel < 0 ? -1 : 1);
        rollVel += (idle - rollVel) * (1 - Math.exp(-dt / 1.6));
        roll += rollVel * dt;
      }
      yaw = LP.clamp(OBJ.wobble[0] * Math.sin(time * 0.29), -OBJ.yawMax, OBJ.yawMax);
      pitch = OBJ.wobble[1] * Math.sin(time * 0.23 + 1.3);
    }

    const frameDt = 1 / OBJ.fps;
    const loop = LP.loop((dt) => {
      acc += dt;
      if (acc < frameDt - 0.004) return;
      const d = Math.min(acc, 0.1);
      acc = 0;
      step(d);
      draw();
      hud(false);
    });

    let onScreen = true;
    const sync = () => {
      if (ready && onScreen && !LP.reducedMotion()) loop.start();
      else loop.stop();
    };

    function showStill() {
      roll = OBJ.still.roll;
      pitch = OBJ.still.pitch;
      yaw = OBJ.still.yaw;
      resolveT = OBJ.resolve;
      draw();
      hud(true);
    }

    LP.onResize(canvas, (w) => {
      if (Math.abs(w - cssW) < 0.5 && cols) return;
      cssW = w;
      layout();
      hud(true);
    });
    LP.inView(canvas, {
      enter: () => {
        onScreen = true;
        sync();
      },
      leave: () => {
        onScreen = false;
        sync();
      },
    });

    // A DPR change at the same CSS size (zoom, a move to another screen) needs a new backing store.
    watchResolution(() => {
      layout();
      hud(true);
    });

    // Only a drag on the object turns it. A mouse or pen turns it like a dial: the arm under the
    // pointer follows it around the center. Touch keeps vertical swipes for scrolling, so there a
    // horizontal swipe spins it like a wheel. A flick carries on, then settles to the idle spin.
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove("is-held");
      if (!turned) return;
      // A pointer that came to rest before letting go leaves no flick behind.
      if (e && e.timeStamp - lastT > 80) dragVel = 0;
      rollVel = LP.clamp(dragVel, -4, 4) || OBJ.spin;
      readoutUntil = time + OBJ.readout;
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (LP.reducedMotion() || !loop.running) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.pointerType !== "touch") e.preventDefault(); // no text selection while turning
      const r = canvas.getBoundingClientRect();
      center = { x: r.left + r.width / 2, y: r.top + r.height / 2, soft: r.width * 0.12 };
      dragging = true;
      turned = false;
      dragVel = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
      canvas.classList.add("is-held");
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is optional */
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      let turn;
      if (e.pointerType === "touch") {
        turn = (e.clientX - lastX) * 0.012;
      } else {
        // The angle swept around the center in screen space (y down, so positive is clockwise),
        // softened near the center, where a small move would sweep a large angle.
        const x0 = lastX - center.x;
        const y0 = lastY - center.y;
        const x1 = e.clientX - center.x;
        const y1 = e.clientY - center.y;
        turn = (x0 * y1 - y0 * x1) / (x1 * x1 + y1 * y1 + center.soft * center.soft);
      }
      const dtm = Math.max(8, e.timeStamp - lastT) / 1000;
      if (turn) turned = true;
      roll -= turn; // clockwise on screen is a negative roll
      dragVel = LP.lerp(dragVel, -turn / dtm, 0.5);
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
    });
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("lostpointercapture", endDrag);

    if (LP.onReducedMotionChange) {
      LP.onReducedMotionChange((reduced) => {
        if (reduced) {
          dragging = false;
          canvas.classList.remove("is-held");
          readoutUntil = -1;
          showStill();
        }
        sync();
      });
    }

    // Measure and draw only once the monospace font is in, so the grid uses its real advance.
    const family = '500 16px "JetBrains Mono"';
    const fontLoad =
      document.fonts && document.fonts.load ? document.fonts.load(family).catch(() => null) : Promise.resolve();
    Promise.race([fontLoad, new Promise((r) => setTimeout(r, 600))]).then(() => {
      ready = true;
      if (!cssW) cssW = canvas.getBoundingClientRect().width;
      if (LP.reducedMotion()) {
        layout();
        showStill();
      } else {
        // Resolve from noise only when the object is on screen at load; otherwise it is simply there.
        resolveT = inViewport(canvas) ? 0 : OBJ.resolve;
        step(0);
        layout();
        hud(true);
      }
      sync();
      // If the font arrived after the timeout, measure the grid again with it.
      if (document.fonts && document.fonts.check && !document.fonts.check(family)) {
        fontLoad.then(() => {
          layout();
          hud(true);
        });
      }
    });
  }
})();
