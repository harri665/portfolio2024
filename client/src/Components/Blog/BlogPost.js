import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeRaw from 'rehype-raw';

import { apiUrl, getApiBaseUrl } from '../../utils/api';
import SubdomainNav from '../Homepage/SubdomainNav';
import { SITE_MODES } from '../../utils/siteMode';
import { remarkWikiLinks } from './plugins/remarkWikiLinks';
import { rehypeCallouts } from './plugins/rehypeCallouts';

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
      .then(setPost)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="houdini-canvas min-h-screen text-white">
        <SubdomainNav currentMode={SITE_MODES.BLOG} />
        <div className="mx-auto max-w-3xl px-4 py-32 text-center font-mono text-xs text-[#5a6070] sm:px-8">
          loading node…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="houdini-canvas min-h-screen text-white">
        <SubdomainNav currentMode={SITE_MODES.BLOG} />
        <div className="mx-auto max-w-3xl px-4 py-32 sm:px-8">
          <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-10 text-center font-mono text-xs text-red-400">
            error: {error}
          </div>
          <div className="mt-6 text-center">
            <Link to="/" className="font-mono text-xs text-[#e07b39] hover:text-orange-300">
              ← back to graph
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { meta, content } = post;

  return (
    <div className="houdini-canvas min-h-screen text-white">
      <SubdomainNav currentMode={SITE_MODES.BLOG} />

      <main className="relative z-10 mx-auto max-w-3xl px-4 pb-24 pt-20 sm:px-8">

        {/* Node header panel */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-6 rounded-lg border border-[#2e3240] bg-[#1e2128] overflow-hidden"
        >
          {/* Header bar */}
          <div className="flex items-center justify-between gap-3 border-b border-[#2e3240] bg-[#252830] px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#e07b39] shadow-[0_0_5px_rgba(224,123,57,0.8)]" />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#e07b39]/70">
                blog_post
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] text-[#4a5060]">
              {meta.date && <span>{formatDate(meta.date)}</span>}
              {meta.readingTime && <span>· {meta.readingTime}</span>}
            </div>
          </div>

          {meta.cover && (
            <img
              src={apiUrl(`/blog/images/${encodeURIComponent(meta.cover)}`)}
              alt={meta.title}
              className="w-full object-cover"
              style={{ maxHeight: '22rem' }}
            />
          )}

          <div className="px-5 py-4">
            <h1 className="text-2xl font-bold tracking-tight text-[#d0d4dc] sm:text-3xl">
              {meta.title}
            </h1>

            {meta.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {meta.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-[#e07b39]/30 bg-[#e07b39]/8 px-2 py-0.5 font-mono text-[10px] text-[#e07b39]/80"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Parameters / content panel */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4 }}
          className="rounded-lg border border-[#2e3240] bg-[#1e2128] overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b border-[#2e3240] bg-[#252830] px-5 py-2.5">
            <div className="h-1.5 w-1.5 rounded-full bg-[#3a3d45]" />
            <span className="font-mono text-[10px] text-[#4a5060] uppercase tracking-widest">parameters</span>
          </div>

          <div className="blog-prose px-5 py-6 sm:px-8">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, [remarkWikiLinks, { apiBase: getApiBaseUrl() }]]}
              rehypePlugins={[rehypeCallouts, rehypeSlug, rehypeHighlight, rehypeRaw]}
            >
              {content}
            </ReactMarkdown>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.18, duration: 0.35 }}
          className="mt-8"
        >
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-[#e07b39] transition-colors hover:text-orange-300"
          >
            ← back to graph
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
