---
title: Real-Time, Fully Ray-Traced Rendering on Any Hardware
date: '2026-09-30'
tags:
  - code
  - rendering
  - machine-learning
description: >-
  A small neural network that stands in for a path tracer, so a fully
  ray-traced room can be relit in real time in the browser, and you can paint
  the lighting you want.
cover: relight-hero.webp
published: true
---

# Real-Time, Fully Ray-Traced Rendering on Any Hardware

[LIVE DEMO](https://relight.harrison-martin.com "Go to relight.harrison-martin.com")

Fully ray-traced lighting looks great because it's expensive. Every pixel averages hundreds of light paths bouncing around the scene, and moving a light means doing all of that again. Normally that takes a high-end graphics card, and even then it isn't instant.

I wanted to see if I could get it running in real time on any hardware. I found a 2026 paper, *Neural Render Proxies* (Sancho et al.), with an idea I liked: do the expensive ray tracing once, ahead of time, and train a small neural network to remember how light moves through the scene. After that, moving a light just means running the network.

I rebuilt it from scratch, and now a light moves through a fully ray-traced room in about 5 ms in the browser. It also runs on phones, and even on a computer with no GPU at all.

![[relight-drag.webp]]

## How it works

**1. Ray trace once.** Paths are traced from the camera into the room and every bounce is saved. None of them are aimed at a light, so they don't depend on where the light is. A light only matters when one of those paths happens to pass through it.

**2. Make training images.** Drop a virtual light anywhere, check which saved paths hit it, and you have an image of the room lit by that light, with no new ray tracing. It's fast enough to make thousands of these.

**3. Train a small network.** For each pixel, the network gets what's at that pixel (colour, surface direction, depth) and the light's position and size, and it learns how much light lands there.

**4. Run it in the browser.** The network runs in WebGPU, with a WebGL2 fallback for phones. Light adds up, so each light's contribution is stored separately. Changing a light's colour or brightness costs nothing, and moving one only re-runs the network for that light.

The catch is that each network is trained for one scene and one camera. The expensive part doesn't disappear, it just happens before you open the page. What you get in return is ray-traced lighting that runs anywhere.

## Painting the lighting

Placing lights by hand is fiddly. Usually you know what you want the room to look like, not where the lights should go. So instead, you can paint the lighting you want onto the room, and the lights move to match it.

![[relight-paint-colors.webp]]

Here I painted blue up the left wall and orange across the floor. In about 1.6 seconds, one light turns blue and moves against the wall, and the other turns orange and drops down by the floor.

This works because the network can run backwards. Normally it goes from lights to an image. For painting, it goes the other way:

1. Render the room with the current lights.
2. Compare it to your painting, pixel by pixel.
3. Work backwards through the network to see how each light should change to get closer: move a little left, get a little bigger, turn a little bluer.
4. Nudge every light that way, and repeat.

That's gradient descent, the same process used to train the network in the first place. The only difference is that the network stays fixed and the lights are what get adjusted. It takes 200 small steps, and the graph under the button shows the difference from your painting shrinking as it goes.

A few controls change what it's allowed to do. Black paint asks for less light. "Keep unpainted regions" decides how much it cares about the parts you didn't paint. The checkboxes let it only move the lights, only recolour them, or only change one of them. You can also load an image and light the room to match it.

## Try it

It's live at [relight.harrison-martin.com](https://relight.harrison-martin.com). Open the Paint & Optimize tab, pick a colour, paint somewhere, and hit Optimize lights. If it lands somewhere odd, press Undo, drag a light roughly where you want it, and try again.

The [project page](https://cs.harrison-martin.com/relight) goes further into the training and the numbers, and the code is on [GitHub](https://github.com/harri665/relight).
