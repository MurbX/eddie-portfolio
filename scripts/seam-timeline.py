"""Show what happens ON the four seams between the curtain panels over time.

For every recorded frame of a transition, the thin column of pixels on each seam is cut
out and the columns are laid side by side: left → right is time, top → bottom is the
screen. Anything that moves along a seam shows up as a slanted or travelling mark.

Usage: python -I scripts/seam-timeline.py _source/recordings/<run> [gain]
Output: <run>/seam-timeline.jpg
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

run = sys.argv[1]
gain = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
m = json.load(open(os.path.join(run, 'frames.json')))
frames, events = m['frames'], m['events']
click = next(e for e in events if e['name'].startswith('click'))['t']
switch = next(e for e in events if e['name'].startswith('page-switch') and e['t'] > click)['t']
sel = [f for f in frames if click - 100 <= f['t'] <= click + 4200]

W, H = Image.open(os.path.join(run, sel[0]['name'])).size
col_w, out_h = 3, 470
rows = []
for k in (1, 2, 3, 4):
    x = round(W * k / 5)
    cols = []
    for f in sel:
        a = np.asarray(Image.open(os.path.join(run, f['name'])).convert('RGB')).astype(np.float32)
        strip = a[:, x - 4:x + 5, :]                      # 9 px around the seam
        lum = strip.sum(axis=2)
        idx = lum.argmax(axis=1)                           # brightest pixel in each row
        col = strip[np.arange(H), idx, :]
        cols.append(np.clip(col * gain, 0, 255))
    img = np.stack(cols, axis=1).astype(np.uint8)          # H x frames x 3
    im = Image.fromarray(img).resize((len(sel) * col_w, out_h), Image.NEAREST)
    rows.append(im)

pad = 22
canvas = Image.new('RGB', (rows[0].width + 80, len(rows) * (out_h + pad) + 4), '#333')
d = ImageDraw.Draw(canvas)
for r, im in enumerate(rows):
    y = r * (out_h + pad) + pad
    canvas.paste(im, (76, y))
    d.text((4, y + out_h // 2), f'seam {r + 1}', fill='white')
    for t in range(0, 4201, 500):
        i = min(range(len(sel)), key=lambda j: abs(sel[j]['t'] - (click + t)))
        d.text((76 + i * col_w, y - 14), f'{t}ms', fill='white')
    i = min(range(len(sel)), key=lambda j: abs(sel[j]['t'] - switch))
    d.line((76 + i * col_w, y, 76 + i * col_w, y + out_h), fill='#ff3b30', width=1)
out = os.path.join(run, 'seam-timeline.jpg')
canvas.save(out, quality=92)
print(out, canvas.size, f'frames {len(sel)}, page switch at +{switch - click} ms (red line)')
