/* pci.js: case file 3, cardholder-data.flow.

   A test card drawn with box characters is wired from its number row into an
   entry -> module -> storage pipeline, its stages plain labels on the rule (the one holding the
   data marked with a red ">"). A packet (■) carries the card number along it: read in clear at
   entry, scrambled into base64-like ciphertext as it leaves over TLS, decrypted at the module
   and truncated, and stored as first six and last four, tagged (truncated). Below sit the 12
   principal requirements of PCI DSS v4.0.1. An inverse-video cursor walks them in step with the
   flow, visiting each one where it applies: 01-02 at entry, 04 on the wire, 05-06 in the
   module, 03 and 07-09 at storage, 10-12 across every component.

   The figure is a pure function of one timeline position T in seconds: the packet's cell, the
   trail, every scrambled glyph (hashed from its cell, the run and a 20 Hz tick) and the cursor.
   Pointing at a requirement eases T to that requirement's moment, so the flow scrubs there,
   forwards or backwards; letting go plays on from that point. A new run draws new ciphertext.
   Rendering is a character grid on one canvas. Box drawing, arrowheads and the packet are
   rectangles on whole device pixels (the web font's subset has no box-drawing glyphs, and a
   fallback font would break the grid and leave seams); text is set one character per cell, so
   no ligature or kerning can move a column. The loop runs only while something moves. */
