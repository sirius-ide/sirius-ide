# siriuside.com

The Sirius IDE website: Astro + Starlight, static output, served from Cloudflare Pages.
Performance budgets live in `lighthouserc.cjs` and `scripts/postbuild.mjs`; the design
tokens in `src/styles/tokens.css`.

```bash
cd website
npm ci                # Node 22 — the website never touches the editor's npm ci
npm run dev           # http://localhost:4321
npm run build         # prebuild fetches release data → astro build → postbuild writes _headers
npm run preview
npm run check         # astro check
npm test              # Playwright smoke (every page × 2 widths × 2 schemes), link check, axe, and the interaction checks
                      # (phone menu, comparison table, docs search, download page)
npm run lighthouse    # Lighthouse CI against the brief's budgets in lighthouserc.cjs (CHROME_PATH if Chrome is not on PATH)
npm run screenshots   # review PNGs at 1440×900 and 390×844, dark and light → design/
                      # PAGES="/,/download/" node scripts/screenshots.mjs <outDir> for other pages
```

## What is generated, and from where

- **Release data** — `scripts/fetch-release-data.mjs` reads the GitHub Releases API (and the
  `.sha256` sidecars) into `src/data/releases.json` on every build; the committed snapshot is
  the fallback when GitHub is unreachable. `GITHUB_TOKEN` raises the rate limit.
- **Repository documents** — INSTALL.md, PRIVACY.md, ROADMAP.md, SECURITY.md and LICENSE.txt are
  read from the repository root at build time (`src/content.config.ts`), never copied.
- **Settings, commands, keybindings** on `/docs/reference/` come from
  `extensions/sirius-ai/package.json` (`src/components/docs/ext.ts`).
- **Social images** — `/og/<page>.png` are rendered at build by `src/pages/og/[slug].png.ts`.
- **Security headers** — `scripts/postbuild.mjs` hashes every inline script and writes
  `dist/_headers` (CSP, HSTS, caching) after each build.
- **Fonts** — `scripts/make-fonts.py` subsets the upstream Geist variable fonts into
  `src/fonts/` (browser) and `src/og/` (static instances for the social images). Both are
  under the SIL Open Font License; the licences sit beside the files.
- **Icons** in `public/` come from `build/sirius/make-icons.py … --web website/public`;
  never hand-edit them.

`scripts/dev/` holds review helpers (overflow probe, band cropper) that are not part of the
build or the tests.
