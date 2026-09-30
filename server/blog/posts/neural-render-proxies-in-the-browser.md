---
title: Relighting a Path-Traced Room in 5 ms
date: '2026-09-30'
tags:
  - code
  - rendering
  - machine-learning
description: >-
  Re-implementing Neural Render Proxies (EGSR 2026) end to end: a Python
  training pipeline, a WebGPU runtime with a hand-written backward pass, and
  everything I learned about where the error actually comes from.
cover: relight-hero.webp
published: false
---

# Relighting a Path-Traced Room in 5 ms

[LIVE DEMO](https://relight.harrison-martin.com "Go to relight.harrison-martin.com")

A path-traced Cornell box looks right because it is expensive. Every pixel averages hundreds of random light paths bouncing around the room, and moving the light means doing all of it again. *Neural Render Proxies for Interactive and Differentiable Lighting* (Sancho et al., EGSR 2026) proposes something that sounded too good: trace the scene once, train a small network on it, and from then on relighting is a network evaluation. Moving a light costs milliseconds, and because the network is differentiable, you can run it backwards: paint the lighting you want and let gradient descent find the lights.

I wanted to see it run in a browser, so I rebuilt the whole thing over two weeks: the data generation, the training, and a WebGPU runtime to run the result. This post covers how the method works, the places I deviated from the paper and why, and what the accuracy harness taught me about where the error comes from.

![[relight-drag.webp]]

---

## The trick: paths don't care where the light is

The whole method rests on one observation. If you trace paths from the camera **without** next-event estimation (no shadow rays aimed at lights), the paths are just BSDF-sampled random walks through the scene. They don't depend on where the light is. A light only matters when one of those path segments happens to pass through it.

So the pipeline splits in two, and the paper names the halves:

- **SAMPLEPATHS** traces light-agnostic paths once and stores every vertex and throughput. In my version that is Mitsuba 3 dumping fp16 vertices, about 2.5 GB per scene at 512² and 128 samples per pixel, and about a minute on an RTX 3080.
- **GATHERLIGHT** takes a virtual sphere light (position, radius) and intersects it with every stored segment. Whatever a segment hits, that light contributes to that pixel. I wrote this as one fused Triton kernel, and `validate_gather.py` checks it against a normal Mitsuba render with a real emitter.

Gather is cheap enough to run thousands of times, which means you can generate a training image for *any* light placement without path tracing again. Those images are noisy (128 spp), so each one goes through OIDN before it becomes a training target.

---

## Linearity does half the work

Light is linear. Two lights produce the sum of what each produces alone, and doubling a light's brightness doubles its contribution. The paper writes the rendered image as

$$\hat{I}(p) = \sum_{v \in \text{lights}} E(v)\, N(p, F_p, v)$$

where $E(v)$ is the light's colour times intensity, and $N$ is the network: given a pixel $p$, that pixel's features $F_p$ (albedo, normal, depth) and a light's parameters $v$, it predicts that light's contribution.

In practice this means the viewer caches each light's contribution as its own image. Changing a light's colour or intensity is a multiply over a cached buffer and costs nothing. Moving a light re-evaluates the network for that light only. Everything else is compositing.

---

## The network

Per pixel, the input is a learned multi-resolution grid encoding of the pixel's position, plus the auxiliary features, plus the light's four parameters (position and radius). In 2D the paper's hash grid never collides, so I store it as dense grids. Then an MLP.

Training keeps a pool of 300 denoised gather images and replaces two of them every five iterations from a background thread, so the GPU never waits on data. Lights are sampled half uniformly in the light's allowed box and half *on recorded path segments*, which puts training lights where they actually affect the image. The loss is relative MSE, the squared error divided by the squared prediction, so a dim corner counts as much as the bright patch under the light.

The paper's network is 256 wide and 8 layers deep. That is too slow to run interactively in a browser, so I shipped 128×4 and 256×4 and measured what it cost.

---

## Deviation 1: don't make the network learn the light itself

Paths start at the camera. Segment 0 is the camera ray itself, so "segment 0 hits the light" means the camera sees the light directly: a sharp, bright disc whose edge moves with the light's position and radius.

That is about the worst thing you could ask an MLP with a grid encoding to learn. It is a discontinuity that moves, and it is also trivially cheap to compute exactly: intersect the camera ray with the sphere and compare against the depth buffer. So the network learns segments ≥ 1 only, and the direct view is analytic, supersampled 4×4.

This turned out to matter for the inverse problem too. A large dim light and a small bright light cast almost the same *indirect* light. Only the visible disc tells them apart. For optimization I use a soft-edged version of the disc, where coverage ramps across one pixel of angular distance, which gives closed-form gradients with respect to position and radius. Without it, radius and intensity were ambiguous and the optimizer wandered between them.

---

## Measure first: where does the error come from?

Before tuning anything I wrote `evaluate.py`. It renders references by streaming GATHERLIGHT over 1024 spp of freshly traced paths (nothing stored), denoises them, adds the exact direct term, and scores models on 37 lights: the viewer's six test lights plus 31 random ones.

It also scores the **training targets themselves** against those references. That turned out to be the most useful number in the project:

| | PSNR | relative error |
|---|---|---|
| training targets (denoised 128 spp) | 52.4 dB | 1.5 % |
| baseline network (paper inputs) | 39.6 dB | 7.2 % |

The supervision is 13 dB better than what the network learns from it. Noise in the targets was not the problem, so more samples or better denoising were not going to help. The network was.

---

## Deviation 2: give the network the physics it keeps re-deriving

Think about what the network has to produce for a diffuse surface lit by a small sphere: roughly the sphere's solid angle, times the cosine between the surface normal and the direction to the light, divided by π, times visibility and albedo. With only pixel position, depth and light coordinates as inputs, it has to synthesise $1/d^2$ falloff and a dot product out of ReLUs, separately everywhere.

So I computed those per (pixel, light) and fed them in: the direction to the light, the cosine with the normal, the log distance and the log solid angle of the sphere. Then I changed the output from a direct prediction to

$$N = a \cdot G + b, \qquad G = \frac{\Omega \cdot \max(\cos\theta, 0)}{\pi}$$

so the network learns a visibility-and-albedo factor $a$ and a residual $b$ on top of the unshadowed irradiance $G$ instead of inventing $G$ itself.

Ablations (128×4, 20k iterations):

| change | PSNR | rel. error | verdict |
|---|---|---|---|
| baseline | 39.6 dB | 7.2 % | |
| + world position as input | 39.8 dB | 7.5 % | no gain |
| **+ geometric features** | **41.7 dB** | **5.7 %** | kept |
| **+ geo + multiplicative head** | **41.8 dB** | **5.4 %** | kept |
| + 3D grid encoding of the light position | 40.3 dB | 6.3 % | worse |
| 128×6 instead of 128×4 | 41.9 dB | 6.0 % | not worth 50 % more cost |

About +2 dB and 25% less error for about 4% more runtime. The world-position result is the instructive one: the information was already there in principle. What helped was handing the network the *function* of it that the physics uses.

After full training, the shipped models:

| model | PSNR | rel. error | worst 5 lights | per light, RTX 3080 |
|---|---|---|---|---|
| fast 128×4 | 44.0 dB | 4.4 % | 32.5 dB | 4.8 ms |
| quality 256×4 | 46.2 dB | 3.5 % | 34.1 dB | 17.1 ms |

The average hides the interesting part. Here is an easy held-out light (proxy, reference, error ×8):

![[relight-accuracy-t1.webp]]

And test 6, which I picked on purpose: a light tucked behind the tall box, against the wall.

![[relight-accuracy-t6.webp]]

That one is at 24.9% relative error instead of 2.3%. Camera paths rarely reach that region, so it gets few training segments, *and* its training targets are the noisiest. The worst lights are the ones the data barely covers. If I spend more path samples anywhere, it is there.

---

## Running it in a browser

The runtime is WGSL compute, specialised to the network's shape at load time:

1. **Precompute** the per-pixel part of the network that doesn't depend on the light, once per scene.
2. **Fused MLP forward** per light: the geometric features, the hidden layers and the output head in one kernel.
3. **Composite**: sum cached light contributions, add the analytic direct term, tonemap.

For Paint & Optimize there is a hand-written **backward pass** in WGSL and an Adam optimizer, following the paper's inverse setup: Reinhard-tonemapped MSE, sigmoid and softplus reparameterisation to keep lights inside their domain, Adam at lr 0.05, and random pixel subsets. The painting loss is `mean(painted) + keep × mean(unpainted)`, normalised so the "keep" slider means the same thing whether you paint a dot or half the room.

![[relight-paint.webp]]

Most phones don't have WebGPU yet, so there is a **WebGL2 fallback** that runs the network as a chain of fragment-shader passes. It is about 2× slower per light on the same GPU. Writing a backward pass in fragment shaders didn't seem worth it, so for optimization it uses central finite differences on the light's four inputs. Colour and the direct term still get exact gradients.

On slow GPUs, dragging a light would stall. When a full-resolution evaluation would take more than about 30 ms, the viewer evaluates every 2nd, 4th or 8th pixel, chosen from measured timings, and fills the rest by bilinear interpolation weighted by surface position, so light doesn't bleed across object edges. About 150 ms after you stop, it re-renders at full resolution. That's the blockiness in the recording above. To test the worst case I ran Chrome on SwiftShader (no GPU at all): dragging went from about one frame every 7 seconds to about 7 fps.

---

## Then I put it on my home page

The CS page of this site now uses the same network as its backdrop: the light follows your cursor and moves behind the card you hover. That forced a second round of engineering, because a home page can't assume anything about the visitor's device.

- **WebGPU instead of WebGL2** took one light from about 23 ms to 5.2 ms at 512², or **3.9 ms** in 16-bit floats where the GPU supports `shader-f16` (at most 3/255 off). Keeping the pixel inputs as halves and folding the first layer into the kernel cut GPU memory from 134 MB to 21 MB.
- **A timing bug that made WebGPU look four times slower than it was.** The quality controller timed every evaluation, including thin refinement slivers a few rows tall, where fixed overhead dominates. It concluded the GPU was slow and held dragging at coarse previews. Now only evaluations of at least a quarter of a light are timed.
- **Firefox** forgets a WebGPU canvas's configuration every time it hands the image over with `transferToImageBitmap`, so every frame after the first threw an error. The composite now reconfigures the canvas when it has been forgotten.
- **Phones** backed the network's budget off to about 4 ms of an 11.7 ms frame, because *any* late frame counted against the network, even ones made late by the page scrolling. The budget now only backs off when frames that ran the network are late more often than frames that didn't.

---

## What I'd do differently

**Write the evaluation harness on day one, not day ten.** Every useful decision in this project came from a number the harness produced. Before it existed I was tuning by eye.

**Start in fp16.** The home-page backdrop got a 25% speedup from `shader-f16` that the standalone viewer still doesn't use. That is the difference that would make the quality model cheap enough to be the default.

**Spend path samples where the error is.** The worst lights are the ones behind things. Adaptive light sampling in training helped the hard tests by 0.5 dB but cost 1.4 dB overall. More camera paths into those regions is the thing I haven't tried.

The limits are the paper's own: a proxy is trained for one static scene and one camera, lights only work inside the box they were trained in, and inverse lighting with several lights is non-convex. If the optimizer lands somewhere silly, press Undo, drag a light roughly into place, and optimize again.

---

## References

- Sancho et al., *Neural Render Proxies for Interactive and Differentiable Lighting*, EGSR 2026
- Müller et al., *Instant Neural Graphics Primitives with a Multiresolution Hash Encoding*, SIGGRAPH 2022, for the grid encoding
- Jakob et al., *Mitsuba 3*, and Intel's *Open Image Denoise*

*Two weeks, September 2026. The code, the training scripts and the accuracy numbers are on [GitHub](https://github.com/harri665/relight).*
