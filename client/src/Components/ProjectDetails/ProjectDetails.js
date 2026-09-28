import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactPlayer from 'react-player';

import { apiUrl } from '../../utils/api';
import CommentSection from '../Comments/CommentSection';
import SubdomainNav from '../Homepage/SubdomainNav';
import { HOVER_LIFT, PrismBackdrop, Reveal, useScrollReveal } from '../Homepage/Prism';
import { motion } from 'framer-motion';
import { SITE_MODES } from '../../utils/siteMode';
import { WORKS } from '../Homepage/ArtGallery';
import Container from '../ui/Container';
import PageHeader from '../ui/PageHeader';
import '../Homepage/gallery.css';

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

// Descriptions come from ArtStation as HTML; an empty one is often just <p></p>
function hasText(html) {
  return Boolean(html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
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

// The asset grid is six columns wide, so a wide frame claims more of it.
function getAssetSpan(asset) {
  const ratio = getAssetAspectRatio(asset);

  if (!ratio) {
    return asset.asset_type === 'video_clip' ? 3 : 2;
  }

  if (ratio >= 1.9) {
    return 6;
  }

  if (ratio >= 1.2) {
    return 3;
  }

  return 2;
}

function getAssetFrameStyle(asset) {
  const dimensions = getAssetDimensions(asset);

  if (dimensions) {
    return { aspectRatio: `${dimensions.width} / ${dimensions.height}` };
  }

  // Videos need a box to render into; an image without known dimensions can
  // just set its own height rather than sit letterboxed in a square.
  return asset.asset_type === 'video_clip' ? { aspectRatio: '16 / 9' } : undefined;
}

const ArtProject = () => {
  const { identifier } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const assetRefs = useRef({});

  useEffect(() => {
    async function fetchProject() {
      try {
        const response = await fetch(apiUrl(`/project/by-identifier/${encodeURIComponent(identifier)}`));

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
  }, [identifier]);

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
      assetElement.classList.add('gd-asset-focus');

      setTimeout(() => {
        assetElement.classList.remove('gd-asset-focus');
      }, 3500);
    }, 500);
  }, [loading, project]);

  if (loading || error) {
    return (
      <PageShell>
        <PageHeader back={BACK} title={error ? 'This project didn’t load' : ''} />
        <p className={`mt-4 text-sm ${error ? 'text-red-300' : 'text-ink-3'}`}>
          {error || 'Loading project…'}
        </p>
      </PageShell>
    );
  }

  if (!project) {
    return null;
  }

  const softwareItems = project.software_items || [];
  const assets = validAssets(project.assets);
  const hasOverview = hasText(project.description_html);
  // The ArtStation title can lose its capitals ("Roam Vr Room"); the gallery's is hand-written
  const title = WORKS.find((w) => w.id === identifier || w.id === project.hash_id)?.t || project.title;
  // A single image is already the cover, so a gallery of it would repeat it
  const showGallery = !(assets.length === 1 && assets[0].asset_type === 'image' && project.cover_url);

  return (
    <PageShell cover={project.cover_url}>
      <PageHeader
        back={BACK}
        title={title}
        // the software has its own panel below, so the header keeps only the date
        meta={[formatDate(project.published_at)]}
        className="mb-10"
      />

      {project.cover_url && (
        <Reveal className="gd-cover">
          <img src={project.cover_url} alt={title} />
        </Reveal>
      )}

      {(hasOverview || softwareItems.length > 0) && (
        <div className={`gd-cols${hasOverview ? '' : ' gd-cols-single'}`}>
          {hasOverview && (
            <Reveal as="section" className="gd-panel">
              <div className="gd-panel-head">
                <h2 className="gd-label">Overview</h2>
              </div>
              <div className="gd-panel-body">
                <div
                  className="gd-prose"
                  dangerouslySetInnerHTML={{ __html: project.description_html }}
                />
              </div>
            </Reveal>
          )}

          {softwareItems.length > 0 && (
            <aside className="gd-rail">
              <Reveal as="section" index={1} className="gd-panel">
                <div className="gd-panel-head">
                  <h2 className="gd-label">Software</h2>
                </div>
                <div className="gd-panel-body">
                  <div className="gd-chips">
                    {softwareItems.map((software) => (
                      <span
                        key={`${software.name}-${software.id || software.icon_url}`}
                        className="gd-chip"
                      >
                        <img src={software.icon_url} alt="" aria-hidden="true" />
                        {software.name}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            </aside>
          )}
        </div>
      )}

      {showGallery && (
        <section className="gd-gallery">
          <div className="gd-gallery-head">
            <h2 className="gd-label">Gallery</h2>
          </div>
          <div className="gd-assets">
            {assets.map((asset, index) => (
              <AssetTile
                key={asset.id}
                index={index}
                tileRef={(el) => {
                  assetRefs.current[asset.id] = el;
                }}
                id={asset.id}
                className={`gd-asset gd-span-${getAssetSpan(asset)}`}
              >
                <div className="gd-asset-frame" style={getAssetFrameStyle(asset)}>
                  {asset.asset_type === 'image' ? (
                    <img
                      src={asset.image_url}
                      alt={`Asset ${index + 1}`}
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
                      playsinline
                      config={{
                        file: {
                          attributes: {
                            playsInline: true,
                            'webkit-playsinline': 'true',
                            'x5-playsinline': 'true',
                          },
                        },
                      }}
                    />
                  )}
                </div>
              </AssetTile>
            ))}
          </div>
        </section>
      )}

      {/* Comments read better at text width than across the full asset grid */}
      <Reveal className="gd-comments">
        <CommentSection type="art" id={project.hash_id || identifier} />
      </Reveal>
    </PageShell>
  );
};

// An asset tile that rises in as it scrolls into view, staggered across
// its row. `tileRef` feeds the deep-link scroll to a specific asset.
function AssetTile({ index, tileRef, className, children, ...props }) {
  const reveal = useScrollReveal(index);
  return (
    <motion.div
      ref={tileRef}
      {...reveal}
      whileHover={HOVER_LIFT}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// `cover` becomes the page's backdrop once the project has loaded
function PageShell({ cover, children }) {
  return (
    <div className="gx nf gd">
      <PrismBackdrop lens="art" tone="detail" image={cover} />
      <SubdomainNav currentMode={SITE_MODES.ART} />
      <Container as="main" className="relative z-[1] pb-24 pt-28 sm:pt-32">
        {children}
      </Container>
    </div>
  );
}

const BACK = { label: 'Art', to: '/' };

export default ArtProject;
