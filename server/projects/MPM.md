---
title: MPM Material Simulator
tagline: A GPU Material Point Method solver in which sand, jelly, rubber and liquid share one set of shaders. Written from four SIGGRAPH papers, then ported to CUDA and to WebGPU so it runs in the browser.
role: Solo. Class project for Advanced Computer Graphics (CSCI 4239), extended afterwards
timeline: Mar – May 2026 · ~100 hours
stack:
  - OpenGL 4.3 compute
  - GLSL
  - C
  - CUDA
  - WebGPU
live: https://mpm.harrison-martin.com/?castle&res=1
blog: https://blog.harrison-martin.com/mpm
cover: https://cloud.harrison-martin.com/public.php/dav/files/enykwkka9TsR8Hn/
video: https://cloud.harrison-martin.com/public.php/dav/files/cjFjnaC2TFWfp38/
published: true
---
The Material Point Method is what film studios use for snow, sand and mud. I built one from scratch that runs entirely on the GPU: **16K particles at about 180 fps, or 131K at about 35 fps, in a browser on an RTX 3080.** The same solver produces sand that piles and stays piled, jelly that wobbles back into shape, and a liquid that a solid block sinks into without merging. The only difference between them is two numbers stored on each particle.

## What I built

- **The full MPM loop in compute shaders:** clear the grid, scatter particles to the grid, update the grid, gather back to the particles, every substep. No physics runs on the CPU per frame.
- **APIC transfers** to conserve angular momentum, **Neo-Hookean elasticity**, and **Drucker–Prager plasticity** with return mapping in log-strain space, so sand yields and stays deformed.
- **Per-particle material parameters**, packed into the padding bytes of the particle struct, so any number of materials can share one simulation for free.
- **Three backends:** OpenGL (the original), a CUDA port, and a WebGPU port that is live on the web. It also exports Houdini `.bgeo` files for rendering offline.

## Key decisions

- **Implemented float atomics as a compare-and-swap loop**, because GLSL has no native float `atomicAdd`. A later optimization branch adds per-pass GPU timer queries and uses native float atomics (`GL_NV_shader_atomic_float`) in the scatter step where the driver supports them.
- **Kept one solver and varied only the material numbers**, rather than special-casing each material. Solid–liquid separation comes out of the shared grid, with no collision code at all.

## Outcome

Thirteen preset scenes, runtime controls for substeps, plasticity and velocity colouring, and a browser version anyone can open. The blog post walks through the math step by step.
