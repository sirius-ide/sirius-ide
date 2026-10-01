# siriuside.com — the brief

The site has one job: make a developer who lands on it want Sirius more than Cursor,
Windsurf, Zed, Antigravity, Kiro or Trae — and then get it installed in under a minute.
It must be the best-looking and the fastest site in this category, and it must say only
things that are true. This file is the specification; PROJECT-STATE.md §13 carries the
state of the work. The owner approves the design direction before the full build (§7).

## 1. The bar, measurably

**Visual.** A design direction the owner approves from screenshots before the full build.
Every page reviewed from screenshots at 1440×900 and 390×844, in dark and light, before it
is called done. Two Opus critique passes on the finished site (§7). Motion with intent —
one visual idea carried through (§3), not effects sprinkled on.

**Speed, enforced.** On every page, Lighthouse (mobile, simulated throttling):
performance ≥ 95, accessibility 100, best practices 100, SEO 100. LCP ≤ 1.5 s, CLS = 0.
Landing page JavaScript ≤ 60 KB gzipped; above-the-fold transfer ≤ 400 KB excluding hero
media; hero media ≤ 1 MB with a poster frame. Fonts self-hosted, subset, at most two
families. No third-party scripts, no cookies, nothing loaded from another origin. The
budgets live in a Lighthouse CI budget file and fail the build when exceeded.

**Completeness.** Every page in §4 "must-have" exists and is finished. Nice-to-haves are
scaffolded if not built.

## 2. What Sirius is — the facts the site may claim

Everything below comes from README.md, INSTALL.md, PRIVACY.md, LICENSE.txt and
PROJECT-STATE.md at 1.118.7. Nothing beyond this list goes on the site without a source
in the repo. Copy may be sharper than these sentences; it may not say more than they do.

- **The agentic, AI-native code editor.** A fork of Code - OSS, the open-source foundation
  Cursor and Antigravity also build on. Everything VS Code does, Sirius does; the editor's
  own chat, inline chat, agent mode, multi-file editing with diffs, checkpoints and
  accept/reject all run against the models you choose.
- **Bring your own model — twelve providers.** Anthropic Claude, Google Gemini, OpenAI,
  OpenRouter, Groq, DeepSeek, Mistral, xAI, and local models through Ollama, LM Studio,
  llama.cpp/vLLM, or any custom endpoint. Keys live in the OS keyring, never in settings.
- **Agent mode with tools.** Read, edit, search, run — the agent plans and works across
  files; edits arrive as diffs with checkpoints you accept or reject.
- **Inline AI** (Ctrl+I): explain, fix, test, refactor a selection in place.
- **Tab completion and next-edit prediction** run on a *local* FIM model you choose
  (Ollama or llama.cpp). Next-edit prediction is off by default. Do not imply cloud Tab.
- **Project rules and ambient context**: per-project rules steer the agent; the active
  editor's context is supplied automatically.
- **Image input** to models that accept it. (Probe-proven at the wire level; claim it
  plainly but do not showcase it as a hero feature until it is exercised live.)
- **Integrated browser tools**: a Playwright-backed browser with 38 agent tools, on by
  default — the agent can open pages, click, type, read.
- **Git assist**: commit messages and merge-conflict resolution from the SCM view.
- **Import** settings, extensions and recent projects from VS Code, Cursor, Windsurf
  (now Devin Desktop; the importer reads the Windsurf profile), VSCodium.
- **Local models without a tool API still get tools** (prompted tools), and tool sets
  scale to the model's size.
- **Privacy, absolute.** Sirius collects nothing: no telemetry, no crash reporting, no
  analytics, no account. There is no relay — requests go straight from your machine to the
  provider you chose. With local models nothing leaves the machine at all. PRIVACY.md is
  the source; the site must stay consistent with it (which is why it carries no
  third-party scripts).
- **Open VSX** extension gallery out of the box.
- **Platforms, as of 1.118.7.** Linux x64 and arm64: tarball, `.deb`, `.rpm`, and the
  `[sirius]` pacman repository (x86_64). Windows x64 installer — *unsigned*, so SmartScreen
  warns on first run; say so and show how to proceed. macOS: not yet (packaging exists,
  needs a certificate) — offer a "notify me" link to a GitHub issue, nothing more. A remote
  server (`sirius-server-linux-{x64,arm64}.tar.gz`) ships with every release; do not claim
  a specific remote extension works with it until PROJECT-STATE hole 12 closes.
