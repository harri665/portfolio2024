---
title: Relight
tagline: I wanted fully ray-traced lighting in real time on any hardware, so I rebuilt a 2026 paper that trains a small network to do it, and got it running in the browser.
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
blog: https://blog.harrison-martin.com/real-time-fully-ray-traced-rendering-on-any-hardware
cover: relight-hero.webp
published: true
---
I was looking at methods for rendering fully ray-traced scenes in real time on any kind of hardware, and I wanted to learn more about AI. *Neural Render Proxies for Interactive and Differentiable Lighting* (Sancho et al., EGSR 2026) covered both. You path trace a scene once, train a small neural network on it, and from then on moving a light is just running the network.

So I rebuilt the whole thing from scratch over two weeks: generating the data, training, and a viewer that runs in the browser. Moving a light re-renders the room in about **5 ms on an RTX 3080**, and there's a fallback that runs on phones. You can also paint the lighting you want onto the room and let the network work out where the lights need to go.

![[relight-drag.webp]]

## How it works

A path-traced image looks right because it's expensive. Every pixel averages hundreds of random light paths bouncing around the room, and moving the light means doing all of it again.

The paper's trick is that if you trace paths from the camera without aiming any of them at the light, the paths don't depend on where the light is. A light only matters when one of those paths happens to pass through it. So:

1. **Trace the paths once.** Mitsuba 3 traces the scene from the camera and stores every bounce, about 2.5 GB for one scene, in about a minute on an RTX 3080.
2. **Drop a virtual light in and check which paths hit it.** I wrote this as one Triton GPU kernel. It's cheap enough to run thousands of times, so I can make a training image for any light position without path tracing again. Each one is denoised with Intel's OIDN.
3. **Train a network on those images.** Given a pixel, what's at that pixel (colour, surface direction, depth) and a light's position and size, it predicts how much that light adds to that pixel.

Light also adds up. Two lights give the sum of what each gives alone, and doubling a light's brightness doubles its contribution. So the viewer stores each light's contribution as its own image. Changing a light's colour or brightness is just a multiply, and moving one only re-runs the network for that light.

## Painting the lighting

You don't have to place the lights yourself. You paint the lighting you want straight onto the room, in whatever colours you want, and the lights move to make it happen.

![[relight-paint-colors.webp]]
*Blue painted up the left wall and orange across the floor. After 200 steps, about 1.6 seconds on an RTX 3080, the fill light has turned blue and moved against the wall, and the key light has turned orange and dropped down by the floor.*

It works because the network can run backwards. Normally it goes from lights to an image. For painting, I wrote the network's backward pass by hand in WebGPU, so the site can ask "if this light moved a little, or got a little bluer, would the image look more like the painting?" Then it nudges every light's position, size, colour and brightness in that direction and repeats. The graph under the button is the error going down as it runs.

Painting in black asks for less light somewhere. The "keep unpainted regions" slider controls how hard it tries to leave the rest of the room alone, and the checkboxes lock what it's allowed to change, so you can let it only recolour the lights, or only move them. You can also load an image and let it light the room to match.

## The hard part: getting the training right

Getting the training right was the hardest part of the project, and most of what I learned about AI came from it.

**The network is only as good as what it's shown.** Training keeps a pool of 300 images and swaps two out every five steps from a background thread, so the GPU never waits for data. Half of the training lights are placed at random, and half are placed along recorded light paths, so they land where they actually change the image. The loss is relative error, so a dim corner counts as much as the bright patch under the light.

**Some things shouldn't be learned at all.** When the camera can see the light directly, it's a sharp, bright disc whose edge moves with the light. That's about the worst thing to ask this kind of network to learn, and it's easy to compute exactly with one ray–sphere test. So the network only learns the bounced light, and the visible disc is computed directly. That turned out to matter for painting too: a big dim light and a small bright one cast almost the same bounced light, and only the visible disc tells them apart.

**Measure before tuning.** I was tuning by eye at first, so I wrote an evaluation script that compares every model against high-quality path-traced references for 37 lights. It also scores the training images themselves, and that turned out to be the most useful number in the project:

