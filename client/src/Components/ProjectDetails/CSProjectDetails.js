import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import 'katex/dist/katex.min.css';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaGithub, FaExternalLinkAlt } from 'react-icons/fa';

import { SITE_MODES } from '../../utils/siteMode';
import SubdomainNav from '../Homepage/SubdomainNav';
import { PrismBackdrop, Reveal } from '../Homepage/Prism';
import CommentSection from '../Comments/CommentSection';

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  'C++': '#f34b7d',
  C: '#555555',
  HTML: '#e34c26',
  CSS: '#563d7c',
  GLSL: '#5686a5',
  CMake: '#DA3434',
  Shell: '#89e051',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Lua: '#000080',
  HLSL: '#aace60',
  'C#': '#178600',
  Vue: '#41b883',
  Makefile: '#427819',
  Batchfile: '#C1F12E',
  PowerShell: '#012456',
};

function resolveGithubImageUrl(src, fullName, defaultBranch) {
  if (!src) return src;
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

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function normalizeHomepage(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function LanguageStrip({ languages }) {
  const entries = Object.entries(languages || {});
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="mt-8">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full">
        {entries.map(([lang, bytes]) => {
          const pct = ((bytes / total) * 100).toFixed(2);
          return (
            <div
              key={lang}
              style={{ width: `${pct}%`, backgroundColor: LANGUAGE_COLORS[lang] || '#8b949e' }}
              title={`${lang} ${((bytes / total) * 100).toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([lang, bytes]) => {
          const pct = ((bytes / total) * 100).toFixed(1);
          return (
            <div key={lang} className="flex items-center gap-1.5 text-xs text-white/50">
              <span
                className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: LANGUAGE_COLORS[lang] || '#8b949e' }}
              />
              <span className="text-white/70">{lang}</span>
              <span>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CSProjectDetails() {
  const { repoName } = useParams();
  const fullName = `harri665/${repoName}`;

  const [repoData, setRepoData] = useState(null);
  const [readme, setReadme] = useState(null);
  const [languages, setLanguages] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const ghHeaders = { Accept: 'application/vnd.github+json' };

    async function load() {
      try {
        const [repoRes, readmeRes, langRes] = await Promise.all([
          fetch(`https://api.github.com/repos/${fullName}`, { signal, headers: ghHeaders }),
          fetch(`https://api.github.com/repos/${fullName}/readme`, { signal, headers: ghHeaders }),
          fetch(`https://api.github.com/repos/${fullName}/languages`, { signal, headers: ghHeaders }),
        ]);

        if (!repoRes.ok) {
          const data = await repoRes.json().catch(() => ({}));
          throw new Error(data.message || `Failed to load repository (${repoRes.status})`);
        }

        const repoJson = await repoRes.json();
        setRepoData(repoJson);

        if (langRes.ok) setLanguages(await langRes.json());

        if (readmeRes.ok) {
          const readmeJson = await readmeRes.json();
          const bytes = Uint8Array.from(
            atob(readmeJson.content.replace(/\n/g, '')),
            (c) => c.charCodeAt(0)
          );
          setReadme(new TextDecoder('utf-8').decode(bytes));
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Failed to load project');
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [fullName]);

  if (loading) {
    return (
      <div className="relative min-h-screen text-white">
        <PrismBackdrop lens="cs" tone="detail" />
        <SubdomainNav currentMode={SITE_MODES.CS} />
        <div className="relative z-10 flex min-h-screen items-center justify-center">
          <p className="text-sm text-white/40">Loading…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative min-h-screen text-white">
        <PrismBackdrop lens="cs" tone="detail" />
        <SubdomainNav currentMode={SITE_MODES.CS} />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
          <div className="rounded-2xl border border-red-300/20 bg-red-500/10 px-8 py-10 text-center text-red-300">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!repoData) return null;

  const demoUrl = normalizeHomepage(repoData.homepage);
  const topics = Array.isArray(repoData.topics) ? repoData.topics : [];
  const updatedDate = formatDate(repoData.pushed_at);

  return (
    <div className="relative min-h-screen text-white">
      <PrismBackdrop
        lens="cs"
        tone="detail"
        accent={LANGUAGE_COLORS[repoData.language]}
      />
      <SubdomainNav currentMode={SITE_MODES.CS} />

      <main className="relative z-10 mx-auto max-w-4xl px-4 pb-32 pt-28 sm:px-8">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Back link */}
          <Link
            to="/"
            className="mb-10 inline-flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
          >
            <FaArrowLeft className="text-xs" />
            All projects
          </Link>

          {/* Language + date meta */}
          <div className="mt-2 flex items-center gap-3 text-xs text-white/60">
            {repoData.language && (
              <span
                className="font-medium"
                style={{ color: LANGUAGE_COLORS[repoData.language] || '#8b949e' }}
              >
                {repoData.language}
              </span>
            )}
            {repoData.language && updatedDate && <span>·</span>}
            {updatedDate && <span>Updated {updatedDate}</span>}
          </div>

          {/* Title */}
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-6xl">
            {repoData.name}
          </h1>

          {/* Description */}
          {repoData.description && (
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              {repoData.description}
            </p>
          )}

          {repoData.archived && (
            <div className="mt-4">
              <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-200">
                Archived
              </span>
            </div>
          )}

          {/* Topics */}
          {topics.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {topics.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/70"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-7 flex flex-wrap gap-3">
            {demoUrl && (
              <a
                href={demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#0a84ff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(10,132,255,0.32)] transition-colors hover:bg-[#2997ff]"
              >
                <FaExternalLinkAlt className="text-xs" />
                Live Demo
              </a>
            )}
            <a
              href={repoData.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur-sm transition-colors hover:bg-white/10"
            >
              <FaGithub />
              View on GitHub
            </a>
          </div>

          {/* Language strip */}
          {languages && <LanguageStrip languages={languages} />}
        </motion.div>
      </div>

      {/* ── README ───────────────────────────────────────────────────────── */}
      <Reveal
        as="section"
        data-liquid-glass="1.8"
        className="liquid-glass solid-glow lens-cs relative mt-12 overflow-hidden rounded-[1.5rem] px-5 py-8 sm:px-10 sm:py-10"
      >
        {/* No sheen here: stretched over a pane this tall it becomes one big glare */}
        <span aria-hidden="true" className="liquid-glass-rim" />
        {readme ? (
          <div className="cs-readme-prose relative z-10">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeSlug, rehypeKatex, rehypeHighlight, rehypeRaw]}
              components={{
                img({ src, alt, ...props }) {
                  const resolved = resolveGithubImageUrl(src, fullName, repoData?.default_branch);
                  return (
                    <img
                      src={resolved}
                      alt={alt ?? ''}
                      className="my-6 w-full rounded-xl border border-white/10"
                      {...props}
                    />
                  );
                },
              }}
            >
              {readme}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="relative z-10 text-center text-sm text-white/40">
            This repository has no README yet.
          </p>
        )}
      </Reveal>

      {/* ── Comments ─────────────────────────────────────────────────────── */}
      <Reveal className="mt-12 pb-6">
        <CommentSection type="cs" id={repoName} variant="glass" />
      </Reveal>
      </main>
    </div>
  );
}
