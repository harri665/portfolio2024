import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import ErrorBoundary from '../ErrorBoundary';
import { useRelightStatus } from './relight/status';
import useSceneStart, { afterLoad } from './sceneStart';
import './prism.css';

// three.js and the scenes are most of the site's code, so they're a chunk of
// their own. A page with a scene fetches it as soon as the page has loaded,
// at high priority, so it's ready by the time the scene starts
// (useSceneStart) rather than queued behind the gallery's images. Not with
// webpackPrefetch: that fetches at idle priority, last of all on a slow
// connection, and the import then fetched it a second time while it was in
// flight.
let sceneModule = null;
const loadScene = () => {
  sceneModule =
    sceneModule ||
    import(/* webpackChunkName: "scene", webpackFetchPriority: "high" */ './DistortedTorusScene');
  return sceneModule;
};
const DistortedTorusScene = lazy(loadScene);

// The shared 3D backdrop for every portfolio page. The hub shows the
// light-beam prism, Art its distorted torus knot, and CS a Cornell box relit
// live by a neural network (RelightBackdrop). `lens` tints
// the shader per site ('hub' is the full spectrum, 'cs' cool, 'art' warm);
// `tone` sets how far it recedes behind the content on top of it.
const TONES = {
  hub: { scene: 'opacity-60 sm:opacity-70', veil: '' },
  page: { scene: 'opacity-90', veil: '' },
  quiet: { scene: 'opacity-35 sm:opacity-45', veil: 'bg-bg/55' },
  detail: { scene: 'opacity-60 sm:opacity-70', veil: 'bg-bg/20' },
};

// What sits behind each site's project pages, under the glass panels:
//   'grid'     - a still drafting dot grid (CS)
//   'cover'    - the project's own cover image, blurred and dimmed (Art),
//                drawn in CSS rather than WebGL (CoverFill)
//   'caustics' - slow light patterns
//   'torus'    - the site's knot, as on the home pages
const DETAIL_BACKDROPS = { cs: 'grid', art: 'cover' };

// Where the CS project page's glass is drawn in WebGL, its sidebar and
// document merged into one piece (data-glass-merge). Phones and tablets keep
// the CSS frost instead (prism.css, .glass-panel); the pass is heavy there.
export const PANE_GLASS_QUERY = '(min-width: 1024px) and (pointer: fine)';

const SCENES = {
  hub: { variant: 'hub', camera: [0, 0, 4.1] },
  cs: { variant: 'cs', camera: [0, 0, 5] },
  art: { variant: 'art', camera: [0, 0, 5] },
};

// Stills of the home pages' scenes, shown until the live scene takes over
// (Scene); `tall` on phones, whose knot is drawn smaller. Captured by
// perf/posters.mjs, the knots POSTER_TIME seconds in, past their intro; the
// live scene starts its clock there, so its first frame is the still.
const POSTERS = { hub: 'hub', cs: 'cs', art: 'art' };
const POSTER_TIME = 2;

