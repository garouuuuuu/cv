/* chrome.js: page chrome owned by the lead. Profile placeholders, top bar state, the man-page
   pager line, less-style keys, terminal button, section heading decrypts, results bars and
   contact rows. */
(function () {
  "use strict";
  const LP = window.LP;
  if (!LP) return;

  LP.module("chrome", () => {
    const profile = LP.profile || {};
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
    const terminal = () => document.querySelector("[data-terminal]");
    const terminalOpen = () => {
      const t = terminal();
      return !!t && !t.hidden;
    };

    /* -------------------------------------------------- profile text */
    if (profile.name) {
      document.querySelectorAll('[data-profile="name"]').forEach((el) => {
        if (!el.children.length) el.textContent = profile.name;
      });
    }

    /* -------------------------------------------------- keyboard hints */
    if (isMac) {
      document.querySelectorAll("[data-terminal-hint]").forEach((k) => (k.textContent = "⌘k"));
      document.querySelectorAll("[data-mod-key]").forEach((k) => (k.textContent = "⌘"));
    }

    /* -------------------------------------------------- terminal button */
    document.querySelectorAll('[data-action="terminal"]').forEach((btn) => {
      let pending = false;
      const fire = () => {
        const r = btn.getBoundingClientRect();
        LP.emit("terminal:open", { origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, trigger: btn });
      };
      btn.addEventListener("click", () => {
        if (LP.ready !== false) return fire();
        // Modules start a few per task: a tap that lands before the shell has started opens it
        // once boot completes.
        if (pending) return;
        pending = true;
        const off = LP.on("booted", () => {
          off();
          pending = false;
          fire();
        });
      });
    });

    /* -------------------------------------------------- active section in the top bar */
    const links = Array.from(document.querySelectorAll('.topbar__nav a[href^="#"]'));
    const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const setCurrent = (a) =>
      links.forEach((l) => (l === a ? l.setAttribute("aria-current", "true") : l.removeAttribute("aria-current")));
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            setCurrent(byId.get(e.target.id) || null);
          });
        },
        { rootMargin: "-40% 0px -55% 0px" }
      );
      new Set(["top", ...byId.keys()]).forEach((id) => {
        const s = document.getElementById(id);
        if (s) io.observe(s);
      });
    }

    /* -------------------------------------------------- pager line, like less(1) */
    const pagerText = document.querySelector("[data-pager-text]");
    if (pagerText) {
      // Document and viewport heights are cached on resize; a scroll only reads scrollY.
      let lineH = 24;
      let docH = 0;
      let viewH = 0;
      let y = 0;
      let shown = "";
      let queued = false;
      const update = () => {
        queued = false;
        // A scroll can land before the first measure (a deep link scrolls on load).
        if (!docH) return measure();
        const max = Math.max(1, docH - viewH);
        const line = Math.floor(y / lineH) + 1;
        const total = Math.max(line, Math.round(docH / lineH));
        const pct = Math.round(LP.clamp(y / max, 0, 1) * 100);
        const text =
          y >= max - 2
            ? `Manual page papalia(1) line ${line}/${total} (END)`
            : `Manual page papalia(1) line ${line}/${total} ${pct}%`;
        if (text !== shown) pagerText.textContent = shown = text;
      };
      const measure = () => {
        lineH = parseFloat(getComputedStyle(document.body).lineHeight) || 24;
        docH = document.documentElement.scrollHeight || 1;
        viewH = window.innerHeight;
        y = window.scrollY;
        update();
      };
      // Scroll events are dispatched once per frame, before the animation callbacks that write
      // the DOM: read the position here, while layout is clean, and paint the line in the frame.
      window.addEventListener(
        "scroll",
        () => {
          y = window.scrollY;
          if (!queued) {
            queued = true;
            requestAnimationFrame(update);
          }
        },
        { passive: true }
      );
      LP.onResize(document.body, measure);
      let resizeQueued = false;
      window.addEventListener("resize", () => {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(() => {
          resizeQueued = false;
          measure();
        });
      });
    }

    /* -------------------------------------------------- less-style keys: j/k, g/G */
    // Single-letter shortcuts can be turned off (WCAG 2.1.4): LP.keys.set(false) stores the choice
    // (best effort, localStorage may throw) and the pager line shows the state.
    const KEYS_STORE = "lp.keys";
    let keysOn = true;
    try {
      keysOn = localStorage.getItem(KEYS_STORE) !== "off";
    } catch (e) {}
    const keysHint = document.querySelector("[data-pager-keys]");
    const paintKeys = () => {
      if (keysHint) keysHint.textContent = keysOn ? "j/k scroll  g/G top/end" : "j/k g/G off";
    };
    LP.keys = {
      get enabled() {
        return keysOn;
      },
      set(on) {
        keysOn = !!on;
        try {
          if (keysOn) localStorage.removeItem(KEYS_STORE);
          else localStorage.setItem(KEYS_STORE, "off");
        } catch (e) {}
        paintKeys();
        LP.emit("keys", { enabled: keysOn });
        return keysOn;
      },
    };
    paintKeys();
    document.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k !== "j" && k !== "k" && k !== "g" && k !== "G") return;
      if (!keysOn || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || terminalOpen()) return;
      // Only while nothing has focus: a focused link, button or field keeps its keys, and a jump
      // never leaves the focused control off screen.
      const a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement) return;
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
      const lineH = parseFloat(getComputedStyle(document.body).lineHeight) || 24;
      // A held key repeats about 30 times a second, and restarting a smooth scroll on every repeat
      // crawls: repeats jump, like less(1). "auto" would follow the page's CSS smooth scrolling,
      // so jumps ask for "instant" (an engine that rejects it falls back to "auto").
      const behavior = e.repeat ? "instant" : LP.reducedMotion() ? "auto" : "smooth";
      const go = (fn, top) => {
        try {
          fn.call(window, { top, behavior });
        } catch (err) {
          fn.call(window, { top, behavior: "auto" });
        }
      };
      if (k === "j") go(window.scrollBy, lineH * 4);
      else if (k === "k") go(window.scrollBy, -lineH * 4);
      else if (k === "g") go(window.scrollTo, 0);
      else go(window.scrollTo, document.documentElement.scrollHeight);
      e.preventDefault();
    });

    /* -------------------------------------------------- section heading decrypts */
    document.querySelectorAll("[data-decrypt]").forEach((el) => {
      LP.inView(el, { once: true, threshold: 1, enter: () => LP.scramble(el, { duration: 600 }) });
    });

    /* -------------------------------------------------- results bars */
    const results = document.querySelector("[data-results]");
    if (results) {
      const bars = Array.from(results.querySelectorAll("[data-bar]"));
      let cells = 24;
      let played = false;
      const draw = (bar, t) => {
        const kind = bar.dataset.bar;
        const from = Number(bar.dataset.from) || 0;
        const to = Number(bar.dataset.to) || 0;
        const v = LP.lerp(from, to, t) / 100;
        const n = Math.round(LP.clamp(v, 0, 1) * cells);
        const on = kind === "burn" ? "x" : "█";
        const off = kind === "burn" ? "·" : "·";
        bar.innerHTML =
          '<span class="res__edge">[</span><span class="res__on">' +
          on.repeat(n) +
          '</span><span class="res__off">' +
          off.repeat(cells - n) +
          '</span><span class="res__edge">]</span>';
      };
      const drawAll = (t) => bars.forEach((b) => draw(b, t));
      LP.onResize(results, (w) => {
        const next = w < 560 ? 14 : 24;
        if (next !== cells || !bars[0].innerHTML) {
          cells = next;
          drawAll(played ? 1 : 0);
        }
      });
      drawAll(1);
      if (!LP.reducedMotion()) {
        drawAll(0);
        LP.inView(results, {
          once: true,
          threshold: 0.5,
          enter: () => {
            const start = performance.now() + LP.ms(200);
            const step = (now) => {
              const p = LP.clamp((now - start) / LP.ms(1600), 0, 1);
              drawAll(LP.easeInOutCubic(p));
              if (p < 1) requestAnimationFrame(step);
              else played = true;
            };
            requestAnimationFrame(step);
          },
        });
      } else {
        played = true;
      }
    }

    /* -------------------------------------------------- contact rows */
    document.querySelectorAll("[data-profile-row]").forEach((row) => {
      const kind = row.dataset.profileRow;
      const value = String(profile[kind] || "").trim();
      const slot = row.querySelector("[data-profile-value]");
      if (!slot) return;
      if (LP.isPlaceholder(value)) {
        slot.textContent = value || "[not set]";
        slot.classList.add("placeholder");
        return;
      }
      slot.classList.remove("placeholder");
      if (kind === "linkedin" || kind === "github") {
        const href = /^https?:\/\//i.test(value) ? value : "https://" + value;
        const a = document.createElement("a");
        a.className = slot.className;
        a.setAttribute("data-profile-value", "");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = href.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
        slot.replaceWith(a);
        return;
      }
      slot.textContent = value;
      const btn = row.querySelector("[data-copy]");
      if (!btn) return;
      btn.hidden = false;
      btn.addEventListener("click", () => {
        const done = (label) => {
          btn.textContent = label;
          clearTimeout(btn._t);
          btn._t = setTimeout(() => (btn.textContent = "copy"), 1800);
        };
        const select = () => {
          const range = document.createRange();
          range.selectNodeContents(slot);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          done("selected");
        };
        try {
          navigator.clipboard.writeText(value).then(() => done("copied"), select);
        } catch (e) {
          select();
        }
      });
    });
  });
})();
