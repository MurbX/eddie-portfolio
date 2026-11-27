/* Home page */
import {
  gsap, ScrollTrigger, Flip, $, $$, root, reduceMotion, finePointer, session,
  stopScroll, startScroll, scrollToTarget, imgDecoded, countUp, wait, idle,
  curtainOut, hideCurtainNow, prepareLayers, benchMark, introDone, initMagnetic, initSplitHeadings, initReveals,
  initSectionNav, initMarquees, revealZoom,
} from './core.js';

/* ------------------------------------------------------------------
   Hero word: stretch "PORTFOLIO" vertically so it fills ~58% of the
   viewport height on desktop (the poster look from the reference)
------------------------------------------------------------------ */
const wordInner = $('.hero__word-inner');
function fitHeroWord() {
  if (innerWidth < 1024) { wordInner.style.removeProperty('--word-sy'); return; }
  const natural = wordInner.offsetHeight;
  const target = Math.max(innerHeight, 720) * 0.58;
  wordInner.style.setProperty('--word-sy', gsap.utils.clamp(1, 1.9, target / natural).toFixed(3));
}
fitHeroWord();
document.fonts.ready.then(fitHeroWord);
addEventListener('resize', fitHeroWord);

/* ------------------------------------------------------------------
   Preloader (first visit per session) + hero intro
------------------------------------------------------------------ */
function heroIntro() {
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.from('.hero__word-inner > span', { yPercent: 105, duration: 1.5, stagger: 0.05 })
    // opacity + translate only: cheap to composite on a large masked image
    .from('.hero__portrait', { opacity: 0, yPercent: 6, duration: 1.8, ease: 'power3.out' }, 0.15)
    .from('.header', { yPercent: -100, opacity: 0, duration: 1.1, clearProps: 'transform,opacity' }, 0.5)
    .from('.hero__hello', { opacity: 0, x: -24, duration: 1.2 }, 0.6)
    .from('.hero__name .line > span', { yPercent: 110, duration: 1.3, stagger: 0.1 }, 0.65)
    .from('.hero__role, .hero__lede, .hero__loc', { opacity: 0, y: 24, duration: 1.1, stagger: 0.08 }, 0.9)
    .from('.hero__tagline, .stats li', { opacity: 0, y: 28, duration: 1.1, stagger: 0.08 }, 1)
    .from('.scroll-cue', { opacity: 0, duration: 1 }, 1.4)
    .add(() => $$('.stats [data-count]').forEach((el, i) => countUp(el, i * 0.1)), 1);
  return tl;
}

// Resolves when the intro (and the hero animation) has fully finished
async function intro() {
  const loader = $('.loader');
  // Fonts + a pre-decoded hero portrait, so neither stalls an animation mid-way
  const ready = Promise.all([document.fonts.ready, imgDecoded($('.hero__portrait img'))]);
  const firstVisit = !session.get('ev-visited');
  session.set('ev-visited', '1');

  if (reduceMotion) {
    loader?.remove();
    hideCurtainNow();
    await ready;
    return;
  }

  // Arriving from another page (or a deep link): short curtain instead of the loader
  if (!firstVisit || location.hash) {
    loader?.remove();
    await ready;
    if (location.hash) scrollToTarget(location.hash, true);
    // Build the hero animation (and render its start state) while the curtain still covers it,
    // then start it once the panels are already moving.
    const hero = location.hash ? null : heroIntro().pause();
    await curtainOut(() => hero?.play());
    if (hero) await hero.then();
    return;
  }

  hideCurtainNow();
  root.classList.add('is-loading');
  stopScroll();

  // Start only once the logo images are decoded and the fonts are in (capped, so a slow
  // network never leaves a blank screen); otherwise the first frames stutter.
  await Promise.race([
    Promise.all([document.fonts.ready, imgDecoded($('.loader__mark img')), imgDecoded($('.loader__word img'))]),
    wait(1200),
  ]);

  benchMark('loader:enter');
  // 1. Logo reveals bottom-up, signature writes in left-to-right, line fills
  const enter = gsap.timeline({ defaults: { ease: 'expo.inOut' } })
    .fromTo('.loader__mark', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2 })
    .fromTo('.loader__mark img', { scale: 1.4 }, { scale: 1, duration: 1.4, ease: 'expo.out' }, 0)
    .fromTo('.loader__word', { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3 }, 0.35)
    .to('.loader__bar span', { scaleX: 1, duration: 2.2, ease: 'power2.inOut' }, 0.2)
    .fromTo('.loader__foot', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' }, 0.3);

  // 2. Disciplines flick past along the bottom
  // (slot-machine swap: the old word pushes up as the new one rises, in sync)
  const roles = gsap.timeline();
  const words = $$('.loader__roles span');
  gsap.set(words, { yPercent: 110, visibility: 'visible' });
  words.forEach((s, i) => {
    const t = 0.25 + i * 0.6;
    roles.to(s, { yPercent: 0, duration: 0.5, ease: 'expo.inOut' }, t);
    if (i > 0) roles.to(words[i - 1], { yPercent: -110, duration: 0.5, ease: 'expo.inOut' }, t);
  });

  await Promise.all([ready, enter.then(), roles.then()]);

  // 3. Hand-off. Everything expensive happens here, while nothing on screen is moving:
  //    - build the hero animation now (its start state renders behind the panels),
  //    - drop the clip-paths (they'd otherwise be repainted every frame of the fade),
  //    - give the pieces that are about to move their own GPU layers,
  //    - let two frames paint, so the first frame of the exit has nothing left to do.
  const hero = heroIntro().pause();
  const center = $('.loader__center');
  const foot = $('.loader__foot');
  const panels = $$('.loader .panels i');
  gsap.set(['.loader__mark', '.loader__word'], { clipPath: 'none' });
  await prepareLayers([center, foot, ...panels]);

  benchMark('loader:exit');
  // 4. Content lifts out (as two layers), panels sweep away in a wave into the hero
  await gsap.timeline()
    .to([center, foot], { y: -40, opacity: 0, duration: 0.5, ease: 'power3.in', stagger: 0.05 })
    .to(panels, { yPercent: -100, duration: 1, ease: 'expo.inOut', stagger: 0.07 }, 0.25)
    .add(() => hero.play(), 0.75)
    .then();
  loader.remove();
  root.classList.remove('is-loading');
  await hero.then();
  benchMark('hero:end');
}

