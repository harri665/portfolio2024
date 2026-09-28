import React from 'react';
import { Link } from 'react-router-dom';

import { getSiteHref, SITE_MODES } from '../../utils/siteMode';

// The blog is drawn as a Houdini network: each post is a node. A node's colour says what its first tag is, as a Houdini
// artist colours nodes by what they do; untagged posts keep the default grey.
const NODE_COLORS = ['#4f8fd6', '#62a45e', '#c8793a', '#9b72c4', '#c9504a', '#3ea6a0'];
export const DEFAULT_NODE_COLOR = '#80858e';

export function nodeColor(tag) {
  if (!tag) return DEFAULT_NODE_COLOR;
  let hash = 0;
  for (const c of tag) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return NODE_COLORS[hash % NODE_COLORS.length];
}

// Houdini node names can't hold hyphens, so a slug becomes black_holes
export function nodeName(slug) {
  return String(slug || '').replace(/-/g, '_');
}

// A node's coloured title bar: a status dot, its type, and a note on the right
export function NodeHeader({ color, type, children }) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
      style={{
        borderColor: `${color}66`,
        background: `linear-gradient(90deg, ${color}38, ${color}20)`,
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color }}>
          {type}
        </span>
      </span>
      {children && <span className="shrink-0 font-mono text-[11px] text-ink-3">{children}</span>}
    </div>
  );
}

// An input or output port on a node's side edge
export function Port({ side }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-1/2 z-10 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-line/25 bg-surface-2 transition-colors group-hover:border-accent ${
        side === 'in' ? '-left-[7px]' : '-right-[7px]'
      }`}
    />
  );
}

// The network editor's path bar: obj › blog › node. Every segment but the
// last is a link, so on a post it doubles as the way back.
export function NetworkPath({ node, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-line/9 bg-surface-2/90 px-3 py-2">
      <nav aria-label="Location" className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
        <a href={getSiteHref(SITE_MODES.ROOT)} className="text-ink-3 transition-colors hover:text-ink">
          obj
        </a>
        <Separator />
        {node ? (
          <>
            <Link to="/" className="text-ink-2 transition-colors hover:text-ink">blog</Link>
            <Separator />
            <span aria-current="page" className="truncate text-ink">{nodeName(node)}</span>
          </>
        ) : (
          <span aria-current="page" className="text-ink">blog</span>
        )}
      </nav>
      {children}
    </div>
  );
}

function Separator() {
  return <span aria-hidden="true" className="text-ink-3">›</span>;
}
