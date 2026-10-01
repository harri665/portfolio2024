import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaArrowUp, FaDice, FaPause, FaPlay, FaSlidersH, FaStepForward, FaUndo } from 'react-icons/fa';

import DistortedTorusScene from '../Homepage/DistortedTorusScene';
import SubdomainNav from '../Homepage/SubdomainNav';
import { detectSiteMode } from '../../utils/siteMode';

// The glass on this site, as a set of controls fixed over a page that
// scrolls beneath them. The page is ordinary HTML; a WebGL canvas fixed over
// it draws only the glass, and inside each piece a copy of what's behind it,
// pictures and text alike (PaintedPage), bent by the same pass as the rest of
// the site (LiquidGlassPass). The glass and the canvas are both fixed to the
// screen, so the glass never trails its button as the page scrolls.

// Only the glass is drawn; outside it the canvas is clear and the page shows.
// The buttons are small, so their rims are capped to keep a clear middle, and
// the glass darkens over pale paintings so the white labels stay readable.
const GLASS = {
  selector: '[data-liquid-glass]',
  glassOnly: true,
  shade: false,
  blurTaps: 16,
  rimCap: 0.6,
  adapt: 0.4,
};

// Public-domain paintings from the Art Institute of Chicago (CC0)
const PAINTINGS = [
  ['hokusai-great-wave', 'Katsushika Hokusai', 'Under the Wave off Kanagawa', '1830/33'],
  ['monet-water-lilies', 'Claude Monet', 'Water Lilies', '1906'],
  ['seurat-grande-jatte', 'Georges Seurat', 'A Sunday on La Grande Jatte — 1884', '1884–86'],
  ['van-gogh-bedroom', 'Vincent van Gogh', 'The Bedroom', '1889'],
  ['caillebotte-rainy-day', 'Gustave Caillebotte', 'Paris Street; Rainy Day', '1877'],
  ['monet-stacks-of-wheat', 'Claude Monet', 'Stacks of Wheat (End of Summer)', '1890–91'],
];
const paintingUrl = (file) => `${process.env.PUBLIC_URL}/paintings/${file}.jpg`;

// One section of text after each painting
const SECTIONS = [
  [
    'Glass over the page',
    'This page is ordinary HTML. A WebGL canvas fixed over it draws only the glass, and inside each button a copy of whatever is behind it, paintings and text alike, redrawn every frame. Scroll, or press play, and watch the page run under the glass.',
  ],
  [
    'The rim',
    'Toward its edge the glass curves, so what’s behind bends. A thin pane pushes the page outward at the rim; a thick one turns into a lens and pulls in what lies just past its edge, magnifying it. Thickness and rim width set how far that reaches.',
  ],
  [
    'Colour',
    'Glass slows red, green and blue by slightly different amounts, so they land apart. Each channel is sampled from its own offset, and the gap widens where the glass curves most. Turn the colour split up and the edges fan into a spectrum.',
  ],
  [
    'Frost and haze',
    'Frost is a blur through the glass, samples spread on a spiral and weighted toward the middle so it reads as frosting rather than a smear. Haze mixes in a little white, the milkiness of frosted glass; tint mixes in the page colour.',
  ],
  [
    'Merging',
    'Panes in one group are drawn as one shape. Their outlines blend within 44px of each other, so the gap between them fills and the inside corners round off, as with the randomise and reset buttons. The CS project pages join their sidebar to the write-up this way.',
  ],
  [
    'Try it',
    'Every setting is an attribute on the button’s element, read by the pass every frame. Drag the sliders, or roll the dice for a random set and reset to go back. The circle is the same glass: it follows the mouse, and on a phone you drag it with a finger.',
  ],
];

// The controls: [key, label, min, max, step]
const CONTROLS = [
  ['thick', 'Thickness', 1, 1.8, 0.05],
  ['bezel', 'Rim width', 0.5, 3, 0.1],
  ['split', 'Colour split', 0, 6, 0.1],
  ['frost', 'Frost', 0, 30, 1],
  ['tint', 'Tint', 0, 0.6, 0.02],
  ['haze', 'Haze', 0, 0.3, 0.01],
];
const DEFAULTS = { thick: 1.4, bezel: 1.6, split: 1, frost: 2, tint: 0.1, haze: 0.04 };

