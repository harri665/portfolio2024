---
paths:
  - "client/src/Components/Homepage/relight/prepare.js"
  - "client/src/Components/Homepage/relight/adaptiveQuality.js"
  - "client/src/Components/Homepage/relight/adaptiveQuality.test.js"
  - "client/src/Components/Homepage/relight/scene.js"
  - "client/src/Components/Homepage/relight/bench.js"
  - "client/src/Components/Homepage/relight/roomLayer.js"
  - "client/src/Components/Homepage/relight/status.js"
  - "client/src/Components/Homepage/relight/report.js"
  - "client/src/Components/Homepage/RelightStatus.js"
---

# Relight loading, quality and presentation

These files surround the relight engines (`RelightBase`, `RelightEngine`,
`RelightGPU`). They get the room ready before the backdrop mounts, choose and
adapt quality for the device, remember those choices per GPU, unpack the room
files, draw the room on a fixed canvas, publish status, and expose a benchmark
harness. The source files carry no comments; this file holds the reasoning.

## Startup preparation (`prepare.js`)

`prepareRelight` gets the relit room ready while the CS page still shows the
poster. It requests the WebGPU device, fetches the room, builds the engine, and
times the network on this GPU, so the backdrop starts close to where it would
have settled anyway. It does not need three.js, and it yields to the page
between steps. `Prism.js` starts it and calls `cancelPreparedRelight` on
unmount; the backdrop (`RelightBackdrop.js` and its `relight/backdrop*.js`
modules, currently `backdropEngine.js`) calls `takePreparedRelight`.

Flow of `run`:

1. `probeGpu` makes its own throwaway WebGL context to read the GPU name,
   because three.js has not created a context yet. The context is released
   with `WEBGL_lose_context`.
2. The saved profile is loaded for that GPU, `MIN_FPS`, and the backend
   (`webgl` when `?relight=webgl` is set or `navigator.gpu` is missing,
   otherwise `webgpu`).
3. Unless WebGL was requested, the WebGPU device request starts immediately.
4. `loadRoomOrNative` fetches the room at `firstTier` / `firstNetwork` with
   `'low'` fetch priority. If that fails for any reason other than an abort,
   it falls back once to the native 512 px room of the default network
   (`NATIVE`, `NETWORKS[0]`). If the first attempt was already that room, the
   error propagates.
5. `createRelightEngine` builds a WebGPU engine when a device exists, and falls
   back to WebGL (recording the reason in `notGPU`) if WebGPU cannot build the
   network. An abort during a WebGPU build is rethrown, not treated as a
   fallback.
6. The saved kernel is reused only when `tunedKernel` matches the network and
   backend, and `engine.tuned` is set only when the engine actually picked
   that kernel. Saved per-stride costs seed the engine (`seedCosts`).
7. `timeAndTune` benchmarks (see below) and then auto-tunes the kernel.
8. `prepareFill` starts the stationary fill light.
9. `upgradeUntilClaimed` keeps moving to a better room while nobody has
   claimed the preparation.

Room files live at `${PUBLIC_URL}/relight/cornell-<network>/` and are produced
by `perf/relight-pack.mjs`. `tierSuffix` maps a tier to its file suffix: the
native 512 px tier has none, other tiers use `-<size>` (for example `-768`).

### Claiming and ownership

- Module state: `preparing` is the in-flight preparation and `handedOff`
  records that the backdrop has already taken one. `handedOff` exists so a late
  import of `prepare.js` does not build a second network.
  `cancelPreparedRelight` clears it again. `prepareRelight` also does nothing
  when the browser has data saver on (`navigator.connection.saveData`).
- `takePreparedRelight` marks the preparation `claimed`, resolves the `claim`
  promise and returns the result promise (or `null` if nothing was prepared).
- `cancelPreparedRelight` aborts the preparation and any upgrade fetch. If the
  preparation has already settled it disposes the engine and destroys the
  device immediately; otherwise the abort makes `run` reject, and the rejection
  handler in `prepareRelight` disposes it. `disposePrepared` is idempotent.
- A non-abort failure resolves the result as `{ error }` instead of rejecting.
- The resolved result has `engine`, `notGPU`, `device` (the device promise),
  `tier`, `network`, `timed`, `fill`, `upgrade` and `upgradeFailed`.
  The backdrop depends on these field names.
