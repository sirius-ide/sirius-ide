#!/usr/bin/env python3
"""Build the site's font files from the upstream Geist variable fonts.

Writes
  src/fonts/Geist-latin.woff2, src/fonts/GeistMono-latin.woff2
      variable (wght 100–900) Latin subsets for the browser — the `latin`
      range Google Fonts uses, which astro.config.mjs declares as unicode-range
  src/og/Geist-Regular.ttf, src/og/Geist-Bold.ttf, src/og/GeistMono-Regular.ttf
      static Latin instances for satori, which cannot read variable fonts

Source: the variable woff2 files vercel/geist-font ships in its Next.js package
(SIL Open Font License 1.1 — src/fonts/OFL-*.txt). They are fetched into
.cache/ when missing; delete that directory to refetch.

    python3 scripts/make-fonts.py           # needs fontTools and brotli
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

try:
    from fontTools.subset import Options, Subsetter
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
except ImportError:  # pragma: no cover
    sys.exit('make-fonts: pip install fonttools brotli')

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache' / 'fonts'
BASE = 'https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/dist/fonts/'
SOURCES = {
    'Geist': BASE + 'geist-sans/Geist-Variable.woff2',
    'GeistMono': BASE + 'geist-mono/GeistMono-Variable.woff2',
}
# Keep in sync with LATIN in astro.config.mjs.
LATIN = (
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
    'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
)
WEB = {'Geist': ROOT / 'src/fonts/Geist-latin.woff2', 'GeistMono': ROOT / 'src/fonts/GeistMono-latin.woff2'}
# The site uses weights 400–800 of the text face and 400–700 of the mono face; the axis is cut to that.
AXIS = {'Geist': (400, 800), 'GeistMono': (400, 700)}
STATIC = [('Geist', 400, ROOT / 'src/og/Geist-Regular.ttf'), ('Geist', 700, ROOT / 'src/og/Geist-Bold.ttf'), ('GeistMono', 400, ROOT / 'src/og/GeistMono-Regular.ttf')]


def fetch(name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / f'{name}-Variable.woff2'
    if not dest.exists():
        print(f'fetching {SOURCES[name]}')
        with urllib.request.urlopen(SOURCES[name], timeout=60) as r:
            dest.write_bytes(r.read())
    return dest


def unicodes() -> list[int]:
    out: list[int] = []
    for part in LATIN.split(','):
        a, _, b = part[2:].partition('-')
        lo, hi = int(a, 16), int(b or a, 16)
        out.extend(range(lo, hi + 1))
    return out


def subset(font: TTFont, flavor: str | None) -> TTFont:
    opts = Options()
    opts.flavor = flavor
    opts.layout_features = ['*']           # keep kern, liga, tnum, ss01…: the site uses several
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    s = Subsetter(options=opts)
    s.populate(unicodes=unicodes())
    s.subset(font)
    return font


def check(path: Path) -> None:
    t = TTFont(path)
    cmap = t.getBestCmap()
    sample = 'The advanced agentic code editor. 0123456789 — “quotes” €'
    missing = sorted({c for c in sample if ord(c) not in cmap})
    if missing:
        sys.exit(f'{path.name}: glyphs missing for {missing!r}')
    axes = [a.axisTag for a in t['fvar'].axes] if 'fvar' in t else []
    print(f'{path.relative_to(ROOT)}: {path.stat().st_size:,} B, {len(cmap)} code points, axes {axes or "static"}')


def main() -> None:
    for name, dest in WEB.items():
        font = TTFont(fetch(name))
        subset(font, None)                    # subset first: the subsetter chokes on a partially instanced font
        font = instantiateVariableFont(font, {'wght': AXIS[name]}, inplace=False)
        font.flavor = 'woff2'
        dest.parent.mkdir(parents=True, exist_ok=True)
        font.save(dest)
        check(dest)
    for name, weight, dest in STATIC:
        font = TTFont(fetch(name))
        font = instantiateVariableFont(font, {'wght': weight}, inplace=False, updateFontNames=True)
        subset(font, None)
        font.flavor = None                    # plain sfnt: the source was woff2 and the flavor sticks
        dest.parent.mkdir(parents=True, exist_ok=True)
        font.save(dest)
        check(dest)


if __name__ == '__main__':
    main()
