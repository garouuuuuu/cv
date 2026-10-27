#!/usr/bin/env node
// Assemble src/ into:
//   <out>/index.html    the publishable fragment (the Artifact skeleton adds doctype/head/body)
//   <out>/preview.html  a full document that emulates the Artifact skeleton and its CSP, for local testing
//
//   <site>/            with --site: the standalone website (GitHub Pages, Cloudflare Pages), see buildSite()
//
// Usage: node tools/build.mjs [--out dist] [--only hero,iso] [--site site]
//   --out   output directory, relative to cv/ (use your own, e.g. .build/hero, to avoid clashing with others)
//   --only  comma-separated module names: include core + boot + only these module scripts (all CSS and markup stay)
//   --site  also build the standalone website into this directory
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = join(root, "src");
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const outDir = resolve(root, opt("--out", "dist"));
const only = opt("--only", null);
const siteDir = opt("--site", null) && resolve(root, opt("--site", null));

// The public website. The PDF and the URLs below are the deployed ones.
const SITE = {
  url: "https://cv-for-bending-spoons.pages.dev",
  // The public PDF: no email, phone or city (see tools/pdf.mjs).
  pdf: { from: "print/Luigi-Papalia-CV.pdf", to: "Luigi-Papalia-CV.pdf" },
  // security.txt contact. No email address is published on the site.
  contact: "https://www.linkedin.com/in/luigi-papalia/",
  description: "Luigi Papalia, cybersecurity engineer: compliance, application and cloud security, secure CI/CD.",
};

// Order matters: base first, modules after. Missing files are skipped with a warning.
const MODULES = ["chrome", "hero", "iso", "devsecops", "pci", "terminal"];
const CSS = ["base", ...MODULES];
const JS = ["core", ...MODULES, "boot"];

const warn = (m) => console.warn("  ! " + m);
const read = (p) => readFileSync(p, "utf8");

function includePartials(html, depth = 0) {
  if (depth > 5) throw new Error("include depth exceeded");
  return html.replace(/<!--\s*@include\s+([\w./-]+)\s*-->/g, (_, rel) => {
    const p = join(src, rel);
    if (!existsSync(p)) {
      warn(`missing partial ${rel}`);
      return `<!-- missing ${rel} -->`;
    }
    return includePartials(read(p), depth + 1);
  });
}

const css = CSS.map((name) => {
  const p = join(src, "css", name + ".css");
  if (!existsSync(p)) {
    if (name !== "base") return "";
    throw new Error("missing css/base.css");
  }
  return `/* ---- ${name}.css ---- */\n` + read(p).trim() + "\n";
})
  .filter(Boolean)
  .join("\n");

const allowed = only ? new Set(["core", "boot", ...only.split(",").map((s) => s.trim())]) : null;
const scripts = JS.filter((name) => !allowed || allowed.has(name))
  .map((name) => {
    const p = join(src, "js", name + ".js");
    if (!existsSync(p)) {
      if (name === "core" || name === "boot") throw new Error(`missing js/${name}.js`);
      return "";
    }
    const code = read(p).replace(/<\/script/gi, "<\\/script").trim();
    return `<script data-src="${name}.js">\n${code}\n</script>`;
  })
  .filter(Boolean)
  .join("\n");

let page = includePartials(read(join(src, "page.html")));
if (!page.includes("/*@css*/")) throw new Error("page.html lacks the /*@css*/ marker");
if (!page.includes("<!--@js-->")) throw new Error("page.html lacks the <!--@js--> marker");
page = page.replace("/*@css*/", () => css).replace("<!--@js-->", () => scripts);
// Links to files that only exist on the website (the PDF) are kept for --site and dropped elsewhere.
const SITE_ONLY = /\s*<a\b[^>]*\bdata-site-only\b[^>]*>[\s\S]*?<\/a>/g;
const sitePage = page;
page = page.replace(SITE_ONLY, "");

