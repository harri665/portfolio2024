---
title: MPM Material Simulator
tagline: I'd used MPM in Houdini, so I built my own from scratch to see how it works, then wrote it again in CUDA and WebGPU.
role: Solo. Class project for Advanced Computer Graphics (CSCI 4239), extended afterwards
timeline: Mar – May 2026 · ~100 hours
stack:
  - OpenGL 4.3 compute
  - GLSL
  - C
  - CUDA
  - WebGPU / WGSL
live: https://mpm.harrison-martin.com/?castle&res=1
blog: https://blog.harrison-martin.com/mpm
cover: https://cloud.harrison-martin.com/public.php/dav/files/enykwkka9TsR8Hn/
video: https://cloud.harrison-martin.com/public.php/dav/files/cjFjnaC2TFWfp38/
published: true
---
The Material Point Method (MPM) is what's behind most of the snow, sand and mud in film VFX. I'd used it in Houdini and followed how it developed there, and I wanted to break down how it's actually built. So I wrote one from scratch, running entirely on the GPU, from four SIGGRAPH papers.

The same solver does sand, jelly, rubber and liquid. The only difference between them is two numbers stored on each particle. In the browser it runs **16K particles at about 180 fps, or 131K at about 35 fps**, on an RTX 3080. You can try it with the live demo button above.

## How MPM works

MPM is half particle simulation and half grid simulation. The particles hold everything about the material: where it is, how fast it's moving, and how deformed it is. The grid is scaffolding that gets rebuilt every step. Each step does four things:

1. **Clear the grid.**
2. **Particles to grid.** Each particle spreads its mass, momentum and internal stress onto the 27 grid nodes around it, using a smooth B-spline weight so nothing pops as particles cross cell boundaries.
3. **Update the grid.** Turn momentum into velocity, add gravity, and stop velocity going into the walls.
4. **Grid to particles.** Each particle reads the updated velocities back from the same 27 nodes and moves.

That runs many times per rendered frame (substeps), because too few makes the simulation blow up. All four steps are compute shaders, so no physics runs on the CPU.

Each particle carries two 3×3 matrices that do most of the work.

**F, the deformation gradient**, answers "if this particle started as a perfect cube, what shape is it now?" The internal stress comes from F through a **Neo-Hookean** model, which pushes back against both shape change and volume change:

$$P = \mu(F - F^{-T}) + \lambda \ln(J) F^{-T}, \quad J = \det(F)$$

μ controls resistance to shearing (high is rubber, low is wobbly jelly), and λ controls resistance to squashing.

**C, the affine velocity gradient** (from the APIC paper), captures how the velocity is changing around the particle right now. Without it, the simulation loses rotation and everything looks like wet noodles. Of the four papers, APIC was the most useful in practice.

## The hard part: Drucker–Prager

Getting sand to work was the hardest part of the project. With elasticity alone, everything springs back to its original shape forever, so sand acts like jelly. Real sand, once you push it far enough, stays pushed. The Drucker–Prager model handles that, and it runs on every particle after F is updated:

1. **Split F with an SVD** into a rotation, three stretches, and another rotation. Yielding only depends on the stretches. GLSL doesn't have an SVD, so I wrote one with Jacobi rotations.
2. **Take the log of the stretches**, so that stretching to 2× and squashing to 0.5× count as equal and opposite.
3. **Check the friction cone.** Split the strain into a volume part and a shape part, and test whether the shape change is more than friction can hold, using the friction angle (about 0.52 radians for sand).
4. **If it's outside the cone, project F back onto the cone.** Whatever deformation doesn't fit is thrown away. The particle forgets it, and that permanent change is what makes a pile stay a pile.

For a long time, the sand would have one particle accelerate off to infinity, and that broke the whole simulation. Every particle writes into the shared grid, so one bad particle poisons the nodes around it, then their neighbours, until everything is gone. The day before I turned it in, I rewrote the SVD and added yield thresholds, and the sand finally held. Pressing `p` in the demo turns plasticity off, and switching between the two is the clearest way to see what this step does.

## The sandcastle

The sandcastle is my favourite scene, because it holds together better than any of the others. It's built from a set of boxes (towers, walls, a keep), with particles spread across them by volume. Dropping a ball on it (`?castle&ball` in the demo) knocks chunks off that stay broken.

![Sand castle collapsing under a ball impact](https://cloud.harrison-martin.com/public.php/dav/files/enykwkka9TsR8Hn/)

## Mixing materials

At first, stiffness was a single global setting, so every particle in a scene was the same material. To mix them, I stored μ and λ per particle, in padding bytes the particle struct already had for GPU alignment, so it cost no extra memory. A value of -1 means "use the global setting".

Every scene in the demo is the same simulation. Only the starting values change: where the particles are and what numbers they carry. That's also what lets a solid block sink into a liquid without merging with it. There's no collision code between them anywhere. They just have different numbers, and the shared grid handles the rest. From my notes while tuning Young's modulus (stiffness):

| stiffness (E) | what you get |
|---|---|
| 10 | liquid |
| 1,400 | holds together, but splits a bit |
| 100,000 | solid mass |

Poisson's ratio was touchier: anything from 0.01 to 0.4 works, 0.5 doesn't spawn anything, and 0.6 or above breaks the simulation instantly.

## The same program, three times

After the class, I wanted to see how different it would be to write the same complex program in different languages, so I ported it twice. The math stayed the same. The hard parts were in how each platform handles memory and atomics.

**OpenGL compute shaders (the original).** The particles-to-grid step has thousands of threads adding into the same grid nodes at once, and GLSL has no atomic add for floats. I worked around it with a compare-and-swap loop: read the value, add to it, and try to swap it in, retrying if another thread got there first. It's also strict about memory layout, so every column of a 3×3 matrix needs a padding float, and F and C are stored as `float[12]` instead of `mat3`. A later branch adds per-pass GPU timers and uses NVIDIA's native float atomics where the driver supports them.

**CUDA.** The simulation moves to CUDA kernels and rendering stays in OpenGL. CUDA has a native float `atomicAdd`, so the whole compare-and-swap loop becomes one line.

**WebGPU (live on the web).** The shaders are rewritten in WGSL, and the setup code in JavaScript. WebGPU has no float atomics either, so the grid is stored as integers, and each add reinterprets the bits as a float, adds, and swaps them back in. It runs in any browser with WebGPU and is served from a Docker container.

## Back to Houdini

Since Houdini is where I started with MPM, I added a `-bgeo` flag that writes every frame out as a Houdini `.bgeo` file, so the particles can be loaded and rendered offline.

## What's left

I wish I could use this in real sims. Right now it's a demo: scenes are built from boxes in code, and the `.bgeo` export only goes one way. To get there, these are still unchecked in my notes: wet-sand cohesion, viscosity, hardening under compression, and loading per-particle materials straight from Houdini so a scene can be set up there instead of in code.

The blog post goes through every step with the full math and code.