- Only this async owner writes to the engine until the result promise hands it
  to the backdrop's `install()` (`backdropEngine.js`). Every wait races the `claim` promise, so a
  claim takes effect without waiting for the next animation frame and a hidden
  tab cannot hold startup hostage to an rAF. `yieldPreparation` resolves on the
  next animation frame, an abort, or the claim, whichever comes first.
- A partially prepared fill (bands plus their image) travels with the result,
  and the visible renderer resumes it rather than starting over.

### Upgrades during preparation

`nextUpgrade` asks first whether to switch network (`switchNetwork`) at the
current tier, then whether a larger tier is affordable (`upgradeTier`) for
the room's displayed size (`shownRoomPx`). Upgrades only start when the first
benchmark produced real timings (`result.timed`). Each loop iteration:

- Starts loading the next room with its own `AbortController` (stored as
  `prep.upgradeController` so a cancel can abort it) and races the download
  against the claim.
- If the backdrop claims first, the pending download is handed over as
  `result.upgrade = { tier, network, controller, data }` and the backdrop
  finishes it.
- Otherwise the larger engine is built on the same backend. A tuned kernel is
  carried over only if the network did not change. Its costs are seeded from
  the current engine's measured costs, the old engine is disposed and the
  result is updated.
- A build failure logs a warning, sets `upgradeFailed`, and keeps the current
  room.
- The new room is benchmarked, tuned and filled again. The next step is
  considered only if that benchmark timed. `result.timed` keeps the value from
  the first benchmark.

### Memory budgets

- `BAND_BYTES`: 32 MB bands are about 20% faster than 8 MB ones, but phones do
  not have the memory, so compact devices use 16 MB. `bandBytesFor(compact)`
  selects one.
- Spare images (`SPARE_IMAGE_BYTES`) are full-resolution images kept for where
  the key light is likely to go next. Each costs about 12 bytes a pixel
  (`BYTES_PER_IMAGE_PIXEL`): about 3 MB at 512 px and 7 MB at 768 px.
  `imageCount` gives the engine `RESOLVED` images plus as many spares as fit
  in 8 MB (compact) or 32 MB (full), at most `MAX_SPARES` (6).

### Benchmark during preparation

- `BENCH_MAX_MS` (30 ms) is the most one evaluation may cost while the page is
  showing and might be scrolling. `finestBenchStride` picks the finest of
  strides 1, 2 and 4 (`BENCH_STRIDES`) whose cost fits, otherwise
  `COARSE_STRIDE` (8). The coarse stride is also used when nothing is measured
  yet or the costs are only seeded.
- `benchmark` evaluates the mid-room light at that stride until it has
  `BENCH_RUNS` (3) fresh timing samples at the same stride, restarting the
  count whenever the chosen stride changes, for at most `BENCH_ATTEMPTS` (16)
  evaluations. `awaitTiming` waits frame by frame until the engine's timing
  query lands. The benchmark returns true only with real (unseeded) costs and
  no claim.
- Benchmarking never goes coarser than stride 8. A whole light at every 16th
  pixel is so few pixels that per-pass overhead dominates: an AMD 860M read
  330 ms for a light that really takes 47 ms and got stuck at every 16th pixel.
- `benchStride` is used by the running backdrop to request one more timing
  sample. It returns `null` when nothing is known, the finest affordable
  stride when it is finer than anything measured, and otherwise `null`. When
  the engine's costs are only seeded, it always returns the finest affordable
  stride: cropped or banded refinement can finish without a large enough
  timing sample, so a transferred profile must be validated on this engine
  before it can block adaptation forever. The caller only runs this at rest
  and caps the attempts (`BENCH_TRIES`, 6, in `backdropFrame.js`).

### Kernel tuning

- `tuneEngine` auto-tunes the kernel once per engine using the mid-room light
  (`midLight` in `util.js`) at the finest affordable stride. It runs enough
  passes to take about `TUNE_MS` (24 ms), clamped to 2 to 8 runs
  (`TUNE_RUNS`). An aborted tune leaves `engine.tuned` false.
- Tuning on an RTX 3080 made the network about 15% faster on WebGPU and 2x
  faster on WebGL.

### Fill preparation

`prepareFill` creates the fill (`createFill`) and steps it with `fillStep`,
each step bracketed by `beginFrame`/`endFrame`, spending at most
`FILL_STEP_MAX_MS` (8 ms) or the budget if smaller. It stops when the fill is
complete, the step spent nothing, the preparation is claimed or aborted, or
`maxMs` has elapsed. It yields between steps and polls timing afterwards. An
abort rejects with `AbortError`. The fill is also stored on `built.fill`.

