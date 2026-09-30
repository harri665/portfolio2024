---
title: Kerr Black Hole Renderer
tagline: Renders a spinning black hole from the equations of general relativity on the GPU, interactively in a preview window and as 4K, 32-bit EXR stills.
role: Solo. Physics, Vulkan renderer, shaders
timeline: Apr – Jun 2026
stack:
  - Vulkan
  - GLSL compute
  - C++20
  - ImGui
  - OpenEXR
live: https://harrison-martin.com/p/blackhole-fisheye-viewer
blog: https://blog.harrison-martin.com/black-holes
cover: https://cloud.harrison-martin.com/apps/files_sharing/publicpreview/ffkFMd5KfHpi432?file=/&fileId=1024597&x=1920&y=1080&a=true&etag=248e349ae73d7ebfcc93374acc8bbed5
published: true
---
Most black hole renders are either textbook Schwarzschild (no spin) or artistically toned down, as Interstellar's was. This one traces light through the **Kerr metric**, the spacetime of a black hole spinning at 99.8% of its maximum. Frame dragging, the lopsided photon ring and the brighter approaching side of the disk all emerge from the physics rather than being painted on.

Every pixel launches a ray backwards in time and integrates its path through curved spacetime on the GPU until it falls in, escapes, or hits the accretion disk. The same shader drives an interactive preview and an offline mode that accumulates samples into a full-resolution 32-bit EXR.

<video src="https://cloud.harrison-martin.com/public.php/dav/files/e7JSj4ACseM7p27/" autoplay loop muted playsinline></video>

## Key decisions

- **Hamiltonian formulation in Boyer–Lindquist coordinates.** Energy, angular momentum and the Carter constant are conserved exactly, which reduces each ray's state from eight numbers to five and keeps it in GPU registers.
- **Two integrators behind one switch.** Fixed-step RK4 for fast previews, and adaptive Cash–Karp RKF45 for final frames, which automatically tightens its steps near the photon sphere where the geometry is sensitive.
- **Physically based colour.** The disk emits a blackbody spectrum that is Doppler- and gravitationally shifted per pixel, then integrated against the CIE colour-matching functions. No colour grading.
- **Vulkan compute rather than a fragment shader**, so the offline renderer is the same code as the preview, just run headless with more samples.

## Outcome

4K renders at near-extremal spin, and a fisheye cut built for a planetarium-style dome (see the live viewer).

![Close-up render](https://cloud.harrison-martin.com/apps/files_sharing/publicpreview/YYxL8L6WJs4Q3id?file=/&fileId=1024708&x=1920&y=1080&a=true&etag=e9e4838af21c4ad6d5dea25efe4acf93)
