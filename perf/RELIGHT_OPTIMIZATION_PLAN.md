# Relight optimization plan: 24 FPS, higher resolution and lighting detail

User target, October 15, 2026: sustain 24 FPS and spend available performance on resolution and lighting detail. Scope: the Relight engine on the CS homepage at `https://cs.harrison-martin.com/`, the production origin configured in this repository. The standalone Relight viewer and training/export project are separate; changes to their assets are identified as dependencies below.

The original plan was based on source inspection at commit `c581203` and existing local benchmark reports, not new measured improvements. A subsequent investigation compared both deployed sites and implemented the requested cached-settings reset locally. See [the rendering investigation](RELIGHT_RENDERING_INVESTIGATION.md) for findings, validation, and the important differences between the deployed CS renderer and this checkout. Physical-phone performance has not yet been benchmarked.

Latest priority: investigate low rendering resolution on phones/tablets before implementing stationary-light preparation. Confirm deployed-version parity, resting refinement, actual displayed sample density, and saved quality settings first. Input speed is not the reported issue.

Implementation update: the subsequent agent cluster implemented the existing-tier resolution fixes, 24 Hz pacing, bounded full-detail refinement, versioned settings, and stationary-fill preparation locally. See [implementation and validation](RELIGHT_IMPLEMENTATION.md) for the actual changes, measured results, and remaining device-validation work. The longer-term experiments below are not all release requirements or claimed performance gains.

**Confirmed scene wiring and change boundaries**

The CS hostname selects `CSHomePage` through `utils/siteMode.js` and `App.js`. `CSHomePage.js:239` renders `PrismBackdrop` with `lens="cs"` and `tone="page"`. `Prism.js:52` selects `backdrop="relight"`, and its lazy scene wrapper passes that selection to `DistortedTorusScene.js`. Despite that filename, the component hosts several different scenes: its Relight branch at line 182 mounts `RelightBackdrop`; the separate `DistortedTorus` component is in another branch.

Implementation must target `RelightBackdrop.js` and the modules under `relight/`. Keep the torus geometry, materials, animation, and existing non-Relight frame scheduling unchanged. Put the new lighting scheduler in a Relight-specific module and select it only for the active Relight branch; any wiring change in the shared wrapper must be conditional on that branch. Similarly, scope changes to shared glass or card-light behavior to Relight callers unless a separately validated shared fix is necessary.

Benchmark the CS root page with Relight confirmed running, including a forced-WebGL run. A fallback scene or the isolated network benchmark alone does not establish that the CS homepage improved. Include regression checks for the art torus, hub scene, and CS project-detail grid so shared integration changes do not accidentally apply the 24 FPS policy to them.

**Optimization objective**

Choose the highest useful image detail that sustains 24 new lighting updates per second during interaction. The nominal update interval is 41.67 ms. Reserve time for presentation, glass, browser work, and timing variation rather than giving the entire interval to network inference. When the lighting settles, finish refinement and reuse the completed image.

Measure three separate quantities: the room's source-image dimensions, the fraction of pixels freshly evaluated during movement, and the displayed canvas dimensions. Increasing canvas DPR alone does not create more lighting detail. Also track model fidelity: a larger image from the smaller network can still have less accurate lighting.

All devices should select an appropriate supported path. A fixed resolution and 24 FPS cannot be guaranteed on arbitrary hardware. For devices that cannot meet the target at the tested minimum quality, preserve a responsive page with a still-image fallback and report that mode accurately.

**What the current code establishes**

| Finding | Source | Implication |
| --- | --- | --- |
| The quality floor is 30 FPS, and compact devices have an explicit 30 FPS cap. Desktop is not capped by this setting. | `adaptiveQuality.js:4`, `DistortedTorusScene.js:159` | A consistent 24 FPS policy requires changes to both scheduling and adaptation. |
| The scheduler resets its last-frame timestamp after each draw. | `DistortedTorusScene.js:224` | Simply changing 30 to 24 would yield about 20 FPS at an ideal 60 Hz refresh rate with the existing 4 ms slack. |
| Source tiers are 384, 512, and 768 pixels square. | `adaptiveQuality.js:119`, `client/public/relight/` | Higher true resolution needs additional exported pixel assets, not just a larger canvas. |
| The room layer uses its own DPR, capped at 2; adaptive DPR primarily affects the Three.js canvas when that layer exists. | `RelightBackdrop.js:424` | Both resolutions must participate in the quality controller. |
| Runtime tier selection upgrades; tier downgrading is currently recorded for the next visit. | `adaptiveQuality.js:141`, `adaptiveQuality.js:157` | A device that slows down during a visit needs a live downgrade path. |
| `evalCost()` takes the minimum of stride-scaled measurements. The scheduler charges network evaluation without explicitly charging each resolve. | `RelightBase.js:119`, `RelightBackdrop.js:853` | Fixed overhead and repeated full-area resolves can exceed the predicted budget. |
| Page FPS comes from a separate animation callback loop. | `perf/lib/measure.mjs:111` | Browser callback FPS can remain high even when Relight submits fewer new images. |

