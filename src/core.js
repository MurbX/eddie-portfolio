/* ==========================================================================
   Shared site behaviour: smooth scroll, header, menu, cursor, page
   transitions, reveals and the lightbox. Every page imports this.
   ========================================================================== */
import 'lenis/dist/lenis.css';
import './style.css';
import './pages.css';

import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(ScrollTrigger, SplitText, Flip);
export { gsap, ScrollTrigger, SplitText, Flip };

export const $ = (s, ctx = document) => ctx.querySelector(s);
export const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

window.__evBooted = true; // tells the inline failsafe in partials/critical.html that we're running

export const root = document.documentElement;
// Styles are in place: after two painted frames, allow CSS transitions again
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('is-booting')));
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ------------------------------------------------------------------
   Opt-in frame benchmark (localStorage 'ev-bench' = '1'). Records every frame's
   duration plus phase markers, and keeps them across page navigations in
   sessionStorage so a full click → transition → next page run can be inspected.
   Off for every normal visitor.
------------------------------------------------------------------ */
const BENCH = (() => { try { return localStorage.getItem('ev-bench') === '1'; } catch { return false; } })();
const bench = { page: location.pathname, frames: [], marks: [] };
export const benchMark = (label) => { if (BENCH) bench.marks.push([Math.round(performance.now()), label]); };
if (BENCH) {
  let last = performance.now();
  const loop = (t) => { bench.frames.push([Math.round(t), Math.round((t - last) * 10) / 10]); last = t; if (t < 15000) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const save = () => {
    try {
      const all = JSON.parse(sessionStorage.getItem('ev-bench-log') || '[]');
      all.push(bench);
      sessionStorage.setItem('ev-bench-log', JSON.stringify(all.slice(-4)));
    } catch { /* ignore */ }
  };
  addEventListener('pagehide', save);
  window.__bench = bench;
}

/* ------------------------------------------------------------------
   Session memory (first visit gets the full preloader)
------------------------------------------------------------------ */
export const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* ------------------------------------------------------------------
   Small content helpers
------------------------------------------------------------------ */
const year = new Date().getFullYear();
$$('[data-year]').forEach((el) => (el.textContent = year));
$$('[data-since]').forEach((el) => {
  const n = year - Number(el.dataset.since);
  el.dataset.count = n;
  el.textContent = n;
});

// Eddie's local time in the header (Nairobi, EAT), refreshed each minute
const timeEl = $('[data-local-time]');
const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false });
const tick = () => {
  timeEl.textContent = fmtTime.format(new Date());
  setTimeout(tick, 60_000 - (Date.now() % 60_000));
};
if (timeEl) tick();

export const imgReady = (img) =>
  !img || img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; });

// Load AND decode an image off the main thread, so its first paint doesn't stall an animation
export const imgDecoded = (img) =>
  !img ? Promise.resolve() : imgReady(img).then(() => (img.decode ? img.decode().catch(() => {}) : undefined));

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a function when the browser is idle (falls back to a short timeout)
export const idle = (timeout = 400) =>
  new Promise((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout }) : setTimeout(r, 1)));

export function countUp(el, delay = 0) {
  const end = Number(el.dataset.count);
  const o = { v: 0 };
  gsap.to(o, { v: end, duration: 2, delay, ease: 'power3.out', onUpdate: () => (el.textContent = Math.round(o.v)) });
}

/* ------------------------------------------------------------------
   Smooth scrolling
------------------------------------------------------------------ */
export let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  // Keep GSAP's default lag smoothing: if the browser stalls (image decode, font swap),
  // animations pause gracefully instead of jumping ahead to catch up.
  gsap.ticker.lagSmoothing(500, 33);
}
export const stopScroll = () => lenis?.stop();
export const startScroll = () => lenis?.start();

