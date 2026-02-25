import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import { SITE_MODES, getSiteHref } from '../../utils/siteMode';

const navItems = [
  { mode: SITE_MODES.ROOT, label: 'Home Hub' },
  { mode: SITE_MODES.CS, label: 'CS' },
  { mode: SITE_MODES.ART, label: 'Art' },
];

export default function SubdomainNav({ currentMode }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-30 px-4 py-4 sm:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-[#0f1115]/72 px-3 py-2 shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:px-4">
        <a
          href={getSiteHref(SITE_MODES.ROOT)}
          className="px-2 text-[11px] font-semibold tracking-[0.2em] text-white/88 sm:text-xs"
        >
          HARRISON MARTIN
        </a>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {navItems.map((item) => {
            const isActive = item.mode === currentMode;

            return (
              <motion.a
                key={item.mode}
                href={getSiteHref(item.mode)}
                aria-current={isActive ? 'page' : undefined}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className={[
                  'rounded-full px-3 py-1.5 text-xs font-semibold tracking-tight transition-colors sm:px-4',
                  isActive
                    ? 'bg-white text-[#0b0c10] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]'
                    : 'text-white/70 hover:bg-white/6 hover:text-white',
                ].join(' ')}
              >
                {item.label}
              </motion.a>
            );
          })}
          <Link
            to="/contact"
            className="rounded-full bg-[#0a84ff] px-3 py-1.5 text-xs font-semibold tracking-tight text-white shadow-[0_8px_18px_rgba(10,132,255,0.35)] transition-colors hover:bg-[#2997ff] sm:px-4"
          >
            Contact
          </Link>
        </div>
      </div>
    </div>
  );
}
