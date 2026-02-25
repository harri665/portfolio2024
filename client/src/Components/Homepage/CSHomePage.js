import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';


import Buttons from "./Buttons";
import SubdomainNav from './SubdomainNav';
import DistortedTorusScene from './DistortedTorusScene';
import { SITE_MODES } from '../../utils/siteMode';

const GITHUB_USERNAME = 'harri665';

// Toggle this on to only show the repositories listed below.
// Entries can be either:
// - 'repo-name' (matches repos owned by GITHUB_USERNAME)
// - 'owner/repo-name' (supports repos not owned by GITHUB_USERNAME)
const REPO_WHITELIST = {
  enabled: true,
  caseSensitive: false,
  preserveListedOrder: true,
  repoNames: [
    'OpenGL-Star-Simulation',
    'MadixOutdoors3DWebsite',
    'MurderMysteryCH/MurderMysteryV2',
    // 'someone-else/cool-repo',
  ],
};

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

function getWhitelistEntries(whitelistConfig = REPO_WHITELIST) {
  return Array.isArray(whitelistConfig?.repoNames)
    ? whitelistConfig.repoNames
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    : [];
}

function getExternalWhitelistEntries(whitelistConfig = REPO_WHITELIST) {
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

function applyRepoWhitelist(repos, whitelistConfig = REPO_WHITELIST) {
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
  const response = await fetch(`https://api.github.com/repos/${fullName}`, {
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Repository not found: ${fullName}`);
    }

    if (response.status === 403) {
      throw new Error(`GitHub API rate limit reached while loading ${fullName}`);
    }

    throw new Error(`Failed to load repository ${fullName} (${response.status})`);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function fetchRepositories() {
      try {
        const response = await fetch(
          `https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100&type=owner&sort=updated`,
          {
            signal: controller.signal,
            headers: {
              Accept: 'application/vnd.github+json',
            },
          }
        );

        if (!response.ok) {
          if (response.status === 403) {
            throw new Error('GitHub API rate limit reached. Please try again in a bit.');
          }

          throw new Error(`Failed to load GitHub projects (${response.status})`);
        }

        const data = await response.json();
        const publicOwnedRepos = data.filter((repo) => !repo.fork);
        const externalWhitelistedRepos = await fetchExternalWhitelistedRepos(
          REPO_WHITELIST,
          controller.signal
        );
        const combinedRepos = mergeRepos(publicOwnedRepos, externalWhitelistedRepos);
        const sortedRepos = sortRepos(combinedRepos);
        const visibleRepos = applyRepoWhitelist(sortedRepos);

        setRepos(visibleRepos);
      } catch (err) {
        if (err.name === 'AbortError') {
          return;
        }

        setError(err.message || 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    }

    fetchRepositories();

    return () => controller.abort();
  }, []);





  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08090c] text-white">
      {/* <TorusBackdrop /> */}
      <SubdomainNav currentMode={SITE_MODES.CS} />
      <HeroSection />

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-20 sm:px-8">


        {loading && <StateCard tone="neutral">Loading GitHub projects...</StateCard>}
        {error && <StateCard tone="error">{error}</StateCard>}

        {!loading && !error && repos.length === 0 && (
          <StateCard tone="neutral">
            {REPO_WHITELIST.enabled
              ? 'No repositories matched your whitelist. Use repo-name or owner/repo-name entries in REPO_WHITELIST.repoNames.'
              : 'No repositories found.'}
          </StateCard>
        )}

        {!loading && !error && repos.length > 0 && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.45 }}
            className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          >
            {repos.map((repo, index) => (
              <RepoCard key={repo.id} repo={repo} index={index} />
            ))}
          </motion.section>
        )}
      </main>
    </div>
  );
}

function RepoCard({ repo, index }) {
  const demoUrl = normalizeHomepage(repo.homepage);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02 * Math.min(index, 14), duration: 0.4 }}
      whileHover={{ y: -3 }}
      className="group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5 p-5 shadow-[0_16px_45px_rgba(0,0,0,0.32)] backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-400/12 via-white/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative z-10 flex h-full flex-col">
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

        <h2 className="text-xl font-semibold tracking-tight text-white">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-[#4da3ff]"
          >
            {repo.name}
          </a>
        </h2>

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

        <div className="mt-6 flex flex-wrap gap-2.5">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-[#0a84ff] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(10,132,255,0.28)] transition-colors hover:bg-[#2997ff]"
          >
            View Repo
          </a>
          {demoUrl && (
            <a
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/10"
            >
              Live Demo
            </a>
          )}
        </div>
      </div>
    </motion.article>
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
