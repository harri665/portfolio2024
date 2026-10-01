import { useEffect, useState } from 'react';

// When the 3D scenes start. Starting one is the heaviest thing the site
// does: three.js has to be parsed and the shaders compiled, which holds the
// main thread for a few hundred milliseconds even on a fast machine, and far
// longer on a phone. So a page first paints with a still of its scene (a
// poster, see Prism.js), and the live scene starts once the page has loaded
// and the visitor does something (moves the pointer, scrolls, touches the
// screen, presses a key), or START_DELAY_MS after load if they don't. Doing
// something while the page loads counts too: the scene then starts at load.
// Once one scene has started, the next page's starts straight away.
const START_DELAY_MS = 3500;
const START_EVENTS = ['pointermove', 'pointerdown', 'wheel', 'touchstart', 'keydown', 'scroll'];
const LISTEN = { passive: true };

let started = false;
let loaded = false;
let interacted = false;
let timer = 0;
const listeners = new Set();

function start() {
  if (started) {
    return;
  }
  started = true;
  clearTimeout(timer);
  START_EVENTS.forEach((type) => window.removeEventListener(type, interact, LISTEN));
  listeners.forEach((listener) => listener());
  listeners.clear();
}

function interact() {
  interacted = true;
  if (loaded) {
    start();
  }
}

function arm() {
  START_EVENTS.forEach((type) => window.addEventListener(type, interact, LISTEN));
  afterLoad(() => {
    loaded = true;
    if (interacted) {
      start();
    } else {
      timer = setTimeout(start, START_DELAY_MS);
    }
  });
}

// Runs `callback` once the page has loaded (now, if it has); returns a
// cleanup that cancels it
export function afterLoad(callback) {
  if (document.readyState === 'complete') {
    callback();
    return undefined;
  }
  window.addEventListener('load', callback, { once: true });
  return () => window.removeEventListener('load', callback);
}

// Armed as soon as the app's script runs, so a pointer moved while the page
// is still loading counts
if (typeof window !== 'undefined') {
  arm();
}

// True once the scenes may start
export default function useSceneStart() {
  const [ready, setReady] = useState(started);

  useEffect(() => {
    if (started) {
      setReady(true);
      return undefined;
    }
    const listener = () => setReady(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return ready;
}
