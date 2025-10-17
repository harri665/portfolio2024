import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactPlayer from "react-player";
import { motion } from "framer-motion";
import { FaArrowLeft } from "react-icons/fa";

const ArtStationProject = () => {
  const { hashId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const assetRefs = useRef({});

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const response = await fetch(
          `https://artstation.harrison-martin.com/api/project/${hashId}`
        );
        if (!response.ok) throw new Error("Failed to load project");
        const data = await response.json();
        setProject(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [hashId]);

  useEffect(() => {
    if (!loading && project) {
      const assetId = window.location.hash.split("#")[2];
      if (assetId && assetRefs.current[assetId]) {
        const el = assetRefs.current[assetId];
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-4", "ring-cyan-400", "animate-pulse");
          setTimeout(() => el.classList.remove("ring-4", "ring-cyan-400", "animate-pulse"), 3000);
        }, 500);
      }
    }
  }, [loading, project]);

  if (loading)
    return (
      <motion.div 
        className="flex justify-center items-center h-screen bg-black text-gray-400 text-lg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.5, 1, 0.5]
          }}
          transition={{ 
            duration: 1.5, 
            repeat: Infinity,
            ease: "easeInOut"
          }}
        >
          Loading...
        </motion.div>
      </motion.div>
    );

  if (error)
    return (
      <motion.div 
        className="flex justify-center items-center h-screen bg-black text-red-500 text-lg"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        {error}
      </motion.div>
    );

  if (!project) return null;

  // Animation variants
  const sidebarVariants = {
    hidden: { x: -100, opacity: 0 },
    visible: { 
      x: 0, 
      opacity: 1,
      transition: { 
        type: "spring",
        stiffness: 100,
        damping: 20,
        staggerChildren: 0.1,
        delayChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { x: -20, opacity: 0 },
    visible: { 
      x: 0, 
      opacity: 1,
      transition: { type: "spring", stiffness: 100 }
    }
  };

  const mainVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { 
        duration: 0.8,
        ease: [0.6, -0.05, 0.01, 0.99]
      }
    }
  };

  const assetContainerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.3
      }
    }
  };

  const assetVariants = {
    hidden: { opacity: 0, y: 30, scale: 0.95 },
    visible: { 
      opacity: 1, 
      y: 0,
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 100,
        damping: 15
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#020202] text-gray-200 flex flex-col md:flex-row">
      {/* Sidebar */}
      <motion.aside
        variants={sidebarVariants}
        initial="hidden"
        animate="visible"
        className="w-full md:w-1/4 p-8 bg-gradient-to-b from-[#0a0a0a] to-[#141414] border-r border-white/5 backdrop-blur-lg"
      >
        <motion.button
          onClick={() => navigate(-1)}
          className="mb-8 flex items-center text-cyan-400 hover:text-white transition-colors"
          variants={itemVariants}
          whileHover={{ x: -5, scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <FaArrowLeft className="mr-2" /> Back
        </motion.button>

        <motion.div className="mb-8" variants={itemVariants}>
          <p className="text-gray-400">Published: {new Date(project.published_at).toLocaleDateString()}</p>
        </motion.div>

        <motion.div className="mt-10" variants={itemVariants}>
          <h2 className="text-xl font-semibold mb-3 text-white">Description</h2>
          <motion.div
            className="text-gray-400 text-sm leading-relaxed mb-8"
            dangerouslySetInnerHTML={{
              __html: project.description_html || "<p>No description available.</p>",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          />
        </motion.div>

        <motion.div className="mt-8" variants={itemVariants}>
          <h2 className="text-xl font-semibold mb-3 text-white">Software</h2>
          <div className="flex flex-wrap gap-2">
            {project.software_items.map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.05, type: "spring", stiffness: 200 }}
                whileHover={{ scale: 1.1, rotate: 3 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-2 backdrop-blur-md"
              >
                <img src={s.icon_url} alt={s.name} className="w-6 h-6" />
                <p className="text-xs font-medium text-gray-200">{s.name}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.aside>

      {/* Main Content */}
      <motion.main
        variants={mainVariants}
        initial="hidden"
        animate="visible"
        className="flex-1 p-10 overflow-y-auto"
      >
        <motion.h1 
          className="text-5xl font-bold text-white mb-6 tracking-tight"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
        >
          {project.title}
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.6, ease: "easeOut" }}
          whileHover={{ 
            scale: 1.02,
            boxShadow: "0 0 50px rgba(0,255,255,0.15)",
            transition: { duration: 0.3 }
          }}
          className="rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(0,255,255,0.05)] mb-10 max-h-[800px] flex items-center justify-center bg-black/20"
        >
          <motion.img
            src={project.cover_url}
            alt={project.title}
            className="w-full h-full object-contain rounded-2xl max-h-[800px]"
            initial={{ scale: 1.1, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
          />
        </motion.div>

        <motion.div 
          className="grid grid-cols-1 sm:grid-cols-2 gap-8"
          variants={assetContainerVariants}
          initial="hidden"
          animate="visible"
        >
          {project.assets
            .filter((a) => {
              // Only include assets that have valid content
              if (a.asset_type === "image" && a.image_url) return true;
              if (a.asset_type === "video_clip" && a.player_embedded) return true;
              return false;
            })
            .map((a, i) => (
              <motion.div
                key={a.id}
                ref={(el) => (assetRefs.current[a.id] = el)}
                variants={assetVariants}
                whileHover={{ 
                  scale: 1.03,
                  y: -5,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                  transition: { 
                    type: "spring", 
                    stiffness: 300, 
                    damping: 20 
                  }
                }}
                className="rounded-xl bg-white/5 border border-white/10 overflow-hidden backdrop-blur-sm max-h-[600px] flex items-center justify-center group"
              >
                {a.asset_type === "image" ? (
                  <motion.img 
                    src={a.image_url} 
                    alt={`Asset ${i}`} 
                    className="w-full h-full object-contain max-h-[600px]"
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                ) : a.asset_type === "video_clip" && a.player_embedded ? (
                  <ReactPlayer
                    url={a.player_embedded}
                    controls
                    width="100%"
                    height="100%"
                    muted
                    loop
                    playing
                  />
                ) : null}
              </motion.div>
            ))}
        </motion.div>
      </motion.main>
    </div>
  );
};

export default ArtStationProject;
