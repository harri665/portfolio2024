# Why the CS backdrop can look lower resolution than the Relight viewer

Investigated October 15, 2026. The reported problem is low rendering resolution on phones/tablets, not input latency. The requested target remains 24 FPS with more image detail. Fixed-light precomputation has not been implemented during this investigation.

**The deployed renderer differs from this checkout**

The live CS homepage serves `main.016a3e70.js`, `scene.7fb9b4bd.chunk.js`, and `relight.d11b664c.chunk.js`. Its published source maps expose an older `RelightBackdrop` that refines into alternating output slots and can stop short of every pixel. It also copies a snapshot into a separate WebGL room layer. The current checkout has phased accumulation, full-source-resolution convergence, and direct WebGPU room presentation. Therefore, inspecting only the checkout would miss behavior that is still present on the live site.

The live viewer serves `assets/index-CB-cDGxf.js`. Its actual interface is the interactive viewer with scene/backend/resolution controls. Its deployed bundle was inspected directly; neither its title nor the separate `relight/single` component was assumed to identify its renderer. The older local `relight/web/js/main.js` has the same relevant 30 ms preview-budget and 150 ms full-refinement behavior, but the deployed bundle is the authoritative evidence for the live viewer.

Sources: [CS asset manifest](https://cs.harrison-martin.com/asset-manifest.json), [deployed CS scene source map](https://cs.harrison-martin.com/static/js/scene.7fb9b4bd.chunk.js.map), [deployed CS quality source map](https://cs.harrison-martin.com/static/js/relight.d11b664c.chunk.js.map), [deployed viewer bundle](https://relight.harrison-martin.com/assets/index-CB-cDGxf.js).

**Confirmed differences that affect image detail**

| Behavior | Live CS homepage | Live Relight viewer | Consequence |
| --- | --- | --- | --- |
| Initial source resolution | Starts compact devices at 384 unless a saved profile selects another tier; upgrades based on estimated cost and other conditions. | Native Cornell resolution was 512 in the fresh browser visit; explicit resolution selector. | The two pages can start with different numbers of source pixels. |
| Network work budget | Starts at 7 ms; adapts up to about 23.3 ms at the current 30 FPS floor, and may back off. | Preview selection uses a fixed 30 ms budget for dirty lights. | The CS page may choose a coarser moving preview on the same device. The viewer's larger budget is not a guarantee of smoother frame timing. |
| Refinement at rest | Chooses the finest stride that fits approximately 40 frames of budget; may stop at stride 2, 4, or 8. Refinement is deferred during scrolling and the refined slot is only displayed when its bands finish. | After 150 ms without a change, `sharpen()` requests stride 1 for every preview light. The full evaluation itself still takes time and can stall weak devices. | The deployed CS scene can remain coarse at rest, while the viewer eventually requests every source pixel. |
| Display scale | The room grows into a square about 1.04 times the larger viewport dimension and is cropped to the screen. | The complete square room fits within its viewport panel. | A source pixel covers more screen area in the enlarged CS background. |
| Additional rendering | Room presentation, a separate Three.js/glass path, layout/card work, and cross-context image transfers in the deployed version. | Direct viewer rendering with a 2D overlay; no portfolio glass pipeline. | More surrounding work can cause the CS quality controller to reduce its network budget. The size of this effect on the user's phone is not yet measured. |
| Saved quality policy | Stores resolution tier, model, budget, DPR/failure limit, measured costs, and kernel for up to 30 days, without an engine-version key. | Persists kernel tuning and carries editor state; does not use the CS `relight-quality` policy. | A previous low-quality choice can affect subsequent CS visits. The origins have separate storage. |

The source-image size in the readout is not the same as the density of evaluated lighting samples. For example, a 384-square source sampled at stride 4 has a 96-by-96 fresh sampling grid; upscaling it to a large canvas does not restore the missing lighting detail. On the deployed CS renderer, that stride can also be its final resting quality if the budget test rejects finer refinement.

There is also a resolution-selection mismatch in both deployed CS code and this checkout: `shownPx` uses the hero's size even after the room expands during scrolling. The allocation decision should use the room's actual projected size. This can hide demand for a higher tier; it is not proof that the next tier fits the device's memory or update budget.

**What the browser inspection established**

Both production sites were visited in fresh isolated Chrome contexts at 393 x 851 CSS pixels, DPR 2.75, with touch/mobile emulation. This was Chrome 155 on the host's RTX 3080, not an actual phone. Automated visits stubbed `/api/load`.

- The viewer selected Cornell fast (128x4), native size, and WebGPU. Its render canvas was 512 x 512, displayed at 361 x 361 CSS pixels.
- The CS page requested 384, 512, and 768 assets, and reached 768 in the recorded run. Its readout initially reported every second pixel while moving and every pixel at rest. After scrolling and settling, it reported every pixel for both. No page errors occurred.
- At this viewport the fully expanded CS room is about 885 CSS pixels across, versus the viewer's 361. At equal source resolution its samples are spread about 2.45 times farther apart. Even 768 source pixels over 885 CSS pixels have lower spatial density than 512 over 361.
- This capable GPU did not reproduce a permanent coarse resting stride. The code permits that state, but identifying whether it is active on the user's device requires that device's Image, Moving light, Resting light, Network budget, and Backend values. Do not present desktop emulation as measured phone performance.
- Glass intentionally blurs the room behind cards, and the CS scene also dims/desaturates it. Compare exposed room edges at equal display size when judging resolution, so artistic blur is not confused with the lighting sample grid.

Raw captures, extracted deployed source, screenshots, and the reset check are under ignored `perf/results/relight-investigation/`. The recorded run is `report.json`; the temporary diagnostic runner is `check.mjs`. These are local diagnostic artifacts, not shipped application code.

**Cache-reset change completed locally**

The Backdrop renderer configuration disclosure now includes **Clear cached settings**. Its explanation states that the page reloads and tunes again. It removes only `relight-quality`, preserving unrelated site data, and suppresses writes from the old renderer for the remainder of that page's lifetime. This is necessary because the renderer normally saves during pagehide and cleanup as well as periodically.

The control is available even when the renderer failed to start. If browser storage access is blocked, it explains the failure instead of claiming the settings were cleared. A successful reload permits the new renderer to save freshly measured settings normally.

Validation: two focused regression tests passed; the production build completed with existing warnings in `DistortedTorusScene.js` and `utils/api.js`. A mobile-viewport browser check verified removal before the next page boot, preservation of an unrelated preference, fresh tuning rather than saved-profile reuse, new profile saving, and the blocked-storage error state, with no page errors. The reset control is implemented locally and has not been deployed to the public site.

**Recommended next work, before fixed-light precomputation**

1. Establish which deployed renderer is under test and compare it with the current local full-refinement/direct-presentation implementation on the same physical phone. Preserve the 24 FPS preference as the optimization target; this investigation did not change scheduling.
2. Make resting quality converge to every source pixel within bounded per-update work, and show actual refinement progress so a large nominal source size cannot hide a coarse image.
3. Base tier selection on the current projected room size. Measure source tier, actual sampling stride, and glass cost together while scrolling and at rest.
4. Compare a clean profile with the previously saved profile using the reset control. Version future profiles against renderer/model changes.
5. Measure how much the glass/copy work takes from the lighting budget on physical phones, then spend any recovered capacity on finer samples or higher source resolution at 24 FPS.

Precomputing the stationary light can improve startup and upgrade transitions. It does not address an intentionally capped resting stride, insufficient source resolution for the enlarged room, or a stale quality profile, so it is not the first fix for the reported low-resolution rendering.
