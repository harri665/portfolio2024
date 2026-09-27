import { useLayoutEffect, useRef, useState } from 'react';
import {
  animate,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion';

import { HOVER_LIFT, useScrollReveal } from './Prism';

// ?reveal=rise|scrub|focus|jelly to try the different card motions
// only translate/scale/opacity here, the glass pass can't follow rotate/skew/blur/clip
export const GALLERY_MOTIONS = ['rise', 'scrub', 'focus', 'jelly'];
const STORAGE_KEY = 'galleryReveal';

function initialMotion() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return 'rise';
  }
  try {
    const asked = new URLSearchParams(window.location.search).get('reveal');
    if (GALLERY_MOTIONS.includes(asked)) {
      sessionStorage.setItem(STORAGE_KEY, asked);
      return asked;
    }
    const kept = sessionStorage.getItem(STORAGE_KEY);
    if (GALLERY_MOTIONS.includes(kept)) {
      return kept;
    }
  } catch {
    // storage blocked
  }
  return 'rise';
}

// key the grid by name, each motion has its own hooks so switching has to remount
export function useGalleryMotionName() {
  const [name, setName] = useState(initialMotion);
  const choose = (next) => {
    setName(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked, lasts until reload
    }
  };
  return [name, choose];
}

export function useGalleryMotion(name, index) {
  return (HOOKS[name] || useRise)(index);
}

const HOOKS = { rise: useRise, scrub: useScrub, focus: useFocus, jelly: useJelly };

function useRise(index) {
  return { ...useScrollReveal(index), whileHover: HOVER_LIFT };
}

function useScrub() {
  const ref = useRef(null);
  const lag = useColumnLag(ref);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.66'] });
  const progress = useTransform([scrollYProgress, lag], ([p, l]) =>
    easeOutCubic(clamp01((p - l * 0.3) / (1 - l * 0.3)))
  );
  const opacity = useTransform(progress, [0, 0.55], [0, 1]);
  const scale = useTransform(progress, [0, 1], [0.9, 1]);
  const rise = useTransform(progress, [0, 1], [80, 0]);
  const hover = useHover();
  const y = useTransform([rise, hover.y], ([a, b]) => a + b);
  return { ref, style: { opacity, scale, y }, ...hover.handlers };
}

function useFocus() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const away = useTransform(scrollYProgress, (p) => Math.min(1, Math.abs(p * 2 - 1)));
  const scale = useTransform(away, (d) => 1 - 0.1 * d * d);
  const opacity = useTransform(away, (d) => 1 - 0.85 * smoothstep(0.5, 1, d));
  const hover = useHover();
  return { ref, style: { opacity, scale, y: hover.y }, ...hover.handlers };
}

function useJelly() {
  const ref = useRef(null);
  const lag = useColumnLag(ref);
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const drag = useTransform([velocity, lag], ([v, l]) =>
    Math.max(-40, Math.min(40, v * (0.006 + 0.01 * l)))
  );
  // underdamped on purpose so it wobbles when the scroll stops
  const trail = useSpring(drag, { stiffness: 170, damping: 12, mass: 0.8 });

  const drop = useMotionValue(90);
  const opacity = useMotionValue(0);
  const seen = useInView(ref, { once: true, amount: 0.15 });
  useLayoutEffect(() => {
    if (!seen) {
      return undefined;
    }
    const delay = lag.get() * 0.2;
    const a = animate(drop, 0, { type: 'spring', stiffness: 150, damping: 11, delay });
    const b = animate(opacity, 1, { duration: 0.45, ease: 'easeOut', delay });
    return () => {
      a.stop();
      b.stop();
    };
  }, [seen, lag, drop, opacity]);

  const hover = useHover();
  const y = useTransform([drop, trail, hover.y], ([a, b, c]) => a + b + c);
  return { ref, style: { opacity, y }, ...hover.handlers };
}

function useHover() {
  const y = useSpring(0, { stiffness: 500, damping: 35 });
  return {
    y,
    handlers: {
      onHoverStart: () => y.set(HOVER_LIFT.y),
      onHoverEnd: () => y.set(0),
    },
  };
}

function useColumnLag(ref) {
  const lag = useMotionValue(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      const grid = el?.parentElement;
      if (!el || !grid) {
        return;
      }
      // offsetLeft ignores transforms so the motions can't feed back into it
      const width = grid.clientWidth - el.offsetWidth;
      lag.set(width > 1 ? clamp01((el.offsetLeft - grid.offsetLeft) / width) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref, lag]);
  return lag;
}

export function GalleryMotionPicker({ name, onChange }) {
  const [shown] = useState(() => {
    try {
      return (
        new URLSearchParams(window.location.search).has('reveal') ||
        sessionStorage.getItem(STORAGE_KEY) !== null
      );
    } catch {
      return false;
    }
  });
  if (!shown) {
    return null;
  }
  return (
    <div className="fixed bottom-4 left-4 z-40 flex gap-1 rounded-full border border-white/12 bg-[#0d0f14]/85 p-1 text-xs font-semibold backdrop-blur-md">
      {GALLERY_MOTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => {
            onChange(option);
            window.scrollTo({ top: 0 });
          }}
          className={`rounded-full px-3 py-1.5 ${
            option === name ? 'bg-white text-black' : 'text-white/70'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
