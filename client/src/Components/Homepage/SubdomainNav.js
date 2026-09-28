import React from 'react';
import { Link } from 'react-router-dom';

import { SITE_MODES, getSiteHref } from '../../utils/siteMode';

const navItems = [
  { mode: SITE_MODES.ROOT, label: 'Home', hideOnMobile: true },
  { mode: SITE_MODES.CS, label: 'CS' },
  { mode: SITE_MODES.ART, label: 'Art' },
  { mode: SITE_MODES.BLOG, label: 'Blog' },
];

// The one piece of chrome every section shares. The current section's tab is
// filled with that section's accent, so it doubles as a "you are here".
export default function SubdomainNav({ currentMode }) {
  return (
    <div className="fixed left-0 right-0 top-0 z-30 px-3 py-3 sm:px-6 sm:py-4">
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-line/10 bg-surface/75 px-3 py-2 backdrop-blur-2xl sm:px-4">
        <a
          href={getSiteHref(SITE_MODES.ROOT)}
          aria-label="Harrison Martin, home"
          className="shrink-0 px-2 text-sm font-semibold tracking-tight text-ink"
        >
          <span className="sm:hidden">HM</span>
          <span className="hidden sm:inline">Harrison Martin</span>
        </a>

        <div className="flex items-center gap-1 sm:gap-1.5">
          {navItems.map((item) => {
            const isActive = item.mode === currentMode;

            return (
              <a
                key={item.mode}
                href={getSiteHref(item.mode)}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:px-3.5',
                  isActive
                    ? 'bg-accent text-on-accent'
                    : 'text-ink-2 hover:bg-line/6 hover:text-ink',
                  item.hideOnMobile ? 'hidden sm:inline-flex' : '',
                ].join(' ')}
              >
                {item.label}
              </a>
            );
          })}
          <Link
            to="/contact"
            className="ml-1 rounded-full border border-line/16 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-line/6 sm:px-3.5"
          >
            Contact
          </Link>
        </div>
      </nav>
    </div>
  );
}