export function scrollToTarget(target, immediate = false) {
  const el = target === '#top' ? 0 : $(target);
  if (el === null) return false;
  if (lenis) lenis.scrollTo(el, { duration: 1.4, immediate });
  else if (el === 0) window.scrollTo({ top: 0 });
  else el.scrollIntoView();
  if (el !== 0) {
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
  return true;
}

/* ------------------------------------------------------------------
   Mobile menu
------------------------------------------------------------------ */
const menuBtn = $('.menu-btn');
const mobileMenu = $('#mobile-menu');
export function setMenu(open) {
  root.classList.toggle('menu-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  mobileMenu.inert = !open;
  open ? stopScroll() : startScroll();
}
menuBtn.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && root.classList.contains('menu-open')) setMenu(false);
});

/* ------------------------------------------------------------------
   Page transitions

   Leaving a page:  panels rise → logo, page name and line come in → they lift out
                    again → navigate. The switch between documents therefore happens on
                    five plain panels, which the next page paints identically in its very
                    first frame (partials/critical.html), so there is nothing to flicker.
   Arriving:        the panels sweep away and the page's own intro starts.

   Everything runs through the Web Animations API on transform/opacity only, i.e. on the
   compositor thread, so it stays smooth even while the main thread is busy loading.
------------------------------------------------------------------ */
const curtain = $('.curtain');
const curtainPanels = curtain ? $$('.panels i', curtain) : [];
const curtainContent = curtain ? $('.curtain__content', curtain) : null;
const curtainLabel = $('[data-curtain-label]');

const EASE = {
  inOut: 'cubic-bezier(0.87, 0, 0.13, 1)', // expo.inOut
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',    // expo.out
  in: 'cubic-bezier(0.55, 0, 1, 0.45)',    // power3.in
  soft: 'cubic-bezier(0.65, 0, 0.35, 1)',  // power3.inOut
  // Panels lifting off the new page: moves visibly within the first few frames (expo.inOut
  // sits almost still for ~250 ms, which read as an empty curtain), same long soft landing
  lift: 'cubic-bezier(0.4, 0, 0.1, 1)',
};
const animate = (el, keyframes, options) => el.animate(keyframes, { fill: 'both', ...options });
const allFinished = (anims) => Promise.all(anims.map((a) => a.finished.catch(() => {})));
const cancelAnimations = (els) => els.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
let leaving = false;
// Can the browser carry the curtain's logo, name and lines across the page change
// (cross-document view transitions)? Then the next page moves them out together with its
// panels; otherwise they fade out here before the page changes.
const CARRY = !reduceMotion && 'onpageswap' in window && 'CSSViewTransitionRule' in window;
// Only a curtain navigation is carried; anything else (back/forward, plain links) is instant
addEventListener('pageswap', (e) => { if (e.viewTransition && !root.classList.contains('is-carry')) e.viewTransition.skipTransition(); });

// Arriving page: the carried logo, name and lines leave at the same moment the panels lift,
// the mirror image of how they came in.
function carriedExit() {
  const vt = window.__evVT;
  if (!vt) return;
  window.__evVT = null;
  const old = (name) => `::view-transition-old(${name})`;
  const out = [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-40px)' }];
  const fade = [{ opacity: 1 }, { opacity: 0 }];
  try {
    const anims = [
      root.animate(out, { pseudoElement: old('ev-mark'), duration: 450, easing: EASE.in, fill: 'both' }),
      root.animate(out, { pseudoElement: old('ev-label'), duration: 450, delay: 60, easing: EASE.in, fill: 'both' }),
      root.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { pseudoElement: old('ev-line'), duration: 420, easing: EASE.soft, fill: 'both' }),
      // the seam lines keep travelling (CSS in partials/critical.html) and fade as they go
      ...[1, 2, 3, 4].map((n) => root.animate(fade, { pseudoElement: old(`ev-seam-${n}`), duration: 380, easing: 'linear', fill: 'both' })),
    ];
    allFinished(anims).then(() => vt.skipTransition());
  } catch { vt.skipTransition(); }
}

