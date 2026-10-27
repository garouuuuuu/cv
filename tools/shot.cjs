#!/usr/bin/env node
/* Screenshot + diagnostics harness for a built preview (headless Chromium via the preinstalled Playwright).

   node tools/shot.cjs [options]
     --file <path>        preview document (default dist/preview.html)
     --out <png>          screenshot path (default .shots/shot.png); use your own folder
     --width <px>         viewport width (default 1440)
     --height <px>        viewport height (default 900)
     --theme dark|light   emulated prefers-color-scheme (default dark)
     --data-theme <t>     set data-theme="light|dark" on <html> before scripts run (explicit viewer choice)
     --reduced            emulate prefers-reduced-motion: reduce
     --touch              mobile touch device (coarse pointer, no hover)
     --wait <ms>          wait after load before acting (default 1200)
     --scroll <selector>  scroll element into view (top aligned under the nav), then wait --after
     --scrolly <px>       window.scrollTo(0, px), then wait --after
     --scene <sel>:<p>    scroll so the pinned scene <sel> (a .scene track) is at progress p (0..1), e.g. --scene '#case-iso .scene:0.5'
     --after <ms>         wait after scroll/click/mouse/keys (default 1500)
     --mouse <x,y>        move the mouse to viewport coordinates (repeatable: --mouse 100,100 --mouse 400,300)
     --click <selector>   click an element
     --keys <combo>       press keys, e.g. "Control+k" or "Escape"
     --type <text>        type text into the focused element
     --eval <js>          evaluate an expression in the page after all actions and print the JSON result
     --el <selector>      screenshot only this element
     --full               full-page screenshot
     --no-shot            skip the screenshot (diagnostics only)
   Prints console messages, page errors, failed requests, CSP violations and a horizontal-overflow check.
   Google Fonts are fetched once through the session proxy and cached in tools/.fontcache. */
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

if (!process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ["--no-warnings", __filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status == null ? 1 : r.status);
}

// PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROME override the module path and browser binary on other machines.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright");
const ROOT = path.resolve(__dirname, "..");
const FONT_CACHE = path.join(__dirname, ".fontcache");
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const argv = process.argv.slice(2);
const opts = { mouse: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const flag = ["reduced", "touch", "full", "no-shot"].includes(key);
  const val = flag ? true : argv[++i];
  if (key === "mouse") opts.mouse.push(val);
  else opts[key] = val;
}

const file = path.resolve(ROOT, opts.file || "dist/preview.html");
const out = path.resolve(ROOT, opts.out || ".shots/shot.png");
const width = parseInt(opts.width || "1440", 10);
const height = parseInt(opts.height || "900", 10);
const wait = parseInt(opts.wait || "1200", 10);
const after = parseInt(opts.after || "1500", 10);

async function cachedFetch(url) {
  fs.mkdirSync(FONT_CACHE, { recursive: true });
  const key = crypto.createHash("sha1").update(url).digest("hex");
  const bin = path.join(FONT_CACHE, key + ".bin");
  const meta = path.join(FONT_CACHE, key + ".json");
  if (fs.existsSync(bin) && fs.existsSync(meta)) {
    return { body: fs.readFileSync(bin), type: JSON.parse(fs.readFileSync(meta, "utf8")).type, status: 200 };
  }
  const res = await fetch(url, { headers: { "user-agent": UA } });
  const body = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "application/octet-stream";
  if (res.ok) {
    fs.writeFileSync(bin, body);
    fs.writeFileSync(meta, JSON.stringify({ url, type }));
  }
  return { body, type, status: res.status };
}

