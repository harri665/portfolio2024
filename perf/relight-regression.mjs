// Focused post-build check for the CS homepage Relight path.
// Run after the client production build exists: node perf/relight-regression.mjs [--target-fps=24] [--out=results/path]
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { origins, serveBuild, blockVisitLogging } from './lib/sites.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const profiles = {
  phone: { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const profileName = args.profile || 'phone';
if (!profiles[profileName]) throw new Error(`Unknown profile '${profileName}'; use phone, tablet, or desktop.`);
const root = path.resolve('client/build');
const out = path.resolve(args.out || 'perf/results/relight-regression');
const targetFps = args['target-fps'] ? Number(args['target-fps']) : null;
const port = 4173;
await fs.mkdir(out, { recursive: true });
const server = await serveBuild({ buildDir: root, port, apiPort: 3005 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contextProfile = profiles[profileName];
const result = {
  chrome: browser.version(),
  mainBundle: JSON.parse(await fs.readFile(path.join(root, 'asset-manifest.json'), 'utf8')).files['main.js'],
  profile: profileName,
  emulation: contextProfile,
  note: profileName === 'desktop' ? 'Desktop viewport on host GPU.' : 'Mobile/tablet emulation on host GPU; not physical device performance.',
  checks: [],
};
// Deterministic cards exercise the production touch-focus and glass paths. An
// empty repository response would leave the light stationary during scrolling.
const repos = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, name: `renderer-check-${i + 1}`, full_name: `fixture/renderer-check-${i + 1}`,
  description: 'Rendering and interaction fixture for measuring the Cornell room behind project cards.',
  language: 'JavaScript', topics: ['graphics', 'rendering'], fork: false,
  pushed_at: '2026-10-15T00:00:00Z', html_url: 'https://github.com/',
}));
result.workload = '12 deterministic project cards, with normal portfolio glass and touch focus';

