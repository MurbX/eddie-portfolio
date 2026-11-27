"""Measure how long the page-transition curtain sits completely empty.

Reads a recording made by scripts/record-flow.mjs and reports, for every stretch where the
screen showed nothing but the plain curtain panels, when it started and how long it lasted.

Usage:  python scripts/empty-hold.py _source/recordings/<run>
"""
import json, os, sys
from PIL import Image
import numpy as np

run = sys.argv[1]
meta = json.load(open(os.path.join(run, 'frames.json')))
frames, events = meta['frames'], meta['events']
t0 = frames[0]['t']
PANEL = np.array([10, 16, 22])

def plain(name):
    a = np.asarray(Image.open(os.path.join(run, name)).convert('RGB')).astype(int)
    off = (np.abs(a - PANEL).max(axis=2) > 26)   # logo, name, lines, page content
    under = (a[:, :, 2] < 15)                     # the darker page background under a lifting panel
    return off.mean() < 0.0004 and under.mean() < 0.0004

flags = [plain(f['name']) for f in frames]
i = 0
while i < len(frames):
    if flags[i]:
        j = i
        while j + 1 < len(frames) and flags[j + 1]:
            j += 1
        end = frames[j + 1]['t'] if j + 1 < len(frames) else frames[j]['t']
        start = frames[i]['t']
        inside = [e['name'] for e in events if start <= e['t'] <= end]
        print(f"empty curtain: +{start - t0} ms -> +{end - t0} ms  = {end - start} ms  ({j - i + 1} frames){'  [' + ', '.join(inside) + ']' if inside else ''}")
        i = j + 1
    else:
        i += 1
for e in events:
    print(f"  event +{e['t'] - t0} ms  {e['name']}")
