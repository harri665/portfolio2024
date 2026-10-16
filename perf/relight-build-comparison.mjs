// Controlled CS Relight production-build comparison. Uses only installed Chrome.
// node perf/relight-build-comparison.mjs [--out=perf/results/build-comparison] [--repeats=2]
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { origins, serveBuild, blockVisitLogging } from './lib/sites.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const out = path.resolve(args.out || 'perf/results/build-comparison');
const repeats = Number(args.repeats || 2);
const restSeconds = Number(args['rest-seconds'] || 7);
const builds = [
  { id: '2026-10-07-d38a7ef', label: 'Latest available by 2026-10-14 (reconstructed)', dir: path.resolve('perf/results/build-comparison/snapshots/2026-10-07-d38a7ef/client/build'), commit: 'd38a7ef7a1cca3db686f27f2b647bcb09d17e21f' },
  { id: '2026-10-15-c581203', label: 'Today HEAD before cluster', dir: path.resolve('perf/results/build-comparison/snapshots/2026-10-15-c581203/client/build'), commit: 'c581203befcb0f32e4b5415765e1b27820bcfb84' },
  { id: '2026-10-15-working-tree', label: 'Today working-tree production build', dir: path.resolve('client/build'), commit: 'working tree; manifest main.5a94146f.js' },
];
const profiles = {
  phone: { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const port = 4183;
const repos = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, name: `renderer-check-${i + 1}`, full_name: `fixture/renderer-check-${i + 1}`,
  description: 'Rendering and interaction fixture for the Cornell room behind project cards.',
  language: 'JavaScript', topics: ['graphics', 'rendering'], fork: false,
  pushed_at: '2026-10-15T00:00:00Z', html_url: 'https://github.com/',
}));
await fs.mkdir(out, { recursive: true });
const previousReport = args.resume ? JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8')) : null;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {
  createdAt: new Date().toISOString(), chrome: browser.version(), repeats,
  workload: '12 deterministic project cards; 8 seconds of scroll/touch-focus movement; clean browser context per run',
  limitations: [
    'Phone and tablet are Chrome viewport emulations on the host GPU, not physical devices.',
    'The historical version is reconstructed from d38a7ef (Oct 7), the latest commit available by Oct 14; no Oct 14 build artifact or commit exists in available refs.',
    'Historical versions lack the today-only __relightObserve submission counters. Browser RAF is recorded separately and is not treated as renderer cadence.',
    'No scheduling or quality semantics were changed for measurement.',
  ], runs: previousReport?.runs || [],
};

