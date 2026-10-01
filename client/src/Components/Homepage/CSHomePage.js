import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import RelightStatus from './RelightStatus';
import SubdomainNav from './SubdomainNav';
import { PrismBackdrop, PrismHero, trackPointer } from './Prism';
import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl } from '../../utils/api';
import { mediaUrl } from '../../utils/mediaUrl';
import { prettyRepoName } from '../../utils/repoTitle';
import Button from '../ui/Button';
import Container from '../ui/Container';
import Tag from '../ui/Tag';

const GITHUB_USERNAME = 'harri665';

async function getResponseErrorMessage(response, fallbackMessage) {
  try {
    const data = await response.json();
    return data?.error || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

function normalizeHomepage(url) {
  if (!url) {
    return '';
  }

  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function sortRepos(repos) {
  return [...repos].sort((a, b) => {
    const aDate = new Date(a.pushed_at).getTime();
    const bDate = new Date(b.pushed_at).getTime();
    return bDate - aDate;
  });
}

function normalizeRepoName(name, caseSensitive) {
  return caseSensitive ? String(name || '') : String(name || '').toLowerCase();
}

function getRepoMatchKeys(repo, caseSensitive) {
  return [
    normalizeRepoName(repo?.name, caseSensitive),
    normalizeRepoName(repo?.full_name, caseSensitive),
  ].filter(Boolean);
}

function getWhitelistEntries(whitelistConfig = {}) {
  return Array.isArray(whitelistConfig?.repoNames)
    ? whitelistConfig.repoNames
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    : [];
}

function getExternalWhitelistEntries(whitelistConfig = {}) {
  return getWhitelistEntries(whitelistConfig).filter((entry) => entry.includes('/'));
}

function getRepoOrderIndex(repo, lookup, whitelistConfig) {
  const keys = getRepoMatchKeys(repo, whitelistConfig.caseSensitive);

  for (const key of keys) {
    if (lookup.has(key)) {
      return lookup.get(key);
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function applyRepoWhitelist(repos, whitelistConfig = {}) {
  if (!whitelistConfig?.enabled) {
    return repos;
  }

  const listedNames = getWhitelistEntries(whitelistConfig);

  if (listedNames.length === 0) {
    return [];
  }

  const lookup = new Map(
    listedNames.map((name, index) => [
      normalizeRepoName(name, whitelistConfig.caseSensitive),
      index,
    ])
  );

  const filtered = repos.filter((repo) =>
    getRepoMatchKeys(repo, whitelistConfig.caseSensitive).some((key) => lookup.has(key))
  );

  if (!whitelistConfig.preserveListedOrder) {
    return filtered;
  }

  return [...filtered].sort((a, b) => {
    const aIndex = getRepoOrderIndex(a, lookup, whitelistConfig);
    const bIndex = getRepoOrderIndex(b, lookup, whitelistConfig);

    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }

    return new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime();
  });
}

async function fetchRepoByFullName(fullName, signal) {
  const response = await fetch(
    apiUrl(`/github/repo?full_name=${encodeURIComponent(fullName)}`),
    { signal }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository not found: ${fullName}`);
    }

    if (response.status === 403) {
      throw new Error(`GitHub API rate limit reached while loading ${fullName}`);
    }

    throw new Error(
      await getResponseErrorMessage(
        response,
        `Failed to load repository ${fullName} (${response.status})`
      )
    );
  }

  return response.json();
}

async function fetchExternalWhitelistedRepos(whitelistConfig, signal) {
  const externalEntries = getExternalWhitelistEntries(whitelistConfig);

  if (!whitelistConfig?.enabled || externalEntries.length === 0) {
    return [];
  }

  const results = await Promise.all(
    externalEntries.map(async (fullName) => {
      try {
        const repo = await fetchRepoByFullName(fullName, signal);
        return repo?.fork ? null : repo;
      } catch (error) {
        console.error(error.message || `Failed to fetch ${fullName}`, error);
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

function mergeRepos(primaryRepos, additionalRepos) {
  const merged = new Map();

  [...primaryRepos, ...additionalRepos].forEach((repo) => {
    const key = repo.full_name || `${repo.owner?.login || 'unknown'}/${repo.name}`;
    if (!merged.has(key)) {
      merged.set(key, repo);
    }
  });

  return Array.from(merged.values());
}

export default function CSHomePage() {
  const [repos, setRepos] = useState([]);
  // Extras per repo from its project page or README: { title, media: { url, type }, tagline, live }
  const [readmeMeta, setReadmeMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function fetchRepositories() {
      try {
        const [configRes, reposRes] = await Promise.all([
          fetch(apiUrl('/cs-config'), { signal: controller.signal }),
          fetch(apiUrl(`/github/repos?${new URLSearchParams({ owner: GITHUB_USERNAME, per_page: '100', type: 'owner', sort: 'updated' })}`), { signal: controller.signal }),
        ]);

        const whitelist = configRes.ok ? await configRes.json() : { enabled: false };

        if (!reposRes.ok) {
          if (reposRes.status === 403) throw new Error('GitHub API rate limit reached. Please try again in a bit.');
          throw new Error(await getResponseErrorMessage(reposRes, `Failed to load GitHub projects (${reposRes.status})`));
        }

        const data = await reposRes.json();
        const publicOwnedRepos = data.filter((repo) => !repo.fork);
        const externalWhitelistedRepos = await fetchExternalWhitelistedRepos(whitelist, controller.signal);
        const combinedRepos = mergeRepos(publicOwnedRepos, externalWhitelistedRepos);
        const sortedRepos = sortRepos(combinedRepos);
        const visibleRepos = applyRepoWhitelist(sortedRepos, whitelist);

        setRepos(visibleRepos);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    }

    fetchRepositories();

    return () => controller.abort();
  }, []);

  // Titles and preview media come from the READMEs, read and cached by the
  // server, so browsing the page never spends the visitor's GitHub rate limit
  useEffect(() => {
    if (repos.length === 0) return undefined;
    const controller = new AbortController();
    const fullNames = repos.map((repo) => repo.full_name).join(',');

    fetch(apiUrl(`/github/readme-meta?${new URLSearchParams({ full_names: fullNames })}`), {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then(setReadmeMeta)
      .catch(() => {});

    return () => controller.abort();
  }, [repos]);

  return (
    <div className="relative min-h-screen bg-bg text-ink">
      <PrismBackdrop lens="cs" tone="page" />
      <SubdomainNav currentMode={SITE_MODES.CS} />
      <PrismHero
        fullHeight
        peek
        align="left"
        glassTitle
        title="Computer science"
        subtitle="GPU simulations, renderers, and full-stack apps, plus the tools I build along the way."
      />

      <Container as="main" id="projects" className="relative z-10 pb-24">
        {loading && <p className="py-10 text-sm text-ink-3">Loading projects from GitHub…</p>}
        {error && <p className="py-10 text-sm text-red-300">{error}</p>}

        {!loading && !error && repos.length === 0 && (
          <p className="py-10 text-sm text-ink-3">No repositories found.</p>
        )}

        {!loading && !error && repos.length > 0 && (
          // data-prism-panel: the Cornell box's camera walks in as this rises
          // (RelightBackdrop), and its light moves behind the hovered card
          <section data-prism-panel className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {repos.map((repo) => (
              <RepoCard key={repo.id} repo={repo} meta={readmeMeta[repo.full_name]} />
            ))}
          </section>
        )}

        <p className="mt-16 text-sm text-ink-3">
          Curious how this site works?{' '}
          <Link to="/colophon" className="text-ink-2 underline decoration-line/25 underline-offset-4 transition-colors hover:text-ink">
            How this site is built
          </Link>
        </p>

        <RelightStatus />
      </Container>
    </div>
  );
}

// The whole card opens the project page; the GitHub and demo buttons inside
// it go straight out, so they sit above the card's link.
function RepoCard({ repo, meta }) {
  const demoUrl = normalizeHomepage(meta?.live || repo.homepage);
  const title = meta?.title || prettyRepoName(repo.name);
  const summary = meta?.tagline || repo.description;
  const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 4) : [];
  // Pointer over the card or keyboard focus inside it plays its preview video
  const [engaged, setEngaged] = useState(false);

  return (
    <article
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
      onPointerMove={trackPointer}
      // glass over the relit room, which bends it at the rim, with its bottom
      // corners bevelled, frosted further while hovered (LiquidGlassPass)
      data-liquid-glass
      data-glass-bevel
      data-glass-hover
      className="liquid-glass prism-glow lens-cs group relative flex flex-col overflow-hidden rounded-card"
    >
      <span aria-hidden="true" className="liquid-glass-rim" />
      {meta?.media && (
        <MediaPreview media={{ ...meta.media, url: mediaUrl(meta.media.url) }} engaged={engaged} />
      )}

      {/* above the glass rim; a flex item needs no position for its z-index,
          so the title link still stretches over the whole card */}
      <div className="z-[2] flex flex-1 flex-col p-5">
        {repo.language && <p className="mb-2 text-sm text-accent">{repo.language}</p>}

        <h2 className="text-xl font-semibold tracking-tight text-ink">
          <Link to={`/${repo.name}`} className="after:absolute after:inset-0 after:content-['']">
            {title}
          </Link>
        </h2>

        {/* full-strength ink with a tight dark halo, so it reads over the
            lamp's light through the glass without darkening the glass */}
        {summary && (
          <p className="mt-2 text-sm leading-relaxed text-ink [text-shadow:0_1px_2px_rgb(0_0_0/0.7),0_0_12px_rgb(0_0_0/0.55)]">
            {summary}
          </p>
        )}

        {topics.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {topics.map((topic) => <Tag key={topic}>{topic}</Tag>)}
          </div>
        )}

        <div className="relative z-10 mt-auto flex flex-wrap gap-2 pt-5">
          <Button size="sm" href={repo.html_url} target="_blank" rel="noopener noreferrer">
            GitHub
          </Button>
          {demoUrl && (
            <Button size="sm" href={demoUrl} target="_blank" rel="noopener noreferrer">
              Live demo
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

// Previews are still until asked: a video plays while its card is hovered or
// focused, or, on touch screens (which can't hover), while it is mostly on
// screen. Reduced motion keeps them still. Until then it shows its first frame.
function MediaPreview({ media, engaged }) {
  const videoRef = useRef(null);
  const [inView, setInView] = useState(false);
  const isVideo = media.type === 'video';

  useEffect(() => {
    const video = videoRef.current;
    if (!isVideo || !video) return undefined;
    // React only sets `muted` as a property; iOS needs the attribute too or it
    // refuses inline playback and kicks the video fullscreen.
    video.setAttribute('muted', '');

    const touch = window.matchMedia?.('(hover: none)').matches;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!touch || still) return undefined;

    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.6,
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [isVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (engaged || inView) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [engaged, inView]);

  const fitClass = isVideo ? 'object-contain' : 'object-cover';

  return (
    <div className="relative z-[2] aspect-[16/9] w-full overflow-hidden border-b border-line/9 bg-bg">
      {isVideo ? (
        <video
          ref={videoRef}
          // #t= makes the browser load and show a first frame instead of black
          src={`${media.url}#t=0.1`}
          preload="metadata"
          // Recordings often open on a black frame before anything happens, so
          // the still is taken a little way in
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.paused && Number.isFinite(video.duration)) {
              video.currentTime = Math.min(video.duration * 0.2, 3);
            }
          }}
          loop
          muted
          playsInline
          webkit-playsinline="true"
          className={`h-full w-full ${fitClass}`}
        />
      ) : (
        <img src={media.url} alt="" loading="lazy" className={`h-full w-full ${fitClass}`} />
      )}
    </div>
  );
}
