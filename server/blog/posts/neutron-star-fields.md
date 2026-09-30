---
title: A Neutron Star's Magnetic Field in Real Time (and Where the Frames Went)
date: '2026-09-30'
tags:
  - code
  - simulation
  - 3d
description: >-
  Turning NASA IXPE data from a Houdini render into a real-time OpenCL particle
  simulation, and why it ran at 5 fps with 5,000 particles when the GPU kernel
  was the cheap part.
cover: star-sim.webp
published: false
---

# A Neutron Star's Magnetic Field in Real Time

Before this project I made an [offline Houdini visualisation](https://art.harrison-martin.com/8Bvxdn) of a neutron star's magnetic field, from data NASA's IXPE mission released through LASP here in Boulder. Houdini turned the data into VDB volumes and rendered them offline. I wanted the same thing live: particles streaming off the star, following the field, with a camera I could fly around and knobs I could turn.

The GPU part turned out to be the easy part. This post is about the pipeline, the physics, and the more useful lesson: where the frame time actually went.

![[star-sim.webp]]

---

## Getting the data out of Houdini

The velocity field lives in Houdini as a VDB: a sparse, hierarchical volume. Linking OpenVDB into a C program that also juggles GLUT and OpenCL was more build pain than the project needed, so the conversion happens offline in Python:

1. Read each `.vdb` frame with `pyopenvdb` and find the first `Vec3S` (float vector) grid.
2. Take the active voxels' bounding box and copy the grid into a dense `float32` array.
3. Write a small header, the magic bytes `GRID`, a version, the dimensions, voxel size and world origin, followed by the raw array.

The simulation then reads a frame with a single `fread`, with no dependencies. Dense is wasteful for a sparse field, but it makes the lookup on the GPU a single index computation.

---

## Two fields, one kernel

The OpenCL kernel integrates every particle each frame, with one of two fields.

**Data mode** looks up the voxel the particle is in and uses that velocity directly:

```c
int x = (int)(local_p.x / grid_voxel_size);
int y = (int)(local_p.y / grid_voxel_size);
int z = (int)(local_p.z / grid_voxel_size);
if (in_bounds) {
    int idx = (z * (grid_dim.x * grid_dim.y) + y * grid_dim.x + x) * 3;
    v = (float3)(grid_data[idx], grid_data[idx+1], grid_data[idx+2]);
}
p.xyz += v * dt;
```

**Analytic mode** treats the star as a magnetic dipole with moment $\mathbf{m}$, tilted by an adjustable angle, whose field at position $\mathbf{r}$ is

$$\mathbf{B}(\mathbf{r}) = \frac{3(\mathbf{m}\cdot\hat{\mathbf{r}})\,\hat{\mathbf{r}} - \mathbf{m}}{r^3}$$

and moves particles as charges, with the Lorentz force bending their velocity:

$$\mathbf{a} = k\,(\mathbf{v} \times \mathbf{B}), \qquad \mathbf{v} \mathrel{+}= \mathbf{a}\,\Delta t, \qquad \mathbf{p} \mathrel{+}= \mathbf{v}\,\Delta t$$

That is semi-implicit Euler: update velocity first, then move with the new velocity, which behaves better than plain Euler for motion that curves around a field. Particles spawn on the star's surface moving tangentially, live 8–15 seconds, and die when they wander more than 20 units out (the star's radius is 2.5).

Analytic mode also makes the program runnable without the data frames, which aren't in the repo.

Colour is speed, on a blackbody-style ramp: red is slow, blue is fast.

---

## It ran at 5 fps

Here is the HUD from a run with real data, 5,000 particles active:

![[15be0b55fa4e7580-Screenshot_2026-04-27_193558.png]]

**5.3 fps.** For 5,000 particles on an RTX 3080. The kernel above is a handful of arithmetic and one memory read per particle, so the GPU should shrug at millions. It wasn't the kernel. It was everything I did around it, every frame:

1. **Read back every particle slot.** The buffers are sized for the maximum, 2 million particles, and after the kernel runs, all five arrays come back to the CPU in full: position and velocity (16 bytes each), age, lifetime, alive flag. That's 2,000,000 × 44 bytes ≈ **88 MB over PCIe per frame**, to render 5,000 particles.
2. **Draw from the CPU in immediate mode.** `draw_particles` loops over all 2 million slots, skips the dead ones, and issues a `glColor4f` and `glVertex3f` for each live one inside a `glBegin(GL_POINTS)`. The HUD's "Active Particles" count is another pass over 2 million flags.
3. **Load a new grid frame from disk.** `update_particles` reads the next VDB-derived frame with `fread` and uploads it with a blocking write, every frame. That also ties the animation's playback speed to the frame rate.
4. **Emit on the CPU**, writing each new particle into its GPU slot with five tiny writes.

Every one of those scales with the *capacity* or with the disk, not with the work. The GPU finished its part and then waited.

---

## How I'd fix it

None of this is exotic. It's the standard shape of a GPU particle system, which I skipped because the naive version worked at first:

- **Share buffers between OpenCL and OpenGL.** With `clCreateFromGLBuffer`, the kernel writes positions straight into a vertex buffer and OpenGL draws it with one `glDrawArrays`. Nothing comes back to the CPU.
- **Keep particles compact.** Dispatch over the live count, not the capacity, and emit and kill with an append/compact pass on the GPU, so the cost follows the particles on screen.
- **Stream the data frames ahead of time.** Load frame *n+1* on a background thread while frame *n* is in use, upload only when the frame changes, advance by simulated time rather than rendered frames, and interpolate between the two frames so motion is smooth.
- **Sample the field trilinearly.** Nearest-voxel lookup makes particles step at voxel boundaries. Eight reads and a lerp fix it, and a 3D image object would get the hardware to do it.

---

## What I'd do differently

**Profile before believing "the GPU is doing the work."** A single timer around the kernel and one around the whole frame would have shown the gap immediately. I had assumed that because the physics was on the GPU, the frame was too.

**Size things by what's alive, not what might be.** The 2-million-particle capacity was a knob to see how far the kernel could go. It quietly became a per-frame cost everywhere else.

**Ship the data, or a way to get it.** The VDB conversion made the simulation dependency-free, but the converted frames never made it into the repo, so the version you can clone runs the analytic field. A small sample sequence and a download script would fix that.

---

*C, OpenCL, OpenGL/GLUT, and Python with OpenVDB. [Code on GitHub](https://github.com/harri665/OpenGL-Star-Simulation). The Houdini version is on my [art page](https://art.harrison-martin.com/8Bvxdn).*
