// captures the poster stills for the home pages into client/public/posters.
// rerun whenever a scene changes
//
//   node posters.mjs                  every poster, from the dev server
//   node posters.mjs --sites cs       one site's
//   node posters.mjs --port 4173      from another server
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';

import { launchArgs } from './lib/profiles.mjs';
import { blockVisitLogging, origins } from './lib/sites.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/public/posters');

const POSTERS = { root: 'hub', cs: 'cs', art: 'art' };

const SHAPES = {
  wide: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  tall: { ...devices['Pixel 7'], deviceScaleFactor: 2 },
};

const QUALITY = 0.8;

const { values: args } = parseArgs({
  options: {
    sites: { type: 'string', default: Object.keys(POSTERS).join(',') },
    port: { type: 'string', default: '3000' },
  },
});

function prepare(still) {
  window.__sceneStill = still;
  const MARKERS = ['data-liquid-glass', 'data-liquid-glass-text', 'data-glass-image'];
  const strip = (root) => {
    MARKERS.forEach((name) => {
      if (root.hasAttribute?.(name)) root.removeAttribute(name);
      root.querySelectorAll?.(`[${name}]`).forEach((el) => el.removeAttribute(name));
    });
  };
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach(strip));
  }).observe(document, { childList: true, subtree: true });
}

const ONLY_CANVAS = `
  html, body { background: rgb(var(--bg)) !important; }
  body * { visibility: hidden !important; transition: none !important; animation: none !important; }
  body canvas { visibility: visible !important; }
  [data-backdrop-layer] { opacity: 1 !important; }
`;

async function capture(browser, site, shape) {
  const context = await browser.newContext(SHAPES[shape]);
  await blockVisitLogging(context);
  await context.addInitScript(prepare, site !== 'cs');
  const page = await context.newPage();
  try {
    await page.goto(`${origins('local', args.port)[site]}/`, { waitUntil: 'load' });
    await page.addStyleTag({ content: ONLY_CANVAS });
    await page.keyboard.press('Shift');
    await page.waitForSelector('[data-backdrop-layer] canvas', { state: 'attached', timeout: 30000 });
    if (site === 'cs') {
      await page.waitForFunction(
        () => /relights the Cornell box live/.test(document.getElementById('relight-status')?.textContent || ''),
        null,
        { timeout: 60000 }
      );
      await page.waitForTimeout(5000);
    } else {
      await page.waitForTimeout(2500);
    }
    const clip = await page.evaluate(() => ({
      x: 0,
      y: 0,
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    }));
    const png = await page.screenshot({ type: 'png', clip });
    return await toWebp(page, png);
  } finally {
    await context.close();
  }
}

async function toWebp(page, png) {
  const base64 = await page.evaluate(
    async ({ data, quality }) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
      const bytes = new Uint8Array(await webp.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
    { data: png.toString('base64'), quality: QUALITY }
  );
  return Buffer.from(base64, 'base64');
}

const flags = launchArgs({});
// headed so webgl runs on the real gpu
const browser = await chromium
  .launch({ channel: 'chrome', headless: false, args: flags })
  .catch(() => chromium.launch({ headless: false, args: flags }));

fs.mkdirSync(OUT, { recursive: true });
try {
  for (const site of args.sites.split(',').filter((s) => POSTERS[s])) {
    for (const shape of Object.keys(SHAPES)) {
      const file = path.join(OUT, `${POSTERS[site]}-${shape}.webp`);
      fs.writeFileSync(file, await capture(browser, site, shape));
      console.log(`${path.relative(process.cwd(), file)}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
    }
  }
} finally {
  await browser.close();
}
