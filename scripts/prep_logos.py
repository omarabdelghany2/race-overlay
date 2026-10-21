#!/usr/bin/env python3
"""Trim surrounding whitespace and key white->transparent for each sponsor logo,
preserving colour (e.g. the Suunto red triangle). Output clean transparent PNGs
that composite well on a white chip or directly on video."""
from PIL import Image
import os

SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "logos")
LOGOS = ["ppc.png", "suunto.png", "salomon.png", "esn.png"]
PAD_FRAC = 0.03          # padding as fraction of the trimmed longer side
WHITE_MIN = 245          # pixels with min(r,g,b) >= this are treated as background


def process(path):
    img = Image.open(path).convert("RGBA")
    px = img.load()
    w, h = img.size

    # 1) white -> alpha, preserving colour; find content bbox in one pass
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            m = min(r, g, b)
            # ink coverage: how far from white
            key = 255 - m
            na = int(key * (a / 255.0))
            px[x, y] = (r, g, b, na)
            if na > 16:  # part of the actual logo
                if x < minx: minx = x
                if y < miny: miny = y
                if x > maxx: maxx = x
                if y > maxy: maxy = y

    if maxx < 0:  # nothing found, bail out unchanged
        return img.size, img.size

    # 2) crop to content + uniform padding
    pad = int(max(maxx - minx, maxy - miny) * PAD_FRAC)
    l = max(0, minx - pad)
    t = max(0, miny - pad)
    r = min(w, maxx + 1 + pad)
    bt = min(h, maxy + 1 + pad)
    cropped = img.crop((l, t, r, bt))
    cropped.save(path)
    return (w, h), cropped.size


for name in LOGOS:
    p = os.path.join(SRC_DIR, name)
    if not os.path.exists(p):
        print(f"  skip {name} (missing)")
        continue
    before, after = process(p)
    print(f"  {name}: {before[0]}x{before[1]} -> {after[0]}x{after[1]} (trimmed + keyed)")

print("done")
