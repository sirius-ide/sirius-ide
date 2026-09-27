#!/usr/bin/env python3
#
# Copyright (c) Clicksora, L.L.C. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
#
# Generate every platform icon Sirius ships from one tracked source image.
#
#   python3 build/sirius/make-icons.py resources/sirius/icon.png
#   python3 build/sirius/make-icons.py resources/sirius/icon.png --small resources/sirius/icon-small.png
#   python3 build/sirius/make-icons.py SOURCE --out /tmp/preview        # dry run into a scratch dir
#   python3 build/sirius/make-icons.py SOURCE --installer               # also the Inno Setup bitmaps
#
# The Aug-2026 icons were produced by hand, so a logo change meant redoing ~10
# files in four formats and hoping the sizes matched what code.iss and the
# gulpfiles expect. This script is that knowledge, executable.
#
# Needs only Pillow. ImageMagick's ICNS writer on this machine emits a bare PNG,
# and Pillow's omits the three non-retina small entries (icp4/icp5/icp6) the
# current code.icns carries, so the ICNS container is packed here directly —
# it is just `type + length + PNG bytes` per entry.
#
# --small: detailed art stops reading below ~48 px (a lens flare becomes a
# stray dot; a bolt vanishes). Pass a simplified mark and it is used for every
# rendition of 48 px and under; without it, the main source is used throughout
# and the 16/32 px results deserve a look before they ship.

import argparse
import io
import struct
import sys
from pathlib import Path

try:
	from PIL import Image
except ImportError:
	sys.exit('make-icons: Pillow is required (pip install pillow / pacman -S python-pillow)')

SMALL_MAX = 48

# What each platform actually loads. Sizes come from the files shipped today,
# not from documentation; change one only if the consumer changes.
LINUX_PNG = 1024
WIN_ICO_SIZES = (256, 128, 64, 48, 32, 16)
WIN_TILES = (70, 150)
SERVER_FAVICON_SIZES = (64, 32, 16)
SERVER_PNGS = (192, 512)
# (type, pixel size, is @2x). Matches resources/darwin/code.icns entry for entry.
ICNS_ENTRIES = (
	(b'icp4', 16, False), (b'icp5', 32, False), (b'icp6', 64, False),
	(b'ic07', 128, False), (b'ic08', 256, False), (b'ic09', 512, False), (b'ic10', 1024, True),
	(b'ic11', 32, True), (b'ic12', 64, True), (b'ic13', 256, True), (b'ic14', 512, True),
)
# Inno Setup wizard images per DPI scale, from build/win32/code.iss lines 23-24.
INNO_SMALL = {100: (55, 55), 125: (64, 68), 150: (83, 80), 175: (92, 97), 200: (110, 106), 225: (119, 123), 250: (138, 140)}
INNO_BIG = {100: (164, 314), 125: (192, 386), 150: (246, 459), 175: (273, 556), 200: (328, 604), 225: (355, 700), 250: (410, 797)}


class Renderer:
	def __init__(self, main: Path, small: Path | None):
		self.main = Image.open(main).convert('RGBA')
		self.small = Image.open(small).convert('RGBA') if small else None
		if self.main.width != self.main.height:
			sys.exit(f'make-icons: source must be square, got {self.main.width}x{self.main.height}')
		if self.main.width < LINUX_PNG:
			sys.exit(f'make-icons: source is {self.main.width} px; at least {LINUX_PNG} px is needed')

	def at(self, size: int) -> Image.Image:
		src = self.small if (self.small is not None and size <= SMALL_MAX) else self.main
		return src.resize((size, size), Image.LANCZOS)

	def png_bytes(self, size: int) -> bytes:
		buf = io.BytesIO()
		self.at(size).save(buf, format='PNG', optimize=True)
		return buf.getvalue()


def write_png(r: Renderer, path: Path, size: int) -> None:
	path.write_bytes(r.png_bytes(size))


def write_ico(r: Renderer, path: Path, sizes: tuple[int, ...]) -> None:
	# Pillow writes one ICO from the largest image and its `sizes`; feeding it
	# the largest rendition and letting it downscale would bypass --small, so
	# the frames are rendered here and appended by hand — the ICO container is
	# a directory of PNG (or BMP) frames, and PNG frames are what Windows Vista+
	# and every current reader expect for 256 px.
	frames = [(s, r.png_bytes(s)) for s in sizes]
	header = struct.pack('<HHH', 0, 1, len(frames))
	offset = 6 + 16 * len(frames)
	entries = b''
	for size, data in frames:
		dim = 0 if size >= 256 else size
		entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
		offset += len(data)
	path.write_bytes(header + entries + b''.join(data for _, data in frames))


def write_icns(r: Renderer, path: Path) -> None:
	body = b''
	for kind, size, _ in ICNS_ENTRIES:
		data = r.png_bytes(size)
		body += kind + struct.pack('>I', 8 + len(data)) + data
	path.write_bytes(b'icns' + struct.pack('>I', 8 + len(body)) + body)


def write_bmp_on_white(r: Renderer, path: Path, w: int, h: int, icon_px: int) -> None:
	# Inno Setup wants 24-bit BMP with no alpha. The icon sits centred on white,
	# which is how the wizard renders these anyway.
	canvas = Image.new('RGBA', (w, h), (255, 255, 255, 255))
	icon = r.at(icon_px)
	canvas.alpha_composite(icon, ((w - icon_px) // 2, (h - icon_px) // 2))
	canvas.convert('RGB').save(path, format='BMP')


def main() -> int:
	ap = argparse.ArgumentParser(description='Generate every platform icon from one source image.')
	ap.add_argument('source', type=Path, help='square PNG, at least 1024 px; 2048 recommended')
	ap.add_argument('--small', type=Path, help=f'simplified mark used for renditions of {SMALL_MAX} px and under')
	ap.add_argument('--out', type=Path, default=Path('resources'), help='output root (default: resources/)')
	ap.add_argument('--installer', action='store_true', help='also regenerate the Inno Setup wizard bitmaps')
	args = ap.parse_args()

	r = Renderer(args.source, args.small)
	out = args.out
	written: list[Path] = []

	def emit(rel: str, fn, *fargs) -> None:
		path = out / rel
		path.parent.mkdir(parents=True, exist_ok=True)
		fn(r, path, *fargs)
		written.append(path)

	emit('linux/code.png', write_png, LINUX_PNG)
	emit('win32/code.ico', write_ico, WIN_ICO_SIZES)
	for t in WIN_TILES:
		emit(f'win32/code_{t}x{t}.png', write_png, t)
	emit('server/favicon.ico', write_ico, SERVER_FAVICON_SIZES)
	for s in SERVER_PNGS:
		emit(f'server/code-{s}.png', write_png, s)
	emit('darwin/code.icns', write_icns)
	if args.installer:
		for scale, (w, h) in INNO_SMALL.items():
			emit(f'win32/inno-small-{scale}.bmp', write_bmp_on_white, w, h, min(w, h) - 6)
		for scale, (w, h) in INNO_BIG.items():
			emit(f'win32/inno-big-{scale}.bmp', write_bmp_on_white, w, h, min(w, h) - 24)

	for p in written:
		print(f'  {p}  ({p.stat().st_size:,} bytes)')
	print(f'make-icons: {len(written)} files from {args.source}' + (f' (+ {args.small} for {SMALL_MAX} px and under)' if args.small else ''))
	return 0


if __name__ == '__main__':
	sys.exit(main())
