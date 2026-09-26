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
import { createOgHandler, isCrawler, detectSiteMode, siteOrigin } from './og.js';
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

  if (!githubRepoCache.readmes || typeof githubRepoCache.readmes !== 'object') {
    githubRepoCache.readmes = {};
  }

  if (!githubRepoCache.languages || typeof githubRepoCache.languages !== 'object') {
    githubRepoCache.languages = {};
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
// Visitor logs carry IPs and geolocation, so they sit behind the admin key.
app.get('/api/logs', requireAdmin, (req, res) => {
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

app.get('/api/github/readme', async (req, res) => {
  const fullName = String(req.query.full_name || '').trim();
  const forceRefresh =
    req.query.refresh === '1' || String(req.query.refresh || '').toLowerCase() === 'true';

  if (!fullName) {
    return res.status(400).json({ error: 'Missing required query param: full_name' });
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
    return res.status(400).json({ error: 'full_name must be in "owner/repo" format' });
  }

  const cachedEntry = getGitHubCacheEntry('readmes', fullName);
  if (!forceRefresh && isGitHubCacheEntryFresh(cachedEntry)) {
    return res.json(cachedEntry.data);
  }

  try {
    const [owner, repo] = fullName.split('/');
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: getGitHubHeaders() }
    );
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    const data = { content, name: response.data.name };
    setGitHubCacheEntry('readmes', fullName, data);
    res.json(data);
  } catch (error) {
    if (error.response?.status === 404) {
      return res.json({ content: null, name: null });
    }
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || `Failed to fetch README for ${fullName}`;
    console.error('Error in GitHub readme API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

app.get('/api/github/languages', async (req, res) => {
  const fullName = String(req.query.full_name || '').trim();
  const forceRefresh =
    req.query.refresh === '1' || String(req.query.refresh || '').toLowerCase() === 'true';

  if (!fullName) {
    return res.status(400).json({ error: 'Missing required query param: full_name' });
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
    return res.status(400).json({ error: 'full_name must be in "owner/repo" format' });
  }

  const cachedEntry = getGitHubCacheEntry('languages', fullName);
  if (!forceRefresh && isGitHubCacheEntryFresh(cachedEntry)) {
    return res.json(cachedEntry.data);
  }

  try {
    const [owner, repo] = fullName.split('/');
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/languages`,
      { headers: getGitHubHeaders() }
    );
    setGitHubCacheEntry('languages', fullName, response.data);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || `Failed to fetch languages for ${fullName}`;
    console.error('Error in GitHub languages API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

// -------------------------
// CS Projects Config
// -------------------------
const CS_CONFIG_FILE = path.join(process.cwd(), 'csProjectsConfig.json');

const DEFAULT_CS_CONFIG = {
  enabled: true,
  preserveListedOrder: true,
  repoNames: [
    'OpenGL-Star-Simulation',
    'MadixOutdoors3DWebsite',
    'MurderMysteryCH/MurderMysteryV2',
  ],
};

function loadCsConfig() {
  try {
    if (fs.existsSync(CS_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CS_CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load CS config:', e);
  }
  return { ...DEFAULT_CS_CONFIG };
}

app.get('/api/cs-config', (req, res) => {
  res.json(loadCsConfig());
});

// requireAdmin is a hoisted function declaration defined with the admin routes below.
app.post('/api/cs-config', requireAdmin, (req, res) => {
  try {
    const { enabled, preserveListedOrder, repoNames } = req.body;
    if (!Array.isArray(repoNames)) {
      return res.status(400).json({ error: 'repoNames must be an array' });
    }
    const config = {
      enabled: Boolean(enabled),
      preserveListedOrder: Boolean(preserveListedOrder),
      repoNames: repoNames.map(String).filter(Boolean),
    };
    fs.writeFileSync(CS_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to save CS config:', e);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// -------------------------
// Art slug config
// -------------------------
const ART_SLUG_CONFIG_FILE = path.join(process.cwd(), 'artSlugConfig.json');

function loadArtSlugConfig() {
  try {
    if (fs.existsSync(ART_SLUG_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(ART_SLUG_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveArtSlugConfig(config) {
  fs.writeFileSync(ART_SLUG_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

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

function titleToSlug(title) {
  return (title || '').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-]/g, '');
}

// Resolves an art URL identifier (custom slug, hash_id, or title slug) to project details.
async function getArtProjectByIdentifier(identifier) {
  // 1. Check custom slug config (reverse map: custom-slug → hash_id)
  try {
    const slugConfig = loadArtSlugConfig();
    const hashIdForSlug = Object.entries(slugConfig).find(([, slug]) => slug === identifier)?.[0];
    if (hashIdForSlug) {
      const details = await getProjectDetailsWithPuppeteer(hashIdForSlug);
      if (details) return details;
    }
  } catch {}

  // 2. Try by hash_id directly
  try {
    const byHashId = await getProjectDetailsWithPuppeteer(identifier);
    if (byHashId) return byHashId;
  } catch {}

  // 3. Try by auto-generated title slug
  try {
    for (const username in userProjectsCache) {
      const projects = userProjectsCache[username]?.data || [];
      const match = projects.find((p) => titleToSlug(p.title) === identifier);
      if (match) {
        const details = await getProjectDetailsWithPuppeteer(match.hash_id);
        if (details) return details;
      }
    }
  } catch (error) {
    console.error('Error in by-identifier title-slug lookup:', error);
  }

  return null;
}

app.get('/api/project/by-identifier/:identifier', async (req, res) => {
  const details = await getArtProjectByIdentifier(req.params.identifier);
  if (details) return res.json(details);
  res.status(404).json({ error: 'Project not found' });
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

// ─── ART ADMIN ───────────────────────────────────────────────────────────────

app.get('/api/admin/art/slugs', requireAdmin, (req, res) => {
  res.json(loadArtSlugConfig());
});

app.post('/api/admin/art/slugs', requireAdmin, (req, res) => {
  try {
    const { slugs } = req.body;
    if (typeof slugs !== 'object' || Array.isArray(slugs)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const cleaned = {};
    for (const [hashId, slug] of Object.entries(slugs)) {
      const s = String(slug || '').trim();
      if (s && /^[A-Za-z0-9-]+$/.test(s)) {
        cleaned[hashId] = s;
      }
    }
    saveArtSlugConfig(cleaned);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// ─── COMMENTS ────────────────────────────────────────────────────────────────
// One thread per post, keyed as "<type>:<id>" where type is blog | cs | art.
// Bodies are stored as plain text and rendered as text by the client, so no
// markup ever round-trips back out.

const commentsFile = path.join(DATA_DIR, 'comments.json');
ensureCacheFileExists(commentsFile);
let commentsStore = loadCacheFromFile(commentsFile);

const COMMENT_TYPES = new Set(['blog', 'cs', 'art']);
const MAX_COMMENT_NAME = 60;
const MAX_COMMENT_BODY = 2000;
const COMMENT_RATE_WINDOW_MS = 60 * 1000;
const COMMENT_RATE_LIMIT = 3;

// ip -> timestamps of recent posts, pruned on each attempt
const commentRateBuckets = new Map();

function threadKey(type, id) {
  if (!COMMENT_TYPES.has(type)) return null;
  // Art identifiers can be hash_ids or title slugs, so allow the same
  // character set the art/blog/cs routes already accept.
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return null;
  return `${type}:${id}`;
}

function saveComments() {
  saveCacheToFile(commentsFile, commentsStore);
}

function publicComment(comment) {
  return {
    id: comment.id,
    name: comment.name,
    body: comment.body,
    createdAt: comment.createdAt,
    parentId: comment.parentId || null,
    editedAt: comment.editedAt || null,
  };
}

function isCommentRateLimited(ip) {
  const now = Date.now();
  const recent = (commentRateBuckets.get(ip) || []).filter(
    (t) => now - t < COMMENT_RATE_WINDOW_MS
  );
  if (recent.length >= COMMENT_RATE_LIMIT) {
    commentRateBuckets.set(ip, recent);
    return true;
  }
  recent.push(now);
  commentRateBuckets.set(ip, recent);
  return false;
}

app.get('/api/comments/:type/:id', (req, res) => {
  const key = threadKey(req.params.type, req.params.id);
  if (!key) return res.status(400).json({ error: 'Invalid thread' });

  const thread = commentsStore[key] || [];
  res.json(thread.filter((c) => !c.hidden).map(publicComment));
});

app.post('/api/comments/:type/:id', (req, res) => {
  const key = threadKey(req.params.type, req.params.id);
  if (!key) return res.status(400).json({ error: 'Invalid thread' });

  // Hidden field real people never fill in.
  if (req.body?.website) return res.status(400).json({ error: 'Rejected' });

  const name = String(req.body?.name || '').trim();
  const body = String(req.body?.body || '').trim();

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!body) return res.status(400).json({ error: 'Comment is required' });
  if (name.length > MAX_COMMENT_NAME) {
    return res.status(400).json({ error: `Name must be ${MAX_COMMENT_NAME} characters or fewer` });
  }
  if (body.length > MAX_COMMENT_BODY) {
    return res.status(400).json({ error: `Comment must be ${MAX_COMMENT_BODY} characters or fewer` });
  }

  // Replies are capped at one level: a reply to a reply attaches to the same
  // top-level comment, so threads stay readable and can't nest without bound.
  let parentId = null;
  if (req.body?.parentId) {
    const thread = commentsStore[key] || [];
    const parent = thread.find((c) => c.id === req.body.parentId && !c.hidden);
    if (!parent) return res.status(400).json({ error: 'That comment no longer exists' });
    parentId = parent.parentId || parent.id;
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  if (isCommentRateLimited(ip)) {
    return res.status(429).json({ error: 'Slow down — try again in a minute.' });
  }

  const comment = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name,
    body,
    parentId,
    createdAt: new Date().toISOString(),
    ip,
  };

  if (!Array.isArray(commentsStore[key])) commentsStore[key] = [];
  commentsStore[key].push(comment);
  saveComments();

  res.status(201).json(publicComment(comment));
});

// Admin: every thread, including hidden comments
app.get('/api/admin/comments', requireAdmin, (req, res) => {
  const threads = Object.entries(commentsStore)
    .map(([key, comments]) => {
      const [type, ...rest] = key.split(':');
      return { key, type, id: rest.join(':'), comments };
    })
    .filter((t) => t.comments.length > 0);
  res.json(threads);
});

// Admin: edit a comment's author, body, or timestamp
app.patch('/api/admin/comments/:type/:id/:commentId', requireAdmin, (req, res) => {
  const key = threadKey(req.params.type, req.params.id);
  if (!key) return res.status(400).json({ error: 'Invalid thread' });

  const thread = commentsStore[key];
  const comment = thread?.find((c) => c.id === req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const updates = {};

  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (name.length > MAX_COMMENT_NAME) {
      return res.status(400).json({ error: `Name must be ${MAX_COMMENT_NAME} characters or fewer` });
    }
    updates.name = name;
  }

  if (req.body?.body !== undefined) {
    const body = String(req.body.body).trim();
    if (!body) return res.status(400).json({ error: 'Comment is required' });
    if (body.length > MAX_COMMENT_BODY) {
      return res.status(400).json({ error: `Comment must be ${MAX_COMMENT_BODY} characters or fewer` });
    }
    updates.body = body;
  }

  if (req.body?.createdAt !== undefined) {
    const parsed = new Date(req.body.createdAt);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    updates.createdAt = parsed.toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  Object.assign(comment, updates, { editedAt: new Date().toISOString() });
  saveComments();

  res.json(publicComment(comment));
});

app.delete('/api/admin/comments/:type/:id/:commentId', requireAdmin, (req, res) => {
  const key = threadKey(req.params.type, req.params.id);
  if (!key) return res.status(400).json({ error: 'Invalid thread' });

  const thread = commentsStore[key];
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const target = thread.find((c) => c.id === req.params.commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  // Deleting a top-level comment takes its replies with it, so none are orphaned.
  const next = thread.filter(
    (c) => c.id !== target.id && c.parentId !== target.id
  );

  if (next.length === 0) delete commentsStore[key];
  else commentsStore[key] = next;
  saveComments();

  res.json({ ok: true, removed: thread.length - next.length });
});

// ─── VIDEO PROXY ─────────────────────────────────────────────────────────────
// Streams video from cloud.harrison-martin.com, bypassing browser CORS restrictions.

const PROXY_ALLOWED_HOST = 'cloud.harrison-martin.com';

app.get('/api/proxy/video', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (parsed.hostname !== PROXY_ALLOWED_HOST) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'stream',
      maxRedirects: 5,
      headers: {
        ...(req.headers.range ? { Range: req.headers.range } : {}),
        'User-Agent': 'Mozilla/5.0',
      },
    });

    res.status(upstream.status);
    const forward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forward) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    upstream.data.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: 'Proxy failed' });
  }
});

// ─── IMAGE PROXY ─────────────────────────────────────────────────────────────
// Serves ArtStation images with CORS headers (from the cors() middleware), so
// the art project pages can load a cover into WebGL as their backdrop.

const IMAGE_PROXY_HOST = /^cdn[a-z]?\.artstation\.com$/;

app.get('/api/proxy/image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (parsed.protocol !== 'https:' || !IMAGE_PROXY_HOST.test(parsed.hostname)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'stream',
      maxRedirects: 3,
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const type = upstream.headers['content-type'] || '';
    if (!type.startsWith('image/')) {
      upstream.data.destroy();
      return res.status(415).json({ error: 'Not an image' });
    }

    res.setHeader('Content-Type', type);
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    upstream.data.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: 'Proxy failed' });
  }
});

// ─── STATIC PAGES ────────────────────────────────────────────────────────────

const PAGES_DIR = path.join(process.cwd(), 'pages');
fs.mkdirSync(PAGES_DIR, { recursive: true });

function safePagePath(slug) {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return null;
  const base = path.resolve(PAGES_DIR);
  const resolved = path.resolve(base, `${slug}.html`);
  // Prevent path traversal: resolved must start with base + separator
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

// Public: serve a custom static page
app.get('/p/:slug', (req, res) => {
  const filePath = safePagePath(req.params.slug);
  if (!filePath) return res.status(400).send('Invalid page name');
  if (!fs.existsSync(filePath)) return res.status(404).send('Page not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(filePath);
});

// Admin: list all pages
app.get('/api/admin/pages', requireAdmin, (req, res) => {
  try {
    const pages = fs.readdirSync(PAGES_DIR)
      .filter(f => f.endsWith('.html'))
      .map(f => ({ slug: f.replace(/\.html$/, '') }));
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

// Admin: get single page
app.get('/api/admin/pages/:slug', requireAdmin, (req, res) => {
  const filePath = safePagePath(req.params.slug);
  if (!filePath) return res.status(400).json({ error: 'Invalid slug' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Page not found' });
  try {
    res.json({ slug: req.params.slug, content: fs.readFileSync(filePath, 'utf-8') });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read page' });
  }
});

// Admin: create or update page
app.put('/api/admin/pages/:slug', requireAdmin, (req, res) => {
  const filePath = safePagePath(req.params.slug);
  if (!filePath) return res.status(400).json({ error: 'Invalid slug' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ ok: true, slug: req.params.slug });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save page' });
  }
});

// Admin: delete page
app.delete('/api/admin/pages/:slug', requireAdmin, (req, res) => {
  const filePath = safePagePath(req.params.slug);
  if (!filePath) return res.status(400).json({ error: 'Invalid slug' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Page not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

// ─── LINK PREVIEWS ───────────────────────────────────────────────────────────
// Crawlers that don't run JS get server-rendered Open Graph tags instead of the
// static index.html shell. nginx rewrites crawler requests to /__og and passes
// the original path in X-Original-URI; when Express serves the build directly
// the middleware below catches them instead.

const GITHUB_DEFAULT_OWNER = 'harri665';

// `/:repoName` carries only the repo name, so look up the owner from the
// configured list before falling back to the default account.
function resolveCsRepoFullName(repoName) {
  if (!/^[\w.-]+$/.test(repoName)) return null;

  const listed = (loadCsConfig().repoNames || []).find(
    (name) => name.split('/').pop().toLowerCase() === repoName.toLowerCase()
  );

  if (listed) return listed.includes('/') ? listed : `${GITHUB_DEFAULT_OWNER}/${listed}`;
  return `${GITHUB_DEFAULT_OWNER}/${repoName}`;
}

const ARTSTATION_USERNAME = 'harr1';

// The gallery links projects by hash_id, so that's the canonical URL.
function listArtProjects() {
  const projects =
    userProjectsCache[ARTSTATION_USERNAME]?.data ||
    Object.values(userProjectsCache)[0]?.data ||
    [];

  return projects
    .filter((project) => project?.hash_id)
    .map((project) => ({
      identifier: project.hash_id,
      title: project.title || project.hash_id,
      description: project.description || '',
      image: project.cover?.thumb_url || project.cover?.small_square_url || null,
      date: project.published_at || project.created_at || null,
    }));
}

// Mirrors what CSHomePage shows: owned non-forks, plus whitelisted external
// repos, filtered by the whitelist when it's enabled.
async function listCsRepos() {
  const config = loadCsConfig();
  const listed = (config.repoNames || []).map((name) => String(name).trim()).filter(Boolean);

  if (config.enabled) {
    const repos = await Promise.all(
      listed.map(async (entry) => {
        const fullName = entry.includes('/') ? entry : `${GITHUB_DEFAULT_OWNER}/${entry}`;
        try {
          const repo = await getGitHubRepoByFullName(fullName);
          return repo?.name ? { name: repo.name, description: repo.description || '' } : null;
        } catch {
          return null;
        }
      })
    );
    return repos.filter(Boolean);
  }

  const owned = await getGitHubRepoList({ owner: GITHUB_DEFAULT_OWNER, perPage: 100 });
  return (owned || [])
    .filter((repo) => !repo.fork)
    .map((repo) => ({ name: repo.name, description: repo.description || '' }));
}

const ogHandler = createOgHandler({
  blogPostsDir: BLOG_POSTS_DIR,
  blogImagesDir: BLOG_IMAGES_DIR,
  getArtProject: getArtProjectByIdentifier,
  getCsRepo: (fullName) => getGitHubRepoByFullName(fullName),
  getCsRepoFullName: resolveCsRepoFullName,
  listBlogPosts: () => loadBlogPosts(),
  listArtProjects,
  listCsRepos,
});

app.get('/__og', (req, res) => ogHandler(req, res, req.headers['x-original-uri'] || req.query.path || '/'));

// ─── SEARCH ENGINES ──────────────────────────────────────────────────────────
// robots.txt and sitemap.xml are per-host: each subdomain is its own site to
// Google, so each one advertises only its own pages.

function siteOriginFor(req) {
  return siteOrigin(req.headers['x-forwarded-host'] || req.headers.host);
}

app.get('/robots.txt', (req, res) => {
  const origin = siteOriginFor(req);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /cs-admin',
      'Disallow: /art-admin',
      'Disallow: /blog-admin',
      'Disallow: /pages-admin',
      'Disallow: /api/',
      '',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

app.get('/sitemap.xml', async (req, res) => {
  const origin = siteOriginFor(req);
  const mode = detectSiteMode(req.headers['x-forwarded-host'] || req.headers.host);

  function urlEntry({ loc, lastmod, changefreq = 'monthly', priority = '0.8' }) {
    return `<url><loc>${loc}</loc>${
      lastmod ? `<lastmod>${lastmod}</lastmod>` : ''
    }<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
  }

  try {
    const entries = [
      urlEntry({ loc: `${origin}/`, changefreq: 'weekly', priority: '1.0' }),
    ];

    if (mode === 'blog') {
      for (const post of loadBlogPosts()) {
        entries.push(
          urlEntry({ loc: `${origin}/${encodeURIComponent(post.slug)}`, lastmod: post.date })
        );
      }
    } else if (mode === 'art') {
      for (const project of listArtProjects()) {
        entries.push(
          urlEntry({
            loc: `${origin}/${encodeURIComponent(project.identifier)}`,
            lastmod: project.date ? String(project.date).slice(0, 10) : null,
          })
        );
      }
    } else if (mode === 'cs') {
      for (const repo of await listCsRepos()) {
        entries.push(urlEntry({ loc: `${origin}/${encodeURIComponent(repo.name)}` }));
      }
    } else {
      // The root site's content lives on the subdomains.
      for (const host of ['cs', 'art', 'blog']) {
        entries.push(
          urlEntry({
            loc: `https://${host}.harrison-martin.com/`,
            changefreq: 'weekly',
            priority: '0.9',
          })
        );
      }
      entries.push(urlEntry({ loc: `${origin}/contact`, priority: '0.5' }));
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${entries.join(
        '\n  '
      )}\n</urlset>`
    );
  } catch (err) {
    console.error('Failed to generate sitemap:', err);
    res.status(500).send('Failed to generate sitemap');
  }
});

// Fallback for deployments where Express serves the React build itself.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/p/')) return next();
  if (path.extname(req.path)) return next(); // static assets
  if (!isCrawler(req.headers['user-agent'])) return next();
  return ogHandler(req, res, req.originalUrl);
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
