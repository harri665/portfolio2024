// chrome resolves *.localhost to this machine, so locally each site gets its own origin
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

export const SITES = ['root', 'cs', 'art', 'blog'];

const FIXED_PAGES = ['/', '/contact', '/colophon'];

const SKIP = /^\/(admin|api|p)(\/|$)|^\/(cs|art|blog|pages|comments)-admin|\.[a-z0-9]+$/i;

export function origins(target, port) {
  if (target === 'prod') {
    return {
      root: 'https://harrison-martin.com',
      cs: 'https://cs.harrison-martin.com',
      art: 'https://art.harrison-martin.com',
      blog: 'https://blog.harrison-martin.com',
    };
  }
  const host = (site) => (site === 'root' ? 'localhost' : `${site}.localhost`);
  return Object.fromEntries(SITES.map((site) => [site, `http://${host(site)}:${port}`]));
}

export async function discoverPages(browser, origin, { timeout }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await blockVisitLogging(context);
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/`, { waitUntil: 'load', timeout });
    await waitForQuiet(page, { timeout });
    const hrefs = await page.$$eval('a[href]', (links) => links.map((a) => a.href));
    const found = new Set(FIXED_PAGES);
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin === origin && !SKIP.test(url.pathname)) {
        found.add(decodeURI(url.pathname).replace(/\/+$/, '') || '/');
      }
    }
    return [...found].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
  } finally {
    await context.close();
  }
}

// don't write test visits to loadLogs.json or look up their IP
export async function blockVisitLogging(context) {
  await context.route(/\/api\/load(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
}

export async function waitForQuiet(page, { quiet = 500, timeout = 15000 } = {}) {
  let inflight = 0;
  let last = Date.now();
  const start = () => { inflight += 1; };
  const end = () => { inflight = Math.max(0, inflight - 1); last = Date.now(); };
  page.on('request', start);
  page.on('requestfinished', end);
  page.on('requestfailed', end);
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      await page.waitForTimeout(100);
      if (inflight === 0 && Date.now() - last >= quiet) {
        return;
      }
    }
  } finally {
    page.off('request', start);
    page.off('requestfinished', end);
    page.off('requestfailed', end);
  }
}

// like nginx in prod. express has to already be running for /api and /p
export function serveBuild({ buildDir, port, apiPort }) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.bin': 'application/octet-stream',
    '.mp4': 'video/mp4', '.txt': 'text/plain', '.map': 'application/json',
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (/^\/(api|p)(\/|$)/.test(url.pathname)) {
      const upstream = http.request(
        { host: 'localhost', port: apiPort, path: req.url, method: req.method, headers: req.headers },
        (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); }
      );
      upstream.on('error', () => { res.writeHead(502); res.end('API server not running'); });
      req.pipe(upstream);
      return;
    }
    let file = path.join(buildDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(buildDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(buildDir, 'index.html');
    }
    const type = types[path.extname(file)] || 'application/octet-stream';
    const gzip = /gzip/.test(req.headers['accept-encoding'] || '') &&
      (/^(text|application\/json)/.test(type) || url.pathname.startsWith('/relight/'));
    res.writeHead(200, { 'Content-Type': type, ...(gzip && { 'Content-Encoding': 'gzip' }) });
    const body = fs.createReadStream(file);
    (gzip ? body.pipe(zlib.createGzip({ level: 6 })) : body).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

export function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}