- **Every release asset is attested** (Sigstore provenance via GitHub, verify with
  `gh attestation verify <file> --owner sirius-ide`) and carries a sha256 sidecar; downloads
  are served from `dl.siriuside.com`. The editor updates itself on tarball and Windows
  installs; `.deb`/`.rpm`/Arch update through the package manager (INSTALL.md has the
  details per platform — render them, do not paraphrase them wrong).
- **Licence and price.** Proprietary licence; free to install and use on any number of
  devices you own, for personal or commercial development; no redistribution or hosting.
  There is no price and no paid tier: say "free to download and use — you bring your own
  model keys". Do not say "free forever", "open source", or invent plans. No pricing page
  unless the owner decides pricing later.
- **Identity.** Sirius IDE, by Clicksora, L.L.C. (Delaware, USA). Public repo
  `github.com/sirius-ide/sirius-ide`. Signature theme: Sirius Star Dark.

**Not true yet — never on the site as shipped:** macOS builds, a signed Windows installer,
AUR packages, codebase indexing / semantic retrieval, repo memory, an agent manager or
mission-control view, multi-agent orchestration, artifacts. They may appear on `/roadmap/`
clearly marked *planned*, straight from ROADMAP.md.

**Never fabricate:** user counts, download counts, GitHub stars (there are none to show),
testimonials, customer logos, press quotes, awards. An empty social-proof section is
better than an invented one; leave the slot and note it in §13.

**Trademarks.** Provider and competitor names are their owners'. Use plain text names, or
official brand assets only where the owner's guidelines allow it; never imply endorsement.

## 3. Brand and visual identity

**The mark** (`resources/sirius/icon.png`, 2048 px; `icon-small.png` under 48 px): a
five-point star split down the middle — white-silver on the left, cyan-to-azure on the
right — cut by a diagonal lightning bolt, with a lens flare at the top right, on a
near-black deep-space rounded square rimmed in indigo and cyan. The idea in three words:
*deep space, brilliant star, a bolt of speed*. The site is that idea at full size. Sample
exact gradient stops from the PNG; `build/sirius/make-icons.py --web` produces the
favicons and manifest icons.

**Palette** (the Sirius Star Dark theme is the source of truth; the site is the product's
colours, not a separate brand):

| Token | Value | Theme role |
| --- | --- | --- |
| bg | `#06080d` | editor / activity bar / status bar background |
| surface | `#0a0e14` | side bar |
| fg | `#e6edf3` | foreground |
| violet | `#8b5cf6` | buttons, badges, progress, focus (at 50%) |
| ice | `#a8c7fa` | links, cursor, blue |
| cyan | `#67e8f9` | cyan |
| magenta | `#c084fc` | magenta |
| green / amber / red | `#3fb950` / `#fbbf24` / `#f85149` | status colours |

Dark is the default and the hero experience. The light scheme follows the OS preference
and is designed, not inverted: pick its tokens deliberately and screenshot both.

**Typography.** One distinctive text/display family and one monospace family for code and
UI chrome — both under a licence that permits self-hosting (OFL or equivalent), subset to
Latin, served as woff2 with `font-display: swap` and size-adjusted fallbacks so text never
shifts. Choose and justify in the design direction (§7). No system-font-stack-only sites;
that reads as unfinished next to the competitors.

**Motion language.** Transform- and opacity-only animation, composited on the GPU, 60 fps
on a mid-range phone; `prefers-reduced-motion` turns every animation into its end state.
Use: a hero that renders the starfield/aurora idea with CSS gradients plus at most one
small canvas (≤ 5 KB of JS, paused when off-screen and under reduced motion); scroll-driven
reveals through IntersectionObserver (or CSS scroll-driven animations with a fallback);
Astro view transitions between pages; micro-interactions on buttons, cards and the
download control; animated SVG diagrams for "how it works". Avoid: 3D libraries (Three.js
and friends) unless lazy-loaded below the fold and under 150 KB — default no; Lottie blobs
over 50 KB; scroll-jacking; parallax that causes layout work; autoplaying video without a
poster, mute, loop and playsinline.