// The settings, as the attributes the pass reads (LiquidGlassPass)
function glassAttributes(settings) {
  return {
    'data-liquid-glass': String(settings.thick),
    'data-glass-lens': '',
    'data-glass-bezel': String(settings.bezel),
    'data-glass-split': String(settings.split),
    'data-glass-frost': String(settings.frost),
    'data-glass-tint': String(settings.tint),
    'data-glass-haze': String(settings.haze),
  };
}

function randomSettings() {
  return Object.fromEntries(
    CONTROLS.map(([key, , min, max, step]) => {
      const steps = Math.round((max - min) / step);
      return [key, Number((min + Math.round(Math.random() * steps) * step).toFixed(2))];
    })
  );
}

export default function GlassPage() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [panelOpen, setPanelOpen] = useState(
    () => window.matchMedia?.('(min-width: 1024px)').matches ?? false
  );
  const [playing, setPlaying] = useState(false);
  useAutoScroll(playing, setPlaying);

  const glass = glassAttributes(settings);

  return (
    <div className="relative min-h-screen bg-bg text-ink">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-20">
        <DistortedTorusScene variant="cs" lens="cs" backdrop="page" glass={GLASS} className="absolute inset-0" />
      </div>
      <SubdomainNav currentMode={detectSiteMode()} />

      {/* The paintings run nearly the width of the screen, under the buttons on
          the left and the panel on the right; the text keeps to a readable
          column between them */}
      <main className="relative mx-auto max-w-[72rem] px-5 pb-48 pt-28 sm:px-6 sm:pt-36">
        <header className="mx-auto max-w-2xl">
          <h1 data-glass-paint className="text-5xl font-semibold tracking-tight text-ink sm:text-7xl">
            Glass
          </h1>
          <p data-glass-paint className="mt-5 text-lg leading-relaxed text-ink-2">
            The panes on this site bend, frost and split the light behind them. The buttons on the
            left are that glass, fixed over this page as it scrolls under them; the panel sets how
            they’re made.
          </p>
        </header>

        {PAINTINGS.map(([file, artist, title], index) => (
          <section key={file} className="mt-16 sm:mt-24">
            <img
              data-glass-paint
              data-painting
              src={paintingUrl(file)}
              alt={`${artist}, ${title}`}
              className="block h-auto w-full rounded-card"
            />
            <div className="mx-auto max-w-2xl">
              <h2 data-glass-paint className="mt-8 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {SECTIONS[index][0]}
              </h2>
              <p data-glass-paint className="mt-3 text-lg leading-relaxed text-ink-2">
                {SECTIONS[index][1]}
              </p>
            </div>
          </section>
        ))}

        <footer data-glass-paint className="mx-auto mt-24 max-w-2xl text-sm leading-relaxed text-ink-3">
          Paintings, in order:{' '}
          {PAINTINGS.map(([, artist, title, date]) => `${artist}, ${title}, ${date}`).join('; ')}. All
          in the public domain, from the{' '}
          <a
            href="https://www.artic.edu/open-access"
            className="text-ink-2 underline decoration-line/25 underline-offset-4 transition-colors hover:text-ink"
          >
            Art Institute of Chicago
          </a>
          . The navigation bar bends what’s under it in CSS instead, with an SVG displacement map.{' '}
          <Link
            to="/colophon"
            className="text-ink-2 underline decoration-line/25 underline-offset-4 transition-colors hover:text-ink"
          >
            How this site is built
          </Link>
        </footer>
      </main>

      <Cluster
        glass={glass}
        playing={playing}
        onPlay={() => setPlaying((value) => !value)}
        onRandomize={() => setSettings(randomSettings())}
        onReset={() => setSettings(DEFAULTS)}
        panelOpen={panelOpen}
        onPanel={() => setPanelOpen((value) => !value)}
      />

      {panelOpen && <Panel settings={settings} onChange={setSettings} />}

      <Lens glass={glass} />
    </div>
  );
}

