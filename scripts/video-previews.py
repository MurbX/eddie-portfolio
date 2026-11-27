"""Make web-sized preview loops + poster frames from (remote) video files.

For each entry, ffmpeg seeks straight into the source (HTTP range requests,
so a 500 MB file is not downloaded) and writes:
  public/video/<slug>.mp4        short muted loop, H.264, faststart
  public/img/films/<slug>.webp   poster frame

Usage: python -I scripts/video-previews.py <map.json> [--seconds 6] [--at 0.35]
       map.json = {"slug": "https://… or local path", …}
"""
import json, subprocess, sys, os, tempfile
from concurrent.futures import ThreadPoolExecutor

args = sys.argv[1:]
src = args[0]
seconds = float(args[args.index('--seconds') + 1]) if '--seconds' in args else 6
at = float(args[args.index('--at') + 1]) if '--at' in args else 0.35
jobs = json.load(open(src))
os.makedirs('public/video', exist_ok=True)
os.makedirs('public/img/films', exist_ok=True)

def probe(url):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                          '-show_entries', 'stream=width,height:format=duration',
                          '-of', 'json', url], capture_output=True, text=True, timeout=120)
    d = json.loads(out.stdout)
    s = d['streams'][0]
    return float(d['format']['duration']), s['width'], s['height']

def run(item):
    slug, url = item
    try:
        dur, w, h = probe(url)
        start = max(0, min(dur * at, dur - seconds - 0.5))
        # Fit within 540 px on the short side (portrait 540x960, landscape 960x540)
        scale = 'scale=540:-2' if w < h else 'scale=-2:540'
        mp4 = f'public/video/{slug}.mp4'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{start:.2f}', '-i', url, '-t', str(seconds),
                        '-vf', f'{scale},fps=30', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28',
                        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], check=True, timeout=600)
        tmp = os.path.join(tempfile.gettempdir(), f'{slug}-poster.png')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{start + 0.5:.2f}', '-i', url, '-frames:v', '1',
                        '-vf', 'scale=720:-2' if w < h else 'scale=-2:720', tmp], check=True, timeout=300)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-c:v', 'libwebp', '-quality', '80',
                        f'public/img/films/{slug}.webp'], check=True, timeout=120)
        os.remove(tmp)
        kb = os.path.getsize(mp4) // 1024
        return f'OK  {slug:20s} {w}x{h} {dur:6.1f}s  loop {kb} KB'
    except Exception as e:
        return f'ERR {slug}: {e}'

with ThreadPoolExecutor(4) as ex:
    for line in ex.map(run, jobs.items()):
        print(line, flush=True)