### Displayed room size

`shownRoomPx` estimates the room's on-screen size in device pixels: under
640 px wide, `min(vw * 1.2, vh * 0.6)`, otherwise `min(vw * 0.9, vh * 0.86)`,
times the device pixel ratio capped at `ROOM_MAX_DPR` (2).

## Adaptive quality (`adaptiveQuality.js`)

`AdaptiveQuality` tunes the backdrop to the device: the network budget, the
canvas DPR and the image size (tier). It spends spare time on detail while the
page delivers `MIN_FPS` (24) lighting updates a second.

### Late updates

- Without scheduler metadata, an update is late when the delta exceeds
  `1000 / minFps + DELIVERY_SLACK_MS`, where the slack is one 60 Hz refresh
  plus `TIMER_SLACK_MS` (2 ms). Alternating 33/50 ms delivery is the expected
  24 Hz cadence and must not count as late.
- With schedule metadata (`missedSlots`), an update is late when a slot was
  missed, or when `latenessMs` exceeds one refresh (`refreshMs`) plus 2 ms.
  This catches sub-slot overload.
- Samples are ignored, and the tier dwell timers reset, when the delta is not
  positive, exceeds `MAX_GAP_S` (0.25 s, a hidden tab or a stall), the caller
  passes `hold`, or the schedule says `resumed`.
- An update counts as a work frame when `worked()` was called within the last
  `WORK_FRAMES` (2) frames. Separate smoothed late rates are kept for work and
  idle frames (`lateRate.work`, `lateRate.idle`, smoothing `RATE_ALPHA` 0.05),
  updated only when `settled`. Work is blamed for lateness only when the work
  rate exceeds the idle rate by `BLAME` (0.03).
- Callers keep `settled` false while loading. Shader compiles made frames late,
  and on first visits the intro light used to drop the budget to the floor.
- `stats` counts frames, seconds and late frames.

### Budget control loop

The budget is the milliseconds of network work allowed per update.

- Maximum: `BUDGET_SHARE` (70%) of an update interval, which reserves 30% for
  the rest of the page (about 29 ms at 24 Hz). Minimum `BUDGET_MIN` (1 ms).
- On a blamed late work frame, the ceiling is set to `CEILING_SHARE` (90%) of
  the budget that failed and the budget is multiplied by `BACK_OFF` (0.75).
- On an on-time work frame, the ceiling creeps up by `CREEP` (x1.0005) and the
  budget grows by `GROW` (x1.02) up to the ceiling.
- This settles just under what the GPU can take instead of missing a frame
  every second.
- `firstBudget` starts at `START_BUDGET` (7 ms for compact and full; phones
  used to start lower when the target was 60 Hz). A saved budget is only a
  starting hint: it is clamped between the start budget and the maximum, so a
  previous low budget is re-measured live instead of starting permanently at
  its old failure floor.

### DPR adaptation

`judgeDpr` runs only on settled frames, and on work frames only while the DPR
is above its minimum (so DPR never climbs while lighting work is active, but
can step down). It accumulates elapsed milliseconds, not callback counts, over
a `DPR_WINDOW_MS` (3 s) window:

- Late share above `DPR_DROP` (20%): step down by `DPR_STEP` (0.25) and record
  the failed DPR.
- Below `DPR_KEEP` (2%) on idle frames for `DPR_GOOD_WINDOWS` (2) windows in a
  row: step up by 0.25, but never to or past a DPR that failed during this
  visit.
- After a change, `DPR_SETTLE_MS` (500 ms) is ignored before measuring again.
- A failed DPR is avoided only for this visit. `profileFor` saves
  `failedDpr: null` because a thermal or transient failure should not forbid a
  future visit from retrying.

### Tiers

`TIERS` are 384, 512 and 768 px.

- `firstTier` uses the saved tier, otherwise 384 on compact devices or slow
  connections and 512 elsewhere. The largest tier is only ever reached by
  timing the GPU.
- `upgradeTier` (used during preparation and by `nextTier`) allows the next
  tier when costs are measured (not seeded), the connection is not slow, the
  room is displayed larger than the current tier, and the projected full-image
  cost (`cost * (next / W)^2`) fits in `budget * UPGRADE_UPDATES` (12 updates,
  `UPGRADE_MS` 500 ms at 24 Hz). The 768 tier needs about 100 MB while it is
  prepared, so it is refused when `navigator.deviceMemory` is below
  `LARGEST_TIER_MIN_MEMORY_GB` (4).