async function visit(site, suffix = '') {
  const context = await browser.newContext(contextProfile);
  await context.addInitScript(() => {
    window.__profileAtBoot = localStorage.getItem('relight-quality');
    window.__relightSamples = [];
    window.__relightObserve = (status) => {
      const samples = window.__relightSamples;
      samples.push({ at: performance.now(), ...status });
      if (samples.length > 200) samples.splice(0, samples.length - 200);
    };
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
  await page.goto(`${origins('local', port)[site]}/${suffix}`, { waitUntil: 'load', timeout: 60000 });
  return { context, page, errors };
}

async function waitForRenderer(page) {
  const panel = page.locator('#relight-status');
  await panel.waitFor({ timeout: 60000 });
  await panel.evaluate((el) => { el.open = true; });
  await page.waitForFunction(() => {
    const text = document.querySelector('#relight-status')?.innerText || '';
    return text.includes('WebGPU') || text.includes('WebGL2') || text.includes('off here');
  }, null, { timeout: 60000 });
  return panel;
}

async function waitForText(page, predicate, timeout, label) {
  try {
    await page.waitForFunction(predicate, null, { timeout });
  } catch {
    throw new Error(`${label} did not appear within ${timeout} ms:\n${await page.locator('#relight-status').innerText()}`);
  }
}

const completePredicate = () => {
  const latest = window.__relightSamples?.at(-1);
  const text = (document.querySelector('#relight-status')?.innerText || '').replace(/\s+/g, ' ');
  return latest?.converged === true || /Resting light every pixel, complete/.test(text);
};

async function readSamples(page) {
  const samples = await page.evaluate(() => window.__relightSamples || []);
  if (samples.length < 2) return { available: false, samples: samples.length };
  const first = samples[0];
  const last = samples.at(-1);
  const wallSeconds = (last.at - first.at) / 1000;
  const measuredSeconds = Number(last.measuredSeconds) - Number(first.measuredSeconds);
  const seconds = measuredSeconds > 0 ? measuredSeconds : wallSeconds;
  const delta = (key) => Number.isFinite(Number(last[key])) && Number.isFinite(Number(first[key]))
    ? Math.max(0, Number(last[key]) - Number(first[key])) : null;
  const sceneUpdates = delta('sceneUpdates');
  return {
    available: sceneUpdates !== null && seconds >= 1,
    samples: samples.length,
    observedSeconds: Number(seconds.toFixed(2)),
    sceneFps: sceneUpdates !== null && seconds > 0 ? Number((sceneUpdates / seconds).toFixed(1)) : null,
    lightingUpdatesPerSecond: delta('lightingUpdates') !== null && wallSeconds > 0
      ? Number((delta('lightingUpdates') / wallSeconds).toFixed(2)) : null,
    refinementUpdatesPerSecond: delta('refinementUpdates') !== null && wallSeconds > 0
      ? Number((delta('refinementUpdates') / wallSeconds).toFixed(2)) : null,
    missedFrames: delta('missedFrames'),
    converged: last.converged ?? null,
    refining: last.refining ?? null,
  };
}

async function warmAndSettle(page, backend) {
  const panel = await waitForRenderer(page);
  await page.waitForTimeout(12000); // renderer startup, shader compilation, and initial refinement
  const status = await panel.innerText();
  if (!status.includes(backend)) throw new Error(`Expected ${backend} renderer, got:\n${status}`);
  if (!/image/i.test(status) || !status.includes('Moving light') || !status.includes('Resting light')) {
    throw new Error(`Renderer status is missing quality fields:\n${status}`);
  }
  await waitForText(page, completePredicate, 30000, 'every-pixel resting quality');
  if (targetFps) {
    await waitForText(page, () => window.__relightSamples?.at(-1)?.seeded === false, 30000, 'fresh timing on the installed engine');
  }
  await waitForText(page, () => !!localStorage.getItem('relight-quality'), 20000, 'saved Relight profile');
  return panel;
}

async function capture(page, stage) {
  const observed = await page.evaluate(() => window.__relightSamples?.at(-1) || null);
  return { stage, text: await page.locator('#relight-status').innerText(), observed };
}

try {
  const run = await visit('cs');
  await warmAndSettle(run.page, 'WebGPU');
  const targetText = (await run.page.locator('#relight-status').innerText()).replace(/\s+/g, ' ');
  if (targetFps && !targetText.includes(`Lighting target ${targetFps} updates a second`) && !targetText.includes(`${targetFps} fps`)) {
    throw new Error(`Requested ${targetFps} FPS target is absent from renderer status`);
  }
  const snapshots = [await capture(run.page, 'initial-resting')];
  if (await run.page.locator('[data-prism-panel] [data-liquid-glass]').count() !== repos.length) {
    throw new Error('Expected project-card workload is missing');
  }
  // Touch visits scroll through cards; desktop moves a real pointer across the room each animation frame.
  const movingStart = await run.page.evaluate(() => performance.now());
  if (profileName === 'desktop') {
    await run.page.evaluate(async () => {
      const began = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          const t = Math.min(1, (now - began) / 8000);
          const x = 24 + (innerWidth - 48) * t;
          const y = innerHeight * (0.3 + 0.4 * Math.sin(t * Math.PI * 4));
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }));
          if (t < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
    });
  } else {
    await run.page.evaluate(async () => {
      const start = scrollY;
      const end = Math.min(document.documentElement.scrollHeight - innerHeight, start + innerHeight * 2.5);
      const began = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          const t = Math.min(1, (now - began) / 8000);
          scrollTo(0, start + (end - start) * t);
          if (t < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
    });
  }
  await run.page.waitForTimeout(500);
  snapshots.push(await capture(run.page, 'moving-scroll'));
  const movingStats = await run.page.evaluate((start) => {
    const s = (window.__relightSamples || []).filter((sample) => sample.at >= start);
    if (s.length < 2) return { available: false, samples: s.length };
    const first = s[0]; const last = s.at(-1);
    const wall = (last.at - first.at) / 1000;
    const measured = Number(last.measuredSeconds) - Number(first.measuredSeconds);
    const seconds = measured > 0 ? measured : wall;
    const delta = (k) => Number.isFinite(Number(last[k])) && Number.isFinite(Number(first[k]))
      ? Math.max(0, Number(last[k]) - Number(first[k])) : null;
    const updates = delta('sceneUpdates');
    return {
      available: updates !== null && seconds >= 4,
      samples: s.length,
      observedSeconds: Number(seconds.toFixed(2)),
      sceneFps: updates !== null && seconds > 0 ? Number((updates / seconds).toFixed(1)) : null,
      lightingUpdates: delta('lightingUpdates'),
      refinementUpdates: delta('refinementUpdates'),
      missedFrames: delta('missedFrames'),
      convergedAtEnd: last.converged ?? null,
      refiningAtEnd: last.refining ?? null,
    };
  }, movingStart);
  if (targetFps && movingStats.available && (movingStats.sceneFps < 12 || movingStats.sceneFps > targetFps + 8)) {
    throw new Error(`Scene cadence is grossly outside the ${targetFps} FPS target: ${JSON.stringify(movingStats)}`);
  }
  if (targetFps && movingStats.available) {
    movingStats.withinTargetBand = movingStats.sceneFps >= targetFps - 2 && movingStats.sceneFps <= targetFps + 1;
    movingStats.targetBand = `${targetFps - 2}-${targetFps + 1} FPS`;
  }
  if (movingStats.available && movingStats.lightingUpdates === 0) {
    throw new Error('The interaction did not exercise the moving light');
  }
  if (profileName !== 'desktop') await run.page.evaluate(() => scrollTo(0, innerHeight * 1.2));
  await run.page.waitForTimeout(6000);
  await waitForText(run.page, completePredicate, 15000, 'every-pixel quality after scroll settles');
  snapshots.push(await capture(run.page, 'scrolled-settled'));
  await run.page.setViewportSize({ width: 820, height: 900 });
  await run.page.waitForTimeout(1200);
  snapshots.push(await capture(run.page, 'resized'));
  await run.page.screenshot({ path: path.join(out, 'cs-settled.png'), fullPage: false });

  const cacheBeforeReset = await run.page.evaluate(() => localStorage.getItem('relight-quality'));
  if (!cacheBeforeReset) throw new Error('Relight quality profile was not persisted');
  await run.page.evaluate(() => localStorage.setItem('relight-regression-unrelated', 'preserve'));
  await Promise.all([
    run.page.waitForNavigation({ waitUntil: 'load' }),
    run.page.getByRole('button', { name: 'Clear cached settings', exact: true }).click(),
  ]);
  const resetBoot = await run.page.evaluate(() => ({ profile: window.__profileAtBoot, unrelated: localStorage.getItem('relight-regression-unrelated') }));
  if (resetBoot.profile !== null || resetBoot.unrelated !== 'preserve') {
    throw new Error(`Cache reset did not clear only the Relight profile: ${JSON.stringify(resetBoot)}`);
  }
  const resetPanel = await warmAndSettle(run.page, 'WebGPU');
  if (!(await resetPanel.innerText()).includes('being tuned on this visit')) throw new Error('Reset page reused its previous quality profile');
  if (run.errors.length) throw new Error(`CS page errors: ${run.errors.join('; ')}`);
  result.checks.push({ site: 'cs', snapshots, movingStats, cacheReset: 'passed', errors: run.errors });
  await run.context.close();

  // Forced fallback must actually run WebGL2 in Chrome, not silently show the knot poster.
  const fallback = await visit('cs', '?relight=webgl');
  await warmAndSettle(fallback.page, 'WebGL2');
  await fallback.page.screenshot({ path: path.join(out, 'cs-webgl-settled.png'), fullPage: false });
  if (fallback.errors.length) throw new Error(`Forced WebGL page errors: ${fallback.errors.join('; ')}`);
  result.checks.push({ site: 'cs?relight=webgl', text: await fallback.page.locator('#relight-status').innerText(), observer: await readSamples(fallback.page), errors: fallback.errors });
  await fallback.context.close();

  // The top-level portfolio uses the hub scene; Art keeps its knot scene. Neither should mount CS Relight status.
  for (const site of ['root', 'art']) {
    const other = await visit(site);
    await other.page.waitForTimeout(3500);
    const hasRelightPanel = await other.page.locator('#relight-status').count();
    if (hasRelightPanel || other.errors.length) {
      throw new Error(`${site} unexpectedly mounted CS Relight or raised page errors: ${other.errors.join('; ')}`);
    }
    result.checks.push({ site, relightPanel: false, errors: other.errors });
    await other.context.close();
  }
  const output = JSON.stringify(result, null, 2);
  await fs.writeFile(path.join(out, 'report.json'), output);
  console.log(output);
} catch (error) {
  result.error = error?.stack || String(error);
  const output = JSON.stringify(result, null, 2);
  await fs.writeFile(path.join(out, 'report.json'), output);
  console.error(output);
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
