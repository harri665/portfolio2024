import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';

export default function ArtStationProjects() {
  const [projects, setProjects] = useState([]);
  
  // Replace 'USERNAME' with the actual ArtStation username
  const username = 'harr1'; // Use your ArtStation username here

  useEffect(() => {
    fetch('/src/artstation-projects.json')
      .then(response => response.json())
      .then(data => setProjects(data))
      .catch(error => console.error('Error fetching ArtStation projects:', error));
  }, []);
  
  

  return (
    <section className="py-20 px-10 lg:px-24 bg-gray-900 text-white text-center">
      <h2 className="text-5xl font-bold mb-10 tracking-tight">My ArtStation Projects</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
        {projects.length === 0 ? (
          <p>Loading projects...</p>
        ) : (
          projects.map((project) => (
            <motion.div
              key={project.id}
              className="bg-gray-800 rounded-lg shadow-xl p-6 text-left"
              whileHover={{ scale: 1.05, backgroundColor: '#4A5568' }}
              transition={{ duration: 0.3 }}
            >
              <img
                src={project.cover.small_image_url}
                alt={project.title}
                className="rounded-lg mb-4"
              />
              <h3 className="text-xl font-semibold text-white">{project.title}</h3>
              <p className="text-sm text-gray-400">
                {project.description || 'No description available'}
              </p>
              <a
                href={project.permalink}
                className="text-blue-400 mt-4 inline-block"
                target="_blank"
                rel="noopener noreferrer"
              >
                View Project
              </a>
            </motion.div>
          ))
        )}
      </div>
    </section>
  );
}