Paths in the table are under `client/src/Components/Homepage/`, with engine modules in its `relight/` directory, except where otherwise specified.

Keep the optimizations already present: WebGPU with optional f16, fused network evaluation, per-device kernel tuning, WebGL2 fallback, visible-region evaluation, temporal refinement, cached fixed lights, batched GPU submission, direct WebGPU room presentation, and reduced-size glass copies. These are the starting point.

**1. Establish trustworthy measurements and correct 24 FPS pacing — first priority**

- Extend the existing performance harness rather than creating another. Record browser callback cadence, scene draws, changed lighting-image submissions, refinement passes, and asynchronous completion observations separately. Submission counts must not be described as confirmed display scanout.
- Add a Relight-specific deadline or accumulator scheduler that preserves fractional intervals, replacing the elapsed-time cap only for the active Relight branch. Apply the 24 FPS lighting policy to desktop and compact CS-homepage devices. Preserve the existing scheduler for other scenes. Coalesce input to the newest light position; do not queue catch-up renders after a stall.
- Separate lighting evaluation from page animation and presentation. Reuse the last completed lighting image between updates. Redraw presentation only when scene placement, scrolling, glass, or another visible state changes; charge this work to the budget too.
- Change controller and benchmark lateness thresholds together. At 60 Hz, 24 distinct images per second requires alternating two and three display refreshes, approximately 33 and 50 ms. Judge missed scheduled slots, not a blanket rule that every interval over 41.67 ms is late. At 120 Hz, five refreshes per image gives uniform 24 FPS. Browser animation callbacks normally follow display refresh, as documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- Capture backend, GPU/adapter when available, browser/version, commit, viewport, DPR, model, kernel, source tier, movement stride, and warm/cold profile state with every result.

Completion: synthetic timestamp checks at 60/90/120/144 Hz produce the intended average cadence without drift or catch-up bursts; a real browser run distinguishes 24 lighting updates from its faster animation callback rate.

**Prepare the stationary second light during loading — early optimization**

The CS room has one moving key light and one stationary fill light. `RelightBackdrop.js:74` marks the fill as fixed. The current `fillStep()` already evaluates it once, progressively during visible frames, and `needsWork()` stops evaluating it when complete. A new engine installation resets this state, including on resolution/model changes. Moving this work into preparation should improve startup and upgrade smoothness; it will not halve steady-state inference cost because the fixed light is already cached after convergence.

- Share the fixed fill-light definition between preparation and the backdrop. During `prepareRelight()`, evaluate and resolve its full image for the selected model and source resolution while the poster is showing. Use bounded batches and yield between them so preparation does not stall the page.
- Pass the prepared fill's image index, evaluated position, covered region, completed rows, and convergence state through the engine handoff. Update `install()` to preserve this valid image instead of resetting the fill to unevaluated. If preparation is claimed before completion, transfer the partial state and finish progressively without delaying first interaction or allowing two owners to write the same engine.
- Keep the cached contribution before exposure and tonemapping. The existing color, intensity, and intro fade can then be applied cheaply during compositing without re-evaluating the network.
- Prepare a new matching fill image when the source tier/model changes or the GPU device is recreated. Tie cache validity to scene/model version, resolution, fixed position/radius, and output representation. Reuse the original cached image whenever those inputs remain valid.
- Validate that a complete prepared fill causes no further fill inference during ordinary interaction, matches the current fully refined output, and survives handoff, interrupted preparation, tier switches, and WebGL fallback.

An optional later improvement is to export the fixed light's linear contribution as an asset per tier/model and upload it at load time. That removes client-side fill inference altogether, at the cost of additional download/storage and asset-version management. Compare transfer/decode cost against on-device preparation before choosing it.

**2. Budget the entire lighting update and adapt during the visit**