**The product in the hero.** The best sites (Cursor, Devin, VS Code, Linear — §9) draw
the editor in HTML and CSS rather than embedding a screenshot: crisp on every display,
themed for dark and light, animatable, a few kilobytes. Do the same: an HTML-rendered
Sirius window in the real theme colours — side bar, tabs, status bar — with an agent
sequence that plays once on load (a request, files opening, a diff appearing, accept),
honest to how Sirius actually looks and behaves (`extensions/sirius-ai` and the theme are
the references), and still under reduced motion. Real product footage comes from the
owner's local session afterwards — recordings of the built Sirius with a local model (the
agent editing across files with the diff view, Tab completion, inline chat, the provider
picker, the browser tools, the import flow) — for the feature demos further down. Build
documented slots for them: `website/src/media/README.md` lists each file name,
dimensions, poster frame and where it is used; until a file exists, the section uses a
stylised SVG stand-in. Never a fake screenshot that pretends to be the product.

**Copy.** Confident, specific, short sentences. No "revolutionary", "supercharge",
"10×". Every feature claim traceable to §2. The brand line from README.md is the anchor:
*The agentic, AI-native code editor.*

## 4. Page inventory

**Must-have**

- `/` — hero (headline, sub-headline, primary CTA "Download for <detected OS>" with a
  manual override, secondary CTA to the docs); the product visual; the three reasons (bring
  your own model · agentic by default · collects nothing); feature sections with demos —
  agent mode, Tab and next-edit, providers and local models, project rules and context,
  integrated browser, git assist, import from other editors, the remote server; the
  privacy block; the platforms block; the comparison table (§5); FAQ; final CTA; footer
  (download, docs, changelog, roadmap, privacy, licence, security, GitHub, issues).
- `/download/` — OS and architecture detection with a manual override, resolved *before
  first paint* (a few inline bytes in `<head>` set a data attribute the CSS reads; the
  served HTML names no OS — seven of eight competitors serve "macOS" and swap it later,
  §9) and the same control in the hero on `/`; every asset of
  the latest release read at build time from the GitHub Releases API (names, sizes, sha256
  from the sidecars); the Arch repository snippet; `.deb`/`.rpm` commands; tarball; the
  Windows installer with the SmartScreen note; macOS "not yet"; the server tarballs; "how
  to verify" (sha256 and `gh attestation verify`); how updates reach each platform.
- `/docs/` (Starlight) — getting started (install → set a key or run Ollama → first
  chat); providers and keys; local models (Ollama, LM Studio, llama.cpp; FIM models for
  Tab); chat, edit and agent modes (tools, diffs, checkpoints); inline chat; Tab completion
  and next-edit prediction; project rules and context; image input; the integrated
  browser; git assist; importing from VS Code, Cursor, Windsurf, VSCodium; the remote
  server (install and run); updates; privacy and where keys live; troubleshooting; FAQ;
  keyboard shortcuts. Commands and settings come from `extensions/sirius-ai/package.json`
  — accurate to 1.118.7, and anything not verified against the extension is marked so.
- `/docs/install/` — INSTALL.md, rendered from the repo file at build time.
- `/changelog/` — generated at build from GitHub releases (the deploy workflow rebuilds on
  every published release), with an RSS feed.
- `/roadmap/` — ROADMAP.md rendered with shipped / planned states made visually distinct.
- `/privacy/`, `/license/`, `/security/` — PRIVACY.md, LICENSE.txt and the new Sirius
  SECURITY.md (GitHub private vulnerability reporting is enabled on the repo), rendered
  from the repo files at build time so they cannot drift.
- `/404` — on brand, with the primary navigation.
- Site-wide: an OpenGraph image per page generated at build; sitemap; robots; canonical
  URLs; JSON-LD `SoftwareApplication` on `/` and `/download/`; `site.webmanifest` and the
  favicons from `make-icons.py --web`; `_headers` with HSTS, a strict CSP, nosniff,
  referrer policy and immutable caching for hashed assets; `_redirects`.
- Accessibility: WCAG 2.2 AA — keyboard reachable, visible focus, skip link, contrast
  ≥ 4.5:1 in both schemes, heading order, alt text, reduced motion. axe reports nothing.

**Nice-to-have** (build if time allows; otherwise scaffold and note in §13)

- A blog as a content collection with RSS. A press / brand page (logo downloads and the
  usage rules from LICENSE.txt §2c). A keyboard-shortcuts page. Copy buttons on every
  command. A theme toggle in addition to the OS preference. An i18n-ready structure.
- Analytics: only Cloudflare Web Analytics (cookieless, no script from a third party)
  and only if the owner opts in later — **off by default**, to honour PRIVACY.md.
- Not now: newsletter (needs a backend), download or star counters (nothing meaningful
  to show), an interactive in-browser demo.

## 5. The comparison table

