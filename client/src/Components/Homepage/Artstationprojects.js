import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';

import { apiUrl } from '../../utils/api';

const ArtStationProjects = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleProjectsCount, setVisibleProjectsCount] = useState(6);
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.15 });

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await fetch(apiUrl('/artstation/harr1'));

        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const data = await response.json();
        const projectsWithDetails = await Promise.all(
          data.data.map(async (project) => {
            try {
              const detailsResponse = await fetch(apiUrl(`/project/${project.hash_id}`));
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
      } catch (fetchError) {
        setError(fetchError.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const loadMoreProjects = () => {
    setVisibleProjectsCount((prevCount) => prevCount + 6);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.08,
      },
    },
  };

  const cardVariants = {
    hidden: {
      opacity: 0,
      y: 18,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        damping: 18,
        stiffness: 120,
      },
    },
  };

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-7">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/48">
            Selected Work
          </p>
          <motion.h2
            className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            ArtStation projects
          </motion.h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/65 sm:text-base">
            Project breakdowns with detail pages, process assets, and software
            used in each piece.
          </p>
        </div>

        {!loading && !error && (
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/65">
            {projects.length} projects
          </div>
        )}
      </div>

      {loading ? (
        <StateMessage>Loading projects...</StateMessage>
      ) : error ? (
        <StateMessage tone="error">{error}</StateMessage>
      ) : (
        <>
          <motion.div
            ref={ref}
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
            variants={containerVariants}
            initial="hidden"
            animate={inView ? 'visible' : 'hidden'}
          >
            {projects.slice(0, visibleProjectsCount).map((project) => (
              <motion.article
                key={project.id}
                variants={cardVariants}
                whileHover={{ y: -3 }}
                className="group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#111318] shadow-[0_14px_40px_rgba(0,0,0,0.32)]"
              >
                <Link to={`/projects/${project.hash_id}`} className="block h-full">
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#16181e]">
                    <motion.img
                      src={project.cover.thumb_url}
                      alt={project.title || 'ArtStation Project Image'}
                      className="h-full w-full object-cover"
                      whileHover={{ scale: 1.03 }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-white/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                    {Array.isArray(project.software_items) && project.software_items.length > 0 && (
                      <div className="absolute right-3 top-3 flex max-w-[70%] flex-wrap justify-end gap-1.5 rounded-2xl border border-white/12 bg-[#0f1115]/65 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                        {project.software_items.slice(0, 5).map((software, idx) => (
                          <img
                            key={`${project.id}-software-${idx}`}
                            src={software.icon_url}
                            alt={software.name}
                            title={software.name}
                            className="h-5 w-5 rounded"
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
                      Art Project
                    </p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
                      {project.title}
                    </h3>
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#4da3ff]">
                      View Details
                      <span aria-hidden="true">-&gt;</span>
                    </div>
                  </div>
                </Link>
              </motion.article>
            ))}
          </motion.div>

          {visibleProjectsCount < projects.length && (
            <div className="mt-8 flex justify-center">
              <motion.button
                onClick={loadMoreProjects}
                className="rounded-full bg-[#0a84ff] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(10,132,255,0.28)] transition-colors hover:bg-[#2997ff]"
                whileHover={{ y: -1, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                Load More
              </motion.button>
            </div>
          )}
        </>
      )}
    </section>
  );
};

function StateMessage({ children, tone = 'neutral' }) {
  const toneClasses =
    tone === 'error'
      ? 'border-red-300/20 bg-red-500/10 text-red-200'
      : 'border-white/10 bg-white/5 text-white/65';

  return (
    <motion.div
      className={`rounded-2xl border px-5 py-10 text-center text-sm font-medium ${toneClasses}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

export default ArtStationProjects;