async function getBuildMeta(build) {
  const manifest = JSON.parse(await fs.readFile(path.join(build.dir, 'asset-manifest.json'), 'utf8'));
  return { ...build, mainBundle: manifest.files['main.js'], manifestFiles: manifest.files };
}
async function oneRun(build, profileName, backend, repeat, runIndex) {
  const server = await serveBuild({ buildDir: build.dir, port, apiPort: 3005 });
  const context = await browser.newContext(profiles[profileName]);
  const observer = { relight: [], raf: [], longTasks: [] };
  await context.addInitScript(() => {
    window.__relightSamples = [];
    window.__relightObserve = (status) => { window.__relightSamples.push({ at: performance.now(), ...status }); };
    window.__relightComparison = { sceneAdvances: 0, evaluations: 0, composites: 0 };
    window.__benchRaf = [];
    let prev;
    const tick = (now) => { if (prev !== undefined) window.__benchRaf.push({ at: now, interval: now - prev }); prev = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try { new PerformanceObserver((list) => window.__benchLongTasks.push(...list.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true }); } catch {}
    window.__benchLongTasks = [];
  });
  await blockVisitLogging(context);
  await context.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const body = pathname.endsWith('/cs-config') ? '{"enabled":false}' : pathname.endsWith('/github/repos') ? JSON.stringify(repos) : '{}';
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const query = backend === 'WebGL2' ? '?relight=webgl' : '';
  const started = Date.now();
  const result = { build: build.id, profile: profileName, backend, repeat, runIndex, startedAt: new Date().toISOString(), errors };
  try {
    await page.goto(`${origins('local', port).cs}/${query}`, { waitUntil: 'load', timeout: 60000 });
    const panel = page.locator('#relight-status');
    await panel.waitFor({ timeout: 60000 });
    await panel.evaluate((el) => { el.open = true; });
    await page.waitForFunction(() => /WebGPU|WebGL2|off here/.test(document.querySelector('#relight-status')?.innerText || ''), null, { timeout: 60000 });
    await page.waitForTimeout(12000);
    result.initStatus = await panel.innerText();
    if (!result.initStatus.includes(backend)) throw new Error(`Expected ${backend}; status was ${result.initStatus}`);
    result.readyAndWarmupSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
    result.initialObserved = await page.evaluate(() => window.__relightSamples?.at(-1) || null);
    if (await page.locator('[data-prism-panel] [data-liquid-glass]').count() !== repos.length) throw new Error('12-card workload did not load');
    const movingStart = await page.evaluate(() => performance.now());
    await page.evaluate(async () => {
      const start = scrollY;
      const end = Math.min(document.documentElement.scrollHeight - innerHeight, start + innerHeight * 2.5);
      const began = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => { const t = Math.min(1, (now - began) / 8000); scrollTo(0, start + (end - start) * t); if (t < 1) requestAnimationFrame(tick); else resolve(); };
        requestAnimationFrame(tick);
      });
    });
    result.movementStatus = await panel.innerText();
    const movementEnd = await page.evaluate(() => performance.now());
    result.movingObserved = await page.evaluate(({ start, end }) => {
      const samples = (window.__relightSamples || []).filter((s) => s.at >= start);
      if (samples.length < 2) return { available: false, observerSamples: samples.length };
      const s = samples.filter((v) => v.at <= end);
      const a = samples[0], b = s.at(-1) || samples.at(-1), dt = (b.at - a.at) / 1000;
      const counter = (v, key) => v.measured?.[key] ?? v[key] ?? null;
      const delta = (k) => {
        const x = counter(a, k), y = counter(b, k);
        return x !== null && y !== null && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && Number(y) >= Number(x) ? Number(y) - Number(x) : null;
      };
      const submissionDelta = (k) => Number.isFinite(Number(a.submissions?.[k])) && Number.isFinite(Number(b.submissions?.[k])) && Number(b.submissions[k]) >= Number(a.submissions[k]) ? Number(b.submissions[k]) - Number(a.submissions[k]) : null;
      const measuredSeconds = delta('measuredSeconds');
      return { available: true, wallSeconds: dt, measuredSecondsDelta: measuredSeconds, sceneUpdates: delta('sceneUpdates'), rendererSceneUpdatesPerMeasuredSecond: delta('sceneUpdates') !== null && measuredSeconds > 0 ? delta('sceneUpdates') / measuredSeconds : null, missedFrames: delta('missedFrames'), sceneAdvanceCalls: submissionDelta('sceneAdvances'), evaluateCalls: submissionDelta('evaluations'), compositeCalls: submissionDelta('composites'), changedLightingUpdates: delta('lightingUpdates'), refinementUpdates: delta('refinementUpdates'), first: a, last: b };
    }, { start: movingStart, end: movementEnd });
    await page.waitForTimeout(restSeconds * 1000);
    result.restWindowSeconds = restSeconds;
    result.restStatus = await panel.innerText();
    result.restObserved = await page.evaluate(() => window.__relightSamples?.at(-1) || null);
    result.restTimeline = await page.evaluate((start) => {
      const samples = (window.__relightSamples || []).filter((s) => s.at >= start);
      const bySecond = new Map();
      for (const s of samples) bySecond.set(Math.floor((s.at - start) / 1000), {
        second: Math.floor((s.at - start) / 1000), backend: s.backend ?? null, sourceSize: s.size ?? null,
        targetFps: s.fps ?? null, upgrading: s.upgrading ?? null, budget: s.budget ?? null,
        measured: s.measured ?? null, lightWork: s.lightWork ?? null,
      });
      return [...bySecond.values()];
    }, movementEnd);
    result.restQuality = await page.evaluate(() => {
      const s = window.__relightSamples?.at(-1);
      const lights = s?.lightWork;
      return { target: s?.fps ?? null, sourceSize: s?.size ?? null, converged: s?.converged ?? (lights ? Object.values(lights).every((v) => (v.currentStrideComplete ?? (v.stride === 1 && !v.refining)) && v.coversView) : null), lightWork: lights ?? null };
    });
    await page.screenshot({ path: path.join(out, `${build.id}-${profileName}-${backend}-r${repeat}.png`), fullPage: false });
    result.browserRaf = await page.evaluate(({ start, end }) => {
      const all = window.__benchRaf || [];
      const summarize = (items) => { const values = items.map((v) => v.interval); const sorted = [...values].sort((x, y) => x - y); return { samples: values.length, medianIntervalMs: sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)) : null, intervalsOver50ms: values.filter((x) => x > 50).length, intervalsOver100ms: values.filter((x) => x > 100).length }; };
      return { moving: summarize(all.filter((v) => v.at >= start && v.at <= end)), resting: summarize(all.filter((v) => v.at > end + 500)) };
    }, { start: movingStart, end: movementEnd });
    result.longTasksMs = await page.evaluate(() => window.__benchLongTasks || []);
    result.heapUsedBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    result.errors = errors;
    result.elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
  } catch (error) {
    result.error = error?.stack || String(error);
    result.elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
  } finally {
    await context.close(); await new Promise((resolve) => server.close(resolve));
  }
  report.runs.push(result);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ build: build.id, profile: profileName, backend, repeat, elapsedSeconds: result.elapsedSeconds, error: result.error || null }));
}

try {
  const prepared = [];
  for (const b of builds) prepared.push(await getBuildMeta(b));
  report.builds = prepared.map(({ id, label, commit, mainBundle }) => ({ id, label, commit, mainBundle }));
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const completed = new Set(report.runs.map((r) => `${r.build}|${r.profile}|${r.backend}|${r.repeat}`));
  const selectedBuilds = args.build ? prepared.filter((b) => b.id === args.build) : prepared;
  const selectedProfiles = args.profile ? [args.profile] : Object.keys(profiles);
  const selectedBackends = args.backend ? [args.backend] : ['WebGPU', 'WebGL2'];
  for (const profile of selectedProfiles) if (!profiles[profile]) throw new Error(`Unknown profile ${profile}`);
  for (const backend of selectedBackends) if (!['WebGPU', 'WebGL2'].includes(backend)) throw new Error(`Unknown backend ${backend}`);
  if (args.build && !selectedBuilds.length) throw new Error(`Unknown build ${args.build}`);
  let index = 0;
  for (const build of selectedBuilds) for (const profile of selectedProfiles) for (const backend of selectedBackends) for (let repeat = 1; repeat <= repeats; repeat++) {
    if (!args.force && completed.has(`${build.id}|${profile}|${backend}|${repeat}`)) continue;
    index += 1;
    console.log(`Starting ${index}: ${build.id} ${profile} ${backend} repeat ${repeat}`);
    await oneRun(build, profile, backend, repeat, index);
  }
} finally { await browser.close(); }
