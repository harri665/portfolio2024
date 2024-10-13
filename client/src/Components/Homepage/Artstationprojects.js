import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';

const ArtStationProjects = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.2 });

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const apiBaseUrl = process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3005/api/artstation/harr1' 
          : 'https://artstation.harrison-martin.com/api/artstation/harr1';
        const response = await fetch(apiBaseUrl);
        
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const data = await response.json();
        setProjects(data.data || []);
      } catch (error) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white py-10">
      <motion.h1 
        className="text-5xl font-bold text-center mb-10 tracking-wide"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
      >
        ArtStation Projects
      </motion.h1>
      {loading ? (
        <motion.div
          className="text-center text-lg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          Loading...
        </motion.div>
      ) : error ? (
        <motion.div
          className="text-center text-lg text-red-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          {error}
        </motion.div>
      ) : (
        <motion.div 
          
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 px-6"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : { opacity: 1 }}
          transition={{ duration: 0.8, staggerChildren: 0.2, ease: 'easeInOut' }}
        >
          {projects.length > 0 ? (
            projects.map((project) => (
              <motion.div 
                key={project.id} 
                className="relative rounded-lg shadow-2xl overflow-hidden hover:scale-105 transition-transform duration-300"
                initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.08, rotate: 1 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              >
                <Link to={`/projects/${project.hash_id}`} className="block w-full h-full">
                  <motion.img 
                    src={project.cover.thumb_url} 
                    alt={project.title || 'ArtStation Project Image'} 
                    className="object-cover w-full h-full"
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                  <div className="absolute inset-0 flex flex-col justify-end p-5">
                    <svg className="absolute bottom-0 left-0 w-60 h-60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
                      <defs>
                        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style={{ stopColor: '#ff7e5f', stopOpacity: 1 }} />
                          <stop offset="100%" style={{ stopColor: '#feb47b', stopOpacity: 1 }} />
                        </linearGradient>
                      </defs>
                      <g fill="url(#grad1)">
                        <circle cx="80" cy="130" r="25" opacity="0.9" />
                        <circle cx="90" cy="160" r="40" opacity="0.7" />
                        <circle cx="120" cy="150" r="30" opacity="0.8" />
                        <circle cx="40" cy="165" r="40" opacity="0.6" />
                      </g>
                    </svg>
                    <motion.h2 
                      className="text-2xl font-semibold mb-2 tracking-wide text-white relative z-10"
                      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    >
                      {project.title}
                    </motion.h2>
                    <motion.div 
                      className="text-sm text-blue-400 font-medium underline relative z-10"
                      initial={{ opacity: 0, y: 20 }}
                      animate={inView ? { opacity: 1, y: 0 } : {}}
                      transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                    >
                      View Details
                    </motion.div>
                  </div>
                </Link>
              </motion.div>
            ))
          ) : (
            <motion.div 
              className="text-center text-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, ease: 'easeInOut' }}
            >
              No projects available
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default ArtStationProjects;