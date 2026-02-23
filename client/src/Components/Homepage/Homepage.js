import React from "react";
import { motion } from "framer-motion";

import DistortedTorusScene from "./DistortedTorusScene";
import ArtStationProjects from "./Artstationprojects";
import Buttons from "./Buttons";
import SubdomainNav from "./SubdomainNav";
import { SITE_MODES } from "../../utils/siteMode";

export default function Homepage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08090c] text-white">
      <SubdomainNav currentMode={SITE_MODES.ART} />
      <HeroSection />

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-20 sm:px-8">
        <AboutSection />
        <div id="projects" className="mt-8">
          <ArtStationProjects />
        </div>
      </main>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-[88vh] overflow-hidden pt-28 sm:pt-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-[78vh] opacity-24">
          <DistortedTorusScene variant="art" className="h-full w-full" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-[#08090c]/5 via-[#08090c]/58 to-[#08090c]" />
        <div className="absolute left-[-3rem] top-24 h-56 w-56 rounded-full bg-rose-500/20 blur-3xl" />
        <div className="absolute right-[6%] top-20 h-64 w-64 rounded-full bg-orange-400/18 blur-3xl" />
        <div className="absolute bottom-[10%] left-[35%] h-72 w-72 rounded-full bg-violet-400/14 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center px-4 pb-10 sm:px-8">
        <motion.div
          className="w-full rounded-[2rem]  p-7 text-center sm:p-10"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75 }}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
            Art Portfolio
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl lg:text-7xl">
            Harrison Martin
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-white/65 sm:text-lg">
            3D generalist and creative technologist focused on form, lighting,
            and polished visual storytelling.
          </p>
          <div className="mx-auto mt-6 h-px w-24 bg-white/10" />
          <Buttons />
        </motion.div>
      </div>
    </section>
  );
}

function AboutSection() {
  const skills = [
    "3D Art Direction",
    "Creative Technology",
    "Computer Science Foundation",
  ];

  return (
    <motion.section
      className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.7 }}
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[auto_1fr] lg:items-start">
        <div className="mx-auto lg:mx-0">
          <img
            src="/HarrisonProfessional.jpg"
            alt="Harrison Martin"
            className="h-44 w-44 rounded-3xl object-cover shadow-[0_18px_40px_rgba(0,0,0,0.35)] sm:h-56 sm:w-56"
          />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/48">
            About
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            A visual practice shaped by technical thinking.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/65 sm:text-base">
            This collection focuses on 3D, visual, and mixed-media work. The
            goal is clean execution, strong composition, and a finish that feels
            intentional at every stage of the pipeline.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            {skills.map((skill, index) => (
              <motion.div
                key={skill}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/90"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.08, duration: 0.35 }}
              >
                {skill}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
