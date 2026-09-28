import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import DistortedTorusScene from './DistortedTorusScene';
import './prism.css';

const TONES = {
  hub: { scene: 'opacity-60 sm:opacity-70', veil: '' },
  page: { scene: 'opacity-90', veil: '' },
  quiet: { scene: 'opacity-35 sm:opacity-45', veil: 'bg-bg/55' },
  detail: { scene: 'opacity-60 sm:opacity-70', veil: 'bg-bg/20' },
};

// What sits behind each site's project pages, under the glass panels:
//   'grid'     - a still drafting dot grid, tinted by the repo's language (CS)
//   'cover'    - the project's own cover image, blurred and dimmed (Art),
//                drawn in CSS rather than WebGL (CoverFill)
//   'caustics' - slow light patterns
//   'torus'    - the site's knot, as on the home pages
const DETAIL_BACKDROPS = { cs: 'grid', art: 'cover' };

const SCENES = {
  hub: { variant: 'hub', camera: [0, 0, 4.1] },
  cs: { variant: 'cs', camera: [0, 0, 5] },
  art: { variant: 'art', camera: [0, 0, 5] },
};

export function PrismBackdrop({ lens = 'hub', tone = 'page', accent, image }) {
  const toneStyle = TONES[tone] || TONES.page;
  const scene = SCENES[lens] || SCENES.hub;
  const glass = lens === 'hub';
  // On the Art home page the knot turns to liquid as you scroll and drips down
  // to fill the gallery's background; on CS the camera walks into the Cornell
  // box instead (or, where that can't run, CS drips its knot too). Either way
  // the vignette fades out as it goes.
  const drip = tone === 'page' && lens !== 'hub';
  const pageBackdrop = drip && lens === 'cs' ? 'relight' : 'knot';
  const relight = pageBackdrop === 'relight';
  const detailBackdrop = tone === 'detail' ? DETAIL_BACKDROPS[lens] || 'torus' : 'torus';
  const flat = detailBackdrop !== 'torus';
  const overlaysRef = useRef(null);
  const handleDrip = useCallback((progress) => {
    if (overlaysRef.current) {
      overlaysRef.current.style.opacity = String(1 - progress * 0.85);
    }
  }, []);

  // css layer instead of a canvas, a canvas trails fast scrolls
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
  // at the edges while it catches up.
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-bg" />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${glass || flat || relight ? '' : toneStyle.scene}`}
      >
        <DistortedTorusScene
          followScroll
          variant={scene.variant}
          lens={lens === 'hub' ? null : lens}
          drip={drip}
          onDrip={drip ? handleDrip : undefined}
          backdrop={flat ? detailBackdrop : pageBackdrop}
          accent={accent}
          image={image}
          glass={
            glass
              ? { selector: '[data-liquid-glass]', textSelector: '[data-liquid-glass-text]' }
              : drip
                ? { selector: '[data-liquid-glass]', imageSelector: '[data-glass-image]', shade: false }
                : // project pages: CSS glass only; the WebGL bevel bent the
                  // edges of their images and videos and was heavy on phones
                  undefined
          }
          // 100vh is the large viewport on phones so this doesn't resize when the toolbar collapses
          className="absolute inset-x-0 top-0 h-screen"
          cameraPosition={scene.camera}
        />
      </div>

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

// css not webgl so no CORS proxy needed, and the cover <img> already loaded it
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
          transform: 'scale(1.3)',
          filter: 'blur(56px) saturate(0.8) brightness(0.5)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-bg/0 via-bg/25 to-bg/55" />
      <div className="absolute inset-0 [background-image:radial-gradient(ellipse_at_center,transparent_35%,rgb(var(--bg)/0.6)_100%)]" />
    </div>
  );
}

// The headline block over a 3D scene: the hub's, centred, and the art
// gallery's, left-aligned under the wordmark like every other section's
// intro. `peek` stops a full-height hero short of the fold so the top of the
// gallery below shows on load. It must leave enough of the first cards on
// screen for their scroll reveal (15%, less the 40px they start lowered by)
// to fire, or they peek in as empty space.
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
        className={[
          'relative z-10 mx-auto flex w-full max-w-7xl flex-col justify-center px-5 sm:px-6',
          left ? 'items-start text-left' : 'items-center text-center',
          fullHeight
            ? [
                'pb-10 pt-24 sm:pb-16 sm:pt-28',
                peek ? 'min-h-[calc(100svh-6.5rem)] sm:min-h-[calc(100svh-7.5rem)]' : 'min-h-svh',
              ].join(' ')
            : 'min-h-[64vh] pb-12 pt-32',
        ].join(' ')}
      >
        <motion.h1
          data-liquid-glass-text={glassTitle || undefined}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className={[
            'max-w-4xl leading-none tracking-tight text-ink',
            left ? 'text-6xl sm:text-8xl lg:text-9xl' : 'text-4xl sm:text-6xl lg:text-7xl',
            glassTitle ? 'prism-text font-bold' : 'font-semibold',
          ].join(' ')}
        >
          {title}
        </motion.h1>

        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.6 }}
            className="mt-5 max-w-2xl text-base leading-relaxed text-ink-2 sm:text-lg"
          >
            {subtitle}
          </motion.p>
        )}

        {children && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.6 }}
            className="w-full"
          >
            {children}
          </motion.div>
        )}
      </header>
    </div>
  );
}

// Gallery cards fade in and rise as they scroll into view, each row staggered
// left to right. Spread onto a motion component; it animates once per card.
// `amount` is the share of the element that has to be on screen first.
export function useScrollReveal(index = 0, amount = 0.15) {
  const reduceMotion = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduceMotion ? 0 : 40 },
    whileInView: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: (index % 3) * 0.08 },
    },
    viewport: { once: true, amount },
  };
}

// tall panels (long readme on a phone) never get 15% on screen so reveal on appear
export function Reveal({ as = 'div', index = 0, ...props }) {
  const reveal = useScrollReveal(index, 'some');
  const Component = motion[as];
  return <Component {...reveal} {...props} />;
}

export const HOVER_LIFT = { y: -4, transition: { duration: 0.22, ease: 'easeOut' } };

export function trackPointer(event) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  el.style.setProperty('--my', `${event.clientY - rect.top}px`);
}
