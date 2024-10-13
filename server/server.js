import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

// Cache file paths
const videoLinkCacheFile = path.join(process.cwd(), 'videoLinkCache.json');
const userProjectsCacheFile = path.join(process.cwd(), 'userProjectsCache.json');

// Cache file paths for project details
const projectDetailsCacheFile = path.join(process.cwd(), 'projectDetailsCache.json');

// Load cache from files
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

    // Extract the direct video link from the video source element
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

// Function to fetch user projects by username
async function getUserProjectsWithPuppeteer(username) {
  // Check if the user projects are already cached
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
      userProjectsCache[username] = data; // Cache the user projects
      saveCacheToFile(userProjectsCacheFile, userProjectsCache); // Save cache to file
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

// Function to update user projects cache every hour
function scheduleUserProjectsCacheUpdate() {
  // Update project details cache every hour
  setInterval(async () => {
    for (const projectId in projectDetailsCache) {
      console.log(`Updating cached project details for project ID: ${projectId}`);
      projectDetailsCache[projectId] = await getProjectDetailsWithPuppeteer(projectId);
    }
    saveCacheToFile(projectDetailsCacheFile, projectDetailsCache); // Save updated cache to file
  }, 60 * 60 * 1000); // Update every hour
  setInterval(async () => {
    for (const username in userProjectsCache) {
      console.log(`Updating cached projects for user: ${username}`);
      userProjectsCache[username] = await getUserProjectsWithPuppeteer(username);
    }
    saveCacheToFile(userProjectsCacheFile, userProjectsCache); // Save updated cache to file
  }, 60 * 60 * 1000); // Update every hour
}

// Function to fetch project details by project ID
async function getProjectDetailsWithPuppeteer(projectId) {
  // Check if the video link is already cached
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

      // Iterate through assets to find embedded players and replace them with direct video links
      for (let asset of data.assets) {
        if (asset.has_embedded_player && asset.player_embedded) {
          const embedUrlMatch = asset.player_embedded.match(/src='(.*?)'/);
          if (embedUrlMatch && embedUrlMatch[1]) {
            const embedUrl = embedUrlMatch[1];
            
            // Check if we have already cached the direct link for this asset
            if (!videoLinkCache[embedUrl]) {
              console.log(`Fetching direct video link for embed URL: ${embedUrl}`);
              const directVideoUrl = await getDirectVideoLink(embedUrl);
              if (directVideoUrl) {
                // Cache the direct link for this embed URL
                videoLinkCache[embedUrl] = directVideoUrl;
                asset.player_embedded = directVideoUrl;
              }
            } else {
              // Use the cached link if available
              asset.player_embedded = videoLinkCache[embedUrl];
            }
          }
        }
      }

      // Cache the entire project details with replaced direct links
      projectDetailsCache[projectId] = data;
      saveCacheToFile(projectDetailsCacheFile, projectDetailsCache); // Save cache to file

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

// API route to fetch user projects
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

// API route to fetch project details by ID
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

// API route to update all cached user projects
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
    saveCacheToFile(userProjectsCacheFile, userProjectsCache); // Save updated user projects cache to file
    saveCacheToFile(projectDetailsCacheFile, projectDetailsCache); // Save updated project details cache to file
    res.status(200).json({ message: 'Projects and project details updated successfully' });
  } catch (error) {
    console.error('Error updating cached projects:', error);
    res.status(500).json({ error: 'Failed to update projects and project details' });
  }
});


// API route to clear all cached data
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
  console.log(`Server is running on port ${PORT}`);
  scheduleUserProjectsCacheUpdate(); // Start the cache update scheduler
});