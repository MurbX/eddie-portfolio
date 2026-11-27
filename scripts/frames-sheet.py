"""Turn a recording from scripts/record-flow.mjs into contact sheets.

For each click in the recording it writes three sheets into <recording>/sheets/:
  <n>-<name>-flow.jpg     the whole transition, one frame roughly every 70 ms
  <n>-<name>-switch.jpg   EVERY frame around the moment the page switches
  <n>-<name>-corner.jpg   the same frames, top-left corner enlarged
and for the first visit:
  0-loader-flow.jpg       the loader from first paint to the hero

Frames after the page switch carry a red bar; each frame shows its time in ms.

Usage: python -I scripts/frames-sheet.py _source/recordings/<run>
"""
import json, os, sys
from PIL import Image, ImageDraw

run = sys.argv[1]
meta = json.load(open(os.path.join(run, 'frames.json')))
frames, events = meta['frames'], meta['events']
out = os.path.join(run, 'sheets'); os.makedirs(out, exist_ok=True)

def sheet(items, path, cols=6, tile_w=300, crop=None, zero=0, switch_t=None):
    """items: list of frames. crop: (x0, y0, x1, y1) fractions of the frame."""
    if not items: return
    tiles = []
    for f in items:
        im = Image.open(os.path.join(run, f['name'])).convert('RGB')
        if crop:
            w, h = im.size
            im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        im = im.resize((tile_w, round(im.height * tile_w / im.width)), Image.LANCZOS)
        tiles.append((f, im))
    th = tiles[0][1].height
    rows = (len(tiles) + cols - 1) // cols
    pad, bar = 4, 16
    W, H = cols * (tile_w + pad) + pad, rows * (th + bar + pad) + pad
    canvas = Image.new('RGB', (W, H), '#3a3a3a'); d = ImageDraw.Draw(canvas)
    for i, (f, im) in enumerate(tiles):
        x, y = pad + (i % cols) * (tile_w + pad), pad + (i // cols) * (th + bar + pad)
        after = switch_t is not None and f['t'] >= switch_t
        d.rectangle((x, y, x + tile_w, y + bar), fill='#b3261e' if after else '#1d1d1d')
        d.text((x + 4, y + 2), f"{f['t'] - zero:+d} ms{'  NEW PAGE' if after else ''}", fill='white')
        canvas.paste(im, (x, y + bar))
    canvas.save(path, quality=85)
    print(f'{path}  ({len(tiles)} frames, {W}x{H})')

def between(a, b): return [f for f in frames if a <= f['t'] <= b]
def thin(items, step_ms, limit):
    kept, last = [], -1e9
    for f in items:
        if f['t'] - last >= step_ms: kept.append(f); last = f['t']
    return kept[:limit]

def ev(prefix, after=0):
    return next((e for e in events if e['name'].startswith(prefix) and e['t'] >= after), None)

# First visit: loader
start = frames[0]['t']
done = ev('intro-done home')
if done:
    sheet(thin(between(start, done['t'] + 300), 150, 48), os.path.join(out, '0-loader-flow.jpg'), zero=start)
    # every frame of the first 600 ms (first paint) and of the loader's exit
    sheet(between(start, start + 700)[:48], os.path.join(out, '0-loader-first-paint.jpg'), zero=start)

# Each click → transition
for n, click in enumerate([e for e in events if e['name'].startswith('click ')], 1):
    name = click['name'].split(' ', 1)[1].lower()
    switch = ev('page-switch', click['t'])
    done = ev('intro-done', click['t'])
    if not switch or not done: continue
    c, s, e = click['t'], switch['t'], done['t']
    sheet(thin(between(c - 100, min(e, s + 2500)), 70, 60), os.path.join(out, f'{n}-{name}-flow.jpg'), zero=c, switch_t=s)
    around = between(s - 350, s + 900)[:60]
    sheet(around, os.path.join(out, f'{n}-{name}-switch.jpg'), zero=c, switch_t=s)
    sheet(around, os.path.join(out, f'{n}-{name}-corner.jpg'), crop=(0, 0, 0.3, 0.3), zero=c, switch_t=s)

errors = [e['name'] for e in events if e['name'].startswith('ERROR')]
print('page errors:', errors or 'none')
