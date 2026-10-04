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
import { randomUUID } from 'crypto';
import multer from 'multer';
import { createOgHandler, isCrawler, detectSiteMode, siteOrigin } from './og.js';
import { prettyRepoName, readmeMedia, readmeTitle } from './repoMeta.js';
import { createProjectPages, isProjectPageName, projectPageMedia } from './projectPages.js';
import { seedVolumes } from './seedVolumes.js';
import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3005;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages
  ]
});

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

app.use(cors());
app.use(express.json());
app.use(useragent.express());

// docker volume so it survives rebuilds
const DATA_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// copies new files from the repo into the volumes
seedVolumes({
  seedDir: path.join(process.cwd(), 'seed'),
  appDir: process.cwd(),
  manifestFile: path.join(DATA_DIR, 'seeded.json'),
  dirs: ['blog', 'projects', 'pages'],
});

// admin page edits these so they're a volume too
const PROJECTS_DIR = path.join(process.cwd(), 'projects');
const projectPages = createProjectPages(PROJECTS_DIR);

function ensureCacheFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
}

const videoLinkCacheFile = path.join(DATA_DIR, 'videoLinkCache.json');
const userProjectsCacheFile = path.join(DATA_DIR, 'userProjectsCache.json');
const projectDetailsCacheFile = path.join(DATA_DIR, 'projectDetailsCache.json');
const githubRepoCacheFile = path.join(DATA_DIR, 'githubRepoCache.json');

ensureCacheFileExists(videoLinkCacheFile);
ensureCacheFileExists(userProjectsCacheFile);
ensureCacheFileExists(projectDetailsCacheFile);
ensureCacheFileExists(githubRepoCacheFile);

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

// private repos would 404 on github (maybe even with the token) so the project page stands in
async function getCsRepo(fullName, options) {
  const page = projectPages.read(String(fullName).split('/').pop())?.meta;
  if (!page?.privateRepo) return getGitHubRepoByFullName(fullName, options);

  return {
    id: fullName,
    name: page.repo,
    full_name: fullName,
    html_url: '',
    homepage: page.live,
    description: page.tagline,
    language: page.stack[0] || null,
    topics: [],
    fork: false,
    archived: false,
  };
}

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

      for (let asset of data.assets) {
        if (asset.has_embedded_player && asset.player_embedded) {
          const embedUrlMatch = asset.player_embedded.match(/src='(.*?)'/);
          if (embedUrlMatch && embedUrlMatch[1]) {
            const embedUrl = embedUrlMatch[1];
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

function scheduleUserProjectsCacheUpdate() {
  setInterval(async () => {
    for (const projectId in projectDetailsCache) {
      console.log(`Updating cached project details for project ID: ${projectId}`);
      projectDetailsCache[projectId] = await getProjectDetailsWithPuppeteer(projectId);
    }
    saveCacheToFile(projectDetailsCacheFile, projectDetailsCache);
  }, 60 * 60 * 1000);

  setInterval(async () => {
    for (const username in userProjectsCache) {
      console.log(`Updating cached projects for user: ${username}`);
      userProjectsCache[username] = await getUserProjectsWithPuppeteer(username);
    }
    saveCacheToFile(userProjectsCacheFile, userProjectsCache);
  }, 60 * 60 * 1000);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/discord/dm', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Missing message in request body.' });
  }

  try {
    const user = await client.users.fetch("336913971900710913");
    if (!user) {
      return res.status(404).json({ error: 'Discord user not found.' });
    }

    await user.send(message);

    console.log(`Successfully sent DM to user `);
    res.status(200).json({ success: `Message sent to user.` });

  } catch (error) {
    console.error('Failed to send Discord DM:', error);
    if (error.code === 10013) { // Unknown User
         return res.status(404).json({ error: 'Discord user not found.' });
    }
    if (error.code === 50007) { // Cannot send messages to this user
        return res.status(403).json({ error: 'Cannot send message to this user. They may have DMs disabled or the bot does not share a server with them.' });
    }
    res.status(500).json({ error: 'An internal error occurred while trying to send the message.' });
  }
});

