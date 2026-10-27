#!/usr/bin/env node
/* Render the one-page CV (print/cv-security-engineer.html) to PDF with headless Chrome, in two variants:

     public   print/Luigi-Papalia-CV.pdf                              rows marked data-private removed;
                                                                      committed and served by the website
     private  print/private/Luigi-Papalia-CV-Security-Engineer.pdf    {{email}}, {{phone}}, {{city}} filled in
                                                                      from print/private.json; never committed

   print/private.json (gitignored): { "email": "...", "phone": "+39 ...", "city": "..." }
   Without it only the public variant is rendered.

   node tools/pdf.mjs            CHROME=/path/to/chrome overrides the browser */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const print = join(root, "print");
const template = readFileSync(join(print, "cv-security-engineer.html"), "utf8");

const chrome =
  process.env.CHROME ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => existsSync(p));
if (!chrome) throw new Error("Chrome not found: set CHROME");

function render(html, out) {
  // The page loads its fonts relatively, so the temporary copy sits next to the template.
  const tmp = join(print, ".render.html");
  const profile = mkdtempSync(join(tmpdir(), "cv-pdf-"));
  writeFileSync(tmp, html);
  mkdirSync(dirname(out), { recursive: true });
  try {
    execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      "--virtual-time-budget=15000",
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${out}`,
      pathToFileURL(tmp).href,
    ], { stdio: "ignore" });
  } finally {
    rmSync(tmp, { force: true });
    rmSync(profile, { recursive: true, force: true });
  }
  const pages = (readFileSync(out, "latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
  console.log(`${out}: ${pages} page${pages === 1 ? "" : "s"}`);
  if (pages !== 1) process.exitCode = 3;
}

const publicHtml = template.replace(/\s*<div data-private>.*?<\/div>/g, "");
if (publicHtml.includes("{{")) throw new Error("public variant: a placeholder survived");
render(publicHtml, join(print, "Luigi-Papalia-CV.pdf"));

const secrets = join(print, "private.json");
if (existsSync(secrets)) {
  const v = JSON.parse(readFileSync(secrets, "utf8"));
  const fields = { ...v, phone_tel: String(v.phone || "").replace(/[^\d+]/g, "") };
  const fill = (html) =>
    html.replace(/\{\{(\w+)\}\}/g, (m, k) => {
      if (!fields[k]) throw new Error(`print/private.json lacks "${k}"`);
      return fields[k];
    });
  render(fill(template), join(print, "private", "Luigi-Papalia-CV-Security-Engineer.pdf"));
  // The cover letter (print/cover-letter.html, gitignored) exists only in its private form.
  const letter = join(print, "cover-letter.html");
  if (existsSync(letter)) render(fill(readFileSync(letter, "utf8")), join(print, "private", "Luigi-Papalia-Cover-Letter.pdf"));
} else {
  console.log("print/private.json not found: private variant skipped");
}
