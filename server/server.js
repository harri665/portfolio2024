import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import useragent from 'express-useragent';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
import multer from 'multer';
// --- NEW IMPORTS ---
import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config'; // Loads .env file contents into process.env

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3005;

// --- DISCORD BOT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages
  ]
});

// Log in the bot using the token from your .env file
try {
  if(!process.env.DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN is not defined in the environment variables.');
  } else {
    client.login(process.env.DISCORD_BOT_TOKEN);
    client.once('ready', () => {
      console.log(`✅ Logged in to Discord as ${client.user.tag}!`);
    });
  }
} catch (error) {
  console.error('Failed to log in to Discord:', error);
}


// --- END DISCORD BOT SETUP ---


app.use(cors());
app.use(express.json());
app.use(useragent.express()); // Enable express-useragent

// Persistent data directory — mounted as a Docker volume so it survives container rebuilds
const DATA_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Helper to ensure a cache file exists (create it if it doesn't)
function ensureCacheFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
}

// Cache file paths
const videoLinkCacheFile = path.join(DATA_DIR, 'videoLinkCache.json');
const userProjectsCacheFile = path.join(DATA_DIR, 'userProjectsCache.json');
const projectDetailsCacheFile = path.join(DATA_DIR, 'projectDetailsCache.json');
const githubRepoCacheFile = path.join(DATA_DIR, 'githubRepoCache.json');

// Ensure all cache files exist before loading
ensureCacheFileExists(videoLinkCacheFile);
ensureCacheFileExists(userProjectsCacheFile);
ensureCacheFileExists(projectDetailsCacheFile);
ensureCacheFileExists(githubRepoCacheFile);

// Load the caches
let videoLinkCache = loadCacheFromFile(videoLinkCacheFile);
let userProjectsCache = loadCacheFromFile(userProjectsCacheFile);
let projectDetailsCache = loadCacheFromFile(projectDetailsCacheFile);
let githubRepoCache = loadCacheFromFile(githubRepoCacheFile);

function loadCacheFromFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      console.error(`Error loading cache from file ${filePath}:`, error);
    }
  }
  return {};
}

function saveCacheToFile(filePath, cache) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error(`Error saving cache to file ${filePath}:`, error);
  }
}

const GITHUB_CACHE_TTL_MS = Number(process.env.GITHUB_CACHE_TTL_MS || 30 * 60 * 1000);

function ensureGitHubRepoCacheShape() {
  if (!githubRepoCache || typeof githubRepoCache !== 'object' || Array.isArray(githubRepoCache)) {
    githubRepoCache = {};
  }

  if (!githubRepoCache.repoLists || typeof githubRepoCache.repoLists !== 'object') {
    githubRepoCache.repoLists = {};
  }

  if (!githubRepoCache.repos || typeof githubRepoCache.repos !== 'object') {
    githubRepoCache.repos = {};
  }
}

ensureGitHubRepoCacheShape();

function saveGitHubRepoCache() {
  ensureGitHubRepoCacheShape();
  saveCacheToFile(githubRepoCacheFile, githubRepoCache);
}

function getGitHubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'harrison-martin-portfolio-server',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function isGitHubCacheEntryFresh(entry) {
  if (!entry || typeof entry !== 'object' || !entry.fetchedAt || !('data' in entry)) {
    return false;
  }

  const fetchedAtMs = new Date(entry.fetchedAt).getTime();
  if (!Number.isFinite(fetchedAtMs)) {
    return false;
  }

  return Date.now() - fetchedAtMs < GITHUB_CACHE_TTL_MS;
}

function getGitHubCacheEntry(cacheGroup, key) {
  ensureGitHubRepoCacheShape();
  return githubRepoCache[cacheGroup]?.[key];
}

function setGitHubCacheEntry(cacheGroup, key, data) {
  ensureGitHubRepoCacheShape();
  githubRepoCache[cacheGroup][key] = {
    fetchedAt: new Date().toISOString(),
    data,
  };
  saveGitHubRepoCache();
}

