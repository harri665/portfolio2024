// signs there's a person behind a page view, for the admin visitor logs

import { sendReport, setVisit, visitId } from './visit';

const counts = { moves: 0, clicks: 0, touches: 0, scrolls: 0, keys: 0 };
const loadedAt = performance.now();
let firstInput = null;
let firstInputMs = null;
let renderer;
let view = null;

function record(kind, type) {
  return (event) => {
    if (!event.isTrusted) {
      return;
    }
    counts[kind] += 1;
    if (!firstInput) {
      firstInput = type ?? event.pointerType ?? event.type;
      firstInputMs = Math.round(performance.now() - loadedAt);
    }
    if (view && !view.reported) {
      report(view);
    }
  };
}

// swiftshader/llvmpipe = headless browsers and VMs
function probeRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) {
      renderer = 'none';
      return;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).slice(0, 120);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    renderer = 'error';
  }
}

function signs(v) {
  const size = (w, h) => `${Math.round(w)}x${Math.round(h)}`;
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  const input = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n - v.base[k]]));
  return {
    ...input,
    firstInput: firstInput ?? undefined,
    firstInputMs: firstInputMs ?? undefined,
    dwellMs: Math.round(performance.now() - v.startedAt),
    webdriver: !!navigator.webdriver,
    language: navigator.language,
    languages: navigator.languages?.length ?? 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffset: new Date().getTimezoneOffset(),
    screen: `${size(window.screen.width, window.screen.height)}@${dpr}`,
    viewport: size(window.innerWidth, window.innerHeight),
    outer: size(window.outerWidth, window.outerHeight),
    touchPoints: navigator.maxTouchPoints ?? 0,
    finePointer: window.matchMedia?.('(pointer: fine)').matches ?? false,
    cores: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory,
    visibility: document.visibilityState,
    renderer,
  };
}

function report(v) {
  v.reported = true;
  sendReport('visitor', signs(v), v.id);
}

let installed = false;

function install() {
  installed = true;
  const opts = { capture: true, passive: true };
  window.addEventListener('pointermove', record('moves'), opts);
  window.addEventListener('pointerdown', record('clicks'), opts);
  window.addEventListener('touchstart', record('touches', 'touch'), opts);
  // wheel not scroll, the page scrolls itself on route changes
  window.addEventListener('wheel', record('scrolls', 'wheel'), opts);
  window.addEventListener('keydown', record('keys', 'key'), opts);
  window.addEventListener('pagehide', () => view && report(view));
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
  idle(probeRenderer);
}

export function startVisit(idPromise) {
  if (!installed) {
    install();
  }
  if (view) {
    report(view);
  }
  setVisit(idPromise);
  const v = { id: visitId(), startedAt: performance.now(), reported: false, base: { ...counts } };
  view = v;
}
