import React from 'react';
import { motion } from 'framer-motion';

import SubdomainNav from './SubdomainNav';
import DistortedTorusScene from './DistortedTorusScene';
import { SITE_MODES, getSiteHref } from '../../utils/siteMode';

const destinationCards = [
  {
    mode: SITE_MODES.CS,
    label: 'CS',
    title: 'Computer Science',
    description: 'Projects, software, and technical work.',
    tint: 'from-sky-400/22 via-cyan-300/12 to-transparent',
  },
  {
    mode: SITE_MODES.ART,
    label: 'ART',
    title: '3D Art',
    description: 'Projects, renders, and technical work.',
    tint: 'from-rose-400/22 via-orange-300/10 to-transparent',
  },
];

export default function RootHomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08090c] text-white">
      <TorusBackdrop />
      <SubdomainNav currentMode={SITE_MODES.ROOT} />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-4 pb-16 pt-28 text-center sm:px-8">
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
          Choose a portfolio.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="mt-4 max-w-2xl text-base leading-relaxed text-white/68 sm:text-lg"
        >
          Same person, two lenses: engineering and art.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.6 }}
          className="mt-10 grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-2"
        >
          {destinationCards.map((card) => (
            <motion.a
              key={card.mode}
              href={getSiteHref(card.mode)}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.995 }}
              transition={{ type: 'spring', stiffness: 220, damping: 20 }}
              className="group relative overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#0f1117]/42 p-6 text-left shadow-[0_22px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl"
            >
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.tint} opacity-90`}
              />
              <div className="pointer-events-none absolute inset-0 rounded-[1.75rem] ring-1 ring-white/5" />

              <div className="relative z-10">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
                  {card.label}
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight">{card.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/68">
                  {card.description}
                </p>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#4da3ff]">
                  Enter
                  <span aria-hidden="true">-&gt;</span>
                </div>
              </div>
            </motion.a>
          ))}
        </motion.div>
      </main>
    </div>
  );
}

function TorusBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-[4.5rem] h-[72vh] opacity-60 sm:h-[86vh] sm:opacity-70">
        <DistortedTorusScene
          variant="hub"
          className="h-full w-full"
          cameraPosition={[0, 0, 4.1]}
        />
      </div>

      <div className="absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(8,9,12,0.12),rgba(8,9,12,0.58)_56%,rgba(8,9,12,0.95)_82%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#08090c]/0 via-transparent to-[#08090c]" />

      <div className="absolute left-[8%] top-[22%] h-40 w-40 rounded-full bg-sky-500/16 blur-3xl" />
      <div className="absolute right-[10%] top-[16%] h-48 w-48 rounded-full bg-rose-400/12 blur-3xl" />
    </div>
  );
}