async function fetchGitHubRepoListFromApi({
  owner,
  perPage = 100,
  type = 'owner',
  sort = 'updated',
}) {
  const response = await axios.get(`https://api.github.com/users/${owner}/repos`, {
    params: {
      per_page: perPage,
      type,
      sort,
    },
    headers: getGitHubHeaders(),
  });

  return response.data;
}

async function fetchGitHubRepoFromApi(fullName) {
  const [owner, repo] = String(fullName).split('/');
  const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: getGitHubHeaders(),
  });

  return response.data;
}

async function getGitHubRepoList({
  owner,
  perPage = 100,
  type = 'owner',
  sort = 'updated',
  forceRefresh = false,
}) {
  const cacheKey = [owner, perPage, type, sort].join('|').toLowerCase();
  const cachedEntry = getGitHubCacheEntry('repoLists', cacheKey);

  if (!forceRefresh && isGitHubCacheEntryFresh(cachedEntry)) {
    console.log(`Returning cached GitHub repo list for ${owner}`);
    return cachedEntry.data;
  }

  const repos = await fetchGitHubRepoListFromApi({ owner, perPage, type, sort });
  setGitHubCacheEntry('repoLists', cacheKey, repos);

  return repos;
}

async function getGitHubRepoByFullName(fullName, { forceRefresh = false } = {}) {
  const normalizedFullName = String(fullName || '').trim();
  const cacheKey = normalizedFullName.toLowerCase();
  const cachedEntry = getGitHubCacheEntry('repos', cacheKey);

  if (!forceRefresh && isGitHubCacheEntryFresh(cachedEntry)) {
    console.log(`Returning cached GitHub repo for ${normalizedFullName}`);
    return cachedEntry.data;
  }

  const repo = await fetchGitHubRepoFromApi(normalizedFullName);
  setGitHubCacheEntry('repos', cacheKey, repo);

  return repo;
}

// Helper function to extract direct video link from embed URL
async function getDirectVideoLink(embedUrl) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    await page.goto(embedUrl, { waitUntil: 'networkidle2' });
    const videoUrl = await page.evaluate(() => {
      const videoElement = document.querySelector('video source');
      return videoElement ? videoElement.src : null;
    });
    return videoUrl || null;
  } catch (error) {
    console.error('Error extracting direct video link:', error);
    return null;
  } finally {
    await browser.close();
  }
}

// Fetch user projects by username
async function getUserProjectsWithPuppeteer(username) {
  if (userProjectsCache[username]) {
    console.log('Returning cached user projects for:', username);
    return userProjectsCache[username];
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    const artstationUrl = `https://www.artstation.com/users/${username}/projects.json`;
    await page.goto(artstationUrl, { waitUntil: 'networkidle2' });

    const html = await page.content();
    const $ = cheerio.load(html);
    const jsonText = $('pre').text();

    if (jsonText) {
      const data = JSON.parse(jsonText);
      userProjectsCache[username] = data;
      saveCacheToFile(userProjectsCacheFile, userProjectsCache);
      console.log('Successfully extracted and cached user projects:', data);
      return data;
    } else {
      console.error('No JSON found in the HTML');
      return null;
    }
  } catch (error) {
    console.error('Error fetching user projects:', error);
    return null;
  } finally {
    await browser.close();
  }
}

