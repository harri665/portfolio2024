import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const ArtStationProjects = () => {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const fetchProjects = async () => {
      
      const apiBaseUrl = process.env.NODE_ENV === 'development' 
        ? 'https://artstation.harrison-martin.com/api/artstation/harr1' 
        : 'https://artstation.harrison-martin.com/api/artstation/harr1';
      const response = await fetch(apiBaseUrl);
      const data = await response.json();
      setProjects(data.data || []);
    };

    fetchProjects();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white py-10">
      <motion.h1 
        className="text-4xl font-bold text-center mb-10"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        ArtStation Projects
      </motion.h1>
      <motion.div 
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        {projects.length > 0 ? (
          projects.map((project) => (
            <motion.div 
              key={project.id} 
              className="bg-gray-800 p-5 rounded-lg shadow-lg hover:bg-gray-700 transition-colors duration-300"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Link to={`/projects/${project.hash_id}`}>
                <img 
                  src={project.cover.thumb_url} 
                  alt={project.title} 
                  className="rounded-md mb-4 object-cover h-48 w-full"
                />
                <h2 className="text-xl font-semibold mb-2">{project.title}</h2>
                <p className="text-sm text-gray-400">{project.description || 'No description provided.'}</p>
              </Link>
            </motion.div>
          ))
        ) : (
          <motion.div 
            className="text-center text-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          >
            No projects available
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

export default ArtStationProjects;
