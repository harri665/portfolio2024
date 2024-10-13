import React from 'react';
import DistortedTorusScene from './DistortedTorusScene';
import { motion } from 'framer-motion'; // Import Framer Motion
import ArtStationProjects from './Artstationprojects';

export default function Homepage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-black text-white">
      <HeroSection />
      <AboutSection />
      <ArtStationProjects/>
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
          Software Engineer & 3D Printing Specialist
        </p>
        <motion.button
          className="mt-8 px-8 py-3 bg-white text-gray-900 rounded-full shadow-xl hover:bg-gray-100 transition-all duration-300"
          whileHover={{ scale: 1.1 }}
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
      <h2 className="text-5xl font-bold mb-10 tracking-tight">About Harrison Martin</h2>
      <p className="text-lg leading-relaxed max-w-3xl mx-auto font-light">
        Hello! I’m Harrison Martin, a passionate software engineer with expertise in full-stack
        development and 3D printing technologies. My work ranges from developing high-performance
        web applications using modern frameworks like Node.js, React, and MongoDB, to solving
        complex 3D printing challenges, including G-code generation and printer configuration.
      </p>

      {/* Placeholder for an image */}
      <div className="mt-10 flex justify-center">
        <img
          src="https://via.placeholder.com/300x200"
          alt="Placeholder"
          className="rounded-lg shadow-xl"
        />
      </div>

      <div className="mt-10 flex justify-center space-x-6">
        <motion.div
          className="bg-gray-800 p-6 rounded-lg shadow-xl transition-all transform"
          whileHover={{ scale: 1.05, backgroundColor: '#4A5568' }}
        >
          {/* Icon Placeholder */}
          <div className="mb-4">
            <img src="https://via.placeholder.com/50" alt="Icon" />
          </div>
          <p className="font-semibold text-white">Full Stack Development</p>
        </motion.div>
        <motion.div
          className="bg-gray-800 p-6 rounded-lg shadow-xl transition-all transform"
          whileHover={{ scale: 1.05, backgroundColor: '#4A5568' }}
        >
          {/* Icon Placeholder */}
          <div className="mb-4">
            <img src="https://via.placeholder.com/50" alt="Icon" />
          </div>
          <p className="font-semibold text-white">3D Printing Specialist</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
