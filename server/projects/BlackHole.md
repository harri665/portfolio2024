---
title: Kerr Black Hole Renderer
tagline: A spinning black hole rendered straight from the equations of general relativity, made for a film about black holes at Fiske Planetarium.
role: Solo. Built for a Fiske Planetarium film. Physics, Vulkan renderer, shaders
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
I made this for a film about black holes at Fiske Planetarium. I wanted it to show what a spinning black hole actually looks like, worked out from the physics. *Interstellar*'s black hole is beautiful, but it was deliberately toned down so audiences wouldn't think it looked wrong. Here, the lopsided ring of light, the bright side of the disk and the way space gets dragged around the hole all come out of the equations. None of it is painted on.

I wrote it in Vulkan because I'd never used it and wanted to learn it.

<video src="https://cloud.harrison-martin.com/public.php/dav/files/e7JSj4ACseM7p27/" autoplay loop muted playsinline></video>

## How it works

Every pixel sends a ray of light backwards in time from the camera and follows it through curved space until one of three things happens: it falls into the black hole (black pixel), it escapes to the sky, or it hits the accretion disk (the glowing ring of gas orbiting the hole). In flat space that ray would be a straight line. Near a black hole it bends, loops around, and can pass behind the hole and come back, which is why you can see the far side of the disk over the top.

The black hole spins at 99.8% of the maximum possible, which is about as fast as real ones are thought to get. A non-spinning black hole is the textbook case: perfectly round, with the same behaviour in every direction. Spin breaks that. The hole drags space around with it, the disk's inner edge moves in closer, and the ring of light gets squashed on one side.

## The hard part: the math

The hardest part of this project was understanding the math behind it. I had to learn enough general relativity to write every equation in the shader myself, and a few pieces took a long time to click.

**Following the light.** Each ray's path comes from Hamilton's equations for light in the spinning black hole's spacetime (the Kerr metric). A ray has eight numbers (four for position, four for momentum), but the spin and the time symmetry mean two of the momenta never change along the ray. They're the photon's energy and its angular momentum around the spin axis, so they're computed once at the camera and I only have to integrate five numbers per ray. That keeps each ray small enough to live in GPU registers.

**The Carter constant.** The piece that surprised me most is that there's a hidden third conserved quantity, which Brandon Carter found in 1968:

$$Q = p_\theta^2 + \cos^2\theta\left(\frac{L_z^2}{\sin^2\theta} - a^2 E^2\right)$$

There's no simple picture of what it means, the way there is for energy or angular momentum, but it tells you where a ray has to turn around as it moves up and down. Without that check, rays near the black hole drift into places they physically can't be and the image fills with garbage.

**The edge of the hole.** The coordinates I use break down at the event horizon: one of the terms divides by zero there, even though nothing physical happens. Any ray that gets within 0.01 of the horizon radius is stopped and counted as captured.

**The photon sphere.** Close to the hole there's a region where light can orbit it, and rays that pass near it are extremely sensitive. A tiny error sends them somewhere completely different. So the shader has two integrators: a fast fixed-step one (RK4) for previews, and an adaptive one (Cash–Karp RKF45) for final frames that shrinks its steps exactly where the geometry gets sensitive.

One derivative in particular I rewrote three times before I trusted it, and the comments in that function still show it.

## The colour of the disk

Nothing in the image is colour-graded. The disk's temperature is highest at its inner edge and falls off going outward. Each point glows with the colour of a blackbody at that temperature, found by running its spectrum through the CIE colour-matching functions, which model how human eyes respond to light.

Then relativity shifts it. The gas orbits so fast that the side moving toward the camera is Doppler-shifted bluer and brighter, and the side moving away is redder and dimmer. Light climbing out of the black hole's gravity also loses energy on the way. Both effects combine into one factor $g$, and the light that reaches the camera is a blackbody at the shifted temperature:

$$I_\text{obs}(\lambda) = g^3 \cdot B_\lambda(gT)$$

That's why one side of the disk is so much brighter than the other.

![Close-up render](https://cloud.harrison-martin.com/apps/files_sharing/publicpreview/YYxL8L6WJs4Q3id?file=/&fileId=1024708&x=1920&y=1080&a=true&etag=e9e4838af21c4ad6d5dea25efe4acf93)

## Learning Vulkan

All the physics runs in a Vulkan compute shader, one GPU thread per pixel. It writes into a 32-bit floating-point image, a second pass tone-maps that to the screen, and an ImGui panel on top lets me change the spin, camera and disk while it runs. Each frame adds another sample to the image, so it sharpens the longer you leave it still.

For final renders, the same shader runs with no window, collecting as many samples as I ask for, and writes a 4K 32-bit EXR. Keeping preview and final render as one shader means what I see while setting up a shot is what comes out. The physics is split into separate shader files for the metric, the disk, the blackbody colour and the sky, so it isn't 800 lines of math in one place.

## For the dome

A planetarium screen is a dome, so the film needs fisheye frames that wrap overhead. The renderer outputs those too. This viewer plays one of them as it would look on the dome:

<iframe src="https://harrison-martin.com/p/blackhole-fisheye-viewer" title="Fisheye dome viewer" width="100%" height="520" style="border:none;" allow="autoplay; fullscreen"></iframe>

## What I'd do differently

- **Handle the horizon properly.** Near the horizon I shrink the step size with a rule I tuned by hand. It works, but switching to coordinates that don't break down at the horizon would be the proper fix.
- **Finish the volumetric disk.** Loading the disk from a Houdini simulation (NanoVDB) is wired in but not finished. The analytic disk shows all the relativistic effects, but a simulated one would look a lot more alive.

The blog post has the full math: the metric, the equations of motion, how the camera's rays are set up, and the disk model.