- Replace minimum-of-scaled-cost estimates with measurements for each relevant stride and region size. Prefer an actual measurement at the requested stride; use a conservative fixed-cost-plus-per-pixel estimate only where measurements are missing.
- Account for inference, each resolve, composite, presentation, and any glass transfer due that update. Measure CPU submission/layout costs separately; do not assume CPU and GPU durations simply add because they can overlap.
- Begin conservatively around 70% of the 41.67 ms interval for Relight work, then adjust using observed deadline misses and surrounding page costs. Treat this as a starting policy to validate, not a universal optimal budget.
- Sample GPU timings asynchronously and periodically. Preserve fallback timing where optional timestamp queries are unavailable; avoid changing every update into a synchronization benchmark. Timestamp queries require explicit feature support, per [MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet).
- Add live resolution/model downgrades, sustained-headroom upgrades, and cooldowns. Re-evaluate after resize, orientation changes, tab resume, or sustained slowdown. Infer thermal pressure from timing; do not assume browsers expose temperature or usable GPU memory.
- Express refinement limits and adaptation windows in milliseconds, not frame counts. Moving from 30 to 24 FPS otherwise lengthens the existing 40-frame refinement allowance from about 1.33 to 1.67 seconds.
- Version saved profiles and include backend, target cadence, model/kernel version, and relevant viewport scale. Treat saved costs as provisional and validate them after startup. Allow previous DPR failures to be reconsidered after conditions change.

Completion: the selected settings meet their measured budget during movement and scrolling, and adapt to injected workload changes without repeatedly switching tiers.

**3. Spend recovered time on actual resolution and lighting fidelity**

- Select source resolution, inference stride, model, room DPR, and glass DPR together. Use the room's current projected size, including the enlarged scrolled view, rather than only its hero size.
- First improve use of the existing 384/512/768 assets. Evaluate both 128x4 and 64x4 at comparable total update cost. Prefer the larger model when its lighting improvement is visible; select the smaller one when its extra evaluated pixels deliver a better image within the deadline.
- Add a 1024-pixel source tier only after measuring need and memory. This requires an export in the separate Relight project and packing through `perf/relight-pack.mjs`. At the same format, a 1024-square image has about 1.78 times the pixels of 768-square; account for all intermediate and cached images, including simultaneous old/new engines during a switch.
- Permit higher room DPR on capable high-density displays only when source detail and display size justify it. Avoid paying for more output pixels that merely enlarge an already coarse source. Keep glass resolution independently adjustable.
- Preserve the existing geometry-aware reconstruction and temporal history. Tune history invalidation for fast light movement and abrupt changes so more retained detail does not create trails or stale shadows.
- Prefer removing speculative precomputation and reducing expensive glass work before reducing the visible room's detail. If still over budget, compare finer sampling with the smaller model against coarser sampling with the larger model, then lower the source tier or room DPR as needed.
- Increase resolution only if measured motion detail and settling time remain acceptable. A nominal 1024 image with sparse fresh samples is not automatically better than a well-refined 768 image.

Completion: side-by-side motion and still comparisons demonstrate higher useful detail at the same 24 FPS target. All selected tiers refine to their full source resolution after movement stops.

**4. Remove measured GPU and presentation overhead**

- Prioritize resolve cost before adding more kernel variants. The WebGPU resolve currently dispatches across the covered full-resolution region even when only sparse samples change. Prototype a sparse write path for unchanged-light refinement when the entire region already has valid history; retain the full reconstruction path for movement and newly exposed pixels.
- Evaluate combining compatible refinement phases or their final resolve. Preserve sample ordering, history behavior, and raw-output lifetime; phases currently reuse a raw output slot, so they cannot simply be delayed without storage changes.
- For WebGL, measure fragment passes, framebuffer switches, and resolve overdraw. Reuse the existing output-count tuner and test bounded band sizes. Do not restore framebuffer invalidation indiscriminately: the current code documents regressions for its array-texture usage.
- Keep the direct WebGPU presentation path. For WebGL, prototype sharing the engine's context or consuming its output without repeated cross-context image transfers only if the transfer is a significant measured cost. Treat this as a larger integration change with an independently shippable fallback.
- Make the glass copy interval responsive to visible glass and image changes. The existing 50 ms interval can limit that copy to 20 Hz even when room lighting runs at 24 Hz; make any difference deliberate and measure its visual effect.
- Retain only kernels that improve whole-update results on representative GPUs. f16 and subgroup paths already exist; additional specialization needs a demonstrated gain and an image comparison.

