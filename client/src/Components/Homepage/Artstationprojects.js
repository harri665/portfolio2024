import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';

const ArtStationProjects = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleProjectsCount, setVisibleProjectsCount] = useState(6); // 2 rows initially (3 projects per row)
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.2 });

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const apiBaseUrl = process.env.NODE_ENV === 'development' 
          ? 'https://artstation.harrison-martin.com/api/artstation/harr1' 
          : 'https://artstation.harrison-martin.com/api/artstation/harr1'; //http://localhost:3005/api/artstation/harr1
        const response = await fetch(apiBaseUrl);
        
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const data = await response.json();
        const projectsWithDetails = await Promise.all(
          data.data.map(async (project) => {
            try {
              const detailsResponse = await fetch(`https://artstation.harrison-martin.com/api/project/${project.hash_id}`);
              if (!detailsResponse.ok) {
                throw new Error('Failed to fetch project details');
              }
              const details = await detailsResponse.json();
              return { ...project, software_items: details.software_items };
            } catch (err) {
              console.error('Error fetching project details:', err);
              return { ...project, software_items: [] };
            }
          })
        );
        setProjects(projectsWithDetails);
      } catch (error) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const loadMoreProjects = () => {
    setVisibleProjectsCount((prevCount) => prevCount + 6);
  };

  // Animation variants for container
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2
      }
    }
  };

  // Animation variants for project cards
  const cardVariants = {
    hidden: { 
      opacity: 0, 
      y: 50,
      scale: 0.9
    },
    visible: { 
      opacity: 1, 
      y: 0,
      scale: 1,
      transition: {
        type: "spring",
        damping: 15,
        stiffness: 100,
        duration: 0.6
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white py-10">
      <motion.h1 
        className="text-5xl font-bold text-center mb-10 tracking-wide"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ 
          duration: 0.8, 
          ease: [0.6, -0.05, 0.01, 0.99]
        }}
      >
        Projects:
      </motion.h1>
      {loading ? (
        <motion.div
          className="text-center text-lg"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          Loading...
        </motion.div>
      ) : error ? (
        <motion.div
          className="text-center text-lg text-red-500"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {error}
        </motion.div>
      ) : (
        <>
          <motion.div 
            ref={ref}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 px-6"
            variants={containerVariants}
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
          >
            {projects.slice(0, visibleProjectsCount).map((project, index) => (
              <motion.div 
                key={project.id} 
                className="relative rounded-lg shadow-2xl overflow-hidden group"
                variants={cardVariants}
                whileHover={{ 
                  scale: 1.05,
                  y: -8,
                  transition: { 
                    type: "spring", 
                    stiffness: 300, 
                    damping: 20 
                  }
                }}
                whileTap={{ scale: 0.98 }}
              >
                <motion.div 
                  className="absolute top-0 right-0 flex gap-2 p-2 bg-black bg-opacity-50 rounded-bl-lg z-10"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                >
                  {project.software_items && project.software_items.map((software, idx) => (
                    <motion.img 
                      key={idx} 
                      src={software.icon_url} 
                      alt={software.name} 
                      className="w-6 h-6"
                      whileHover={{ scale: 1.2, rotate: 5 }}
                      transition={{ type: "spring", stiffness: 400 }}
                    />
                  ))}
                </motion.div>
                <Link to={`/projects/${project.hash_id}`} className="block w-full h-full">
                  <motion.div className="relative overflow-hidden">
                    <motion.img 
                      src={project.cover.thumb_url} 
                      alt={project.title || 'ArtStation Project Image'} 
                      className="object-cover w-full h-full"
                      whileHover={{ scale: 1.1 }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                    <motion.div 
                      className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100"
                      transition={{ duration: 0.3 }}
                    />
                  </motion.div>
                  <motion.div 
                    className="absolute inset-0 flex flex-col justify-end p-5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                  >
                    <svg className="absolute bottom-0 left-0 w-60 h-60 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
                      <defs>
                        <linearGradient id={`grad-${project.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style={{ stopColor: '#ff7e5f', stopOpacity: 1 }} />
                          <stop offset="100%" style={{ stopColor: '#feb47b', stopOpacity: 1 }} />
                        </linearGradient>
                      </defs>
                      <g fill={`url(#grad-${project.id})`}>
                        <circle cx="80" cy="130" r="25" opacity="0.9" />
                        <circle cx="90" cy="160" r="40" opacity="0.7" />
                        <circle cx="120" cy="150" r="30" opacity="0.8" />
                        <circle cx="40" cy="165" r="40" opacity="0.6" />
                      </g>
                    </svg>
                    <motion.h2 
                      className="text-2xl font-semibold mb-2 tracking-wide text-white relative z-10"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
                    >
                      {project.title}
                    </motion.h2>
                    <motion.div 
                      className="text-sm text-blue-400 font-medium underline relative z-10"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4, duration: 0.5, ease: "easeOut" }}
                      whileHover={{ x: 5 }}
                    >
                      View Details →
                    </motion.div>
                  </motion.div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
          {visibleProjectsCount < projects.length && (
            <motion.div 
              className="relative text-center mt-10"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
            >
              <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 px-6 opacity-20 relative"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 0.2, scale: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              >
                {projects.slice(visibleProjectsCount, visibleProjectsCount + 3).map((project, index) => (
                  index < 3 && ( // Ensure only one row is displayed
                    <motion.div 
                      key={project.id} 
                      className="relative rounded-lg shadow-2xl overflow-hidden"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 0.2, y: 0 }}
                      transition={{ delay: index * 0.1, duration: 0.5 }}
                    >
                      <Link to={`/projects/${project.hash_id}`} className="block w-full h-full">
                        <img 
                          src={project.cover.thumb_url} 
                          alt={project.title || 'ArtStation Project Image'} 
                          className="object-cover w-full h-full"
                        />
                      </Link>
                    </motion.div>
                  )
                ))}
              </motion.div>
              <motion.button 
                onClick={loadMoreProjects}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition duration-300 relative z-20 mt-4"
                style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
                whileHover={{ 
                  scale: 1.05,
                  boxShadow: "0 0 25px rgba(59, 130, 246, 0.5)"
                }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ 
                  delay: 0.5, 
                  type: "spring", 
                  stiffness: 200, 
                  damping: 15 
                }}
              >
                Load More
              </motion.button>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
};

export default ArtStationProjects;