Honest and dated. Rows: bring your own model (providers), local models, telemetry /
relay, price, source availability (Sirius is proprietary; say so), platforms, agent mode,
Tab completion, remote development. Every competitor cell has a source URL recorded in
`website/src/content/comparison.sources.md`; a cell with no source is "—", never a guess.
Name Windsurf as "Devin Desktop (formerly Windsurf)" — windsurf.com now redirects there.
The competitor survey in §9 is the starting point; re-verify anything older than the
survey date before publishing. The table makes Sirius look good by being accurate, not
by shading the others.

## 6. Engineering

- **Astro** (current stable) with **Starlight** for `/docs/`; static output. `website/` is
  self-contained: its own `package.json` and `package-lock.json`, Node 22, `npm ci && npm
  run build` → `website/dist/` (gitignored). It never touches the editor's `npm ci` or
  the Node gate. `astro check` passes.
- **Content from the repo, not copies.** INSTALL.md, PRIVACY.md, LICENSE.txt, ROADMAP.md
  and SECURITY.md are read from the repository root at build time (a content loader with
  a base outside `website/`); release data from the GitHub Releases API at build, with a
  committed JSON snapshot as the fallback so a GitHub hiccup never breaks a deploy.
- **Islands only where needed**: OS detection, theme toggle, copy buttons. Everything
  else is HTML and CSS.
- **Images** through Astro's image pipeline (AVIF/WebP, explicit dimensions so CLS is 0,
  lazy below the fold). Hero media: poster plus a lazy, muted, looped video that respects
  reduced motion and data-saver.
- **Tests in the build**: a Playwright smoke test (every page renders, no console errors),
  a link checker, Lighthouse CI against the budget file, axe. Screenshots for review are
  produced by the same Playwright setup.
- **Deploy**: Cloudflare Pages project `sirius-website`, via `build/cloudflare/
  deploy-website.sh` in the house pattern (idempotent, exact names only) — the owner runs
  it. `.github/workflows/sirius-website.yml` builds on pushes to `sirius` that touch
  `website/` or the rendered docs and on every published release, and deploys only when
  the Pages-only token secret exists. `www` and `siriuside.dev` redirect to the apex with
  zone-level Single Redirects (add "Dynamic URL Redirects: Edit" to the token recipe in
  `build/cloudflare/README.md`).
- `build/sirius/set-identity.mjs` gets the site's constants file in its target list.
- The `product.json` URL changes are **not** on the branch: list the exact lines in
  PROJECT-STATE §13; the owner flips them locally once DNS answers, for the next tag.

## 7. Process — what the cloud session does, with two stops

1. `git fetch origin && git rebase origin/sirius` so the branch carries this brief.
2. **Design direction — stop for the owner's OK.** A one-page concept (type choice,
   palette use, motion idea, section map), plus the *real* landing hero and one feature
   section built in Astro. Screenshots at 1440×900 and 390×844 in dark and light,
   committed as PNGs under `website/design/` and pushed. Report and stop; the owner
   reviews them locally and answers in the cloud.
3. **Full build.** After each page: screenshot at both widths, compare against §1 and §3,
   run Lighthouse and axe, fix, repeat. Then two Opus subagent passes on the whole site —
   a design critique against this brief, and a performance / accessibility / SEO audit —
   and act on both.
4. **Handoff.** Push; PROJECT-STATE §13 records what is verified versus only written, the
   Lighthouse table per page, the deploy steps, the `product.json` lines, and the media
   slots awaiting real footage. Stop and report.

