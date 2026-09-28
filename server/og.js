// og/twitter tags for crawlers that don't run JS (discord, slack, imessage...)

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { prettyRepoName } from './repoMeta.js';

// broad on purpose, no real browser UA has any of these words
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

function stripMarkdown(markdown) {
  return collapse(
    String(markdown ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^>\s?\[![^\]]*\][^\n]*/gm, ' ') // callout headers
      .replace(/!\[\[[^\]]*\]\]/g, ' ') // wiki images
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // markdown images
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // wiki link with label
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
  return siteOrigin(req.headers['x-forwarded-host'] || req.headers.host);
}

// TLS ends upstream so nginx forwards X-Forwarded-Proto: http. trusting it gave http:// canonicals
// and sitemap urls, which google counts as different pages. site is https only anyway
export function siteOrigin(hostHeader) {
  const host = hostHeader || 'harrison-martin.com';
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)|\.localhost(:|$)/i.test(host);

  return `${isLocal ? 'http' : 'https'}://${host}`;
}

function upgradeArtStationImage(url) {
  if (!/^https?:\/\/cdn[a-z]?\.artstation\.com\//i.test(url || '')) return url;
  return url.replace(
    /\/(?:small|medium|thumb|micro_square|smaller_square|small_square)\//,
    '/large/'
  );
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
    links = [],
    jsonLd = null,
  } = meta;

  const tagLine = tags.length ? `<p class="tags">${escapeHtml(tags.join(' · '))}</p>` : '';

  // every page has to be reachable by links from the bare domain or google can't find the posts
  const linkList = links.length
    ? `<nav><ul>
${links
  .map(
    (l) =>
      `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.title)}</a>${
        l.description ? ` — ${escapeHtml(truncate(l.description, 160))}` : ''
      }</li>`
  )
  .join('\n')}
</ul></nav>`
    : '';

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
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />

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
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<article>
<h1>${escapeHtml(title)}</h1>
${tagLine}
<p>${escapeHtml(description)}</p>
${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt || title)}" />` : ''}
${bodyText ? `<p>${escapeHtml(bodyText)}</p>` : ''}
${linkList}
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
</article>
</body>
</html>`;
}

function blogImageUrl({ file, origin, blogImagesDir }) {
  const name = String(file).trim();
  // missing file would unfurl as a broken image
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

async function resolveCsProject({ repoName, getCsRepoFullName, getCsRepo, getCsReadme }) {
  const fullName = getCsRepoFullName(repoName);
  if (!fullName) return null;

  const [repo, readme] = await Promise.all([
    getCsRepo(fullName).catch(() => null),
    getCsReadme ? getCsReadme(fullName).catch(() => null) : null,
  ]);

  if (!repo?.name) return null;

  return {
    title: readme?.title || prettyRepoName(repo.name),
    description:
      truncate(repo.description) ||
      (repo.language ? `${repo.language} project by Harrison Martin.` : SITES.cs.description),
    // cards can't play video, fall back to github's own card
    image:
      readme?.media?.type === 'image'
        ? readme.media.url
        : `https://opengraph.githubassets.com/1/${fullName}`,
    type: 'article',
    tags: Array.isArray(repo?.topics) ? repo.topics.slice(0, 8) : [],
  };
}

async function resolveHome({ mode, origin, deps }) {
  if (mode === 'blog') {
    const posts = (await deps.listBlogPosts?.()) || [];
    const cover = posts.find((p) => p.cover)?.cover;

    return {
      image: cover ? blogImageUrl({ file: cover, origin, blogImagesDir: deps.blogImagesDir }) : null,
      links: posts.map((post) => ({
        url: `${origin}/${encodeURIComponent(post.slug)}`,
        title: post.title,
        description: post.description,
        date: post.date,
      })),
    };
  }

  if (mode === 'art') {
    const projects = (await deps.listArtProjects?.()) || [];

    return {
      image: upgradeArtStationImage(projects[0]?.image) || null,
      links: projects.map((project) => ({
        url: `${origin}/${encodeURIComponent(project.identifier)}`,
        title: project.title,
        description: project.description,
      })),
    };
  }

  if (mode === 'cs') {
    const repos = (await deps.listCsRepos?.()) || [];

    return {
      image: null,
      links: repos.map((repo) => ({
        url: `${origin}/${encodeURIComponent(repo.name)}`,
        title: repo.name,
        description: repo.description,
      })),
    };
  }

  return {
    image: null,
    links: ['cs', 'art', 'blog'].map((sub) => ({
      url: `https://${sub}.harrison-martin.com/`,
      title: SITES[sub].title,
      description: SITES[sub].description,
    })),
  };
}

