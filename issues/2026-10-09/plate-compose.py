#!/usr/bin/env python3
"""How the front-page plate of the ImpactBench special edition was made.

    python3 plate-compose.py [output.jpg]        (needs Pillow and numpy)

Two pictures from the ImpactBench project's own site, used with the permission
of the ImpactBench team (confirmed by a team member on 9 October 2026):

  the wheel   image 25.png     the three domains on an inner ring, the 14
                               subareas on an outer ring, the figure at its
                               centre
  the meadow  homepage-meadow  the painted landscape behind the site's home page

The wheel is laid over the meadow with a white ring and a soft shadow.

One change to the wheel's colour, and the reason for it. On the site, red means a
lower pass rate and green a higher one. Red and green have almost the same
lightness, so printed in one ink they cannot be told apart and the wheel would
say nothing. Colour is therefore recoloured by what it means: lower prints dark,
higher prints light. Neutral pixels (labels, figure) are left as they are.
"""
import io
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BASE = 'https://impactbench.media.mit.edu/_app/immutable/assets/'
WHEEL = BASE + 'image%2025.png.C9b0hvh2.webp'
MEADOW = BASE + 'homepage-meadow.jpg.B7tTFQf5.webp'
UA = 'cyborg-news/1.0 (lab newspaper; github.com/nickbel7/cyborg-news)'

W, H = 2400, 848          # 170 x 60 mm at 2.83:1, the plate's shape
D = 760                   # the wheel's diameter in the plate
Y0 = 300                  # which band of the meadow to use


def fetch(url):
    # curl rather than urllib: it uses the system's trusted certificates, and some
    # Python builds (the python.org macOS ones) ship with none and fail every https call
    data = subprocess.run(['curl', '-fsSL', '--max-time', '40', '-A', UA, url],
                          check=True, capture_output=True).stdout
    return Image.open(io.BytesIO(data))


def one_ink(wheel):
    a = np.asarray(wheel).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3:]
    colourful = np.clip((rgb.max(-1) - rgb.min(-1)) / 255.0 * 2.2, 0, 1)[..., None]
    meaning = rgb[..., 1] - rgb[..., 0]                      # green minus red
    mapped = np.clip(150 + meaning * 0.62, 30, 245)[..., None]
    grey = rgb.mean(-1, keepdims=True)
    out = grey * (1 - colourful) + mapped * colourful
    return Image.fromarray(np.concatenate([np.repeat(out, 3, -1), alpha], -1).astype(np.uint8), 'RGBA')


def main(dest):
    bg = fetch(MEADOW).convert('RGB').crop((0, Y0, W, Y0 + H)).convert('RGBA')
    wheel = one_ink(fetch(WHEEL).convert('RGBA').resize((D, D), Image.LANCZOS))
    cx, cy = W // 2, H // 2

    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse((cx - D // 2 - 6, cy - D // 2 + 14, cx + D // 2 + 6, cy + D // 2 + 26),
                                   fill=(0, 0, 0, 120))
    canvas = Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(26)))

    ring = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    r = D // 2 + 14
    ImageDraw.Draw(ring).ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 255), width=9)
    canvas = Image.alpha_composite(canvas, ring)
    canvas.alpha_composite(wheel, (cx - D // 2, cy - D // 2))
    canvas.convert('RGB').save(dest, quality=93)
    print(dest, canvas.size)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'plate.jpg')
