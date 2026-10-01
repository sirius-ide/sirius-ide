# siriuside.com — the design direction

For the owner's OK before the full build (BRIEF.md §7, step 2). What is here is real: the
landing hero and the first feature section, built in Astro under `website/`, rendered by
`npm run screenshots` at 1440×900 and 390×844 in dark and light. The PNGs beside this file
are those renders; `home-1440x900-dark-mid.png` is the product window 5.8 s into its
sequence, with the diff and its controls on screen.

## House rules from the owner (2026-10-01), applied

1. **No gradients anywhere.** No gradient functions, no glows, no soft shadows. Depth comes
   from flat planes and 1 px rings; light is a crisp line, not a bloom. `src/styles/tokens.css`
   carries the rule.
2. **No "AI" in the site's own text.** The positioning is *native, advanced, agentic*. The
   product's own strings inside the drawn surfaces stay what the product shows; where one of
   them says "AI" (the model command's title row) the illustration leaves that row out.
3. **No mention of the company.** The footer, the metadata and SECURITY.md name no company.
   The licence text, which must name its copyright holder, is a legal document and is
   rendered verbatim on `/license/` in the full build.

## The idea, in one line

*Deep space, brilliant star, a bolt of speed* — the mark at full size. The page is the
sky the mark sits in: a flat near-black field and a sparse starfield. The headline is the
split star — the line in silver, the word *agentic* in solid cyan. The bolt strikes once on
load from a lens flare in the top-right corner — a point, a crosshair, a hairline ring — and
settles into one crisp diagonal line behind the product. The product, the editor drawn in
HTML in its own theme, is the brilliant thing in the middle of the page.

## Type

- **Schibsted Grotesk** (OFL; Bakken & Bæck, Henrik Kongsvoll; variable 400–900) for
  display and text. Its terminals are cut at an angle — the bolt again — so it reads as
  speed and precision without borrowing Vercel's Geist or the Inter that Linear and Trae
  use. It holds a 68 px headline at weight 800 with −0.035 em tracking and is still a
  comfortable 17 px body face. One 20 KB Latin woff2 carries every weight.
  Considered and set aside: Geist (too much Vercel), Instrument Sans (no weight above
  700, lighter personality), Manrope (rounder and friendlier than the mark), Inter (the
  competitors' default).
- **JetBrains Mono** (OFL; variable 100–800) for code and UI chrome — eyebrows, labels,
  the version tag, the drawn editor. It is the face developers already read code in.
  15 KB Latin woff2.
- Both are self-hosted through Astro's fonts API, which also writes metric-matched
  fallbacks (`size-adjust` 103.8 % against Arial, 99.98 % against Courier New) so text does
  not shift when the web fonts arrive. Preloaded, `font-display: swap`, 36 KB in total.

## Palette and the two schemes

**Dark is the default and the hero experience**, and it is Sirius Star Dark verbatim:
`#06080d` background, `#0a0e14` side surfaces, `#0d1117` raised surfaces, `#e6edf3` text,
violet `#8b5cf6`, ice `#a8c7fa`, cyan `#67e8f9`, magenta `#c084fc`, the status greens,
ambers and reds. The one deliberate departure: the site's filled buttons rest on the
theme's button *hover* violet, `#7c3aed`, because white on `#8b5cf6` is 4.2:1 and the
brief asks for 4.5:1; `#8b5cf6` keeps borders, badges, focus rings and large type. The
accent word in the headline is solid cyan `#67e8f9`.

**Light is designed, not inverted:** a cool white `#f5f7fb` page, `#ffffff` and `#eef2f8`
surfaces, navy-black `#0b1220` text, `#4a5568` muted text, violet `#6d28d9`, azure
`#0369a1` for links and for the accent word, cyan `#0e7490`, status `#1a7f37` / `#9a6700` /
`#cf222e`. Every text and background pair clears 4.5:1; the values and the numbers behind
them are in `src/styles/tokens.css`. The product window stays dark on the light page:
Sirius ships one theme, so the product is shown as it is, framed on light the way a dark app
is on any light site.

**Depth without shadows.** The product window and the drawn picker sit in a 1 px ring in
the scheme's ring colour with a second hairline ring 3 px out — the indigo-and-cyan rim of
the mark, flat. Cards and menus use 1 px borders. Nothing is blurred and nothing fades into
anything.

## Motion — one idea, carried through

1. **Load.** The flare lights, the bolt strikes from it (1.1 s, `scaleX` and opacity) and
   settles into a crisp line behind the window; the copy rises in a 0.7 s stagger.
2. **The product sequence**, once, over eight seconds, in the product's own strings: the
   request; Sirius's "Running search files…" and "Running read file…" lines with
   spinner-to-check; the edit arriving in the editor as a diff — green tint, gutter bars,
   the Keep / Undo hunk control; the response and its file pills; "2 files changed · Keep
   All Edits · Undo All Edits"; then, at 7.7 s, the edit is kept: tints fade, the controls
   go, the Explorer shows M and Source Control shows 2. Transform and opacity only, plus
   one flat background-colour fade on six rows. **The end state is the resting state**, and
   it is exactly what `prefers-reduced-motion` renders (checked pixel for pixel in the
   review).
3. **Everywhere else:** the primary button's hover is the bolt again — a solid diagonal bar
   of light sweeping across, transform only; scroll reveals for sections in the full build
   (IntersectionObserver); view transitions between pages (Astro's ClientRouter is on).

Nothing loops. No canvas; the starfield is two masked SVG dot patterns that cost one paint.

## Layout system

- 1200 px container, 16–40 px gutters, 72–140 px section rhythm.
- **The hero is a stage:** centred copy, the window below at the full container width. A
  split hero would shrink the product to ~700 px; at 1180 px the drawn editor is crisp
  and the chat is readable. The headline sits on two lines from 900 px up, so about 200 px
  of the window shows above the fold at 1440×900.
- **Feature sections alternate the split** (copy | demo, then demo | copy). Each has a
  mono eyebrow "0N — …", a two-tone H2, a lede, three points marked with the flat split-star
  mark, and a demo: an HTML-drawn product surface now (here, the model picker with its real
  strings), the owner's footage later (slots to be documented in `src/media/README.md` in the
  full build).
- **Phones:** one column; the window drops the activity bar and Explorer and shows editor
  and chat side by side at 10.5 px; a demo sits between a section's heading and its detail,
  so the heading always comes first.

## Section map for the full build (landing page)

nav · hero · the three reasons (bring your own model · agentic by default · collects
nothing) · 01 agent mode (the hero's window, larger, with the footage slot) · 02 Tab and
next-edit prediction (a local FIM model, said plainly) · 03 providers and local models
(built) · 04 project rules and context · 05 the integrated browser · 06 git assist ·
07 import from VS Code, Cursor, Windsurf (Devin Desktop), VSCodium · 08 the remote server
· privacy block · platforms block · the comparison table (BRIEF §5) · FAQ · final CTA ·
footer. The other pages follow the BRIEF §4 inventory.

## What is on the branch

Astro 7.3 with Starlight 0.42, static output, `npm ci && npm run build` → `dist/`. Tokens
and base styles; the Base layout (OS and theme attributes set before first paint, the
served HTML names no OS; canonical, OpenGraph, manifest and icons); Nav, Footer, the flat
vector Logo, the OS-aware DownloadButton; the Hero (Sky + EditorWindow); the Providers
section with the ModelPicker; a 404 page; a Starlight stub at `/docs/`; the screenshot
script; `make-icons.py --web` for the favicons, manifest icons and default social image; the
two fonts with their licences. Landing-page JavaScript is Astro's ClientRouter and prefetch,
about 16 KB before compression; the page HTML is 8 KB compressed. `astro check` passes.

## Decisions I want your eye on

1. The stage hero (product under centred copy) rather than a split hero.
2. The product window stays dark on the light site.
3. The sequence ends in the calm "kept" state rather than the dramatic "diff pending" one;
   compare `home-1440x900-dark-mid.png` with the settled renders.
4. Schibsted Grotesk and JetBrains Mono.
5. A local model (`qwen3:32b`) shown as the model at work in the hero, with Claude Opus 5
   as the highlighted row in the picker.
6. The headline wording "The native, advanced, agentic code editor." — your three words, in
   that order, with *agentic* as the accent.