// Fetch project details by project ID
async function getProjectDetailsWithPuppeteer(projectId) {
  if (projectDetailsCache[projectId]) {
    console.log('Returning cached project details for:', projectId);
    return projectDetailsCache[projectId];
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  try {
    const artstationProjectUrl = `https://www.artstation.com/projects/${projectId}.json`;
    await page.goto(artstationProjectUrl, { waitUntil: 'networkidle2' });

    const html = await page.content();
    const $ = cheerio.load(html);
    const jsonText = $('pre').text();

    if (jsonText) {
      const data = JSON.parse(jsonText);

      // Replace embedded players with direct video links
      for (let asset of data.assets) {
        if (asset.has_embedded_player && asset.player_embedded) {
          const embedUrlMatch = asset.player_embedded.match(/src='(.*?)'/);
          if (embedUrlMatch && embedUrlMatch[1]) {
            const embedUrl = embedUrlMatch[1];
            // Check if we have already cached the direct link
            if (!videoLinkCache[embedUrl]) {
              console.log(`Fetching direct video link for embed URL: ${embedUrl}`);
              const directVideoUrl = await getDirectVideoLink(embedUrl);
              if (directVideoUrl) {
                videoLinkCache[embedUrl] = directVideoUrl;
                asset.player_embedded = directVideoUrl;
              }
            } else {
              asset.player_embedded = videoLinkCache[embedUrl];
            }
          }
        }
      }

      projectDetailsCache[projectId] = data;
      saveCacheToFile(projectDetailsCacheFile, projectDetailsCache);
      console.log('Successfully extracted and cached project details:', data);
      return data;
    } else {
      console.error('No JSON found in the HTML');
      return null;
    }
  } catch (error) {
    console.error('Error fetching project details:', error);
    return null;
  } finally {
    await browser.close();
  }
}

// Update caches every hour
function scheduleUserProjectsCacheUpdate() {
  // Update project details cache every hour
  setInterval(async () => {
    for (const projectId in projectDetailsCache) {
      console.log(`Updating cached project details for project ID: ${projectId}`);
      projectDetailsCache[projectId] = await getProjectDetailsWithPuppeteer(projectId);
    }
    saveCacheToFile(projectDetailsCacheFile, projectDetailsCache);
  }, 60 * 60 * 1000);

  // Update user projects cache every hour
  setInterval(async () => {
    for (const username in userProjectsCache) {
      console.log(`Updating cached projects for user: ${username}`);
      userProjectsCache[username] = await getUserProjectsWithPuppeteer(username);
    }
    saveCacheToFile(userProjectsCacheFile, userProjectsCache);
  }, 60 * 60 * 1000);
}

// -------------------------
// Health check endpoint
// -------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// -------------------------
// NEW DISCORD DM ENDPOINT
// -------------------------
app.post('/api/discord/dm', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing message in request body.' });
  }

  try {
    // Fetch the user by their ID
    const user = await client.users.fetch("336913971900710913");
    if (!user) {
      return res.status(404).json({ error: 'Discord user not found.' });
    }

    // Send the direct message
    await user.send(message);

    console.log(`Successfully sent DM to user `);
    res.status(200).json({ success: `Message sent to user.` });

  } catch (error) {
    console.error('Failed to send Discord DM:', error);
    // Provide more specific feedback if possible
    if (error.code === 10013) { // Unknown User
         return res.status(404).json({ error: 'Discord user not found.' });
    }
    if (error.code === 50007) { // Cannot send messages to this user
        return res.status(403).json({ error: 'Cannot send message to this user. They may have DMs disabled or the bot does not share a server with them.' });
    }
    res.status(500).json({ error: 'An internal error occurred while trying to send the message.' });
  }
});