const IP_API_FIELDS =
  'status,message,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query';

// scripts hitting the api directly usually don't send sec-fetch-* or accept-language
function requestSigns(req) {
  const h = req.headers;
  const short = (value) => (typeof value === 'string' ? value.slice(0, 120) : undefined);
  const hostOf = (value) => {
    try {
      return value ? new URL(value).host : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    secFetchSite: short(h['sec-fetch-site']),
    secFetchMode: short(h['sec-fetch-mode']),
    acceptLanguage: short(h['accept-language']),
    origin: hostOf(h.origin),
    referer: hostOf(h.referer),
  };
}
app.get('/api/load', async (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const { os, browser, platform, source } = req.useragent;
    const page = req.query.page || 'unknown';

    const locationResponse = await axios.get(`http://ip-api.com/json/${ip}`, {
      params: { fields: IP_API_FIELDS },
    });
    const locationData = locationResponse.data;

    console.log('--- /api/load called ---');
    console.log('IP Address:', ip);
    console.log('Device/OS:', os);
    console.log('Browser:', browser);
    console.log('Platform:', platform);
    console.log('Full User-Agent String:', source);
    console.log('Accessed page:', page);
    console.log('Location Data:', locationData);

    const logFilePath = path.join(DATA_DIR, 'loadLogs.json');
    if (!fs.existsSync(logFilePath)) {
      fs.writeFileSync(logFilePath, JSON.stringify([], null, 2));
    }

    const timeStamp = new Date().toISOString();

    const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf-8'));
    const id = randomUUID();
    logs.push({
      id,
      timestamp: timeStamp,
      ip,
      device: os,
      browser,
      platform,
      userAgent: source,
      pageAccessed: page,
      location: locationData,
      headers: requestSigns(req),
    });
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));

    res.json({
      message: 'Load endpoint data logged successfully',
      id,
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

// only these fields, and only for visits from the last few hours, so this can't be used to grow the log
const REPORT_FIELDS = {
  relight: {
    phase: 'string', reason: 'string', backend: 'string', notGPU: 'string', network: 'string',
    gpu: 'string', kernel: 'string', prepared: 'string', screen: 'string',
    size: 'number', fps: 'number', dpr: 'number', budget: 'number', cost: 'number', moving: 'number',
    resting: 'number', roomDpr: 'number', cores: 'number', memory: 'number', frames: 'number',
    frameRate: 'number', latePct: 'number', runningSec: 'number',
    half: 'boolean', capped: 'boolean', fixedLayer: 'boolean', fromProfile: 'boolean', seeded: 'boolean',
  },
  visitor: {
    firstInput: 'string', language: 'string', timezone: 'string', screen: 'string', viewport: 'string',
    outer: 'string', renderer: 'string', visibility: 'string',
    moves: 'number', clicks: 'number', touches: 'number', scrolls: 'number', keys: 'number',
    firstInputMs: 'number', dwellMs: 'number', languages: 'number', tzOffset: 'number',
    touchPoints: 'number', cores: 'number', memory: 'number',
    webdriver: 'boolean', finePointer: 'boolean',
  },
};
const REPORT_HOURS = 6;

app.post('/api/load/report', express.text({ type: () => true, limit: '4kb' }), (req, res) => {
  try {
    // sendBeacon sends text
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const id = typeof body.id === 'string' ? body.id.slice(0, 64) : '';
    const fields = REPORT_FIELDS[body.kind];
    const logFilePath = path.join(DATA_DIR, 'loadLogs.json');
    if (!id || !fields || !fs.existsSync(logFilePath)) {
      return res.status(400).json({ error: 'Unknown visit' });
    }
    const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf-8'));
    const log = logs.find((entry) => entry.id === id);
    if (!log || Date.now() - new Date(log.timestamp).getTime() > REPORT_HOURS * 3600 * 1000) {
      return res.status(404).json({ error: 'Unknown visit' });
    }
    const report = {};
    Object.entries(fields).forEach(([key, type]) => {
      const value = body[key];
      if (type === 'string' && typeof value === 'string') {
        report[key] = value.slice(0, 200);
      } else if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
        report[key] = value;
      } else if (type === 'boolean' && typeof value === 'boolean') {
        report[key] = value;
      }
    });
    log[body.kind] = { ...report, reportedAt: new Date().toISOString() };
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
    res.status(204).end();
  } catch (error) {
    console.error('Error in /api/load/report:', error);
    res.status(400).json({ error: 'Bad report' });
  }
});

// has IPs + geolocation so it's admin only
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
    const repo = await getCsRepo(fullName, { forceRefresh });
    res.json(repo);
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || `Failed to fetch GitHub repo ${fullName}`;

    console.error('Error in GitHub repo API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

async function getGitHubReadme(fullName, { forceRefresh = false } = {}) {
  const cachedEntry = getGitHubCacheEntry('readmes', fullName);
  if (!forceRefresh && isGitHubCacheEntryFresh(cachedEntry)) {
    return cachedEntry.data;
  }

  const [owner, repo] = fullName.split('/');
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: getGitHubHeaders() }
    );
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    const data = { content, name: response.data.name };
    setGitHubCacheEntry('readmes', fullName, data);
    return data;
  } catch (error) {
    if (error.response?.status === 404) {
      return { content: null, name: null };
    }
    throw error;
  }
}

