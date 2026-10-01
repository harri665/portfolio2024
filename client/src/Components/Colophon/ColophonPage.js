import React from 'react';
import { Link } from 'react-router-dom';

import SubdomainNav from '../Homepage/SubdomainNav';
import { detectSiteMode } from '../../utils/siteMode';
import Container from '../ui/Container';
import PageHeader from '../ui/PageHeader';

// What the site is made of, for the technical visitor. Keep it to facts that
// are true of the code; update it when the stack changes.
const SECTIONS = [
  {
    title: 'One app, four sites',
    body: [
      'harrison-martin.com and its cs, art and blog subdomains are one React app. It reads the hostname when it starts and picks which pages to route and which accent colour to use. Everything else, from the type scale to the page layouts, is shared.',
      'Styling is Tailwind on top of a small set of design tokens kept as CSS variables, so each site can turn its colour and effects up or down without its own copy of the layout.',
    ],
  },
  {
    title: 'The room behind the CS home page',
    body: [
      'The room behind the CS home page is a Cornell box lit by a small neural network, the same one I trained for my relight project. I path traced the room once, trained the network on it, and now moving the light is just running the network. On the hero the light follows your cursor, and further down it moves behind whichever card you hover, so each card is lit from behind by light bouncing off the walls. On a phone the light drops in from the ceiling and follows the card in focus.',
      'The network runs in WebGPU compute shaders where the browser has them, and as a chain of WebGL2 fragment shaders where it doesn’t, about five times slower. Only a light that moves gets re-run. While it moves the network only runs on every 2nd to 16th pixel, and once it stops the image is filled back in to full resolution a few rows per frame.',
      'A home page can’t assume anything about the visitor’s device, so nothing is benchmarked up front. The page watches its own frames and keeps raising the network’s time budget, the canvas’s pixel ratio and the size of the image the network runs at for as long as it holds 30 fps, and backs off when it doesn’t. What it settles on is saved, so the next visit starts there. The panel at the bottom of the CS home page shows what it ended up running on.',
    ],
    links: [{ href: 'https://cs.harrison-martin.com/relight', label: 'How relight works' }],
  },
  {
    title: 'Glass',
    body: [
      'The glass panes are drawn in WebGL. Every frame, a full-screen pass finds where each pane sits on the page and bends the scene behind it the way a thick piece of glass would: the middle is clear, the rim curves and pulls in what’s just past the edge, and red, green and blue land slightly apart so the edges split into colour. It can also frost and tint what’s behind. Panes in the same group are drawn as one shape, so the sidebar on a CS project page flows into the write-up next to it. The pass runs after the page’s own animations each frame, so the glass never trails a card that’s moving.',
      'The glass page shows all of it on its own. It’s an ordinary HTML page of public-domain paintings that scrolls under a set of glass buttons. To let the glass bend the page itself, every painting and every word on it is copied into the WebGL scene as a texture, word by word, in its own font and colour, and redrawn where it sits on screen each frame. Each pane’s settings are attributes on its element that the pass reads every frame, so the sliders change the glass as you drag them.',
      'The navigation bar is the exception. It bends what’s under it in CSS, with an SVG displacement map.',
    ],
    links: [{ to: '/glass', label: 'Try the glass page' }],
  },
  {
    title: 'Other backdrops',
    body: [
      'Each of the other sites has its own shader behind it, drawn with three.js through React Three Fiber: a prism splitting a beam of light on the hub, and a distorted torus knot behind the art gallery. Project pages use something quieter, so the glass has something sharp to bend without competing with the text: a still dot grid like engineering paper on CS, and the project’s own cover, blurred and dimmed, on art.',
    ],
  },
  {
    title: 'Content',
    body: [
      'CS projects come live from GitHub. The server caches every GitHub response and reads each README once for its title and preview image, so browsing never uses up a visitor’s GitHub rate limit. Each project can also have its own write-up, edited from an admin page.',
      'Art projects are pulled from ArtStation and cached on the server. Blog posts are Markdown files, rendered with maths (KaTeX), code highlighting, callouts and wiki-style links. Comments are stored by the same server, and the contact form reaches me as a Discord message.',
    ],
  },
  {
    title: 'Links and search',
    body: [
      'Link previews and search crawlers don’t run JavaScript, so nginx recognises them and sends them server-rendered Open Graph tags: each project and post gets its own title, description and image. Each subdomain serves its own sitemap and robots.txt.',
    ],
  },
  {
    title: 'Hosting and testing',
    body: [
      'The client and the Express server run as two Docker containers behind nginx, started with Docker Compose.',
      'A Playwright script loads every page of the four sites and records load times, page weight and, on pages that draw WebGL, frame times while the pointer moves, while the page rests and while it scrolls.',
    ],
  },
];

function SectionLink({ link }) {
  return link.to ? <Link to={link.to}>{link.label}</Link> : <a href={link.href}>{link.label}</a>;
}

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
                  {section.links?.map((link) => (
                    <p key={link.label}>
                      <SectionLink link={link} />
                    </p>
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