// -------------------------
// /api/load Endpoint
// -------------------------
app.get('/api/load', async (req, res) => {
  try {
    // Get IP address (may be behind a proxy or load balancer)
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const { os, browser, platform, source } = req.useragent;
    const page = req.query.page || 'unknown';

    const locationResponse = await axios.get(`http://ip-api.com/json/${ip}`);
    const locationData = locationResponse.data;

    // Log to console
    console.log('--- /api/load called ---');
    console.log('IP Address:', ip);
    console.log('Device/OS:', os);
    console.log('Browser:', browser);
    console.log('Platform:', platform);
    console.log('Full User-Agent String:', source);
    console.log('Accessed page:', page);
    console.log('Location Data:', locationData);

    // Log JSON
    const logFilePath = path.join(DATA_DIR, 'loadLogs.json');
    if (!fs.existsSync(logFilePath)) {
      fs.writeFileSync(logFilePath, JSON.stringify([], null, 2));
    }

    const timeStamp = new Date().toISOString();

    const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf-8'));
    logs.push({
      timestamp: timeStamp,
      ip,
      device: os,
      browser,
      platform,
      userAgent: source,
      pageAccessed: page,
      location: locationData,
    });
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));

    // Response
    res.json({
      message: 'Load endpoint data logged successfully',
      ip,
      device: os,
      browser,
      page,
      location: locationData,
    });
  } catch (error) {
    console.error('Error in /api/load:', error);
    res.status(500).json({ error: 'Failed to process load request' });
  }
});

