/* iso.js: case file 1, annex-a.txt.

   ISO/IEC 27001:2022 Annex A as four rows of cells, one per theme (37 + 8 + 14 + 34 = 93
   controls), with block digits, a text progress bar, the five phases of the program as a checklist
   and a box-drawn PASSING stamp. The figure is scrubbed by scroll: as it rises toward the middle
   of the screen the program runs through its phases, cells light up in a fixed pseudo-random order
   from 12 (13%) to 87 (94%), an internal-audit sweep crosses the rows and the stamp lights at the
   end. Which cells are lit is illustrative (the caption says so), so no readout ever names a
   control as implemented or pending: the readouts give the real figures (13%, 94%, the controls
   per theme) and the illustration's own state (lit, unlit).

   Everything on screen is a pure function of one progress value q, so scrolling back reverses it
   exactly and every scroll position is a readable state (q = 0 reads 13%). Time-based detail rides
   on top: q eases toward the scroll position, a cell that lights up flashes white and cools to
   red, digit segments warm up through pale red and dim through deep red, and the stamp lands with
   one frame of inverse video. The loop runs only while one of those is in flight.
   Glyphs outside JetBrains Mono's Latin subset (block elements, squares, box drawing) are drawn
   procedurally on the character grid, so nothing depends on a fallback font's metrics. */
