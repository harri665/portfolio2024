import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';


import Buttons from "./Buttons";
import SubdomainNav from './SubdomainNav';
import DistortedTorusScene from './DistortedTorusScene';
import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl } from '../../utils/api';

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

function resolveGithubImageUrl(src, fullName, defaultBranch) {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) {
    return src.replace(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
      'https://raw.githubusercontent.com/$1/'
    );
  }
  const branch = defaultBranch || 'main';
  const clean = src.replace(/^\.\//, '');
  return `https://raw.githubusercontent.com/${fullName}/${branch}/${clean}`;
}

function extractFirstMedia(markdown, fullName, defaultBranch) {
  if (!markdown) return null;

  // Markdown image/video syntax: ![alt](url)
  const mdMatch = markdown.match(/!\[.*?\]\(([^)\s]+)/);
  if (mdMatch) return resolveGithubImageUrl(mdMatch[1], fullName, defaultBranch);

  // HTML <video src="..."> or <video ...><source src="...">
  const videoSrcMatch = markdown.match(/<video[^>]+src=["']([^"']+)["']/i)
    || markdown.match(/<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i);
  if (videoSrcMatch) return resolveGithubImageUrl(videoSrcMatch[1], fullName, defaultBranch);

  // HTML <img src="..."> — quoted then unquoted
  const imgMatch = markdown.match(/<img[^>]+src=["']([^"']+)["']/i)
    || markdown.match(/<img[^>]+src=([^\s>]+)/i);
  if (imgMatch) return resolveGithubImageUrl(imgMatch[1], fullName, defaultBranch);

  return null;
}

function getMediaType(url) {
  if (!url) return 'image';
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })().toLowerCase();
  if (path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.mov')) return 'video';
  if (path.endsWith('.gif')) return 'gif';
  return 'image';
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
  const [repoImages, setRepoImages] = useState({});
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

  useEffect(() => {
    if (repos.length === 0) return;
    const controller = new AbortController();
    const ghHeaders = { Accept: 'application/vnd.github+json' };

    async function fetchReadmeImages() {
      const entries = await Promise.all(
        repos.map(async (repo) => {
          try {
            const res = await fetch(
              `https://api.github.com/repos/${repo.full_name}/readme`,
              { signal: controller.signal, headers: ghHeaders }
            );
            if (!res.ok) return [repo.full_name, null];
            const json = await res.json();
            const bytes = Uint8Array.from(
              atob(json.content.replace(/\n/g, '')),
              (c) => c.charCodeAt(0)
            );
            const markdown = new TextDecoder('utf-8').decode(bytes);
            return [repo.full_name, extractFirstMedia(markdown, repo.full_name, repo.default_branch)];
          } catch {
            return [repo.full_name, null];
          }
        })
      );
      setRepoImages(Object.fromEntries(entries));
    }

    fetchReadmeImages();
    return () => controller.abort();
  }, [repos]);





  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08090c] text-white">
      {/* <TorusBackdrop /> */}
      <SubdomainNav currentMode={SITE_MODES.CS} />
      <HeroSection />

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-20 sm:px-8">


        {loading && <StateCard tone="neutral">Loading GitHub projects...</StateCard>}
        {error && <StateCard tone="error">{error}</StateCard>}

        {!loading && !error && repos.length === 0 && (
          <StateCard tone="neutral">No repositories found.</StateCard>
        )}

        {!loading && !error && repos.length > 0 && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.45 }}
            className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          >
            {repos.map((repo, index) => (
              <RepoCard key={repo.id} repo={repo} index={index} imageUrl={repoImages[repo.full_name] ?? null} />
            ))}
          </motion.section>
        )}
      </main>
    </div>
  );
}

function RepoCard({ repo, index, imageUrl }) {
  const demoUrl = normalizeHomepage(repo.homepage);
  const navigate = useNavigate();

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02 * Math.min(index, 14), duration: 0.4 }}
      whileHover={{ y: -4, boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}
      onClick={() => navigate(`/github/${repo.full_name}`)}
      className="group relative cursor-pointer overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5 shadow-[0_16px_45px_rgba(0,0,0,0.32)] backdrop-blur-xl"
    >
      {/* Hover glow */}
      <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-br from-sky-400/10 via-white/4 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      {imageUrl && <MediaPreview url={imageUrl} />}

      <div className="relative z-20 flex flex-col p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {repo.language && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/75">
              {repo.language}
            </span>
          )}
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/55">
            Updated {formatDate(repo.pushed_at)}
          </span>
          {repo.archived && (
            <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200">
              Archived
            </span>
          )}
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-white">{repo.name}</h2>

        <p className="mt-3 flex-1 text-sm leading-relaxed text-white/65">
          {repo.description || 'No description provided yet.'}
        </p>

        {Array.isArray(repo.topics) && repo.topics.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {repo.topics.slice(0, 4).map((topic) => (
              <span
                key={topic}
                className="rounded-full border border-blue-300/15 bg-blue-400/10 px-2.5 py-1 text-xs font-medium text-blue-100"
              >
                {topic}
              </span>
            ))}
          </div>
        )}

        {(repo.html_url || demoUrl) && (
          <div className="mt-6 flex flex-wrap gap-2.5">
            <a
              href={repo.html_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80"
            >
              GitHub
            </a>
            {demoUrl && (
              <a
                href={demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-full bg-[#0a84ff] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(10,132,255,0.25)]"
              >
                Live Demo
              </a>
            )}
          </div>
        )}
      </div>
    </motion.article>
  );
}

function MediaPreview({ url }) {
  const type = getMediaType(url);
  const fitClass = type === 'image' ? 'object-cover' : 'object-contain';

  return (
    <div className="relative w-full overflow-hidden bg-[#0d0f14]" style={{ height: '11rem' }}>
      {type === 'video' ? (
        <video
          src={url}
          autoPlay
          loop
          muted
          playsInline
          className={`h-full w-full ${fitClass}`}
        />
      ) : (
        <img src={url} alt="" className={`h-full w-full ${fitClass}`} />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#08090c] to-transparent" />
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium tracking-tight text-white/92 sm:text-base">
        {value}
      </p>
    </div>
  );
}

function StateCard({ children, tone = 'neutral' }) {
  const toneClasses =
    tone === 'error'
      ? 'border-red-300/20 bg-red-500/10 text-red-200'
      : 'border-white/10 bg-white/5 text-white/65';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-[1.5rem] border p-8 text-center shadow-[0_12px_35px_rgba(0,0,0,0.25)] ${toneClasses}`}
    >
      {children}
    </motion.div>
  );
}

function TorusBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[34rem]">
      <div className="absolute inset-0 opacity-22">
        <DistortedTorusScene variant="cs" className="h-full w-full" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-[#08090c]/5 via-[#08090c]/55 to-[#08090c]" />
    </div>
  );
}

function HeroSection() {
  return (
    <div className="relative h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Background Torus Scene */}
        <DistortedTorusScene variant="cs" className="h-full w-full" />

      {/* Hero Text Content with animations */}
      <motion.div
        className="absolute text-center z-10"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
      >
        <h1 className="text-7xl font-extrabold tracking-tight text-white">
          Harrison Martin
        </h1>
        <Buttons />
      </motion.div>
    </div>
  );
}
