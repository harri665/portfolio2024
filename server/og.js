// ─── LINK PREVIEWS (Open Graph / Twitter cards) ──────────────────────────────
// The site is a client-rendered React app, so crawlers that don't run JS
// (Discord, Slack, iMessage, Twitter, …) only ever saw the static index.html
// title. This module renders a small HTML document with real per-page meta
// tags and is served to those crawlers instead.

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// Matches link-unfurling bots and search crawlers. Deliberately broad — a real
// browser UA contains none of these words.
const CRAWLER_UA =
  /(bot|crawler|spider|scraper|preview|embedly|iframely|facebookexternalhit|slack|discord|telegram|whatsapp|skype|mastodon|bluesky|quora|vkshare|flipboard|nuzzel|w3c_validator|curl|wget|python-requests|go-http-client)/i;

export function isCrawler(userAgent) {
  return CRAWLER_UA.test(String(userAgent || ''));
}

const ACCENT = '#e07b39';

const SITES = {
  root: {
    name: 'Harrison Martin',
    title: 'Harrison Martin',
    description:
      'Portfolio of Harrison Martin — computer science projects, 3D art, and writing.',
  },
  cs: {
    name: 'Harrison Martin · CS',
    title: 'Harrison Martin — Computer Science',
    description:
      'Software, graphics, and simulation projects by Harrison Martin.',
  },
  art: {
    name: 'Harrison Martin · Art',
    title: 'Harrison Martin — 3D Art',
    description:
      '3D art, animation, and simulation work by Harrison Martin.',
  },
  blog: {
    name: 'Harrison Martin · Blog',
    title: 'Harrison Martin — Blog',
    description:
      'Writing on graphics, simulation, and software by Harrison Martin.',
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collapse(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max = 240) {
  const clean = collapse(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function stripHtmlTags(html) {
  return collapse(
    String(html ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

// Turns markdown into something readable in a preview snippet.
function stripMarkdown(markdown) {
  return collapse(
    String(markdown ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^>\s?\[![^\]]*\][^\n]*/gm, ' ') // callout headers
      .replace(/!\[\[[^\]]*\]\]/g, ' ') // wiki images
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // markdown images
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // wiki link w/ label
      .replace(/\[\[([^\]]+)\]\]/g, '$1') // wiki link
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
      .replace(/^#{1,6}\s+/gm, ' ')
      .replace(/^\s{0,3}[-*+]\s+/gm, ' ')
      .replace(/^\s*>\s?/gm, ' ')
      .replace(/[*_`~]/g, '')
      .replace(/^\s*\|.*\|\s*$/gm, ' ') // tables
      .replace(/^\s*-{3,}\s*$/gm, ' ')
  );
}

function originFor(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'harrison-martin.com';
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)|\.localhost(:|$)/i.test(host);
  // TLS may be terminated upstream, so trust the forwarded scheme and otherwise
  // assume https for anything that isn't a local dev host.
  const proto =
    (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (isLocal ? 'http' : 'https');

  return `${proto}://${host}`;
}

// ArtStation serves the same asset at several sizes; previews look better large.
function upgradeArtStationImage(url) {
  if (!/^https?:\/\/cdn[a-z]?\.artstation\.com\//i.test(url || '')) return url;
  return url.replace(/\/(?:small|medium)\//, '/large/');
}

function absoluteUrl(origin, url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function detectSiteMode(host) {
  const hostname = String(host || '').toLowerCase().split(':')[0];
  const sub = hostname.split('.')[0];

  if (sub === 'cs') return 'cs';
  if (sub === 'art' || sub === 'artstation') return 'art';
  if (sub === 'blog') return 'blog';
  return 'root';
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function renderOgHtml(meta) {
  const {
    title,
    description,
    image,
    imageAlt,
    url,
    siteName,
    type = 'website',
    card = 'summary_large_image',
    publishedTime,
    tags = [],
    bodyText = '',
  } = meta;

  const tagLine = tags.length ? `<p class="tags">${escapeHtml(tags.join(' · '))}</p>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="canonical" href="${escapeHtml(url)}" />
<meta name="description" content="${escapeHtml(description)}" />
<meta name="theme-color" content="${ACCENT}" />
<meta name="author" content="Harrison Martin" />

<meta property="og:type" content="${escapeHtml(type)}" />
<meta property="og:site_name" content="${escapeHtml(siteName)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(url)}" />
${image ? `<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:image:secure_url" content="${escapeHtml(image)}" />
<meta property="og:image:alt" content="${escapeHtml(imageAlt || title)}" />` : ''}
${publishedTime ? `<meta property="article:published_time" content="${escapeHtml(publishedTime)}" />
<meta property="article:author" content="Harrison Martin" />` : ''}
${tags.map((t) => `<meta property="article:tag" content="${escapeHtml(t)}" />`).join('\n')}

<meta name="twitter:card" content="${escapeHtml(card)}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ''}
</head>
<body>
<article>
<h1>${escapeHtml(title)}</h1>
${tagLine}
<p>${escapeHtml(description)}</p>
${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt || title)}" />` : ''}
${bodyText ? `<p>${escapeHtml(bodyText)}</p>` : ''}
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
</article>
</body>
</html>`;
}

// ─── per-site resolvers ──────────────────────────────────────────────────────

function blogImageUrl({ file, origin, blogImagesDir }) {
  const name = String(file).trim();
  // A missing file would unfurl as a broken image, so fall back to the site card.
  if (blogImagesDir && !fs.existsSync(path.join(blogImagesDir, name))) return null;
  return `${origin}/api/blog/images/${encodeURIComponent(name)}`;
}

function firstMarkdownImage({ content, origin, blogImagesDir }) {
  const wiki = content.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  if (wiki) {
    const url = blogImageUrl({ file: wiki[1], origin, blogImagesDir });
    if (url) return url;
  }

  const inline = content.match(/!\[[^\]]*\]\(([^)\s]+)/);
  if (inline) return absoluteUrl(origin, inline[1]);

  return null;
}

function resolveBlogPost({ slug, origin, blogPostsDir, blogImagesDir }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return null;

  const filePath = path.join(blogPostsDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const { data, content } = matter(fs.readFileSync(filePath, 'utf-8'));
  if (data.published === false) return null;

  const image =
    (data.cover && blogImageUrl({ file: data.cover, origin, blogImagesDir })) ||
    firstMarkdownImage({ content, origin, blogImagesDir });

  return {
    title: data.title || slug,
    description: truncate(data.description || stripMarkdown(content)) || SITES.blog.description,
    image,
    type: 'article',
    publishedTime: data.date || null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    bodyText: stripMarkdown(content).slice(0, 4000),
  };
}

async function resolveArtProject({ identifier, origin, getArtProject }) {
  const project = await getArtProject(identifier);
  if (!project) return null;

  const cover =
    project.cover_url ||
    project.assets?.find((a) => a.asset_type === 'cover' && a.image_url)?.image_url ||
    project.assets?.find((a) => a.image_url)?.image_url ||
    null;

  const description =
    truncate(stripHtmlTags(project.description_html || project.description)) ||
    (project.tags?.length ? project.tags.join(' · ') : '') ||
    SITES.art.description;

  return {
    title: project.title || identifier,
    description,
    image: upgradeArtStationImage(absoluteUrl(origin, cover)),
    type: 'article',
    publishedTime: project.created_at || null,
    tags: Array.isArray(project.tags) ? project.tags.slice(0, 8) : [],
  };
}

async function resolveCsProject({ repoName, getCsRepoFullName, getCsRepo }) {
  const fullName = getCsRepoFullName(repoName);
  if (!fullName) return null;

  let repo = null;
  try {
    repo = await getCsRepo(fullName);
  } catch {
    repo = null;
  }

  // Unknown repo — let the caller fall back to the generic site card rather
  // than advertising a page that doesn't exist.
  if (!repo?.name) return null;

  return {
    title: repo.name,
    description:
      truncate(repo.description) ||
      (repo.language ? `${repo.language} project by Harrison Martin.` : SITES.cs.description),
    // GitHub renders a card with the repo name, description, and owner avatar.
    image: `https://opengraph.githubassets.com/1/${fullName}`,
    type: 'article',
    tags: Array.isArray(repo?.topics) ? repo.topics.slice(0, 8) : [],
  };
}

// ─── middleware ──────────────────────────────────────────────────────────────

const RESERVED_PATHS = new Set([
  'contact',
  'admin',
  'cs-admin',
  'art-admin',
  'blog-admin',
  'pages-admin',
  '3d-mockup',
]);

const RESOLVE_TIMEOUT_MS = 6000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Builds the Express handler that renders preview HTML.
 *
 * deps:
 *   blogPostsDir     — directory holding the blog markdown files
 *   blogImagesDir    — directory holding the blog images
 *   getArtProject    — async (identifier) => ArtStation project JSON | null
 *   getCsRepo        — async ("owner/repo") => GitHub repo JSON | null
 *   getCsRepoFullName— (repoName) => "owner/repo"
 */
export function createOgHandler(deps) {
  return async function ogHandler(req, res, requestedPath) {
    const origin = originFor(req);
    const rawPath = requestedPath || req.originalUrl || '/';
    const pathname = decodeURIComponent(rawPath.split('?')[0]) || '/';
    const mode = detectSiteMode(req.headers['x-forwarded-host'] || req.headers.host);
    const site = SITES[mode] || SITES.root;

    const segments = pathname.split('/').filter(Boolean);
    const slug = segments.length === 1 ? segments[0] : null;

    let resolved = null;
    if (slug && !RESERVED_PATHS.has(slug)) {
      try {
        if (mode === 'blog') {
          resolved = resolveBlogPost({
            slug,
            origin,
            blogPostsDir: deps.blogPostsDir,
            blogImagesDir: deps.blogImagesDir,
          });
        } else if (mode === 'art') {
          resolved = await withTimeout(
            resolveArtProject({ identifier: slug, origin, getArtProject: deps.getArtProject }),
            RESOLVE_TIMEOUT_MS
          );
        } else if (mode === 'cs') {
          resolved = await withTimeout(
            resolveCsProject({
              repoName: slug,
              getCsRepo: deps.getCsRepo,
              getCsRepoFullName: deps.getCsRepoFullName,
            }),
            RESOLVE_TIMEOUT_MS
          );
        }
      } catch (err) {
        console.error('[og] Failed to resolve preview for', pathname, err?.message || err);
      }
    }

    const fallbackImage = `${origin}/logo.png`;
    const image = resolved?.image || fallbackImage;

    const html = renderOgHtml({
      title: resolved?.title || site.title,
      description: resolved?.description || site.description,
      image,
      imageAlt: resolved?.title || site.name,
      url: `${origin}${pathname}`,
      siteName: site.name,
      type: resolved?.type || 'website',
      // A square logo looks better in the small card; real covers get the big one.
      card: resolved?.image ? 'summary_large_image' : 'summary',
      publishedTime: resolved?.publishedTime,
      tags: resolved?.tags || [],
      bodyText: resolved?.bodyText || '',
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Robots-Tag', 'all');
    res.send(html);
  };
}
