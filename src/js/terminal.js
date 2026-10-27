/* terminal.js: PAPALIA(1)'s command line, a shell overlay.

   Opens with Ctrl+K / Cmd+K, the backtick key while nothing has focus, or LP 'terminal:open'
   (the top-bar button). Closes with Esc, the [ esc ] button, a click on the scrim, exit or Ctrl+D.

   The opening is one orchestrated piece, quantized to the character grid: the block cursor
   draws the top border one cell per step (the title appears as it passes), paints the window
   down the right edge one text row per step, types the login banner and settles into the
   prompt. Any key or click skips it. Output prints through a small tty driver on one LP.loop:
   rows stream at a fixed rate with the cursor riding their end, and the real numbers of each
   case step one cell at a time (13% -> 94%, ~31,000 triaged). The shell reads its answers from
   the page itself (description, results, cases, role, contact), so it never says what the page
   doesn't. The recruiter-facing commands (summary, role, cases, skills, contact) come first.

   Hardening, since visitors will poke at it: commands are a fixed allow-list looked up as own
   properties only; input is capped at MAX_IN characters and stripped of control and bidi
   characters; everything a visitor types is written with textContent (no innerHTML, no eval);
   history lives in memory only; the shell makes no network requests. */
(function () {
  "use strict";
  const LP = window.LP;
  if (!LP) return;

  LP.module("terminal", () => {
    const dlg = document.querySelector("[data-terminal]");
    if (!dlg) return;
    const $ = (s) => dlg.querySelector(s);
    const win = $("[data-terminal-win]");
    const scrim = $("[data-terminal-scrim]");
    const screen = $("[data-terminal-screen]");
    const log = $("[data-terminal-out]");
    const form = $("[data-terminal-form]");
    const input = $("[data-terminal-input]");
    const mirror = $("[data-terminal-mirror]");
    const pen = $("[data-terminal-pen]");
    const closeBtn = $("[data-terminal-close]");
    if (!win || !scrim || !screen || !log || !form || !input || !mirror) return;

    const reduced = () => LP.reducedMotion();
    const coarse = () => !LP.finePointer();
    const canModal = typeof dlg.showModal === "function";

    /* ================================================================ small DOM helpers */
    const el = (tag, cls, txt) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      return n;
    };
    const squash = (s) => String(s || "").replace(/\s+/g, " ");
    const text = (n) => (n ? squash(n.textContent).trim() : "");
    const pad = (s, w) => s + " ".repeat(Math.max(1, w - s.length));
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    // Input hygiene: one line, no control or bidi-override characters, and a hard length cap.
    const MAX_IN = 256;
    const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
    const clean = (v) => String(v || "").replace(/\r\n?|\n|\t/g, " ").replace(UNSAFE, "").slice(0, MAX_IN);

    /* ================================================================ metrics */
    // One character cell (cw) and one text row (lh) in px, and the window's width in columns.
    const M = { cw: 9, lh: 24, fs: 15, cols: 80 };
    const probe = el("span", "terminal__probe", "0".repeat(20));
    probe.setAttribute("aria-hidden", "true");
    win.appendChild(probe);
    function measure() {
      const w = probe.getBoundingClientRect().width;
      if (w > 0) M.cw = w / 20;
      const cs = getComputedStyle(log);
      M.fs = parseFloat(cs.fontSize) || 15;
      M.lh = parseFloat(cs.lineHeight) || M.fs * 1.6;
      const lw = log.clientWidth;
      if (lw > 0) M.cols = Math.max(24, Math.floor((lw + 0.5) / M.cw));
      // Touch keyboards zoom into inputs under 16px: keep the real input at 16px, scaled to the
      // cell size, so its (transparent) glyphs still sit on the mirror's.
      if (coarse() && M.fs < 16) {
        input.style.fontSize = "16px";
        input.style.setProperty("--in-scale", (M.fs / 16).toFixed(5));
      } else {
        input.style.fontSize = "";
        input.style.removeProperty("--in-scale");
      }
    }
    // The screen keeps its size while rows are added, so this fires on real resizes only.
    LP.onResize(screen, (w) => {
      if (w > 0) measure();
    });
    if (document.fonts && document.fonts.load) {
      document.fonts.load('15px "JetBrains Mono"').then(() => !dlg.hidden && measure(), () => {});
    }
    const wide = () => M.cols >= 64;
    const IND = () => (wide() ? 7 : 2); // man-page body indent

    /* ================================================================ rows */
    // A row is { s: segments, ind, hang, art, typed, hide } or a plain string.
    // Segments: "text" | {t, c} | {t, href} (in-page link) | {t, url} (new tab) |
    //           {t, run, fill} (runnable command) | {t, copy} | {sr} (screen readers only) | {node}
    function seg(s) {
      if (s == null) return document.createTextNode("");
      if (typeof s === "string") return document.createTextNode(s);
      if (s.node) return s.node;
      if (s.sr != null) return el("span", "t-sr", s.sr);
      if (s.href) {
        // Short labels ("case file 4") never break across rows.
        const a = el("a", "t-link", s.t.length <= 20 ? s.t.replace(/ /g, "\u00a0") : s.t);
        a.href = s.href;
        return a;
      }
      if (s.url) {
        const a = el("a", "t-link", s.t);
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        return a;
      }
      if (s.run != null) {
        const b = el("button", "t-run" + (s.c ? " " + s.c : ""), s.t);
        b.type = "button";
        b.tabIndex = -1;
        b.dataset.run = s.run;
        if (s.fill) b.dataset.fill = "1";
        return b;
      }
      if (s.copy != null) {
        const b = el("button", "cmd cmd--quiet t-copy", "copy");
        b.type = "button";
        b.dataset.copy = s.copy;
        b.setAttribute("aria-label", "copy " + s.copy);
        return b;
      }
      if (s.hide) {
        const sp = el("span", s.c || "", s.t);
        sp.setAttribute("aria-hidden", "true");
        return sp;
      }
      return s.c ? el("span", s.c, s.t) : document.createTextNode(s.t);
    }
    function row(ln) {
      if (typeof ln === "string" || Array.isArray(ln)) ln = { s: ln };
      const d = el("div", "terminal__ln" + (ln.art ? " terminal__ln--art" : ""));
      if (ln.ind) d.style.setProperty("--ind", ln.ind);
      if (ln.hang) d.style.setProperty("--hang", ln.hang);
      if (ln.hide) d.setAttribute("aria-hidden", "true");
      const host = ln.typed ? d.appendChild(el("span", "terminal__typed")) : d;
      (Array.isArray(ln.s) ? ln.s : [ln.s]).forEach((s) => host.appendChild(seg(s)));
      return d;
    }
    const MAX_ROWS = 400;
    function append(ln) {
      const d = row(ln);
      log.appendChild(d);
      while (log.childElementCount > MAX_ROWS) log.firstElementChild.remove();
      return d;
    }
    const autoscroll = () => {
      screen.scrollTop = screen.scrollHeight;
    };

    /* ================================================================ tty driver */
    // A queue of jobs run by one loop. job.step(t) gets the ms since the job began and returns
    // the leftover ms once done, or -1 while running. flush() completes everything at once.
    const queue = [];
    let cur = null;
    const tcur = el("span", "terminal__tcur", "\u00a0");
    tcur.setAttribute("aria-hidden", "true");
    const tty = LP.loop((dt) => drive(dt * 1000), { realtime: true });

    function enqueue(job) {
      queue.push(job);
      if (job.busy) dlg.classList.add("is-busy");
    }
    function kick() {
      if (!cur && !queue.length) return;
      drive(0);
      if ((cur || queue.length) && !tty.running) tty.start();
    }
    function drive(ms) {
      let t = ms;
      for (;;) {
        if (!cur) {
          cur = queue.shift();
          if (!cur) {
            tty.stop();
            settle();
            return;
          }
          cur.t = 0;
          syncBusy();
        }
        cur.t += t;
        const left = cur.step(cur.t);
        if (left < 0) break;
        cur = null;
        t = left;
      }
      autoscroll();
    }
    let flushing = false;
    function flush() {
      if (flushing || (!cur && !queue.length)) return;
      flushing = true;
      for (;;) {
        if (!cur) {
          cur = queue.shift();
          if (!cur) break;
          cur.t = 0;
        }
        cur.step(Infinity);
        cur = null;
      }
      flushing = false;
      tty.stop();
      settle();
    }
    function syncBusy() {
      const b = !!(cur && cur.busy) || queue.some((j) => j.busy);
      dlg.classList.toggle("is-busy", b);
      if (!b) tcur.remove();
    }
    function settle() {
      dlg.classList.remove("is-busy");
      tcur.remove();
      renderMirror();
      autoscroll();
      if (phase === "open") {
        const a = document.activeElement;
        if (!a || !win.contains(a)) focusHome();
      }
    }
    const rateFor = (n) => (reduced() ? 0 : Math.max(5, Math.min(16, 320 / Math.max(1, n))));

    // Rows stream one at a time; the cursor rides the end of the last one.
    function printJob(lines, rate) {
      let i = 0;
      const n = lines.length;
      return {
        busy: true,
        step(t) {
          const k = rate <= 0 || t === Infinity ? n : Math.min(n, Math.floor(t / rate) + 1);
          let last = null;
          while (i < k) last = append(lines[i++]);
          if (last && t !== Infinity) last.appendChild(tcur);
          if (i < n) return -1;
          return t === Infinity ? Infinity : Math.max(0, t - (n - 1) * rate);
        },
      };
    }
    function out(lines) {
      enqueue(printJob(lines, rateFor(lines.length)));
    }
    function tweenJob(duration, fn) {
      const d = reduced() ? 0 : duration;
      return {
        busy: true,
        step(t) {
          const p = d > 0 && t !== Infinity ? Math.min(1, t / d) : 1;
          fn(p);
          if (p < 1) return -1;
          return t === Infinity ? Infinity : t - d;
        },
      };
    }
    function waitJob(ms) {
      const d = reduced() ? 0 : ms;
      return { busy: true, step: (t) => (t >= d ? (t === Infinity ? Infinity : t - d) : -1) };
    }
    // Runs fn after the current drive, so it may close the window or start other work safely.
    function callJob(fn) {
      return {
        busy: false,
        step(t) {
          setTimeout(fn, 0);
          return t;
        },
      };
    }
    // Types a command into the prompt (used when a command is clicked), then runs it.
    function typeJob(cmd, per) {
      let shown = -1;
      return {
        busy: false,
        step(t) {
          const k = t === Infinity || per <= 0 ? cmd.length : Math.min(cmd.length, Math.floor(t / per));
          if (k !== shown) {
            shown = k;
            input.value = cmd.slice(0, k);
            try {
              input.setSelectionRange(k, k);
            } catch (e) {}
            typingPulse();
            renderMirror();
          }
          if (k < cmd.length) return -1;
          return t === Infinity ? Infinity : Math.max(0, t - cmd.length * per);
        },
      };
    }

    /* ================================================================ prompt: mirror + cursor */
    let typing = false;
    let typingTimer = 0;
    let mirrorQueued = false;
    function renderMirror() {
      const v = input.value;
      const focused = document.activeElement === input;
      let a = input.selectionStart;
      let b = input.selectionEnd;
      if (a == null || b == null) a = b = v.length;
      const txt = (t) => document.createTextNode(t);
      if (focused && a !== b) {
        mirror.replaceChildren(txt(v.slice(0, a)), el("span", "terminal__sel", v.slice(a, b)), txt(v.slice(b)));
      } else {
        const p = input.selectionDirection === "backward" ? a : b;
        const cls = "terminal__cur" + (focused ? (typing ? " is-typing" : "") : " is-idle");
        mirror.replaceChildren(txt(v.slice(0, p)), el("span", cls, v.charAt(p) || " "), txt(v.slice(p + 1)));
      }
    }
    function queueMirror() {
      if (mirrorQueued) return;
      mirrorQueued = true;
      requestAnimationFrame(() => {
        mirrorQueued = false;
        renderMirror();
      });
    }
    // The cursor holds still while keys are pressed and blinks again once typing pauses.
    function typingPulse() {
      typing = true;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        typing = false;
        renderMirror();
      }, 650);
    }
    ["input", "keyup", "click", "select", "focus", "blur", "compositionend"].forEach((ev) => input.addEventListener(ev, queueMirror));
    document.addEventListener("selectionchange", () => {
      if (document.activeElement === input) queueMirror();
    });

    /* ================================================================ history */
    // In memory only: nothing a visitor types is stored, and it ends with the tab.
    let hist = [];
    let hIdx = -1;
    let draft = "";
    function pushHist(cmd) {
      if (hist[hist.length - 1] !== cmd) hist.push(cmd);
      if (hist.length > 100) hist = hist.slice(-100);
      hIdx = -1;
    }
    function setInput(v) {
      input.value = v;
      try {
        input.setSelectionRange(v.length, v.length);
      } catch (e) {}
      renderMirror();
    }

    /* ================================================================ page content */
    // The shell quotes the page. Fallbacks only cover a missing section.
    const FALLBACK = {
      cases: [
        { name: "iso", id: "case-iso", idx: "1", cmd: "papalia --comply iso27001", title: "ISO/IEC 27001: from 13% to 94% of controls passing", summary: "I ran the company's ISO/IEC 27001 program from a 13% baseline to 94% of controls passing, tracked on Vanta. No certification audit yet." },
        { name: "devsecops", id: "case-devsecops", idx: "2", cmd: "papalia --devsecops sca,sast,dast,iac", title: "About 31,000 DevSecOps findings, triaged in five weeks", summary: "About 31,000 SCA, SAST, DAST and IaC findings triaged in five weeks, each one fixed, mitigated, risk-accepted or deferred to the next monthly cycle." },
        { name: "pci", id: "case-pci", idx: "3", cmd: "papalia --certify pci-dss", title: "A PCI DSS–compliant module", summary: "I built all the security functionality of a PCI DSS payment module myself, to a very strict deadline. It was certified by a third-party assessor." },
      ],
      about: ["Cybersecurity engineer at Smartness, a hospitality technology company, covering what a startup CISO covers."],
      target: "Security Engineer at Bending Spoons",
      areas: ["*.security-leadership", "*.governance-compliance", "*.privacy-gdpr", "*.application-security", "*.devsecops", "*.cloud-security", "*.observability", "*.infrastructure", "*.networking", "*.ai-augmented-engineering"],
    };

    // Inline page markup to segments: bold stays bright, in-page links stay links.
    function segsOf(node) {
      const outSegs = [];
      const walk = (n) => {
        n.childNodes.forEach((c) => {
          if (c.nodeType === 3) {
            outSegs.push(squash(c.nodeValue));
          } else if (c.nodeType === 1) {
            if (c.classList.contains("visually-hidden") || c.getAttribute("aria-hidden") === "true") return;
            const href = c.tagName === "A" ? c.getAttribute("href") || "" : "";
            if (href.charAt(0) === "#") outSegs.push({ t: squash(c.textContent), href });
            else if (c.tagName === "B" || c.tagName === "STRONG") outSegs.push({ t: squash(c.textContent), c: "t-b" });
            else if (c.classList.contains("hi")) outSegs.push({ t: squash(c.textContent), c: "t-red" });
            else walk(c);
          }
        });
      };
      walk(node);
      // Trim the ends of the paragraph.
      const first = outSegs[0];
      if (typeof first === "string") outSegs[0] = first.replace(/^\s+/, "");
      else if (first && first.t) first.t = first.t.replace(/^\s+/, "");
      const lastI = outSegs.length - 1;
      const last = outSegs[lastI];
      if (typeof last === "string") outSegs[lastI] = last.replace(/\s+$/, "");
      else if (last && last.t) last.t = last.t.replace(/\s+$/, "");
      return outSegs;
    }
    function caseList() {
      const arts = Array.from(document.querySelectorAll("article.case[id^='case-']"));
      if (!arts.length) return FALLBACK.cases;
      return arts.map((a) => ({
        name: a.dataset.case || a.id.replace(/^case-/, ""),
        id: a.id,
        idx: text(a.querySelector(".case__idx")),
        cmd: text(a.querySelector(".case__cmd")).replace(/^\$\s*/, ""),
        title: text(a.querySelector(".case__title")),
        prose: Array.from(a.querySelectorAll(".prose p")),
      }));
    }
    function roleList() {
      return Array.from(document.querySelectorAll("#role .role__item")).map((it) => ({
        n: text(it.querySelector(".role__n")),
        title: text(it.querySelector(".role__title")),
        req: it.querySelector(".role__req"),
        ev: it.querySelector(".role__ev"),
      }));
    }
    function resultRows() {
      return Array.from(document.querySelectorAll("#results tbody tr")).map((tr) => ({
        area: text(tr.querySelector("th")),
        val: text(tr.querySelector(".res__val")),
        status: text(tr.querySelector(".res__status")),
      }));
    }
    function areas() {
      const found = Array.from(document.querySelectorAll("#description .areas [data-x]"))
        .map((n) => n.getAttribute("data-x") || "")
        .filter((s) => s.startsWith("*.") && s.length > 2);
      return found.length ? found : FALLBACK.areas;
    }
    // The position this page applies for, as the page states it.
    const target = () => text(document.querySelector("#role .prose b")) || FALLBACK.target;

    /* ================================================================ output pieces */
    const arrow = (label, href) => ({ s: [{ t: "-> ", c: "t-dim" }, { t: label, href }] });
    const head = (t) => ({ s: [{ t, c: "t-head" }] });
    const usage = (...s) => ({ s: [{ t: "usage: ", c: "t-dim" }, ...s] });

    // GNU ls -C: as many columns as fit, filled top to bottom.
    function layoutCols(lengths, cols, gap) {
      const n = lengths.length;
      for (let nc = n; nc >= 1; nc--) {
        const nr = Math.ceil(n / nc);
        const used = Math.ceil(n / nr);
        const widths = [];
        for (let c = 0; c < used; c++) {
          let w = 0;
          for (let r = 0; r < nr; r++) {
            const i = c * nr + r;
            if (i < n) w = Math.max(w, lengths[i]);
          }
          widths.push(w);
        }
        if (widths.reduce((a, b) => a + b, 0) + gap * (used - 1) <= cols || nc === 1) return { nr, widths };
      }
      return { nr: n, widths: [Math.max(...lengths)] };
    }

    // Optimal string alignment distance (Levenshtein plus adjacent transpositions).
    function dist(a, b) {
      const m = a.length;
      const n = b.length;
      if (!m) return n;
      if (!n) return m;
      const d = [];
      for (let i = 0; i <= m; i++) {
        d.push(new Array(n + 1).fill(0));
        d[i][0] = i;
      }
      for (let j = 0; j <= n; j++) d[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
      return d[m][n];
    }
    function closest(word, list) {
      if (!word || word.length > 32) return null;
      let best = null;
      let bd = Infinity;
      list.forEach((c) => {
        const k = dist(word, c);
        if (k < bd) {
          bd = k;
          best = c;
        }
      });
      const limit = word.length <= 3 ? 1 : word.length <= 6 ? 2 : 3;
      return bd <= limit ? best : null;
    }

    /* ================================================================ commands */
    const CASE_ALIAS = {
      1: "iso", iso27001: "iso", 27001: "iso", "iso-27001": "iso", "iso/iec": "iso",
      2: "devsecops", sca: "devsecops", sast: "devsecops", dast: "devsecops", iac: "devsecops", findings: "devsecops", 31000: "devsecops",
      3: "pci", "pci-dss": "pci", pcidss: "pci",
    };

    function cmdHelp() {
      const W = M.cols < 56 ? 17 : 18;
      const r = (name, desc) => ({ s: [{ t: name, run: name }, " ".repeat(Math.max(1, W - name.length)), desc], ind: 2, hang: W });
      const caseRun = (n) => ({ t: n, run: "case " + n });
      const list = (names) => {
        const segs = [];
        names.forEach((m, i) => {
          if (i) segs.push("  ");
          segs.push({ t: m, run: m });
        });
        return { s: segs, ind: 2, hang: 2 };
      };
      out([
        { s: [{ t: "start here", c: "t-dim" }] },
        r("summary", "profile and key results"),
        r("role", "how my work maps to the Security Engineer role"),
        r("cases", "the three case files"),
        { s: [{ t: "case", run: "case ", fill: true }, " ", { t: "<name>", c: "t-var" }, " ".repeat(W - 11), caseRun("iso"), " ", caseRun("devsecops"), " ", caseRun("pci")], ind: 2, hang: W },
        r("skills", "areas of expertise, standards and tooling"),
        r("about", "the description, in full"),
        r("contact", "how to reach me"),
        "",
        { s: [{ t: "also", c: "t-dim" }] },
        r("security", "how this shell is hardened, for anyone testing it"),
        r("ls", "the page as files; cat one to read it"),
        list(["whoami", "sudo hire luigi", "man papalia", "history", "date", "echo", "keys", "clear", "exit"]),
        "",
        { s: [{ t: coarse() ? "tap a command to run it" : "click a command or type it. tab completes, up and down walk the history, esc closes", c: "t-dim" }], ind: 2, hang: 2 },
      ]);
    }

    function cmdWhoami() {
      const P = LP.profile || {};
      const kv = (k, v) => [{ t: pad(k, 8), c: "t-red" }, { t: v, c: "t-in" }];
      const info = [
        [{ t: "papalia", c: "t-red t-b" }, { t: "@", c: "t-dim" }, { t: "cv", c: "t-red t-b" }],
        [{ t: "----------", c: "t-dim" }],
        kv("name", P.name || "Luigi Papalia"),
        kv("role", "Cybersecurity Engineer, Smartness"),
        kv("type", "engineer, the wildcard (*)"),
        kv("scope", "security, infrastructure, networking"),
        kv("ai", "early adopter, Claude"),
        kv("applying", "Security Engineer, Bending Spoons"),
      ];
      // The wildcard, drawn on the cell grid: arms in deep red, the star in signal red.
      const LOGO = ["       |       ", "  \\    |    /  ", "    \\  |  /    ", "-------*-------", "    /  |  \\    ", "  /    |    \\  ", "       |       "];
      const logoSegs = (s) => {
        const i = s.indexOf("*");
        return i < 0 ? [{ t: s, c: "t-deep", hide: true }] : [{ t: s.slice(0, i), c: "t-deep", hide: true }, { t: "*", c: "t-red t-b", hide: true }, { t: s.slice(i + 1), c: "t-deep", hide: true }];
      };
      const lines = [];
      if (M.cols >= 64) {
        const top = 1;
        info.forEach((segs, i) => {
          const li = i - top;
          const logo = li >= 0 && li < LOGO.length ? logoSegs(LOGO[li]) : [{ t: " ".repeat(15), hide: true }];
          lines.push({ s: [...logo, { t: "    ", hide: true }, ...segs], art: true });
        });
      } else {
        // Narrow: the classic three-cell asterisk beside the first rows.
        const MINI = ["\\|/", "-*-", "/|\\"];
        info.forEach((segs, i) => {
          const logo = i < MINI.length ? logoSegs(MINI[i]) : [{ t: "   ", hide: true }];
          lines.push({ s: [...logo, { t: "   ", hide: true }, ...segs], hang: i > 1 ? 14 : 6 });
        });
      }
      out(lines);
    }

    function cmdAbout() {
      const ps = Array.from(document.querySelectorAll("#description .prose p"));
      const I = IND();
      const paras = ps.length ? ps.map(segsOf) : FALLBACK.about.map((s) => [s]);
      const lines = [head("DESCRIPTION")];
      paras.forEach((segs, i) => {
        if (i) lines.push("");
        lines.push({ s: segs, ind: I });
      });
      lines.push("", Object.assign(arrow("read it on the page", "#description"), { ind: I }));
      out(lines);
    }

    function cmdCases() {
      const I = IND();
      const lines = [head("CASE FILES")];
      const narrow = M.cols < 56;
      caseList().forEach((c) => {
        const num = { t: c.idx, c: "t-red" };
        const name = { t: c.name, run: "case " + c.name };
        const title = { t: c.title, href: "#" + c.id };
        if (narrow) {
          lines.push({ s: [num, "  ", name], ind: I });
          lines.push({ s: [title], ind: I + 3 });
        } else lines.push({ s: [num, "  ", name, " ".repeat(Math.max(1, 12 - c.name.length)), title], ind: I, hang: 15 });
      });
      lines.push("", { s: [{ t: "case", c: "t-in" }, " ", { t: "<name>", c: "t-var" }, " prints a summary"], ind: I }, { s: ["a title opens the case file"], ind: I });
      out(lines);
    }

    // The real numbers of each case, stepped one cell at a time.
    function meterFor(name) {
      const narrow = !wide();
      if (name === "iso") {
        const cells = narrow ? 12 : 24;
        const box = el("span");
        box.setAttribute("aria-hidden", "true");
        const on = el("span", "t-on");
        const off = el("span", "t-off");
        const val = el("span", "t-in");
        const st = el("span", "t-red");
        box.append(el("span", "t-dim", "13%  ["), on, off, el("span", "t-dim", "]  "), val, st);
        const draw = (v, done) => {
          const n = Math.round((v / 100) * cells);
          on.textContent = "█".repeat(n);
          off.textContent = "·".repeat(cells - n);
          val.textContent = Math.round(v) + "%";
          st.textContent = done ? "  passing" : "";
        };
        draw(13, false);
        return {
          rows: [{ s: [narrow ? "" : { t: "compliance  ", c: "t-dim" }, { node: box }, { sr: "controls passing went from 13% to 94%" }], art: true }],
          job: tweenJob(760, (p) => draw(LP.lerp(13, 94, LP.easeInOutCubic(p)), p >= 1)),
        };
      }
      if (name === "devsecops") {
        const TOTAL = 31000;
        const cells = narrow ? 12 : 24;
        const box = el("span");
        box.setAttribute("aria-hidden", "true");
        const on = el("span", "t-on");
        const off = el("span", "t-off");
        const val = el("span", "t-in");
        box.append(el("span", "t-dim", "["), on, off, el("span", "t-dim", "]  "), val);
        const draw = (v, done) => {
          const n = Math.round((v / TOTAL) * cells);
          on.textContent = "█".repeat(n);
          off.textContent = "·".repeat(cells - n);
          val.textContent = (done ? "~" : "") + Math.round(v).toLocaleString("en-US") + " triaged";
        };
        draw(0, false);
        const label = (t) => (narrow ? "" : { t, c: "t-dim" });
        return {
          rows: [
            { s: [label("findings  "), { node: box }, { sr: "about 31,000 findings, all triaged" }], art: true },
            { s: [label("          "), { t: "fixed, mitigated, risk-accepted or deferred", c: "t-dim" }], art: true },
          ],
          job: tweenJob(900, (p) => draw(LP.lerp(0, TOTAL, LP.easeInOutCubic(p)), p >= 1)),
        };
      }
      if (name === "pci") {
        // The test card from the case figure; storage keeps the first six and last four.
        const clear = "4111 1111 1111 1111";
        const order = [7, 8, 10, 11, 12, 13];
        const stored = el("span", "t-in", clear);
        stored.setAttribute("aria-hidden", "true");
        const draw = (k) => {
          const nodes = [];
          let run = "";
          let masked = false;
          const push = () => {
            if (run) nodes.push(masked ? el("span", "t-red", run) : document.createTextNode(run));
            run = "";
          };
          for (let i = 0; i < clear.length; i++) {
            const j = order.indexOf(i);
            const m = j > -1 && j < k;
            if (m !== masked) {
              push();
              masked = m;
            }
            run += m ? "*" : clear[i];
          }
          push();
          stored.replaceChildren(...nodes);
        };
        draw(0);
        return {
          rows: [
            { s: [{ t: "entry   ", c: "t-dim" }, { t: clear, c: "t-in" }, { t: "  test card, read in clear", c: "t-dim" }], hang: 8 },
            { s: [{ t: "stored  ", c: "t-dim" }, { node: stored }, { t: "  first six and last four kept", c: "t-dim" }, { sr: "stored truncated: 4111 11, six digits removed, 1111" }], hang: 8 },
          ],
          job: tweenJob(480, (p) => draw(Math.floor(p * order.length + 1e-6))),
        };
      }
      return null;
    }

    function cmdCase(args) {
      const list = caseList();
      const names = list.map((c) => c.name);
      const runList = () => {
        const segs = [];
        names.forEach((n, i) => {
          if (i) segs.push(i === names.length - 1 ? " or " : ", ");
          segs.push({ t: n, run: "case " + n });
        });
        return segs;
      };
      if (!args.length) {
        out([usage({ t: "case", c: "t-in" }, " ", { t: "<name>", c: "t-var" }), { s: ["names: ", ...runList()] }]);
        return;
      }
      const a = args[0].toLowerCase();
      const name = names.includes(a) ? a : own(CASE_ALIAS, a) ? CASE_ALIAS[a] : null;
      const c = list.find((x) => x.name === name);
      if (!c) {
        const near = closest(a, names);
        out([
          { s: ["case: " + args[0] + ": no such case file"] },
          near ? { s: ["did you mean ", { t: "case " + near, run: "case " + near, c: "t-run--red" }, "?"] } : { s: ["try ", ...runList()] },
        ]);
        return;
      }
      out([{ s: [{ t: "$ ", c: "t-dim" }, { t: c.cmd, c: "t-red" }], hang: 2 }, { s: [{ t: c.title, c: "t-b" }] }, ""]);
      const m = meterFor(c.name);
      if (m) {
        out(m.rows);
        enqueue(m.job);
      }
      const paras = c.prose && c.prose.length ? c.prose.map(segsOf) : [[c.summary]];
      const body = [];
      paras.forEach((segs, i) => {
        if (i) body.push("");
        body.push({ s: segs });
      });
      out([m ? "" : null, ...body, "", arrow("open case file " + c.idx, "#" + c.id)].filter((x) => x !== null));
    }

    function cmdRole() {
      const I = IND();
      const S = 4;
      const lead = document.querySelector("#role .prose");
      const lines = [head("ROLE")];
      if (lead) lines.push({ s: segsOf(lead), ind: I }, "");
      const items = roleList();
      if (!items.length) lines.push({ s: ["applying for " + target()], ind: I });
      items.forEach((it, i) => {
        if (i) lines.push("");
        lines.push({ s: [{ t: it.n, c: "t-red" }, "  ", { t: it.title, c: "t-b" }], ind: I, hang: S });
        if (it.req) lines.push({ s: segsOf(it.req), ind: I + S });
        if (it.ev) lines.push({ s: [{ t: "-> ", c: "t-red" }, ...segsOf(it.ev)], ind: I + S, hang: 3 });
      });
      lines.push("", Object.assign(arrow("read it on the page", "#role"), { ind: I }));
      out(lines);
    }

    function cmdSummary() {
      const I = IND();
      const first = document.querySelector("#description .prose p");
      const lines = [head("SUMMARY"), { s: first ? segsOf(first) : [FALLBACK.about[0]], ind: I }];
      lines.push({ s: [{ t: "applying for ", c: "t-dim" }, { t: target(), c: "t-red" }], ind: I }, "");
      const AW = 21;
      const SW = 14;
      resultRows().forEach((r) => {
        if (wide()) lines.push({ s: [{ t: pad(r.area, AW), c: "t-b" }, { t: pad(r.status, SW), c: "t-red" }, { t: r.val, c: "t-in" }], ind: I, hang: AW + SW });
        else {
          lines.push({ s: [{ t: r.area, c: "t-b" }, "  ", { t: r.status, c: "t-red" }], ind: I });
          lines.push({ s: [{ t: r.val, c: "t-in" }], ind: I + 2 });
        }
      });
      const go = (n) => ({ t: n, run: n, c: "t-run--red" });
      lines.push("", { s: [{ t: "next  ", c: "t-dim" }, go("role"), "  ", go("cases"), "  ", go("skills"), "  ", go("contact")], ind: I });
      out(lines);
    }

    function cmdSkills() {
      const I = IND();
      const items = areas();
      const lines = [head("SKILLS")];
      const { nr, widths } = layoutCols(
        items.map((s) => s.length),
        Math.max(20, M.cols - I),
        2
      );
      for (let r = 0; r < nr; r++) {
        const segs = [];
        widths.forEach((w, c) => {
          const i = c * nr + r;
          if (i >= items.length) return;
          const name = items[i];
          segs.push({ t: "*.", c: "t-red" }, { t: name.slice(2), c: "t-in" });
          if (c < widths.length - 1 && (c + 1) * nr + r < items.length) segs.push(" ".repeat(w - name.length + 2));
        });
        lines.push({ s: segs, art: true, ind: I });
      }
      const kv = (k, v) => ({ s: [{ t: pad(k, 11), c: "t-dim" }, { t: v, c: "t-in" }], ind: I, hang: 11 });
      lines.push(
        "",
        kv("standards", "ISO/IEC 27001 (94% of controls passing), PCI DSS, GDPR"),
        kv("scanning", "SCA, SAST, DAST, IaC"),
        kv("tools", "Snyk, Vanta, Upwind, Falco, GCP, AWS, GitHub, Dynatrace, Splunk"),
        kv("ai", "early adopter; AI-augmented engineering through Claude")
      );
      out(lines);
    }

    function cmdSecurity() {
      const I = IND();
      const item = (t) => ({ s: [{ t: "- ", c: "t-red" }, t], ind: I, hang: 2 });
      out([
        head("SECURITY"),
        { s: [{ t: "how this shell is built, for anyone who wants to test it", c: "t-dim" }], ind: I },
        "",
        item("it runs entirely in your browser and makes no network requests"),
        item("commands come from a fixed allow-list; anything else is command not found"),
        item("input is capped at " + MAX_IN + " characters and stripped of control and bidi characters"),
        item("what you type is only ever written as text: no innerHTML, no eval"),
        item("history lives in memory and is gone when you close the tab"),
        "",
        { s: ["found a way around it? I'd like to hear about it: ", { t: "contact", run: "contact", c: "t-run--red" }], ind: I },
      ]);
    }

    // ls and cat: the page as a few readable files.
    const FILES = {
      "summary.txt": () => cmdSummary(),
      "role.txt": () => cmdRole(),
      "skills.txt": () => cmdSkills(),
      "about.txt": () => cmdAbout(),
      "contact.txt": () => cmdContact(),
      "security.txt": () => cmdSecurity(),
      "cert.pem": () => out(certRows()),
    };

    function cmdLs(args) {
      let a = (args[0] || "").toLowerCase();
      if (a.endsWith("/") && a.length > 1) a = a.slice(0, -1);
      let names;
      if (a === "cases") names = caseList().map((c) => ({ t: c.name, run: "case " + c.name }));
      else if (!a || a === "." || a === "~" || a === "/home/papalia") {
        names = [{ t: "cases/", run: "ls cases", c: "t-run--red" }].concat(Object.keys(FILES).map((f) => ({ t: f, run: "cat " + f })));
      } else {
        out(["ls: cannot access '" + args[0] + "': No such file or directory"]);
        return;
      }
      const { nr, widths } = layoutCols(
        names.map((n) => n.t.length),
        M.cols,
        2
      );
      const lines = [];
      for (let r = 0; r < nr; r++) {
        const segs = [];
        widths.forEach((w, c) => {
          const i = c * nr + r;
          if (i >= names.length) return;
          segs.push(names[i]);
          if (c < widths.length - 1 && (c + 1) * nr + r < names.length) segs.push(" ".repeat(w - names[i].t.length + 2));
        });
        lines.push({ s: segs, art: true });
      }
      out(lines);
    }

    function cmdContact() {
      const I = IND();
      const P = LP.profile || {};
      const lines = [head("CONTACT")];
      ["email", "phone", "linkedin", "github", "location"].filter((k) => String(P[k] || "").trim()).forEach((k) => {
        const v = String(P[k] || "").trim();
        const label = { t: pad(k, 10), c: "t-dim" };
        let segs;
        if (LP.isPlaceholder(v)) segs = [label, { t: v || "[not set]", c: "t-dim" }, { t: "  (placeholder)", c: "t-dim" }];
        else if (k === "linkedin" || k === "github") segs = [label, { t: v.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""), url: /^https?:\/\//i.test(v) ? v : "https://" + v }];
        else if (k === "email" || k === "phone") segs = [label, { t: v, c: "t-in" }, "  ", { copy: v }];
        else segs = [label, { t: v, c: "t-in" }];
        lines.push({ s: segs, ind: I, hang: 10 });
      });
      lines.push("", Object.assign(arrow("go to contact", "#contact"), { ind: I }));
      out(lines);
    }

    function cmdDate() {
      const d = new Date();
      const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const p2 = (n) => String(n).padStart(2, "0");
      let tz = "";
      try {
        const part = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(d).find((x) => x.type === "timeZoneName");
        tz = part ? part.value : "";
      } catch (e) {}
      const s = `${DAYS[d.getDay()]} ${MONS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${tz ? " " + tz : ""} ${d.getFullYear()}`;
      out([{ s: [{ t: s, c: "t-in" }] }]);
    }

    function cmdHistory(args) {
      if (args[0] === "-c") {
        hist = [];
        return;
      }
      out(hist.map((h, i) => ({ s: [{ t: String(i + 1).padStart(5) + "  ", c: "t-dim" }, { t: h, c: "t-in" }], hang: 7 })));
    }

    const ENV = { USER: "papalia", LOGNAME: "papalia", HOME: "/home/papalia", PWD: "/home/papalia", HOSTNAME: "cv", SHELL: "/bin/sh", TERM: "xterm-256color" };
    function cmdEcho(rest) {
      let s = rest.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, k) => (Object.prototype.hasOwnProperty.call(ENV, k) ? ENV[k] : ""));
      s = s.replace(/(["'])(.*?)\1/g, "$2");
      out([{ s: [{ t: s, c: "t-in" }] }]);
    }

    function cmdTheme(args) {
      const a = (args[0] || "").toLowerCase();
      if (!a || /^(red|dark|red-on-black|default)$/.test(a)) out([{ s: ["theme: ", { t: "red on black", c: "t-red" }, ", the only one installed"] }]);
      else out([{ s: ["theme: " + args[0] + ": not installed. ", { t: "red on black", c: "t-red" }, " is the only theme"] }]);
    }

    // Single-key page shortcuts (j/k, g/G, the backtick) can be turned off (WCAG 2.1.4).
    function cmdKeys(args) {
      const a = (args[0] || "").toLowerCase();
      if (!LP.keys) {
        out(["keys: page shortcuts are not available"]);
        return;
      }
      if (a === "on" || a === "off") LP.keys.set(a === "on");
      else if (a) {
        out([usage({ t: "keys", c: "t-in" }, " ", { t: "on|off", c: "t-var" })]);
        return;
      }
      out([{ s: ["page keys j/k g/G and ` are ", { t: LP.keys.enabled ? "on" : "off", c: "t-red" }] }]);
    }

    function cmdMan(args) {
      const a = args.join(" ").toLowerCase();
      if (!a) {
        out(["what manual page do you want?", { s: ["for example, try ", { t: "man papalia", run: "man papalia", c: "t-run--red" }] }]);
        return;
      }
      if (/^(1 )?(papalia|luigi|luigi papalia)(\(1\))?$/.test(a)) {
        enqueue(callJob(() => navigate("#top")));
        return;
      }
      out(["no manual entry for " + args.join(" ")]);
    }

    function cmdSudo(args) {
      const a = args.join(" ").toLowerCase();
      if (/^hire( (luigi|papalia|luigi papalia|me))?$/.test(a)) {
        out(["[sudo] no password needed for this one", { s: [{ t: "hire: ", c: "t-dim" }, "opening contact"] }]);
        enqueue(waitJob(560));
        enqueue(callJob(() => navigate("#contact")));
        return;
      }
      if (!a) {
        out([usage({ t: "sudo hire luigi", run: "sudo hire luigi", c: "t-run--red" })]);
        return;
      }
      out([{ s: ["sudo: " + args.join(" ") + ": not permitted here. try ", { t: "sudo hire luigi", run: "sudo hire luigi", c: "t-run--red" }] }]);
    }

    function certRows() {
      // Base64 of a readable note, so a curious decoder finds the joke: serial 2A is ASCII "*".
      const note = "subject=CN=Luigi Papalia\nissuer=CN=papalia(1)\nserial=2A, the ASCII code of *\nsan=*.security,*.infrastructure,*.network\nusage=any problem that fits nobody's job\n";
      let b64 = "";
      try {
        b64 = btoa(note);
      } catch (e) {}
      const star = (s) => [{ t: "*", c: "t-red" }, { t: s, c: "t-in" }];
      return [
        { s: [{ t: "subject", c: "t-dim" }, "=CN = ", { t: "Luigi Papalia", c: "t-in" }] },
        { s: [{ t: "issuer", c: "t-dim" }, "=CN = papalia(1), self-signed"] },
        { s: [{ t: "serial", c: "t-dim" }, "=2A"] },
        { s: [{ t: "X509v3 Subject Alternative Name:", c: "t-dim" }] },
        { s: ["    DNS:", ...star(".security"), ", DNS:", ...star(".infrastructure"), ", DNS:", ...star(".network")], hang: 4 },
        { s: [{ t: "-----BEGIN CERTIFICATE-----", c: "t-pale" }] },
        ...(b64.match(/.{1,64}/g) || []).map((l) => ({ s: [{ t: l, c: "t-deep" }] })),
        { s: [{ t: "-----END CERTIFICATE-----", c: "t-pale" }] },
      ];
    }

    function cmdCat(args) {
      const files = Object.keys(FILES);
      const fileRuns = () => {
        const segs = [];
        files.forEach((f, i) => {
          if (i) segs.push("  ");
          segs.push({ t: f, run: "cat " + f });
        });
        return segs;
      };
      if (!args.length) {
        out([usage("cat ", { t: "<file>", c: "t-var" }), { s: fileRuns(), hang: 2 }]);
        return;
      }
      let f = args[0].toLowerCase();
      if (f.startsWith("./") || f.startsWith("~/")) f = f.slice(2);
      if (f === "*.pem") f = "cert.pem";
      if (own(FILES, f)) FILES[f]();
      else if (f === "cases" || f === "cases/") out(["cat: " + args[0] + ": Is a directory"]);
      else {
        const near = closest(f, files);
        out([{ s: ["cat: " + args[0] + ": No such file or directory"] }, near ? { s: ["did you mean ", { t: "cat " + near, run: "cat " + near, c: "t-run--red" }, "?"] } : { s: ["try ", { t: "ls", run: "ls", c: "t-run--red" }] }]);
      }
    }

    function cmdNmap() {
      out([
        "Nmap scan report for cv (198.51.100.42)",
        "Not shown: 999 filtered tcp ports",
        { s: [{ t: "PORT     STATE  SERVICE", c: "t-dim" }], art: true },
        { s: ["443/tcp  ", { t: "open", c: "t-red" }, "   https"], art: true },
        "Nmap done: 1 IP address (1 host up). the rest stays filtered",
      ]);
    }

    function cmdPing(args) {
      const host = args.filter((a) => a.charAt(0) !== "-")[0];
      if (!host) out(["ping: usage error: destination address required"]);
      // Solaris ping answers in one line.
      else if (/^(luigi|papalia|luigi-papalia|cv|localhost|127\.0\.0\.1|::1)$/i.test(host)) out([host + " is alive"]);
      else out(["ping: " + host + ": Name or service not known"]);
    }

    function cmdSsh(args) {
      const target = args.filter((a) => a.charAt(0) !== "-")[0] || "papalia@cv";
      out([target + ": Permission denied (publickey).", { s: ["password logins are off here too. try ", { t: "contact", run: "contact", c: "t-run--red" }] }]);
    }

    function cmdRm(args) {
      const flags = args.filter((a) => a.charAt(0) === "-").join(" ");
      const paths = args.filter((a) => a.charAt(0) !== "-");
      if (/-\w*[rR]|--recursive/.test(flags) && paths.some((p) => p === "/" || p === "/*")) {
        if (/--no-preserve-root/.test(flags)) out(["rm: cannot remove '/': Read-only file system"]);
        else out(["rm: it is dangerous to operate recursively on '/'", "rm: use --no-preserve-root to override this failsafe"]);
      } else if (!paths.length) out(["rm: missing operand"]);
      else out(["rm: cannot remove '" + paths[0] + "': Read-only file system"]);
    }

    function cmdClear() {
      log.textContent = "";
    }

    function cmdExit() {
      out(["logout"]);
      enqueue(waitJob(240));
      // A new login prints the banner again; the history stays, like a shell's history file.
      enqueue(
        callJob(() =>
          close(() => {
            log.textContent = "";
            booted = false;
          })
        )
      );
    }

    function unknown(cmd, rest) {
      if (cmd === "hire") {
        out([{ s: ["hire: permission denied"] }, { s: ["did you mean ", { t: "sudo hire luigi", run: "sudo hire luigi", c: "t-run--red" }, "?"] }]);
        return;
      }
      const near = closest(cmd.toLowerCase(), SUGGEST);
      const full = near ? near + (rest ? " " + rest : "") : "";
      out([
        { s: [{ t: cmd, c: "t-in" }, ": command not found"] },
        near ? { s: ["did you mean ", { t: full, run: full, c: "t-run--red" }, "?"] } : { s: ["type ", { t: "help", run: "help", c: "t-run--red" }, " to list commands"] },
      ]);
    }

    const COMMANDS = {
      help: cmdHelp,
      "?": cmdHelp,
      summary: cmdSummary,
      cv: cmdSummary,
      resume: cmdSummary,
      results: cmdSummary,
      role: cmdRole,
      fit: cmdRole,
      job: cmdRole,
      options: cmdRole,
      skills: cmdSkills,
      security: cmdSecurity,
      whoami: cmdWhoami,
      neofetch: cmdWhoami,
      about: cmdAbout,
      cases: cmdCases,
      case: (a) => cmdCase(a),
      ls: (a) => cmdLs(a),
      dir: (a) => cmdLs(a),
      contact: cmdContact,
      date: cmdDate,
      history: (a) => cmdHistory(a),
      echo: (a, rest) => cmdEcho(rest),
      theme: (a) => cmdTheme(a),
      keys: (a) => cmdKeys(a),
      man: (a) => cmdMan(a),
      sudo: (a) => cmdSudo(a),
      cat: (a) => cmdCat(a),
      nmap: cmdNmap,
      ping: (a) => cmdPing(a),
      ssh: (a) => cmdSsh(a),
      rm: (a) => cmdRm(a),
      clear: cmdClear,
      cls: cmdClear,
      reset: cmdClear,
      exit: cmdExit,
      logout: cmdExit,
      quit: cmdExit,
      q: cmdExit,
      ":q": cmdExit,
      ":q!": cmdExit,
      ":wq": cmdExit,
      pwd: () => out(["/home/papalia"]),
      hostname: () => out(["cv"]),
      uname: (a) => out([a.some((x) => x.charAt(0) === "-" && x.indexOf("a") > 0) ? "luigi-os cv 2026.10 tty1" : "luigi-os"]),
      cd: (a) => {
        if (a.length && ["~", "~/", ".", "./", "/home/papalia", "/home/papalia/"].indexOf(a[0]) < 0) out(["cd: " + a[0] + ": No such file or directory"]);
      },
    };
    // Documented commands complete with Tab; every known command can be suggested.
    const COMPLETE = ["help", "summary", "role", "cases", "case", "skills", "about", "contact", "security", "whoami", "ls", "cat", "man", "sudo", "history", "date", "echo", "theme", "keys", "clear", "exit"];
    const SUGGEST = COMPLETE.concat(["resume", "results", "options", "nmap", "ping", "ssh", "pwd", "uname", "hostname", "logout"]);
    const ARGS = {
      case: () => caseList().map((c) => c.name),
      man: () => ["papalia"],
      cat: () => Object.keys(FILES),
      sudo: () => ["hire luigi"],
      theme: () => ["red"],
      keys: () => ["on", "off"],
      ls: () => ["cases"],
    };

    function execute(line) {
      const m = line.match(/^(\S+)\s*(.*)$/);
      if (!m) return;
      const cmd = m[1].toLowerCase();
      const rest = m[2];
      const args = rest ? rest.split(/\s+/) : [];
      const fn = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : null;
      if (fn) fn(args, rest);
      else unknown(m[1], rest);
    }

    const promptRow = (raw) => ({ s: [{ t: "papalia@cv:~$", c: "t-ps" }, " ", { t: raw, c: "t-in" }], hang: 0 });

    function submit() {
      finishOpen();
      flush();
      const raw = clean(input.value);
      setInput("");
      hIdx = -1;
      draft = "";
      append(promptRow(raw));
      const line = raw.trim();
      if (line) {
        pushHist(line);
        execute(line);
      }
      if (cur || queue.length) kick();
      else settle();
    }

    // A clicked command is typed into the prompt first, so visitors learn the words.
    function clickRun(cmd, fillOnly) {
      finishOpen();
      flush();
      hIdx = -1;
      if (fillOnly) {
        setInput(cmd);
        focusInput();
        return;
      }
      if (reduced()) {
        setInput(cmd);
        submit();
      } else {
        setInput("");
        enqueue(typeJob(cmd, 24));
        // Runs only if the prompt still holds exactly the typed command: a key pressed meanwhile
        // (Enter, or an extra character) wins over the click.
        enqueue(callJob(() => phase === "open" && input.value === cmd && submit()));
        kick();
      }
      if (!coarse()) focusInput();
    }

    /* ================================================================ completion */
    function lcp(list) {
      let p = list[0] || "";
      list.forEach((s) => {
        while (p && !s.startsWith(p)) p = p.slice(0, -1);
      });
      return p;
    }
    function complete() {
      const v = input.value;
      let base;
      let prefix;
      let pool;
      const first = v.match(/^(\s*)(\S*)$/);
      if (first) {
        base = first[1];
        prefix = first[2].toLowerCase();
        pool = COMPLETE;
      } else {
        const mm = v.match(/^(\s*\S+\s+)(.*)$/);
        if (!mm) return;
        base = mm[1];
        prefix = mm[2].toLowerCase();
        const cmd = mm[1].trim().toLowerCase();
        pool = own(ARGS, cmd) ? ARGS[cmd]() : [];
      }
      const cands = pool.filter((c) => c.toLowerCase().startsWith(prefix)).sort();
      if (!cands.length) return;
      if (cands.length === 1) {
        setInput(base + cands[0] + " ");
        return;
      }
      const common = lcp(cands);
      if (common.length > prefix.length) {
        setInput(base + common);
        return;
      }
      // Ambiguous: list the candidates under a copy of the prompt, as bash does on a second tab.
      append(promptRow(v));
      const { nr, widths } = layoutCols(
        cands.map((c) => c.length),
        M.cols,
        2
      );
      for (let r = 0; r < nr; r++) {
        let s = "";
        widths.forEach((w, c) => {
          const i = c * nr + r;
          if (i < cands.length) s += c < widths.length - 1 ? pad(cands[i], w + 2) : cands[i];
        });
        append({ s: [{ t: s.replace(/\s+$/, ""), c: "t-in" }], art: true });
      }
      autoscroll();
    }

    /* ================================================================ open / close */
    let phase = "closed"; // closed | opening | open | closing
    let booted = false;
    let returnTo = null;
    let openAnims = [];
    let closeAnims = [];
    let lock = null;

    function lockScroll() {
      if (lock) return;
      const de = document.documentElement;
      const sbw = Math.max(0, window.innerWidth - de.clientWidth);
      lock = { overflow: de.style.overflow, gutter: de.style.scrollbarGutter || "", pad: document.body.style.paddingRight };
      // Keep the scrollbar's space so nothing moves when the page stops scrolling.
      if (sbw > 0) {
        if (window.CSS && CSS.supports && CSS.supports("scrollbar-gutter", "stable")) de.style.scrollbarGutter = "stable";
        else document.body.style.paddingRight = sbw + "px";
      }
      de.style.overflow = "hidden";
    }
    function unlockScroll() {
      if (!lock) return;
      const de = document.documentElement;
      de.style.overflow = lock.overflow;
      de.style.scrollbarGutter = lock.gutter;
      document.body.style.paddingRight = lock.pad;
      lock = null;
    }

    // Phones: keep the sheet above the on-screen keyboard.
    const vv = window.visualViewport;
    function syncViewport() {
      if (!vv || phase === "closed") return;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      win.style.setProperty("--kb", kb + "px");
      win.style.setProperty("--vvh", Math.round(vv.height) + "px");
      dlg.classList.toggle("is-kb", kb > 80);
      if (kb > 80) autoscroll();
    }
    if (vv) {
      vv.addEventListener("resize", syncViewport);
      vv.addEventListener("scroll", syncViewport);
    }

    function focusInput() {
      input.focus({ preventScroll: true });
      renderMirror();
    }
    // Touch screens start without the keyboard: focus the window; tapping the prompt types.
    function focusHome() {
      if (coarse()) win.focus({ preventScroll: true });
      else input.focus({ preventScroll: true });
      renderMirror();
    }

    function stopAnims(list) {
      list.forEach((a) => {
        try {
          a.cancel();
        } catch (e) {}
      });
      list.length = 0;
    }

    function bootRows() {
      const go = (n) => ({ t: n, run: n, c: "t-run--red" });
      // Typed rows never wrap (they are revealed one cell at a time), so phones get shorter ones.
      const a = append({ s: [{ t: "luigi-os 2026.10 (tty1)", c: "t-in" }], typed: true });
      const b = wide()
        ? append({ s: ["interactive résumé. new here? try ", go("summary"), ", ", go("role"), " or ", go("contact")], typed: true })
        : append({ s: ["try ", go("summary"), ", ", go("role"), " or ", go("contact")], typed: true });
      const c = wide()
        ? append({ s: ["type ", go("help"), " for every command. runs locally, in your browser"], typed: true })
        : append({ s: ["or ", go("help"), " for every command"], typed: true });
      append("");
      return [a, b, c].map((d) => ({ span: d.firstElementChild, len: d.textContent.length }));
    }

    function open(d) {
      d = d || {};
      if (phase === "open" || phase === "opening") {
        focusHome();
        return;
      }
      if (phase === "closing") stopAnims(closeAnims);
      const t = d.trigger;
      const active = document.activeElement;
      const usable = (n) => n instanceof HTMLElement && n !== document.body && !dlg.contains(n);
      returnTo = usable(t) ? t : usable(active) ? active : null;
      lockScroll();
      dlg.hidden = false;
      if (!dlg.open) {
        if (canModal) {
          try {
            dlg.showModal();
          } catch (e) {
            dlg.setAttribute("open", "");
          }
        } else dlg.setAttribute("open", "");
      }
      phase = "opening";
      measure();
      syncViewport();
      const first = !booted;
      booted = true;
      const boot = first ? bootRows() : [];
      setInput(input.value);
      focusHome();
      autoscroll();
      if (reduced()) finishOpen();
      else playOpen(first, boot);
    }

    // The opening: the cursor draws the top border, paints the rows, types the banner, lands on
    // the prompt. Every step is one character cell or one text row.
    function playOpen(first, boot) {
      const W = win.offsetWidth;
      const H = win.offsetHeight;
      const cw = M.cw;
      const lh = M.lh;
      const lift = Math.ceil(Math.max(lh, closeBtn ? closeBtn.offsetHeight : 0) / 2) + 4;
      const band = Math.ceil(lh / 2);
      const cols = Math.max(8, Math.round(W / cw));
      const rows = Math.max(3, Math.round((H - band) / lh));
      const tA = first ? 190 : 120;
      const tB = first ? 260 : 170;
      const T = tA + tB;
      const ins = (top, r, b, l) => `inset(${top}px ${r}px ${b}px ${l}px)`;
      const c0 = ins(-lift, W + 2, H - band, -2);
      const c1 = ins(-lift, -2, H - band, -2);
      const c2 = ins(-lift, -2, -2, -2);
      openAnims.push(
        win.animate(
          [
            { clipPath: c0, easing: `steps(${cols}, jump-start)` },
            { clipPath: c1, offset: tA / T, easing: `steps(${rows}, jump-start)` },
            { clipPath: c2 },
          ],
          { duration: T, fill: "both" }
        )
      );
      const so = parseFloat(getComputedStyle(scrim).opacity) || 0.9;
      openAnims.push(scrim.animate([{ opacity: 0 }, { opacity: so }], { duration: 120, easing: "steps(3, jump-start)", fill: "both" }));

      // The pen's path in ms and padding-box px. A cursor never glides: between segments it
      // holds its cell, then jumps (two keyframes at the same offset).
      const path = [];
      let px = 0;
      let py = 0;
      const key = (ms, x, y, easing, opacity) => {
        px = x;
        py = y;
        path.push({ ms, x, y, easing: easing || "linear", opacity: opacity == null ? 1 : opacity });
      };
      const hold = (ms) => key(ms, px, py);
      const inner = win.clientLeft || 0;
      // The pen is the prompt's own block: one cell wide, the glyph box tall (gh), sitting gy
      // below the top of its text row.
      const curEl = mirror.querySelector(".terminal__cur");
      const mr = mirror.getBoundingClientRect();
      const cr = curEl ? curEl.getBoundingClientRect() : null;
      const gh = cr && cr.height > 4 ? cr.height : lh * 0.82;
      const gy = cr && cr.height > 4 ? cr.top - mr.top : (lh - gh) / 2;
      if (pen) {
        pen.style.width = cw + "px";
        pen.style.height = gh + "px";
      }
      key(0, -cw - inner, -gh / 2, `steps(${cols}, jump-start)`);
      key(tA, W - cw - inner, -gh / 2);
      key(tA, W - cw - 2 * inner, band - lh + gy, `steps(${rows}, jump-start)`);
      key(T, W - cw - 2 * inner, H - lh + gy);
      let end = T;
      if (first && boot.length) {
        const wr = win.getBoundingClientRect();
        let t = T + 50;
        boot.forEach((b) => {
          const r = b.span.getBoundingClientRect();
          const x = r.left - wr.left - inner;
          // A row taller than one line (a 40px touch target in it) keeps its text in the middle.
          const y = r.top - wr.top + Math.max(0, (r.height - lh) / 2) + gy;
          const dur = b.len * 6;
          openAnims.push(b.span.animate([{ clipPath: "inset(0 100% 0 0)", easing: `steps(${b.len}, jump-start)` }, { clipPath: "inset(0 0 0 0)" }], { duration: dur, delay: t, fill: "both" }));
          hold(t);
          key(t, x, y, `steps(${b.len}, jump-start)`);
          key(t + dur, x + b.len * cw, y);
          t += dur + 70;
        });
        hold(t);
        key(t, mr.left - wr.left - inner, mr.top - wr.top + gy);
        end = t + 60;
        openAnims.push(form.animate([{ opacity: 0 }, { opacity: 0 }], { duration: end }));
      }
      hold(end);
      key(end, px, py, "linear", 0);
      // The prompt's cursor stays solid through the hand-off and starts blinking after it.
      typing = true;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        typing = false;
        renderMirror();
      }, end + 600);
      renderMirror();
      if (pen) {
        const frames = path.map((k) => ({ transform: `translate(${k.x.toFixed(1)}px, ${k.y.toFixed(1)}px)`, opacity: k.opacity, easing: k.easing, offset: Math.min(1, k.ms / end) }));
        openAnims.push(pen.animate(frames, { duration: end, fill: "both" }));
      }
      const mine = openAnims.slice();
      Promise.all(mine.map((a) => a.finished)).then(() => {
        if (openAnims.length && openAnims[0] === mine[0]) finishOpen();
      }, () => {});
    }

    function finishOpen() {
      if (phase !== "opening") return;
      phase = "open";
      stopAnims(openAnims);
      renderMirror();
      autoscroll();
    }

    function close(after) {
      if (phase === "closed" || phase === "closing") return;
      finishOpen();
      flush();
      phase = "closing";
      const done = () => finalizeClose(after);
      if (reduced()) {
        done();
        return;
      }
      const W = win.offsetWidth;
      const H = win.offsetHeight;
      const lh = M.lh;
      const lift = Math.ceil(Math.max(lh, closeBtn ? closeBtn.offsetHeight : 0) / 2) + 4;
      const band = Math.ceil(lh / 2);
      const cols = Math.max(8, Math.round(W / M.cw));
      const rows = Math.max(3, Math.round((H - band) / lh));
      const ins = (top, r, b, l) => `inset(${top}px ${r}px ${b}px ${l}px)`;
      const T = 210;
      closeAnims.push(
        win.animate(
          [
            { clipPath: ins(-lift, -2, -2, -2), easing: `steps(${rows}, jump-end)` },
            { clipPath: ins(-lift, -2, H - band, -2), offset: 0.62, easing: `steps(${Math.max(4, Math.round(cols / 2))}, jump-end)` },
            { clipPath: ins(-lift, W + 2, H - band, -2) },
          ],
          { duration: T, fill: "forwards" }
        )
      );
      const so = parseFloat(getComputedStyle(scrim).opacity) || 0.9;
      closeAnims.push(scrim.animate([{ opacity: so }, { opacity: 0 }], { duration: T, easing: "steps(3, jump-end)", fill: "forwards" }));
      const mine = closeAnims.slice();
      Promise.all(mine.map((a) => a.finished)).then(() => {
        if (phase === "closing" && closeAnims[0] === mine[0]) done();
      }, () => {});
    }

    let selfClose = 0;
    function finalizeClose(after) {
      stopAnims(closeAnims);
      phase = "closed";
      try {
        if (dlg.open && canModal) {
          selfClose++;
          dlg.close();
        }
      } catch (e) {}
      dlg.removeAttribute("open");
      dlg.hidden = true;
      dlg.classList.remove("is-busy", "is-kb");
      unlockScroll();
      const back = returnTo;
      returnTo = null;
      if (back && document.contains(back) && typeof back.focus === "function") {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {}
      }
      if (after) after();
    }

    // Focus lands on the destination's heading, so the next Tab goes on from there instead of
    // from the button that opened the shell. The heading gets tabindex="-1" only while focused.
    function focusDest(target) {
      const h = target.querySelector("h1, h2, h3") || target;
      if (!h.hasAttribute("tabindex")) {
        h.setAttribute("tabindex", "-1");
        h.addEventListener("blur", () => h.removeAttribute("tabindex"), { once: true });
      }
      try {
        h.focus({ preventScroll: true });
      } catch (e) {}
      return document.activeElement === h;
    }

    function navigate(hash) {
      if (phase === "closed" || phase === "closing") return;
      // A command that goes somewhere takes focus there; plain Esc and close still go back.
      const back = returnTo;
      returnTo = null;
      close(() => {
        const behavior = reduced() ? "auto" : "smooth";
        const top = !hash || hash === "#top";
        const target = document.getElementById(top ? "top" : hash.slice(1));
        if (!(target && focusDest(target)) && back && document.contains(back)) {
          try {
            back.focus({ preventScroll: true });
          } catch (e) {}
        }
        if (target && !top) target.scrollIntoView({ behavior, block: "start" });
        else window.scrollTo({ top: 0, behavior });
      });
    }

    /* ================================================================ events */
    LP.on("terminal:open", (d) => open(d));

    // The backtick is a single-character shortcut (WCAG 2.1.4): it only works while nothing has
    // focus, so a focused link, button or field keeps the key, and it is off whenever the page's
    // single-key shortcuts are off (LP.keys). Ctrl+K / Cmd+K and the [>_] button always work.
    const nothingFocused = () => {
      const a = document.activeElement;
      return !a || a === document.body || a === document.documentElement;
    };
    const keysOff = () => !!(LP.keys && LP.keys.enabled === false);

    // Open: Ctrl+K / Cmd+K anywhere, the backtick key while nothing has focus.
    document.addEventListener("keydown", (e) => {
      if (phase !== "closed" || e.defaultPrevented || e.isComposing || e.repeat) return;
      const k = e.key;
      const altGr = e.getModifierState && e.getModifierState("AltGraph");
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === "k" || k === "K")) {
        e.preventDefault();
        open({ trigger: document.activeElement });
      } else if (k === "`" && !e.metaKey && (altGr || (!e.ctrlKey && !e.altKey)) && nothingFocused() && !keysOff()) {
        e.preventDefault();
        open({ trigger: document.activeElement });
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      finishOpen();
      if (cur || queue.length) flush();
      const k = e.key;
      if (k === "Enter") {
        e.preventDefault();
        submit();
        return;
      }
      if (k === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && input.value.trim()) {
        e.preventDefault();
        complete();
        return;
      }
      if ((k === "ArrowUp" || k === "ArrowDown") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (!hist.length) return;
        if (k === "ArrowUp") {
          if (hIdx === -1) {
            draft = input.value;
            hIdx = hist.length;
          }
          if (hIdx > 0) hIdx--;
          setInput(hist[hIdx]);
        } else {
          if (hIdx === -1) return;
          hIdx++;
          if (hIdx >= hist.length) {
            hIdx = -1;
            setInput(draft);
          } else setInput(hist[hIdx]);
        }
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const c = k.toLowerCase();
        const sel = window.getSelection();
        if (c === "c" && input.selectionStart === input.selectionEnd && (!sel || sel.isCollapsed)) {
          // Interrupt: the line is abandoned with ^C, as in a shell.
          e.preventDefault();
          append({ s: [{ t: "papalia@cv:~$", c: "t-ps" }, " ", { t: input.value, c: "t-in" }, { t: "^C", c: "t-dim" }] });
          setInput("");
          hIdx = -1;
          autoscroll();
        } else if (c === "l") {
          e.preventDefault();
          cmdClear();
          renderMirror();
        } else if (c === "u") {
          e.preventDefault();
          const p = input.selectionStart || 0;
          input.value = input.value.slice(p);
          try {
            input.setSelectionRange(0, 0);
          } catch (err) {}
          renderMirror();
        } else if (c === "d" && !input.value) {
          e.preventDefault();
          append(promptRow(""));
          cmdExit();
          kick();
        }
      }
      if (k.length === 1 || k === "Backspace" || k === "Delete") typingPulse();
      queueMirror();
    });
    input.addEventListener("input", () => {
      hIdx = -1;
      typingPulse();
      // One line, no control characters, capped: pasted text is cleaned in place.
      const v = input.value;
      const c = clean(v);
      if (c !== v) {
        const p = Math.min(c.length, input.selectionStart || 0);
        input.value = c;
        try {
          input.setSelectionRange(p, p);
        } catch (e) {}
      }
      queueMirror();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });

    function focusables() {
      return Array.from(win.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0);
    }

    dlg.addEventListener("keydown", (e) => {
      if (phase === "opening") finishOpen();
      if (e.defaultPrevented) return;
      const k = e.key;
      if (k === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === "k" || k === "K")) {
        e.preventDefault();
        close();
        return;
      }
      if (k === "Tab") {
        // Focus stays inside the window and wraps around.
        const f = focusables();
        if (!f.length) return;
        const a = document.activeElement;
        const i = f.indexOf(a);
        if (e.shiftKey && (i <= 0 || a === win)) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && (i === f.length - 1 || i === -1) && a !== win) {
          e.preventDefault();
          f[0].focus();
        }
        return;
      }
      // Typing anywhere in the window goes to the prompt.
      const t = e.target;
      if (t !== input && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (t instanceof Element && t.closest("button, a") && (k === " " || k === "Enter")) return;
        focusInput();
      }
    });
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    // A close this module did not start (a browser close request): tidy up the same way.
    dlg.addEventListener("close", () => {
      if (selfClose > 0) {
        selfClose--;
        return;
      }
      if (phase !== "closed") finalizeClose();
    });
    dlg.addEventListener("pointerdown", () => {
      if (phase === "opening") finishOpen();
    });

    scrim.addEventListener("click", () => close());
    dlg.querySelectorAll("[data-terminal-close]").forEach((b) => b.addEventListener("click", () => close()));
    dlg.querySelectorAll(".terminal__keys [data-run]").forEach((b) => b.addEventListener("click", () => clickRun(b.dataset.run, false)));

    log.addEventListener("click", (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const run = t.closest("[data-run]");
      if (run) {
        e.preventDefault();
        clickRun(run.dataset.run, run.dataset.fill === "1");
        return;
      }
      const copy = t.closest("[data-copy]");
      if (copy) {
        e.preventDefault();
        const v = copy.dataset.copy;
        const say = (label) => {
          copy.textContent = label;
          clearTimeout(copy._t);
          copy._t = setTimeout(() => (copy.textContent = "copy"), 1600);
        };
        const selectIt = () => {
          const span = copy.previousSibling && copy.previousSibling.previousSibling;
          if (span && span.nodeType === 1) {
            const range = document.createRange();
            range.selectNodeContents(span);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
          say("selected");
        };
        try {
          navigator.clipboard.writeText(v).then(() => say("copied"), selectIt);
        } catch (err) {
          selectIt();
        }
        return;
      }
      const a = t.closest("a.t-link");
      const href = a ? a.getAttribute("href") || "" : "";
      if (a && href.charAt(0) === "#") {
        e.preventDefault();
        navigate(href);
      }
    });

    // A click on the screen puts the cursor back in the prompt (not over a selection or a link).
    screen.addEventListener("click", (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest("a, button, input")) return;
      if (coarse() && !t.closest(".terminal__prompt")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).length) return;
      focusInput();
    });
  });
})();