// -------------------------
// /api/logs Endpoint
// -------------------------
app.get('/api/logs', (req, res) => {
  try {
    const logFilePath = path.join(DATA_DIR, 'loadLogs.json');
    if (!fs.existsSync(logFilePath)) {
      return res.json([]);
    }
    const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf-8'));
    res.json(logs);
  } catch (error) {
    console.error('Error in /api/logs:', error);
    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
});

// -------------------------
// GitHub repository endpoints (cached)
// -------------------------
app.get('/api/github/repos', async (req, res) => {
  const owner = String(req.query.owner || '').trim();
  const perPage = Number(req.query.per_page || 100);
  const type = String(req.query.type || 'owner').trim();
  const sort = String(req.query.sort || 'updated').trim();
  const forceRefresh =
    req.query.refresh === '1' || String(req.query.refresh || '').toLowerCase() === 'true';

  if (!owner) {
    return res.status(400).json({ error: 'Missing required query param: owner' });
  }

  try {
    const repos = await getGitHubRepoList({
      owner,
      perPage: Number.isFinite(perPage) && perPage > 0 ? Math.min(perPage, 100) : 100,
      type,
      sort,
      forceRefresh,
    });

    res.json(repos);
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || `Failed to fetch GitHub repos for ${owner}`;

    console.error('Error in GitHub repos API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

app.get('/api/github/repo', async (req, res) => {
  const fullName = String(req.query.full_name || '').trim();
  const forceRefresh =
    req.query.refresh === '1' || String(req.query.refresh || '').toLowerCase() === 'true';

  if (!fullName) {
    return res.status(400).json({ error: 'Missing required query param: full_name' });
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
    return res.status(400).json({ error: 'full_name must be in \"owner/repo\" format' });
  }

  try {
    const repo = await getGitHubRepoByFullName(fullName, { forceRefresh });
    res.json(repo);
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || `Failed to fetch GitHub repo ${fullName}`;

    console.error('Error in GitHub repo API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

// -------------------------
// Existing ArtStation endpoints
// -------------------------
app.get('/api/artstation/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const projects = await getUserProjectsWithPuppeteer(username);
    if (projects) {
      res.json(projects);
    } else {
      res.status(404).json({ error: 'Projects not found' });
    }
  } catch (error) {
    console.error('Error in API route:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.get('/api/project/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const projectDetails = await getProjectDetailsWithPuppeteer(projectId);
    if (projectDetails) {
      res.json(projectDetails);
    } else {
      res.status(404).json({ error: 'Project details not found' });
    }
  } catch (error) {
    console.error('Error in project details API route:', error);
    res.status(500).json({ error: 'Failed to fetch project details' });
  }
});

app.get('/api/update-projects', async (req, res) => {
  try {
    for (const username in userProjectsCache) {
      console.log(`Updating cached projects for user: ${username}`);
      const userProjects = await getUserProjectsWithPuppeteer(username);
      userProjectsCache[username] = userProjects;

      if (userProjects && userProjects.data) {
        for (const project of userProjects.data) {
          const projectId = project.hash_id;
          console.log(`Updating cached project details for project ID: ${projectId}`);
          projectDetailsCache[projectId] = await getProjectDetailsWithPuppeteer(projectId);
        }
      }
    }
    saveCacheToFile(userProjectsCacheFile, userProjectsCache);
    saveCacheToFile(projectDetailsCacheFile, projectDetailsCache);
    res.status(200).json({ message: 'Projects and project details updated successfully' });
  } catch (error) {
    console.error('Error updating cached projects:', error);
    res.status(500).json({ error: 'Failed to update projects and project details' });
  }
});

app.get('/api/clear-cache', (req, res) => {
  try {
    videoLinkCache = {};
    userProjectsCache = {};
    projectDetailsCache = {};
    githubRepoCache = { repoLists: {}, repos: {} };
    blogPostsCache = null;

    saveCacheToFile(videoLinkCacheFile, videoLinkCache);
    saveCacheToFile(userProjectsCacheFile, userProjectsCache);
    saveCacheToFile(projectDetailsCacheFile, projectDetailsCache);
    saveGitHubRepoCache();

    res.status(200).json({ message: 'All caches cleared successfully' });
  } catch (error) {
    console.error('Error clearing caches:', error);
    res.status(500).json({ error: 'Failed to clear caches' });
  }
});

// ─── BLOG ────────────────────────────────────────────────────────────────────

const BLOG_POSTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blog', 'posts');
const BLOG_IMAGES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blog', 'images');

// Serve blog images as static files
app.use('/api/blog/images', express.static(BLOG_IMAGES_DIR));

let blogPostsCache = null;

function estimateReadingTime(content) {
  const words = content.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return `${minutes} min read`;
}

function loadBlogPosts() {
  if (!fs.existsSync(BLOG_POSTS_DIR)) return [];
  const files = fs.readdirSync(BLOG_POSTS_DIR).filter((f) => f.endsWith('.md'));
  return files
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(BLOG_POSTS_DIR, file), 'utf-8');
      const { data, content } = matter(raw);
      if (data.published === false) return null;
      return {
        slug,
        title: data.title || slug,
        date: data.date || null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        description: data.description || '',
        cover: data.cover || null,
        readingTime: estimateReadingTime(content),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

app.get('/api/blog/posts', (req, res) => {
  try {
    if (!blogPostsCache) blogPostsCache = loadBlogPosts();
    res.json(blogPostsCache);
  } catch (err) {
    console.error('Error loading blog posts:', err);
    res.status(500).json({ error: 'Failed to load blog posts' });
  }
});

app.get('/api/blog/posts/:slug', (req, res) => {
  const { slug } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }
  const filePath = path.join(BLOG_POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Post not found' });
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    if (data.published === false) return res.status(404).json({ error: 'Post not found' });
    res.json({
      meta: {
        slug,
        title: data.title || slug,
        date: data.date || null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        description: data.description || '',
        cover: data.cover || null,
        readingTime: estimateReadingTime(content),
      },
      content,
    });
  } catch (err) {
    console.error('Error loading blog post:', err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// Sitemap — helps Google discover blog posts
app.get('/sitemap.xml', (req, res) => {
  try {
    const posts = loadBlogPosts();
    const base = 'https://blog.harrison-martin.com';
    const urls = [
      `<url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
      ...posts.map((p) =>
        `<url><loc>${base}/posts/${encodeURIComponent(p.slug)}</loc>${p.date ? `<lastmod>${p.date}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.8</priority></url>`
      ),
    ].join('\n  ');
    res.setHeader('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls}\n</urlset>`);
  } catch (err) {
    res.status(500).send('Failed to generate sitemap');
  }
});

// ─── BLOG ADMIN ──────────────────────────────────────────────────────────────

const ADMIN_KEY = process.env.ADMIN_KEY || 'test';

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function loadBlogPostsAll() {
  if (!fs.existsSync(BLOG_POSTS_DIR)) return [];
  return fs.readdirSync(BLOG_POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(BLOG_POSTS_DIR, file), 'utf-8');
      const { data, content } = matter(raw);
      return {
        slug,
        title: data.title || slug,
        date: data.date || null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        description: data.description || '',
        cover: data.cover || null,
        published: data.published !== false,
        readingTime: estimateReadingTime(content),
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// Verify admin key
app.post('/api/admin/auth', (req, res) => {
  if (req.headers['x-admin-key'] === ADMIN_KEY) res.json({ ok: true });
  else res.status(401).json({ error: 'Invalid key' });
});

// List all posts including drafts
app.get('/api/admin/blog/posts', requireAdmin, (req, res) => {
  try {
    res.json(loadBlogPostsAll());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// Get single post including drafts
app.get('/api/admin/blog/posts/:slug', requireAdmin, (req, res) => {
  const { slug } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  const filePath = path.join(BLOG_POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Post not found' });
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    res.json({
      meta: {
        slug,
        title: data.title || slug,
        date: data.date || null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        description: data.description || '',
        cover: data.cover || null,
        published: data.published !== false,
      },
      content,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// Create new post
app.post('/api/admin/blog/posts', requireAdmin, (req, res) => {
  const { slug, title, date, tags, description, cover, published, content } = req.body;
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  const filePath = path.join(BLOG_POSTS_DIR, `${slug}.md`);
  if (fs.existsSync(filePath)) return res.status(409).json({ error: 'A post with that slug already exists' });
  try {
    if (!fs.existsSync(BLOG_POSTS_DIR)) fs.mkdirSync(BLOG_POSTS_DIR, { recursive: true });
    const raw = matter.stringify(content || '', {
      title: title || slug,
      date: date || new Date().toISOString().split('T')[0],
      tags: Array.isArray(tags) ? tags : [],
      description: description || '',
      ...(cover ? { cover } : {}),
      published: published !== false,
    });
    fs.writeFileSync(filePath, raw, 'utf-8');
    blogPostsCache = null;
    res.status(201).json({ slug });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Update existing post
app.put('/api/admin/blog/posts/:slug', requireAdmin, (req, res) => {
  const { slug } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  const filePath = path.join(BLOG_POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Post not found' });
  const { title, date, tags, description, cover, published, content } = req.body;
  try {
    const raw = matter.stringify(content || '', {
      title: title || slug,
      date: date || null,
      tags: Array.isArray(tags) ? tags : [],
      description: description || '',
      ...(cover ? { cover } : {}),
      published: published !== false,
    });
    fs.writeFileSync(filePath, raw, 'utf-8');
    blogPostsCache = null;
    res.json({ slug });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete post
app.delete('/api/admin/blog/posts/:slug', requireAdmin, (req, res) => {
  const { slug } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  const filePath = path.join(BLOG_POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Post not found' });
  try {
    fs.unlinkSync(filePath);
    blogPostsCache = null;
    res.json({ deleted: slug });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// List uploaded images
app.get('/api/admin/blog/images', requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(BLOG_IMAGES_DIR)) return res.json([]);
    const files = fs.readdirSync(BLOG_IMAGES_DIR)
      .filter((f) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f))
      .sort();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// Upload blog image
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(BLOG_IMAGES_DIR)) fs.mkdirSync(BLOG_IMAGES_DIR, { recursive: true });
      cb(null, BLOG_IMAGES_DIR);
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post('/api/admin/blog/images', requireAdmin, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.originalname });
});

// ── Serve React build + catch-all for BrowserRouter ──────────────────────────
const CLIENT_BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'build');

if (fs.existsSync(CLIENT_BUILD)) {
  app.use(express.static(CLIENT_BUILD));
  app.get(/^(?!\/api).*$/, (req, res) => {
    res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  scheduleUserProjectsCacheUpdate();
});