| | PSNR | relative error |
|---|---|---|
| training images (denoised) | 52.4 dB | 1.5% |
| network trained on them | 39.6 dB | 7.2% |

The training images were 13 dB better than what the network learned from them. So the problem wasn't noisy data. It was the network.

**Give the network the physics.** How much light a small sphere puts on a surface mostly comes down to how big the light looks from there and the angle it hits at. The network was having to rebuild that from raw positions everywhere in the image. So I computed those values per pixel and fed them in, which the paper doesn't do. I also changed the output so the network only learns the part that physics can't give it: shadows, surface colour and bounced light.

| change | PSNR | relative error | |
|---|---|---|---|
| paper's inputs | 39.6 dB | 7.2% | |
| + world position | 39.8 dB | 7.5% | no gain |
| **+ light direction, angle, size** | **41.7 dB** | **5.7%** | kept |
| **+ new output** | **41.8 dB** | **5.4%** | kept |
| deeper network (6 layers) | 41.9 dB | 6.0% | not worth 50% more time |

That's about 2 dB better with 25% less error, for about 4% more runtime. The world-position row is the one I learned the most from. The network already had that information, but it didn't help until I gave it the form the physics actually uses.

The paper's network is 256 wide and 8 layers deep, which is too slow for a browser, so I shipped two smaller ones and measured what they cost:

| model | PSNR | relative error | time per light (RTX 3080) |
|---|---|---|---|
| fast, 128×4 | 44.0 dB | 4.4% | 4.8 ms |
| quality, 256×4 | 46.2 dB | 3.5% | 17.1 ms |

![[relight-accuracy-t1.webp]]
*Network, path-traced reference, and the error ×8 for a light it never trained on.*

The averages hide the hard cases. A light tucked behind the tall box against the wall is at 24.9% error instead of 2.3%, because camera paths rarely reach that spot, so there's little training data for it. The worst lights are the ones the data barely covers.

![[relight-accuracy-t6.webp]]

## Running on any hardware

The browser version runs the network in hand-written WebGPU compute shaders. There's one pass for the part of the network that doesn't depend on the light (done once per scene), and one fused pass per light.

Most phones don't have WebGPU yet, so there's a WebGL2 fallback that runs the network as a chain of fragment shaders, about 2× slower. On slow GPUs, dragging a light renders only every 2nd, 4th or 8th pixel, fills in the gaps along surfaces, and re-renders at full resolution once you stop. That's the blockiness in the recording at the top. To test the worst case, I ran it in Chrome with no GPU at all, and dragging went from one frame every 7 seconds to about 7 fps.

## On my home page

Later I put the same network behind my CS home page, because I thought it would look nice. The light follows your cursor and moves behind whatever card you hover over. A home page can't assume anything about the visitor's device, so that took a second round of work:

- **WebGPU with 16-bit floats** brought one light from about 23 ms in WebGL2 down to 3.9 ms, and cut GPU memory from 134 MB to 21 MB.
- **A timing bug** made WebGPU look four times slower than it was, because tiny refinement passes were being timed as if they were full renders. So it kept dragging stuck on blocky previews.
- **Firefox** forgets the WebGPU canvas setup every frame when the image is handed over, so every frame after the first threw an error until I reconfigured it each time.
- **Phones** kept cutting the network's time budget because of any late frame, even frames made late by scrolling. Now it only backs off when frames that ran the network are the late ones.

## What I'd do differently

- **Write the evaluation on day one.** Every useful decision came from a number it produced.
- **Start in 16-bit floats.** The home page got a 25% speedup from them that the standalone viewer still doesn't use.
- **Put more training data where the error is.** The worst lights are the ones behind things, and more camera paths into those areas is the thing I haven't tried yet.

It has the paper's limits too: a network is trained for one scene and one camera, lights only work inside the area they were trained in, and with several lights the painting optimizer can land somewhere silly. If it does, press Undo, drag a light roughly into place, and optimize again.
