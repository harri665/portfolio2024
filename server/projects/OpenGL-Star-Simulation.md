---
title: Neutron Star Field Simulation
tagline: A real-time particle visualisation of a neutron star's magnetic field, driven by NASA IXPE data from LASP, with the particle physics running on the GPU through OpenCL.
role: Solo. Data conversion, OpenCL simulation, OpenGL rendering
timeline: Dec 2025
stack:
  - C
  - OpenCL
  - OpenGL / GLUT
  - Python + OpenVDB
  - Houdini
blog: https://blog.harrison-martin.com/neutron-star-fields
cover: star-sim.webp
published: true
---
I had already turned NASA IXPE observations (via CU Boulder's LASP) into an offline Houdini render of a neutron star's magnetic field. This project makes it real-time: charged particles stream off the star and follow the field, coloured by speed, and you can orbit the camera, change the field strength and tilt, and toggle trails and field-line views while it runs.

## What I built

- **A VDB-to-binary converter** (Python, OpenVDB) that turns Houdini's sparse velocity grids into dense frames the simulation can stream without linking OpenVDB into the C program.
- **An OpenCL kernel** that advects every particle each frame, either through the sampled data grid or through an analytic tilted magnetic dipole using the Lorentz force (v × B).
- **An OpenGL renderer** with a shaded star, speed-coloured particles, optional trails and debug views of the field vectors.

## Key decisions

- **Kept the heavy data format out of the runtime.** Converting VDB offline kept the simulation dependency-free and fast to load.
- **Traced the frame rate to data movement, not the GPU.** The kernel is a few operations per particle. Reading all 2M particle slots back each frame (about 88 MB) and drawing them from the CPU held it to 5 fps. The blog post walks through the fix: OpenCL/OpenGL buffer sharing and compact particle lists.
- **Put both field models in one kernel**, sampled data or an analytic dipole, so the simulation still runs, and can be tuned, without the data frames present.

## Related

The offline Houdini version of this visualisation: [IXPE Data Visualization](https://art.harrison-martin.com/8Bvxdn).
