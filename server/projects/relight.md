---
title: Relight
tagline: Relights a path-traced room in the browser in about 5 ms per light, by re-implementing a 2026 research paper end to end, from the training pipeline to a WebGPU viewer.
role: Solo. Research reading, data pipeline, training, web runtime, UI
timeline: Sep 2026 · 2 weeks
stack:
  - PyTorch
  - Mitsuba 3
  - Triton
  - WebGPU / WGSL
  - WebGL2
  - React
live: https://relight.harrison-martin.com
blog: https://blog.harrison-martin.com/neural-render-proxies-in-the-browser
cover: relight-hero.webp
published: true
---
Path tracing a Cornell box takes seconds per frame. Relight trains a small neural network, a *neural render proxy*, that has learned how light moves through one scene, then runs it in the browser. Moving a light re-renders the room in about **5 ms on an RTX 3080**, with a fallback that also runs on phones. You can also paint the lighting you want and let gradient descent find the lights that produce it.

It is a from-scratch re-implementation of *Neural Render Proxies for Interactive and Differentiable Lighting* (Sancho et al., EGSR 2026). The same network also runs as the live backdrop on this site's CS home page.

![[relight-drag.webp]]

## What I built

- **Training pipeline (Python).** Mitsuba 3 traces light-independent camera paths once. A fused Triton kernel intersects every path segment with virtual sphere lights, OIDN denoises the results, and a background thread keeps a pool of fresh training images coming.
- **Browser runtime (WGSL).** Hand-written compute kernels for the network's forward pass, a per-light cache so colour and intensity edits cost nothing, and a hand-written backward pass plus an Adam optimizer for inverse lighting.
- **A WebGL2 fallback** that runs the network as a chain of fragment-shader passes for browsers without WebGPU.
- **An accuracy harness** that scores every model against 1024-sample path-traced references on 37 held-out lights.

## Key decisions

- **Computed the directly visible light exactly instead of learning it.** A sharp disc whose edge moves with the light is very hard for an MLP, and an exact ray–sphere test is cheap. This also made radius and brightness identifiable during optimization.
- **Added geometric inputs the paper doesn't use** (direction, cosine and solid angle to the light) and a multiplicative output head: **+2 dB and 25% less error** for about 4% more runtime.
- **Shrank the network from 256×8 to 128×4** so it evaluates interactively in a browser, then measured what that cost in accuracy instead of guessing.

## Outcome

| model | PSNR | relative error | time per light (RTX 3080) |
|---|---|---|---|
| fast, 128×4 | 44.0 dB | 4.4 % | 4.8 ms |
| quality, 256×4 | 46.2 dB | 3.5 % | 17.1 ms |

![[relight-accuracy-t1.webp]]
*Neural proxy, path-traced reference, and error ×8 for a held-out test light.*
