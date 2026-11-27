# eddieVsuals — Eddie Owitie portfolio

Single-page portfolio for Eddie Owitie (photography, videography, graphic design, web).
Vite + vanilla JS, animated with GSAP (ScrollTrigger, SplitText, Flip) and Lenis smooth scrolling.

## Run

```bash
npm install
npm run dev       # http://localhost:5173 (also on your LAN for phone testing)
npm run build     # static site in dist/ — deploy to Vercel, Netlify, Cloudflare Pages, etc.
npm run preview   # serve the production build locally
```

## Pages

| URL | File |
| --- | --- |
| `/` | `index.html` |
| `/services/` | `services/index.html` |
| `/services/photography/` | `services/photography/index.html` |
| `/services/videography/` | `services/videography/index.html` |
| `/services/graphic-design/` | `services/graphic-design/index.html` |
| `/services/web-development/` | `services/web-development/index.html` |

New pages must also be added to `build.rollupOptions.input` in `vite.config.js`.

## Where things live

| What | Where |
| --- | --- |
| Shared header, footer, icons, `<head>` bits, process strip | `partials/*.html`, pulled in with `<!-- @include file.html -->` |
| Styles and brand colours (`--accent`, `--navy`, …) | `src/style.css` (tokens at the top), service pages in `src/pages.css` |
| Shared behaviour (smooth scroll, cursor, menu, lightbox, page transitions) | `src/core.js` |
| Home page / service page scripts | `src/main.js` / `src/service.js` |
| Images served by the site | `public/img/` (`photo/`, `design/`, `films/`, `work/`), logos in `public/brand/` |
| Video previews (hover loops) and full reels | `public/video/` and `public/video/full/` |
| Originals, references and AI outputs (not deployed) | `_source/` |
| Phone/tablet preview frames (dev only) | `http://localhost:5173/_dev/mobile.html` |

### Adding more work from Playbook
Images were exported from Eddie's Playbook workspace (`eddievsuals`) as 1400px WebP.
Videos were cut with `scripts/video-previews.py` (6 s muted loop + poster) and full reels
re-encoded to 540p H.264 (~3–9 MB each). The Playbook MCP server is configured for this
project (`claude mcp get playbook`).

### Content to confirm with Eddie
- Hero stats: **150+ projects** and **30+ brands** are placeholders (years is computed from 2017).
- Testimonials were carried over from the old site — check they're current and accurate.
- Reels all link to the main Playbook collection; swap in per-reel links if available.
- The contact form opens the visitor's email app or WhatsApp (no backend). Plug in Formspree/Resend later if wanted.

## Image tools (`scripts/`)

### `gemini-image.mjs` — generate/edit images with Gemini on Vertex AI
Auth uses a Google Cloud service-account file referenced from `.env.local` (git-ignored):

```
GCP_PROJECT_ID=...
GCP_SERVICE_ACCOUNT_FILE=../clutch-ai/supabase/gcp-service-account.json
GEMINI_MODEL=gemini-3-pro-image
GEMINI_LOCATION=global
```

```bash
node scripts/gemini-image.mjs --in photo.png --in ref.jpg --aspect 4:5 --size 2K --n 3 \
  --out _source/generated/name.png --prompt "..."
```

### `face-restore.py` — keep the real face
Gemini redraws faces when extending a photo. This finds the face in the generated image
(SIFT + RANSAC: position, scale and tilt) and blends the original face pixels back in.

```bash
python -I scripts/face-restore.py original.png generated.png out.png --debug check.jpg
```

### `key-green.py` — cut out a green-screen render and grade it black & white
```bash
python -I scripts/key-green.py in.png out.png --lift=0.35
```

Hero pipeline: generate on chroma green → `face-restore.py` → `key-green.py` → export WebP to `public/img/portrait-hero.webp`.