export function PrismBackdrop({ lens = 'hub', tone = 'page', image }) {
  const toneStyle = TONES[tone] || TONES.page;
  const scene = SCENES[lens] || SCENES.hub;
  // The hub's cards and headline are glass (LiquidGlassPass), which also
  // takes over the dim and vignette so the glass can sit above them
  const glass = lens === 'hub';
  // On the Art home page the knot turns to liquid as you scroll and drips down
  // to fill the gallery's background; on CS the camera walks into the Cornell
  // box instead (or, where that can't run, CS drips its knot too). Either way
  // the vignette fades out as it goes.
  const drip = tone === 'page' && lens !== 'hub';
  const pageBackdrop = drip && lens === 'cs' ? 'relight' : 'knot';
  // The Cornell box frames and dims itself, and its lamp has to stay bright
  const relight = pageBackdrop === 'relight';
  const detailBackdrop = tone === 'detail' ? DETAIL_BACKDROPS[lens] || 'torus' : 'torus';
  // everything but the knot is drawn at full strength; it's quiet already
  const flat = detailBackdrop !== 'torus';
  // The CS project page's pane, on screens that can afford the pass
  const paneGlass = useMemo(
    () => detailBackdrop === 'grid' && (window.matchMedia?.(PANE_GLASS_QUERY).matches ?? false),
    [detailBackdrop]
  );
  const overlaysRef = useRef(null);
  const handleDrip = useCallback((progress) => {
    if (overlaysRef.current) {
      overlaysRef.current.style.opacity = String(1 - progress * 0.85);
    }
  }, []);

  // The art project page has no WebGL glass, so its backdrop needs no canvas:
  // a fixed CSS layer can't trail a fast scroll the way a canvas catching up
  // with the page does, and it shows as soon as the cover image does
  if (flat && detailBackdrop === 'cover') {
    return (
      <>
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-bg" />
        {image && <CoverFill image={image} />}
      </>
    );
  }

  // The scene scrolls with the page and is moved back over the viewport each
  // frame, so its glass keeps up with the cards (see ScrollFollow). It spans
  // the page's own box, clipped so it never lengthens the page; the page root
  // must be positioned. The base colour and overlays stay fixed, filling in
  // at the edges while it catches up. The relit room can't trail the page
  // like that, so it shows on a fixed layer of its own and this canvas draws
  // only its glass (relight/roomLayer).
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-bg" />
      {/* data-backdrop-layer: the relit room's fixed layer goes just before it */}
      <div
        aria-hidden="true"
        data-backdrop-layer
        className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${glass || flat || relight ? '' : toneStyle.scene}`}
      >
        <Scene
          poster={tone === 'hub' || tone === 'page' ? POSTERS[lens] : null}
          followScroll
          variant={scene.variant}
          lens={lens === 'hub' ? null : lens}
          drip={drip}
          onDrip={drip ? handleDrip : undefined}
          backdrop={flat ? detailBackdrop : pageBackdrop}
          image={image}
          glass={
            glass
              ? { selector: '[data-liquid-glass]', textSelector: '[data-liquid-glass-text]' }
              : drip
                ? {
                    selector: '[data-liquid-glass]',
                    imageSelector: '[data-glass-image]',
                    shade: false,
                    // the CS cards are frosted further, so the relit room
                    // reads as light and colour behind them rather than detail,
                    // and its headline is glass too
                    ...(lens === 'cs' ? CS_GLASS : null),
                  }
                : paneGlass
                  ? // the CS project page; its sticky sidebar card is drawn
                    // by GlassStrip instead
                    { ...PANE_GLASS, selector: '[data-liquid-glass]:not([data-glass-side])' }
                  : // other project pages: CSS glass only; the WebGL bevel
                    // bent the edges of their images and videos
                    undefined
          }
          // 100vh is the large viewport on phones, so the canvas doesn't resize
          // as the browser's toolbar collapses mid-scroll
          className="absolute inset-x-0 top-0 h-screen"
          cameraPosition={scene.camera}
        />
      </div>

      {paneGlass && <GlassStrip />}

      {/* The grid and cover shade their own edges; these layers are for the knot */}
      <div
        ref={overlaysRef}
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-0 ${flat ? 'hidden' : ''}`}
      >
        {!glass && !relight && (
          <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(8,9,12,0.12),rgba(8,9,12,0.58)_56%,rgba(8,9,12,0.95)_82%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-bg/0 via-transparent to-bg" />
        {toneStyle.veil && <div className={`absolute inset-0 ${toneStyle.veil}`} />}
      </div>
    </>
  );
}

// The 3D scene, once it may start (useSceneStart), over a still of it
// (`poster`, a name in public/posters). The still sits under the canvas, so
// glass the scene draws (the hub's and CS's headlines) shows from its first
// frame. A knot's first frame is its still, so the still goes as soon as it's
// drawn: faded, it would show through the canvas behind the moving knot. The
// relit room fades in over its still once its network is running. A scene
// without a poster fades in.
function Scene({ poster, className, ...props }) {
  const started = useSceneStart();
  const [drawn, setDrawn] = useState(false);
  const [posterGone, setPosterGone] = useState(false);
  const handleFirstFrame = useCallback(() => setDrawn(true), []);
  const relight = useRelightStatus();
  const room = props.backdrop === 'relight';
  const shown = room ? relight.phase === 'running' || relight.phase === 'failed' : drawn;

  useEffect(
    () =>
      afterLoad(() => {
        // a failure shows when the scene renders (ErrorBoundary)
        loadScene().catch(() => {});
      }),
    []
  );

  return (
    <>
      {poster && !posterGone && (room || !drawn) && (
        <picture>
          <source media="(max-width: 768px)" srcSet={posterUrl(poster, 'tall')} />
          <img
            src={posterUrl(poster, 'wide')}
            alt=""
            fetchpriority="high"
            decoding="async"
            className={`${className} h-screen w-full object-cover transition-opacity duration-700`}
            style={{ opacity: shown ? 0 : 1 }}
            onTransitionEnd={() => setPosterGone(true)}
          />
        </picture>
      )}
      {started && (
        <div
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: poster || shown ? 1 : 0 }}
        >
          {/* a chunk that fails to load costs the backdrop, not the page */}
          <ErrorBoundary name="scene">
            <Suspense fallback={null}>
              <DistortedTorusScene
                {...props}
                className={className}
                onFirstFrame={handleFirstFrame}
                startAt={poster && !room ? POSTER_TIME : 0}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </>
  );
}

