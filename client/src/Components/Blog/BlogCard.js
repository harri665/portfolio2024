import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { apiUrl } from '../../utils/api';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Node header colour palette — Houdini node types
const NODE_STYLES = [
  {
    header: 'bg-gradient-to-r from-[#0a4035] to-[#0d5045]',
    border: 'border-[#1a6b5c]',
    dot: 'bg-teal-400 shadow-[0_0_5px_rgba(45,212,191,0.7)]',
    tag: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
    link: 'text-teal-400 hover:text-teal-300',
    label: 'text-teal-300/70',
  },
  {
    header: 'bg-gradient-to-r from-[#4a2000] to-[#5c2a00]',
    border: 'border-[#8b4500]',
    dot: 'bg-orange-400 shadow-[0_0_5px_rgba(251,146,60,0.7)]',
    tag: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
    link: 'text-orange-400 hover:text-orange-300',
    label: 'text-orange-300/70',
  },
  {
    header: 'bg-gradient-to-r from-[#0a2a4a] to-[#0d3560]',
    border: 'border-[#1a5090]',
    dot: 'bg-blue-400 shadow-[0_0_5px_rgba(96,165,250,0.7)]',
    tag: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    link: 'text-blue-400 hover:text-blue-300',
    label: 'text-blue-300/70',
  },
  {
    header: 'bg-gradient-to-r from-[#2d0a4a] to-[#38105a]',
    border: 'border-[#5a1a90]',
    dot: 'bg-purple-400 shadow-[0_0_5px_rgba(192,132,252,0.7)]',
    tag: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    link: 'text-purple-400 hover:text-purple-300',
    label: 'text-purple-300/70',
  },
];

function nodeStyle(slug) {
  let hash = 0;
  for (const c of (slug || '')) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return NODE_STYLES[hash % NODE_STYLES.length];
}

export default function BlogCard({ post, index = 0 }) {
  const style = nodeStyle(post.slug);
  const navigate = useNavigate();

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * Math.min(index, 10), duration: 0.4 }}
      whileHover={{ y: -2, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
      onClick={() => navigate(`/posts/${post.slug}`)}
      className={`group relative cursor-pointer overflow-visible rounded-lg border ${style.border} bg-[#1e2128] shadow-[0_8px_30px_rgba(0,0,0,0.4)]`}
    >
      {/* Input port — left edge */}
      <div className="absolute -left-[5px] top-1/2 z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-[#3a3d45] bg-[#1e2128] transition-colors group-hover:border-[#5a5d65]" />
      {/* Output port — right edge */}
      <div className="absolute -right-[5px] top-1/2 z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-[#3a3d45] bg-[#1e2128] transition-colors group-hover:border-[#5a5d65]" />

      {/* Coloured node header */}
      <div className={`${style.header} flex items-center justify-between gap-3 rounded-t-lg px-4 py-2.5`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
          <span className={`font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${style.label}`}>
            blog post
          </span>
        </div>
        {post.readingTime && (
          <span className="shrink-0 font-mono text-[10px] text-white/30">{post.readingTime}</span>
        )}
      </div>

      {/* Divider */}
      <div className={`h-px ${style.border.replace('border-', 'bg-')}`} />

      {/* Node body */}
      {post.cover && (
        <img
          src={apiUrl(`/blog/images/${encodeURIComponent(post.cover)}`)}
          alt={post.title}
          className="h-36 w-full object-cover"
          loading="lazy"
        />
      )}

      <div className="flex flex-col gap-3 p-4">
        {post.date && (
          <span className="font-mono text-[10px] tracking-wide text-[#5a6070]">
            {formatDate(post.date)}
          </span>
        )}

        <h2 className={`text-sm font-semibold leading-snug tracking-tight ${style.link}`}>
          {post.title}
        </h2>

        {post.description && (
          <p className="text-xs leading-relaxed text-[#6b7280]">{post.description}</p>
        )}

        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className={`rounded border px-2 py-0.5 font-mono text-[10px] ${style.tag}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

      </div>
    </motion.article>
  );
}
