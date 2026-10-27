/* core.js: shared runtime for every module. Loaded first, owned by the lead.
   Modules register with LP.module(name, init); boot.js runs them once the DOM is parsed.
   Each module script is its own <script> tag, so a failure in one never blocks the rest. */
(function () {
  "use strict";

  const LP = (window.LP = window.LP || {});
  const root = document.documentElement;

  // The page is in English. The Artifact skeleton ships a bare <html>; a lang set by the host wins.
  if (!root.getAttribute("lang")) root.setAttribute("lang", "en");

  /* ------------------------------------------------------------ profile */
  // Public profile. Email, phone and location are deliberately not published on the site: they are
  // in the PDF sent with an application. Values in [square brackets] render as placeholders.
  LP.profile = Object.assign(
    {
      name: "Luigi Papalia",
      linkedin: "linkedin.com/in/luigi-papalia",
      github: "github.com/garouuuuuu/cv",
    },
    LP.profile || {}
  );
  /** True for an unfilled placeholder value such as "[name@example.com]". */
  LP.isPlaceholder = (v) => !v || /^\s*\[.*\]\s*$/.test(String(v));

  /* ------------------------------------------------------------ media queries */
  function mq(query) {
    try {
      return window.matchMedia(query);
    } catch (e) {
      return { matches: false, addEventListener() {}, addListener() {} };
    }
  }
  function onMq(m, fn) {
    if (m.addEventListener) m.addEventListener("change", fn);
    else if (m.addListener) m.addListener(fn);
  }

  const reduceMq = mq("(prefers-reduced-motion: reduce)");
  const fineMq = mq("(hover: hover) and (pointer: fine)");

  /** True when the viewer asked for reduced motion. Read it live; it can change. */
  LP.reducedMotion = () => reduceMq.matches;
  /** True for a mouse or trackpad (hover + fine pointer). */
  LP.finePointer = () => fineMq.matches;
  LP.onReducedMotionChange = (fn) => onMq(reduceMq, () => fn(reduceMq.matches));

  /* ------------------------------------------------------------ math */
  LP.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  LP.lerp = (a, b, t) => a + (b - a) * t;
  LP.smoothstep = (a, b, v) => {
    const t = LP.clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  LP.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  LP.easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  LP.easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  /** Deterministic PRNG (mulberry32). LP.prng(42)() -> float in [0, 1). */
  LP.prng = (seed = 1) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** Device pixel ratio, capped (default 2) to protect fill rate. */
  LP.dpr = (max = 2) => Math.min(max, window.devicePixelRatio || 1);

  /* ------------------------------------------------------------ event bus */
  const bus = new EventTarget();
  LP.on = (type, fn) => {
    const h = (e) => fn(e.detail);
    bus.addEventListener(type, h);
    return () => bus.removeEventListener(type, h);
  };
  LP.emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

  /* ------------------------------------------------------------ colors */
  /** Raw value of a CSS custom property, e.g. LP.token('--ink'). */
  LP.token = (name, el = root) => getComputedStyle(el).getPropertyValue(name).trim();

  const cctx = document.createElement("canvas").getContext("2d");
  /** Parse any CSS color the browser understands into [r, g, b, a] (0-255, 0-255, 0-255, 0-1). */
  LP.rgba = (css) => {
    if (!cctx || !css) return [0, 0, 0, 1];
    cctx.fillStyle = "#000";
    cctx.fillStyle = css;
    const v = String(cctx.fillStyle);
    if (v[0] === "#") {
      return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
    }
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  /** A theme token as [r, g, b, a]. Re-read it inside LP.onTheme callbacks. */
  LP.color = (name) => LP.rgba(LP.token(name));
  /** A theme token as normalized floats [r, g, b, a] in 0..1 (for WebGL uniforms). */
  LP.colorGL = (name) => {
    const c = LP.color(name);
    return [c[0] / 255, c[1] / 255, c[2] / 255, c[3]];
  };

  /* ------------------------------------------------------------ theme */
  // The page commits to a single dark look. These stay so modules can call them safely.
  LP.theme = () => "dark";
  /** Kept for compatibility: the theme never changes, so fn is never called. */
  LP.onTheme = () => () => {};

  /* ------------------------------------------------------------ observers */
  /** IntersectionObserver helper. enter/leave get the entry. Returns a disconnect function. */
  LP.inView = (el, opts = {}) => {
    const { enter, leave, once = false, threshold = 0, rootMargin = "0px" } = opts;
    if (!el) return () => {};
    if (!("IntersectionObserver" in window)) {
      if (enter) enter(null);
      return () => {};
    }
    // isIntersecting is true as soon as one pixel overlaps, so honour the smallest requested
    // threshold explicitly: enter fires once that much of the element is visible.
    const min = Math.min(...[].concat(threshold));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= min - 0.001) {
            if (enter) enter(e);
            if (once) io.disconnect();
          } else if (!e.isIntersecting && leave) {
            leave(e);
          }
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  };

  /** ResizeObserver helper, coalesced to one call per frame: fn(width, height) in CSS px. */
  LP.onResize = (el, fn) => {
    if (!el) return () => {};
    let raf = 0;
    const run = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      fn(r.width, r.height);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(schedule);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", schedule);
    schedule();
    return () => window.removeEventListener("resize", schedule);
  };

  /* ------------------------------------------------------------ tempo */
  /** Global animation speed: 1 is the original pace, lower is slower. LP.loop clocks, LP.scramble
      and LP.countUp run at this rate; LP.ms(d) stretches any other wall-clock duration to match. */
  LP.tempo = 0.6;
  LP.ms = (ms) => ms / LP.tempo;

  /* ------------------------------------------------------------ animation loop */
  const loops = new Set();
  /** A requestAnimationFrame loop that pauses while the tab is hidden.
      tick(dt, t): dt = seconds since last frame (capped at 0.1), t = seconds since creation, both
      scaled by LP.tempo. opts.realtime skips the scaling (interactive output such as the shell).
      Returns { start(), stop(), running }. Start it when visible (LP.inView) and stop it when not. */
  LP.loop = (tick, opts) => {
    const realtime = !!(opts && opts.realtime);
    let raf = 0;
    let last = 0;
    let running = false;
    let wanted = false;
    const t0 = performance.now();
    const frame = (now) => {
      raf = 0;
      if (!running) return;
      const k = realtime ? 1 : LP.tempo;
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60) * k;
      last = now;
      try {
        tick(dt, ((now - t0) / 1000) * k);
      } catch (e) {
        console.error("[LP] loop tick failed", e);
        running = false;
        wanted = false;
        return;
      }
      if (running) raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const halt = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const api = {
      start() {
        wanted = true;
        if (!document.hidden) run();
        return api;
      },
      stop() {
        wanted = false;
        halt();
        return api;
      },
      get running() {
        return running;
      },
    };
    loops.add({ pause: halt, resume: () => wanted && run() });
    return api;
  };
  document.addEventListener("visibilitychange", () => {
    loops.forEach((l) => (document.hidden ? l.pause() : l.resume()));
  });

  /* ------------------------------------------------------------ scroll progress */
  const scrollSubs = new Set();
  let scrollQueued = false;
  let measured = null;
  // All reads come before any writes: every active subscriber's rect is read first, then the
  // callbacks (which write DOM) run. A scroll event is dispatched once per frame, before the
  // animation callbacks of loops write the DOM, so the rects are read there, on a clean layout.
  const measureScroll = () => {
    const due = [];
    scrollSubs.forEach((s) => {
      if (s.active) due.push(s, s.el.getBoundingClientRect());
    });
    return { vh: window.innerHeight, due };
  };
  const flushScroll = () => {
    scrollQueued = false;
    const m = measured || measureScroll();
    measured = null;
    for (let i = 0; i < m.due.length; i += 2) {
      const s = m.due[i];
      if (s.active && scrollSubs.has(s)) s.apply(m.due[i + 1], m.vh);
    }
  };
  const queueScroll = () => {
    if (!scrollQueued) {
      scrollQueued = true;
      requestAnimationFrame(flushScroll);
    }
  };
  window.addEventListener(
    "scroll",
    () => {
      measured = scrollSubs.size ? measureScroll() : null;
      queueScroll();
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    measured = null;
    queueScroll();
  });

  function trackProgress(el, fn, compute) {
    if (!el) return () => {};
    let last = -1;
    const sub = {
      el,
      active: true,
      apply(rect, vh) {
        const p = LP.clamp(compute(rect, vh), 0, 1);
        if (Math.abs(p - last) < 0.0005) return;
        last = p;
        try {
          fn(p);
        } catch (e) {
          console.error("[LP] progress subscriber failed", e);
        }
      },
      update() {
        sub.apply(el.getBoundingClientRect(), window.innerHeight);
      },
    };
    scrollSubs.add(sub);
    // Only compute while near the viewport.
    const stopIo = LP.inView(el, {
      rootMargin: "25% 0px 25% 0px",
      enter: () => {
        sub.active = true;
        sub.update();
      },
      leave: () => {
        sub.update();
        sub.active = false;
      },
    });
    sub.update();
    return () => {
      scrollSubs.delete(sub);
      stopIo();
    };
  }

  /** Pinned scene progress. el is a tall .scene track whose child is .scene__sticky.
      fn(p) gets 0 when the track's top reaches the nav and 1 when its bottom leaves the screen.
      Returns an unsubscribe function. */
  LP.scene = (el, fn) => {
    const nav = parseFloat(LP.token("--nav-h")) || 52;
    return trackProgress(el, fn, (r, vh) => {
      const travel = Math.max(1, r.height - (vh - nav));
      return (nav - r.top) / travel;
    });
  };

  /** Progress of an element crossing the viewport: 0 when its top meets the bottom edge,
      1 when its bottom meets the top edge. Returns an unsubscribe function. */
  LP.viewProgress = (el, fn) =>
    trackProgress(el, fn, (r, vh) => (vh - r.top) / Math.max(1, vh + r.height));

  /* ------------------------------------------------------------ text effects */
  const GLYPHS = "!<>-_\\/[]{}=+*^?#$%&01ABCDEFX";

  /** Decrypt effect for text-only elements (no child elements). The final text is the resting
      state: it shows before the effect starts and after it ends. No-op with reduced motion. */
  LP.scramble = (el, opts = {}) => {
    if (!el) return Promise.resolve();
    if (el.children.length) {
      console.warn("[LP] scramble skipped: element has children", el);
      return Promise.resolve();
    }
    const final = el.dataset.scrambleText || el.textContent;
    el.dataset.scrambleText = final;
    if (LP.reducedMotion()) {
      el.textContent = final;
      return Promise.resolve();
    }
    if (el._lpScramble) cancelAnimationFrame(el._lpScramble);
    const duration = LP.ms(opts.duration || 700);
    const chars = opts.chars || GLYPHS;
    const delay = LP.ms(opts.delay || 0);
    const reveal = Array.from(final, (ch, i) => (i / Math.max(1, final.length)) * 0.55 + Math.random() * 0.45);
    const hadLabel = el.hasAttribute("aria-label");
    if (!hadLabel) el.setAttribute("aria-label", final);
    const start = performance.now() + delay;
    return new Promise((resolve) => {
      const step = (now) => {
        const p = (now - start) / duration;
        if (p < 0) {
          el._lpScramble = requestAnimationFrame(step);
          return;
        }
        if (p >= 1) {
          el.textContent = final;
          el._lpScramble = 0;
          if (!hadLabel) el.removeAttribute("aria-label");
          resolve();
          return;
        }
        let out = "";
        for (let i = 0; i < final.length; i++) {
          const ch = final[i];
          out += ch === " " || ch === "\n" || p >= reveal[i] ? ch : chars[(Math.random() * chars.length) | 0];
        }
        el.textContent = out;
        el._lpScramble = requestAnimationFrame(step);
      };
      el._lpScramble = requestAnimationFrame(step);
    });
  };

  /** Count a number up or down inside el. The final formatted value is always written last.
      format(v) defaults to an en-US integer with thousands separators. */
  LP.countUp = (el, opts = {}) => {
    if (!el) return Promise.resolve();
    const from = opts.from ?? 0;
    const to = opts.to ?? 0;
    const duration = LP.ms(opts.duration ?? 1200);
    const delay = LP.ms(opts.delay ?? 0);
    const ease = opts.ease || LP.easeOutCubic;
    const format = opts.format || ((v) => Math.round(v).toLocaleString("en-US"));
    if (LP.reducedMotion()) {
      el.textContent = format(to);
      return Promise.resolve();
    }
    if (el._lpCount) cancelAnimationFrame(el._lpCount);
    const start = performance.now() + delay;
    return new Promise((resolve) => {
      const step = (now) => {
        const p = LP.clamp((now - start) / duration, 0, 1);
        el.textContent = format(LP.lerp(from, to, ease(p)));
        if (p < 1) el._lpCount = requestAnimationFrame(step);
        else {
          el.textContent = format(to);
          el._lpCount = 0;
          resolve();
        }
      };
      el._lpCount = requestAnimationFrame(step);
    });
  };

  /* ------------------------------------------------------------ modules */
  const mods = [];
  /** Register a module. init() runs once after the DOM is parsed, isolated by try/catch. */
  LP.module = (name, init) => {
    mods.push({ name, init });
    if (LP.booted) runModule({ name, init });
  };
  function runModule(m) {
    try {
      m.init();
    } catch (e) {
      console.error(`[LP] module "${m.name}" failed to start`, e);
    }
  }
  // Yield to the event loop between module inits so input, rendering and the hero's intro are not
  // held behind one long task. MessageChannel posts a task right away (no 4ms clamp, and no
  // background-tab timer throttling); setTimeout is the fallback.
  const nextTask = (() => {
    if (typeof MessageChannel !== "function") return (fn) => setTimeout(fn, 0);
    const ch = new MessageChannel();
    const queue = [];
    ch.port1.onmessage = () => {
      const fn = queue.shift();
      if (fn) fn();
    };
    return (fn) => {
      queue.push(fn);
      ch.port2.postMessage(0);
    };
  })();
  const BOOT_SLICE = 8; // ms of module inits per task before yielding
  /** True once every module registered before boot has run its init (the 'booted' event). */
  LP.ready = false;
  LP.boot = () => {
    if (LP.booted) return;
    // Set first: a module registered from here on runs right away.
    LP.booted = true;
    root.classList.add("js");
    // Registration order is kept (chrome and hero come first), a few modules per task.
    const queue = mods.slice();
    const done = () => {
      LP.ready = true;
      LP.emit("booted");
    };
    const slice = () => {
      const t0 = performance.now();
      while (queue.length) {
        runModule(queue.shift());
        if (performance.now() - t0 >= BOOT_SLICE) break;
      }
      if (queue.length) nextTask(slice);
      else done();
    };
    slice();
  };
})();
