import React from "react";
import { motion } from "framer-motion";

import DistortedTorusScene from "./DistortedTorusScene";
import ArtStationProjects from "./Artstationprojects";
import Buttons from "./Buttons";
import SubdomainNav from "./SubdomainNav";
import { SITE_MODES } from "../../utils/siteMode";

export default function ArtHomePage() {
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
    <div className="relative h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Background Torus Scene */}
      <DistortedTorusScene />

      {/* Hero Text Content with animations */}
      <motion.div
        className="absolute text-center z-10"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
      >
        <h1 className="text-7xl font-extrabold tracking-tight text-white">
          Harrison Martin
        </h1>
        <Buttons/>
      </motion.div>
    </div>
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
