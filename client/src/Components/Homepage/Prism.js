import React, { useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import DistortedTorusScene from './DistortedTorusScene';
import './prism.css';

// The shared 3D backdrop for every portfolio page. The hub shows the
// light-beam prism; CS and Art show their distorted torus knots. `lens` tints
// the shader per site ('hub' is the full spectrum, 'cs' cool, 'art' warm);
// `tone` sets how far it recedes behind the content on top of it.
const TONES = {
  hub: { scene: 'opacity-60 sm:opacity-70', veil: '' },
  page: { scene: 'opacity-90', veil: '' },
  quiet: { scene: 'opacity-35 sm:opacity-45', veil: 'bg-[#08090c]/55' },
  detail: { scene: 'opacity-60 sm:opacity-70', veil: 'bg-[#08090c]/20' },
};

// What sits behind each site's project pages, under the glass panels:
//   'grid'     - a still drafting dot grid, tinted by the repo's language (CS)
//   'cover'    - the project's own cover image, blurred and dimmed (Art)
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
  // The hub's cards and headline are glass (LiquidGlassPass), which also
  // takes over the dim and vignette so the glass can sit above them
  const glass = lens === 'hub';
  // On the CS and Art home pages the knot turns to liquid as you scroll and
  // drips down to fill the gallery's background; the vignette fades out with it.
  // Project pages keep the knot as a still backdrop behind their glass panels.
  const drip = tone === 'page' && lens !== 'hub';
  const detailBackdrop = tone === 'detail' ? DETAIL_BACKDROPS[lens] || 'torus' : 'torus';
  // everything but the knot is drawn at full strength; it's quiet already
  const flat = detailBackdrop !== 'torus';
  const overlaysRef = useRef(null);
  const handleDrip = useCallback((progress) => {
    if (overlaysRef.current) {
      overlaysRef.current.style.opacity = String(1 - progress * 0.85);
    }
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-[#08090c]">
      <div className={`absolute inset-0 ${glass || flat ? '' : toneStyle.scene}`}>
        <DistortedTorusScene
          variant={scene.variant}
          lens={lens === 'hub' ? null : lens}
          drip={drip}
          onDrip={drip ? handleDrip : undefined}
          backdrop={flat ? detailBackdrop : 'knot'}
          accent={accent}
          image={image}
          glass={
            glass
              ? { selector: '[data-liquid-glass]', textSelector: '[data-liquid-glass-text]' }
              : tone === 'detail'
                ? { selector: '[data-liquid-glass]', imageSelector: '[data-glass-image]', shade: false, frost: 2.5 }
                : drip
                  ? { selector: '[data-liquid-glass]', imageSelector: '[data-glass-image]', shade: false }
                  : undefined
          }
          className="h-full w-full"
          cameraPosition={scene.camera}
        />
      </div>

      {/* The grid and cover shade their own edges; these layers are for the knot */}
      <div ref={overlaysRef} className={`absolute inset-0 ${flat ? 'hidden' : ''}`}>
        {!glass && (
          <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(8,9,12,0.12),rgba(8,9,12,0.58)_56%,rgba(8,9,12,0.95)_82%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#08090c]/0 via-transparent to-[#08090c]" />
        {toneStyle.veil && <div className={`absolute inset-0 ${toneStyle.veil}`} />}
      </div>
    </div>
  );
}

// The centred name / headline / subline block from the hub, shared so every
// site opens the same way. `peek` stops a full-height hero short of the fold
// so the top of the gallery below shows on load. It must leave enough of the
// first cards on screen for their scroll reveal (15%, less the 40px they
// start lowered by) to fire, or they peek in as empty space.
export function PrismHero({
  title,
  subtitle,
  children,
  fullHeight = false,
  peek = false,
  glassTitle = false,
}) {
  return (
    <header
      className={[
        'relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center justify-center px-4 text-center sm:px-8',
        fullHeight
          ? [
              'pb-10 pt-24 sm:pb-16 sm:pt-28',
              peek ? 'min-h-[calc(100svh-6.5rem)] sm:min-h-[calc(100svh-7.5rem)]' : 'min-h-svh',
            ].join(' ')
          : 'min-h-[64vh] pb-12 pt-32',
      ].join(' ')}
    >
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-white/58"
      >
        Harrison Martin
      </motion.p>

      <motion.h1
        data-liquid-glass-text={glassTitle || undefined}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.6 }}
        className={[
          'max-w-4xl text-4xl leading-tight tracking-tight sm:text-6xl lg:text-7xl',
          glassTitle ? 'prism-text font-bold' : 'font-semibold',
        ].join(' ')}
      >
        {title}
      </motion.h1>

      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="mt-4 max-w-2xl text-base leading-relaxed text-white/68 sm:text-lg"
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