(function () {
  "use strict";
  const LP = window.LP;
  if (!LP) return;

  /* ---------------------------------------------------------------- content */
  // How the illustration spreads the 13% and 94% over the themes. base: cells lit at the
  // baseline. pend: cells still unlit at the end. audit: cells lit during the internal-audit
  // sweep. The split is illustrative (the caption says so) and never shown as a figure; the
  // totals are the real ones.
  const THEMES = [
    { id: "A.5", name: "organizational", n: 37, base: 5, pend: 3, audit: 1 },
    { id: "A.6", name: "people", n: 8, base: 1, pend: 0, audit: 0 },
    { id: "A.7", name: "physical", n: 14, base: 3, pend: 1, audit: 1 },
    { id: "A.8", name: "technological", n: 34, base: 3, pend: 2, audit: 1 },
  ];
  const TOTAL = 93;
  const MAXN = 37; // the longest theme, A.5
  const BAR_CELLS = 28;
  // A phase is checked off once q passes its value.
  const PHASES = [
    { label: "gap analysis", done: 0.08 },
    { label: "risk assessment and treatment", done: 0.2 },
    { label: "controls and evidence", done: 0.74 },
    { label: "internal audit", done: 0.88 },
    { label: "continuous monitoring", done: 0.97 },
  ];
  const BUILD = [0.2, 0.74]; // q span in which cells light up (12 -> 84 lit)
  const AUDIT = [0.74, 0.88]; // q span of the audit sweep (84 -> 87 lit)
  const STAMP_Q = 0.97;
  // q runs 0 -> 1 while the figure's top edge rises from 90% to 12% of the viewport height, a long
  // stretch of scrolling so the program reads at an unhurried pace; on a phone, where the figure
  // is nearly a screen tall, it still finishes with the stamp in view instead of under the top bar.
  const VIEW = [0.9, 0.12];

  /* ---------------------------------------------------------------- motion */
  const TAU = 0.085; // s, time constant of q following the scroll position
  const HOT_MS = 70; // a freshly lit cell is white this long...
  const WARM_MS = 230; // ...then pale red until this age
  const COOL_MS = 120; // a segment switching off passes through deep red this long
  const PRESS_MS = 160; // stamp landing: one frame of inverse video, then ink
  const SPIN = "-\\|/";
  // The stamp, in character cells: a double rule through the centres of the outer cells and the
  // words centred on the rows inside. The largest form that fits its slot is used.
  const STAMPS = [
    { key: "full", cols: 19, words: ["PASSING", "ISO/IEC 27001"] },
    { key: "compact", cols: 13, words: ["PASSING"] },
    { key: "tiny", cols: 11, words: ["PASSING"] },
  ];

  /* ---------------------------------------------------------------- block digits */
  // Seven-segment digits in half blocks: 5 text rows of █ ▀ ▄, each text row two square pixel
  // rows, so a glyph is 5 x 10 pixels. Unlit segments stay on screen in the unlit-cell color.
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
  const fromSegs = (segs) => {
    const px = new Array(10).fill(0);
    for (const s of segs) for (const [x, y] of SEG[s]) px[y] |= 1 << x;
    return px;
  };
  const BITS = {};
  DIGIT_SEGS.forEach((segs, n) => (BITS[n] = fromSegs(segs)));
  // The percent sign, drawn as characters: two 1 x 2 dots and a ▄▀ stair.
  BITS["%"] = (() => {
    const px = new Array(10).fill(0);
    ["█   ▄", "   ▄▀", "  ▄▀ ", " ▄▀  ", "▄▀  █"].forEach((line, r) => {
      for (let c = 0; c < 5; c++) {
        const ch = line[c];
        if (ch === "█" || ch === "▀") px[2 * r] |= 1 << c;
        if (ch === "█" || ch === "▄") px[2 * r + 1] |= 1 << c;
      }
    });
    return px;
  })();
  const GLYPH_X = [0, 6, 12]; // tens, ones, percent sign: "94%" is 17 columns

  // Pixel rows -> one path of merged horizontal runs (no seams between neighbouring pixels).
  function rowsPath(px, ox) {
    let d = "";
    for (let y = 0; y < px.length; y++) {
      const m = px[y];
      for (let c = 0; c < 5; c++) {
        if (!(m & (1 << c))) continue;
        let e = c;
        while (e < 4 && m & (1 << (e + 1))) e++;
        d += "M" + (ox + c) + " " + y + "h" + (e - c + 1) + "v1h" + (c - e - 1) + "z";
        c = e;
      }
    }
    return d;
  }

  /* ---------------------------------------------------------------- helpers */
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(name, attrs) {
    const e = document.createElementNS(SVG_NS, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const fix = (v) => Math.round(v * 1000) / 1000;

  /* ---------------------------------------------------------------- schedule */
  // Which cells are lit at the baseline, which stay unlit, and the q at which each of the others
  // lights up. Deterministic: the same seed always draws the same picture.
  function schedule() {
    const rnd = LP.prng(27001);
    const rows = [];
    const build = [];
    THEMES.forEach((th, r) => {
      const ks = Array.from({ length: th.n }, (_, k) => k);
      for (let i = ks.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = ks[i];
        ks[i] = ks[j];
        ks[j] = tmp;
      }
      const m = th.n - th.base - th.pend - th.audit;
      const row = [];
      ks.forEach((k, j) => {
        const c = { r, k, id: th.id + "." + (k + 1), t: Infinity, on: null, el: null, stage: 0 };
        if (j < th.base) c.t = -1;
        else if (j < th.base + m) build.push({ c, f: (j - th.base + 0.5 + (rnd() - 0.5) * 0.9) / m });
        else if (j < th.base + m + th.audit) c.t = AUDIT[0] + ((AUDIT[1] - AUDIT[0]) * (k + 1)) / (MAXN + 2);
        row[k] = c;
      });
      rows.push(row);
    });
    // The four rows advance together: sort by position within the row, then pace the whole run
    // slow-fast-slow by inverting an ease-in-out curve.
    build.sort((a, b) => a.f - b.f);
    const ease = (x) => 0.4 * x + 0.6 * x * x * (3 - 2 * x);
    const inv = (y) => {
      let a = 0;
      let b = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (a + b) / 2;
        if (ease(mid) < y) a = mid;
        else b = mid;
      }
      return (a + b) / 2;
    };
    build.forEach((b, i) => {
      b.c.t = BUILD[0] + (BUILD[1] - BUILD[0]) * inv((i + 0.5) / build.length);
    });
    const cells = [].concat(...rows);
    return { rows, cells };
  }

  /* ---------------------------------------------------------------- module */
  LP.module("iso", () => {
    const fig = document.querySelector("#case-iso [data-iso]");
    const mount = fig && fig.querySelector("[data-iso-mount]");
    if (!mount) return;

    const { rows, cells } = schedule();
    const colCells = Array.from({ length: MAXN }, () => []);
    cells.forEach((c, i) => {
      c.i = i;
      colCells[c.k].push(c);
    });

    /* ------------------------------------------------ markup */
    mount.textContent = "";

    // Top band: block digits, phases, the text bar, and the slot the stamp lands in.
    const top = el("div", "iso__top");
    const big = el("div", "iso__big");
    big.setAttribute("aria-hidden", "true");
    const bigSvg = svgEl("svg", { class: "iso__digits", viewBox: "0 0 17 10", "shape-rendering": "crispEdges", focusable: "false" });
    // Per digit, one path per ink: unlit segment, cooling, lit, warm (drawn in that order).
    const INKS = ["iso__px-off", "iso__px-cool", "iso__px", "iso__px-warm"];
    const digPaths = [0, 1].map(() => INKS.map((cls) => bigSvg.appendChild(svgEl("path", { class: cls }))));
    bigSvg.appendChild(svgEl("path", { class: "iso__px", d: rowsPath(BITS["%"], GLYPH_X[2]) }));
    big.appendChild(bigSvg);

    const phList = el("ol", "iso__phases");
    phList.setAttribute("aria-label", "Phases");
    const phases = PHASES.map((ph) => {
      const li = el("li", "iso__ph");
      const mk = el("span", "iso__mk");
      mk.setAttribute("aria-hidden", "true");
      const box = el("b", null, " ");
      mk.append("[", box, "]");
      const sr = el("span", "visually-hidden", "");
      li.append(mk, " ", el("span", "iso__phl", ph.label), sr);
      phList.appendChild(li);
      return { li, box, sr, state: "", mark: "" };
    });

    const bar = el("p", "iso__bar");
    const barGlyphs = el("span", "iso__barg");
    barGlyphs.setAttribute("aria-hidden", "true");
    const fill = el("span", "iso__fill");
    const rest = el("span", "iso__rest");
    barGlyphs.append(el("span", "iso__br", "["), fill, rest, el("span", "iso__br", "]"));
    const pctEl = el("span", "iso__pct", "");
    bar.append(barGlyphs, " ", pctEl);

    const slot = el("div", "iso__slot");
    const stamp = el("div", "iso__stamp");
    stamp.setAttribute("aria-hidden", "true");
    slot.appendChild(stamp);
    top.append(big, phList, bar, slot);

    // Matrix: a ruler of control numbers, then one row per theme.
    const matrix = el("div", "iso__matrix");
    matrix.setAttribute("role", "group");
    matrix.setAttribute("aria-label", "Annex A controls by theme. Use the arrow keys to move between controls.");
    const ruler = el("div", "iso__ruler");
    ruler.setAttribute("aria-hidden", "true");
    const rulerText = el("span", "iso__rt");
    ruler.append(el("span", "iso__rl"), rulerText);
    matrix.appendChild(ruler);
    const rowUi = THEMES.map((th, r) => {
      const row = el("div", "iso__row");
      row.dataset.row = r;
      const label = el("span", "iso__label");
      label.append(el("b", null, th.id), " " + th.name);
      const run = el("span", "iso__cells");
      run.setAttribute("role", "group");
      run.setAttribute("aria-label", th.id + " " + th.name + ", " + th.n + " controls");
      rows[r].forEach((c) => {
        const b = el("button", "iso__c");
        b.type = "button";
        b.tabIndex = -1;
        b.dataset.i = c.i;
        // The control's number only: whether a cell is lit is part of the illustration.
        b.setAttribute("aria-label", c.id);
        b.appendChild(el("i"));
        c.el = b;
        run.appendChild(b);
      });
      // The theme's real size, as in the standard.
      const count = el("span", "iso__n", String(th.n).padStart(2));
      count.setAttribute("aria-hidden", "true");
      row.append(label, run, count);
      matrix.appendChild(row);
      return { row };
    });
    rows[0][0].el.tabIndex = 0;
    let rover = rows[0][0];

    const status = el("p", "iso__status");
    const stKey = el("span", "iso__sk", "");
    const stVal = el("span", "iso__sv", "");
    const sp = el("span", "iso__sp", ">");
    sp.setAttribute("aria-hidden", "true");
    status.append(sp, " ", stKey, "  ", stVal);

    // The widest readout in cells: "> " + key + "  " + value (see updateStatus).
    const STATUS_W =
      4 +
      Math.max(
        ...PHASES.map((p) => p.label.length + "94%".length),
        ...THEMES.map((t) => t.id.length + (t.name + ", " + t.n + " controls").length),
        ...THEMES.map((t) => (t.id + "." + t.n).length + (t.name + ", unlit").length)
      );

    // 100 cells wide, inside a zero-size box so it never widens the page.
    const probeBox = el("span", "iso__probe");
    probeBox.setAttribute("aria-hidden", "true");
    const probe = probeBox.appendChild(el("span"));
    mount.append(top, matrix, status, probeBox);

    /* ------------------------------------------------ layout */
    let layoutKey = "";
    let stampKey = "";

    // Ruler marks sit over the cells they number, however wide the pitch is.
    function setRuler(marks, pitch) {
      rulerText.replaceChildren(
        ...marks.map((n) => {
          const s = el("span", "iso__rm", String(n));
          s.style.left = fix((n - 1) * pitch) + "px";
          return s;
        })
      );
    }

    // The stamp as character cells: a double rule through the centres of its outer cells
    // (╔═╗ ║ ╚═╝, drawn by iso.css so it joins at the figure's line height) around the words, one
    // centred on each row inside. Same font, size and grid as the rest of the figure.
    function buildStamp(form) {
      if (form.key === stampKey) return;
      stampKey = form.key;
      stamp.dataset.form = form.key;
      stamp.style.setProperty("--cols", form.cols);
      stamp.style.setProperty("--rows", form.words.length + 2);
      stamp.replaceChildren(...form.words.map((w, i) => el("span", i ? "iso__st2" : "iso__st1", w)));
    }

    function layout() {
      const w = mount.clientWidth;
      if (!w) return;
      const ch = probe.getBoundingClientRect().width / 100 || 8;
      const lh = parseFloat(getComputedStyle(mount).lineHeight) || 22;
      const cols = Math.floor(w / ch + 0.01);
      const mode = cols >= 101 ? "w2" : cols >= 64 ? "w1" : "n1";
      const split = cols >= 84;
      // Digit pixel: half a line, so the five text rows of the digits sit on the five phase lines.
      // Stacked (phones), the phases are below, so the digits leave room for the full stamp.
      const dpr = LP.dpr(3);
      const half = lh / 2;
      const px = split ? half : LP.clamp(Math.floor((w - 2 * ch - STAMPS[0].cols * ch) / 17), 8, half);
      const P = Math.max(4, Math.round(px * dpr) / dpr);
      // One control per pitch: two cells wide, one, or on the narrowest phones whatever whole
      // device pixels let the longest theme (37 controls) fit the box.
      let pitch = mode === "w2" ? 2 * ch : ch;
      if (mode === "n1") pitch = Math.min(ch, Math.floor((w / MAXN) * dpr) / dpr);
      const key = [mode, split, P, w, pitch].join("|");
      if (key === layoutKey) return;
      layoutKey = key;

      mount.dataset.layout = mode;
      mount.dataset.top = split ? "split" : "stack";
      // Two status lines where the longest readout would wrap, so a readout never moves the caption.
      status.style.minHeight = cols < STATUS_W ? fix(2 * lh) + "px" : "";
      mount.style.setProperty("--pitch", fix(pitch) + "px");
      mount.style.setProperty("--sq", (mode === "w2" ? 7 : pitch < 7 ? 4 : 5) + "px");
      bigSvg.setAttribute("width", fix(17 * P));
      bigSvg.setAttribute("height", fix(10 * P));
      setRuler(mode === "w2" ? [1, 5, 10, 15, 20, 25, 30, 35, 37] : mode === "w1" ? [1, 10, 20, 30, 37] : [1, 10, 20, 30], pitch);

      // Stamp: the largest form that fits its slot, on whole cells across and whole lines down.
      const sw = slot.clientWidth;
      const sh = slot.clientHeight;
      const form = STAMPS.find((f) => f.cols * ch <= sw + 0.5 && (f.words.length + 2) * lh <= sh + 0.5) || STAMPS[STAMPS.length - 1];
      buildStamp(form);
      const across = Math.max(0, Math.floor((sw - form.cols * ch) / 2 / ch)) * ch;
      const down = Math.max(0, Math.round((sh - (form.words.length + 2) * lh) / 2 / lh)) * lh;
      stamp.style.left = fix(Math.round(across * dpr) / dpr) + "px";
      stamp.style.top = fix(down) + "px";
    }

    /* ------------------------------------------------ state */
    let reduced = LP.reducedMotion();
    let q = 0;
    let target = 0;
    let lastP = 0;
    let lit = 0;
    let pct = 0;
    let phaseNow = -1; // the phase under way, or -1 once all are done
    let scanCol = -1;
    let stampOn = false;
    let pressT0 = -1e9;
    let pressing = false;
    let barN = -1;
    const glow = new Map(); // cell -> time it lit

    // Block digits: the digit each slot shows, and when each of its 50 pixels last switched on
    // or off, so a change can ignite like the cells do (pale red, then red) and the segments
    // going dark decay through deep red.
    const dig = [0, 1].map(() => ({
      shown: -1,
      onAt: new Float64Array(50).fill(-1e9),
      offAt: new Float64Array(50).fill(-1e9),
      key: "",
    }));

    function setDigit(s, v, now, animate) {
      const g = dig[s];
      if (g.shown === v) return;
      const a = g.shown >= 0 ? BITS[g.shown] : BITS[v];
      const b = BITS[v];
      if (animate) {
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 5; x++) {
            const bit = 1 << x;
            if (b[y] & bit && !(a[y] & bit)) g.onAt[y * 5 + x] = now;
            else if (a[y] & bit && !(b[y] & bit)) g.offAt[y * 5 + x] = now;
          }
        }
      }
      g.shown = v;
    }

    // Classify every pixel of both digits by ink and age; rewrite a path only when it changed.
    // Returns true while any pixel is still in transition.
    const inkRows = INKS.map(() => new Array(10).fill(0));
    function drawDigits(now) {
      let busy = false;
      const eight = BITS[8];
      for (let s = 0; s < 2; s++) {
        const g = dig[s];
        if (g.shown < 0) continue;
        const shown = BITS[g.shown];
        const ink = inkRows;
        ink.forEach((rows) => rows.fill(0));
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 5; x++) {
            const bit = 1 << x;
            const i = y * 5 + x;
            let k;
            if (shown[y] & bit) {
              // Big segments only warm up (no white flash): the ones digit changes every percent.
              k = now - g.onAt[i] < WARM_MS ? 3 : 2;
            } else if (eight[y] & bit) {
              k = now - g.offAt[i] < COOL_MS ? 1 : 0;
            } else continue;
            if (k !== 0 && k !== 2) busy = true;
            ink[k][y] |= bit;
          }
        }
        const key = ink.map((rows) => rows.join(",")).join("|");
        if (key === g.key) continue;
        g.key = key;
        ink.forEach((rows, k) => digPaths[s][k].setAttribute("d", rowsPath(rows, GLYPH_X[s])));
      }
      return busy;
    }

    function setPct(v, now, animate) {
      setDigit(0, Math.floor(v / 10) % 10, now, animate);
      setDigit(1, v % 10, now, animate);
    }

    function setScan(col, on) {
      if (col < 0) return;
      colCells[col].forEach((c) => c.el.classList.toggle("is-scan", on));
    }

    function setStage(c, stage) {
      if (c.stage === stage) return;
      c.stage = stage;
      c.el.classList.toggle("is-hot", stage === 2);
      c.el.classList.toggle("is-warm", stage === 1);
    }

    function stepGlow(now) {
      glow.forEach((t0, c) => {
        const age = now - t0;
        if (age >= WARM_MS) {
          glow.delete(c);
          setStage(c, 0);
        } else setStage(c, age < HOT_MS ? 2 : 1);
      });
      return glow.size > 0;
    }

    function render(now, animate) {
      // Controls
      let n = 0;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const on = c.t <= q;
        if (on) n++;
        if (on === c.on) continue;
        c.on = on;
        c.el.classList.toggle("is-on", on);
        if (on && animate) {
          glow.set(c, now);
          setStage(c, 2);
        } else if (glow.has(c)) {
          glow.delete(c);
          setStage(c, 0);
        }
      }
      lit = n;

      // Audit sweep: one column at a time, left to right
      let sc = -1;
      if (q > AUDIT[0] && q < AUDIT[1]) {
        sc = Math.floor(((q - AUDIT[0]) / (AUDIT[1] - AUDIT[0])) * (MAXN + 2) - 1);
        if (sc >= MAXN) sc = -1;
      }
      if (sc !== scanCol) {
        setScan(scanCol, false);
        setScan(sc, true);
        scanCol = sc;
      }

      // Percentage: digits, bar and text all derive from the number of lit cells
      pct = Math.round((lit * 100) / TOTAL);
      setPct(pct, now, animate);
      const nb = Math.round((lit * BAR_CELLS) / TOTAL);
      if (nb !== barN) {
        barN = nb;
        fill.style.setProperty("--n", nb);
        rest.style.setProperty("--n", BAR_CELLS - nb);
      }
      const pctText = pct + "%";
      if (pctEl.textContent !== pctText) pctEl.textContent = pctText;

      // Phases
      phaseNow = -1;
      PHASES.forEach((ph, i) => {
        const done = q >= ph.done;
        const active = !done && (i === 0 || q >= PHASES[i - 1].done);
        if (active) phaseNow = i;
        const state = done ? "done" : active ? "active" : "todo";
        const mark = done ? "x" : active ? SPIN[Math.floor(q * 160) & 3] : " ";
        const u = phases[i];
        if (u.state !== state) {
          u.state = state;
          u.li.dataset.state = state;
          u.sr.textContent = done ? " (done)" : active ? " (in progress)" : "";
        }
        if (u.mark !== mark) {
          u.mark = mark;
          u.box.textContent = mark;
        }
      });

      // Stamp
      const on = q >= STAMP_Q;
      if (on !== stampOn) {
        stampOn = on;
        stamp.classList.toggle("is-on", on);
        pressT0 = on && animate ? now : -1e9;
      }

      updateStatus();
    }

    // The landing: one frame of inverse video, then ink.
    function stepPress(now) {
      const on = now - pressT0 < PRESS_MS;
      if (on !== pressing) {
        pressing = on;
        stamp.classList.toggle("is-press", on);
      }
      return on;
    }

    /* ------------------------------------------------ status line */
    let hoverCell = null;
    let hoverRow = -1;
    let focusCell = null;
    let selRow = -1;
    let lead = "hover"; // whichever of pointer and keyboard moved last owns the readout

    // A theme: its name and its real number of controls.
    const rowText = (r) => [THEMES[r].id, THEMES[r].name + ", " + THEMES[r].n + " controls"];

    // At rest the program's state in real figures: the baseline, the phase under way, controls passing.
    // A cell reads out its control number and its state in the illustration.
    function updateStatus() {
      let s;
      const pointing = hoverCell || hoverRow >= 0;
      const c = lead === "focus" || !pointing ? focusCell || hoverCell : hoverCell;
      const r = c ? -1 : hoverRow >= 0 ? hoverRow : selRow;
      if (c) s = [c.id, THEMES[c.r].name + ", " + (c.on ? "lit" : "unlit")];
      else if (r >= 0) s = rowText(r);
      else if (stampOn) s = ["controls passing", pct + "%"];
      else if (q <= 0 || phaseNow < 0) s = ["baseline", pct + "%"];
      else s = [PHASES[phaseNow].label, pct + "%"];
      if (stKey.textContent !== s[0]) stKey.textContent = s[0];
      if (stVal.textContent !== s[1]) stVal.textContent = s[1];
    }

    /* ------------------------------------------------ interaction */
    const cellOf = (node) => {
      const b = node && node.closest && node.closest(".iso__c");
      return b ? cells[+b.dataset.i] : null;
    };

    matrix.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch" || !LP.finePointer()) return;
      const c = cellOf(e.target);
      const row = e.target.closest && e.target.closest(".iso__row");
      hoverCell = c;
      hoverRow = !c && row && e.target.closest(".iso__label") ? +row.dataset.row : -1;
      if (c || hoverRow >= 0) lead = "hover";
      updateStatus();
    });
    matrix.addEventListener("pointerleave", () => {
      hoverCell = null;
      hoverRow = -1;
      updateStatus();
    });

    // Keyboard: one tab stop for the whole matrix, arrows move between controls.
    matrix.addEventListener("focusin", (e) => {
      const c = cellOf(e.target);
      if (!c) return;
      if (rover !== c) {
        rover.el.tabIndex = -1;
        c.el.tabIndex = 0;
        rover = c;
      }
      focusCell = c;
      lead = "focus";
      updateStatus();
    });
    matrix.addEventListener("focusout", (e) => {
      if (e.relatedTarget && matrix.contains(e.relatedTarget)) return;
      focusCell = null;
      updateStatus();
    });
    matrix.addEventListener("keydown", (e) => {
      const c = cellOf(e.target);
      if (!c || e.altKey || e.ctrlKey || e.metaKey) return;
      let r = c.r;
      let k = c.k;
      if (e.key === "ArrowRight") {
        if (k < THEMES[r].n - 1) k++;
        else if (r < rows.length - 1) {
          r++;
          k = 0;
        }
      } else if (e.key === "ArrowLeft") {
        if (k > 0) k--;
        else if (r > 0) {
          r--;
          k = THEMES[r].n - 1;
        }
      } else if (e.key === "ArrowDown") r = Math.min(rows.length - 1, r + 1);
      else if (e.key === "ArrowUp") r = Math.max(0, r - 1);
      else if (e.key === "Home") k = 0;
      else if (e.key === "End") k = THEMES[r].n - 1;
      else return;
      e.preventDefault();
      k = Math.min(k, THEMES[r].n - 1);
      rows[r][k].el.focus();
    });

    // Touch: cells are too small to aim at, so a tap on a theme row reads out the whole row.
    matrix.addEventListener("click", (e) => {
      if (LP.finePointer()) return;
      const row = e.target.closest && e.target.closest(".iso__row");
      if (!row) return;
      const r = +row.dataset.row;
      selRow = selRow === r ? -1 : r;
      rowUi.forEach((u, i) => u.row.classList.toggle("is-sel", i === selRow));
      updateStatus();
    });

    /* ------------------------------------------------ driving */
    const loop = LP.loop((dt) => {
      const now = performance.now();
      if (q !== target) {
        q += (target - q) * (1 - Math.exp(-dt / TAU));
        if (Math.abs(target - q) < 0.0004) q = target;
      }
      render(now, true);
      const glowing = stepGlow(now);
      const igniting = drawDigits(now);
      const pressing = stepPress(now);
      if (q === target && !glowing && !igniting && !pressing) loop.stop();
    });

    // Jump straight to the target state with no time-based effects.
    function settle() {
      loop.stop();
      q = target;
      glow.forEach((t0, c) => setStage(c, 0));
      glow.clear();
      pressT0 = -1e9;
      dig.forEach((g) => {
        g.onAt.fill(-1e9);
        g.offAt.fill(-1e9);
      });
      const now = performance.now();
      render(now, false);
      drawDigits(now);
      stepPress(now);
    }

    layout();

    // p -> where the figure's top sits, as a fraction of the viewport height -> q
    let figH = fig.getBoundingClientRect().height;
    const toTarget = (p) => {
      if (reduced) return 1;
      const vh = window.innerHeight || 800;
      const top = 1 - (p * (vh + figH)) / vh;
      return LP.clamp((VIEW[0] - top) / (VIEW[0] - VIEW[1]), 0, 1);
    };
    let started = false;
    LP.viewProgress(fig, (p) => {
      lastP = p;
      target = toTarget(p);
      if (!started || reduced) {
        started = true;
        settle();
        return;
      }
      if (target !== q) loop.start();
    });
    if (!started) settle();

    LP.inView(fig, { leave: () => settle() });
    LP.onResize(mount, () => layout());
    // A height change (layout switch, font swap) moves the mapping, so re-derive the target.
    LP.onResize(fig, (w, h) => {
      if (Math.abs(h - figH) < 0.5) return;
      figH = h;
      const vh = window.innerHeight || 800;
      lastP = LP.clamp((vh - fig.getBoundingClientRect().top) / Math.max(1, vh + h), 0, 1);
      target = toTarget(lastP);
      if (reduced || !loop.running) settle();
    });
    if (document.fonts && document.fonts.load) {
      document.fonts.load('700 13px "JetBrains Mono"').then(() => {
        layoutKey = "";
        stampKey = "";
        layout();
      }, () => {});
    }
    if (LP.onReducedMotionChange) {
      LP.onReducedMotionChange((on) => {
        reduced = on;
        target = toTarget(lastP);
        settle();
      });
    }
  });
})();