(async () => {
  if (!fs.existsSync(file)) {
    console.error(`no such file: ${file} (run node tools/build.mjs first)`);
    process.exit(2);
  }
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: opts.touch ? 2 : 1,
    isMobile: !!opts.touch,
    hasTouch: !!opts.touch,
    colorScheme: opts.theme === "light" ? "light" : "dark",
    reducedMotion: opts.reduced ? "reduce" : "no-preference",
  });
  const page = await context.newPage();

  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    try {
      const r = await cachedFetch(route.request().url());
      await route.fulfill({
        status: r.status,
        body: r.body,
        headers: { "content-type": r.type, "access-control-allow-origin": "*" },
      });
    } catch (e) {
      console.log(`[font] fetch failed ${route.request().url()}: ${e.message}`);
      await route.abort();
    }
  });

  const logs = [];
  page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url().slice(0, 120)} ${r.failure() ? r.failure().errorText : ""}`));

  if (opts["data-theme"]) {
    await page.addInitScript((t) => {
      const set = () => document.documentElement && document.documentElement.setAttribute("data-theme", t);
      if (document.documentElement) return set();
      const mo = new MutationObserver(() => {
        if (document.documentElement) {
          set();
          mo.disconnect();
        }
      });
      mo.observe(document, { childList: true });
    }, opts["data-theme"]);
  }
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`)
    );
  });

  await page.goto(require("url").pathToFileURL(file).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(wait);

  let acted = false;
  if (opts.scroll) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error("no element for --scroll " + sel);
      const y = el.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: y, behavior: "instant" });
    }, opts.scroll);
    acted = true;
  }
  if (opts.scene) {
    const i = opts.scene.lastIndexOf(":");
    const sel = opts.scene.slice(0, i);
    const p = parseFloat(opts.scene.slice(i + 1));
    await page.evaluate(
      ([sel, p]) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error("no element for --scene " + sel);
        const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 52;
        const r = el.getBoundingClientRect();
        const top = r.top + window.scrollY;
        const travel = Math.max(1, r.height - (window.innerHeight - nav));
        window.scrollTo({ top: top - nav + p * travel, behavior: "instant" });
      },
      [sel, p]
    );
    acted = true;
  }
  if (opts.scrolly) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), parseInt(opts.scrolly, 10));
    acted = true;
  }
  for (const m of opts.mouse) {
    const [x, y] = m.split(",").map(Number);
    await page.mouse.move(x, y, { steps: 8 });
    acted = true;
  }
  if (opts.click) {
    await page.click(opts.click);
    acted = true;
  }
  if (opts.keys) {
    await page.keyboard.press(opts.keys);
    acted = true;
  }
  if (opts.type) {
    await page.keyboard.type(opts.type, { delay: 20 });
    acted = true;
  }
  if (acted) await page.waitForTimeout(after);

  const diag = await page.evaluate(() => {
    const de = document.documentElement;
    const wide = [];
    if (de.scrollWidth > de.clientWidth + 1) {
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > de.clientWidth + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed") {
          wide.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} right=${Math.round(r.right)}`);
        }
      });
    }
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      scrollHeight: de.scrollHeight,
      overflow: de.scrollWidth > de.clientWidth + 1,
      wide: wide.slice(0, 12),
      theme: window.LP && window.LP.theme ? window.LP.theme() : null,
    };
  });

  if (opts.eval) {
    try {
      const res = await page.evaluate((src) => {
        // eslint-disable-next-line no-eval
        const v = (0, eval)(src);
        return v instanceof Promise ? v.then((x) => JSON.stringify(x)) : JSON.stringify(v);
      }, opts.eval);
      console.log("[eval] " + res);
    } catch (e) {
      console.log("[eval error] " + e.message);
    }
  }

  if (!opts["no-shot"]) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (opts.el) {
      const el = await page.$(opts.el);
      if (!el) console.log(`[shot] no element ${opts.el}`);
      else await el.screenshot({ path: out });
    } else {
      await page.screenshot({ path: out, fullPage: !!opts.full });
    }
    console.log(`[shot] ${out}`);
  }

  logs.forEach((l) => console.log(l));
  console.log(
    `[layout] ${width}x${height} theme=${diag.theme} scrollWidth=${diag.scrollWidth} clientWidth=${diag.clientWidth} height=${diag.scrollHeight}` +
      (diag.overflow ? ` HORIZONTAL OVERFLOW: ${diag.wide.join(" | ")}` : " no horizontal overflow")
  );
  await browser.close();
})().catch((e) => {
  console.error("[harness error] " + e.message);
  process.exit(1);
});
