---
title: The Truck Was 12 MB, and 85% of It Was One Tent
date: '2026-09-30'
tags:
  - code
  - 3d
  - web
description: >-
  Building a scroll-driven 3D product page with React Three Fiber, and finding
  out months later why gzip only saved 13% of the model: 31 morph targets that
  Draco never touches.
cover: madix-hero.webp
published: false
---

# The Truck Was 12 MB, and 85% of It Was One Tent

[LIVE SITE](https://madixoutdoors.harrison-martin.com "Go to madixoutdoors.harrison-martin.com")

Madix Outdoors makes a hard-shell camper that sits in a pickup's bed. Folded, it looks like a tonneau cover. Unfolded, the roof pops up, a four-season tent appears, the bed panels tilt up for standing room, and the sides and rear open as hatches. Photos of the two states don't explain how one becomes the other, so the idea was a product page where **scrolling unfolds the camper**, with a callout for each feature as it appears.

This post covers the section system that drives it, the handful of things that broke on phones, and a model-size mystery I only solved while writing this.

![[madix-scroll.webp]]

---

## Scroll as a timeline

The page is a full-screen React Three Fiber canvas pinned behind a column of tall, empty sections. Each section's scroll progress is just how far its top has moved past the top of the viewport, as a fraction of its height:

```js
function progressFor(el) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (rect.bottom <= 0 || rect.top >= vh) return 0;
  return Math.max(0, Math.min(1, -rect.top / rect.height));
}
```

That number, 0 to 1, drives everything else. The first version wired each section's animations up by hand. By section four that was unmaintainable, so I rewrote it as configuration. Each section declares what it does, and one loop interprets it:

```js
{
  id: 5,
  label: "Side",
  actions: [
    { mode: "scrub", clip: door, map: (s) => Math.max(0, 1 - s) },   // close the door
    { mode: "snap",  clip: resolve("BackWindow"), t: 0 },            // rear window shut
    { mode: "scrub", clip: resolve("Side"), map: (s) => s },          // open the side
  ],
  camera: {
    mode: "fixed",
    getPose: () => ({ position: new THREE.Vector3(0, 1.5, -5), target: new THREE.Vector3(0, 0, 0) }),
    baseDuration: (_, fast) => (fast ? 1.2 : 3.5),
  },
}
```

Two action types cover everything:

- **scrub** maps section progress onto an animation clip's time. Scroll down and the door opens; scroll back up and it closes. The `map` function lets a section play a clip backwards, or only over part of its length.
- **snap** forces a clip to a fixed time, so a section starts in a known state however you arrived at it, including by dragging the scrollbar straight from the top to section 6.

The camera gets two modes as well: **fixed** poses with an eased transition when you enter the section (shorter if you're scrolling fast), and **timeline** flythroughs that play on their own clock once triggered, used for the cinematic pass through the tent. Reordering sections, or adding one, became a config edit.

---

## Callouts pinned to the model

Each feature callout names an object in the model rather than a screen position:

```js
4: [{ objectName: "Plane008", text: "Pass-Through Access",
      description: "* Tilt-up bed panels for full truck bed use\n * Full standing room inside",
      position: "bottom" }],
```

When a section starts, the code finds that object in the scene graph and reads its world position. Every frame it projects that point through the camera to screen pixels, and an HTML overlay draws the card and a dashed leader line to it. So the callout follows the part as the camera moves, and the copy stays in the DOM, which keeps it crisp and selectable.

On a phone, a 320-pixel-wide card next to the truck covers the truck. The `position` field only applies below 768 px, where it moves the card to the top or bottom of the screen and lets the leader line do the pointing:

![[madix-mobile-strip.webp]]

---

## Phones, specifically

A 3D canvas that fills the screen and a page that scrolls fight over the same touches. The commit history from that week reads "updated to work with mobile hopefully," "revert to before mobile stuff," "hopefully fixed mobile scrolling," "fixed on mobile." What worked in the end:

- **`pointer-events: none` on the canvas.** Nothing on the page needs a touch on the model itself, and giving every touch to the page made scrolling behave.
- **`100svh` for the pinned viewer**, so the canvas doesn't jump when the mobile browser's toolbar hides and shows.
- **Mobile-specific callout placement**, above.

Deployment has its own stretch of history ("please work," "work please," "works," "anywhere"), which came down to the nginx config inside the Docker image. The final setup is a multi-stage build: Node builds the static site, and nginx serves it with gzip.

---

## The 12 MB question

The model, `Tent3.glb`, is 12.3 MB. That is a lot to ask a phone to download before anything moves, so early on I added a gzip step: compress the GLB at build time, and decompress it in the browser before handing it to the GLTF loader.

It saved **13%**: 12.3 MB down to 10.8 MB. At the time I shrugged and assumed 3D data doesn't compress well. Writing this post, I finally opened the file and added it up:

| part | size |
|---|---|
| everything, total | 12.34 MB |
| 121 meshes, Draco-compressed | 1.47 MB |
| 8 textures, WebP | 0.12 MB |
| animation keyframes | 0.03 MB |
| **one mesh, `filecache1`: 31 morph targets** | **10.55 MB** |

The file was already Draco-compressed, with WebP textures. The truck, the canopy, the hatches, 450,000 triangles of it, came to 1.5 MB. The rest was a single mesh called `filecache1`, named for the Houdini file cache it was exported from: 14,182 vertices of simulated geometry baked into **31 morph targets**, which the `animation0` clip plays through as the roof rises and the tent unfolds.

Draco compresses a mesh's base geometry. The morph targets are stored beside it as plain 32-bit float arrays, positions and normals for every vertex, 31 times over. They were 85% of the file, and float arrays that are close to random in their low bits are exactly what gzip can't shrink.

The fix is a compressor that understands morph targets. `gltf-transform` with meshopt compression quantizes and encodes all vertex streams, targets included:

```bash
npx @gltf-transform/cli meshopt Tent3.glb tent-meshopt.glb
```

| | on disk | over the wire (gzip) |
|---|---|---|
| shipped: Draco + gzip | 12.34 MB | **10.77 MB** |
| meshopt | 4.84 MB | **3.5 MB** |

About a third of the download. I've only checked the file sizes so far, not the visual result, and quantized morph targets can wobble if the precision is too low, so the next step is to eyeball the unfold side by side. But it is the fix, and I spent a gzip step solving the wrong 13%.

---

## What I'd do differently

**Look inside the asset before optimising the transport.** One `node` script that sums the byte sizes per part would have pointed at the morph targets on day one.

**Bake the simulation as a vertex animation texture, or as fewer targets.** Thirty-one targets for a single unfold is generous. Half as many, with the animation blending between them, would probably cost little visually and halve that part of the file.

**Re-read the anchor's position every frame.** Callouts capture the target object's world position once, when the section starts. If the part itself moves during the section, a hatch swinging open, for example, the anchor stays where the hatch was. Reading it in the frame loop is one line.

---

*Built with React, Three.js and React Three Fiber, Tailwind CSS, Docker and nginx. [Code on GitHub](https://github.com/harri665/MadixOutdoors3DWebsite).*