- `slowConnection` is data saver or a 2g/3g `effectiveType`.
- `nextTier` is called with real elapsed milliseconds, usually once a second,
  and only decides on measured costs. Rebuilding a tier is expensive, so it
  never bounces between adjacent sizes:
  - Downgrade when the tier is too slow (full-image cost above
    `budget * REFINE_UPDATES * DOWNGRADE_COST_MARGIN`, i.e. 1.25x the
    refinement goal) or under pressure (work late rate above
    `PRESSURED_LATE_RATE` 0.2 and blamed on work), sustained for `TIER_DOWN_MS`
    (3 s).
  - Upgrade when `upgradeTier` allows it with no slowness or pressure,
    sustained for `TIER_UP_MS` (6 s).
  - After any change, wait `TIER_COOLDOWN_MS` (15 s).
  - The dwell timers reset when the engine's size, network or backend changes,
    and when `frame` ignores a sample.

### Networks

`NETWORKS` are `128x4` (default) and `64x4`. The small network is about 3.3x
faster (`SMALL_SPEEDUP`) but about 2 dB worse against path-traced references
(measured with `perf/relight-bench.mjs`).

- `REFINE_MS` (1500 ms) is the refinement goal: a resting light's full image
  should settle within it. `REFINE_UPDATES` is that many updates (36 at
  24 Hz).
- `switchNetwork` keeps the larger model while its full image fits in
  `budget * REFINE_UPDATES`. A sparse preview must not hide a slow resting
  image.
- It switches back to the larger model only when the larger model's projected
  cost fits in half the goal (`RECLAIM_SHARE` 0.5), i.e. with twice the
  required headroom. This hysteresis stops a GPU near the line from flipping
  back and forth.
- `firstNetwork` uses the saved network when it is still a known one.
- `tunedKernel` returns the saved kernel only for the same network and, when a
  backend is given, the same backend.

## Saved per-GPU profiles

Stored in `localStorage` under `STORAGE_KEY` (`relight-quality`).

- Format (`profileFor` plus `saveProfile`): `gpu`, `fps`, `version`
  (`PROFILE_VERSION`, 2), `engineVersion` (`ENGINE_VERSION`,
  `relight-24-full-refinement-v1`), `viewport`, `res`, `network`, `backend`,
  `byStride` (measured ms per stride), `budget`, `dpr`, `failedDpr` (always
  `null`), `tier`, `kernel` (only if tuned) and `at` (save time).
- `profileFor` returns `null` until there are real measurements. First
  measurements include shader compiles, so the engine drops them, and seeded
  (provisional) costs are never saved.
- `loadProfile` rejects a profile whose version, engine version, GPU name,
  update rate, backend (when given) or viewport bucket differs, or which is
  older than `MAX_AGE` (30 days) or dated in the future.
- `viewportScale` buckets CSS width and height to `VIEWPORT_BUCKET_PX`
  (200 px) and the DPR to halves. A rotation or a substantially different
  display needs a new quality decision, while mobile toolbar changes do not
  invalidate the profile.
- `gpuName`: Chrome and Safari report "WebKit WebGL" unless asked for the
  unmasked renderer, and Firefox warns when asked, so the unmasked name is
  requested only when the plain name starts with "webkit".
- `seedCosts` seeds only from costs measured with the same network and
  backend (WebGPU is about 5x faster than WebGL). Costs are scaled by the area
  ratio when the saved resolution was smaller (never scaled down), then
  multiplied by `SEEDED_COST_MARGIN` (1.15) because the saved timing query
  omits some presentation and resolve work and is only a hint.
- `localStorage` can throw (private windows and so on). Loading then returns
  `null`, saving silently does nothing, and defaults are used.
- `clearProfile` (the "Clear cached settings" button) removes the key and sets
  `profileCleared`, which blocks loading and saving for the rest of the page.
  The button reloads the page, and the old renderer saves periodically, on
  `pagehide` and during effect cleanup; without the flag those saves would
  restore the profile just cleared. A fresh page load saves normally. If the
  removal throws, `clearProfile` returns false and normal saving continues.

## Scene unpacking (`scene.js`)

`loadRelightScene(base, signal, suffix, priority)` loads a room packed by
`perf/relight-pack.mjs`.

- Files: `scene<suffix>.json`, the shared `model.bin`, and
  `pixels<suffix>.bin` (or `scene.pixels.file`, which lets the 64x4 room share
  the 128x4 pixels, e.g. `../cornell-128x4/pixels.bin`). The suffix picks
  another size of the same network (`'-768'`); `model.bin` is shared by all
  sizes.
