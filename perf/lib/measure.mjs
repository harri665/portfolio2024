import { blockVisitLogging, waitForQuiet } from './sites.mjs';
import { networkConditions } from './profiles.mjs';

// Legacy browser-callback threshold used across every page. Relight's separate
// 24 Hz submission cadence is measured from its own counters below.
export const LATE_MS = (1000 / 30) * 1.1;

function instrument() {
  const perf = { lcp: null, cls: 0, longTasks: [], canvases: [], relight: [] };
  window.__perf = perf;
  // The renderer calls this only when diagnostics explicitly install an observer.
  window.__relightObserve = (status) => {
    perf.relight.push({ at: performance.now(), status: { ...status } });
    if (perf.relight.length > 200) perf.relight.shift();
  };
  const observe = (type, fn) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true });
    } catch {
      // not supported
    }
  };
  observe('largest-contentful-paint', (e) => { perf.lcp = e.startTime; });
  observe('layout-shift', (e) => { if (!e.hadRecentInput) perf.cls += e.value; });
  observe('longtask', (e) => { perf.longTasks.push([e.startTime, e.duration]); });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !perf.canvases.includes(this)) {
      perf.canvases.push(this);
    }
    return ctx;
  };
}

export async function measurePage(context, profile, url, opts) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message.split('\n')[0]));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text().split('\n')[0]));

  const bytes = trackBytes(cdp);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (profile.cpu > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  }
  const network = networkConditions(profile.network);
  if (network) {
    await cdp.send('Network.emulateNetworkConditions', network);
  }

  try {
    await page.goto(url, { waitUntil: 'load', timeout: opts.timeout });
    await waitForQuiet(page, { timeout: opts.quietTimeout });
    await page.waitForTimeout(opts.settle);

    const load = { ...(await page.evaluate(loadTimings)), ...bytes.snapshot(), ...(await cpuCounters(cdp)) };
    const result = { load, errors, frames: null, three: null };

    const canvases = await page.evaluate(() => window.__perf.canvases.filter((c) => c.isConnected).length);
    if (!canvases || !opts.frames) {
      result.three = canvases ? { canvases } : null;
      return result;
    }

    result.frames = {};
    if (!profile.context.hasTouch) {
      result.frames.pointer = await phase(page, cdp, 'pointer', opts.duration);
    }
    result.frames.idle = await phase(page, cdp, 'idle', opts.duration);
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight > 50);
    if (scrollable) {
      result.frames.scroll = await phase(page, cdp, 'scroll', opts.duration);
    }
    result.three = await page.evaluate(threeState);

    if (result.three.relight && !profile.context.hasTouch) {
      await page.reload({ waitUntil: 'load', timeout: opts.timeout });
      await waitForQuiet(page, { timeout: opts.quietTimeout });
      await page.waitForTimeout(opts.settle);
      result.frames.pointerReturn = await phase(page, cdp, 'pointer', opts.duration);
    }
    return result;
  } finally {
    await page.close();
  }
}

async function phase(page, cdp, kind, seconds) {
  const { width, height } = page.viewportSize();
  const before = await cpuCounters(cdp);
  if (kind === 'pointer') {
    await page.mouse.move(width / 2, height / 2);
  }
  const sampling = page.evaluate(sampleFrames, { kind, seconds });
  if (kind === 'pointer') {
    const t0 = Date.now();
    let done = false;
    sampling.finally(() => { done = true; });
    while (!done && Date.now() - t0 < seconds * 1000) {
      const t = (Date.now() - t0) / 1000;
      await page.mouse.move(width * (0.5 + 0.38 * Math.sin(t * 2.1)), height * (0.5 + 0.34 * Math.sin(t * 3.3 + 1)));
      await page.waitForTimeout(8);
    }
  }
  const { deltas, longTaskMs, relight } = await sampling;
  const after = await cpuCounters(cdp);
  return {
    ...frameStats(deltas),
    longTaskMs: round(longTaskMs),
    busyPct: round(((after.cpuMs - before.cpuMs) / (seconds * 1000)) * 100),
    relight: summarizeRelight(relight),
  };
}

