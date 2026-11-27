"""Paste the REAL face from the original photo onto an AI-extended portrait.

Gemini re-draws faces when it extends a photo. This script finds where the
face landed in the generated image (feature matching + RANSAC similarity
transform: position, scale and in-plane tilt), warps the original face onto
it, and blends it in with a feathered oval, so eyes, glasses, nose, mouth and
skin are the original pixels.

Usage:
  python -I scripts/face-restore.py <original.png> <generated.png> <out.png> [--debug dbg.jpg]
"""
import sys
import cv2
import numpy as np

orig_path, gen_path, out_path = sys.argv[1:4]
debug = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None

orig = cv2.imread(orig_path, cv2.IMREAD_COLOR)
gen = cv2.imread(gen_path, cv2.IMREAD_COLOR)
H, W = gen.shape[:2]
oh, ow = orig.shape[:2]

# Face region in the original 1024² portrait: forehead droplets to chin, cheek to cheek
FACE = dict(cx=0.49, cy=0.50, rx=0.33, ry=0.40)   # as fractions of the original

def gray_eq(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(g)

# Only look for features inside the face oval of the original
mask_o = np.zeros((oh, ow), np.uint8)
cv2.ellipse(mask_o, (int(FACE['cx'] * ow), int(FACE['cy'] * oh)),
            (int(FACE['rx'] * ow), int(FACE['ry'] * oh)), 0, 0, 360, 255, -1)

sift = cv2.SIFT_create(nfeatures=4000)
ko, do = sift.detectAndCompute(gray_eq(orig), mask_o)
kg, dg = sift.detectAndCompute(gray_eq(gen), None)
matches = cv2.BFMatcher(cv2.NORM_L2).knnMatch(do, dg, k=2)
good = [m for m, n in matches if m.distance < 0.8 * n.distance]
print(f'features: orig {len(ko)}, gen {len(kg)}, good matches {len(good)}')
if len(good) < 8:
    sys.exit('Not enough matching features: the generated face differs too much. Try another variation.')

src = np.float32([ko[m.queryIdx].pt for m in good])
dst = np.float32([kg[m.trainIdx].pt for m in good])
M, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=6, maxIters=20000, confidence=0.999)
n_in = int(inliers.sum()) if inliers is not None else 0
scale = float(np.hypot(M[0, 0], M[1, 0]))
angle = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
print(f'inliers {n_in}/{len(good)} · scale {scale:.3f} · tilt {angle:.1f}°')
if n_in < 8:
    sys.exit('Alignment unreliable (too few inliers).')

# Warp the original into the generated frame
warped = cv2.warpAffine(orig, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)

# Feathered oval mask of the face, warped the same way
fm = np.zeros((oh, ow), np.float32)
cv2.ellipse(fm, (int(FACE['cx'] * ow), int(FACE['cy'] * oh)),
            (int(FACE['rx'] * ow * 0.92), int(FACE['ry'] * oh * 0.92)), 0, 0, 360, 1.0, -1)
fm = cv2.GaussianBlur(fm, (0, 0), sigmaX=ow * 0.045)
mask = cv2.warpAffine(fm, M, (W, H), flags=cv2.INTER_LINEAR)[..., None]

# Match the original's tones to the generated image inside the face (mean/std per channel)
inside = mask[..., 0] > 0.6
w2 = warped.astype(np.float32)
g2 = gen.astype(np.float32)
for c in range(3):
    ws, gs = w2[..., c][inside], g2[..., c][inside]
    w2[..., c] = (w2[..., c] - ws.mean()) / (ws.std() + 1e-6) * (gs.std() * 0.5 + ws.std() * 0.5) + gs.mean()

out = g2 * (1 - mask) + np.clip(w2, 0, 255) * mask
cv2.imwrite(out_path, np.clip(out, 0, 255).astype(np.uint8))
print('saved', out_path)

if debug:
    vis = gen.copy()
    cnt = (mask[..., 0] > 0.5).astype(np.uint8)
    contours, _ = cv2.findContours(cnt, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, contours, -1, (0, 0, 255), 4)
    cv2.imwrite(debug, np.hstack([vis, np.clip(out, 0, 255).astype(np.uint8)]))