What the cloud cannot do, and leaves to the owner: anything on `dl.siriuside.com` (the
VM's proxy blocks it), DNS and the deploy, the Pages token, real product footage.

## 8. The local side (the owner's machine)

- Produce the product footage with the built app and a local model, and drop it into the
  documented media slots.
- Land the branch (PROJECT-STATE §12), run `deploy-website.sh`, set DNS, check the site
  from outside (Lighthouse from a real device, every link, both schemes, the redirects),
  flip the `product.json` URLs, and ship them in the next tag.

## 9. What the competitors' sites do (surveyed 2026-10-01)

Surveyed from the live sites: Cursor, Devin Desktop (windsurf.com now redirects to
devin.ai/desktop — "Devin Desktop is the new name for Windsurf"), Zed, Google Antigravity,
Kiro (AWS), Trae, VS Code, GitHub Copilot; Linear, Raycast and Vercel as polish references.
PageSpeed Insights refused keyless calls, so the numbers are our own measurements: wire
bytes of the files the initial HTML references, and the median TTFB of five samples from
one vantage point.

**What every strong site does — the baseline to match**

- The product UI *is* the hero, and it is mostly HTML-rendered: Cursor, Devin, VS Code and
  Linear draw the editor in the DOM, not as a screenshot. Zed overlays a "watch demo"
  video; Antigravity autoplays 3.4 MB and 1.9 MB MP4s.
- One filled Download button and one quiet secondary CTA. Seven of eight set the OS label
  client-side after serving "macOS" — a visible wrong-OS flash on Linux.
- Custom typefaces plus a monospace accent, without exception: CursorGothic + Berkeley
  Mono + EB Garamond; IBM Plex + Lilex (Zed); Google Sans Flex (Antigravity); AWS Diatype
  + Fragment Mono (Kiro); Inter + JetBrains Mono (Trae); Mona Sans (Copilot); Geist
  (Vercel); Inter Variable + Berkeley Mono + a serif accent (Linear).
- Agent-first copy; light and dark, or one deliberate theme; a changelog or blog strip
  near the bottom of the landing page.

**What only the best add — where the site wins**

- TTFB under 250 ms (Linear 171 ms, Vercel 240, Devin 246, Cursor 248); static pages on
  Cloudflare's edge should land well under that.
- Keyboard affordances: Zed's "Download now [D]" / "Clone source [C]" chips, GitHub's `/`
  to search.
- One memorable brand device: Zed's blueprint grid, Cursor's painted backdrop, Vercel's
  single glowing triangle on one canvas. Ours is the split star and the bolt.
- `prefers-reduced-motion` handled (Copilot, Linear, VS Code); absent at Zed, Antigravity
  and Trae.
- Finish done in CSS, not libraries: Linear's 352 keyframes, mask-image and
  radial-gradient work, `@property`, view transitions; Vercel's oklch colour,
  `@container`, `@starting-style`, `text-wrap: balance`.

**Measured weight** — JavaScript referenced by the initial HTML, wire bytes: Antigravity
66 KB (Astro), VS Code 177 KB, Devin 409 KB, Trae 534 KB, Raycast 599 KB, Vercel 608 KB,
Zed 721 KB, Linear 842 KB, Kiro 926 KB, Cursor 1,663 KB, Copilot 1,709 KB. The 60 KB
landing budget in §1 beats every one of them; Antigravity is the only site close.

**Gaps nobody fills — the site should own these**

1. **Verifiable downloads.** No competitor shows a checksum or a signature, and Linux
   coverage is uneven (Antigravity tar.gz only, Zed `curl | sh`, Kiro deb + tar.gz, Cursor
   the only AppImage). We show the sha256 and `gh attestation verify` for every asset and
   cover deb, rpm, tarball and the Arch repository with copyable apt/dnf/pacman snippets.
2. **No wrong-OS flash.** Decide the OS before first paint (§4).
3. **Weight and walls.** Cookie banners cover the hero on Cursor and Trae. We have no
   cookies, no banner, no third-party script — and we can say so.
4. **Plain pricing.** Every competitor has moved to credits, quotas or seats: Kiro
   credits, Zed tokens, Copilot "monthly credits", Cursor's "$20 is a floor". Sirius has
   no plan at all — free to download and use; you pay your provider directly, or run local
   models for nothing. One line on the landing page, one row in the comparison.
5. **Local-first, head-to-head.** No competitor leads with local or offline models, and
   none has a comparison section on its landing page. Both are ours to take — accurately.

**Accuracy notes for the comparison** (as of 2026-10-01; re-check before publishing):
Devin's "unlimited access to SWE-2" is a promotion that its pricing page ends on
2026-10-16; Antigravity's "available at no charge" carries weekly rate limits; Copilot Free
is 2,000 completions a month with credit-metered agent use; Cursor's $20 is the floor and
its FAQ points daily agent users to Pro+ or Ultra; Kiro's "predictable pricing" sits beside
0.05×–6× model multipliers; Trae's "10×" is unsubstantiated; Zed's "fast" is unquantified.
Microsoft's extension marketplace terms bar other products from using it — Sirius ships
Open VSX; say so wherever extensions come up.

Stacks, for reference: Next.js (Cursor, Devin, Zed, Kiro), Astro (Antigravity), hand-built
static (VS Code), React + Primer (Copilot), client-rendered (Trae). Docs: Mintlify (Devin),
mdBook (Zed), GitHub Docs (Copilot), custom (Cursor, Kiro, VS Code).
