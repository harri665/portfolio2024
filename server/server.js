import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import useragent from 'express-useragent';
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
client.login(process.env.DISCORD_BOT_TOKEN);

client.once('ready', () => {
  console.log(`✅ Logged in to Discord as ${client.user.tag}!`);
});
// --- END DISCORD BOT SETUP ---


app.use(cors());
app.use(express.json());
app.use(useragent.express()); // Enable express-useragent

// Helper to ensure a cache file exists (create it if it doesn't)
function ensureCacheFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
}

// Cache file paths
const videoLinkCacheFile = path.join(process.cwd(), 'videoLinkCache.json');
const userProjectsCacheFile = path.join(process.cwd(), 'userProjectsCache.json');
const projectDetailsCacheFile = path.join(process.cwd(), 'projectDetailsCache.json');

// Ensure all cache files exist before loading
ensureCacheFileExists(videoLinkCacheFile);
ensureCacheFileExists(userProjectsCacheFile);
ensureCacheFileExists(projectDetailsCacheFile);

// Load the caches
let videoLinkCache = loadCacheFromFile(videoLinkCacheFile);
let userProjectsCache = loadCacheFromFile(userProjectsCacheFile);
let projectDetailsCache = loadCacheFromFile(projectDetailsCacheFile);

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
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
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
    const logFilePath = path.join(process.cwd(), 'loadLogs.json');
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
    const logFilePath = path.join(process.cwd(), 'loadLogs.json');
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

    saveCacheToFile(videoLinkCacheFile, videoLinkCache);
    saveCacheToFile(userProjectsCacheFile, userProjectsCache);
    saveCacheToFile(projectDetailsCacheFile, projectDetailsCache);

    res.status(200).json({ message: 'All caches cleared successfully' });
  } catch (error) {
    console.error('Error clearing caches:', error);
    res.status(500).json({ error: 'Failed to clear caches' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  scheduleUserProjectsCacheUpdate();
});