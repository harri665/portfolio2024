// Smoke check for the interactive relight path against a built client.
// Run after `npm run build` in client: node perf/relight-motion-check.mjs [--webgl] [--reduced] [--software] [--mobile]
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from 'playwright';

import { blockVisitLogging, serveBuild } from './lib/sites.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const webgl = process.argv.includes('--webgl');
const reduced = process.argv.includes('--reduced');
const software = process.argv.includes('--software');
const mobile = process.argv.includes('--mobile');
const port = 3015;
const output = path.join(HERE, 'results');
fs.mkdirSync(output, { recursive: true });

const server = await serveBuild({ buildDir: path.resolve(HERE, '../client/build'), port, apiPort: 3001 });
let browser;
try {
  browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
      ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
  });
  const context = await browser.newContext({
    ...(mobile ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }),
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await blockVisitLogging(context);
  const cache = JSON.parse(fs.readFileSync(path.resolve(HERE, '../server/data/githubRepoCache.json'), 'utf8'));
  const repos = cache.repoLists['harri665|100|owner|updated'].data.filter((repo) => !repo.fork).slice(0, 9);
  await context.route(/\/api\/cs-config$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }));
  await context.route(/\/api\/github\/repos\?/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(repos) }));
  await context.route(/\/api\/github\/readme-meta\?/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__relightHistory = [];
    window.__relightObserve = (status) => {
      window.__relightHistory.push(status);
    };
  });
  await page.goto(`http://cs.localhost:${port}/${webgl ? '?relight=webgl' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__relightHistory.some((s) => s.phase === 'running'), null, { timeout: 90000 });
  if (!mobile) {
    await page.mouse.move(160, 200);
    await page.waitForTimeout(750);
    await page.mouse.move(1240, 650);
    await page.waitForTimeout(1100);
  }
  const cards = page.locator('[data-liquid-glass]');
  const cardCount = await cards.count();
  let beforeCardSwitch = null;
  let beforeCardShot = null;
  let duringCardSwitch = null;
  if (cardCount) {
    await cards.first().scrollIntoViewIfNeeded();
    if (!mobile) await cards.first().hover();
    await page.waitForTimeout(4000);
    beforeCardSwitch = await page.evaluate(() => window.__relightHistory.at(-1));
    beforeCardShot = path.join(output, `relight-motion-${webgl ? 'webgl' : 'webgpu'}${reduced ? '-reduced' : ''}${software ? '-software' : ''}${mobile ? '-mobile' : ''}-before.png`);
    await page.screenshot({ path: beforeCardShot });
    if (cardCount > 1) {
      if (mobile) await cards.nth(Math.min(2, cardCount - 1)).scrollIntoViewIfNeeded();
      else await cards.nth(Math.min(2, cardCount - 1)).hover();
      await page.waitForTimeout(60);
      duringCardSwitch = path.join(output, `relight-motion-${webgl ? 'webgl' : 'webgpu'}${reduced ? '-reduced' : ''}${software ? '-software' : ''}${mobile ? '-mobile' : ''}-handoff.png`);
      await page.screenshot({ path: duringCardSwitch });
      await page.waitForTimeout(740);
    }
  }
  const status = await page.evaluate(() => window.__relightHistory.at(-1));
  const shot = path.join(output, `relight-motion-${webgl ? 'webgl' : 'webgpu'}${reduced ? '-reduced' : ''}${software ? '-software' : ''}${mobile ? '-mobile' : ''}.png`);
  await page.screenshot({ path: shot });
  console.log(JSON.stringify({ beforeCardSwitch, status, cardCount, errors, beforeCardShot, duringCardSwitch, screenshot: shot }, null, 2));
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  if (cardCount < 2) throw new Error('Project cards did not load');
  if (status.maxMotionBlend > 0.41) {
    throw new Error(`Cached light image was replaced too quickly: ${status.maxMotionBlend} blend`);
  }
  if (!reduced && !mobile && status.maxAnimatedStep <= 0.031) {
    throw new Error(`Original light movement was capped: ${status.maxAnimatedStep} units`);
  }
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
