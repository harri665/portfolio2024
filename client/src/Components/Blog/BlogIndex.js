import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { apiUrl } from '../../utils/api';
import SubdomainNav from '../Homepage/SubdomainNav';
import { SITE_MODES } from '../../utils/siteMode';
import BlogCard from './BlogCard';

export default function BlogIndex() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTag, setActiveTag] = useState(null);

  useEffect(() => {
    fetch(apiUrl('/blog/posts'))
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load posts (${r.status})`);
        return r.json();
      })
      .then(setPosts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const allTags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  const visiblePosts = activeTag
    ? posts.filter((p) => p.tags.includes(activeTag))
    : posts;

  return (
    <div className="houdini-canvas relative min-h-screen text-white">
      <WireDecor />
      <SubdomainNav currentMode={SITE_MODES.BLOG} />

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-20 pt-20 sm:px-8">

        {/* Network header — looks like a Houdini network label */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-10 flex items-start justify-between"
        >
          <div>

            <h1 className="mt-2 font-mono text-3xl font-bold tracking-tight text-[#d0d4dc] sm:text-4xl">
              Blog Posts
            </h1>
            {/* <p className="mt-2 font-mono text-xs text-[#5a6070]">
              {posts.length} node{posts.length !== 1 ? 's' : ''} in graph
            </p> */}
          </div>

        </motion.div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.06, duration: 0.35 }}
            className="mb-8 flex flex-wrap items-center gap-2"
          >
            <span className="mr-1 font-mono text-[10px] text-[#4a5060]">filter:</span>
            <button
              onClick={() => setActiveTag(null)}
              className={[
                'rounded border px-2.5 py-1 font-mono text-[10px] transition-colors',
                activeTag === null
                  ? 'border-[#e07b39] bg-[#e07b39]/15 text-[#e07b39]'
                  : 'border-[#2e3240] bg-transparent text-[#6b7280] hover:border-[#4a5060] hover:text-[#9099a8]',
              ].join(' ')}
            >
              all
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                className={[
                  'rounded border px-2.5 py-1 font-mono text-[10px] transition-colors',
                  activeTag === tag
                    ? 'border-[#e07b39] bg-[#e07b39]/15 text-[#e07b39]'
                    : 'border-[#2e3240] bg-transparent text-[#6b7280] hover:border-[#4a5060] hover:text-[#9099a8]',
                ].join(' ')}
              >
                {tag}
              </button>
            ))}
          </motion.div>
        )}

        {loading && (
          <div className="rounded-lg border border-[#2e3240] bg-[#1e2128] p-10 text-center font-mono text-xs text-[#5a6070]">
            loading nodes…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-10 text-center font-mono text-xs text-red-400">
            error: {error}
          </div>
        )}

        {!loading && !error && visiblePosts.length === 0 && (
          <div className="rounded-lg border border-[#2e3240] bg-[#1e2128] p-10 text-center font-mono text-xs text-[#5a6070]">
            {activeTag ? `no nodes tagged "${activeTag}"` : 'no nodes in graph yet'}
          </div>
        )}

        {!loading && !error && visiblePosts.length > 0 && (
          <div className="grid grid-cols-1 gap-8 px-4 md:grid-cols-2 xl:grid-cols-3">
            {visiblePosts.map((post, i) => (
              <BlogCard key={post.slug} post={post} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// Decorative bezier wires in the background — mimics Houdini node connections
function WireDecor() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M 0 280 C 200 280 300 480 600 480" stroke="#e07b39" strokeWidth="1.5" fill="none" />
      <path d="M 600 480 C 900 480 1000 280 1200 300" stroke="#e07b39" strokeWidth="1.5" fill="none" />
      <path d="M 100 600 C 350 600 450 350 700 360" stroke="#2dd4bf" strokeWidth="1.5" fill="none" />
      <path d="M 700 360 C 950 360 1050 600 1400 580" stroke="#2dd4bf" strokeWidth="1.5" fill="none" />
      <path d="M 200 900 C 500 900 600 700 900 720" stroke="#818cf8" strokeWidth="1.5" fill="none" />
      <path d="M -100 150 C 150 150 250 400 500 380" stroke="#e07b39" strokeWidth="1" fill="none" strokeDasharray="6 4" />
      <path d="M 800 800 C 1000 800 1100 550 1400 530" stroke="#2dd4bf" strokeWidth="1" fill="none" strokeDasharray="6 4" />
    </svg>
  );
}
