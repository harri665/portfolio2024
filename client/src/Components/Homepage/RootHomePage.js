import React from 'react';
import { motion } from 'framer-motion';

import SubdomainNav from './SubdomainNav';
import { PrismBackdrop, PrismHero, trackPointer } from './Prism';
import { SITE_MODES, getSiteHref } from '../../utils/siteMode';

const destinationCards = [
  {
    mode: SITE_MODES.CS,
    title: 'Computer science',
    description: 'Projects, software, and technical work.',
  },
  {
    mode: SITE_MODES.ART,
    title: '3D art',
    description: 'Modeling, animation, and simulation.',
  },
];

export default function RootHomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden text-ink">
      <PrismBackdrop lens="hub" tone="hub" />
      <SubdomainNav currentMode={SITE_MODES.ROOT} />

      <main className="relative z-10">
        <PrismHero
          fullHeight
          glassTitle
          title="Choose a portfolio."
          subtitle="Same person, two lenses: engineering and art."
        >
          <div className="mx-auto mt-8 grid w-full max-w-4xl grid-cols-1 gap-3 sm:mt-10 sm:gap-4 md:grid-cols-2">
            {destinationCards.map((card) => (
              <motion.a
                key={card.mode}
                href={getSiteHref(card.mode)}
                onPointerMove={trackPointer}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 220, damping: 20 }}
                data-liquid-glass
                className="liquid-glass prism-glow group relative flex items-center gap-4 overflow-hidden rounded-3xl p-5 text-left sm:block sm:rounded-[1.75rem] sm:p-6"
              >
                <span aria-hidden="true" className="liquid-glass-sheen" />
                <span aria-hidden="true" className="liquid-glass-rim" />

                <div className="relative z-10 min-w-0 flex-1">
                  <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                    {card.title}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2 sm:mt-2">
                    {card.description}
                  </p>
                </div>

                <span
                  aria-hidden="true"
                  className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-lg text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),inset_0_-1px_1px_rgba(255,255,255,0.12),inset_0_0_0_1px_rgba(255,255,255,0.08)] sm:hidden"
                >
                  &rarr;
                </span>
              </motion.a>
            ))}
          </div>
        </PrismHero>
      </main>
    </div>
  );
}
