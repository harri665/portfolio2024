import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';


import Buttons from "./Buttons";
import SubdomainNav from './SubdomainNav';
import DistortedTorusScene from './DistortedTorusScene';
import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl } from '../../utils/api';

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

// ── Houdini node colour palette (mirrors BlogCard) ────────────────────────────
const NODE_STYLES = [
  {
    header: 'bg-gradient-to-r from-[#0a4035] to-[#0d5045]',
    border: 'border-[#1a6b5c]',
    dot: 'bg-teal-400 shadow-[0_0_5px_rgba(45,212,191,0.7)]',
    tag: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
    link: 'text-teal-400 hover:text-teal-300',
    label: 'text-teal-300/70',
    btn: 'border-teal-500/30 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20',
  },
  {
    header: 'bg-gradient-to-r from-[#4a2000] to-[#5c2a00]',
    border: 'border-[#8b4500]',
    dot: 'bg-orange-400 shadow-[0_0_5px_rgba(251,146,60,0.7)]',
    tag: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    link: 'text-orange-400 hover:text-orange-300',
    label: 'text-orange-300/70',
    btn: 'border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20',
  },
  {
    header: 'bg-gradient-to-r from-[#0a2a4a] to-[#0d3560]',
    border: 'border-[#1a5090]',
    dot: 'bg-blue-400 shadow-[0_0_5px_rgba(96,165,250,0.7)]',
    tag: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    link: 'text-blue-400 hover:text-blue-300',
    label: 'text-blue-300/70',
    btn: 'border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20',
  },
  {
    header: 'bg-gradient-to-r from-[#2d0a4a] to-[#38105a]',
    border: 'border-[#5a1a90]',
    dot: 'bg-purple-400 shadow-[0_0_5px_rgba(192,132,252,0.7)]',
    tag: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    link: 'text-purple-400 hover:text-purple-300',
    label: 'text-purple-300/70',
    btn: 'border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20',
  },
];

function nodeStyle(name) {
  let hash = 0;
  for (const c of (name || '')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return NODE_STYLES[hash % NODE_STYLES.length];
}

export default function CSHomePage() {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function fetchRepositories() {
      try {
        const params = new URLSearchParams({
          owner: GITHUB_USERNAME,
          per_page: '100',
          type: 'owner',
          sort: 'updated',
        });
        const response = await fetch(apiUrl(`/github/repos?${params.toString()}`), {
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 403) {
            throw new Error('GitHub API rate limit reached. Please try again in a bit.');
          }

          throw new Error(
            await getResponseErrorMessage(
              response,
              `Failed to load GitHub projects (${response.status})`
            )
          );
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
    <div className="houdini-canvas relative min-h-screen overflow-hidden text-white">
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
            className="grid grid-cols-1 gap-8 px-4 md:grid-cols-2 xl:grid-cols-3"
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
  const style = NODE_STYLES[index % NODE_STYLES.length];
  const demoUrl = normalizeHomepage(repo.homepage);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02 * Math.min(index, 14), duration: 0.4 }}
      whileHover={{ y: -2, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
      className={`group relative overflow-visible rounded-lg border ${style.border} bg-[#1e2128] shadow-[0_8px_30px_rgba(0,0,0,0.4)]`}
    >
      {/* Input port */}
      <div className="absolute -left-[5px] top-1/2 z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-[#3a3d45] bg-[#1e2128] transition-colors group-hover:border-[#5a5d65]" />
      {/* Output port */}
      <div className="absolute -right-[5px] top-1/2 z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-[#3a3d45] bg-[#1e2128] transition-colors group-hover:border-[#5a5d65]" />

      {/* Node header */}
      <div className={`${style.header} flex items-center justify-between gap-3 rounded-t-lg px-4 py-2.5`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
          <span className={`font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${style.label}`}>
            {repo.language || 'repository'}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-white/30">{formatDate(repo.pushed_at)}</span>
      </div>

      <div className={`h-px ${style.border.replace('border-', 'bg-')}`} />

      {/* Body */}
      <div className="flex flex-col gap-3 p-4">
        <h2 className={`text-sm font-semibold leading-snug tracking-tight ${style.link}`}>
          <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
            {repo.name}
          </a>
        </h2>

        <p className="flex-1 text-xs leading-relaxed text-[#6b7280]">
          {repo.description || 'No description provided.'}
        </p>

        {Array.isArray(repo.topics) && repo.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {repo.topics.slice(0, 5).map((topic) => (
              <span key={topic} className={`rounded border px-2 py-0.5 font-mono text-[10px] ${style.tag}`}>
                {topic}
              </span>
            ))}
          </div>
        )}

        {repo.archived && (
          <span className="w-fit rounded border border-amber-300/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
            archived
          </span>
        )}

        <div className="mt-1 flex flex-wrap gap-2">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded border px-3 py-1.5 font-mono text-[10px] font-semibold transition-colors ${style.btn}`}
          >
            View Repo →
          </a>
          {demoUrl && (
            <a
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-[#3a3d45] bg-[#252830] px-3 py-1.5 font-mono text-[10px] text-[#9099a8] transition-colors hover:text-white"
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
      ? 'border-red-800/40 bg-red-900/10 text-red-400'
      : 'border-[#2e3240] bg-[#1e2128] text-[#5a6070]';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`rounded-lg border p-10 text-center font-mono text-xs ${toneClasses}`}
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
