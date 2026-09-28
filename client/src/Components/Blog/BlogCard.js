import React from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../../utils/api';
import { NodeHeader, Port, nodeColor } from './network';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// One post as a node: a title bar coloured by its type (first tag), the cover
// as its viewport, and its input and output ports.
// Hovering selects it, with Houdini's yellow outline.
export default function BlogCard({ post }) {
  const color = nodeColor(post.tags[0]);

  return (
    <Link
      to={`/${post.slug}`}
      className="group relative flex h-full flex-col rounded-field border bg-surface-2 shadow-[0_10px_30px_rgb(0_0_0/0.35)] transition-shadow hover:shadow-[0_0_0_2px_oklch(var(--accent)),0_10px_30px_rgb(0_0_0/0.35)] focus-visible:shadow-[0_0_0_2px_oklch(var(--accent))]"
      style={{ borderColor: `${color}80` }}
    >
      <Port side="in" />
      <Port side="out" />

      <div className="overflow-hidden rounded-t-[10px]">
        <NodeHeader color={color} type={post.tags[0] || 'post'}>
          {post.readingTime}
        </NodeHeader>
        {post.cover && (
          <img
            src={apiUrl(`/blog/images/${encodeURIComponent(post.cover)}`)}
            alt=""
            className="h-40 w-full object-cover"
            loading="lazy"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {post.date && (
          <time dateTime={post.date} className="font-mono text-[11px] text-ink-3">
            {formatDate(post.date)}
          </time>
        )}

        <h2 className="text-lg font-semibold leading-snug tracking-tight text-ink transition-colors group-hover:text-accent">
          {post.title}
        </h2>

        {post.description && (
          <p className="text-sm leading-relaxed text-ink-2">{post.description}</p>
        )}

        {post.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {post.tags.map((tag) => {
              const tagColor = nodeColor(tag);
              return (
                <span
                  key={tag}
                  className="rounded-chip border px-2 py-0.5 font-mono text-[11px]"
                  style={{ borderColor: `${tagColor}55`, backgroundColor: `${tagColor}18`, color: tagColor }}
                >
                  {tag}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}
