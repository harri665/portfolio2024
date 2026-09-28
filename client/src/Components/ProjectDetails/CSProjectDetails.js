import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import 'katex/dist/katex.min.css';
import { FaGithub, FaExternalLinkAlt } from 'react-icons/fa';

import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl } from '../../utils/api';
import { withoutLeadingHeading } from '../../utils/repoTitle';
import SubdomainNav from '../Homepage/SubdomainNav';
import CommentSection from '../Comments/CommentSection';
import Button from '../ui/Button';
import Container from '../ui/Container';
import PageHeader from '../ui/PageHeader';
import Tag from '../ui/Tag';

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
            <div key={lang} className="flex items-center gap-1.5 text-xs tabular-nums text-ink-3">
              <span
                className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: LANGUAGE_COLORS[lang] || '#8b949e' }}
              />
              <span className="text-ink-2">{lang}</span>
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

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetch(apiUrl(`/cs/project/${encodeURIComponent(repoName)}`), { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Failed to load project (${res.status})`);
        setProject(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load project');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [repoName]);

  if (loading || error || !project) {
    return (
      <div className="drafting-grid min-h-screen text-ink">
        <SubdomainNav currentMode={SITE_MODES.CS} />
        <Container as="main" className="pb-24 pt-28 sm:pt-32">
          <PageHeader back={BACK} title={error ? 'This project didn’t load' : ''} />
          <p className={`mt-4 text-sm ${error ? 'text-red-300' : 'text-ink-3'}`}>
            {error || 'Loading project…'}
          </p>
        </Container>
      </div>
    );
  }

  const { repo: repoData, title, languages } = project;
  const readme = project.readme?.content;
  const fullName = repoData.full_name;
  const demoUrl = normalizeHomepage(repoData.homepage);
  const topics = Array.isArray(repoData.topics) ? repoData.topics : [];
  const updatedDate = formatDate(repoData.pushed_at);

  return (
    <div className="drafting-grid min-h-screen text-ink">
      <SubdomainNav currentMode={SITE_MODES.CS} />

      <Container as="main" className="pb-24 pt-28 sm:pt-32">
        <div className="max-w-4xl">
          <PageHeader
            back={BACK}
            title={title}
            meta={[
              repoData.language && <span className="text-accent">{repoData.language}</span>,
              updatedDate && `Updated ${updatedDate}`,
              repoData.archived && 'Archived',
            ]}
          >
            {repoData.description && (
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2">
                {repoData.description}
              </p>
            )}

            {topics.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {topics.map((t) => <Tag key={t}>{t}</Tag>)}
              </div>
            )}

            <div className="mt-7 flex flex-wrap gap-3">
              {demoUrl && (
                <Button variant="primary" href={demoUrl} target="_blank" rel="noopener noreferrer">
                  <FaExternalLinkAlt className="text-xs" />
                  Live demo
                </Button>
              )}
              <Button href={repoData.html_url} target="_blank" rel="noopener noreferrer">
                <FaGithub />
                View on GitHub
              </Button>
            </div>

            {languages && <LanguageStrip languages={languages} />}
          </PageHeader>

          <section className="mt-12 rounded-card border border-line/9 bg-surface/85 px-5 py-8 sm:px-10 sm:py-10">
            {readme ? (
              <div className="prose-doc">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeSlug, rehypeKatex, rehypeHighlight, rehypeRaw]}
                  components={{
                    img({ src, alt, ...props }) {
                      const resolved = resolveGithubImageUrl(src, fullName, repoData?.default_branch);
                      return <img src={resolved} alt={alt ?? ''} {...props} />;
                    },
                  }}
                >
                  {project.readme.title ? withoutLeadingHeading(readme) : readme}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-ink-3">This repository has no README yet.</p>
            )}
          </section>

          <div className="mt-16 max-w-3xl">
            <CommentSection type="cs" id={repoName} />
          </div>
        </div>
      </Container>
    </div>
  );
}

const BACK = { label: 'CS', to: '/' };