// Benchmark only: what the arriving page looks like before any script has touched it
if (BENCH && curtain) {
  bench.boot = {
    at: Math.round(performance.now()),
    curtain: getComputedStyle(curtain).visibility,
    panel: getComputedStyle(curtainPanels[0]).transform,
    panelColor: getComputedStyle(curtainPanels[0]).backgroundColor,
    content: getComputedStyle(curtainContent).visibility,
    cursorOpacity: getComputedStyle($('.cursor')).opacity,
    nativeCursor: getComputedStyle(document.body).cursor,
    classes: root.className,
    // anything already animating at boot = something visibly changing as the page loads
    animating: document.getAnimations().map((a) => `${a.transitionProperty || a.animationName || a.constructor.name} on .${a.effect?.target?.className || a.effect?.target?.tagName}`),
  };
}

// Called by each page when its intro has completely finished
const introDoneCallbacks = [];
export function introDone() {
  root.classList.remove('is-intro');
  introDoneCallbacks.forEach((fn) => fn());
}

// Name shown on the curtain for each page
const PAGE_NAMES = {
  '/': 'Portfolio',
  '/services/': 'Services',
  '/services/photography/': 'Photography',
  '/services/videography/': 'Videography',
  '/services/graphic-design/': 'Graphic Design',
  '/services/web-development/': 'Web Development',
};
const pageName = (path) => PAGE_NAMES[path] || PAGE_NAMES[path + '/'] || 'eddieVsuals';
const setLabel = (text) => { if (curtainLabel) curtainLabel.innerHTML = `<span>${text}</span>`; };
// (The arriving page's name is already in its HTML, so nothing is rewritten on load.)

// Wait for n painted frames (lets style/layout/raster settle before an animation starts)
export const nextFrames = (n = 2) =>
  new Promise((r) => { const step = () => (--n <= 0 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step); });

// Promote elements to their own GPU layer *before* they move, so the first frame of the
// animation doesn't have to rasterise them (the classic "stutter, then it moves").
export async function prepareLayers(targets) {
  gsap.set(targets, { willChange: 'transform, opacity', force3D: true });
  await nextFrames(2);
}

export function hideCurtainNow() {
  if (curtain) curtain.style.visibility = 'hidden';
  // Nothing carried over from the last page may outlive the curtain
  if (window.__evVT) { const vt = window.__evVT; window.__evVT = null; try { vt.skipTransition(); } catch { /* already over */ } }
}

// Arriving: the plain panels sweep up in a wave. `onPanels` fires as they start moving
// (used to start the page's own intro underneath).
export async function curtainOut(onPanels) {
  if (!curtain || reduceMotion) { hideCurtainNow(); onPanels?.(); return; }
  await nextFrames(2); // let the page's setup work paint before anything moves
  if (leaving) return;
  benchMark('curtainOut:start');
  carriedExit(); // same frame as the panels: words, lines and panels leave together
  const anims = curtainPanels.map((p, i) =>
    animate(p, [{ transform: 'translateY(0)' }, { transform: 'translateY(-101%)' }], { duration: 900, delay: i * 60, easing: EASE.lift }));
  setTimeout(() => onPanels?.(), 150);
  await allFinished(anims);
  if (leaving) return; // a new transition took over the curtain meanwhile
  hideCurtainNow();
  benchMark('curtainOut:end');
}

