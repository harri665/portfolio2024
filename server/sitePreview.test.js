import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOgHandler } from './og.js';
import { createSitePreviews, sitePreviewTarget } from './sitePreview.js';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-preview-'));
  assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith('portfolio-preview-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    set(name, value) { return this.setHeader(name, value); },
    status(code) { this.statusCode = code; return this; },
    type(type) { return this.set('Content-Type', type === 'jpeg' ? 'image/jpeg' : type); },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
}

const request = (host = 'cs.harrison-martin.com', pathname = '/') => ({
  headers: { host }, query: { path: pathname }, originalUrl: pathname,
});

test('only the two exact domains and public page paths are screenshot targets', () => {
  for (const host of ['cs.harrison-martin.com', 'blog.harrison-martin.com']) {
    assert.equal(sitePreviewTarget(host, '/').url, `https://${host}/`);
    assert.equal(sitePreviewTarget(host.toUpperCase(), '/some-post/?site=art').pathname, '/some-post');
  }
  for (const host of ['harrison-martin.com', 'art.harrison-martin.com', 'artstation.harrison-martin.com', 'cs.example.com', 'cs.harrison-martin.com.evil.com', 'localhost']) {
    assert.equal(sitePreviewTarget(host, '/'), null);
  }
  for (const pathname of ['/admin', '/admin/secret', '/cs-admin', '/API', '/p/private', '/__og', '/robots.txt', '/..', '/%2e%2e', '//example.com', '/a%2Fb', '/bad%FF', 'https://example.com', '/?site=art/../admin']) {
    // query params get ignored on purpose
    if (pathname.startsWith('/?')) assert.equal(sitePreviewTarget('cs.harrison-martin.com', pathname).pathname, '/');
    else assert.equal(sitePreviewTarget('cs.harrison-martin.com', pathname), null, pathname);
  }
});

test('homepages and resolved pages advertise screenshots, preserving other hosts and missing posts', async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, 'post.md'), '---\ntitle: Test post\npublished: true\n---\nThe actual post.');
  const warmed = [];
  const handler = createOgHandler({
    blogPostsDir: dir, blogImagesDir: dir,
    listBlogPosts: () => [{ slug: 'post', title: 'Test post' }],
    listCsRepos: () => [], listArtProjects: () => [{ identifier: 'art', title: 'Art', image: 'https://example.com/art.jpg' }],
    getCsRepoFullName: (name) => `owner/${name}`,
    getCsRepo: async () => ({ name: 'project', description: 'Project description', topics: [] }),
    getCsReadme: async () => ({ title: 'Project title', media: { type: 'image', url: 'https://example.com/cover.jpg' } }),
    warmSitePreview: async (target) => { warmed.push(target.url); },
  });
  for (const [host, pathname] of [
    ['cs.harrison-martin.com', '/'], ['cs.harrison-martin.com', '/project'],
    ['blog.harrison-martin.com', '/'], ['blog.harrison-martin.com', '/post'],
  ]) {
    const res = response();
    await handler(request(host, pathname), res, pathname);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /property="og:image" content="https:\/\/(?:cs|blog)\.harrison-martin\.com\/api\/site-preview\.jpg\?path=/);
    assert.match(res.body, /property="og:image:width" content="1200"/);
    assert.match(res.body, /property="og:image:height" content="630"/);
    assert.match(res.body, /name="twitter:card" content="summary_large_image"/);
    assert.match(res.body, /name="twitter:image" content="https:\/\//);
    assert.match(res.body, /Screenshot of /);
  }
  assert.equal(warmed.length, 4);
  for (const host of ['harrison-martin.com', 'art.harrison-martin.com', 'artstation.harrison-martin.com', 'cs.example.com']) {
    const res = response();
    await handler(request(host), res, '/');
    assert.doesNotMatch(res.body, /site-preview\.jpg/);
    if (host.startsWith('art')) assert.match(res.body, /https:\/\/example.com\/art.jpg/);
    else assert.match(res.body, /\/logo.png/);
  }
  const missing = response();
  await handler(request('blog.harrison-martin.com', '/missing'), missing, '/missing');
  assert.equal(missing.statusCode, 404);
  assert.doesNotMatch(missing.body, /site-preview\.jpg/);
  assert.equal(warmed.length, 4);
});

test('image requests share a render and cache survives a new service instance', async (t) => {
  const cacheDir = await tempDir(t);
  let renders = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const options = { cacheDir, isPublicPage: async () => true, render: async () => { renders++; await waiting; return Buffer.from('jpeg'); } };
  const service = createSitePreviews(options);
  const first = response();
  const second = response();
  const jobs = [service.handler(request(), first), service.handler(request(), second)];
  await new Promise((resolve) => setTimeout(resolve, 30));
  release();
  await Promise.all(jobs);
  assert.equal(renders, 1);
  assert.equal(first.headers['content-type'], 'image/jpeg');
  assert.equal(first.body.toString(), 'jpeg');
  assert.equal(second.body.toString(), 'jpeg');
  const restored = createSitePreviews(options);
  const third = response();
  await restored.handler(request(), third);
  assert.equal(renders, 1);
  assert.equal(third.body.toString(), 'jpeg');
});

test('expired images remain available during refresh and a failed refresh keeps the last capture', async (t) => {
  const cacheDir = await tempDir(t);
  const target = sitePreviewTarget('cs.harrison-martin.com');
  await createSitePreviews({ cacheDir, isPublicPage: async () => true, render: async () => Buffer.from('old image') }).warm(target);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const service = createSitePreviews({ cacheDir, isPublicPage: async () => true, ttlMs: -1, render: async () => { await waiting; return Buffer.from('new image'); } });
  const stale = response();
  await service.handler(request(), stale);
  assert.equal(stale.body.toString(), 'old image');
  release();
  await service.warm(target);
  const fresh = response();
  await createSitePreviews({ cacheDir, isPublicPage: async () => true }).handler(request(), fresh);
  assert.equal(fresh.body.toString(), 'new image');
  const failing = createSitePreviews({ cacheDir, isPublicPage: async () => true, ttlMs: -1, render: async () => { throw new Error('Browser unavailable'); } });
  await assert.rejects(failing.warm(target), /Browser unavailable/);
  const preserved = response();
  await createSitePreviews({ cacheDir, isPublicPage: async () => true }).handler(request(), preserved);
  assert.equal(preserved.body.toString(), 'new image');
});

test('disallowed hosts, private or missing pages never start a browser', async (t) => {
  const cacheDir = await tempDir(t);
  let renders = 0;
  const service = createSitePreviews({ cacheDir, isPublicPage: async () => false, render: async () => { renders++; } });
  for (const req of [request('art.harrison-martin.com'), request('blog.harrison-martin.com', '/missing'), request('cs.harrison-martin.com', '/admin')]) {
    const res = response();
    await service.handler(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(renders, 0);
});

test('render and validation failures return retryable responses instead of caching broken images', async (t) => {
  const cacheDir = await tempDir(t);
  for (const failure of ['render', 'validation']) {
    const service = createSitePreviews({
      cacheDir,
      isPublicPage: async () => { if (failure === 'validation') throw new Error('Lookup unavailable'); return true; },
      render: async () => { throw new Error('Browser unavailable'); },
    });
    const res = response();
    await service.handler(request(), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['retry-after'], '30');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(await fs.readdir(cacheDir), []);
});