/* ------------------------------------------------------------------
   Sections
------------------------------------------------------------------ */
function initHeroScroll() {
  const st = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true };
  gsap.matchMedia().add('(min-width: 1024px)', () => {
    gsap.to('.hero__word', { yPercent: 28, ease: 'none', scrollTrigger: st });
    gsap.to('.hero__portrait img', { yPercent: 10, scale: 1.06, ease: 'none', scrollTrigger: st });
    gsap.to('.hero__intro', { yPercent: -30, opacity: 0, ease: 'none', scrollTrigger: { ...st, end: '80% top' } });
    gsap.to('.hero__aside', { yPercent: -18, opacity: 0, ease: 'none', scrollTrigger: { ...st, end: '80% top' } });

    const hero = $('.hero');
    const wx = gsap.quickTo('.hero__word-inner > span', 'x', { duration: 1.2, ease: 'power3' });
    const px = gsap.quickTo('.hero__portrait', 'xPercent', { duration: 1.4, ease: 'power3' });
    const gx = gsap.quickTo('.hero__glow', 'x', { duration: 2, ease: 'power3' });
    const onMove = (e) => { const n = e.clientX / innerWidth - 0.5; wx(n * -24); px(n * 1.2); gx(n * 120); };
    hero.addEventListener('pointermove', onMove);
    return () => hero.removeEventListener('pointermove', onMove);
  });
}

function initWorkCards() {
  $$('.card').forEach((card) => {
    const media = $('.card__media', card);
    const tl = gsap.timeline({ scrollTrigger: { trigger: card, start: 'top 88%', once: true } });
    tl.from(media, { clipPath: 'inset(100% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut' });
    revealZoom(tl, $('img', media), 1.35, 1.02); // 1.02 = the image's rest size in style.css
    tl.from($('.card__meta', card), { opacity: 0, y: 20, duration: 0.9, ease: 'expo.out' }, 0.6);
  });
}

function initServices() {
  const list = $('.svc-list');
  const items = $$('.svc', list);
  gsap.from(items, { opacity: 0, y: 50, duration: 1.1, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: list, start: 'top 85%', once: true } });
  if (!finePointer) return;

  const preview = $('.svc-preview');
  const img = $('img', preview);
  items.forEach((li) => { const i = new Image(); i.src = li.dataset.img; });
  gsap.set(preview, { xPercent: -50, yPercent: -50 });
  const xTo = gsap.quickTo(preview, 'x', { duration: 0.7, ease: 'power3' });
  const yTo = gsap.quickTo(preview, 'y', { duration: 0.7, ease: 'power3' });
  const rTo = gsap.quickTo(preview, 'rotation', { duration: 0.8, ease: 'power3' });
  let px = 0;
  list.addEventListener('pointermove', (e) => {
    xTo(e.clientX + 140); yTo(e.clientY);
    rTo(gsap.utils.clamp(-12, 12, (e.clientX - px) * 0.6));
    px = e.clientX;
  });
  items.forEach((li) => li.addEventListener('pointerenter', () => {
    if (img.getAttribute('src') !== li.dataset.img) {
      img.src = li.dataset.img;
      gsap.fromTo(img, { scale: 1.25 }, { scale: 1, duration: 0.8, ease: 'expo.out' });
    }
  }));
  list.addEventListener('pointerenter', () => gsap.to(preview, { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'expo.out' }));
  list.addEventListener('pointerleave', () => gsap.to(preview, { autoAlpha: 0, scale: 0.8, duration: 0.4, ease: 'power2.in' }));
}