function sampleFrames({ kind, seconds }) {
  return new Promise((resolve) => {
    const deltas = [];
    const maxScroll = document.documentElement.scrollHeight - innerHeight;
    const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    let start = null;
    let last = null;
    const frame = (t) => {
      if (start === null) {
        start = t;
      } else {
        deltas.push(t - last);
      }
      last = t;
      const u = (t - start) / (seconds * 1000);
      if (kind === 'scroll') {
        window.scrollTo({ top: maxScroll * ease(u < 0.5 ? u * 2 : 2 - u * 2), behavior: 'instant' });
      }
      if (u < 1) {
        requestAnimationFrame(frame);
        return;
      }
      if (kind === 'scroll') {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      const longTaskMs = window.__perf.longTasks
        .filter(([s]) => s >= start && s <= t)
        .reduce((sum, [, d]) => sum + d, 0);
      // Keep only publications inside this phase. Their counter window can be
      // shorter than the callback window because status is published every 0.5 s.
      const relight = (window.__perf.relight || []).filter((s) => s.at >= start && s.at <= t);
      resolve({ deltas, longTaskMs, relight });
    };
    requestAnimationFrame(frame);
  });
}

// These counters describe submitted scene/lighting work, never confirmed display
// scanout or GPU completion. Preserve the browser-rAF frameStats separately.
export function summarizeRelight(snapshots = []) {
  const counters = ['sceneUpdates', 'measuredSeconds', 'missedFrames', 'lightingUpdates', 'refinementUpdates'];
  let samples = [];
  let resets = 0;
  for (const entry of snapshots) {
    if (!Number.isFinite(entry?.at) || entry.status?.phase !== 'running' ||
      !counters.every((key) => Number.isFinite(entry.status[key]) && entry.status[key] >= 0)) continue;
    const previous = samples.at(-1);
    if (previous && (entry.at <= previous.at || counters.some((key) => entry.status[key] < previous.status[key]))) {
      samples = [];
      resets += 1;
    }
    samples.push(entry);
  }
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples.at(-1);
  const observedSeconds = (last.at - first.at) / 1000;
  const delta = Object.fromEntries(counters.map((key) => [key, last.status[key] - first.status[key]]));
  const rate = (count, seconds) => seconds > 0 ? round(count / seconds) : null;
  return {
    cadence: 'submitted work; not confirmed display or GPU completion',
    samples: samples.length,
    counterResets: resets,
    observedSeconds: Math.round(observedSeconds * 1000) / 1000,
    ...delta,
    measuredSeconds: Math.round(delta.measuredSeconds * 1000) / 1000,
    sceneUpdateHz: rate(delta.sceneUpdates, delta.measuredSeconds),
    lightingSubmissionHz: rate(delta.lightingUpdates, observedSeconds),
    refinementSubmissionHz: rate(delta.refinementUpdates, observedSeconds),
    missedPct: delta.sceneUpdates > 0 ? round(delta.missedFrames / delta.sceneUpdates * 100) : null,
    targetHz: last.status.fps,
    backend: last.status.backend,
    size: last.status.size,
    network: last.status.network,
  };
}

export function frameStats(deltas) {
  if (!deltas.length) {
    return { frames: 0 };
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const total = deltas.reduce((a, b) => a + b, 0);
  return {
    frames: deltas.length,
    fps: round((deltas.length * 1000) / total),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1]),
    latePct: round((deltas.filter((d) => d > LATE_MS).length / deltas.length) * 100),
  };
}

function loadTimings() {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
  const perf = window.__perf;
  // same as lighthouse counts it
  const tbt = perf.longTasks
    .filter(([s]) => fcp !== null && s >= fcp)
    .reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
  const r = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    ttfb: r(nav?.responseStart),
    fcp: r(fcp),
    lcp: r(perf.lcp),
    dcl: r(nav?.domContentLoadedEventEnd),
    loaded: r(nav?.loadEventEnd),
    cls: Math.round(perf.cls * 1000) / 1000,
    tbt: r(tbt),
    longTasks: perf.longTasks.length,
  };
}

function threeState() {
  const canvases = window.__perf.canvases.filter((c) => c.isConnected);
  const latest = window.__perf.relight?.at(-1);
  // A saved profile can outlive the renderer or belong to a different scene.
  // Only a recent live publication establishes that Relight is mounted here.
  const relight = canvases.length && latest?.status.phase === 'running' && performance.now() - latest.at < 2000
    ? { ...latest.status } : null;
  return {
    canvases: canvases.length,
    size: canvases.map((c) => `${c.width}x${c.height}`).join(' '),
    dpr: canvases.length ? Math.round((canvases[0].width / Math.max(1, canvases[0].clientWidth)) * 100) / 100 : null,
    relight,
  };
}

function trackBytes(cdp) {
  const types = new Map();
  const totals = { requests: 0, kb: 0, jsKb: 0, relightKb: 0 };
  cdp.on('Network.requestWillBeSent', (e) => types.set(e.requestId, { type: e.type, url: e.request.url }));
  cdp.on('Network.loadingFinished', (e) => {
    const req = types.get(e.requestId) || {};
    const kb = e.encodedDataLength / 1024;
    totals.requests += 1;
    totals.kb += kb;
    if (req.type === 'Script') {
      totals.jsKb += kb;
    }
    if (/\/relight\//.test(req.url || '')) {
      totals.relightKb += kb;
    }
  });
  return {
    snapshot: () => Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)])),
  };
}

async function cpuCounters(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
  return {
    cpuMs: Math.round(m.TaskDuration * 1000),
    scriptMs: Math.round(m.ScriptDuration * 1000),
    heapMb: Math.round((m.JSHeapUsedSize / 1024 / 1024) * 10) / 10,
  };
}

function round(v) {
  return Math.round(v * 10) / 10;
}

export { instrument, threeState };
