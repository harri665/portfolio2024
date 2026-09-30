---
title: Madix Outdoors 3D Showcase
tagline: A 3D product page for a client's new truck-bed camping tent, where scrolling unfolds the camper piece by piece. I modelled everything in it from scratch.
role: Solo, for a paying client. 3D modelling, front end, animation, deployment
timeline: Aug – Sep 2025
stack:
  - React
  - Three.js
  - React Three Fiber
  - Tailwind CSS
  - Docker + nginx
live: https://madixoutdoors.harrison-martin.com
cover: madix-hero.webp
published: true
---
Madix Outdoors hired me to build a 3D display for their new camping tent, a hard-shell camper that sits in a pickup's bed. Folded, it looks like a bed cover. Unfolded, the roof pops up, a tent appears, the bed panels tilt up for standing room, and the sides and back open as hatches. They wanted a page that showed off those key features, and photos of the two states don't show how one turns into the other.

So on this page, scrolling unfolds the camper. Each feature gets a callout pinned to the part it's describing as it appears. I modelled all of it from scratch: the truck, the camper, every hatch and panel, and the tent.

![[madix-scroll.webp]]

## How the page works

The page is a full-screen 3D view pinned behind a column of tall, empty sections. As you scroll through a section, its progress goes from 0 to 1, and that one number drives everything.

I wired the first few sections up by hand, and by section four that was unmanageable. So I rewrote it so that each section is a short description of what it does:

- **Scrub** ties an animation to the scroll. Scroll down and the door opens, scroll back up and it closes.
- **Snap** sets an animation to a fixed point, so a section always starts in the right state, even if you drag the scrollbar straight from the top to the bottom.
- **The camera** either eases to a set position when you enter a section, or plays a timed flythrough, like the pass through the inside of the tent.

After that, adding or reordering a section was a config change.

The callouts are tied to named parts of the model, not to spots on the screen. Every frame, the part's position is projected onto the screen, and an HTML card draws a dashed line to it, so the callout follows the part as the camera moves.

## The hard parts

### Loading in a reasonable time

The model is big, and a phone has to download all of it before anything moves. I compressed the meshes with Draco, converted the textures to WebP, and gzipped the whole file, decompressing it in the browser. The gzip step only saved 13%, and at the time I assumed 3D data just doesn't compress well.

Much later I opened the file up and added up where the size went:

| part | size |
|---|---|
| 121 meshes (the truck, camper, hatches, 450,000 triangles) | 1.47 MB |
| 8 textures | 0.12 MB |
| animation keyframes | 0.03 MB |
| **the tent** | **10.55 MB** |

85% of the file was the tent. It unfolds as a simulation baked into 31 shapes that the animation blends through, and those shapes are stored as raw numbers that neither Draco nor gzip can shrink. A compressor that handles those shapes (meshopt, through `gltf-transform`) takes the download from 10.8 MB to about 3.5 MB. I haven't shipped that yet, since I still need to check that the unfold looks the same.

### Camera angles on every device

A shot that frames the truck on a wide monitor looks completely different on a tall, narrow phone screen, and every section's camera and callout had to work on both. On a phone, a card next to the truck covers the truck. So below 768 px wide, each callout moves to the top or bottom of the screen and lets the dashed line do the pointing.

![[madix-mobile-strip.webp]]

The 3D view and the page were also fighting over every touch on phones. My commit messages from that week say it best: "updated to work with mobile hopefully", "revert to before mobile stuff", "hopefully fixed mobile scrolling", "fixed on mobile". What finally worked was letting the page have every touch (nothing needs you to touch the model itself) and sizing the view so it doesn't jump when the phone's browser bar hides and shows.

## How it went

Madix used the page for their tent for a while. They've since stopped using it, but it's still live here, with eight sections covering the canopy, tent, mattress, pass-through, side hatches and rear hatch.

## What I'd do differently

- **Look inside the file before trying to compress it.** A short script adding up the size of each part would have pointed at the tent on day one.
- **Use fewer shapes for the tent.** 31 is a lot for one unfold. Half as many would probably look almost the same and halve that part of the file.
- **Keep callouts attached to moving parts.** A callout reads its part's position once, when the section starts. If the part moves during the section, like a hatch swinging open, the line keeps pointing at where it was.