// Mirrors the Artifact publish skeleton (charset, viewport, small reset) plus an approximation of its CSP.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "worker-src blob:",
].join("; ");
const preview =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
  "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}" +
  'body{margin:0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fafaf8}' +
  "img{max-width:100%}[hidden]{display:none!important}</style></head><body>" +
  page +
  "</body></html>";

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), page);
writeFileSync(join(outDir, "preview.html"), preview);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + " KB";
console.log(`built ${join(outDir, "index.html")} (${kb(page)})${only ? ` [only: ${only}]` : ""}`);
console.log(`built ${join(outDir, "preview.html")}`);
if (siteDir) buildSite(sitePage, siteDir);

/* The standalone website: a full document with JetBrains Mono self-hosted (no request leaves the
   origin, so no visitor IP goes to a font CDN), and a Content Security Policy that allows only the
   inline scripts this build produced, by hash. The same policy is sent as a real header on
   Cloudflare Pages (_headers), where frame-ancestors also applies. */
function buildSite(fragment, dir) {
  const FONTS = ["JetBrainsMono.woff2", "JetBrainsMono-Italic.woff2", "OFL.txt"];
  const fontFace =
    '@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:300 800;font-display:swap;src:url("fonts/JetBrainsMono.woff2") format("woff2")}\n' +
    '@font-face{font-family:"JetBrains Mono";font-style:italic;font-weight:300 800;font-display:swap;src:url("fonts/JetBrainsMono-Italic.woff2") format("woff2")}\n';
  let html = fragment
    .replace(/<link\b[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "")
    .replace("<style>\n", () => "<style>\n" + fontFace);
  if (/fonts\.(googleapis|gstatic)\.com/.test(html)) throw new Error("site: a Google Fonts reference survived");

  const hashes = [];
  html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (_, code) => {
    hashes.push("'sha256-" + createHash("sha256").update(code, "utf8").digest("base64") + "'");
    return _;
  });
  const policy = [
    "default-src 'none'",
    "script-src " + hashes.join(" "),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "worker-src blob:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];

  // The fragment starts with title, links and the style block: those go in <head>.
  const cut = html.indexOf("</style>") + "</style>".length;
  const favicon =
    "data:image/svg+xml," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#0c0707"/><text x="8" y="14" font-size="15" text-anchor="middle" fill="#ff3b2f" font-family="monospace">*</text></svg>');
  const doc =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${policy.join("; ")}">\n` +
    '<meta name="referrer" content="strict-origin-when-cross-origin">\n' +
    `<meta name="description" content="${SITE.description}">\n` +
    `<link rel="canonical" href="${SITE.url}/">\n` +
    `<link rel="icon" href="${favicon}">\n` +
    '<style>html{color-scheme:dark}body{margin:0;background:#0c0707}[hidden]{display:none!important}</style>\n' +
    html.slice(0, cut) +
    "\n</head>\n<body>\n" +
    html.slice(cut).trim() +
    "\n</body>\n</html>\n";

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "fonts"), { recursive: true });
  mkdirSync(join(dir, ".well-known"), { recursive: true });
  writeFileSync(join(dir, "index.html"), doc);
  FONTS.forEach((f) => copyFileSync(join(src, "fonts", f), join(dir, "fonts", f)));
  copyFileSync(join(root, SITE.pdf.from), join(dir, SITE.pdf.to));

  // Cloudflare Pages headers. GitHub Pages ignores this file and relies on the meta policy above.
  const headers = [
    "/*",
    `  Content-Security-Policy: ${[...policy, "frame-ancestors 'none'"].join("; ")}`,
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "  Cross-Origin-Opener-Policy: same-origin",
    "  Cross-Origin-Resource-Policy: same-origin",
    "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
    "",
    "/fonts/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ];
  writeFileSync(join(dir, "_headers"), headers.join("\n"));

  // RFC 9116. Expires one year after the build.
  const expires = new Date(Date.now() + 365 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  writeFileSync(
    join(dir, ".well-known", "security.txt"),
    [`Contact: ${SITE.contact}`, `Expires: ${expires}`, "Preferred-Languages: en, it", `Canonical: ${SITE.url}/.well-known/security.txt`, ""].join("\n")
  );
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  writeFileSync(join(dir, ".nojekyll"), "");
  console.log(`built ${join(dir, "index.html")} (${kb(doc)}), ${hashes.length} script hashes, site files in ${dir}`);
}
