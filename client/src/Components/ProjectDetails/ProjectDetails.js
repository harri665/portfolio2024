import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import ReactPlayer from 'react-player';
import { motion } from 'framer-motion';
import { FaEye, FaHeart, FaArrowLeft } from 'react-icons/fa';

const ArtStationProject = () => {
  const { hashId } = useParams(); // Get the hashId from the route parameter

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const assetRefs = useRef({}); // Store refs for each asset

  useEffect(() => {
    // Fetch data for the specific project using the passed hash ID
    const fetchProject = async () => {
      try {
        const response = await fetch(`https://artstation.harrison-martin.com/api/project/${hashId}`);
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const data = await response.json();
        setProject(data);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchProject();
  }, [hashId]); // Refetch if the hashId changes

  useEffect(() => {
    // Scroll to the asset if the URL contains a fragment identifier
    const scrollToAsset = () => {
      const fullHash = window.location.hash;
      const assetId = fullHash.split("#")[2]; // Extract the assetId after the second '#'

      if (assetId && assetRefs.current[assetId]) {
        // Scroll the asset into view
        setTimeout(() => {
          const assetElement = assetRefs.current[assetId];
          assetElement.scrollIntoView({ behavior: "smooth", block: "center" });

          // Highlight the asset using Tailwind CSS classes for a modern glowing effect
          assetElement.classList.add("ring-4", "ring-blue-600", "ring-offset-4", "ring-offset-gray-900", "animate-pulse");
          setTimeout(() => {
            assetElement.classList.remove("ring-4", "ring-blue-900", "ring-offset-4", "ring-offset-gray-900", "animate-pulse");
          }, 4000); // Remove highlight after 2 seconds
        }, 500); // Delay to ensure the element is rendered
      }
    };

    if (!loading && project) {
      scrollToAsset();
    }
  }, [loading, project]);

  if (loading) {
    return <div className="text-center text-white">Loading...</div>;
  }

  if (error) {
    return <div className="text-center text-red-500">Error: {error}</div>;
  }

  if (!project) {
    return null;
  }

  return (
    <div className="flex flex-col md:flex-row bg-gray-900 text-white min-h-screen">
      {/* Sidebar for Project Details and Software Used */}
      <motion.div
        initial={{ x: -300 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full md:w-1/4 bg-gray-800 p-6 shadow-lg"
      >
        <button
          onClick={() => window.location.href = '/'}
          className="mb-6 flex items-center text-lg text-blue-400 underline hover:text-blue-600 transition-colors duration-300"
        >
          <FaArrowLeft className="mr-2" /> Back
        </button>
        {/* Project details */}
        <div className="mb-12">
          <h2 className="text-3xl font-semibold mb-4">Project Details</h2>
          <p className="text-lg text-gray-400 flex items-center">
            <FaEye className="mr-2" /> Views: <span className="font-bold text-white ml-2">{project.views_count}</span>
          </p>
          <p className="text-lg text-gray-400 flex items-center">
            <FaHeart className="mr-2" /> Likes: <span className="font-bold text-white ml-2">{project.likes_count}</span>
          </p>
          <p className="text-lg text-gray-400">Published: <span className="font-bold text-white">{new Date(project.published_at).toLocaleDateString()}</span></p>
          <p className="mt-4">
            {/* <a
              href={project.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xl text-blue-400 underline hover:text-blue-600 transition-colors duration-300"
            >
              View on ArtStation
            </a> */}
          </p>
        </div>

        {/* Software used */}
        <div className="mb-12">
          <h2 className="text-3xl font-semibold mb-4">Software Used</h2>
          <div className="flex flex-wrap gap-6">
            {project.software_items.map((software, index) => (
              <motion.div
                key={index}
                className="flex items-center gap-4 p-4 bg-gray-700 rounded-lg shadow-sm"
                whileHover={{ scale: 1.05 }}
              >
                <img src={software.icon_url} alt={software.name} className="w-12 h-12" />
                <p className="text-lg font-semibold text-white">{software.name}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Main content */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.01 }}
        className="w-full md:w-3/4 p-8"
      >
        <h1 className="text-5xl font-bold mb-6 text-center md:text-left">{project.title}</h1>
        <div className="text-gray-400 mb-8 text-center md:text-left">
          <div dangerouslySetInnerHTML={{ __html: project.description_html || '<p>No description available.</p>' }} />
        </div>

        {/* Project cover with max width, max height, and aspect ratio preservation */}
        <motion.div
          className="mb-12 mx-auto flex justify-center"
          whileHover={{ scale: 1.05 }}
        >
          <img
            src={project.cover_url}
            alt={project.title}
            className="w-full max-w-4xl max-h-96 h-auto object-contain rounded-lg shadow-2xl"
          />
        </motion.div>

        {/* Project assets (images, videos) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-16">
          {project.assets.map((asset, index) => (
            <motion.div
              key={asset.id}
              ref={(el) => (assetRefs.current[asset.id] = el)} // Assign ref to each asset
              id={asset.id} // Assign the asset ID for scrolling purposes
              className="rounded-lg overflow-hidden bg-gray-800 shadow-md"
              whileHover={{ scale: 1.05 }}
            >
              {asset.asset_type === "image" && (
                <img
                  src={asset.image_url}
                  alt={`Asset ${index}`}
                  className="w-full h-auto rounded-lg"
                />
              )}
              {asset.asset_type === "video_clip" && asset.player_embedded && (
                <ReactPlayer
                  url={asset.player_embedded} // Using the direct video URL from the JSON response
                  controls={true}
                  width="100%"
                  height="100%"
                  playing={true} // Auto-play the video
                  muted={true} // Mute the video
                  loop={true} // Repeat the video
                  className="rounded-lg"
                />
              )}
            </motion.div>
          ))}
        </div>

        {/* User info */}
        <motion.div
          className="flex items-center p-6 bg-gray-800 rounded-lg shadow-lg"
          whileHover={{ scale: 1.05 }}
        >
          <img
            src={project.user.large_avatar_url}
            alt={project.user.full_name}
            className="w-20 h-20 rounded-full shadow-xl"
          />
          <div className="ml-6">
            <h2 className="text-3xl font-bold text-white">{project.user.full_name}</h2>
            <p className="text-lg text-gray-400">{project.user.headline}</p>
            <a
              href={project.user.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg text-blue-400 underline hover:text-blue-600 transition-colors duration-300"
            >
              View profile
            </a>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default ArtStationProject;
