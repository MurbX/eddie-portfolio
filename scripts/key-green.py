"""Cut a subject out of a chroma-green background and grade it black & white.

Usage: python -I scripts/key-green.py <in.png> <out.png> [--color] [--lift=0.3] [--grain=0.03]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
keep_color = '--color' in sys.argv

im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]

# How "green-screen" a pixel is: green above the other two channels
greenness = g - np.maximum(r, b)
alpha = 1 - np.clip((greenness - 28) / (120 - 28), 0, 1)

# Tighten the matte slightly so no green halo survives
a_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
alpha = np.asarray(a_img).astype(np.float32) / 255

# Despill: green can never exceed the brighter of red/blue
g = np.minimum(g, np.maximum(r, b))
rgb = np.stack([r, g, b], -1)

if not keep_color:
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    # Low-key contrast curve: deepen shadows, keep highlights crisp
    x = lum / 255
    lift = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--lift=')), 0.0))
    x = np.clip((x - 0.02) / 0.88, 0, 1) ** (1.05 - lift)
    x = x * x * (3 - 2 * x) * 0.5 + x * 0.5
    x = x + lift * 0.12 * (1 - x) * np.sqrt(x)   # opens up the shadows (t-shirt folds)
    # Photographic grain: breaks up the smooth, waxy look of generated skin.
    # Luminance noise, strongest in the mid-tones like real film/sensor grain.
    grain = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--grain=')), 0.0))
    if grain:
        rng = np.random.default_rng(7)
        n = rng.normal(0, 1, x.shape).astype(np.float32)
        n = np.asarray(Image.fromarray(((n * 40) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32)
        n = (n - 128) / 40
        x = np.clip(x + n * grain * (0.35 + 0.65 * 4 * x * (1 - x)), 0, 1)
    rgb = np.repeat((x * 255)[..., None], 3, -1)

out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
img = Image.fromarray(out, 'RGBA')
img = img.crop(img.getbbox())
img.save(dst)
print(dst, img.size)
