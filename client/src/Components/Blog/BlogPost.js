import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/atom-one-dark.css';

import { apiUrl, getApiBaseUrl } from '../../utils/api';
import SubdomainNav from '../Homepage/SubdomainNav';
import CommentSection from '../Comments/CommentSection';
import { SITE_MODES } from '../../utils/siteMode';
import Container from '../ui/Container';
import PageHeader from '../ui/PageHeader';
import { NetworkPath, NodeHeader, nodeColor } from './network';
import { remarkWikiLinks } from './plugins/remarkWikiLinks';
import { rehypeCallouts } from './plugins/rehypeCallouts';

function setMeta(name, content) {
  const isOg = name.startsWith('og:');
  const selector = isOg
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  let el = document.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    if (isOg) el.setAttribute('property', name);
    else el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function BlogPost() {
  const { slug } = useParams();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(apiUrl(`/blog/posts/${slug}`))
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Post not found.' : `Error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setPost(data);
        const { title, description } = data.meta;
        document.title = `${title} — Harrison Martin`;
        setMeta('description', description || title);
        setMeta('og:title', title);
        setMeta('og:description', description || title);
        setMeta('og:type', 'article');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    return () => { document.title = 'Harrison Martin'; };
  }, []);

  if (loading || error) {
    return (
      <div className="network-grid min-h-screen text-ink">
        <SubdomainNav currentMode={SITE_MODES.BLOG} />
        <Container as="main" className="pb-24 pt-28 sm:pt-32">
          <div className="mx-auto max-w-3xl">
            <NetworkPath node={slug} />
            <PageHeader title={loading ? '' : 'This post didn’t load'} />
            <p className={`mt-4 text-sm ${error ? 'text-red-300' : 'text-ink-3'}`}>
              {loading ? 'Loading post…' : error}
            </p>
          </div>
        </Container>
      </div>
    );
  }

  const { meta, content } = post;
  const color = nodeColor(meta.tags[0]);

  return (
    <div className="network-grid min-h-screen text-ink" data-preview-ready="">
      <SubdomainNav currentMode={SITE_MODES.BLOG} />

      <Container as="main" className="pb-24 pt-28 sm:pt-32">
        <article className="mx-auto max-w-3xl">
          <NetworkPath node={meta.slug} />

          <header
            className="mt-6 overflow-hidden rounded-field border bg-surface-2 shadow-[0_10px_30px_rgb(0_0_0/0.35)]"
            style={{ borderColor: `${color}80` }}
          >
            <NodeHeader color={color} type={meta.tags[0] || 'post'}>
              <span className="flex gap-4">
                {meta.date && <time dateTime={meta.date}>{formatDate(meta.date)}</time>}
                {meta.readingTime && <span>{meta.readingTime}</span>}
              </span>
            </NodeHeader>
            {meta.cover && (
              <img
                src={apiUrl(`/blog/images/${encodeURIComponent(meta.cover)}`)}
                alt=""
                className="max-h-[26rem] w-full object-cover"
              />
            )}
            <div className="px-5 py-5 sm:px-8 sm:py-6">
              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
                {meta.title}
              </h1>
              {meta.tags.length > 0 && (
                <p className="mt-3 font-mono text-[13px] text-ink-3">{meta.tags.join(', ')}</p>
              )}
            </div>
          </header>

          <div className="mt-6 overflow-hidden rounded-field border border-line/9 bg-surface-2">
            <div className="border-b border-line/9 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3 sm:px-8">
              Parameters
            </div>
            <div className="prose-doc prose-reading px-5 py-8 sm:px-8 sm:py-10">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath, [remarkWikiLinks, { apiBase: getApiBaseUrl() }]]}
                rehypePlugins={[rehypeCallouts, rehypeSlug, rehypeKatex, rehypeHighlight, rehypeRaw]}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        </article>

        <div className="mx-auto mt-16 max-w-3xl">
          <CommentSection type="blog" id={meta.slug} />
        </div>
      </Container>
    </div>
  );
}
