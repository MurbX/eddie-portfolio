#!/usr/bin/env node
/**
 * Generate or edit images with Gemini (Vertex AI) from the command line.
 *
 * Auth: a Google Cloud service-account JSON (path in .env.local) is exchanged
 * for an OAuth token, so no API key is stored in this repo.
 *
 * Usage:
 *   node scripts/gemini-image.mjs --prompt "..." [--in photo.png ...] \
 *        [--out _source/generated/name.png] [--aspect 4:5] [--size 2K] [--n 1]
 *
 *   --in      reference image(s); repeat the flag for several (png/jpg/webp)
 *   --aspect  1:1 · 3:4 · 4:3 · 4:5 · 5:4 · 9:16 · 16:9 · 21:9 · 2:3 · 3:2
 *   --size    1K · 2K · 4K
 *   --n       number of variations (separate requests)
 *   --text 1  also return the model's text notes (may lower output resolution)
 *
 * Settings (.env.local):
 *   GCP_PROJECT_ID, GCP_SERVICE_ACCOUNT_FILE, GEMINI_MODEL, GEMINI_LOCATION
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, extname, resolve, basename } from 'node:path';
import { createSign } from 'node:crypto';

/* ---------- env ---------- */
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(resolve('.env.local'));

/* ---------- args ---------- */
const args = { in: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, '');
  const val = argv[i + 1];
  if (key === 'in') args.in.push(val);
  else args[key] = val;
  i++;
}
if (!args.prompt) {
  console.error('Missing --prompt. See the header of this file for usage.');
  process.exit(1);
}
const aspect = args.aspect || '1:1';
const size = args.size || '2K';
const count = Math.max(1, Number(args.n) || 1);
const outBase = args.out || `_source/generated/gemini-${Date.now()}.png`;

/* ---------- auth ---------- */
async function accessToken() {
  const saPath = process.env.GCP_SERVICE_ACCOUNT_FILE;
  if (!saPath || !existsSync(saPath)) throw new Error('GCP_SERVICE_ACCOUNT_FILE is missing or not found (set it in .env.local).');
  const sa = JSON.parse(readFileSync(saPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64u = (s) => Buffer.from(s).toString('base64url');
  const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${body.error_description || body.error}`);
  return { token: body.access_token, projectFromSa: sa.project_id };
}

/* ---------- call ---------- */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

async function generate(token, project) {
  const location = process.env.GEMINI_LOCATION || 'global';
  const model = process.env.GEMINI_MODEL || 'gemini-3-pro-image';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const parts = [{ text: args.prompt }];
  args.in.forEach((file, i) => {
    const mimeType = MIME[extname(file).toLowerCase()];
    if (!mimeType) throw new Error(`Unsupported image type: ${file}`);
    parts.push({ text: `Image ${i + 1}: ${basename(file)}` });
    parts.push({ inlineData: { mimeType, data: readFileSync(file).toString('base64') } });
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: Number(args.temperature ?? 1),
        // IMAGE-only keeps the requested imageSize; add --text 1 to also get the model's notes
        responseModalities: args.text ? ['TEXT', 'IMAGE'] : ['IMAGE'],
        imageConfig: { aspectRatio: aspect, imageSize: size },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Vertex error ${res.status}: ${body?.error?.message || JSON.stringify(body).slice(0, 400)}`);

  const out = body?.candidates?.[0]?.content?.parts ?? [];
  const image = out.find((p) => p.inlineData?.data);
  const text = out.filter((p) => p.text).map((p) => p.text).join(' ').trim();
  if (!image) {
    const reason = body?.candidates?.[0]?.finishReason || body?.promptFeedback?.blockReason || 'no image returned';
    throw new Error(`Gemini returned no image (${reason}). ${text}`);
  }
  return { data: Buffer.from(image.inlineData.data, 'base64'), mime: image.inlineData.mimeType, text };
}

/* ---------- run ---------- */
const { token, projectFromSa } = await accessToken();
const project = process.env.GCP_PROJECT_ID || projectFromSa;
mkdirSync(dirname(outBase), { recursive: true });

const ext = extname(outBase) || '.png';
const stem = outBase.slice(0, outBase.length - ext.length);
const jobs = Array.from({ length: count }, (_, i) => i);

console.log(`Generating ${count} image(s) · ${aspect} · ${size} · ${process.env.GEMINI_MODEL || 'gemini-3-pro-image'}`);
const results = await Promise.allSettled(jobs.map(() => generate(token, project)));
results.forEach((r, i) => {
  const file = count === 1 ? `${stem}${ext}` : `${stem}-${i + 1}${ext}`;
  if (r.status === 'fulfilled') {
    writeFileSync(file, r.value.data);
    console.log(`✔ ${file}${r.value.text ? `  — ${r.value.text.slice(0, 160)}` : ''}`);
  } else {
    console.error(`✘ variation ${i + 1}: ${r.reason.message}`);
  }
});
if (results.every((r) => r.status === 'rejected')) process.exit(1);