const posterUrl = (name, shape) => `${process.env.PUBLIC_URL}/posters/${name}-${shape}.webp`;

// The CS home page's cards: a wider blur with more samples to keep it smooth,
// and a little milkiness. Hovered, the lamp moves behind the card, so its
// frost triples, its prism split grows four times and it darkens a little,
// keeping the text readable over the light. The headline is glass as well,
// frosted only lightly so the room stays sharp through its letters. Its
// letters are domed and faintly tinted, so with the lamp behind them they show
// it shrunk, with the room drawn in around it, instead of vanishing into it.
const CS_GLASS = {
  textSelector: '[data-liquid-glass-text]',
  frost: 24,
  blurTaps: 24,
  haze: 0.06,
  textFrost: 5,
  textLens: 0.2,
  textTint: [0.82, 0.9, 1],
  hover: { frost: 2, split: 3, dim: 0.18 },
};

// The CS project page's glass, frosted enough to read over, light enough that
// the grid still shows bending at the rim. It covers most of the screen, so it
// draws at 1x with a lighter blur; under that much frost the difference
// doesn't show.
const PANE_GLASS = { shade: false, frost: 9, maxDpr: 1, blurTaps: 6 };

// How far past the join the strip reaches into the document (px)
const STRIP_REACH = 40;

// The CS project page's sticky sidebar card (data-glass-side), with the join
// where it flows into the document, drawn on a strip of canvas fixed to the
// screen. The main canvas scrolls with the page and catches up each frame,
// which keeps its glass under content that scrolls; a sticky card stays put
// while the page scrolls under it, so its glass there trailed it. The browser
// keeps a fixed canvas and a sticky card in step. The strip spans the card's
// column and a little of the document, over the main canvas; there it draws
// only the document's left edge, along which a frame's lag doesn't show. The
// grid is laid out in screen space, so the two canvases meet seamlessly, and
// the strip's canvas runs past its edges, where the frost would smear.
function GlassStrip() {
  const ref = useRef(null);

  useEffect(() => {
    const strip = ref.current;
    let frame = 0;

    const place = () => {
      frame = 0;
      const card = document.querySelector('[data-glass-side]');
      const sheet = document.querySelector('[data-glass-merge]:not([data-glass-side])');
      if (!card || !sheet) {
        strip.style.display = 'none';
        return;
      }
      const left = card.getBoundingClientRect().left - 8;
      const right = sheet.getBoundingClientRect().left + STRIP_REACH;
      strip.style.display = '';
      strip.style.left = `${left}px`;
      strip.style.width = `${right - left}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };

    // The card arrives with the project, and its column moves with the layout
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    place();
    return () => {
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-y-0 z-0 overflow-hidden"
      style={{ display: 'none' }}
    >
      <Scene
        variant="cs"
        lens="cs"
        backdrop="grid"
        glass={{ ...PANE_GLASS, selector: '[data-glass-merge]' }}
        className="absolute -inset-8"
      />
    </div>
  );
}

// The art project page's backdrop: its cover image, cropped to fill the
// screen, heavily blurred and dimmed, darkest toward the bottom where the
// reading is. It uses the cover's own URL (CSS needs no CORS proxy, unlike
// WebGL), which the page's cover <img> has already loaded, and fades in once
// the image is ready.
function CoverFill({ image }) {
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled) {
        setLoaded(image);
      }
    };
    probe.src = image;
    return () => {
      cancelled = true;
    };
  }, [image]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden transition-opacity duration-500"
      style={{ opacity: loaded === image ? 1 : 0 }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url("${image}")`,
          // zoomed in a little, heavily blurred, a little desaturated and dimmed
          transform: 'scale(1.3)',
          filter: 'blur(56px) saturate(0.8) brightness(0.5)',
        }}
      />
      {/* darkest toward the bottom and the edges */}
      <div className="absolute inset-0 bg-gradient-to-b from-bg/0 via-bg/25 to-bg/55" />
      <div className="absolute inset-0 [background-image:radial-gradient(ellipse_at_center,transparent_35%,rgb(var(--bg)/0.6)_100%)]" />
    </div>
  );
}

