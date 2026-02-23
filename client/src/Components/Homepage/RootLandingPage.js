import React from 'react';
import { motion } from 'framer-motion';

import SubdomainNav from './SubdomainNav';
import DistortedTorusScene from './DistortedTorusScene';
import { SITE_MODES, getSiteHref } from '../../utils/siteMode';

const destinationCards = [
  {
    mode: SITE_MODES.CS,
    eyebrow: 'Computer Science',
    title: 'Engineering Projects',
    description:
      'Software builds, experiments, and technical work with a clean project browser.',
    tint: 'from-sky-400/16 via-cyan-300/10 to-transparent',
    buttonLabel: 'Open CS Portfolio',
  },
  {
    mode: SITE_MODES.ART,
    eyebrow: 'Art',
    title: 'Visual + 3D Work',
    description:
      'ArtStation projects, renders, and creative direction collected in one gallery.',
    tint: 'from-rose-300/16 via-orange-300/10 to-transparent',
    buttonLabel: 'Open Art Portfolio',
  },
];

export default function RootLandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08090c] text-white">
      <TorusBackdrop />
      <BackgroundTreatment />
      <SubdomainNav currentMode={SITE_MODES.ROOT} />

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center px-4 pb-14 pt-32 sm:px-8">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="mx-auto mb-10 max-w-4xl text-center"
        >
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
            Harrison Martin Portfolio
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
            Two focused experiences.
            <br />
            One clear entry point.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
            Start here, then choose the portfolio designed for the kind of work
            you want to see.
          </p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="mx-auto mb-8 grid w-full max-w-6xl grid-cols-1 gap-5 md:grid-cols-2"
        >
          {destinationCards.map((card, index) => (
            <motion.a
              key={card.mode}
              href={getSiteHref(card.mode)}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.995 }}
              transition={{ type: 'spring', stiffness: 220, damping: 20 }}
              className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-7 shadow-[0_22px_65px_rgba(0,0,0,0.4)] backdrop-blur-2xl"
            >
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.tint} opacity-100`}
              />
              <div className="pointer-events-none absolute -right-10 top-4 h-32 w-32 rounded-full bg-white/10 blur-2xl" />

              <div className="relative z-10 flex h-full flex-col">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">
                  {card.eyebrow}
                </p>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {card.title}
                </h2>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65 sm:text-base">
                  {card.description}
                </p>

                <div className="mt-8 flex items-center gap-3">
                  <span className="inline-flex items-center rounded-full bg-[#0a84ff] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_26px_rgba(10,132,255,0.32)] transition-colors group-hover:bg-[#2997ff]">
                    {card.buttonLabel}
                  </span>
                  <span className="text-sm font-medium text-white/35">-</span>
                </div>
              </div>
            </motion.a>
          ))}
        </motion.section>

        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 rounded-[1.75rem] border border-white/10 bg-white/5 p-4 shadow-[0_16px_45px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:grid-cols-3 sm:p-5"
        >
          <InfoTile label="Design Language" value="Minimal + Motion" />
          <InfoTile label="Navigation" value="Subdomain Split" />
          <InfoTile label="Contact" value="Unified Across Pages" />
        </motion.section>
      </main>
    </div>
  );
}

function TorusBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-[78vh] opacity-28">
        <DistortedTorusScene variant="hub" className="h-full w-full" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-[#08090c]/5 via-[#08090c]/55 to-[#08090c]" />
    </div>
  );
}

function BackgroundTreatment() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute left-[-4rem] top-[6rem] h-56 w-56 rounded-full bg-sky-500/18 blur-3xl" />
      <div className="absolute right-[6%] top-[20%] h-64 w-64 rounded-full bg-rose-400/16 blur-3xl" />
      <div className="absolute bottom-[15%] left-[35%] h-72 w-72 rounded-full bg-violet-400/14 blur-3xl" />
      <div className="absolute inset-0 [background-image:radial-gradient(circle_at_top,rgba(255,255,255,0.08),rgba(8,9,12,0.35)_42%,rgba(8,9,12,1)_72%)]" />
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium tracking-tight text-white/92 sm:text-base">
        {value}
      </p>
    </div>
  );
}
