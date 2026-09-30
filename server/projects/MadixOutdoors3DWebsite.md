---
title: Madix Outdoors 3D Showcase
tagline: A scroll-driven 3D product page for Madix Outdoors' truck-bed camper. Scrolling opens the canopy, doors and hatches on a live model while callouts explain each feature, on desktop and phones.
role: Solo developer. Front end, animation system, 3D asset pipeline, deployment
timeline: Aug – Sep 2025
stack:
  - React
  - Three.js
  - React Three Fiber
  - Tailwind CSS
  - Docker + nginx
live: https://madixoutdoors.harrison-martin.com
blog: https://blog.harrison-martin.com/shipping-a-12-mb-truck
cover: madix-hero.webp
published: true
---
Photos can't show a camper that folds out. This page shows it moving: the visitor scrolls, and the truck's hard-shell canopy pops up, the tent unfolds, the bed panels tilt, and the side and rear hatches open, each step with a callout pinned to the part it describes. Once the model has loaded there is no video to buffer; it is one animated 3D model driven by scroll position.

![[madix-scroll.webp]]

## What I built

- **A config-driven section system.** Each scroll section declares which animation clips it scrubs or snaps and where the camera goes. Adding a section, or reordering them, doesn't touch rendering code.
- **Two camera modes:** fixed poses with eased transitions, and timed flythroughs that play independently of scroll.
- **Annotations anchored to named parts of the model**, drawn as HTML overlays with leader lines. On phones they switch to top or bottom placement so they don't cover the product.
- **A loading path for a large model**: Draco-compressed meshes, WebP textures, and a gzipped GLB decompressed in the browser, deployed as a Docker image served by nginx.

![[madix-mobile-strip.webp]]

## Outcome

Eight animated sections covering the canopy, tent, mattress, pass-through, side hatches and rear hatch, live at madixoutdoors.harrison-martin.com.
