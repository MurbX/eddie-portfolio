#!/usr/bin/env node
/**
 * Record the whole intro / page-transition flow frame by frame.
 *
 * Drives a hidden copy of the installed Chrome through:
 *   first visit (loader) → click Services → click Films → click the logo (home)
 * and saves every frame the browser paints, with timestamps, plus the moments of each
 * click and each page switch. `scripts/frames-sheet.py` turns that into contact sheets.
 *
 * Usage:
 *   node scripts/record-flow.mjs [baseUrl] [label]
 *   node scripts/record-flow.mjs http://localhost:5173 dev
 *   node scripts/record-flow.mjs http://localhost:4173 prod
 * Output: _source/recordings/<label>-<time>/  (frames + frames.json)
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const label = process.argv[3] || 'run';
const out = join('_source', 'recordings', `${label}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(out, { recursive: true });

// Options (environment variables):
//   W, H, DPR   viewport size and pixel density (default 1440 x 810 @1)
//   FULLRES=1   save frames at full device resolution (needed to see 1px details)
//   ONLY=films  record just one transition (Services → Films) instead of the whole flow
//   GAPS=1      test only: restore the old hairline gaps between the curtain panels
const VIEW = { width: Number(process.env.W) || 1440, height: Number(process.env.H) || 810 };
const DPR = Number(process.env.DPR) || 1;
const FULL = process.env.FULLRES === '1';
// HEADED=1 opens a real, visible Chrome window (uses the real graphics card, so it shows
// GPU-only artefacts that the hidden browser does not)
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1' });
// MOBILE=1 emulates a phone (touch, mobile viewport); ONLY=loader records just the first-visit loader
const MOBILE = process.env.MOBILE === '1';
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, isMobile: MOBILE, hasTouch: MOBILE });
if (process.env.GAPS === '1') {
  await context.addInitScript(() => {
    const css = '.panels i{flex:1 1 0% !important;margin-right:0 !important;box-shadow:none !important;border-right:1px solid rgba(241,236,228,.05) !important}.panels i:last-child{border-right:0 !important}.curtain__streaks{display:none !important}';
    const add = () => { const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); };
    if (document.head) add(); else new MutationObserver((_, o) => { if (document.head) { add(); o.disconnect(); } }).observe(document.documentElement, { childList: true });
    addEventListener('DOMContentLoaded', add);
  });
}
if (process.env.ONLY === 'films') await context.addInitScript(() => { try { sessionStorage.setItem('ev-visited', '1'); } catch {} });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

const frames = [];
const events = [];
const mark = (name) => events.push({ name, t: Date.now() });

let n = 0;
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const name = `${String(n++).padStart(5, '0')}.jpg`;
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
  frames.push({ name, t: Math.round(metadata.timestamp * 1000) });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
page.on('framenavigated', (f) => { if (f === page.mainFrame()) mark(`page-switch ${new URL(f.url()).pathname}`); });
page.on('pageerror', (e) => mark(`ERROR ${e.message}`));

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: FULL ? 92 : 80, maxWidth: VIEW.width * (FULL ? DPR : 1), maxHeight: VIEW.height * (FULL ? DPR : 1), everyNthFrame: 1 });

// The page's own script has started AND its intro has completely finished
const introDone = () => page.waitForFunction(
  () => window.__evBooted === true && document.readyState === 'complete' && !document.documentElement.classList.contains('is-intro'),
  null, { timeout: 30000 });

async function clickLink(selector, name, path) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await page.waitForTimeout(350);
  mark(`click ${name}`);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForURL(`${base}${path}`, { waitUntil: 'commit', timeout: 20000 });
  await introDone();
  mark(`intro-done ${name}`);
  await page.waitForTimeout(700);
}

if (process.env.ONLY === 'films') {
  await page.mouse.move(700, 420);
  await page.goto(`${base}/services/`, { waitUntil: 'commit' });
  await introDone();
  await page.waitForTimeout(700);
  await clickLink('.nav a[href="/services/videography/"]', 'Films', '/services/videography/');
} else {
  // 1. First visit: the loader
  await page.mouse.move(700, 420);
  mark('open home (first visit)');
  await page.goto(`${base}/`, { waitUntil: 'commit' });
  await introDone();
  mark('intro-done home');
  await page.waitForTimeout(700);

  // 2. Page transitions
  if (process.env.ONLY === 'loader') { /* loader only */ } else {
  await clickLink('.nav a[href="/services/"]', 'Services', '/services/');
  await clickLink('.nav a[href="/services/videography/"]', 'Films', '/services/videography/');
  await clickLink('.brand', 'Home', '/');
  }

}

await cdp.send('Page.stopScreencast');
await browser.close();

writeFileSync(join(out, 'frames.json'), JSON.stringify({ base, view: VIEW, frames, events }, null, 1));
const secs = ((frames.at(-1).t - frames[0].t) / 1000).toFixed(1);
console.log(`${frames.length} frames over ${secs}s → ${out}`);
events.forEach((e) => console.log(`  +${String(e.t - frames[0].t).padStart(6)} ms  ${e.name}`));
