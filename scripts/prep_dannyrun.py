#!/usr/bin/env python3
"""Turn the Danny Run t-shirt PHOTO into a clean transparent logo:
key out the light fabric (incl. soft shadows), render the dark logo as solid
black with soft anti-aliased edges, then trim to the logo bounding box."""
from PIL import Image
import sys, os

SRC = "/Users/omarabdelghany/Downloads/WhatsApp Image 2026-10-21 at 11.41.40.jpeg"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "logos", "dannyrun.png")
T = int(sys.argv[1]) if len(sys.argv) > 1 else 205  # luminance threshold: >=T is fabric
PAD_FRAC = 0.03

img = Image.open(SRC).convert("RGB")
w, h = img.size
px = img.load()
out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
op = out.load()

minx, miny, maxx, maxy = w, h, -1, -1
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        L = 0.299 * r + 0.587 * g + 0.114 * b
        if L >= T:
            continue  # fabric -> transparent
        a = int(min(255, (T - L) / T * 255 * 1.6))  # darker => more opaque
        op[x, y] = (0, 0, 0, a)  # render logo as solid black
        if a > 40:
            minx, miny = min(minx, x), min(miny, y)
            maxx, maxy = max(maxx, x), max(maxy, y)

if maxx < 0:
    print("nothing kept — threshold too low"); sys.exit(1)

pad = int(max(maxx - minx, maxy - miny) * PAD_FRAC)
l, t = max(0, minx - pad), max(0, miny - pad)
r2, b2 = min(w, maxx + 1 + pad), min(h, maxy + 1 + pad)
out.crop((l, t, r2, b2)).save(OUT)
print(f"dannyrun.png: {w}x{h} -> {r2-l}x{b2-t} (T={T})")