// Scrolls the page slowly while playing, stopping at the bottom
function useAutoScroll(playing, setPlaying) {
  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      const bottom = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY >= bottom - 1) {
        setPlaying(false);
        return;
      }
      window.scrollBy(0, 140 * dt);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, setPlaying]);
}

// Scrolls to the next painting below the top of the screen
function nextPainting() {
  const below = [...document.querySelectorAll('[data-painting]')].find(
    (img) => img.getBoundingClientRect().top > 140
  );
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({
    top: below ? below.getBoundingClientRect().top + window.scrollY - 112 : 0,
    behavior: still ? 'auto' : 'smooth',
  });
}

// The buttons: a column just inside the paintings' left edge on wide
// screens, so they pass under it, and a row along the bottom on phones
function Cluster({ glass, playing, onPlay, onRandomize, onReset, panelOpen, onPanel }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-30 flex flex-wrap items-center justify-center gap-3 px-4 sm:bottom-auto sm:left-[max(3rem,calc(50%-33rem))] sm:right-auto sm:top-28 sm:w-[17rem] sm:justify-start sm:gap-4 sm:px-0">
      <Glass glass={glass} as="div" className="hidden px-7 py-3 sm:inline-flex">
        Liquid glass
      </Glass>

      <Glass glass={glass} round label={playing ? 'Pause' : 'Play: scroll the page'} onClick={onPlay}>
        {playing ? <FaPause /> : <FaPlay className="translate-x-0.5" />}
      </Glass>
      <Glass glass={glass} round label="Next painting" onClick={nextPainting}>
        <FaStepForward />
      </Glass>
      <Glass
        glass={glass}
        round
        label="Back to the top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <FaArrowUp />
      </Glass>

      {/* One group: the pass draws the two as one piece of glass */}
      <div className="hidden items-center gap-3 sm:flex">
        <Glass glass={{ ...glass, 'data-glass-merge': '3' }} onClick={onRandomize} className="px-6 py-4">
          <FaDice />
          Randomise
        </Glass>
        <Glass glass={{ ...glass, 'data-glass-merge': '3' }} round label="Reset" onClick={onReset}>
          <FaUndo />
        </Glass>
      </div>

      <Glass glass={glass} onClick={onPanel} aria-expanded={panelOpen} className="px-6 py-4">
        <FaSlidersH />
        Controls
      </Glass>
    </div>
  );
}

// A piece of glass: a pill, or with `round` a circle, as a button by default
function Glass({ glass, as: As = 'button', round = false, label, className = '', children, ...props }) {
  return (
    <As
      {...glass}
      {...(As === 'button' ? { type: 'button' } : {})}
      aria-label={label}
      title={label}
      className={[
        'liquid-glass relative inline-flex shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white',
        'transition-transform duration-200 hover:scale-[1.03] active:scale-95',
        round ? 'h-16 w-16 text-xl' : '',
        className,
      ].join(' ')}
      {...props}
    >
      <span aria-hidden="true" className="liquid-glass-rim" />
      <span className="relative z-[2] inline-flex items-center gap-2 [text-shadow:0_1px_8px_rgb(0_0_0/0.45)]">
        {children}
      </span>
    </As>
  );
}

