# siriuside.com — the design direction

Approved by the owner on 2026-10-01 with six answers (recorded at the end); the full build
was made on it the same day (PROJECT-STATE.md §13 has the state of that build). The PNGs
beside this file are the landing page as built, rendered by `npm run screenshots` at
1440×900 and 390×844 in dark and light; `home-1440x900-dark-mid.png` is the product window
5.8 s into its sequence.

## House rules from the owner (2026-10-01), applied

1. **No gradients anywhere.** No gradient functions, no glows, no soft shadows. Depth comes
   from flat planes and 1 px rings; light is a crisp line, not a bloom. `src/styles/tokens.css`
   carries the rule.
2. **No "AI" in the site's own copy** — the headline and the marketing text. The positioning is
   *native, advanced, agentic*. The product's own strings inside the drawn surfaces stay exactly
   what the product shows, including the "Select AI Model" title of the picker.
3. **No company in the website's footer.** The footer and the page metadata name no company.
   The licence keeps its copyright holder and is rendered verbatim on `/license/` in the full
   build.

## The idea, in one line

*Deep space, brilliant star, a bolt of speed* — the mark at full size. The page is the
sky the mark sits in: a flat near-black field and a sparse starfield. The headline — *The
advanced agentic code editor.* — is the split star: the line in silver, the word *agentic*
in solid cyan. The bolt strikes once on
load from a lens flare in the top-right corner — a point, a crosshair, a hairline ring — and
settles into one crisp diagonal line behind the product. The product, the editor drawn in
HTML in its own theme, is the brilliant thing in the middle of the page.

## Type

- **Geist** (OFL; variable 100–900) for display and text and **Geist Mono** (OFL; variable
  100–900) for code and UI chrome — eyebrows, labels, the version tag, the drawn editor.
  The owner asked for the engineering-ideal pair, and this is it: one family designed as a
  system for developer products, so the sans and the mono share proportions, x-height and
  rhythm; proven hinting at UI sizes, which the docs will lean on; a full weight range in one
  variable file each; and Latin subsets of 24 KB and 25 KB (`scripts/make-fonts.py` cuts
  the upstream variable fonts to the Latin range and to the weights the site uses, 400–800
  and 400–700). Geist's technical, even texture
  suits "advanced agentic" better than a face with more personality would.
  Considered and set aside: Schibsted Grotesk (the first proposal — sharper character, less
  proven small-size legibility), Inter (the competitors' default), Instrument Sans (no weight
  above 700), Manrope (rounder than the mark).
- Both are self-hosted through Astro's fonts API, which also writes metric-matched
  fallbacks against Arial and Courier New so text does not shift when the web fonts arrive.
  The text face is preloaded; the mono face is not, so it never competes with the headline
  for bandwidth. `font-display: swap`, 50 KB in total. Geist Mono's ligatures are off
  everywhere (`--` and `=>` must read as typed in a command or a diff).

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
them are in `src/styles/tokens.css`. **The product window follows the scheme** (owner's
answer 2): in the light scheme it wears the editor's built-in Default Light Modern theme,
which Sirius ships, read from `extensions/theme-defaults/themes/light_modern.json` — white
editor, `#f8f8f8` chrome, `#005fb8` accents, Light+ syntax colours. The Sirius Star palette
exists only as a dark theme; a *Sirius Star Light* theme would be a small product addition
that the light window could then wear.

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
   All Edits · Undo All Edits" — and it rests there, the moment before the user keeps the
   edit (owner's answer 3): the diff and its controls are the resting frame, which is what
   most visitors, reduced-motion users and link previews see. Transform and opacity only.
   **The end state is the resting state**, and it is exactly what `prefers-reduced-motion`
   renders (checked pixel for pixel in the review).
3. **Everywhere else:** the primary button's hover is the bolt again — a solid diagonal bar
   of light sweeping across, transform only; the flare's ring and point open every feature
   eyebrow; scroll reveals (a 12 px rise as a block enters the viewport) run on the CSS
   scroll timeline alone — no script, and a browser without `animation-timeline: view()` or
   with reduced motion simply shows the settled state; view transitions between pages
   (Astro's ClientRouter is on).

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

The full build — every page of BRIEF §4, the docs, the tests, the deploy script and the
workflow; PROJECT-STATE.md §13 is the inventory and the verification record. Two things the
direction promised changed in the making: the starfield is cut out of the hero's copy
column (a flat rectangular mask subtracted from the dot layers, no gradient), and the bolt
drops steeply from the flare to the window's corner instead of crossing the page, so it
never strikes through text at any width. The seven feature demos other than the model
picker are flat SVG stand-ins until the owner's footage lands in the media slots
(`src/media/README.md`); the design critique (2026-10-01) asks for them to be rebuilt as
HTML surfaces like the picker if the footage is late.

## The six decisions, as the owner answered them (2026-10-01)

1. **Stage hero** — approved.
2. **The product window follows the scheme** — light with light, dark with dark; done with
   the editor's shipped light theme (see Palette).
3. **The sequence rests on the pending diff** — my recommendation, taken: the resting frame
   shows the diff with Keep / Undo and the "2 files changed" bar.
4. **Geist + Geist Mono** — my recommendation for the engineering-ideal pair, taken (see
   Type).
5. **A local model at work in the hero, Claude Opus 5 highlighted in the picker** — approved,
   with licence to do more where it helps.
6. **Headline: "The advanced agentic code editor."** — the owner's wording, with *agentic*
   as the accent.
