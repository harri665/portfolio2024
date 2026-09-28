import React from 'react';

import SubdomainNav from '../Homepage/SubdomainNav';
import { detectSiteMode } from '../../utils/siteMode';
import Container from '../ui/Container';
import PageHeader from '../ui/PageHeader';

// keep this up to date when the stack changes
const SECTIONS = [
  {
    title: 'One app, four sites',
    body: [
      'harrison-martin.com and its cs, art, and blog subdomains are a single React app. It reads the hostname at startup and picks which pages to route and which accent colour to use; everything else, from the type scale to the page structure, is shared.',
      'Styling is Tailwind on top of a small set of design tokens kept as CSS variables, so each section can turn its colour and effects up or down without forking the layout.',
    ],
  },
  {
    title: '3D and glass',
    body: [
      'The prism on the home page and the shapes behind the art gallery are custom shaders, drawn with three.js through React Three Fiber.',
      'The glass cards are not a CSS blur. A WebGL pass measures where each card sits on the page and refracts the scene through it, splitting the light at the edges. It renders after the page’s own animations each frame, so the glass never trails a moving card.',
    ],
  },
  {
    title: 'Content',
    body: [
      'CS projects come live from GitHub. The server caches every GitHub response and reads each README once for its title and preview image, so browsing never spends a visitor’s GitHub rate limit.',
      'Art projects are pulled from ArtStation and cached on the server. Blog posts are Markdown files, rendered with maths (KaTeX), code highlighting, callouts, and wiki-style links. Comments are stored by the same server, and the contact form reaches me as a Discord message.',
    ],
  },
  {
    title: 'Links and search',
    body: [
      'Link previews and search crawlers don’t run JavaScript, so nginx recognises them and hands them server-rendered Open Graph tags instead: each project and post gets its own title, description, and image. Each subdomain serves its own sitemap and robots.txt.',
    ],
  },
  {
    title: 'Hosting',
    body: [
      'The client and the Express server run as two Docker containers behind nginx, started with Docker Compose.',
    ],
  },
];

export default function ColophonPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <SubdomainNav currentMode={detectSiteMode()} />

      <Container as="main" className="pb-24 pt-28 sm:pt-32">
        <div className="max-w-3xl">
          <PageHeader title="How this site is built" />

          <div className="mt-12 space-y-12">
            {SECTIONS.map((section) => (
              <section key={section.title}>
                <h2 className="text-xl font-semibold tracking-tight text-ink">{section.title}</h2>
                <div className="prose-doc prose-reading mt-3 max-w-[68ch]">
                  {section.body.map((paragraph) => (
                    <p key={paragraph.slice(0, 32)}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Container>
    </div>
  );
}
