import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactPlayer from 'react-player';
import { motion } from 'framer-motion';
import { FaArrowLeft } from 'react-icons/fa';

import { apiUrl } from '../../utils/api';
import { getSiteHref, SITE_MODES } from '../../utils/siteMode';

function formatDate(value) {
  if (!value) {
    return 'Unknown';
  }

  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function validAssets(assets) {
  return (assets || []).filter((asset) => {
    if (asset.asset_type === 'image' && asset.image_url) {
      return true;
    }

    if (asset.asset_type === 'video_clip' && asset.player_embedded) {
      return true;
    }

    return false;
  });
}

function getAssetDimensions(asset) {
  const width = Number(asset?.width || asset?.oembed?.width || 0);
  const height = Number(asset?.height || asset?.oembed?.height || 0);

  if (!width || !height) {
    return null;
  }

  return { width, height };
}

function getAssetAspectRatio(asset) {
  const dimensions = getAssetDimensions(asset);

  if (!dimensions) {
    return null;
  }

  return dimensions.width / dimensions.height;
}

function getAssetSpanClasses(asset) {
  const ratio = getAssetAspectRatio(asset);

  if (!ratio) {
    return asset.asset_type === 'video_clip'
      ? 'md:col-span-2 xl:col-span-3'
      : 'md:col-span-1 xl:col-span-2';
  }

  if (ratio >= 1.9) {
    return 'md:col-span-2 xl:col-span-6';
  }

  if (ratio >= 1.2) {
    return 'md:col-span-2 xl:col-span-3';
  }

  return 'md:col-span-1 xl:col-span-2';
}

function getAssetFrameProps(asset) {
  const dimensions = getAssetDimensions(asset);

  if (dimensions) {
    return {
      style: { aspectRatio: `${dimensions.width} / ${dimensions.height}` },
      className: 'relative w-full bg-[#0d0f14]',
    };
  }

  if (asset.asset_type === 'video_clip') {
    return {
      style: undefined,
      className: 'relative w-full aspect-video bg-black',
    };
  }

  return {
    style: undefined,
    className: 'relative w-full aspect-square bg-[#0d0f14]',
  };
}

const ArtStationProject = () => {
  const { hashId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const assetRefs = useRef({});

  useEffect(() => {
    async function fetchProject() {
      try {
        const response = await fetch(apiUrl(`/project/${hashId}`));

        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const data = await response.json();
        setProject(data);
      } catch (err) {
        setError(err.message || 'Failed to load project');
      } finally {
        setLoading(false);
      }
    }

    fetchProject();
  }, [hashId]);

  useEffect(() => {
    if (loading || !project) {
      return;
    }

    const fullHash = window.location.hash;
    const assetId = fullHash.split('#')[2];

    if (!assetId || !assetRefs.current[assetId]) {
      return;
    }

    setTimeout(() => {
      const assetElement = assetRefs.current[assetId];
      assetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      assetElement.classList.add(
        'ring-4',
        'ring-[#0a84ff]',
        'ring-offset-4',
        'ring-offset-[#08090c]',
        'animate-pulse'
      );

      setTimeout(() => {
        assetElement.classList.remove(
          'ring-4',
          'ring-[#0a84ff]',
          'ring-offset-4',
          'ring-offset-[#08090c]',
          'animate-pulse'
        );
      }, 3500);
    }, 500);
  }, [loading, project]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090c] px-4 py-24 text-white sm:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/5 px-6 py-12 text-center text-white/70 shadow-[0_16px_45px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          Loading project...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#08090c] px-4 py-24 text-white sm:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-300/20 bg-red-500/10 px-6 py-12 text-center text-red-200 shadow-[0_16px_45px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          Error: {error}
        </div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  const softwareItems = project.software_items || [];
  const assets = validAssets(project.assets);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08090c] text-white">
      <BackgroundDecor />

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-6 flex items-center justify-between gap-3"
        >
          <a
            href={getSiteHref(SITE_MODES.ART)}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
          >
            <FaArrowLeft className="text-xs" />
            Back to Art
          </a>

          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/65 sm:text-sm">
            Published {formatDate(project.published_at)}
          </div>
        </motion.div>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-6 rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
            Art Project
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            {project.title}
          </h1>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.04 }}
          whileHover={{ y: -2 }}
          className="mb-6 rounded-[1.75rem] border border-white/10 bg-[#0f1116] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.3)]"
        >
          <img
            src={project.cover_url}
            alt={project.title}
            className="mx-auto w-full max-w-5xl max-h-[34rem] rounded-2xl object-contain"
          />
        </motion.section>

        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08 }}
            className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
              Overview
            </p>
            <div className="prose prose-invert prose-sm sm:prose-base mt-5 max-w-none text-white/75 prose-p:text-white/70 prose-a:text-[#4da3ff] prose-strong:text-white">
              <div
                dangerouslySetInnerHTML={{
                  __html: project.description_html || '<p>No description available.</p>',
                }}
              />
            </div>
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="lg:sticky lg:top-6"
          >
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                Software
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {softwareItems.length > 0 ? (
                  softwareItems.map((software) => (
                    <div
                      key={`${software.name}-${software.id || software.icon_url}`}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
                    >
                      <img
                        src={software.icon_url}
                        alt={software.name}
                        className="h-4 w-4 rounded-sm"
                      />
                      <span>{software.name}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-white/60">No software metadata available.</p>
                )}
              </div>
            </div>
          </motion.aside>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12 }}
          className="mb-6 rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-6"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
              Gallery
            </p>
            <p className="text-xs text-white/55 sm:text-sm">{assets.length} assets</p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-6">
            {assets.map((asset, index) => (
              <motion.div
                key={asset.id}
                ref={(el) => {
                  assetRefs.current[asset.id] = el;
                }}
                id={asset.id}
                whileHover={{ y: -2 }}
                className={`overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#101218] shadow-[0_14px_36px_rgba(0,0,0,0.28)] ${getAssetSpanClasses(asset)}`}
              >
                {(() => {
                  const frame = getAssetFrameProps(asset);

                  return (
                    <div className={frame.className} style={frame.style}>
                      {asset.asset_type === 'image' ? (
                        <img
                          src={asset.image_url}
                          alt={`Asset ${index + 1}`}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <ReactPlayer
                          url={asset.player_embedded}
                          controls
                          width="100%"
                          height="100%"
                          muted
                          loop
                          playing
                        />
                      )}
                    </div>
                  );
                })()}
              </motion.div>
            ))}
          </div>
        </motion.section>

        {project.user && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.14 }}
            whileHover={{ y: -2 }}
            className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-6"
          >
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <img
                src={project.user.large_avatar_url}
                alt={project.user.full_name}
                className="h-16 w-16 rounded-full border border-white/10 object-cover shadow-[0_10px_24px_rgba(0,0,0,0.3)] sm:h-20 sm:w-20"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                  Artist
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  {project.user.full_name}
                </h2>
                <p className="mt-1 text-sm text-white/65 sm:text-base">
                  {project.user.headline}
                </p>
                <a
                  href={project.user.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
                >
                  View Profile
                </a>
              </div>
            </div>
          </motion.section>
        )}
      </div>
    </div>
  );
};

function BackgroundDecor() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute left-[-5rem] top-[12rem] h-60 w-60 rounded-full bg-sky-500/12 blur-3xl" />
      <div className="absolute right-[8%] top-[8rem] h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="absolute bottom-[10%] left-[35%] h-80 w-80 rounded-full bg-cyan-400/8 blur-3xl" />
      <div className="absolute inset-0 opacity-10 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.75)_1px,transparent_0)] [background-size:22px_22px]" />
    </div>
  );
}

export default ArtStationProject;