// Leaving: panels rise → logo, destination name and line come in → hold → they lift out.
// Resolves on five plain panels, ready to navigate.
async function curtainIn(path) {
  if (!curtain || reduceMotion) return;
  leaving = true;
  setLabel(pageName(path));
  // Nothing under the curtain needs to keep running: drop the grain and custom cursor and
  // pause playing videos, so the GPU only has the curtain itself to draw
  root.classList.add('is-transition');
  root.classList.toggle('is-carry', CARRY);
  $$('video').forEach((v) => v.pause());
  const started = performance.now();
  const HOLD = 1650; // ms after the click at which the exit begins / the page changes

  const mark = $('.curtain__mark', curtain);
  const label = $('.curtain__label', curtain);
  const line = $('.curtain__line', curtain);
  const seams = $$('.curtain__seams b', curtain);
  cancelAnimations([...curtainPanels, curtainContent, mark, label, line, ...seams]);

  // Each seam line: which end it enters from, and how long it takes to travel the whole
  // seam. They never stop: each keeps moving until it has left the other end (or the block
  // has faded out). Different speeds and start times so no two look alike.
  const SEAMS = [
    { from: 'bottom', duration: 1750, delay: 430 },
    { from: 'top',    duration: 2050, delay: 520 },
    { from: 'bottom', duration: 1900, delay: 640 },
    { from: 'top',    duration: 2250, delay: 580 },
  ];

  const rise = [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'translateY(0)' }];
  // 3. a short line travels the full length of each seam at a steady pace, without
  //    stopping: two go bottom → top, two go top → bottom. Not awaited below: they are
  //    still travelling when the block fades out, and waiting for them to finish unseen
  //    left the curtain empty for most of a second before the page changed.
  seams.forEach((b, i) => {
    const s = SEAMS[i % SEAMS.length];
    const below = 'translateY(101vh)';
    const above = 'translateY(-101%)';
    animate(b, s.from === 'bottom' ? [{ transform: below }, { transform: above }] : [{ transform: above }, { transform: below }],
      { duration: s.duration, delay: s.delay, easing: 'linear' });
  });
  const anims = [
    // 1. panels rise in a wave (done at ~950 ms)
    ...curtainPanels.map((p, i) =>
      animate(p, [{ transform: 'translateY(101%)' }, { transform: 'translateY(0)' }], { duration: 750, delay: i * 50, easing: EASE.inOut })),
    // 2. logo, page name, orange line
    animate(mark, rise, { duration: 700, delay: 480, easing: EASE.out }),
    animate(label, rise, { duration: 700, delay: 560, easing: EASE.out }),
    animate(line, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 600, delay: 640, easing: EASE.soft }),
  ];
  // 4. The exit. Normally it is NOT played here: the page changes while everything is still
  //    on screen, and the next page moves it all out as its panels lift (carriedExit).
  //    Browsers that can't carry it across fade the whole block out first, as one layer.
  if (!CARRY) {
    anims.push(animate(curtainContent, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-30px)' }], { duration: 400, delay: HOLD, easing: EASE.in }));
  }
  // Start states are already applied (fill: both), so showing the curtain can't flash
  curtainContent.style.visibility = 'visible';
  curtain.style.visibility = 'visible';
  benchMark('curtainIn:start');
  await allFinished(anims);
  if (CARRY) await wait(Math.max(0, HOLD - (performance.now() - started))); // the name stays readable for a beat
  else await nextFrames(2); // make sure the fully faded, plain-panel frame is on screen before leaving
  benchMark('curtainIn:end');
}

// Fetch the next page while the curtain animates, so it opens instantly
const prefetched = new Set();
function prefetch(path) {
  if (prefetched.has(path)) return;
  prefetched.add(path);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = path;
  document.head.appendChild(link);
}
document.addEventListener('pointerover', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a || a.target === '_blank') return;
  const url = new URL(a.href, location.href);
  if (url.origin === location.origin && url.pathname !== location.pathname) prefetch(url.pathname);
}, { passive: true });

// Restored from the back/forward cache: never leave the curtain covering the page
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  leaving = false;
  hideCurtainNow();
  root.classList.remove('is-transition', 'is-intro');
  $$('.s-hero__media video').forEach((v) => v.play().catch(() => {}));
});

