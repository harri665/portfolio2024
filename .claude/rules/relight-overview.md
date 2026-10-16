---
paths:
  - "client/src/Components/Homepage/RelightBackdrop.js"
  - "client/src/Components/Homepage/RelightStatus.js"
  - "client/src/Components/Homepage/relight/**"
  - "perf/relight-*.mjs"
---

# Relight overview

The CS homepage backdrop is a Cornell box relit live by a small MLP (a trimmed
port of Neural Render Proxies, Sancho et al. EGSR 2026, from the user's relight
project at `E:\NextCloud\Documents\relight`). It runs on WebGPU, with a WebGL2
fallback.

The relight source files have no comments, on purpose. The reasoning,
measurements, layouts and pitfalls are kept in these files:

- `relight-engines.md`: `RelightBase.js`, `RelightEngine.js` (WebGL2) and
  `RelightGPU.js` (WebGPU). Covers the network, shaders, buffer layouts, kernel
  variants, the cost model and timing.
- `relight-backdrop.md`: `RelightBackdrop.js` and the per-frame scheduling
  modules (`backdropFrame`, `backdropEngine`, `backdropStatus`,
  `lightSchedule`, `spares`, `rect`, `keyAim`, `walkIn`, `easing`,
  `presentation`, `lightWork`, `lightMotion`, `frameClock`, `copyClock`).
- `relight-loading-quality.md`: `prepare.js` (startup while the poster shows),
  `adaptiveQuality.js` (budget, DPR, tiers, networks, saved profiles),
  `scene.js`, `roomLayer.js`, `bench.js`, `status.js`, `report.js` and
  `RelightStatus.js`.

When code behaviour changes, update the matching doc in the same change. Don't
add the explanation back as code comments.

## Layers

1. `prepare.js` loads the room, builds an engine and times it before the
   backdrop mounts. `RelightBackdrop` claims the result with
   `takePreparedRelight`, or builds an engine itself.
2. The engines (`RelightGPUEngine` / `RelightEngine`, sharing `RelightBase`)
   evaluate the network for a light into a slot, resolve it into a full-res
   image per light, and composite the lights.
3. `backdropFrame.renderBackdropFrame` runs each frame. It aims and moves the key
   light, schedules evaluations within the budget from `AdaptiveQuality`,
   composites, and presents to the fixed room layer and the three.js glass copy.

## Shared helpers

`relight/util.js` holds the helpers several lanes use: `COMPACT_QUERY`,
`isCompact`, `webglRequested` (`?relight=webgl`), `ROOM_MAX_DPR` (2),
`distance`, `clamp`, `clamp01`, `throwIfAborted`, `midLight` (the mid-room light
used for benchmarking and tuning) and `fence` (a WebGL fence promise. Fence
state only changes between tasks, so it is polled through a `MessageChannel`).

The WebGPU globals (`GPUBufferUsage`, `GPUMapMode`, `GPUShaderStage`,
`GPUTextureUsage`) and `BigUint64Array` are declared in
`client/package.json` under `eslintConfig.globals`, not in `/* global */`
comments.

## Verifying changes

- Unit tests, from `client/`:
  `CI=true npx react-scripts test --watchAll=false src/Components/Homepage/relight`.
  Jest sometimes prints "A worker process has failed to exit gracefully". This
  happened before the refactor too, and the tests still pass.
- Build: `npm.cmd run build` in `client/`.
- Browser motion check, after a build: `node perf/relight-motion-check.mjs`
  with no flags for desktop WebGPU, plus `--webgl`, `--webgl --reduced`,
  `--webgl --mobile` and `--webgl --software`. It uses installed Chrome and the
  repository project-card cache. Browser emulation and a software renderer
  don't establish physical-device performance.
- `perf/relight-bench.mjs` drives `window.__relightBench` (`?relight=bench`)
  for timing and PSNR.
