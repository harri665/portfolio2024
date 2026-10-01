import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/atom-one-dark.css';
import { FaBookOpen, FaGithub, FaExternalLinkAlt } from 'react-icons/fa';
import { FiArrowUpRight } from 'react-icons/fi';

import { SITE_MODES } from '../../utils/siteMode';
import { apiUrl, getApiBaseUrl } from '../../utils/api';
import { mediaUrl } from '../../utils/mediaUrl';
import { withoutLeadingHeading } from '../../utils/repoTitle';
import { remarkWikiLinks } from '../Blog/plugins/remarkWikiLinks';
import { rehypeCallouts } from '../Blog/plugins/rehypeCallouts';
import SubdomainNav from '../Homepage/SubdomainNav';
import { PrismBackdrop } from '../Homepage/Prism';
import CommentSection from '../Comments/CommentSection';
import Button from '../ui/Button';
import Container from '../ui/Container';
import PageHeader from '../ui/PageHeader';

const readingLine = () => Math.min(window.innerHeight * 0.33, 320);

// inner corner radius = sheet's minus the inset so the curves run parallel
const MEDIA_CLASS = 'mx-auto block h-auto w-auto max-w-full max-h-[34rem] rounded-[10px]';

const MERGED_GLASS = {
  'data-liquid-glass': '',
  'data-glass-merge': '1',
  'data-glass-tint': '0.22',
  'data-glass-bezel': '1.8',
  'data-glass-split': '1.6',
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

function normalizeHomepage(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function useSections(docRef, content) {
  const [sections, setSections] = useState([]);

  useEffect(() => {
    const headings = docRef.current ? [...docRef.current.querySelectorAll('h2[id]')] : [];
    setSections(headings.map((h) => ({ id: h.id, title: h.textContent })));
  }, [docRef, content]);

  return sections;
}

// kept to the contents list so scrolling doesn't re-render the whole write-up
function useActiveSection(sections) {
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (sections.length === 0) return undefined;
    let frame = 0;

    const update = () => {
      frame = 0;
      const line = readingLine();
      let current = null;
      for (const { id } of sections) {
        const heading = document.getElementById(id);
        if (heading && heading.getBoundingClientRect().top < line) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [sections]);

  return active;
}

export default function CSProjectDetails() {
  const { repoName } = useParams();

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const docRef = useRef(null);

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

  const sections = useSections(docRef, project);

  if (loading || error || !project) {
    return (
      <PageShell>
        <PageHeader back={BACK} title={error ? 'This project didn’t load' : ''} />
        <p className={`mt-4 text-sm ${error ? 'text-red-300' : 'text-ink-3'}`}>
          {error || 'Loading project…'}
        </p>
      </PageShell>
    );
  }

  const { repo: repoData, title } = project;
  const readme = project.readme?.content;
  const page = project.page;
  const pageMeta = page?.meta;
  const fullName = repoData.full_name;
  const demoUrl = normalizeHomepage(pageMeta?.live || repoData.homepage);
  const blogUrl = pageMeta?.blog || '';
  const summary = pageMeta?.tagline || repoData.description;
  const facts = [
    pageMeta?.role && ['Role', pageMeta.role],
    pageMeta?.timeline && ['Timeline', pageMeta.timeline],
    repoData.archived && ['Status', 'Archived'],
  ].filter((fact) => fact && fact[1]);

  return (
    <PageShell>
      <PageHeader back={BACK} title={title}>
        {summary && (
          <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-2">{summary}</p>
        )}
      </PageHeader>

      <div className="mt-12 grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-3">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          {/* glass drawn on a fixed strip so it keeps up while sticky (GlassStrip in Prism.js) */}
          <div
            {...MERGED_GLASS}
            data-glass-side=""
            className="liquid-glass glass-panel lens-cs relative overflow-hidden rounded-card lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
          >
            <span aria-hidden="true" className="liquid-glass-rim" />

            {facts.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line/9 p-5 lg:grid-cols-1">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[13px] text-ink-3">{label}</dt>
                    <dd className="mt-1 text-sm leading-snug text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="p-3">
              {demoUrl && (
                <Button
                  variant="primary"
                  href={demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-2 w-full"
                >
                  <FaExternalLinkAlt className="text-xs" />
                  Open live demo
                </Button>
              )}
              {blogUrl && (
                <OutLink href={blogUrl} icon={<FaBookOpen />}>
                  Read the blog post
                </OutLink>
              )}
              {repoData.html_url && (
                <OutLink href={repoData.html_url} icon={<FaGithub />}>
                  Source on GitHub
                </OutLink>
              )}
            </div>

            {sections.length > 1 && <Contents sections={sections} />}
          </div>
        </aside>

        <article
          {...MERGED_GLASS}
          className="liquid-glass glass-panel lens-cs relative min-w-0 overflow-hidden rounded-card"
        >
          <span aria-hidden="true" className="liquid-glass-rim" />

          {page && (pageMeta.video || pageMeta.cover) && (
            <div className="p-3">
              {pageMeta.video ? (
                <CoverVideo
                  src={mediaUrl(pageMeta.video)}
                  poster={pageMeta.cover ? mediaUrl(pageMeta.cover) : undefined}
                />
              ) : (
                <img src={mediaUrl(pageMeta.cover)} alt="" className={MEDIA_CLASS} />
              )}
            </div>
          )}

          <div
            ref={docRef}
            className="px-5 py-9 sm:px-10 sm:py-12 lg:px-14 [&_h2]:scroll-mt-28"
          >
            {page ? (
              <div className="prose-doc prose-reading mx-auto max-w-[70ch]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath, [remarkWikiLinks, { apiBase: getApiBaseUrl() }]]}
                  rehypePlugins={[rehypeCallouts, rehypeSlug, rehypeKatex, rehypeHighlight, rehypeRaw]}
                >
                  {page.content}
                </ReactMarkdown>
              </div>
            ) : readme ? (
              <div className="prose-doc mx-auto max-w-[80ch]">
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
          </div>
        </article>
      </div>

      {/* outside the grid so the sticky sidebar stops at the end of the doc */}
      <div className="mt-16 lg:ml-[calc(16rem+0.75rem)] lg:px-14">
        <div className="mx-auto max-w-3xl">
          <CommentSection type="cs" id={repoName} />
        </div>
      </div>
    </PageShell>
  );
}

// only plays on screen, offscreen video still made the compositor redraw and scrolling hitched
function CoverVideo({ src, poster }) {
  const ref = useRef(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    // iOS needs the attribute to play inline
    video.setAttribute('muted', '');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      className={MEDIA_CLASS}
      preload="metadata"
      loop
      muted
      playsInline
    />
  );
}

function OutLink({ href, icon, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-field px-3 py-2.5 text-sm text-ink-2 transition-colors hover:bg-line/6 hover:text-ink"
    >
      <span className="text-[13px] text-ink-3 transition-colors group-hover:text-ink-2">{icon}</span>
      <span className="flex-1">{children}</span>
      <FiArrowUpRight aria-hidden="true" className="text-ink-3 transition-colors group-hover:text-ink" />
    </a>
  );
}

function Contents({ sections }) {
  const active = useActiveSection(sections);

  function jump(event, id) {
    const heading = document.getElementById(id);
    if (!heading) return;
    event.preventDefault();
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
  }

  return (
    <nav aria-label="On this page" className="hidden border-t border-line/9 p-5 lg:block">
      <p className="text-[13px] text-ink-3">On this page</p>
      <ol className="mt-3 border-l border-line/9">
        {sections.map(({ id, title }) => {
          const current = id === active;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                onClick={(event) => jump(event, id)}
                aria-current={current ? 'location' : undefined}
                className={`-ml-px block border-l py-1.5 pl-4 text-sm leading-snug transition-colors ${
                  current
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-3 hover:text-ink-2'
                }`}
              >
                {title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// same shell loading + loaded so the backdrop canvas isn't rebuilt
function PageShell({ children }) {
  return (
    <div className="relative min-h-screen text-ink">
      <PrismBackdrop lens="cs" tone="detail" />
      <SubdomainNav currentMode={SITE_MODES.CS} />
      <Container as="main" className="relative z-[1] pb-24 pt-28 sm:pt-32">
        {children}
      </Container>
    </div>
  );
}

const BACK = { label: 'CS', to: '/' };