// The settings panel, itself frosted glass: just inside the paintings' right
// edge on wide screens, above the buttons on phones
function Panel({ settings, onChange }) {
  return (
    <div
      data-liquid-glass=""
      data-glass-frost="20"
      data-glass-tint="0.3"
      data-glass-haze="0.04"
      className="liquid-glass fixed inset-x-4 bottom-24 z-30 max-h-[55vh] overflow-y-auto rounded-card p-6 sm:inset-x-auto sm:bottom-auto sm:right-[max(3rem,calc(50%-33rem))] sm:top-28 sm:max-h-[calc(100vh-9rem)] sm:w-[18rem]"
    >
      <span aria-hidden="true" className="liquid-glass-rim" />
      <div className="relative z-[2] space-y-5">
        <h2 className="text-base font-semibold text-ink">Glass settings</h2>
        {CONTROLS.map(([key, label, min, max, step]) => (
          <label key={key} className="block">
            <span className="flex justify-between text-sm text-ink">
              {label}
              <span className="tabular-nums text-ink-2">{settings[key]}</span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={settings[key]}
              onChange={(event) => onChange({ ...settings, [key]: Number(event.target.value) })}
              className="mt-2 w-full [accent-color:oklch(var(--accent))]"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// A circle of the same glass, to move over the page: it follows the mouse
// (fading over the controls, so it doesn't sit on what's being clicked), and
// on touch screens it's dragged with a finger instead. The pass reads its box
// and inline opacity every frame, so moving it moves the glass.
function Lens({ glass }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const size = () => el.offsetWidth;
    // Where its centre is, and where it's heading
    const at = { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
    const to = { ...at };
    let shown = !window.matchMedia?.('(pointer: fine)').matches;
    let drag = null;
    let frame = 0;
    let last = performance.now();

    const place = () => {
      el.style.transform = `translate(${at.x - size() / 2}px, ${at.y - size() / 2}px)`;
      el.style.opacity = shown ? '1' : '0';
    };
    // Eases toward the mouse, a little behind it, as if dragged through water
    const step = (now) => {
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      const ease = 1 - Math.exp(-dt * 22);
      at.x += (to.x - at.x) * ease;
      at.y += (to.y - at.y) * ease;
      place();
      frame = Math.abs(to.x - at.x) + Math.abs(to.y - at.y) > 0.1 ? requestAnimationFrame(step) : 0;
    };
    // Kept on screen; `now` puts it there at once, under a finger
    const moveTo = (x, y, now = false) => {
      const half = size() / 2;
      to.x = Math.min(Math.max(x, half), window.innerWidth - half);
      to.y = Math.min(Math.max(y, half), window.innerHeight - half);
      if (now) {
        cancelAnimationFrame(frame);
        frame = 0;
        at.x = to.x;
        at.y = to.y;
        place();
      } else if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    };

    // The mouse: followed everywhere, but not over the controls
    const onMove = (event) => {
      if (event.pointerType !== 'mouse') return;
      const overControl = event.target.closest?.('button, a, input, label, [data-liquid-glass]');
      const wasShown = shown;
      shown = !overControl;
      if (!wasShown && shown && !frame) {
        // reappearing: jump to the pointer rather than sliding in from afar
        at.x = to.x = event.clientX;
        at.y = to.y = event.clientY;
      }
      moveTo(event.clientX, event.clientY);
      place();
    };
    const onLeave = () => {
      shown = false;
      place();
    };

    // A finger: dragged from wherever it's picked up
    const onDown = (event) => {
      if (event.pointerType === 'mouse') return;
      drag = { id: event.pointerId, dx: at.x - event.clientX, dy: at.y - event.clientY };
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // the pointer's already gone
      }
    };
    const onDrag = (event) => {
      if (drag?.id !== event.pointerId) return;
      moveTo(event.clientX + drag.dx, event.clientY + drag.dy, true);
    };
    const onUp = (event) => {
      if (drag?.id === event.pointerId) drag = null;
    };
    const onResize = () => moveTo(to.x, to.y, true);

    place();
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onDrag);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onDrag);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // A mouse passes through it to the page; a finger picks it up, without
  // scrolling the page
  return (
    <div
      ref={ref}
      {...glass}
      aria-hidden="true"
      className="liquid-glass fixed left-0 top-0 z-30 h-28 w-28 touch-none rounded-full will-change-transform sm:h-36 sm:w-36 [@media(pointer:fine)]:pointer-events-none"
    >
      <span className="liquid-glass-rim" />
    </div>
  );
}
