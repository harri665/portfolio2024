import React from "react";
import DistortedTorusScene from "./DistortedTorusScene";
import { motion } from "framer-motion"; // Import Framer Motion
import ArtStationProjects from "./Artstationprojects";
import Buttons from "./Buttons"; // Import the buttons component

export default function Homepage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white">
      <HeroSection />
      <AboutSection />
      <div id="projects">
        <ArtStationProjects />
      </div>
    </div>
  );
}

function HeroSection() {
  return (
    <div className="relative h-screen flex items-center justify-center overflow-hidden">
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
        <p className="text-xl mt-4 font-light tracking-wide text-white">
          Computer Scientist and 3D Generalist
        </p>
        <Buttons/>
      </motion.div>
    </div>
  );
}
function AboutSection() {
  // By defining the skills in an array, it's easier to add, remove, or change them later.
  const skills = [
    "Computer Science Undergrad",
    "3D Generalist",
    "Creative Technologist", // Replaced the duplicate "3D Generalist"
  ];

  return (
    <motion.div
      className="py-20 px-10 lg:px-24 bg-gray-900 text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5, duration: 1 }}
    >
      <h2 className="text-5xl font-bold mb-10 tracking-tight text-center">
        About Harrison Martin
      </h2>
      <div className="flex flex-col lg:flex-row items-center lg:items-start lg:space-x-10">
        {/* Image on the left */}
        <div className="flex-shrink-0 mb-6 lg:mb-0">
          <img
            src="/HarrisonProfessional.jpg"
            alt="Harrison Martin"
            className="rounded-lg shadow-xl w-64 h-64 object-cover"
          />
        </div>

        {/* Text on the right */}
        <p className="text-lg leading-relaxed max-w-3xl font-light">
          Harrison Martin is a passionate Computer Scientist and 3D Generalist
          with a keen eye for detail and a drive for innovation. With a strong
          foundation in computer science and a creative flair for 3D artistry,
          Harrison bridges the gap between technology and art, delivering
          captivating projects that inspire and engage.
        </p>
      </div>

      {/* --- IMPROVED SKILLS SECTION --- */}
      <div className="mt-12 flex flex-wrap justify-center gap-6">
        {skills.map((skill, index) => (
          <motion.div
            key={index}
            className="bg-gray-800/50 border border-gray-700 px-8 py-4 rounded-lg"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 + index * 0.1, duration: 0.6 }}
          >
            <p className="font-light text-gray-300 text-center text-lg">{skill}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}