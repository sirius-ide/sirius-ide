# siriuside.com

The Sirius IDE website: Astro + Starlight, static output, served from Cloudflare Pages.
The specification is [BRIEF.md](BRIEF.md); the state of the work is PROJECT-STATE.md §13.

```bash
cd website
npm ci              # Node 22 — the website never touches the editor's npm ci
npm run dev         # http://localhost:4321
npm run build       # → dist/
npm run preview
npm run check       # astro check
npm run screenshots # design review PNGs at 1440×900 and 390×844, dark and light → design/
```

Fonts (`src/fonts/`): Geist and Geist Mono, Latin subsets, both under the SIL Open Font
License — the licences sit beside the files. Icons in `public/` come
from `build/sirius/make-icons.py … --web website/public`; never hand-edit them.