/* ------------------------------------------------------------------
   Links: smooth-scroll same-page anchors, transition to other pages
------------------------------------------------------------------ */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-lightbox') || a.hasAttribute('data-no-transition')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;

  const samePage = url.pathname === location.pathname;
  if (samePage && url.hash) {
    if ($(url.hash) || url.hash === '#top') {
      e.preventDefault();
      if (root.classList.contains('menu-open')) setMenu(false);
      scrollToTarget(url.hash);
    }
    return;
  }
  if (samePage && !url.hash) {
    e.preventDefault();
    scrollToTarget('#top');
    return;
  }
  e.preventDefault();
  if (leaving) return; // a transition is already running
  if (root.classList.contains('menu-open')) setMenu(false);
  prefetch(url.pathname);
  curtainIn(url.pathname).then(() => (location.href = url.href));
});

/* ------------------------------------------------------------------
   Header: hide on scroll down, reveal on scroll up, active link
------------------------------------------------------------------ */
const header = $('.header');
let lastY = 0;
function onScrollHeader(y) {
  header.classList.toggle('is-scrolled', y > 40);
  if (!root.classList.contains('menu-open')) header.classList.toggle('is-hidden', y > lastY && y > 400);
  lastY = y;
}
if (lenis) lenis.on('scroll', ({ scroll }) => onScrollHeader(scroll));
else addEventListener('scroll', () => onScrollHeader(scrollY), { passive: true });
header.addEventListener('focusin', () => header.classList.remove('is-hidden'));

/* ------------------------------------------------------------------
   Scroll indicator: stands in for the native scrollbar, which is hidden so the
   curtain and loader can cover the full width of the window
------------------------------------------------------------------ */
const scrollbar = $('.scrollbar');
if (scrollbar) {
  const thumb = scrollbar.firstElementChild;
  let track = 0;
  let size = 0;
  let max = 0;
  let hideTimer = 0;
  const place = (y) => {
    if (max > 0) thumb.style.transform = `translateY(${(Math.min(Math.max(y, 0), max) / max) * (track - size)}px)`;
  };
  const measure = () => {
    max = root.scrollHeight - innerHeight;
    track = scrollbar.clientHeight;
    size = max > 0 ? Math.max(48, track * (innerHeight / root.scrollHeight)) : 0;
    thumb.style.height = `${size}px`;
    place(scrollY);
  };
  const onScrollBar = (y) => {
    if (max <= 0) return;
    place(y);
    scrollbar.classList.add('is-active');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => scrollbar.classList.remove('is-active'), 900);
  };
  new ResizeObserver(measure).observe(document.body);
  addEventListener('resize', measure);
  if (lenis) lenis.on('scroll', ({ scroll }) => onScrollBar(scroll));
  else addEventListener('scroll', () => onScrollBar(scrollY), { passive: true });
}

// Page-level active state (Services / Films)
const path = location.pathname;
$$('[data-nav]').forEach((link) => {
  const key = link.dataset.nav;
  if (key === 'films' && path.startsWith('/services/videography')) link.classList.add('is-active');
  else if (key === 'services' && path.startsWith('/services') && !path.startsWith('/services/videography')) link.classList.add('is-active');
});
// Section-level active state on pages that contain the sections
export function initSectionNav() {
  $$('[data-nav]').forEach((link) => {
    const section = document.getElementById(link.dataset.nav);
    if (!section) return;
    ScrollTrigger.create({
      trigger: section, start: 'top 50%', end: 'bottom 50%',
      onToggle: ({ isActive }) => link.classList.toggle('is-active', isActive),
    });
  });
}

