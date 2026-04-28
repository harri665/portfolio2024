import React from 'react';
import { Link } from 'react-router-dom';
import { getSiteHref, SITE_MODES } from '../../utils/siteMode';

export default function BlogNav() {
  return (
    <div className="fixed top-0 left-0 right-0 z-30 border-b border-[#2e3240] bg-[#16181e]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          {/* Orange Houdini-style indicator dot */}
          <div className="h-2 w-2 rounded-full bg-[#e07b39] shadow-[0_0_6px_rgba(224,123,57,0.8)]" />
          <a
            href={getSiteHref(SITE_MODES.ROOT)}
            className="font-mono text-[11px] font-semibold tracking-[0.22em] text-[#c0c4cc] transition-colors hover:text-white sm:text-xs"
          >
            HARRISON MARTIN
          </a>
          <span className="hidden text-[10px] text-[#4a5060] sm:inline">/ blog</span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="rounded px-3 py-1.5 font-mono text-xs text-[#8a909c] transition-colors hover:bg-[#252830] hover:text-[#c0c4cc]"
          >
            All Posts
          </Link>
          <a
            href={getSiteHref(SITE_MODES.ROOT)}
            className="rounded border border-[#e07b39]/40 bg-[#e07b39]/10 px-3 py-1.5 font-mono text-xs text-[#e07b39] transition-colors hover:bg-[#e07b39]/20"
          >
            ← Hub
          </a>
        </div>
      </div>
    </div>
  );
}
