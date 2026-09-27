# Sirius icon sources

- `icon.png` — the master mark, 2048 × 2048 RGBA, transparent rounded-square corners.
  Used for every rendition of 64 px and up.
- `icon-small.png` — the simplified mark for 48 px and under: the same five-point,
  two-tone star on the same background, without the bolt and lens flare, which stop
  reading below ~48 px. Drawn parametrically from the master's palette.

Every platform icon file is generated from these two — never hand-edit the outputs:

```bash
python3 build/sirius/make-icons.py resources/sirius/icon.png \
  --small resources/sirius/icon-small.png --installer
```