// The headline block over a 3D scene: the hub's, centred, and the art
// gallery's, left-aligned under the wordmark like every other section's
// intro. `peek` stops a full-height hero short of the fold so the top of the
// gallery below shows on load; on phones only a sliver, which leaves the
// scene behind the headline room to breathe. The first cards reveal anyway,
// as their scroll reveal reaches below the screen (useScrollReveal).
// The CS page's Cornell box fits itself to the hero (data-prism-hero).
export function PrismHero({
  title,
  subtitle,
  children,
  fullHeight = false,
  peek = false,
  glassTitle = false,
  align = 'center',
}) {
  const left = align === 'left';

  return (
    <div className="px-3 sm:px-6">
      <header
        data-prism-hero
        className={[
          'relative z-10 mx-auto flex w-full max-w-7xl flex-col justify-center px-5 sm:px-6',
          left ? 'items-start text-left' : 'items-center text-center',
          fullHeight
            ? [
                'pb-10 pt-24 sm:pb-16 sm:pt-28',
                peek ? 'min-h-[calc(100svh-3.5rem)] sm:min-h-[calc(100svh-7.5rem)]' : 'min-h-svh',
              ].join(' ')
            : 'min-h-[64vh] pb-12 pt-32',
        ].join(' ')}
      >
        <h1
          data-liquid-glass-text={glassTitle || undefined}
          className={[
            'hero-rise max-w-4xl leading-none tracking-tight text-ink',
            left ? 'text-6xl sm:text-8xl lg:text-9xl' : 'text-4xl sm:text-6xl lg:text-7xl',
            glassTitle ? 'prism-text font-bold' : 'font-semibold',
          ].join(' ')}
        >
          {title}
        </h1>

        {subtitle && (
          <p
            className="hero-rise mt-5 max-w-2xl text-base leading-relaxed text-ink-2 sm:text-lg"
            style={{ animationDelay: '80ms' }}
          >
            {subtitle}
          </p>
        )}

        {children && (
          <div className="hero-rise w-full" style={{ animationDelay: '180ms' }}>
            {children}
          </div>
        )}
      </header>
    </div>
  );
}

// Gallery cards fade in and rise as they scroll into view, each row staggered
// left to right. Spread onto a motion component; it animates once per card.
// `amount` is the share of the element that has to be on screen first,
// counting REVEAL_REACH below the screen's edge: a card starts rising just
// before it arrives, and one peeking under a hero reveals on load.
const REVEAL_REACH = '0px 0px 96px 0px';

export function useScrollReveal(index = 0, amount = 0.15) {
  const reduceMotion = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduceMotion ? 0 : 40 },
    whileInView: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: (index % 3) * 0.08 },
    },
    viewport: { once: true, amount, margin: REVEAL_REACH },
  };
}

// A motion element (`as`, default div) that plays the scroll-in reveal.
// Panels can be many screens tall (a long README on a phone), so they never
// get 15% of themselves on screen at once; they reveal as soon as they appear.
export function Reveal({ as = 'div', index = 0, ...props }) {
  const reveal = useScrollReveal(index, 'some');
  const Component = motion[as];
  return <Component {...reveal} {...props} />;
}

// Lifts a card on hover; quick, so it doesn't inherit the reveal's pace
export const HOVER_LIFT = { y: -4, transition: { duration: 0.22, ease: 'easeOut' } };

// Feeds the pointer position to a .prism-glow element's CSS so its
// spotlight and rim follow the cursor.
export function trackPointer(event) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  el.style.setProperty('--my', `${event.clientY - rect.top}px`);
}
