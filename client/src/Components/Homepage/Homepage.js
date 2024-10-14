import React from "react";
import DistortedTorusScene from "./DistortedTorusScene";
import { motion } from "framer-motion"; // Import Framer Motion
import ArtStationProjects from "./Artstationprojects";

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
        <motion.button
          className="mt-8 px-8 py-3 bg-white text-gray-900 rounded-full shadow-xl hover:bg-gray-100 transition-all duration-300"
          whileHover={{ scale: 1.1 }}
          onClick={() => {
            const projectsElement = document.getElementById('projects');
            if (projectsElement) {
              projectsElement.scrollIntoView({ behavior: 'smooth' });
            }
          }}
        >
          Explore My Work
        </motion.button>
      </motion.div>
    </div>
  );
}

function AboutSection() {
  return (
    <motion.div
      className="py-20 px-10 lg:px-24 bg-gray-900 text-white text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5, duration: 1 }}
    >
      <h2 className="text-5xl font-bold mb-10 tracking-tight">
        About Harrison Martin
      </h2>
      <p className="text-lg leading-relaxed max-w-3xl mx-auto font-light">
        Hello! I’m Harrison Martin, a passionate software engineer with
        expertise in full-stack development and 3D printing technologies. My
        experience includes building high-performance web applications using
        modern frameworks like Node.js, React, and MongoDB, as well as solving
        complex 3D printing challenges such as G-code generation and printer
        configuration. I am proficient in multiple programming languages,
        including C++, Python, and JavaScript, allowing me to create scalable
        solutions across diverse platforms. Additionally, I have hands-on
        experience with 3D modeling tools like Blender and Substance 3D Suite,
        where I develop immersive visual content and animations. Currently, I am
        pursuing a degree in Software Development at the University of Colorado,
        Boulder, while contributing to the CU Sounding Rocket Laboratory and
        serving as VP at CU 3D. My dedication to learning and problem-solving
        drives my passion for technology and innovation.
      </p>

      {/* Placeholder for an image */}
      <div className="mt-10 flex justify-center">
        <img
          src="/HarrisonProfessional.jpg"
          alt="Placeholder"
          className="rounded-lg shadow-xl"
        />
      </div>

      <div className="mt-10 flex justify-center space-x-6">
        <motion.div
          className="bg-gray-800 p-6 rounded-lg shadow-xl transition-all transform"
          whileHover={{ scale: 1.05, backgroundColor: "#4A5568" }}
        >
          {/* Icon Placeholder */}
          <p className="font-semibold text-white">Computer Science Undergrad</p>
        </motion.div>
        <motion.div
          className="bg-gray-800 p-6 rounded-lg shadow-xl transition-all transform"
          whileHover={{ scale: 1.05, backgroundColor: "#4A5568" }}
        >
          {/* Icon Placeholder */}

          <p className="font-semibold text-white">3D Generalist</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