function initReels() {
  gsap.matchMedia().add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
    const track = $('.reels__track');
    const distance = () => Math.max(0, track.scrollWidth - innerWidth);
    gsap.to(track, {
      x: () => -distance(), ease: 'none',
      scrollTrigger: { trigger: '.reels', start: 'top top', end: () => '+=' + distance(), pin: '.reels__pin', scrub: 1, invalidateOnRefresh: true },
    });
  });
}

function initProcess() {
  const process = $('.process');
  gsap.fromTo(process, { '--progress': 0 }, { '--progress': 1, ease: 'none', scrollTrigger: { trigger: process, start: 'top 75%', end: 'bottom 60%', scrub: true } });
  gsap.from('.process__step', { opacity: 0, x: -30, duration: 1, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: process, start: 'top 80%', once: true } });
}

function initParallax() {
  gsap.to('.testimonials__bg', { yPercent: 12, ease: 'none', scrollTrigger: { trigger: '.testimonials', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.from('.post', { opacity: 0, y: 60, duration: 1, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: '.feed__track', start: 'top 88%', once: true } });
}

function initFilters() {
  const cards = $$('.card');
  const buttons = $$('.filter');
  const counter = $('[data-work-count]');
  buttons.forEach((btn) => btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    buttons.forEach((b) => { const on = b === btn; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
    const state = Flip.getState(cards, { props: 'opacity' });
    cards.forEach((c) => c.classList.toggle('is-hidden', f !== 'all' && c.dataset.cat !== f));
    counter.textContent = String(cards.filter((c) => !c.classList.contains('is-hidden')).length).padStart(2, '0');
    Flip.from(state, {
      duration: reduceMotion ? 0 : 0.8, ease: 'power3.inOut', absolute: true, nested: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.6, delay: 0.2 }),
      onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0.92, duration: 0.4 }),
      onComplete: () => ScrollTrigger.refresh(),
    });
  }));
}

function initTestimonials() {
  const slides = $$('.tst__slide');
  const dots = $$('.tst__dots span');
  const wrap = $('.testimonials');
  let i = 0, timer;
  const restart = () => { clearInterval(timer); if (!reduceMotion) timer = setInterval(() => go(i + 1), 7000); };
  const go = (n) => {
    const prev = slides[i];
    i = (n + slides.length) % slides.length;
    const next = slides[i];
    if (prev === next) return;
    prev.classList.remove('is-active'); next.classList.add('is-active');
    dots.forEach((d, k) => d.classList.toggle('is-active', k === i));
    gsap.to(prev, { autoAlpha: 0, y: -24, duration: 0.5, ease: 'power2.in' });
    gsap.fromTo(next, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.9, delay: 0.35, ease: 'expo.out' });
    restart();
  };
  $('[data-tst="prev"]').addEventListener('click', () => go(i - 1));
  $('[data-tst="next"]').addEventListener('click', () => go(i + 1));
  wrap.addEventListener('pointerenter', () => clearInterval(timer));
  wrap.addEventListener('pointerleave', restart);
  wrap.addEventListener('focusin', () => clearInterval(timer));
  restart();
}

// Contact form → email or WhatsApp (no backend needed)
function initContactForm() {
  const form = $('.contact__form');
  const error = $('.form-error', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = (data.get('name') || '').trim();
    const email = (data.get('email') || '').trim();
    const message = (data.get('message') || '').trim();
    const services = data.getAll('service');
    if (!form.checkValidity()) {
      error.textContent = 'Please add your name, a valid email and a short message.';
      form.querySelector(':invalid')?.focus();
      return;
    }
    error.textContent = '';
    const body = [`Hi Eddie, I'm ${name} (${email}).`, services.length ? `I'm interested in: ${services.join(', ')}.` : null, '', message]
      .filter((l) => l !== null).join('\n');
    // Send opens WhatsApp with the message filled in
    window.open(`https://wa.me/254740544409?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
  });
  // ?service=Photography (from service pages) pre-ticks the matching option
  const wanted = new URLSearchParams(location.search).get('service');
  if (wanted) $$('input[name="service"]', form).forEach((cb) => { if (cb.value.toLowerCase() === wanted.toLowerCase()) cb.checked = true; });
}

/* ------------------------------------------------------------------
   Boot
------------------------------------------------------------------ */
initMagnetic();
initFilters();
initTestimonials();
initContactForm();
initMarquees();
initSectionNav();

intro().then(async () => {
  if (!reduceMotion) {
    // Set up scroll animations in small idle-time chunks instead of one long block,
    // so the stat counters and hero never freeze while this runs.
    stopScroll();
    const steps = [initReveals, initWorkCards, initServices, initProcess, initParallax, initSplitHeadings, initHeroScroll, initReels];
    for (const step of steps) {
      await idle();
      step();
    }
    await idle();
  }
  ScrollTrigger.refresh();
  introDone();
  startScroll();
});
