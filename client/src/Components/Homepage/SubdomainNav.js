import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { SITE_MODES, getSiteHref } from '../../utils/siteMode';
import {
  REFRACTION_FILTER_ID,
  RefractionFilter,
  buildRefractionMap,
  supportsBackdropRefraction,
} from './glassRefraction';
import './prism.css';

const navItems = [
  { mode: SITE_MODES.ROOT, label: 'Home', hideOnMobile: true },
  { mode: SITE_MODES.CS, label: 'CS' },
  { mode: SITE_MODES.ART, label: 'Art' },
  { mode: SITE_MODES.BLOG, label: 'Blog' },
];

// The one piece of chrome every section shares. The current section's tab is
// filled with that section's accent, so it doubles as a "you are here".
// It's a pane of the site's glass, with the lit rim (no sheen, which read as
// glare on a bar this long). Page content scrolls under it, so where the
// browser can, it bends and splits whatever is beneath in CSS
// (glassRefraction.js); elsewhere the WebGL pass bends the 3D backdrop
// through it and a frost keeps the nav readable over content.
export default function SubdomainNav({ currentMode }) {
  const barRef = useRef(null);
  const refract = useMemo(() => supportsBackdropRefraction(), []);
  const [map, setMap] = useState(null);

  // The map follows the bar's size, which changes with the viewport
  useEffect(() => {
    const el = barRef.current;
    if (!refract || !el) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) {
        setMap(buildRefractionMap(width, height, height / 2));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [refract]);

  const bending = refract && map;

  return (
    <div className="fixed left-0 right-0 top-0 z-30 px-3 py-3 sm:px-6 sm:py-4">
      {bending && <RefractionFilter map={map} />}
      <nav
        ref={barRef}
        // the CSS bend replaces the WebGL one, which would bend it twice
        data-liquid-glass={bending ? undefined : ''}
        style={bending ? { backdropFilter: `url(#${REFRACTION_FILTER_ID})` } : undefined}
        className={[
          'liquid-glass glass-bar relative mx-auto flex max-w-7xl items-center justify-between rounded-full px-3 py-2 sm:px-4',
          bending ? '' : 'glass-bar-frost',
        ].join(' ')}
      >
        <span aria-hidden="true" className="liquid-glass-rim" />
        <a
          href={getSiteHref(SITE_MODES.ROOT)}
          aria-label="Harrison Martin, home"
          className="relative z-10 shrink-0 px-2 text-sm font-semibold tracking-tight text-ink"
        >
          <span className="sm:hidden">HM</span>
          <span className="hidden sm:inline">Harrison Martin</span>
        </a>

        <div className="relative z-10 flex items-center gap-1 sm:gap-1.5">
          {navItems.map((item) => {
            const isActive = item.mode === currentMode;

            return (
              <a
                key={item.mode}
                href={getSiteHref(item.mode)}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:px-3.5',
                  // The hub's accent is near-white, so its tab gets a
                  // stronger version of the hover tint instead
                  !isActive
                    ? 'text-ink-2 hover:bg-line/6 hover:text-ink'
                    : item.mode === SITE_MODES.ROOT
                      ? 'bg-line/20 text-white'
                      : 'bg-accent text-white',
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
