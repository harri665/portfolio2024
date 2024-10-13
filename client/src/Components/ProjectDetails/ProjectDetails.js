import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion'; // Import framer-motion

const ProjectDetails = () => {
  const { id } = useParams(); // Get project ID from the URL params
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjectDetails = async () => {
      const apiBaseUrl = process.env.NODE_ENV === 'development' 
        ? 'http://localhost:3001/api/project' 
        : 'https://harrison-martin.com/api/project';

      try {
        const response = await fetch(`${apiBaseUrl}/${id}`);
        const data = await response.json();
        setProject(data);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching project details:', error);
        setLoading(false);
      }
    };

    fetchProjectDetails();
  }, [id]);

  if (loading) {
    return <div className="text-center text-gray-400">Loading...</div>;
  }

  if (!project) {
    return <div className="text-center text-gray-400">Project not found</div>;
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      transition={{ duration: 0.6, ease: 'easeOut' }} 
      className="container mx-auto p-8 bg-gray-800 text-white shadow-xl rounded-lg"
    >
      <motion.h1 
        className="text-5xl font-extrabold mb-6 text-center" 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        {project.title}
      </motion.h1>

      {/* User Information */}
      <motion.div 
        className="flex items-center space-x-6 mb-8" 
        initial={{ opacity: 0, scale: 0.95 }} 
        animate={{ opacity: 1, scale: 1 }} 
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <img 
          src={project.user.medium_avatar_url} 
          alt={project.user.full_name} 
          className="w-20 h-20 rounded-full shadow-lg"
        />
        <div>
          <h2 className="text-2xl font-semibold">{project.user.full_name}</h2>
          <a 
            href={project.user.permalink} 
            className="text-blue-400 hover:text-blue-500 transition-colors duration-300" 
            target="_blank" 
            rel="noopener noreferrer"
          >
            View Profile
          </a>
        </div>
      </motion.div>

      {/* Cover Image */}
      {project.cover_url && (
        <motion.img 
          src={project.cover_url} 
          alt={project.title} 
          className="mb-6 w-full h-auto object-cover rounded-xl shadow-2xl" 
          initial={{ opacity: 0.7, y: 10 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: 0.4, duration: 0.5 }}
        />
      )}

      {/* Video Player */}
      {project.assets && project.assets.length > 0 && project.assets[0].has_embedded_player && (
        <motion.div 
          className="mb-6" 
          dangerouslySetInnerHTML={{ __html: project.assets[0].player_embedded }} 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          transition={{ delay: 0.5, duration: 0.6 }}
        />
      )}

      {/* Description */}
      <motion.div 
        className="mb-6 text-gray-300 leading-relaxed" 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        <p className="text-lg">{project.description_html || "No description available."}</p>
      </motion.div>

      {/* Project Stats */}
      <motion.div 
        className="flex items-center space-x-6 mb-6 text-gray-400" 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        transition={{ delay: 0.7, duration: 0.5 }}
      >
        <span>👍 {project.likes_count} Likes</span>
        <span>👁️ {project.views_count} Views</span>
        <span>💬 {project.comments_count} Comments</span>
      </motion.div>

      {/* Link to ArtStation */}
      <motion.a 
        href={project.permalink} 
        className="inline-block text-blue-400 hover:text-blue-500 transition-colors duration-300 font-semibold"
        target="_blank" 
        rel="noopener noreferrer"
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        transition={{ delay: 0.8, duration: 0.5 }}
      >
        View on ArtStation
      </motion.a>
    </motion.div>
  );
};

export default ProjectDetails;
