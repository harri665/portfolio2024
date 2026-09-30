---
title: Neutron Star Field Simulation
tagline: I'd already rendered a neutron star's magnetic field in Houdini, and wanted to see how close to real time I could get it.
role: Solo. Class project. Data conversion, OpenCL simulation, OpenGL rendering
timeline: Dec 2025
stack:
  - C
  - OpenCL
  - OpenGL / GLUT
  - Python + OpenVDB
  - Houdini
cover: star-sim.webp
published: true
---
I had already made an [offline Houdini render](https://art.harrison-martin.com/8Bvxdn) of a neutron star's magnetic field, from NASA IXPE data released through LASP here in Boulder. For a class, I wanted to recreate it and see how close to real time I could get it: particles streaming off the star and following the field, with a camera I could fly around and settings I could change while it runs.

I built this before I'd learned anything about how GPUs actually work, which ended up being the most interesting part of the project.

![[star-sim.webp]]

## How it works

**Getting the data out of Houdini.** In Houdini, the field is stored as VDB volumes, a sparse format that's a pain to link into a C program. So a Python script converts each frame offline into a simple dense grid with a small header, and the simulation loads a frame with a single read and no extra libraries.

**Moving the particles.** An OpenCL kernel moves every particle each frame, using one of two fields:

- **Data mode** looks up which voxel of the grid the particle is in and moves it by that velocity.
- **Analytic mode** treats the star as a tilted bar magnet (a magnetic dipole) and moves the particles as charges, bent by the magnetic force:

$$\mathbf{B}(\mathbf{r}) = \frac{3(\mathbf{m}\cdot\hat{\mathbf{r}})\,\hat{\mathbf{r}} - \mathbf{m}}{r^3}, \qquad \mathbf{a} = k\,(\mathbf{v} \times \mathbf{B})$$

The analytic mode also means it runs without the data files. You can change the field strength and tilt while it's running.

Particles spawn on the star's surface, live 8 to 15 seconds, and are coloured by speed, from red (slow) to blue (fast). OpenGL draws the star, the particles, optional trails, and debug views of the field.

## It ran at 5 fps

This is from a run with the real data and 5,000 particles on an RTX 3080:

![[15be0b55fa4e7580-Screenshot_2026-04-27_193558.png]]

**5.3 fps.** The physics really is on the GPU, and the kernel is only a few operations per particle. At the time I didn't know enough about GPUs to see why it was slow. Coming back to it after learning more, the problem is everything around the kernel, every frame:

1. **Copying every particle back to the CPU.** The buffers are sized for up to 2 million particles, and every frame all of them come back to the CPU, about **88 MB per frame** just to draw 5,000.
2. **Drawing from the CPU one point at a time.** The draw loop goes through all 2 million slots, skips the dead ones, and sends each live particle to OpenGL one by one.
3. **Loading the next data frame from disk** and uploading it every rendered frame, which also ties the animation speed to the frame rate.

None of that depends on how many particles are on screen. It depends on the maximum and on the disk. The GPU finished its part and then sat waiting.

## What I'd do now

This project is where I figured out that putting the math on the GPU isn't the same as the program running on the GPU. Knowing what I know now, I'd:

- **Keep the particles on the GPU.** OpenCL can write straight into an OpenGL vertex buffer, so they get drawn in one call and never come back to the CPU.
- **Only process live particles**, so the cost follows what's on screen and not the maximum.
- **Load data frames ahead of time** on a background thread, and blend between frames so the motion is smooth.
- **Put a timer around the kernel and around the whole frame.** That would have shown the problem on day one.

The data files never made it into the repo, so the version on GitHub runs the analytic field.
