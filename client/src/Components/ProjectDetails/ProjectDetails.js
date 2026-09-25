import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactPlayer from 'react-player';

import { apiUrl } from '../../utils/api';
import CommentSection from '../Comments/CommentSection';
import SubdomainNav from '../Homepage/SubdomainNav';
import { getSiteHref, SITE_MODES } from '../../utils/siteMode';
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

  if (loading) {
    return (
      <PageShell>
        <div className="gd-status">loading project…</div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <div className="gd-status gd-status-error">error: {error}</div>
      </PageShell>
    );
  }

  if (!project) {
    return null;
  }

  const softwareItems = project.software_items || [];
  const assets = validAssets(project.assets);

  return (
    <PageShell>
      <a href={getSiteHref(SITE_MODES.ART)} className="gd-back">
        <span className="gd-back-arrow">←</span>
        Art index
      </a>

      <header className="nf-head">
        <div className="nf-eyebrow">3D Art / Project</div>
        <h1 className="nf-title">{project.title}</h1>
        <p className="gd-metaline">
          <span>{formatDate(project.published_at)}</span>
          <span className="gd-sep">·</span>
          <span>{assets.length} {assets.length === 1 ? 'asset' : 'assets'}</span>
          {softwareItems.length > 0 && (
            <>
              <span className="gd-sep">·</span>
              <span>{softwareItems.map((software) => software.name).join(', ')}</span>
            </>
          )}
        </p>
      </header>

      {project.cover_url && (
        <div className="gd-cover">
          <img src={project.cover_url} alt={project.title} />
        </div>
      )}

      <div className="gd-cols">
        <section className="gd-panel">
          <div className="gd-panel-head">
            <span className="gd-label">Overview</span>
          </div>
          <div className="gd-panel-body">
            <div
              className="gd-prose"
              dangerouslySetInnerHTML={{
                __html: project.description_html || '<p>No description available.</p>',
              }}
            />
          </div>
        </section>

        <aside className="gd-rail">
          <section className="gd-panel">
            <div className="gd-panel-head">
              <span className="gd-label">Software</span>
            </div>
            <div className="gd-panel-body">
              {softwareItems.length > 0 ? (
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
              ) : (
                <p className="gd-note">No software metadata available.</p>
              )}
            </div>
          </section>

        </aside>
      </div>

      <section className="gd-panel">
        <div className="gd-panel-head">
          <span className="gd-label">Gallery</span>
          <span className="gd-panel-count">
            {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
          </span>
        </div>
        <div className="gd-panel-body">
          <div className="gd-assets">
            {assets.map((asset, index) => (
              <div
                key={asset.id}
                ref={(el) => {
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
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comments read better at text width than across the full asset grid */}
      <div className="gd-comments">
        <CommentSection
          type="art"
          id={project.hash_id || identifier}
          variant="gallery"
        />
      </div>
    </PageShell>
  );
};

function PageShell({ children }) {
  return (
    <div className="gx nf gd">
      <div className="nf-dots" aria-hidden="true" />
      <SubdomainNav currentMode={SITE_MODES.ART} />
      <div className="gx-shell" style={{ paddingTop: '108px' }}>
        {children}
      </div>
    </div>
  );
}

export default ArtProject;