async function getGitHubLanguages(fullName, { forceRefresh = false } = {}) {
  const cachedEntry = getGitHubCacheEntry('languages', fullName);
  if (!forceRefresh && isGitHubCacheEntryFresh(cachedEntry)) {
    return cachedEntry.data;
  }

  const [owner, repo] = fullName.split('/');
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/languages`,
    { headers: getGitHubHeaders() }
  );
  setGitHubCacheEntry('languages', fullName, response.data);
  return response.data;
}

function describeReadme(readme, fullName) {
  const content = readme?.content || null;
  return {
    content,
    title: readmeTitle(content),
    media: readmeMedia(content, fullName),
  };
}

function isFullName(value) {
  return /^[^/\s]+\/[^/\s]+$/.test(value);
}

function isRefresh(req) {
  return req.query.refresh === '1' || String(req.query.refresh || '').toLowerCase() === 'true';
}

app.get('/api/github/readme', async (req, res) => {
  const fullName = String(req.query.full_name || '').trim();

  if (!fullName) {
    return res.status(400).json({ error: 'Missing required query param: full_name' });
  }

  if (!isFullName(fullName)) {
    return res.status(400).json({ error: 'full_name must be in "owner/repo" format' });
  }

  try {
    const readme = await getGitHubReadme(fullName, { forceRefresh: isRefresh(req) });
    res.json({ ...describeReadme(readme, fullName), name: readme.name });
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || `Failed to fetch README for ${fullName}`;
    console.error('Error in GitHub readme API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

// ?full_names=owner/a,owner/b. repos with unreadable readmes are skipped instead of failing everything
app.get('/api/github/readme-meta', async (req, res) => {
  const fullNames = String(req.query.full_names || '')
    .split(',')
    .map((name) => name.trim())
    .filter(isFullName)
    .slice(0, 100);

  const entries = await Promise.all(
    fullNames.map(async (fullName) => {
      const page = projectPages.read(fullName.split('/').pop())?.meta;
      if (page?.title && projectPageMedia(page)) {
        return [
          fullName,
          { title: page.title, media: projectPageMedia(page), tagline: page.tagline, live: page.live },
        ];
      }

      try {
        const { title, media } = describeReadme(await getGitHubReadme(fullName), fullName);
        if (page) {
          return [
            fullName,
            {
              title: page.title || title,
              media: projectPageMedia(page) || media,
              tagline: page.tagline,
              live: page.live,
            },
          ];
        }
        return [fullName, { title, media }];
      } catch (error) {
        console.error(`README meta failed for ${fullName}:`, error.message || error);
        return null;
      }
    })
  );

  res.json(Object.fromEntries(entries.filter(Boolean)));
});

app.get('/api/github/languages', async (req, res) => {
  const fullName = String(req.query.full_name || '').trim();

  if (!fullName) {
    return res.status(400).json({ error: 'Missing required query param: full_name' });
  }

  if (!isFullName(fullName)) {
    return res.status(400).json({ error: 'full_name must be in "owner/repo" format' });
  }

  try {
    res.json(await getGitHubLanguages(fullName, { forceRefresh: isRefresh(req) }));
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || `Failed to fetch languages for ${fullName}`;
    console.error('Error in GitHub languages API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

// owner comes from the cs config so whitelisted repos from other accounts work too
app.get('/api/cs/project/:repoName', async (req, res) => {
  const fullName = resolveCsRepoFullName(req.params.repoName);
  if (!fullName) {
    return res.status(400).json({ error: 'Invalid repository name' });
  }

  try {
    const [repo, readme] = await Promise.all([
      getCsRepo(fullName),
      getGitHubReadme(fullName).catch(() => ({ content: null })),
    ]);

    const page = projectPages.read(repo.name);

    res.json({
      repo,
      title: page?.meta.title || readmeTitle(readme.content) || prettyRepoName(repo.name),
      readme: describeReadme(readme, fullName),
      page,
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const message =
      status === 404 ? 'This project could not be found.' : `Failed to load ${fullName}`;
    console.error('Error in CS project API route:', error.message || error);
    res.status(status).json({ error: message });
  }
});

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

// requireAdmin is hoisted from further down
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

// custom slug, hash_id, or title slug
async function getArtProjectByIdentifier(identifier) {
  try {
    const slugConfig = loadArtSlugConfig();
    const hashIdForSlug = Object.entries(slugConfig).find(([, slug]) => slug === identifier)?.[0];
    if (hashIdForSlug) {
      const details = await getProjectDetailsWithPuppeteer(hashIdForSlug);
      if (details) return details;
    }
  } catch {}

  try {
    const byHashId = await getProjectDetailsWithPuppeteer(identifier);
    if (byHashId) return byHashId;
  } catch {}

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

const BLOG_POSTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blog', 'posts');
const BLOG_IMAGES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blog', 'images');

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

app.post('/api/admin/auth', (req, res) => {
  if (req.headers['x-admin-key'] === ADMIN_KEY) res.json({ ok: true });
  else res.status(401).json({ error: 'Invalid key' });
});

app.get('/api/admin/blog/posts', requireAdmin, (req, res) => {
  try {
    res.json(loadBlogPostsAll());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

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

// one page per repo, so PUT creates or replaces

app.get('/api/admin/projects', requireAdmin, (req, res) => {
  try {
    res.json(projectPages.listAll());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load project pages' });
  }
});

app.get('/api/admin/projects/:repo', requireAdmin, (req, res) => {
  if (!isProjectPageName(req.params.repo)) return res.status(400).json({ error: 'Invalid repository name' });
  const page = projectPages.read(req.params.repo, { includeDrafts: true });
  if (!page) return res.status(404).json({ error: 'No page for this project yet' });
  res.json(page);
});

app.put('/api/admin/projects/:repo', requireAdmin, (req, res) => {
  if (!isProjectPageName(req.params.repo)) return res.status(400).json({ error: 'Invalid repository name' });
  try {
    const { content, ...fields } = req.body || {};
    res.json(projectPages.write(req.params.repo, fields, content));
  } catch (err) {
    res.status(500).json({ error: 'Failed to save project page' });
  }
});

app.delete('/api/admin/projects/:repo', requireAdmin, (req, res) => {
  if (!isProjectPageName(req.params.repo)) return res.status(400).json({ error: 'Invalid repository name' });
  if (!projectPages.remove(req.params.repo)) return res.status(404).json({ error: 'No page for this project' });
  res.json({ deleted: req.params.repo });
});

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

// "<type>:<id>", type is blog | cs | art. bodies are plain text and rendered as text, no markup

const commentsFile = path.join(DATA_DIR, 'comments.json');
ensureCacheFileExists(commentsFile);
let commentsStore = loadCacheFromFile(commentsFile);

const COMMENT_TYPES = new Set(['blog', 'cs', 'art']);
const MAX_COMMENT_NAME = 60;
const MAX_COMMENT_BODY = 2000;
const COMMENT_RATE_WINDOW_MS = 60 * 1000;
const COMMENT_RATE_LIMIT = 3;

const commentRateBuckets = new Map();

function threadKey(type, id) {
  if (!COMMENT_TYPES.has(type)) return null;
  // same charset the art/blog/cs routes accept (art ids can be title slugs)
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

  // honeypot
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

  // replies only go one level deep, a reply to a reply goes on the top level comment
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

app.get('/api/admin/comments', requireAdmin, (req, res) => {
  const threads = Object.entries(commentsStore)
    .map(([key, comments]) => {
      const [type, ...rest] = key.split(':');
      return { key, type, id: rest.join(':'), comments };
    })
    .filter((t) => t.comments.length > 0);
  res.json(threads);
});

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

  const next = thread.filter(
    (c) => c.id !== target.id && c.parentId !== target.id
  );

  if (next.length === 0) delete commentsStore[key];
  else commentsStore[key] = next;
  saveComments();

  res.json({ ok: true, removed: thread.length - next.length });
});

// nextcloud doesn't send CORS headers

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

// so art pages can load covers into webgl

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

const PAGES_DIR = path.join(process.cwd(), 'pages');
fs.mkdirSync(PAGES_DIR, { recursive: true });

function safePagePath(slug) {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return null;
  const base = path.resolve(PAGES_DIR);
  const resolved = path.resolve(base, `${slug}.html`);
  // path traversal check
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

app.get('/p/:slug', (req, res) => {
  const filePath = safePagePath(req.params.slug);
  if (!filePath) return res.status(400).send('Invalid page name');
  if (!fs.existsSync(filePath)) return res.status(404).send('Page not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(filePath);
});

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

// og tags for crawlers. nginx sends them to /__og with X-Original-URI, this catches them when
// express serves the build itself

const GITHUB_DEFAULT_OWNER = 'harri665';

function resolveCsRepoFullName(repoName) {
  if (!/^[\w.-]+$/.test(repoName)) return null;

  const listed = (loadCsConfig().repoNames || []).find(
    (name) => name.split('/').pop().toLowerCase() === repoName.toLowerCase()
  );

  if (listed) return listed.includes('/') ? listed : `${GITHUB_DEFAULT_OWNER}/${listed}`;
  return `${GITHUB_DEFAULT_OWNER}/${repoName}`;
}

const ARTSTATION_USERNAME = 'harr1';

// gallery links by hash_id so that's canonical
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

// same list CSHomePage shows
async function listCsRepos() {
  const config = loadCsConfig();
  const listed = (config.repoNames || []).map((name) => String(name).trim()).filter(Boolean);

  if (config.enabled) {
    const repos = await Promise.all(
      listed.map(async (entry) => {
        const fullName = entry.includes('/') ? entry : `${GITHUB_DEFAULT_OWNER}/${entry}`;
        try {
          const repo = await getCsRepo(fullName);
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
  getCsRepo,
  getCsReadme: async (fullName) => describeReadme(await getGitHubReadme(fullName), fullName),
  getCsRepoFullName: resolveCsRepoFullName,
  getProjectPage: (repoName) => projectPages.read(repoName),
  listBlogPosts: () => loadBlogPosts(),
  listArtProjects,
  listCsRepos,
});

app.get('/__og', (req, res) => ogHandler(req, res, req.headers['x-original-uri'] || req.query.path || '/'));

// robots + sitemap per subdomain, google treats each one as its own site

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

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/p/')) return next();
  if (path.extname(req.path)) return next();
  if (!isCrawler(req.headers['user-agent'])) return next();
  return ogHandler(req, res, req.originalUrl);
});

const CLIENT_BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'build');

if (fs.existsSync(CLIENT_BUILD)) {
  app.use(express.static(CLIENT_BUILD));
  app.get(/^(?!\/api).*$/, (req, res) => {
    res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  scheduleUserProjectsCacheUpdate();
});
