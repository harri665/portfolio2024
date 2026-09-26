import React from 'react';
import { motion } from 'framer-motion';

import SubdomainNav from './SubdomainNav';
import { PrismBackdrop, PrismHero, trackPointer } from './Prism';
import { SITE_MODES, getSiteHref } from '../../utils/siteMode';

const destinationCards = [
  {
    mode: SITE_MODES.CS,
    label: 'CS',
    title: 'Computer Science',
    description: 'Projects, software, and technical work.',
  },
  {
    mode: SITE_MODES.ART,
    label: 'ART',
    title: '3D Art',
    description: 'Projects, renders, and technical work.',
  },
];

export default function RootHomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden text-white">
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55 sm:text-xs">
                    {card.label}
                  </p>
                  <h2 className="mt-1.5 text-xl font-semibold tracking-tight sm:mt-3 sm:text-2xl">
                    {card.title}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-white/68 sm:mt-2">
                    {card.description}
                  </p>
                  <div className="mt-5 hidden items-center gap-2 text-sm font-semibold text-white/85 sm:inline-flex">
                    Enter
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                      &rarr;
                    </span>
                  </div>
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
