/* devsecops.js: case file 2, findings.log.
   A canvas field of 31,000 character marks (the backlog was about 31,000 SCA, SAST, DAST and IaC
   findings), one per finding: an untriaged finding is a red "x", a triaged one (fixed, mitigated,
   risk-accepted or deferred, the figure does not say which) a calm "·". When the figure comes into
   view a scan column crosses the field and the marks in its wake flip, each with a one-frame flash,
   in an organic order (column position plus smooth noise plus per-mark jitter) on a slow-fast-slow
   curve. Seven-segment block digits, the glyph set of the ISO counter in case file 1, count the
   triaged findings up to the total and a log line follows along.
   Rendering: a field in one state (all triaged at rest, all untriaged when armed) is one pattern fill
   of a single cell. The sweep writes pixel glyphs straight into an ImageData buffer, allocated on
   first use, and uploads only the dirty rectangle, so a frame costs well under a millisecond. */
(function () {
  "use strict";
  const LP = window.LP;
  if (!LP) return;

  const N = 31000; // below 2^15: a mark index fits the 15 low bits of a sort key
  const SWEEP_MS = 3000; // in LP.loop time, so LP.tempo stretches it
  const FLASH_MS = 12; // one frame at 60 Hz
  const TYPE_MS = 24; // per character of the closing log line
  // en-US digit grouping without toLocaleString, whose first call loads locale data during boot
  const fmt = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Seven-segment block digits, as in the ISO counter: 5 text rows of half blocks, each text row
  // two square pixel rows, so a glyph is 5 x 10 pixels. Unlit segments stay on screen in the
  // unlit-cell color, so every slot shows its dark "8".
  //   a: top, b: upper right, c: lower right, d: bottom, e: lower left, f: upper left, g: middle
  const SEG = {
    a: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
    b: [[4, 0], [4, 1], [4, 2], [4, 3], [4, 4]],
    c: [[4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9]],
    d: [[0, 9], [1, 9], [2, 9], [3, 9], [4, 9]],
    e: [[0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
    f: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    g: [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]],
  };
  const DIGIT_SEGS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abfgcd"];
  // Glyph -> 10 pixel rows, each a 5-bit mask (bit c = column c).
  const BITS = DIGIT_SEGS.map((segs) => {
    const px = new Array(10).fill(0);
    for (const s of segs) for (const [x, y] of SEG[s]) px[y] |= 1 << x;
    return px;
  });
  const COMMA = [0, 0, 0, 0, 0, 0, 0, 2, 2, 1]; // ▄ over ▄▀: a two-pixel stroke and its tail
  // "00,000": five digits and a comma, one blank column between glyphs. 32 columns in all.
  const DIGIT_X = [0, 6, 15, 21, 27];
  const COMMA_X = 12;
  const COUNT_COLS = 32;
  const DIGIT_PX = 11; // CSS px per digit pixel, the ISO counter's (half its 22px line)

  // Modes. REST and DONE show the final state, ARMED the start state.
  const REST = 0;
  const ARMED = 1;
  const PLAYING = 2;
  const DONE = 3;

  LP.module("devsecops", () => {
    const fig = document.querySelector("#case-devsecops [data-devsecops]");
    if (!fig) return;
    const mount = fig.querySelector("[data-burn-mount]");
    const fieldCv = fig.querySelector("[data-burn-field]");
    const countCv = fig.querySelector("[data-burn-count]");
    const logEl = fig.querySelector("[data-burn-log]");
    const replayBtn = fig.querySelector("[data-burn-replay]");
    if (!mount || !fieldCv || !countCv || !logEl) return;
    const fctx = fieldCv.getContext("2d");
    const cctx = countCv.getContext("2d");
    if (!fctx || !cctx) return;
    const logA = logEl.querySelector('[data-k="a"]');
    const logB = logEl.querySelector('[data-k="b"]');
    const logC = logEl.querySelector('[data-k="c"]');

    /* ---------------------------------------------------------------- colors */
    const LE = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
    const pack = (name) => {
      const [r, g, b] = LP.color(name);
      return (LE ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
    };
    // Triaged marks in the dim text color: at rest the field still reads as 31,000 handled
    // findings, a calm texture under the red of the untriaged ones.
    const INK = {
      open: pack("--red"),
      done: pack("--fg-3"),
      flash: pack("--fg"),
      scan: pack("--fg"),
      cursor: pack("--fg"),
      cursorInk: pack("--bg"),
    };
    const DIGIT = { red: LP.token("--red"), fg: LP.token("--fg"), unlit: LP.token("--red-4") };

    /* ---------------------------------------------------------------- state */
    let mode = REST;
    let elapsed = 0; // ms into the sweep, advanced by frame deltas so tab switches pause it
    let typeFrom = -1; // elapsed ms when the closing log line started typing, -1 when not typing

    // Geometry (device pixels)
    let cssW = 0; // last measured mount width
    let ratio = 1; // device px per CSS px for the field canvas
    let cols = 0;
    let rows = 0;
    let px = 0;
    let py = 0;
    let W = 0;
    let H = 0;
    let img = null; // the field's pixels, allocated on first use (a sweep or a pointer readout)
    let buf = null;
    let ptsX = null; // pixels of the "x" glyph inside a cell, as x, y pairs
    let ptsDot = null; // of the "·" glyph
    let gX = null; // the same as offsets into buf
    let gDot = null;
    let gScan = null; // of the scan column's "│"
    let J = 0; // jitter span, in columns
    let thrKey = ""; // the grid the thresholds were computed for

    // Marks
    const T = new Float32Array(N); // column position at which each mark is triaged
    const order = new Uint16Array(N); // marks sorted by T
    const res = new Uint8Array(N); // 1 = triaged
    const flashing = new Uint8Array(N);
    const flashQ = new Uint16Array(N);
    const flashAt = new Float64Array(N);
    let qHead = 0;
    let qTail = 0;
    let ptr = 0; // order[0..ptr) are triaged
    let scanCol = -1;
    let cursor = -1;

    // Dirty rectangle, device px
    let d0x = Infinity;
    let d0y = Infinity;
    let d1x = -1;
    let d1y = -1;

    /* ---------------------------------------------------------------- layout */
    function cellPitch(w, dpr) {
      // CSS cell size: 4x5 on wide panels. Below 700px, the larger of 3x3.5 and 2x2.5 that keeps
      // the field within about 45% of the screen height, so on a phone the counter, the field and
      // the log line fit one screen (2x2.5: 370px tall at 390px wide) and a tablet keeps a
      // squarer field. Snapped to whole device pixels so every glyph has the same pattern. At 1x
      // a cell keeps 4px so neighbouring x's never touch, except on very narrow windows.
      const snap = (cx, cy) => {
        let x = Math.round(dpr * cx);
        let y = Math.round(dpr * cy);
        if (x < 4 && w >= 520) {
          x = 4;
          y = 5;
        }
        x = Math.max(3, x);
        return [x, Math.max(x + 1, y)];
      };
      if (w >= 700) return snap(4, 5);
      const tall = (p) => (Math.ceil(N / Math.max(1, Math.floor((w * dpr) / p[0]))) * p[1]) / dpr;
      const mid = snap(3, 3.5);
      return tall(mid) <= (window.innerHeight || 800) * 0.45 ? mid : snap(2, 2.5);
    }

    // Pixel x, y pairs -> offsets into buf (row stride W)
    const offsets = (pts) => {
      const o = new Int32Array(pts.length >> 1);
      for (let k = 0; k < o.length; k++) o[k] = pts[2 * k + 1] * W + pts[2 * k];
      return o;
    };

    function glyphs() {
      // "x": odd size so the diagonals cross on a pixel, with at least a 1px gap to the next cell
      let s = px - 1;
      if (s % 2 === 0) s -= 1;
      s = Math.max(3, Math.min(s, py - 1 - ((py - 1) % 2 === 0 ? 1 : 0)));
      const oy = Math.floor((py - s) / 2);
      // From 7px up the arms get a second pixel toward the centre, so a 1 CSS px "x" on a dense
      // screen keeps the weight (and the red) of the 1x glyph.
      const bold = s >= 7;
      const mid = (s - 1) / 2;
      const x = [];
      for (let k = 0; k < s; k++) {
        const a = Math.min(k, s - 1 - k);
        const row = new Set([a, s - 1 - a]);
        if (bold && a < mid) {
          row.add(a + 1);
          row.add(s - 2 - a);
        }
        row.forEach((cx) => x.push(cx, oy + k));
      }
      // "·": a square of 2 CSS px on a 4px cell (1.5 on a dense screen, 1 on a phone's 2px
      // cell) on the glyph's center: big enough to read, small enough to stay a texture
      const ds = Math.max(1, Math.round(px * 0.4));
      const c = Math.floor((s - ds + 1) / 2);
      const dot = [];
      for (let yy = 0; yy < ds; yy++) for (let xx = 0; xx < ds; xx++) dot.push(c + xx, oy + c + yy);
      // "│": 1 CSS px wide through the full cell height, so the rows join into one line
      const lw = Math.max(1, Math.round(ratio));
      const lx = Math.floor(s / 2) - Math.floor((lw - 1) / 2);
      const scan = [];
      for (let yy = 0; yy < py; yy++) for (let k = 0; k < lw; k++) scan.push(lx + k, yy);
      ptsX = x;
      ptsDot = dot;
      gX = offsets(x);
      gDot = offsets(dot);
      gScan = offsets(scan);
    }

    function thresholds() {
      // A mark resolves once the scan has passed its column. Most go right behind the scan line;
      // smooth value noise picks out ragged patches that lag and shrink, and a per-mark tail
      // leaves a few stragglers.
      const rnd = LP.prng(31000);
      J = Math.max(10, Math.round(cols * 0.2));
      const sx = Math.max(6, cols / 10);
      const sy = Math.max(5, rows / 6);
      const gw = Math.ceil(cols / sx) + 2;
      const gh = Math.ceil(rows / sy) + 2;
      const lat = new Float32Array(gw * gh);
      for (let k = 0; k < lat.length; k++) lat[k] = rnd();
      const span = cols + J + 4;
      const q = 65535 / span;
      const keys = new Uint32Array(N);
      for (let i = 0; i < N; i++) {
        const c = i % cols;
        const r = (i / cols) | 0;
        const fx = c / sx;
        const fy = r / sy;
        const ix = fx | 0;
        const iy = fy | 0;
        let tx = fx - ix;
        let ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const a = lat[iy * gw + ix];
        const b = lat[iy * gw + ix + 1];
        const e = lat[(iy + 1) * gw + ix];
        const f = lat[(iy + 1) * gw + ix + 1];
        const n = a + (b - a) * tx + (e - a) * ty + (a - b - e + f) * tx * ty;
        const lag = LP.smoothstep(0.42, 0.8, n);
        const tail = rnd();
        const t = c + 1 + 2.5 * rnd() + J * (0.75 * lag * lag + 0.25 * tail * tail * tail * tail);
        const k = Math.min(65535, Math.round(t * q));
        T[i] = k / q;
        keys[i] = ((k << 15) | i) >>> 0;
      }
      keys.sort();
      for (let k = 0; k < N; k++) order[k] = keys[k] & 0x7fff;
    }

    function layout(force) {
      const w = Math.floor(mount.getBoundingClientRect().width);
      const dpr = LP.dpr();
      if (w <= 0 || (!force && w === cssW && dpr === layout.dpr)) return;
      cssW = w;
      layout.dpr = dpr;

      // Counter: the ISO counter's digit pixel wherever the 32 columns fit with room to spare,
      // and like it 9 or 8 px on phones; never wider than the panel.
      const P = Math.max(2, Math.min(LP.clamp(Math.floor(w / 36), 8, DIGIT_PX), Math.floor(w / COUNT_COLS)));
      const pd = Math.max(2, Math.round(P * dpr));
      const ccw = Math.ceil((COUNT_COLS * pd) / dpr);
      const cch = Math.ceil((10 * pd) / dpr);
      countCv.width = Math.round(ccw * dpr);
      countCv.height = Math.round(cch * dpr);
      countCv.style.width = ccw + "px";
      countCv.style.height = cch + "px";
      drawCount.pd = pd;
      drawCount.key = "";

      // Field
      const [npx, npy] = cellPitch(w, dpr);
      const ncols = Math.max(20, Math.floor((w * dpr) / npx));
      const nrows = Math.ceil(N / ncols);
      const fw = Math.ceil((ncols * npx) / dpr);
      const fh = Math.ceil((nrows * npy) / dpr);
      px = npx;
      py = npy;
      cols = ncols;
      rows = nrows;
      W = Math.round(fw * dpr);
      H = Math.round(fh * dpr);
      ratio = W / fw;
      fieldCv.width = W;
      fieldCv.height = H;
      fieldCv.style.width = fw + "px";
      fieldCv.style.height = fh + "px";
      // The pixel buffer and the sweep order wait for their first use (settle and setCursor).
      img = null;
      buf = null;
      glyphs();
      cursor = -1;
      settle();
    }

    // The sweep order for the current grid, computed when a sweep first needs it.
    function ensureThresholds() {
      const key = cols + "x" + rows;
      if (key === thrKey) return;
      thrKey = key;
      thresholds();
    }

    // The pixel buffer, on first use. Until then the canvas holds a field in one state (see
    // repaintAll), so the new buffer starts as that same picture unless the caller repaints it.
    function ensureBuf(fill) {
      if (buf) return;
      img = fctx.createImageData(W, H);
      buf = new Uint32Array(img.data.buffer);
      if (fill) bandFill(ptr === N ? gDot : gX, ptr === N ? INK.done : INK.open);
    }

    /* ---------------------------------------------------------------- field painting */
    function stamp(base, g, color) {
      for (let k = 0; k < g.length; k++) buf[base + g[k]] = color;
    }

    function paint(i) {
      const cx = i % cols;
      const cy = (i / cols) | 0;
      const x0 = cx * px;
      const y0 = cy * py;
      const base = y0 * W + x0;
      if (i === cursor) {
        for (let y = 0, o = base; y < py; y++, o += W) buf.fill(INK.cursor, o, o + px);
        stamp(base, res[i] ? gDot : gX, INK.cursorInk);
      } else {
        for (let y = 0, o = base; y < py; y++, o += W) buf.fill(0, o, o + px);
        if (cx === scanCol) stamp(base, gScan, INK.scan);
        else if (flashing[i]) stamp(base, gX, INK.flash);
        else if (res[i]) stamp(base, gDot, INK.done);
        else stamp(base, gX, INK.open);
      }
      if (x0 < d0x) d0x = x0;
      if (y0 < d0y) d0y = y0;
      if (x0 + px > d1x) d1x = x0 + px;
      if (y0 + py > d1y) d1y = y0 + py;
    }

    function paintColumn(c) {
      for (let r = 0; r < rows; r++) {
        const i = r * cols + c;
        if (i < N) paint(i);
      }
    }

    function flush() {
      if (d1x < 0) return;
      fctx.putImageData(img, 0, 0, d0x, d0y, d1x - d0x, d1y - d0y);
      d0x = d0y = Infinity;
      d1x = d1y = -1;
    }

    // Marks on full rows of the grid, and on the last, partial one
    const fullRows = () => Math.floor(N / cols);

    // A field in one state, every mark the same glyph, drawn straight on the canvas: one cell
    // as a pattern, filled over the rows of marks. No buffer, no per-mark work.
    function fillUniform(pts, color) {
      const tile = document.createElement("canvas");
      tile.width = px;
      tile.height = py;
      const tctx = tile.getContext("2d");
      const id = tctx.createImageData(px, py);
      const tb = new Uint32Array(id.data.buffer);
      for (let k = 0; k < pts.length; k += 2) tb[pts[k + 1] * px + pts[k]] = color;
      tctx.putImageData(id, 0, 0);
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.imageSmoothingEnabled = false;
      fctx.clearRect(0, 0, W, H);
      fctx.fillStyle = fctx.createPattern(tile, "repeat");
      const full = fullRows();
      const rem = N - full * cols;
      fctx.fillRect(0, 0, cols * px, full * py);
      if (rem) fctx.fillRect(0, full * py, rem * px, py);
    }

    // The same picture in the buffer: one band of cells copied down the rows.
    function bandFill(g, color) {
      buf.fill(0);
      const band = new Uint32Array(W * py);
      for (let c = 0; c < cols; c++) for (let k = 0; k < g.length; k++) band[c * px + g[k]] = color;
      const full = fullRows();
      const rem = N - full * cols;
      for (let r = 0; r < full; r++) buf.set(band, r * py * W);
      if (rem) for (let y = 0; y < py; y++) buf.set(band.subarray(y * W, y * W + rem * px), (full * py + y) * W);
    }

    function repaintAll() {
      // One state everywhere: no scan column, flash or readout, and all marks untriaged or triaged
      const uniform = scanCol < 0 && cursor < 0 && qHead === qTail && (ptr === 0 || ptr === N);
      if (uniform && !buf) {
        fillUniform(ptr === N ? ptsDot : ptsX, ptr === N ? INK.done : INK.open);
        return;
      }
      ensureBuf(false);
      if (uniform) bandFill(ptr === N ? gDot : gX, ptr === N ? INK.done : INK.open);
      else {
        buf.fill(0);
        for (let i = 0; i < N; i++) paint(i);
      }
      d0x = 0;
      d0y = 0;
      d1x = W;
      d1y = H;
      flush();
    }

    /* ---------------------------------------------------------------- sweep */
    const ease = LP.easeInOutCubic;
    const xAt = (e) => -0.5 + e * (cols + J + 4);

    function moveTo(X, flash) {
      while (ptr < N && T[order[ptr]] <= X) {
        const i = order[ptr++];
        res[i] = 1;
        if (flash) {
          flashing[i] = 1;
          flashQ[qTail] = i;
          flashAt[qTail++] = elapsed + FLASH_MS;
        }
        paint(i);
      }
      while (ptr > 0 && T[order[ptr - 1]] > X) {
        const i = order[--ptr];
        res[i] = 0;
        paint(i);
      }
      const sc = X >= 0 && X < cols ? Math.floor(X) : -1;
      if (sc !== scanCol) {
        const old = scanCol;
        scanCol = sc;
        if (old >= 0) paintColumn(old);
        if (sc >= 0) paintColumn(sc);
      }
    }

    function expireFlashes() {
      while (qHead < qTail && flashAt[qHead] <= elapsed) {
        const i = flashQ[qHead++];
        flashing[i] = 0;
        paint(i);
      }
    }

    function clearFlashes() {
      flashing.fill(0);
      qHead = qTail = 0;
    }

    // Put the marks in the state the current mode calls for, without flashes, and repaint.
    function settle() {
      clearFlashes();
      scanCol = -1;
      if (mode === PLAYING) {
        ensureThresholds();
        ensureBuf(false);
        res.fill(0);
        ptr = 0;
        moveTo(xAt(ease(LP.clamp(elapsed / SWEEP_MS, 0, 1))), false);
      } else {
        const all = mode !== ARMED;
        res.fill(all ? 1 : 0);
        ptr = all ? N : 0;
      }
      repaintAll();
      drawCount();
      writeLog();
    }

    const loop = LP.loop((dt) => {
      elapsed += dt * 1000;
      if (mode === PLAYING) {
        const p = Math.min(1, elapsed / SWEEP_MS);
        expireFlashes();
        moveTo(xAt(ease(p)), true);
        flush();
        drawCount();
        // Closing beat: as the last finding is triaged, the log line starts typing itself out.
        if (ptr === N && typeFrom < 0) typeFrom = elapsed;
        if ((ptr === N || p >= 1) && qHead === qTail) mode = DONE;
      } else if (mode !== DONE || typeFrom < 0) {
        loop.stop();
        return;
      }
      // A pointer readout owns the line, so the typing just ends there.
      if (mode === DONE && cursor >= 0) typeFrom = -1;
      writeLog();
      if (mode === DONE && typeFrom < 0) loop.stop();
    });

    function setMode(m) {
      if (m === mode) return;
      mode = m;
      typeFrom = -1;
      if (m !== PLAYING) loop.stop();
      settle();
    }

    function play() {
      if (LP.reducedMotion()) {
        setMode(REST);
        return;
      }
      elapsed = 0;
      typeFrom = -1;
      mode = PLAYING;
      settle();
      loop.start();
    }

    /* ---------------------------------------------------------------- counter and log */
    // One glyph's pixel rows at column ox, as merged horizontal runs on whole device pixels
    function glyphRows(bits, ox, pd) {
      for (let y = 0; y < bits.length; y++) {
        const m = bits[y];
        for (let c = 0; c < 5; c++) {
          if (!(m & (1 << c))) continue;
          let e = c;
          while (e < 4 && m & (1 << (e + 1))) e++;
          cctx.fillRect((ox + c) * pd, y * pd, (e - c + 1) * pd, pd);
          c = e;
        }
      }
    }

    function drawCount() {
      const v = ptr;
      const final = v === N;
      const key = v + (final ? "f" : "");
      if (key === drawCount.key) return;
      drawCount.key = key;
      const pd = drawCount.pd;
      cctx.clearRect(0, 0, countCv.width, countCv.height);
      const digits = [
        Math.floor(v / 10000) % 10,
        Math.floor(v / 1000) % 10,
        Math.floor(v / 100) % 10,
        Math.floor(v / 10) % 10,
        v % 10,
      ];
      // Every segment first in the unlit color (the dark "8" of each slot), then the lit ones.
      // Leading zeros stay unlit, like the dark cells of a display.
      const litFrom = v >= 10000 ? 0 : v >= 1000 ? 1 : v >= 100 ? 2 : v >= 10 ? 3 : 4;
      cctx.fillStyle = DIGIT.unlit;
      DIGIT_X.forEach((x) => glyphRows(BITS[8], x, pd));
      if (v < 1000) glyphRows(COMMA, COMMA_X, pd);
      cctx.fillStyle = final ? DIGIT.fg : DIGIT.red;
      for (let s = litFrom; s < 5; s++) glyphRows(BITS[digits[s]], DIGIT_X[s], pd);
      if (v >= 1000) glyphRows(COMMA, COMMA_X, pd);
    }
    drawCount.key = "";
    drawCount.pd = DIGIT_PX;

    function setLog(a, b, c, open) {
      if (logA.textContent !== a) logA.textContent = a;
      if (logB.textContent !== b) logB.textContent = b;
      if (logC.textContent !== c) logC.textContent = c;
      logEl.classList.toggle("is-open", !!open);
    }

    function writeLog() {
      if (cursor >= 0) {
        setLog("finding", "#" + fmt(cursor + 1), res[cursor] ? "triaged" : "untriaged", !res[cursor]);
      } else if (ptr === N) {
        const parts = ["all", "~" + fmt(N), "triaged"];
        if (typeFrom < 0) {
          setLog(parts[0], parts[1], parts[2]);
          return;
        }
        // Typed out one character at a time (the spaces between the parts count as characters)
        let k = Math.floor((elapsed - typeFrom) / TYPE_MS);
        const total = parts[0].length + parts[1].length + parts[2].length + 2;
        if (k >= total) {
          typeFrom = -1;
          loop.stop();
          k = total;
        }
        const out = parts.map((part) => {
          const shown = part.slice(0, Math.max(0, k));
          k -= part.length + 1;
          return shown;
        });
        setLog(out[0], out[1], out[2]);
      } else {
        setLog("triaged", fmt(ptr), "/ ~" + fmt(N));
      }
    }

    /* ---------------------------------------------------------------- pointer readout */
    let flushQueued = false;
    const queueFlush = () => {
      if (flushQueued || loop.running) return;
      flushQueued = true;
      requestAnimationFrame(() => {
        flushQueued = false;
        flush();
      });
    };
    function setCursor(i) {
      if (i === cursor) return;
      ensureBuf(true);
      const old = cursor;
      cursor = i;
      if (old >= 0) paint(old);
      if (i >= 0) paint(i);
      queueFlush();
      writeLog();
    }
    fieldCv.addEventListener("pointermove", (e) => {
      if (!LP.finePointer() || e.pointerType === "touch") return;
      const c = Math.floor((e.offsetX * ratio) / px);
      const r = Math.floor((e.offsetY * ratio) / py);
      const i = c >= 0 && c < cols && r >= 0 && r < rows ? r * cols + c : -1;
      setCursor(i < N ? i : -1);
    });
    fieldCv.addEventListener("pointerleave", () => setCursor(-1));

    /* ---------------------------------------------------------------- triggers */
    const reduced = LP.reducedMotion();
    if (!reduced) {
      // Start state if the figure is on screen or about to be; the final state otherwise, so a
      // page captured without scrolling still reads "all triaged".
      const r = fig.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      mode = r.top < vh * 1.2 && r.bottom > 0 ? ARMED : REST;
    }
    layout(true);
    LP.onResize(mount, () => layout(false));
    // Moving the window to a screen with another pixel ratio resizes nothing, so watch for it.
    const watchDpr = () => {
      try {
        const m = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        const again = () => {
          layout(false);
          watchDpr();
        };
        if (m.addEventListener) m.addEventListener("change", again, { once: true });
      } catch (e) {
        /* no resolution media queries: keep the first layout */
      }
    };
    watchDpr();

    if (replayBtn) {
      replayBtn.hidden = reduced;
      replayBtn.addEventListener("click", play);
    }

    // Whether enough of the field is on screen to play: 40% of it, or 45% of the screen height on
    // tall phones. Kept from the field observer so arming can act on it whichever observer fires first.
    let fieldReady = false;
    LP.inView(fieldCv, {
      threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      enter: (e) => {
        const vh = (e && e.rootBounds && e.rootBounds.height) || window.innerHeight || 800;
        fieldReady = !e || e.intersectionRatio >= 0.4 || e.intersectionRect.height >= vh * 0.45;
        if (fieldReady && mode === ARMED) play();
      },
      leave: () => {
        fieldReady = false;
      },
    });

    // Arm just before the figure scrolls in from below (never in view from above, where the swap
    // would show); go back to the start state once the reader has scrolled back above it.
    LP.inView(fig, {
      rootMargin: "0px 0px 20% 0px",
      enter: (e) => {
        if (mode !== REST || LP.reducedMotion() || (e && e.boundingClientRect.top <= 0)) return;
        setMode(ARMED);
        if (fieldReady) play();
      },
      leave: (e) => {
        if (!e || LP.reducedMotion()) return;
        const below = e.rootBounds ? e.boundingClientRect.top >= e.rootBounds.bottom - 1 : e.boundingClientRect.top > 0;
        if (below) {
          // Only after a run: the observer's first report on load must not arm a figure far away.
          if (mode === PLAYING || mode === DONE) setMode(ARMED);
        } else if (mode === PLAYING || mode === ARMED) {
          setMode(DONE);
        }
      },
    });

    if (LP.onReducedMotionChange) {
      LP.onReducedMotionChange((on) => {
        if (replayBtn) replayBtn.hidden = on;
        if (on) setMode(REST);
      });
    }
  });
})();