/* ------------------------------------------------------------------
   Custom cursor
------------------------------------------------------------------ */
export function initCursor() {
  if (!finePointer || reduceMotion) return;
  const cursor = $('.cursor');
  const dot = $('.cursor__dot');
  const ring = $('.cursor__ring');
  const label = $('.cursor__label');
  root.classList.add('has-cursor');

  // Pick up where the pointer was on the previous page, so the cursor never jumps to a
  // corner (or vanishes until the mouse moves) after a page transition
  let px = -1, py = -1;
  const saved = (session.get('ev-cursor') || '').split(',').map(Number);
  if (saved.length === 2 && saved.every(Number.isFinite)) [px, py] = saved;
  gsap.set([dot, ring], px >= 0 ? { x: px, y: py } : { x: -100, y: -100 });
  addEventListener('pagehide', () => { if (px >= 0) session.set('ev-cursor', `${px},${py}`); });

  const dx = gsap.quickTo(dot, 'x', { duration: 0.08 });
  const dy = gsap.quickTo(dot, 'y', { duration: 0.08 });
  const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3' });
  const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3' });

  const setState = (target) => {
    const labelled = target?.closest?.('[data-cursor]');
    const interactive = target?.closest?.('a, button, label, input, textarea, summary, .svc');
    cursor.classList.toggle('is-label', !!labelled);
    cursor.classList.toggle('is-hover', !labelled && !!interactive);
    if (labelled) label.textContent = labelled.dataset.cursor;
  };

  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    dx(px); dy(py); rx(px); ry(py);
    cursor.classList.remove('is-hidden');
  });
  document.addEventListener('pointerleave', () => cursor.classList.add('is-hidden'));
  document.addEventListener('pointerover', (e) => setState(e.target));

  // Content moves under a still mouse while scrolling: re-check what's beneath it
  const recheck = () => { if (px >= 0) setState(document.elementFromPoint(px, py)); };
  introDoneCallbacks.push(recheck); // the cursor fades back in once the page is revealed
  if (lenis) lenis.on('scroll', recheck);
  else addEventListener('scroll', recheck, { passive: true });
}

/* ------------------------------------------------------------------
   Magnetic elements
------------------------------------------------------------------ */
export function initMagnetic() {
  if (!finePointer || reduceMotion) return;
  $$('[data-magnetic]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.3);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.3);
    });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
}

/* ------------------------------------------------------------------
   Scroll reveals
------------------------------------------------------------------ */
export function initSplitHeadings() {
  $$('[data-split]').forEach((el) => {
    SplitText.create(el, {
      type: 'lines', mask: 'lines', autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 110, duration: 1.3, ease: 'expo.out', stagger: 0.1,
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        });
      },
    });
  });
}

export function initReveals() {
  const items = $$('[data-reveal]');
  gsap.set(items, { y: 40, opacity: 0 });
  ScrollTrigger.batch(items, {
    start: 'top 90%', once: true,
    onEnter: (batch) => gsap.to(batch, { y: 0, opacity: 1, duration: 1.1, ease: 'expo.out', stagger: 0.07, overwrite: true }),
  });
  $$('.section-bar__rule').forEach((rule) =>
    gsap.from(rule, { scaleX: 0, duration: 1.4, ease: 'expo.inOut', scrollTrigger: { trigger: rule, start: 'top 90%', once: true } })
  );
  $$('.section-bar__title').forEach((t) =>
    gsap.from(t, { yPercent: 60, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: t, start: 'top 90%', once: true } })
  );
  gsap.from('.footer__wordmark img', {
    yPercent: 40, opacity: 0, duration: 1.4, ease: 'expo.out',
    scrollTrigger: { trigger: '.footer__wordmark', start: 'top 95%', once: true },
  });
}

// The zoom-out that goes with an image reveal: from `from` down to the size the stylesheet
// gives the image at rest. Two things matter here:
//  - explicit start AND end values. These images also have a CSS transition on transform
//    (their hover zoom); with a plain `from()` GSAP read the end value while that transition
//    was still holding the zoomed size, so every image stayed zoomed in and lost its top
//    edge (cut-off heads).
//  - the transition is switched off for the duration and the inline styles are cleared at
//    the end, so the stylesheet (rest size, hover zoom) takes over again.
export function revealZoom(tl, img, from, to = 1, at = 0.15) {
  gsap.set(img, { transition: 'none' });
  tl.fromTo(img, { scale: from }, { scale: to, duration: 1.6, ease: 'expo.out', clearProps: 'transform,transition' }, at);
}

