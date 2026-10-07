# portfolio2024

Live portfolio website (2024 edition) built as a modern, responsive web app to showcase projects, experience, and contact information.

**Live site:** https://www.harrison-martin.com

## Overview

This project is my updated portfolio site for 2024. It focuses on clear presentation, fast load times, and a clean UI that makes it easy to browse featured work.

## Highlights

- Responsive layout (desktop / tablet / mobile)
- Project-focused structure for showcasing work
- Modern front-end workflow (local dev server + production build)

## Tech Stack

- **Frontend:** React (Create React App)
- **Language:** JavaScript
- **Tooling:** npm scripts (dev / test / build)

## Getting Started (Local Development)

> The client app lives in the `client/` directory.

### Prerequisites
- Node.js + npm

### Run locally
```bash
cd client
npm install
npm start
```

Then open: http://localhost:3000

### Production build
```bash
cd client
npm run build
```

## Project Structure

- `client/` — Frontend application

## Link preview images

CS and blog links use a 1200 × 630 JPEG screenshot of the shared page in their
Open Graph and Twitter metadata. Only `cs.harrison-martin.com` and
`blog.harrison-martin.com` use screenshots; other hosts keep their existing images.
Homepages, published posts and CS project pages are supported.

The backend renders with its existing Puppeteer installation and stores captures
in `data/site-previews/` (the persistent server data volume). Captures refresh
after six hours; a previous successful image stays available during refresh.
Visitor logging is suppressed for these renders. Run `node --test sitePreview.test.js`
from `server/` to check domain scoping, metadata and caching.

Docker uses `SITE_PREVIEW_ORIGIN=http://client` to render the React app through
nginx on the private network. Outside Docker, leave that variable unset to use
the public sites, or set it to the local frontend origin. Rebuild both containers
to deploy the backend endpoint and client readiness markers.

---

**Author:** Harrison (`harri665`)