- The scene must have `pixels.format === 2` (otherwise it needs packing), no
  `network.light_grid`, and float16 grids.
- The packer quantises positions to u16 because f32 positions plus distance
  were most of the download. Each channel is stored as row deltas, low bytes
  then high bytes, so gzip actually compresses it. `unpackDeltaPlanes` undoes
  this.
- Positions are u16 over `scene.pixels.pos.range` (`[-1, 1]`), starting at 1;
  0 means the pixel sees nothing.
- Aux has 7 channels laid out as two RGBA planes (channels 0 to 3, then 4 to
  6) in a `Uint16Array(NP * 8)` (`auxTexel`). Positions use one RGBA plane
  (`posTexel`).
- Halves stay 16-bit. Widening them to f32 here used to block the page for a
  few hundred milliseconds on phones. Only layer weights and biases are
  widened to `Float32Array` (`toFloat32`, via `halfToFloat`).
- Unpacking yields to the page with a zero-delay timeout once more than
  `YIELD_EVERY_MS` (6 ms) has passed, checking every 32 rows, and checks the
  abort signal after each yield.

## Fixed room layer (`roomLayer.js`)

The room is drawn on its own fixed canvas behind the page. Inside the three.js
canvas it rode up with every scroll and snapped back (the browser scrolls on
its own thread), so the three.js canvas now only draws the glass.

- `layerCanvas` is fixed, full width, ignores pointer events and is hidden from
  assistive tech. Its height is `100lvh` (with `100vh` as the fallback) so it
  does not resize when the phone toolbar collapses.
- `ROOM_FRAGMENT` (also used by the three.js fallback material in
  `RelightBackdrop.js`) upsamples with Catmull-Rom using 5 bilinear taps,
  because the image is shown several times larger on phones. The result is
  clamped to the 4 nearest pixels so the light's disc does not ring dark. It
  then applies the rounded-box mask, desaturation and dimming (with highlights
  kept by `hotKeep`), the glow around the focused card, and 1/255 dither.
  Its uniform names are the contract with the backdrop: `tRelight`, `texSize`,
  `dpr`, `viewport`, `box`, `ready`, `dim`, `saturation`, `hotKeep`, `sharp`,
  `glowAt`, `glowColor`.
- `UNIFORMS` lists the packed uniforms in order. `gather` packs them into a
  float array; `texSize` is first and is overwritten with the real texture
  size. The fixed layers always sample sharply (`sharp` 1 for `RoomLayer`, and
  the WGSL always uses `sharpSample`).
- `FixedLayer` is the shared base: it owns the canvas, sizes it (`fit`), and
  `needsDraw` skips drawing when nothing changed (the canvas keeps its last
  frame).
- `RoomLayer` is the WebGL layer. It uploads each image (`setImage`) into its
  own context. Rows already come bottom first, so `UNPACK_FLIP_Y_WEBGL` is
  false.
- `GPURoomLayer` draws on a WebGPU canvas on the engine's own device, straight
  from the engine's image, in the same submit as the composite (`draw` goes
  into the engine's frame via `engine.encoder()` / `engine.commit()`). The
  WebGL layer has to take an ImageBitmap into another context every frame,
  which took longer than the network itself at the strides phones run.
  - `ROOM_WGSL` is `ROOM_FRAGMENT` translated to WGSL. Its uniform buffer is
    the `UNIFORMS` order followed by the canvas height (`GPU_FLOATS`, 20 floats,
    80 bytes); the canvas height reconstructs `gl_FragCoord`, whose rows run
    bottom up.
  - `use(engine)` rebinds when an upgrade brings a new engine on the same
    device. `draw` does nothing once its engine's image has gone (the engine
    was disposed).
  - `currentTexture` reconfigures the context and retries once if
    `getCurrentTexture` throws.
  - The backdrop (`presentation.js`) tells the layers apart by
    `layer.device`, which only `GPURoomLayer` has.

## Status and reports

- `status.js`: the backdrop lives inside the three.js canvas, so it publishes
  its state with `setRelightStatus` and the page subscribes with
  `useRelightStatus` (`useSyncExternalStore`). Updates whose JSON is unchanged
  are dropped.
- `report.js`: `reportRelight` sends a `relight` report with device info
  (cores, memory, screen size and DPR). The visit id is a parameter because a
  report can be sent after the next page view has started.

## Status panel (`RelightStatus.js`)