// Images clip-reveal as they scroll in
export function initImageReveals(selector) {
  $$(selector).forEach((media) => {
    const img = $('img, video', media);
    const tl = gsap.timeline({ scrollTrigger: { trigger: media, start: 'top 90%', once: true } });
    tl.from(media, { clipPath: 'inset(100% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut' });
    if (img) revealZoom(tl, img, 1.3);
  });
}

/* ------------------------------------------------------------------
   Lightbox: any [data-lightbox] link inside a [data-gallery]
------------------------------------------------------------------ */
export function initLightbox() {
  const dlg = $('.lightbox');
  if (!dlg) return;
  const img = $('img', dlg);
  const title = $('.lightbox__title', dlg);
  const sub = $('.lightbox__sub', dlg);
  const count = $('.lightbox__count', dlg);
  let list = [];
  let index = 0;

  const meta = (a) => {
    const card = a.closest('.card');
    return {
      title: a.dataset.title || card?.querySelector('h3')?.textContent || '',
      sub: a.dataset.sub || card?.querySelector('.card__text p')?.textContent || '',
      alt: a.querySelector('img')?.alt || '',
    };
  };
  const show = (i) => {
    index = (i + list.length) % list.length;
    const a = list[index];
    const m = meta(a);
    gsap.fromTo(img, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' });
    img.src = a.getAttribute('href');
    img.alt = m.alt;
    title.textContent = m.title;
    sub.textContent = m.sub;
    count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-lightbox]');
    if (!a) return;
    e.preventDefault();
    const scope = a.closest('[data-gallery]') || document;
    list = $$('[data-lightbox]', scope).filter((el) => el.offsetParent !== null);
    show(list.indexOf(a));
    dlg.showModal();
    stopScroll();
  });
  $('.lightbox__close', dlg).addEventListener('click', () => dlg.close());
  $('.lightbox__nav--prev', dlg).addEventListener('click', () => show(index - 1));
  $('.lightbox__nav--next', dlg).addEventListener('click', () => show(index + 1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
  dlg.addEventListener('close', startScroll);

  let sx = null;
  dlg.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
  dlg.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const d = e.changedTouches[0].clientX - sx;
    if (Math.abs(d) > 50) show(index + (d < 0 ? 1 : -1));
    sx = null;
  });
}

/* ------------------------------------------------------------------
   Infinite marquees ([data-marquee] containing .marquee__track)
------------------------------------------------------------------ */
export function initMarquees(selector = '.ticker__row, [data-marquee]') {
  const rows = $$(selector);
  const tweens = rows.map((row) => {
    const track = $('.ticker__track, .marquee__track', row);
    const dir = Number(row.dataset.dir) || 1;
    const dur = Number(row.dataset.speed) || 36;
    return dir > 0
      ? gsap.fromTo(track, { xPercent: 0 }, { xPercent: -50, duration: dur, ease: 'none', repeat: -1, paused: true })
      : gsap.fromTo(track, { xPercent: -50 }, { xPercent: 0, duration: dur * 0.85, ease: 'none', repeat: -1, paused: true });
  });
  if (!tweens.length || reduceMotion) return;
  // Only run while on screen: off-screen marquees still cost GPU time every frame
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    const t = tweens[rows.indexOf(e.target)];
    e.isIntersecting ? t.play() : t.pause();
  }), { rootMargin: '100px 0px' });
  rows.forEach((r) => io.observe(r));
  let reset;
  ScrollTrigger.create({
    onUpdate(self) {
      const boost = 1 + Math.min(Math.abs(self.getVelocity()) / 250, 5);
      tweens.forEach((t) => gsap.to(t, { timeScale: boost, duration: 0.2, overwrite: true }));
      clearTimeout(reset);
      reset = setTimeout(() => tweens.forEach((t) => gsap.to(t, { timeScale: 1, duration: 0.8, overwrite: true })), 120);
    },
  });
}

/* Shared boot for every page */
initCursor();
initLightbox();