const AUTHOR = { '@type': 'Person', name: 'Harrison Martin', url: 'https://harrison-martin.com' };

function buildJsonLd({ mode, url, title, description, image, resolved, isHome, links }) {
  if (isHome) {
    const collection = {
      '@context': 'https://schema.org',
      '@type': mode === 'blog' ? 'Blog' : 'CollectionPage',
      name: title,
      description,
      url,
      author: AUTHOR,
      ...(image ? { image } : {}),
    };

    if (links.length) {
      collection.hasPart = links.slice(0, 50).map((link) => ({
        '@type': mode === 'blog' ? 'BlogPosting' : 'CreativeWork',
        headline: link.title,
        url: link.url,
        ...(link.description ? { description: truncate(link.description, 160) } : {}),
        ...(link.date ? { datePublished: link.date } : {}),
      }));
    }

    return collection;
  }

  if (!resolved) return null;

  const TYPES = { blog: 'BlogPosting', art: 'VisualArtwork', cs: 'SoftwareSourceCode' };

  return {
    '@context': 'https://schema.org',
    '@type': TYPES[mode] || 'CreativeWork',
    headline: title,
    name: title,
    description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: AUTHOR,
    ...(image ? { image } : {}),
    ...(resolved.publishedTime ? { datePublished: resolved.publishedTime } : {}),
    ...(resolved.tags?.length ? { keywords: resolved.tags.join(', ') } : {}),
  };
}

const RESERVED_PATHS = new Set([
  'contact',
  'colophon',
  'admin',
  'cs-admin',
  'art-admin',
  'blog-admin',
  'pages-admin',
  'comments-admin',
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
 *   getCsReadme      — async ("owner/repo") => { title, media } from its README
 *   getCsRepoFullName— (repoName) => "owner/repo"
 *   listBlogPosts    — async () => [{ slug, title, description, cover, date }]
 *   listArtProjects  — async () => [{ identifier, title, description, image }]
 *   listCsRepos      — async () => [{ name, description }]
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
    const isHome = segments.length === 0;

    let home = { image: null, links: [] };
    if (isHome) {
      try {
        home = (await withTimeout(resolveHome({ mode, origin, deps }), RESOLVE_TIMEOUT_MS)) || home;
      } catch (err) {
        console.error('[og] Failed to build index for', mode, err?.message || err);
      }
    }

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
              getCsReadme: deps.getCsReadme,
              getCsRepoFullName: deps.getCsRepoFullName,
            }),
            RESOLVE_TIMEOUT_MS
          );
        }
      } catch (err) {
        console.error('[og] Failed to resolve preview for', pathname, err?.message || err);
      }
    }

    const realImage = resolved?.image || home.image || null;
    const image = realImage || `${origin}/logo.png`;
    const url = `${origin}${pathname}`;
    const title = resolved?.title || site.title;
    const description = resolved?.description || site.description;

    const html = renderOgHtml({
      title,
      description,
      image,
      imageAlt: resolved?.title || site.name,
      url,
      siteName: site.name,
      type: resolved?.type || 'website',
      // square logo looks better in the small card
      card: realImage ? 'summary_large_image' : 'summary',
      publishedTime: resolved?.publishedTime,
      tags: resolved?.tags || [],
      bodyText: resolved?.bodyText || '',
      links: home.links,
      jsonLd: buildJsonLd({
        mode,
        url,
        title,
        description,
        image,
        resolved,
        isHome,
        links: home.links,
      }),
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');

    // unknown blog slug is a real 404. art/cs lookups can fail on rate limits or scrape
    // timeouts though, so those stay 200 instead of risking deindexing a real page
    if (mode === 'blog' && slug && !RESERVED_PATHS.has(slug) && !resolved) {
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(404).send(html);
    }

    res.setHeader('X-Robots-Tag', 'all');
    res.send(html);
  };
}
