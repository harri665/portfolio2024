import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import SubdomainNav from './SubdomainNav';
import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl } from '../../utils/api';
import { prettyRepoName } from '../../utils/repoTitle';
import Button from '../ui/Button';
import Container from '../ui/Container';
import SectionIntro from '../ui/SectionIntro';
import Tag from '../ui/Tag';

const GITHUB_USERNAME = 'harri665';

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
  // README-derived extras per repo: { title, media: { url, type } }
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

  // server reads + caches the readmes so visitors don't burn their github rate limit
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
    <div className="drafting-grid relative min-h-screen text-ink">
      <SubdomainNav currentMode={SITE_MODES.CS} />
      <SectionIntro title="Computer science">
        Software, tools, and research code, pulled live from GitHub.
      </SectionIntro>

      <Container as="main" id="projects" className="relative z-10 pb-24">
        {loading && <p className="py-10 text-sm text-ink-3">Loading projects from GitHub…</p>}
        {error && <p className="py-10 text-sm text-red-300">{error}</p>}

        {!loading && !error && repos.length === 0 && (
          <p className="py-10 text-sm text-ink-3">No repositories found.</p>
        )}

        {!loading && !error && repos.length > 0 && (
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
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
      </Container>
    </div>
  );
}

function RepoCard({ repo, meta }) {
  const demoUrl = normalizeHomepage(repo.homepage);
  const title = meta?.title || prettyRepoName(repo.name);
  const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 4) : [];
  const [engaged, setEngaged] = useState(false);

  return (
    <article
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
      className="group relative flex flex-col overflow-hidden rounded-card border border-line/9 bg-surface/85 transition-colors hover:border-line/20"
    >
      {meta?.media && <MediaPreview media={meta.media} engaged={engaged} />}

      <div className="flex flex-1 flex-col p-5">
        <p className="flex flex-wrap gap-x-4 text-sm text-ink-3">
          {repo.language && <span className="text-accent">{repo.language}</span>}
          <span>Updated {formatDate(repo.pushed_at)}</span>
        </p>

        <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          <Link to={`/${repo.name}`} className="after:absolute after:inset-0 after:content-['']">
            {title}
          </Link>
        </h2>

        {repo.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{repo.description}</p>
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

function MediaPreview({ media, engaged }) {
  const videoRef = useRef(null);
  const [inView, setInView] = useState(false);
  const isVideo = media.type === 'video';

  useEffect(() => {
    const video = videoRef.current;
    if (!isVideo || !video) return undefined;
    // react only sets muted as a property, iOS needs the attribute or it goes fullscreen
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
    <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-line/9 bg-bg">
      {isVideo ? (
        <video
          ref={videoRef}
          // #t= gets the browser to show a first frame instead of black
          src={`${media.url}#t=0.1`}
          preload="metadata"
          // recordings tend to start on a black frame
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