- The "What your browser supports" section probes only once it is opened,
  because probing creates a WebGPU adapter and a WebGL context.
- Kernel names (`describeKernel`): WebGPU kernels are
  `<threads>x<pixels>[c<channel groups>]`, shown as threads per workgroup and
  pixels each, with 4 channels per channel group. WebGL kernels are
  `o<outputs per pass>`, shown as output groups a pass. Anything after `, ` in
  the name is a note shown in parentheses. Unknown names are shown as-is.

## Benchmark harness (`bench.js`)

Loaded only with `?relight=bench` (by `Prism.js`), never on a normal visit.
`installBench` exposes `window.__relightBench` with `open`, `time`, `frame`,
`render`, `accumulate`, `tune` and `close`, used by `perf/relight-bench.mjs`.
Their option names and return fields are a contract with that script.

- `open({ tier = 512, backend = 'webgpu', network, kernel = null, bandBytes })`
  builds an engine (32 MB bands by default) and warms it up with one
  stride-8 evaluation so shader compiles are not timed. Returns `backend`,
  `notGPU`, `size`, `half`, `network` and `kernel`.
- `time({ stride = 1, n = 8, batches = 3, light })` times `n` evaluations per
  batch between GPU idles and returns the median per-evaluation `ms`, all
  `runs`, and `items` (rows times columns at that stride).
- `render({ lights, stride = 1, exposure = 1, rect = [] })` evaluates and
  composites the lights and returns the image as base64 RGBA (`readImage`).
- `accumulate({ from, to, frames = 16, stride = 8, trust = 0.06, accumulate = true, exposure = 1 })`
  moves a light from `from` to `to` over `frames` frames the way the backdrop
  does: each frame uses a different phase, folded in by how far the light
  moved (`alpha = 1 - exp(-moved / trust)`). It is scored as PSNR against a
  full evaluation at `to`. With `accumulate: false`, each frame is one
  evaluation at phase 0, which is how the backdrop used to look.
- `frame({ stride = 4, n = 4, batches = 3, light, view })` times a moving-light
  frame one stage at a time:
  - `evaluate` is the network, `resolve` folds it into the light's image,
    `composite` builds the view, and `oneSubmit` runs those three in one submit
    like a backdrop frame.
  - `snapshot` takes the image off the canvas, `upload` is the other WebGL
    context taking it in, and `present` is their sum. Both are timed with a
    composite in front (they need a new image), and the composite is
    subtracted afterwards.
  - On WebGPU, presentation works differently: `glass` is the half-size copy
    three.js takes for the glass (at most one every 50 ms in the backdrop, not
    every frame), and `room` is `GPURoomLayer` drawing from the engine's image
    on its own device. `direct` totals that path with a glass copy every frame;
    `total` is the WebGL-style path.
  - The view defaults to the walked-in box on this screen like the backdrop
    (`walkedIn`: the box is the larger viewport side times 1.04, centred, with
    a 0.03 view margin); `null` means the whole image.
  - Waiting on the GPU has a fixed latency (tens of milliseconds for the other
    context's fence, and noisy on WebGL). Each stage therefore runs in batches
    of at least `FRAME_BATCH_MS` (100 ms) or 10x an empty batch, doubling the
    run count up to `MAX_FRAME_RUNS` (256), and the empty-batch latency is
    subtracted.
- `tune({ stride = 1, runs = 4 })` runs the engine's kernel auto-tune.
- `close()` disposes the engine and the bench room layer.
- The WebGL presenter stands in for the WebGL room layer, which takes each
  image into its own context. It uses a page canvas like the room layer's,
  because an offscreen canvas takes a different path in Chrome.
- The bench room layer is a real `GPURoomLayer` drawn on the page like the
  backdrop's, at this page's size and DPR.
- WebGL fences only change between tasks, so `fence` in `util.js` polls across
  tasks with a `MessageChannel`.

## Tests (`adaptiveQuality.test.js`)

The tests cover: clearing settings surviving the old renderer's saves during
reload; failed removal; the 70% budget share; 33/50 ms delivery not being late
(with and without metadata); missed slots versus suspended or warm-up samples;
sub-slot lateness; DPR adapting over elapsed time (floating-point accumulation
can leave the 3 s boundary one callback short, hence two extra frames); tier
dwell, cooldown and downgrade rules; profile invalidation; reconsidering saved
low budgets and DPR failures; kernel specificity; model selection with twice
the headroom to reclaim the large model; and DPR not climbing during active
work.
