# Luigi Papalia: CV

Source of my CV, in two forms:

- **Website**, an interactive man page: [cv-for-bending-spoons.pages.dev](https://cv-for-bending-spoons.pages.dev) (also on [GitHub Pages](https://garouuuuuu.github.io/cv/)).
- **One-page PDF**: [print/Luigi-Papalia-CV.pdf](print/Luigi-Papalia-CV.pdf).

Vanilla HTML, CSS, Canvas and JavaScript. No frameworks, no dependencies, no tracking, and no personal
contact details: email and phone are only in the PDF I send with an application.

## Layout

```
src/page.html          page template (includes the partials, CSS and JS)
src/partials/*.html    one partial per section
src/css/, src/js/      one stylesheet and one script per section; core.js is the shared runtime
src/fonts/             JetBrains Mono, self-hosted (SIL OFL 1.1, see OFL.txt)
tools/build.mjs        assembles the page; --site builds the deployable website
tools/pdf.mjs          renders the PDF CV with headless Chrome
print/                 the PDF CV: HTML template, fonts (SIL OFL 1.1), public PDF
```

## Build

```
node tools/build.mjs --site site
```

`site/` is what gets deployed. It makes no request to third parties: fonts are self-hosted, and the
Content Security Policy allows only the inline scripts of that build, pinned by SHA-256 hash. On
Cloudflare Pages the same policy is sent as a header, together with the other headers in `site/_headers`.
`site/.well-known/security.txt` says where to report a vulnerability.

```
node tools/pdf.mjs
```

renders `print/cv-security-engineer.html` twice: the public PDF (contact rows removed, served by the
website) and, when `print/private.json` exists, the full PDF with email, phone and city in
`print/private/`. Both of those files are gitignored.

## Deploy

- GitHub Pages: every push to `main` runs `.github/workflows/pages.yml`.
- Cloudflare Pages: `npx wrangler pages deploy site --project-name cv-for-bending-spoons --branch main`,
  with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set in the environment.
