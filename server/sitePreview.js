import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';

export const PREVIEW_SIZE = { width: 1200, height: 630 };
const HOSTS = new Map([
  ['cs.harrison-martin.com', 'cs'],
  ['blog.harrison-martin.com', 'blog'],
]);
const RESERVED = /^(?:api|p|admin|.*-admin|contact|colophon|glass|3d-mockup|__og|robots\.txt|sitemap\.xml)$/i;
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_FILES = 128;

// paths only, never urls from the caller, query overrides or admin routes
export function sitePreviewTarget(host, requestedPath = '/') {
  const hostname = String(host || '').toLowerCase().split(':')[0];
  const mode = HOSTS.get(hostname);
  if (!mode || typeof requestedPath !== 'string') return null;
  let pathname;
  try {
    pathname = decodeURIComponent(requestedPath.split(/[?#]/)[0]).replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
  if (pathname !== '/') {
    if (!/^\/[a-zA-Z0-9_.-]{1,160}$/.test(pathname)) return null;
    const slug = pathname.slice(1);
    if (slug === '.' || slug === '..' || RESERVED.test(slug)) return null;
  }
  return { hostname, mode, pathname, url: `https://${hostname}${pathname}` };
}

export function sitePreviewImageUrl(target) {
  return `https://${target.hostname}/api/site-preview.jpg?path=${encodeURIComponent(target.pathname)}`;
}

// renders through nginx on the docker network so it doesn't depend on the CDN
export async function renderSitePreview(target, { renderOrigin, launch = (options) => puppeteer.launch(options) } = {}) {
  const url = renderOrigin ? new URL(target.pathname, renderOrigin) : new URL(target.url);
  if (renderOrigin) url.searchParams.set('site', target.mode);
  const browser = await launch({
    headless: true,
    timeout: 10000,
    protocolTimeout: 20000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const deadline = setTimeout(() => { void browser.close().catch(() => {}); }, 20000);
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...PREVIEW_SIZE, deviceScaleFactor: 1 });
    // "HeadlessChrome" trips crawler rules upstream
    await page.setUserAgent((await browser.userAgent()).replace(/HeadlessChrome/g, 'Chrome'));
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/^\/api\/load(?:\/|$)/.test(pathname)) {
        // don't log a visit or send reports from a preview render
        void request.respond({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => {});
      } else if (/\/api\/site-preview\.jpg$/.test(pathname)) {
        void request.abort().catch(() => {});
      } else {
        void request.continue().catch(() => {});
      }
    });
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
    if (!response?.ok()) throw new Error(`Preview page returned ${response?.status()}`);
    // wait for real content, don't cache spinners or error states
    await page.waitForSelector('[data-preview-ready]', { timeout: 8000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 3000 }).catch(() => {});
    await page.evaluate(async () => {
      for (const video of document.querySelectorAll('video')) video.pause();
      const visibleImages = [...document.images].filter((img) => {
        const rect = img.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0 && !img.complete;
      });
      await Promise.race([
        Promise.all([document.fonts.ready, ...visibleImages.map((img) => img.decode().catch(() => {}))]),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    });
    return Buffer.from(await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false }));
  } finally {
    clearTimeout(deadline);
    await browser.close().catch(() => {});
  }
}

export function createSitePreviews({ cacheDir, isPublicPage, render = renderSitePreview, now = Date.now, ttlMs = TTL_MS }) {
  const pending = new Map();
  let queue = Promise.resolve();
  const filename = (target) => path.join(cacheDir, `${createHash('sha256').update(target.url).digest('hex')}.jpg`);

  async function cached(target) {
    try {
      const file = filename(target);
      const [stat, image] = await Promise.all([fs.stat(file), fs.readFile(file)]);
      return { image, fresh: now() - stat.mtimeMs < ttlMs };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }
  }

  async function prune() {
    const files = (await fs.readdir(cacheDir)).filter((file) => /^[a-f0-9]{64}\.jpg$/.test(file));
    if (files.length <= MAX_FILES) return;
    const entries = await Promise.all(files.map(async (file) => {
      const location = path.join(cacheDir, file);
      return { location, modified: (await fs.stat(location)).mtimeMs };
    }));
    entries.sort((a, b) => b.modified - a.modified);
    await Promise.all(entries.slice(MAX_FILES).map(({ location }) => fs.unlink(location)));
  }

  function refresh(target) {
    if (pending.has(target.url)) return pending.get(target.url);
    // one chromium at a time
    if (pending.size >= 4) return Promise.reject(new Error('Preview queue is full'));
    const job = queue.then(async () => {
      const image = await render(target);
      await fs.mkdir(cacheDir, { recursive: true });
      const file = filename(target);
      await fs.writeFile(`${file}.tmp`, image);
      await fs.rename(`${file}.tmp`, file);
      await prune();
      return image;
    }).finally(() => pending.delete(target.url));
    pending.set(target.url, job);
    queue = job.catch(() => {});
    return job;
  }

  async function warm(target) {
    if (target && !(await cached(target))?.fresh) await refresh(target);
  }

  async function handler(req, res) {
    const target = sitePreviewTarget(req.headers['x-forwarded-host'] || req.headers.host, req.query.path ?? '/');
    if (!target) {
      return res.status(404).set('Cache-Control', 'no-store').end();
    }
    try {
      if (!(await isPublicPage(target))) {
        return res.status(404).set('Cache-Control', 'no-store').end();
      }
      const stored = await cached(target);
      let image = stored?.image;
      if (stored && !stored.fresh) {
        void refresh(target).catch((error) => console.error('[preview]', error.message));
      } else if (!stored) {
        let timer;
        try {
          image = await Promise.race([
            refresh(target),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Preview timed out')), 25000); }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('jpeg').send(image);
    } catch (error) {
      console.error('[preview]', error.message);
      res.status(503).set('Cache-Control', 'no-store').set('Retry-After', '30').end();
    }
  }

  return { warm, handler };
}