Completion: each retained change either reduces update time at fixed quality or improves image quality at the same time budget, without a meaningful regression on another supported backend.

**5. Control CPU work, startup, and memory for sustained quality**

- Stop Relight updates when settled, invisible, or in a hidden tab; wake on input, layout changes, or outstanding refinement. Ensure any independent animation still receives updates it needs.
- Share DOM geometry reads used by Relight, card lights, and glass within a frame. Cache until layout/input changes require a refresh, while continuing to follow animated cards correctly. Reduce measured allocation hot spots in the frame loop.
- Bound speculative light-image caches by estimated bytes and measured usefulness. Suspend speculative work during interaction, upgrade preparation, or sustained deadline misses.
- Stagger shader tuning and tier preparation so they do not stall interaction. Reuse model/pixel data where possible, release abandoned resources, and cancel obsolete upgrades after resizing or navigation.
- Maintain byte estimates for buffers and textures. Check allocation failure/device limits and release resources explicitly. Browser WebGL does not provide a portable maximum-VRAM query; use a conservative allocation policy, as described in [MDN's memory guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#estimate_a_per-pixel_vram_budget).
- Move decoding or preparation to a worker only if profiling identifies main-thread stalls large enough to justify the added ownership and transfer complexity.

Completion: cold/return visits avoid repeated tuning stalls, memory stabilizes after repeated tier changes, and a 10-minute interaction run does not suffer avoidable progressive degradation.

**6. Validate on physical devices and ship in measurable steps**

| Test group | Required coverage |
| --- | --- |
| Desktop | Discrete NVIDIA/AMD graphics, integrated Intel/AMD graphics, and Apple Silicon; normal and high-density displays. |
| Mobile/tablet | Older and newer iPhone/iPad Safari; Android devices with Adreno and Mali-class GPUs, including a lower-end device. |
| Browser/backend | Chrome/Edge, Firefox, and Safari where supported; WebGPU and forced WebGL; missing optional GPU features. |
| Scene routing | CS root page confirms Relight is running; art torus, hub, and CS project-detail grid retain their own behavior and frame policy. |
| Workloads | Continuous movement, abrupt light jumps, scroll/hover, idle refinement, resizing/orientation, hidden/resumed tab, cold/return visit, context/device loss, and sustained use. |

Use existing viewport/CPU/SwiftShader profiles for repeatable regression screening. They do not replace physical phones: the mobile profile retains the host GPU, and SwiftShader is a software renderer. Existing benchmark scripts are Chromium-based, so cross-browser and real-device capture must be added or performed separately.

Proposed release gates, to calibrate against the baseline:

- During continuous interaction, approximately 24 distinct lighting updates per second over a 60-second run, with no unbounded queue growth. Target fewer than 2% missed scheduled update slots after startup; separate expected refresh cadence from workload misses.
- Report p50/p95/p99 scheduling lateness, input-to-first-changed-image latency, GPU update cost, and time to full refinement. Initial refinement goals: within 0.5 seconds on capable devices and 1.5 seconds on the lowest supported live tier after the light actually stops.
- For optimizations intended to preserve output, compare against the same model/backend reference and set numeric tolerances before implementation. For intentional model/tier changes, compare path-traced error and perceived sharpness at equal display size and equal update budget. Inspect per-light worst cases, temporal trails, and edge artifacts; an average PSNR alone is insufficient.
- Do not accept an FPS gain obtained only by lowering detail unless it is the necessary fallback for a device missing the 24 FPS target. Track the percentage of time spent at each resolution/model/stride.
- Test error recovery and unsupported-device fallback. No blank room, uncaught GPU errors, or unbounded memory growth.

Use `perf/relight-bench.mjs` for isolated network/pass and image comparisons, and `perf/run.mjs` against a production build's CS root page for actual page interaction (filter `--sites cs --match '^cs/$'`). Verify the equivalent route at `https://cs.harrison-martin.com/` when a release is deployed. Preserve baseline reports with their commit and hardware metadata. Existing reports are useful leads but are not a fresh, controlled comparison of the planned changes.

Implementation sequence following the investigation: measurement and scheduler; full-detail refinement and projected-size selection; existing-tier quality adaptation; stationary-fill preparation; measured resolve/copy optimizations; physical-device validation; optional 1024 assets if measurements justify them. Validate each step at fixed quality before spending its gains on more detail. Keep experimental paths individually disableable until the device matrix passes.
