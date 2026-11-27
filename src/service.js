/* Services index + individual service pages */
import {
  gsap, ScrollTrigger, $, $$, reduceMotion, finePointer, stopScroll, startScroll,
  curtainOut, hideCurtainNow, introDone, session, initMagnetic, initSplitHeadings, initReveals,
  initImageReveals, initMarquees, scrollToTarget,
} from './core.js';

session.set('ev-visited', '1');

/* ------------------------------------------------------------------
   Giant page title: size the font so the word spans the container
------------------------------------------------------------------ */
const word = $('.s-hero__word');
function fitWord() {
  if (!word) return;
  const inner = $('.s-hero__word-inner', word);
  word.style.setProperty('--fit-size', '100px');
  const natural = inner.getBoundingClientRect().width; // max-content width of the letters
  // Span the full container width, like PORTFOLIO on the home page
  word.style.setProperty('--fit-size', `${Math.floor((100 * word.clientWidth * 0.995) / natural)}px`);
}
fitWord();
document.fonts.ready.then(() => { fitWord(); ScrollTrigger.refresh(); });
addEventListener('resize', fitWord);

/* ------------------------------------------------------------------
   Intro
------------------------------------------------------------------ */
function heroIntro() {
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.from('.s-hero__word-inner > span', { yPercent: 105, duration: 1.4, stagger: 0.04 })
    .from('.crumbs, .s-hero__index', { opacity: 0, y: 16, duration: 1 }, 0.2)
    .from('.s-hero__row > *', { opacity: 0, y: 30, duration: 1.1, stagger: 0.08 }, 0.45)
    .from('.s-hero__media figure', { clipPath: 'inset(100% 0% 0% 0%)', duration: 1.4, stagger: 0.1, ease: 'expo.inOut' }, 0.4)
    .from('.s-hero__media img, .s-hero__media video', { scale: 1.3, duration: 1.8, stagger: 0.1 }, 0.55);
  return tl;
}

/* ------------------------------------------------------------------
   Films: hover (or in-view on touch) plays a muted loop; click opens
   the full reel in a modal
------------------------------------------------------------------ */
function initFilms() {
  const films = $$('.film');
  if (!films.length) return;

  const play = (film) => {
    const v = $('video', film);
    if (!v) return;
    if (v.preload === 'none') { v.preload = 'auto'; v.load(); }
    v.play().then(() => film.classList.add('is-playing')).catch(() => {});
  };
  const stop = (film) => {
    const v = $('video', film);
    if (!v) return;
    v.pause();
    film.classList.remove('is-playing');
  };

  if (finePointer) {
    films.forEach((f) => {
      f.addEventListener('pointerenter', () => play(f));
      f.addEventListener('pointerleave', () => stop(f));
    });
  } else if (!reduceMotion) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? play(e.target) : stop(e.target))), { threshold: 0.6 });
    films.forEach((f) => io.observe(f));
  }

  const modal = $('.video-modal');
  const mv = $('video', modal);
  const title = $('.video-modal__title', modal);
  films.forEach((f) => f.addEventListener('click', () => {
    films.forEach(stop);
    mv.src = f.dataset.full;
    mv.poster = f.dataset.poster || '';
    title.textContent = f.dataset.title || '';
    modal.showModal();
    stopScroll();
    mv.play().catch(() => {});
  }));
  const close = () => modal.close();
  $('.video-modal__close', modal).addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.addEventListener('close', () => { mv.pause(); mv.removeAttribute('src'); mv.load(); startScroll(); });

  gsap.from(films, {
    opacity: 0, y: 60, duration: 1.1, ease: 'expo.out', stagger: 0.07,
    scrollTrigger: { trigger: '.film-grid', start: 'top 85%', once: true },
  });
}

/* ------------------------------------------------------------------
   FAQ: smooth open/close for <details>
------------------------------------------------------------------ */
function initFaq() {
  $$('.faq__item').forEach((d) => {
    const summary = $('summary', d);
    const body = $('.faq__answer', d);
    summary.addEventListener('click', (e) => {
      if (reduceMotion) return;
      e.preventDefault();
      if (d.open) {
        gsap.to(body, { height: 0, duration: 0.5, ease: 'power3.inOut', onComplete: () => { d.open = false; gsap.set(body, { clearProps: 'height' }); ScrollTrigger.refresh(); } });
      } else {
        d.open = true;
        gsap.fromTo(body, { height: 0 }, { height: 'auto', duration: 0.6, ease: 'expo.out', onComplete: () => ScrollTrigger.refresh() });
      }
    });
  });
}

function initScrollFx() {
  initSplitHeadings();
  initReveals();
  initImageReveals('.m-item__media, .svc-panel__media figure');
  gsap.from('.offer', { opacity: 0, y: 50, duration: 1.1, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: '.offer-grid', start: 'top 85%', once: true } });
  gsap.from('.steps li', { opacity: 0, y: 40, duration: 1, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: '.steps', start: 'top 85%', once: true } });

  gsap.matchMedia().add('(min-width: 1024px)', () => {
    $$('.s-hero__media figure').forEach((f, i) =>
      gsap.fromTo(f, { yPercent: 0 }, { yPercent: [5, 14, 8][i % 3], ease: 'none', scrollTrigger: { trigger: '.s-hero__media', start: 'top 80%', end: 'bottom top', scrub: true } })
    );
    gsap.to('.s-hero__word', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.s-hero', start: 'top top', end: 'bottom top', scrub: true } });
  });
}

/* ------------------------------------------------------------------
   Boot
------------------------------------------------------------------ */
initMagnetic();
initMarquees();
initFilms();
initFaq();

(async () => {
  await document.fonts.ready;
  fitWord();
  if (reduceMotion) { hideCurtainNow(); ScrollTrigger.refresh(); introDone(); return; }
  if (location.hash) scrollToTarget(location.hash, true);
  // All setup happens while the curtain is static: scroll effects, then the hero animation
  // (built paused, so its start state renders behind the curtain)…
  initScrollFx();
  ScrollTrigger.refresh();
  const hero = heroIntro().pause();
  // …and it starts only once the panels are already moving.
  await curtainOut(() => hero.play());
  await hero.then();
  // Hero videos start decoding only after the transition, so they never compete with it
  $$('.s-hero__media video').forEach((v) => v.play().catch(() => {}));
  introDone();
})();