(function () {
  "use strict";
  const LP = window.LP;
  if (!LP) return;

  /* ---------------------------------------------------------------- content */
  const PAN = "4111 1111 1111 1111"; // the standard test number
  // Truncation (PCI DSS 3.5.1): only the first six and last four digits are kept in storage.
  // Masking is the display-side term (3.4.1), so the stored form is never called masked.
  const TRUNC = "4111 11•• •••• 1111";
  const TAG = "(truncated)";
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const CIPHER = 24; // characters of ciphertext on the wire
  const LABEL_W = 24; // widest label form, used to place the label without jumps

  /* ---------------------------------------------------------------- timeline (s) */
  const TL = {
    sweep: [0.12, 0.62], // a read head crosses the card number
    depart1: 1.4, // the packet leaves entry...
    arrive1: 2.8, // ...and reaches the module
    enc: [1.42, 2.1], // clear -> ciphertext
    dec: [2.9, 3.5], // ciphertext -> truncated
    depart2: 4.2,
    arrive2: 4.85,
    tag: [4.92, 5.25], // (truncated) is typed
    all: 7.3, // 10-12: every component lit until the end
    end: 9.4,
  };
  const TICK = 20; // Hz, scramble glyph changes

  // The cursor's walk: requirement, when it takes the cursor, and the moment a pointer on it
  // seeks to (a settled frame that shows where the requirement applies).
  const WALK = [
    [1, 0.0, 0.66],
    [2, 0.7, 1.2],
    [4, 1.4, 2.3],
    [5, 2.8, 3.56],
    [6, 3.5, 4.0],
    [3, 4.2, 5.3],
    [7, 5.2, 5.7],
    [8, 5.9, 6.4],
    [9, 6.6, 7.1],
    [10, 7.3, 7.8],
    [11, 8.0, 8.5],
    [12, 8.7, 9.2],
  ];

  const NOTES = {
    entry: "card number read in clear",
    tls: "encrypted in transit",
    module: "decrypted, then truncated",
    storage: "stored truncated to first six, last four",
    scope: "logged, tested, under policy",
  };

  /* ---------------------------------------------------------------- grid plan */
  // Box-drawing cells carry arms: left, right, up, down from the cell centre.
  const AL = 1;
  const AR = 2;
  const AU = 4;
  const AD = 8;
  const CARD_H = 11;
  const PAN_ROW = 5; // the card's number row, its vertical centre
  const CHIP = { c: 3, r: 2, w: 6, h: 2 }; // the contact plate, in cells
  // Stages are plain labels on the rule, not [ bracket ] commands: nothing here is clickable.
  // Each keeps two cells in front of its name for the red ">" that marks the stage holding the
  // data, so marking one never moves anything.
  const ORDER = ["entry", "module", "storage"];
  const MARK = 2; // "> "
  const nodeW = (name) => MARK + name.length;

  function placeNode(g, name, c, r, mid) {
    g.nodes[name] = { c, r, w: nodeW(name), name, mid: mid == null ? c + MARK + (name.length >> 1) : mid };
    return c + nodeW(name);
  }

  // A horizontal link of len cells from (x, y): line, an optional word, an arrowhead last.
  function hLink(g, i, x, y, len, word) {
    const cells = [];
    const w0 = word ? x + ((len - 1 - word.length) >> 1) : -1;
    for (let k = 0; k < len; k++) {
      const c = x + k;
      if (k === len - 1) cells.push({ c, r: y, kind: "arrow", dir: "r", idx: k });
      else if (word && c >= w0 && c < w0 + word.length) cells.push({ c, r: y, kind: "text", ch: word[c - w0], idx: k });
      else cells.push({ c, r: y, kind: "line", arms: AL | AR, idx: k });
    }
    g.links[i] = cells;
    g.paths[i] = cells.filter((s) => s.kind !== "arrow").map((s) => ({ c: s.c, r: s.r }));
    return x + len;
  }

  // A vertical link of len cells down from (x, y); its word reads across the middle row.
  function vLink(g, i, x, y, len, word) {
    const cells = [];
    const path = [];
    const wr = word ? y + ((len - 1) >> 1) : -1;
    for (let k = 0; k < len; k++) {
      const r = y + k;
      if (k === len - 1) cells.push({ c: x, r, kind: "arrow", dir: "d", idx: k });
      else if (r === wr) {
        const c0 = x - (word.length >> 1);
        for (let j = 0; j < word.length; j++) cells.push({ c: c0 + j, r, kind: "text", ch: word[j], idx: k });
      } else cells.push({ c: x, r, kind: "line", arms: AU | AD, idx: k });
      if (k < len - 1) path.push({ c: x, r });
    }
    g.links[i] = cells;
    g.paths[i] = path;
    return y + len;
  }

  /* Three arrangements of the same parts:
     wide   the card on the left, the pipeline leaving its number row to the right
     stack  the card above, the pipeline below it running left to right
     tall   the card above, the pipeline running down (phones) */
  function plan(cols) {
    const mode = cols >= 90 ? "wide" : cols >= 47 ? "stack" : "tall";
    const cw = Math.min(37, cols);
    const g = {
      mode,
      cols,
      rows: 0,
      card: { w: cw, jc: -1, jr: -1, jarms: 0 },
      feed: [],
      nodes: {},
      links: [[], []],
      paths: [[], []],
      label: null,
    };
    // Fixed widths: the three stages, and one blank cell around each link.
    const FIXED = nodeW("entry") + 1 + 1 + nodeW("module") + 1 + 1 + nodeW("storage");
    if (mode === "wide") {
      const y = PAN_ROW;
      Object.assign(g.card, { jc: cw - 1, jr: y, jarms: AU | AD | AR });
      g.feed.push({ c: cw, r: y, arms: AL | AR }, { c: cw + 1, r: y, arms: AL | AR });
      let x = cw + 3;
      const spare = cols - x - FIXED;
      const l1 = Math.max(9, Math.round(spare * 0.56));
      const l2 = Math.max(5, spare - l1);
      x = placeNode(g, "entry", x, y) + 1;
      x = hLink(g, 0, x, y, l1, "tls") + 1;
      x = placeNode(g, "module", x, y) + 1;
      x = hLink(g, 1, x, y, l2, "") + 1;
      placeNode(g, "storage", x, y);
      g.rows = CARD_H;
      g.label = { kind: "below", lead: y + 1, row: y + 2, tag: y + 3, min: cw + 2 };
    } else if (mode === "stack") {
      const y = CARD_H + 1;
      const jc = MARK + 2; // above the middle of "entry"
      Object.assign(g.card, { jc, jr: CARD_H - 1, jarms: AL | AR | AD });
      g.feed.push({ c: jc, r: CARD_H, arms: AU | AD });
      const spare = cols - FIXED;
      const l1 = Math.max(9, Math.round(spare * 0.56));
      const l2 = Math.max(5, spare - l1);
      let x = placeNode(g, "entry", 0, y) + 1;
      x = hLink(g, 0, x, y, l1, "tls") + 1;
      x = placeNode(g, "module", x, y) + 1;
      x = hLink(g, 1, x, y, l2, "") + 1;
      placeNode(g, "storage", x, y);
      g.rows = y + 4;
      g.label = { kind: "below", lead: y + 1, row: y + 2, tag: y + 3, min: 0 };
    } else {
      const mc = 5; // the column the pipeline runs down
      Object.assign(g.card, { jc: mc, jr: CARD_H - 1, jarms: AL | AR | AD });
      g.feed.push({ c: mc, r: CARD_H, arms: AU | AD });
      let y = CARD_H + 1;
      const at = (name) => mc - MARK - (name.length >> 1); // the name centred on the pipe
      placeNode(g, "entry", at("entry"), y++, mc);
      y = vLink(g, 0, mc, y, 5, "tls");
      placeNode(g, "module", at("module"), y++, mc);
      y = vLink(g, 1, mc, y, 3, "");
      placeNode(g, "storage", at("storage"), y++, mc);
      g.rows = y + 1;
      g.label = { kind: "side", col: 13, tag: y };
    }
    return g;
  }

  /* ---------------------------------------------------------------- helpers */
  const smooth = (u) => u * u * (3 - 2 * u);
  // Integer hash of three ints to 32 bits: picks scramble glyphs without stored state.
  function hash3(a, b, c) {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));

  // Per run: the ciphertext and the order in which label cells settle in each transition.
  function runData(run) {
    const rnd = LP.prng(0x5ca1ab1e + run * 7919);
    let cipher = "";
    for (let i = 0; i < CIPHER - 2; i++) cipher += B64[(rnd() * 64) | 0];
    cipher += "=="; // 16 bytes, base64
    const jit = () => Array.from({ length: LABEL_W }, () => rnd());
    return { run, cipher, enc: jit(), dec: jit() };
  }

  // Where the packet is at T: inside a node, or on cell k of a link's path.
  function where(g, T) {
    const onLink = (i, u) => {
      const p = g.paths[i];
      const k = Math.min(p.length - 1, Math.floor(smooth(LP.clamp(u, 0, 1)) * p.length));
      return { node: null, link: i, k, cell: p[k], prog: i + 0.5 };
    };
    if (T < TL.depart1) return { node: "entry", link: -1, prog: 0 };
    if (T < TL.arrive1) return onLink(0, (T - TL.depart1) / (TL.arrive1 - TL.depart1));
    if (T < TL.depart2) return { node: "module", link: -1, prog: 1 };
    if (T < TL.arrive2) return onLink(1, (T - TL.depart2) / (TL.arrive2 - TL.depart2));
    return { node: "storage", link: -1, prog: 2 };
  }

  function stageAt(T) {
    if (T >= TL.all && T < TL.end) return "scope";
    if (T < TL.depart1) return "entry";
    if (T < TL.arrive1) return "tls";
    if (T < TL.arrive2) return "module";
    return "storage";
  }

  // The walk step that holds the cursor at T.
  function walkAt(T) {
    let i = 0;
    while (i + 1 < WALK.length && T >= WALK[i + 1][1]) i++;
    return i;
  }

  const truncInk = (ch) => (ch === "•" ? "bullet" : "clear");

  // The label's LABEL_W cells at T as [char, ink]; ink "" is an empty cell.
  function labelAt(T, rd, out) {
    const clear = pad(PAN, LABEL_W);
    const trunc = pad(TRUNC, LABEL_W);
    const tick = Math.floor(Math.max(0, T) * TICK);
    const trans = (from, to, w, jit, toInk) => {
      const D = w[1] - w[0];
      for (let i = 0; i < LABEL_W; i++) {
        const settle = w[0] + (i / LABEL_W) * 0.5 * D + jit[i] * 0.5 * D;
        if (T >= settle) out[i] = [to[i], to[i] === " " ? "" : toInk(to[i])];
        else if (from[i] === " " && to[i] === " ") out[i] = [" ", ""];
        else out[i] = [B64[hash3(i + 1, tick, rd.run + 7) & 63], "scr"];
      }
    };
    if (T < TL.enc[0]) for (let i = 0; i < LABEL_W; i++) out[i] = [clear[i], clear[i] === " " ? "" : "clear"];
    else if (T < TL.enc[1]) trans(clear, rd.cipher, TL.enc, rd.enc, () => "cipher");
    else if (T < TL.dec[0]) for (let i = 0; i < LABEL_W; i++) out[i] = [rd.cipher[i], "cipher"];
    else if (T < TL.dec[1]) trans(rd.cipher, trunc, TL.dec, rd.dec, truncInk);
    else for (let i = 0; i < LABEL_W; i++) out[i] = [trunc[i], trunc[i] === " " ? "" : truncInk(trunc[i])];
    return out;
  }

  /* ---------------------------------------------------------------- module */
  LP.module("pci", () => {
    const fig = document.querySelector("#case-pci [data-pci]");
    const mount = fig && fig.querySelector("[data-pci-mount]");
    const cv = mount && mount.querySelector("[data-pci-scene]");
    const ctx = cv && cv.getContext("2d");
    if (!ctx) return;
    const stageEl = mount.querySelector("[data-pci-stage]");
    const noteEl = mount.querySelector("[data-pci-note]");
    const replayBtn = mount.querySelector("[data-pci-replay]");
    const list = mount.querySelector("[data-pci-reqs]");
    const live = mount.querySelector("[data-pci-live]");
    const btns = list ? Array.from(list.querySelectorAll(".pci__req")) : [];
    // Phones: the requirement under the cursor is named in the status line, and its row of the
    // legend under the grid of numbers lights up.
    const statusEl = mount.querySelector("[data-pci-status]");
    const logEl = mount.querySelector("[data-pci-log]");
    const curEl = mount.querySelector("[data-pci-cur]");
    const curN = mount.querySelector("[data-pci-cur-n]");
    const curT = mount.querySelector("[data-pci-cur-t]");
    const legend = Array.from(mount.querySelectorAll(".pci__legend li"));
    const nameOf = (b) => {
      const t = b && b.querySelector(".pci__t");
      return t ? t.textContent.trim() : "";
    };
    const setCur = (b) => {
      curN.textContent = b ? b.dataset.req.padStart(2, "0") : "";
      curT.textContent = b ? nameOf(b) : "";
    };

    // Where the requirement line shows (phones), the status keeps the height of its longest
    // readout at this width: every stage note on the first row, and on the second every
    // requirement name or [ replay ], so nothing below it moves while the flow plays.
    function reserveStatus() {
      if (!statusEl || !logEl || !curEl || !curN || !curT || !stageEl || !noteEl) return;
      statusEl.style.minHeight = "";
      if (getComputedStyle(curEl).display === "none") return;
      const keep = [stageEl.textContent, noteEl.textContent, curN.textContent, curT.textContent];
      const walking = statusEl.classList.contains("is-walking");
      statusEl.classList.add("is-walking");
      let log = 0;
      let sr = 0;
      for (const st in NOTES) {
        stageEl.textContent = st;
        noteEl.textContent = NOTES[st];
        log = Math.max(log, logEl.offsetHeight);
      }
      btns.forEach((b) => {
        setCur(b);
        sr = Math.max(sr, curEl.offsetHeight);
      });
      [stageEl.textContent, noteEl.textContent, curN.textContent, curT.textContent] = keep;
      statusEl.classList.toggle("is-walking", walking);
      const lh = parseFloat(getComputedStyle(curEl).lineHeight) || 22;
      // [ replay ] is 40px tall, raised to centre its text on the line
      statusEl.style.minHeight = log + Math.max(sr, lh + (40 - lh) / 2) + "px";
    }
    // Measured when the page is idle, not during boot or a resize frame: the flow only plays
    // once the figure is on screen, long after this has run.
    let reserveQueued = false;
    function queueReserve() {
      if (reserveQueued) return;
      reserveQueued = true;
      const run = () => {
        reserveQueued = false;
        reserveStatus();
      };
      if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 600 });
      else setTimeout(run, 120);
    }

    /* ------------------------------------------------ inks */
    const TOK = {
      cardLine: "--fg-3",
      chip: "--red-2",
      pan: "--fg",
      dim: "--fg-3",
      soft: "--fg-2",
      wire: "--line-2",
      lit: "--red-2",
      litText: "--red-3",
      tail: "--red-3",
      head: "--red",
      packet: "--fg",
      inv: "--red",
      onInv: "--on-red",
      clear: "--fg",
      scr: "--red",
      cipher: "--red-3",
      bullet: "--red",
      lead: "--fg-3",
    };
    const INK = {};
    const readInks = () => {
      for (const k in TOK) INK[k] = LP.token(TOK[k]);
    };
    readInks();

    /* ------------------------------------------------ metrics */
    const FAMILY = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
    let G = null;
    let dpr = 1;
    let fs = 13;
    let XS = [];
    let YS = [];
    let thick = 1;
    let capH = 9;
    let cssW = 0;
    const fontOf = (wt) => wt + " " + Math.round(fs * dpr * 100) / 100 + "px " + FAMILY;

    function measure() {
      const w = mount.clientWidth;
      if (!w) return false;
      // The largest size, 13 down to 11 px, that leaves at least 38 columns.
      for (const s of [13, 12, 11]) {
        fs = s;
        if (Math.floor(w / (s * 0.6) + 0.001) >= 38) break;
      }
      const cw = fs * 0.6;
      const lh = Math.round(fs * 1.32);
      const cols = Math.floor(w / cw + 0.001);
      G = plan(cols);
      dpr = LP.dpr(3);
      cssW = w;
      const cssH = G.rows * lh;
      cv.style.width = w + "px";
      cv.style.height = cssH + "px";
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(cssH * dpr);
      const span = cols + LABEL_W + 4;
      XS = Array.from({ length: span }, (_, c) => Math.round(c * cw * dpr));
      YS = Array.from({ length: G.rows + 2 }, (_, r) => Math.round(r * lh * dpr));
      thick = Math.max(1, Math.round(dpr));
      ctx.font = fontOf(400);
      const m = ctx.measureText("0");
      capH = m.actualBoundingBoxAscent || fs * dpr * 0.73;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      queueReserve();
      return true;
    }

    /* ------------------------------------------------ drawing primitives (device px) */
    function arm(c, r, arms, ink) {
      const x0 = XS[c];
      const x1 = XS[c + 1];
      const y0 = YS[r];
      const y1 = YS[r + 1];
      const cx = x0 + ((x1 - x0 - thick) >> 1);
      const cy = y0 + ((y1 - y0 - thick) >> 1);
      ctx.fillStyle = INK[ink];
      if (arms & AL) ctx.fillRect(x0, cy, cx + thick - x0, thick);
      if (arms & AR) ctx.fillRect(cx, cy, x1 - cx, thick);
      if (arms & AU) ctx.fillRect(cx, y0, thick, cy + thick - y0);
      if (arms & AD) ctx.fillRect(cx, cy, thick, y1 - cy);
    }

    // Arrowheads as stepped pixel triangles: crisp at any DPR, the line running into the base.
    function arrow(c, r, dir, ink) {
      const x0 = XS[c];
      const x1 = XS[c + 1];
      const y0 = YS[r];
      const y1 = YS[r + 1];
      const cwd = x1 - x0;
      ctx.fillStyle = INK[ink];
      if (dir === "r") {
        const cy = y0 + ((y1 - y0 - thick) >> 1);
        const len = Math.max(4, Math.round(cwd * 0.78));
        const half = Math.max(2, Math.round(len * 0.6));
        const tip = x1 - Math.round(cwd * 0.06);
        const bx = tip - len;
        ctx.fillRect(x0, cy, bx - x0 + 1, thick);
        for (let j = -half; j <= half + thick - 1; j++) {
          const d = j < 0 ? -j : Math.max(0, j - (thick - 1));
          const w = Math.round(len * (1 - d / (half + 0.5)));
          if (w > 0) ctx.fillRect(bx, cy + j, w, 1);
        }
      } else {
        const cx = x0 + ((cwd - thick) >> 1);
        const len = Math.max(4, Math.round(cwd * 0.78));
        const half = Math.max(2, Math.round(len * 0.6));
        const tip = y1 - Math.round((y1 - y0) * 0.18);
        const by = tip - len;
        ctx.fillRect(cx, y0, thick, by - y0 + 1);
        for (let j = -half; j <= half + thick - 1; j++) {
          const d = j < 0 ? -j : Math.max(0, j - (thick - 1));
          const h = Math.round(len * (1 - d / (half + 0.5)));
          if (h > 0) ctx.fillRect(cx + j, by, 1, h);
        }
      }
    }

    function block(c0, c1, r, ink) {
      ctx.fillStyle = INK[ink];
      ctx.fillRect(XS[c0], YS[r], XS[c1] - XS[c0], YS[r + 1] - YS[r]);
    }

    // The chip: a solid plate of whole cells with its contact pads cut out of it, so the
    // ground shows through the cuts (a centre pad and two pads either side).
    function chip(c0, r0, nc, nr, ink) {
      const x0 = XS[c0];
      const x1 = XS[c0 + nc];
      const y0 = YS[r0];
      const y1 = YS[r0 + nr];
      const w = x1 - x0;
      const h = y1 - y0;
      ctx.fillStyle = INK[ink];
      ctx.fillRect(x0, y0, w, h);
      const xa = x0 + Math.round(w / 3);
      const xb = x0 + Math.round((2 * w) / 3);
      const ym = y0 + Math.round(h / 2) - (thick >> 1);
      ctx.clearRect(xa, y0, thick, h);
      ctx.clearRect(xb, y0, thick, h);
      ctx.clearRect(x0, ym, xa - x0, thick);
      ctx.clearRect(xb + thick, ym, x1 - xb - thick, thick);
    }

    function packet(c, r, ink) {
      const x0 = XS[c];
      const x1 = XS[c + 1];
      const y0 = YS[r];
      const y1 = YS[r + 1];
      const s = Math.max(4, Math.round((x1 - x0) * 0.74));
      ctx.fillStyle = INK[ink];
      ctx.fillRect(x0 + ((x1 - x0 - s) >> 1), y0 + ((y1 - y0 - s) >> 1), s, s);
    }

    /* ------------------------------------------------ one frame */
    const texts = new Map();
    const LBL = Array.from({ length: LABEL_W }, () => [" ", ""]);
    let RD = runData(0);

    function put(c, r, ch, ink, wt) {
      if (ch === " " || !ink) return;
      const key = (wt || 400) + "|" + ink;
      let a = texts.get(key);
      if (!a) texts.set(key, (a = []));
      a.push(c, r, ch);
    }
    function putStr(c, r, s, ink, wt) {
      for (let i = 0; i < s.length; i++) put(c + i, r, s[i], ink, wt);
    }

    function draw(T) {
      const g = G;
      if (!g) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      texts.forEach((a) => (a.length = 0));
      const pos = where(g, T);
      const all = T >= TL.all && T < TL.end;
      const cw = g.card.w;
      const H = CARD_H;

      // Card: frame (with the junction the feed leaves from), chip, number, expiry, name.
      for (let c = 0; c < cw; c++) {
        for (let r = 0; r < H; r++) {
          const top = r === 0;
          const bot = r === H - 1;
          const left = c === 0;
          const right = c === cw - 1;
          if (!top && !bot && !left && !right) continue;
          let a = top || bot ? AL | AR : AU | AD;
          if (top && left) a = AR | AD;
          else if (top && right) a = AL | AD;
          else if (bot && left) a = AR | AU;
          else if (bot && right) a = AL | AU;
          if (c === g.card.jc && r === g.card.jr) a = g.card.jarms;
          arm(c, r, a, "cardLine");
        }
      }
      chip(CHIP.c, CHIP.r, CHIP.w, CHIP.h, "chip");
      let sweep = -1;
      if (T >= TL.sweep[0] && T < TL.sweep[1]) {
        sweep = Math.floor(((T - TL.sweep[0]) / (TL.sweep[1] - TL.sweep[0])) * PAN.length);
        block(3 + sweep, 4 + sweep, PAN_ROW, "inv");
      }
      for (let i = 0; i < PAN.length; i++) put(3 + i, PAN_ROW, PAN[i], i === sweep ? "onInv" : "pan", 700);
      putStr(3, 7, "VALID THRU", "dim");
      putStr(14, 7, "12/30", "soft");
      putStr(3, 9, "CARDHOLDER", "soft");

      // Feed from the card into entry: always carrying data.
      g.feed.forEach((s) => arm(s.c, s.r, s.arms, "lit"));

      // Links: crossed cells lit, a one-cell tail behind the packet, the rest still dark.
      g.links.forEach((cells, i) => {
        const state = pos.prog > i + 0.5 ? "done" : pos.link === i ? "on" : "ahead";
        for (const s of cells) {
          let ink = "wire";
          if (state === "done") ink = s.kind === "arrow" ? "head" : "lit";
          else if (state === "on") ink = s.idx < pos.k - 1 ? "lit" : s.idx === pos.k - 1 ? "tail" : "wire";
          const under = state === "on" && s.idx === pos.k && s.c === pos.cell.c;
          if (under) ink = "tail";
          if (s.kind === "line") arm(s.c, s.r, s.arms, ink);
          else if (under) arm(s.c, s.r, g.mode === "tall" ? AU | AD : AL | AR, ink); // a letter under the packet
          else if (s.kind === "arrow") arrow(s.c, s.r, s.dir, ink);
          else put(s.c, s.r, s.ch, ink === "wire" ? "dim" : ink === "lit" || ink === "head" ? "litText" : ink, 500);
        }
      });

      // Stages: plain labels. The one holding the packet (all three for 10-12) gets a red ">"
      // and full white, passed ones the secondary text color, the rest stay dim.
      ORDER.forEach((name, j) => {
        const n = g.nodes[name];
        const on = all || pos.node === name;
        if (on) put(n.c, n.r, ">", "head", 700);
        putStr(n.c + MARK, n.r, n.name, on ? "pan" : j < pos.prog ? "soft" : "dim", on ? 700 : 500);
      });

      // The label rides with the packet: under it on a leader, or beside it when the pipe runs down.
      const L = g.label;
      const node = pos.node ? g.nodes[pos.node] : null;
      const ac = node ? node.mid : pos.cell.c;
      const ar = node ? node.r : pos.cell.r;
      labelAt(T, RD, LBL);
      let lc;
      let lr;
      if (L.kind === "below") {
        lc = LP.clamp(ac - (PAN.length >> 1), L.min, g.cols - LABEL_W);
        lr = L.row;
        arm(ac, L.lead, AU | AD, "lead");
        if (!node) arm(ac, ar, AD, "lead");
      } else {
        lc = L.col;
        lr = ar;
      }
      // The number in clear and its truncated form share the card's bold; ciphertext is regular.
      for (let i = 0; i < LABEL_W; i++) {
        const ink = LBL[i][1];
        put(lc + i, lr, LBL[i][0], ink, ink === "clear" || ink === "bullet" ? 700 : 400);
      }

      // (truncated), typed once the packet is stored, with a block cursor while it types.
      if (T >= TL.tag[0]) {
        const u = LP.clamp((T - TL.tag[0]) / (TL.tag[1] - TL.tag[0]), 0, 1);
        const n = Math.min(TAG.length, Math.floor(u * TAG.length + 1e-6));
        const tr = L.tag;
        putStr(lc, tr, TAG.slice(0, n), "dim", 400);
        if (n < TAG.length) block(lc + n, lc + n + 1, tr, "inv");
      }

      // Text, batched by weight and ink, one character per cell.
      const half = capH / 2;
      texts.forEach((a, key) => {
        if (!a.length) return;
        const bar = key.indexOf("|");
        ctx.font = fontOf(key.slice(0, bar));
        ctx.fillStyle = INK[key.slice(bar + 1)];
        for (let i = 0; i < a.length; i += 3) {
          const c = a[i];
          const r = a[i + 1];
          ctx.fillText(a[i + 2], (XS[c] + XS[c + 1]) / 2, Math.round((YS[r] + YS[r + 1]) / 2 + half));
        }
      });

      if (pos.link >= 0) packet(pos.cell.c, pos.cell.r, "packet");
    }

    /* ------------------------------------------------ status line and cursor */
    const walkOfReq = {};
    WALK.forEach((w, i) => (walkOfReq[w[0]] = i));
    const btnOfWalk = (i) => btns[WALK[i][0] - 1];
    let shownStage = "";
    let shownCur = -1;

    /* ------------------------------------------------ timeline state */
    let T = LP.reducedMotion() ? TL.end : 0;
    let playing = false;
    let target = null; // a seek in progress
    let hold = -1; // walk step held by a pointer, focus or tap
    let started = false;
    let visible = false;
    let run = 0;

    function syncDom() {
      const st = stageAt(T);
      if (st !== shownStage) {
        shownStage = st;
        if (stageEl) stageEl.textContent = st;
        if (noteEl) noteEl.textContent = NOTES[st];
      }
      const cur = hold >= 0 ? hold : (playing || target != null) && T >= 0 && T < TL.end ? walkAt(T) : -1;
      if (cur !== shownCur) {
        const lg = (i) => legend[WALK[i][0] - 1];
        if (shownCur >= 0) {
          if (btnOfWalk(shownCur)) btnOfWalk(shownCur).classList.remove("is-cur");
          if (lg(shownCur)) lg(shownCur).classList.remove("is-cur");
        }
        if (cur >= 0) {
          if (btnOfWalk(cur)) btnOfWalk(cur).classList.add("is-cur");
          if (lg(cur)) lg(cur).classList.add("is-cur");
        }
        if (curN && curT) setCur(cur >= 0 ? btnOfWalk(cur) : null);
        if (statusEl) statusEl.classList.toggle("is-walking", cur >= 0);
        shownCur = cur;
      }
    }

    function frame() {
      draw(T);
      syncDom();
    }

    /* ------------------------------------------------ driving */
    const SEEK_TAU = 0.11; // s, time constant of a seek
    let acc = 0;
    const loop = LP.loop((dt) => {
      if (target != null) {
        T += (target - T) * (1 - Math.exp(-dt / SEEK_TAU));
        if (Math.abs(target - T) < 0.004) T = target;
      } else if (playing) {
        T = Math.min(TL.end, T + dt);
        if (T >= TL.end) {
          playing = false;
          started = true;
          if (replayBtn) replayBtn.hidden = false;
        }
      }
      const idle = !playing && (target == null || T === target);
      acc += dt;
      // About 30 frames a second is plenty for cell-stepped motion; the last frame always draws.
      if (acc >= 1 / 31 || idle) {
        acc = 0;
        frame();
      }
      if (idle) loop.stop();
    });
    const kick = () => {
      if (visible && !loop.running) loop.start();
    };

    function play(from) {
      if (LP.reducedMotion()) return;
      hold = -1;
      target = null;
      T = from;
      playing = true;
      started = true;
      kick();
    }

    function replay() {
      run++;
      RD = runData(run);
      play(-0.25);
    }

    // speak: announce where the requirement applies (keyboard focus and taps only, never a
    // hover), and only when that differs from the last announcement.
    function seek(i, speak) {
      if (i < 0 || i >= WALK.length) return;
      if (speak && live) {
        const st = stageAt(WALK[i][2]);
        const msg = "in the flow: " + st + ", " + NOTES[st];
        if (live.textContent !== msg) live.textContent = msg;
      }
      hold = i;
      playing = false;
      if (LP.reducedMotion()) {
        target = null;
        T = WALK[i][2];
        frame();
        return;
      }
      target = WALK[i][2];
      started = true;
      if (!visible) {
        T = target;
        frame();
      }
      kick();
    }

    // Letting go plays on from wherever the seek left the flow.
    function release() {
      if (hold < 0) return;
      hold = -1;
      target = null;
      if (LP.reducedMotion()) {
        T = TL.end;
        frame();
        return;
      }
      if (T < TL.end) {
        playing = true;
        kick();
      } else frame();
      if (replayBtn) replayBtn.hidden = false;
    }

    if (replayBtn) replayBtn.addEventListener("click", replay);

    /* ------------------------------------------------ requirements: point, focus or tap */
    const idxOf = (b) => walkOfReq[+b.dataset.req];
    let lastDown = { type: "", t: -1e9 };
    const touchRecent = () => lastDown.type === "touch" && performance.now() - lastDown.t < 900;

    // One tab stop for the list; arrows move between requirements.
    btns.forEach((b, i) => (b.tabIndex = i === 0 ? 0 : -1));
    const rove = (b) => {
      btns.forEach((x) => (x.tabIndex = x === b ? 0 : -1));
    };

    if (list) {
      list.addEventListener("pointerdown", (e) => {
        lastDown = { type: e.pointerType, t: performance.now() };
      });
      list.addEventListener("pointerover", (e) => {
        if (e.pointerType !== "mouse" || !LP.finePointer()) return;
        const b = e.target.closest && e.target.closest(".pci__req");
        if (b) seek(idxOf(b));
      });
      list.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "mouse") return;
        const f = document.activeElement;
        if (f && list.contains(f) && f.matches(":focus-visible")) seek(idxOf(f));
        else release();
      });
      list.addEventListener("focusin", (e) => {
        const b = e.target.closest && e.target.closest(".pci__req");
        if (!b) return;
        rove(b);
        if (touchRecent()) return;
        // A mouse click focuses the button too; only keyboard focus is announced.
        let kbd = true;
        try {
          kbd = b.matches(":focus-visible");
        } catch (err) {
          kbd = lastDown.type !== "mouse" || performance.now() - lastDown.t > 900;
        }
        seek(idxOf(b), kbd);
      });
      list.addEventListener("focusout", (e) => {
        if (e.relatedTarget && list.contains(e.relatedTarget)) return;
        if (touchRecent()) return;
        release();
      });
      // Touch: a tap holds the flow at that requirement; a second tap lets it play on.
      list.addEventListener("click", (e) => {
        const b = e.target.closest && e.target.closest(".pci__req");
        if (!b || !touchRecent()) return;
        const i = idxOf(b);
        if (hold === i) release();
        else seek(i, true);
      });
      // Arrows follow the layout: two columns of six (desktop), one column, or the phone grid
      // of numbers, six to a row.
      list.addEventListener("keydown", (e) => {
        const b = e.target.closest && e.target.closest(".pci__req");
        if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
        const i = btns.indexOf(b);
        const rows6 = btns.length > 6 && btns[1].offsetTop === btns[0].offsetTop;
        const cols6 = !rows6 && btns.length > 6 && btns[6].offsetLeft > btns[0].offsetLeft + 4;
        let j = i;
        if (e.key === "ArrowDown") j = rows6 ? i + 6 : i + 1;
        else if (e.key === "ArrowUp") j = rows6 ? i - 6 : i - 1;
        else if (e.key === "ArrowRight") j = cols6 ? i + 6 : i + 1;
        else if (e.key === "ArrowLeft") j = cols6 ? i - 6 : i - 1;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = btns.length - 1;
        else if (e.key === "Escape") {
          b.blur();
          release();
          e.preventDefault();
          return;
        } else return;
        e.preventDefault();
        if (j < 0 || j >= btns.length) j = i; // the edge of the grid: stay
        btns[j].focus();
      });
    }

    /* ------------------------------------------------ observers */
    // Play once the whole scene sits in the upper part of the screen, with the list coming into
    // view under it (or, on a screen too short for that, once it reaches the top third).
    LP.viewProgress(cv, () => {
      if (started || LP.reducedMotion()) return;
      const r = cv.getBoundingClientRect();
      // An empty rect (a hidden or not yet laid out page) passes the tests below: wait for a real one.
      if (!r.width || !r.height) return;
      const vh = window.innerHeight || 1;
      if ((r.top >= 0 && r.bottom <= vh * 0.86) || (r.top <= vh * 0.3 && r.bottom > vh * 0.3)) play(-0.35);
    });
    // Pause whenever the figure is off screen.
    LP.inView(fig, {
      enter: () => {
        visible = true;
        if (playing || target != null) kick();
      },
      leave: () => {
        visible = false;
        loop.stop();
      },
    });

    LP.onResize(mount, (w) => {
      if (Math.abs(w - cssW) < 0.5 && G && dpr === LP.dpr(3)) return;
      if (measure()) frame();
    });
    // Moving the window to a screen with another pixel ratio resizes nothing, so watch for it
    // and rebuild the backing store at the new ratio.
    const watchDpr = () => {
      try {
        const m = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        const again = () => {
          if (measure()) frame();
          watchDpr();
        };
        if (m.addEventListener) m.addEventListener("change", again, { once: true });
      } catch (e) {
        /* no resolution media queries: keep the first measure */
      }
    };
    watchDpr();

    if (LP.onReducedMotionChange) {
      LP.onReducedMotionChange((on) => {
        if (!on) return;
        loop.stop();
        playing = false;
        target = null;
        hold = -1;
        T = TL.end;
        if (replayBtn) replayBtn.hidden = true;
        frame();
      });
    }

    // Draw now (fallback metrics if the font is not in yet), and again once it is.
    if (measure()) frame();
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('400 13px "JetBrains Mono"'),
        document.fonts.load('700 13px "JetBrains Mono"'),
      ]).then(
        () => {
          readInks();
          if (measure()) frame();
        },
        () => {}
      );
    }
  });
})();
