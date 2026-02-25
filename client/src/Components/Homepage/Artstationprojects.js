import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';

function toPlainText(htmlOrText = '') {
  return htmlOrText
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(text, maxLength = 120) {
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

const ArtStationProjects = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleProjectsCount, setVisibleProjectsCount] = useState(8); // 2 rows initially (4 projects per row)
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
              const descriptionPreview = truncateText(
                toPlainText(details.description_html || details.description || ''),
                140
              );

              return {
                ...project,
                software_items: details.software_items,
                description_preview:
                  descriptionPreview || 'View project breakdown and process assets.',
              };
            } catch (err) {
              console.error('Error fetching project details:', err);
              return {
                ...project,
                software_items: [],
                description_preview: 'View project breakdown and process assets.',
              };
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
    setVisibleProjectsCount((prevCount) => prevCount + 8);
  };

  return (
    <div className="min-h-screen text-white ">
      <motion.h1 
        className="text-4xl sm:text-5xl font-semibold text-center mb-10 tracking-tight"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
      >
        Projects: 
      </motion.h1>
      {loading ? (
        <motion.div
          className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-center text-lg text-white/75 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          Loading...
        </motion.div>
      ) : error ? (
        <motion.div
          className="mx-auto max-w-xl rounded-2xl border border-red-300/20 bg-red-500/10 px-6 py-10 text-center text-lg text-red-200 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          {error}
        </motion.div>
      ) : (
        <>
          <motion.div 
            ref={ref}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1 "
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : { opacity: 1 }}
            transition={{ duration: 0.8, staggerChildren: 0.2, ease: 'easeInOut' }}
          >
            {projects.slice(0, visibleProjectsCount).map((project) => (
              <motion.div 
                key={project.id} 
                className="group relative rounded-lg border border-white/10 bg-[#0f1116] shadow-[0_18px_45px_rgba(0,0,0,0.32)] overflow-hidden transition-transform duration-300"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.5, y: -4, zIndex: 999}}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
              >
                <div className="absolute top-0 right-0 z-10 flex gap-2 p-2 bg-[#0f1116]/70 backdrop-blur-xl border-l border-b border-white/10 rounded-bl-lg">
                  {project.software_items && project.software_items.map((software, index) => (
                    <img key={index} src={software.icon_url} alt={software.name} className="w-6 h-6" />
                  ))}
                </div>
                <Link to={`/projects/${project.hash_id}`} className="block w-full h-full">
                  <motion.img 
                    src={project.cover.thumb_url} 
                    alt={project.title || 'ArtStation Project Image'} 
                    className="object-cover w-full h-full"
                    whileHover={{ scale: 1.03 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-5">
                    <div className="pointer-events-none absolute inset-x-6 bottom-10 h-16 rounded-full bg-gradient-to-r from-transparent via-[#0a84ff]/35 to-transparent blur-2xl opacity-80" />
                    <div className="relative z-10 rounded-2xl border border-white/10 p-4 shadow-[0_14px_28px_rgba(0,0,0,0.28)] backdrop-blur-lg transition-colors duration-300 group-hover:bg-[#0b0d12]/55">
                      <motion.h2 
                        className="md:text-sm sm:text-2xl font-semibold mb-2 tracking-tight text-white"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      >
                        {project.title}
                      </motion.h2>
                      <motion.div 
                        className="text-xs text-[#4da3ff] font-semibold"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                      >
                        View Details
                      </motion.div>
                      <p className="mt-2 overflow-hidden text-[11px] leading-relaxed text-white/75 opacity-0 max-h-0 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:max-h-24">
                        {project.description_preview}
                      </p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
          {visibleProjectsCount < projects.length && (
            <div className="relative text-center mt-10">
              <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 px-6 opacity-20 relative"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, ease: 'easeInOut' }}
              >
                {projects.slice(visibleProjectsCount, visibleProjectsCount + 4).map((project, index) => (
                  index < 4 && ( // Ensure only one row is displayed
                    <div key={project.id} className="relative rounded-lg border border-white/10 shadow-[0_18px_45px_rgba(0,0,0,0.28)] overflow-hidden">
                      <Link to={`/projects/${project.hash_id}`} className="block w-full h-full">
                        <img 
                          src={project.cover.thumb_url} 
                          alt={project.title || 'ArtStation Project Image'} 
                          className="object-cover w-full h-full opacity-20"
                        />
                      </Link>
                    </div>
                  )
                ))}
              </motion.div>
              <button 
                onClick={loadMoreProjects}
                className="bg-[#0a84ff] hover:bg-[#2997ff] text-white font-semibold py-3 px-8 rounded-full transition duration-300 relative z-20 mt-4 shadow-[0_12px_24px_rgba(10,132,255,0.28)]"
                style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
              >
                Load More
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ArtStationProjects;
