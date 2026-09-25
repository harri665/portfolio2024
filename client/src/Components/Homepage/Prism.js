import React, { useCallback, useRef } from 'react';
import { motion } from 'framer-motion';

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
};

const SCENES = {
  hub: { variant: 'hub', camera: [0, 0, 4.1] },
  cs: { variant: 'cs', camera: [0, 0, 5] },
  art: { variant: 'art', camera: [0, 0, 5] },
};

export function PrismBackdrop({ lens = 'hub', tone = 'page' }) {
  const toneStyle = TONES[tone] || TONES.page;
  const scene = SCENES[lens] || SCENES.hub;
  // On the CS and Art home pages the knot unfolds into the gallery's
  // background panel as you scroll; the vignette fades out with it
  const unfold = tone === 'page' && lens !== 'hub';
  const overlaysRef = useRef(null);
  const handleUnfold = useCallback((progress) => {
    if (overlaysRef.current) {
      overlaysRef.current.style.opacity = String(1 - progress * 0.85);
    }
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-[#08090c]">
      <div className={`absolute inset-0 ${toneStyle.scene}`}>
        <DistortedTorusScene
          variant={scene.variant}
          lens={lens === 'hub' ? null : lens}
          unfold={unfold}
          onUnfold={unfold ? handleUnfold : undefined}
          glassSelector={lens === 'hub' ? '[data-liquid-glass]' : undefined}
          className="h-full w-full"
          cameraPosition={scene.camera}
        />
      </div>

      <div ref={overlaysRef} className="absolute inset-0">
        <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(8,9,12,0.12),rgba(8,9,12,0.58)_56%,rgba(8,9,12,0.95)_82%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#08090c]/0 via-transparent to-[#08090c]" />
        {toneStyle.veil && <div className={`absolute inset-0 ${toneStyle.veil}`} />}
      </div>
    </div>
  );
}

// The centred name / headline / subline block from the hub, shared so every
// site opens the same way.
export function PrismHero({ title, subtitle, children, fullHeight = false }) {
  return (
    <header
      className={[
        'relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center justify-center px-4 text-center sm:px-8',
        fullHeight ? 'min-h-svh pb-10 pt-24 sm:pb-16 sm:pt-28' : 'min-h-[64vh] pb-12 pt-32',
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
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.6 }}
        className="max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl lg:text-7xl"
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

// Feeds the pointer position to a .prism-glow element's CSS so its
// spotlight and rim follow the cursor.
export function trackPointer(event) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  el.style.setProperty('--my', `${event.clientY - rect.top}px`);
}
