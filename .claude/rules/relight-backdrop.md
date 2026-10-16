---
paths:
  - "client/src/Components/Homepage/RelightBackdrop.js"
  - "client/src/Components/Homepage/relight/lightWork.js"
  - "client/src/Components/Homepage/relight/lightMotion.js"
  - "client/src/Components/Homepage/relight/frameClock.js"
  - "client/src/Components/Homepage/relight/copyClock.js"
  - "client/src/Components/Homepage/relight/backdropEngine.js"
  - "client/src/Components/Homepage/relight/backdropFrame.js"
  - "client/src/Components/Homepage/relight/backdropStatus.js"
  - "client/src/Components/Homepage/relight/lightSchedule.js"
  - "client/src/Components/Homepage/relight/spares.js"
  - "client/src/Components/Homepage/relight/rect.js"
  - "client/src/Components/Homepage/relight/keyAim.js"
  - "client/src/Components/Homepage/relight/walkIn.js"
  - "client/src/Components/Homepage/relight/easing.js"
  - "client/src/Components/Homepage/relight/presentation.js"
  - "client/src/Components/Homepage/relight/lightWork.test.js"
  - "client/src/Components/Homepage/relight/lightMotion.test.js"
  - "client/src/Components/Homepage/relight/frameClock.test.js"
  - "client/src/Components/Homepage/relight/lightSchedule.test.js"
---

# Relight backdrop

The CS homepage backdrop is a Cornell box lit live by a small MLP trained on
path-traced global illumination (the network, scene data and engines live in
`relight/`; the training project is outside this repo). WebGPU is about 5x
faster than WebGL2. Add `?relight=webgl` to the URL to compare; the status then
reports `notGPU` as "the page was asked for WebGL (?relight=webgl)".

These source files carry no comments. This file is where the reasoning lives.
Keep it current when behaviour changes.

## Module map

- `RelightBackdrop.js`: the react-three-fiber component. It owns the hooks only:
  creates state (`createBackdropState`) and uniforms (`createUniforms`), wires
  `pagehide` saving, device release, the fixed `RoomLayer`, engine start/stop,
  pointer tracking, and calls `renderBackdropFrame` from `useFrame`. Public
  surface: default export with props `onProgress`, `onFail`, `onDpr`,
  `frameInfo`. `onFail` and `onDpr` are read through the `callbacks` ref so the
  mount-only and `[renderer, uniforms, webgl]` effects keep their original
  timing without stale-closure lint suppressions.
- `relight/backdropEngine.js`: state construction, device acquisition
  (`deviceFor`, `releaseDevice`), first engine start (`startRelight`, with
  `buildFresh` and `adoptPrepared`), teardown (`stopRelight`), background
  upgrades (`startUpgrade`), and `install` of a built engine. `failRelight`
  reports and calls `onFail` unless the error is an `AbortError`.
- `relight/backdropFrame.js`: the per-frame pipeline (`renderBackdropFrame`) as
  named phases. See "Frame pipeline order".
- `relight/backdropStatus.js`: `statusOf`, `publishStatus`, `reportRun`,
  `saveState`.
- `relight/lightSchedule.js`: per-light state and evaluation (`makeLight`,
  `forgetImage`, `movedSince`, `converged`, `atRest`, `needsWork`, `stepLight`,
  `shownLight`, `MOVE_EPS`).
- `relight/spares.js`: spare images evaluated ahead (`createSpares`,
  `adoptSpare`, `takeSpare`, `releaseSpare`, `retargetSpare`,
  `precomputeSpare`, `aimSpares`, `likelyTargets`, `TARGETS_EVERY`).
- `relight/rect.js`: image-uv rectangles (`visibleRect`, `grow`, `covers`,
  `sameRect`, `areaOf`, `VIEW_MARGIN`, `VIEW_GROW`). `readyHandoff` in
  `lightMotion.js` uses `covers` from here.
- `relight/keyAim.js`: key-light constants and room geometry (`KEY`, `REST`,
  `INTRO_FROM`, `POINTER_DEPTH`, `CARD_DEPTH`, `atDepth`, `keepInRoom`).
- `relight/walkIn.js`: scroll walk-in and hero placement (`walkInProgress`,
  `heroPlacement`, `coverSize`, selectors, `NAV_CLEAR`, `START`, `END_TOP`).
- `relight/easing.js`: `strikeLevel` (key-light intro flicker),
  `easeOutCubic`, `easeInOutCubic`.
- `relight/presentation.js`: `withTexture`, `buildEngine`, `fitLayer`,
  `syncGlassScene`, `drawRoom`, `ROOM_VERTEX`.
- `relight/lightWork.js`: fill light and row evaluation shared with
  `prepare.js` (`FILL`, `WHOLE`, `REST_DELAY`, `UNEVALUATED`, `previewStride`,
  `itemRect`, `evaluateRows`, `fillStep`, `createFill`, `fillMatches`,
  `refinementProgress`).
- `relight/lightMotion.js`: `dampedPosition`, `imageBlend`, `readyHandoff`,
  `TRUST_DISTANCE`, `MAX_EVAL_MOVE`, `HANDOFF_DISTANCE`.
- `relight/frameClock.js`: `RelightFrameClock`, used by
  `DistortedTorusScene.js` to run the relight scene at 24 Hz.
- `relight/copyClock.js`: `advanceCopyClock`, the glass-copy cadence.

## Scene geometry

The box spans -1..1 on every axis. The camera sits at z = 3.9 looking down -z.

- `POINTER_DEPTH` (0.15) and `CARD_DEPTH` (-0.45) are the depths at which a
  pointer position or a focused card's centre is unprojected (`atDepth`).
- `REST` is where the key light sits with nothing to follow. `INTRO_FROM` is
  where it starts; for the first 1.4 s (with no pointer and no card) it eases
  from `INTRO_FROM` to `REST` with `easeInOutCubic` over age 0.35 to 1.4 s
  (`introAim` in `backdropFrame.js`).
- `KEY` is the key light: radius 0.1, warm colour, intensity 26.
- `keepInRoom` first clamps the light inside the box with a margin of
  radius + 0.03 (`WALL_MARGIN`) on every wall except the open front (z max).
  Then it projects the light and pulls it toward the camera so it stays at least
  radius * 1.5 + 0.03 in front of the nearest surface seen at its centre and at
  four points one projected radius away. The surface distance is measured where
  the light currently is. Pulling it forward first, then measuring, made it flip
  between two edges. The pull is skipped when the limit would be 0.5 or less.
- The aim is not held back at rest. That was tried: it crept across the image
  behind deep cards and shook when held off a surface.

## Walk-in and layout

- `walkInProgress` maps scroll to 0..1 between `START` (0.03 viewport heights)
  and the panel top minus `END_TOP` (0.14 viewport heights), at least 0.2
  viewport heights after start, capped at the maximum scroll. Short galleries
  might not scroll far enough, so if the range is under 0.15 viewport heights it
  uses the whole scroll range. Without a panel the progress is
  `scrollY / viewport height`.
- Progress is damped at rate 5 and snaps when within 0.0005. `onProgress` is
  called only when it changes.
- `scrolling` means the page scrolled within the last `SCROLL_REST` (0.15 s).
- The box goes from the hero placement to `coverSize` (the larger viewport side
  times 1.04) along `easeInOutCubic(progress)`. On desktop the hero is
  min(0.9 vw, 0.86 vh) centred vertically. Below 640 px wide (`phoneHero`) it
  fills the space between `NAV_CLEAR` (72 px below the top, under the nav bar)
  and the bottom of the `[data-prism-hero]` element, at most 1.2 vw, at least
  0.4 vh; the measurement is cached per viewport size. Without a hero element
  it uses min(1.12 vw, 0.6 vh) at 0.44 vh.
- Uniforms follow the walk: edge feather 0.14 to 0.03, `dim` 0.72 to 0.4,
  `saturation` 0.8 to 0.55, `hotKeep` 1 to 0.35. `sharp` is 0 when the fixed
  room layer exists, 1 otherwise.
- Uniform field meanings: `box` is (left, top, size in px, edge feather in uv);
  `glowAt` is (x, y, radius in px).

## Room DPR and the fixed layer

The room is drawn on a fixed layer (`RoomLayer` / `GPURoomLayer`) at
`min(devicePixelRatio, ROOM_MAX_DPR)` (`ROOM_MAX_DPR` is 2, in `util.js`).
Drawn at the canvas DPR (1 on phones) it was upscaled twice and looked a third
of its resolution on a 3x phone. Without the layer, the room uses the canvas
`viewport.dpr`. `shownPx` is box size times room DPR.

## Quality, profiles and upgrades

- The target frame rate is `MIN_FPS`. Phones held 60 fps, but then the network
  had only half the time and the room looked coarse.
- The canvas DPR starts at the saved profile's DPR, else 1 on compact devices
  or min(devicePixelRatio, 1.5). The range is 1 to min(devicePixelRatio, 1.5
  compact or 2 full) (`MAX_DPR`).
- `quality.frame` gets `age > 1.5` and a busy flag (upgrading, tuning or
  benching); a new DPR is passed to `onDpr`. The profile is saved every
  `SAVE_EVERY` (5 s) and on `pagehide`/unmount.
- `upgradeWhenDue` runs at most once a second, only when not upgrading or
  tuning, 2 s after the engine is ready and 15 s after the last engine change.
  An allocation failure (`upgradeFailed`) prevents retrying larger assets, but
  must not strand a slowing device at a tier or model it can no longer sustain:
  after a failure, a request for the small network is ignored, and a tier change
  is allowed only downward or when switching to the larger network.
- `startUpgrade` builds the new engine in the background, seeds its costs from
  the measured ones, prepares its fill for up to 250 ms (`UPGRADE_FILL_MS`),
  then `install`s it. A failure logs "staying at ..." and sets `upgradeFailed`.
- A lost WebGPU device (GPU reset, driver update) falls back to WebGL: the
  `onDeviceLost` callback sets `webgl`, which re-runs the engine effect.
- If loading the chosen tier/network fails with anything but an abort, start
  retries at `NATIVE` with the first network.
- With data saver on, the backdrop fails with "data saver is on".

## Tuning and benching

Both run only at rest (not scrolling, key and fill `atRest`). A bench runs when
timing is known, no timing query is pending, fewer than `BENCH_TRIES` (6) have
run, `benchStride` returns a stride, age is over 2 s and the key has been still
for 0.5 s. It evaluates one frame at that stride into the fill slot. Kernel
tuning runs once (`engine.tuned` false) after 3 s with the key still for 1 s;
failure marks the engine tuned and logs it. While tuning, any scroll, key
movement, or aim more than `MOVE_EPS` from the evaluated position aborts it.
Frames spent tuning or benching only draw the room (`drawRoom`).

## Light and image state

`makeLight` builds the key (slot 0, image 0) and fill (slot 1, image 1).

- `slot` is where the network writes; `image` is the light's full-resolution
  image that evaluations build up. They differ once spares are swapped in.
- `evalPos` is where the light was when its image was last evaluated; `pos` is
  where it is now. `movedSince` is their distance (Infinity before the first
  evaluation).
- `rect` is the image uv the evaluations cover: u0, u1, v0, v1.
- `kept` is the pixel range the image holds from earlier evaluations: x0, x1,
  y0, y1.
- `stride` is the current preview stride; `phase` counts phases issued.
- `done` is the number of evaluations at this stride since the light last moved.
  `converged` means `done >= stride^2`, i.e. every pixel has been evaluated.
- `next` is the first row not yet evaluated at every pixel (row refinement and
  the fixed fill).
- `still` is when the light last moved.
- `refining` means it is in full-detail row refinement.
- `lastMove` / `lastAlpha` are the last fresh move distance and its blend.
- `UNEVALUATED` (in `lightWork.js`) is the shared blank-image field set:
  `evalPos`, `rect`, `kept` null and `stride`, `phase`, `done`, `next` 0.
- `MOVE_EPS` (0.004 world units) is about 1 px.
- `FILL` is a fixed hidden light. The cached image is linear network output:
  colour, intensity and intro fades stay in the composite.

## Evaluation (`stepLight`)

Each evaluation takes every stride-th pixel from a different place in the
stride x stride block and folds it into the light's image. At rest that covers
every pixel after stride^2 of them. Moving, it keeps pixels evaluated while the
light was close to where it is now.

- A fresh move (more than `MOVE_EPS`) or a view the rect no longer covers picks
  a new rect: the view grown by `VIEW_MARGIN` when fresh, `VIEW_GROW` otherwise.
  Either resets `refining` and `next`.
- Newly covered pixels and a new stride need a whole cycle again, so `done`
  resets.
- Strides are 4x apart in cost, so one evaluation can leave up to 3/4 of the
  budget. The rest goes on more phases, never more than the cycle has left. At
  most 2 phases (1 when fresh or scrolling): each phase also resolves the whole
  covered area, so spare budget is not filled with dozens of unmeasured resolves
  when inference happens to be cheap.
- The light only moved before the first phase, so only the first resolve blends
  with `alpha`; the rest are where it is now (blend 0).
- Refinement at rest (`refineRows`): once the light has been still for
  `REST_DELAY` (0.15 s) and timing is known, it finishes actual source pixels in
  bands of full-detail rows (`evaluateRows`) instead of waiting up to 256
  display updates for a stride-16 phase cycle. Budget changes never reset this
  job. It sets stride 1 and `done` 1 when `next` reaches the rect's last row.
- `evaluateRows` makes monotonic progress even as the frame budget changes. A
  single resolve follows each bounded band, so extra phased resolves cannot
  multiply its overhead.
- `needsWork`: a fixed light needs work until it has an image and has
  converged. A moving light needs work if it moved, its rect doesn't cover the
  view, or (when not scrolling) it hasn't converged.

## Motion and trust distance

- The key light uses exponential damping (`dampedPosition`): rate 6 near a
  focused card (`FOCUSED_DAMPING`), 4 for pointer or rest movement
  (`FREE_DAMPING`). Its animated position is not distance-capped. Image reuse
  must never constrain the position the visitor sees.
- `TRUST_DISTANCE` is 0.06 world units. Nearby evaluations can reuse the
  previous image. `imageBlend` gives a move below the trust distance a blend of
  `1 - exp(-moved / 0.06)`, so the image keeps `exp(-moved / 0.06)` of its old
  pixels (about 37% just under the limit). A move at or beyond the trust
  distance has blend 1: the stale image is discarded so it cannot leave a
  second light spot, and the view shows the new coarse evaluation upsampled.
- `MAX_EVAL_MOVE` is half the trust distance; `HANDOFF_DISTANCE` is three times
  it.
- An earlier fix capped movement to 0.03 per evaluated position and crossfaded
  prepared images, briefly showing an old image as a trail. Both produced
  visible duplicate lights and were removed. The composite shows one moving key
  image; `maxKeyImages` in the status lets `perf/relight-motion-check.mjs`
  assert at most one, and `maxAnimatedStep` must exceed 0.031 outside reduced
  motion and mobile to prove movement is uncapped.

## Spares, adoption and handoff

- `install` gives the engine's remaining images (beyond `RESOLVED`) to spares,
  evaluated ahead at where the key light might go. The fill is finished by then,
  so they borrow its slot.
- `precomputeSpare` runs only on frames nothing else needs: nothing worked, no
  pending jump, not scrolling, not upgrading, idle late rate under 0.05, the
  walk-in past 0.3 or a card focused, a panel present, and spares exist. It
  spends min(half the budget, 8 ms) on a band of rows into the likeliest spare
  not done yet. A spare is `ready` when its rows reach the rect's end.
- Every `TARGETS_EVERY` (0.5 s) it re-reads where the cards are and calls
  `aimSpares`, which keeps spares already at a target (within `MOVE_EPS`),
  gives the rest to new targets, likeliest first, and sorts by `rank`.
- `likelyTargets` is where the key light would end up for the cards it could
  go to next, likeliest first, skipping targets within the trust distance of the
  key's evaluated position. With hover, whichever card the pointer is nearest
  gets hovered next (`nearestToPointer`; only cards on screen). On touch, the
  card nearest the middle (the first of a row) gets focus, and the light goes
  where it was the moment that card took over: halfway between it and the card
  before it, at the middle of the screen (`touchTakeovers`). That point is the
  same whatever the scroll.
- `adoptSpare`: a moving light that comes within `MAX_EVAL_MOVE` of a ready
  spare whose position is within the trust distance of the aim, and whose rect
  covers the view, starts from that spare instead of what it brought from
  further away. Only where it's going: a light resting next to a spare would
  otherwise trade its own image for it on the first nudge. Images are swapped,
  so nothing is copied.
- `takeSpare` swaps images, gives the light the spare's `pos` as `evalPos`,
  `rect`, `kept`, `next`, stride 1, done 1, and blanks the spare with slot 1.
- `handoffs` counts adoptions and reduced-motion jumps.

## Reduced motion

The key light snaps to the aim instead of animating. When the aim is more than
`HANDOFF_DISTANCE` from the evaluated position and no jump is pending
(`jumpWithoutMotion`), it takes a ready spare covering the view within the
trust distance (`readyHandoff`). Otherwise it keeps the old image still until a
complete destination image is ready: it retargets a not-ready spare (or the
last one) at the aim in the key's slot (`retargetSpare`) and records
`pendingJump`; the key stays at its evaluated position. The pending spare gets
the frame's work until it converges, then `finishJump` takes it. If the aim
moves more than the trust distance from the pending target, `dropStaleJump`
releases it (`releaseSpare` with the fill's slot; its rect, kept rows and
counters are left as they were). The key level fades in linearly over 0.6 s
instead of the strike.

## Frame pipeline order

`renderBackdropFrame` runs these phases in this order. Do not reorder GPU calls.

1. `trackWalkIn`, `placeRoom`, then `updateLights` for the glass cards.
2. `adaptQuality` (DPR changes). With no engine: `ready` 0, `drawRoom`, stop.
3. `keepEngineCurrent`: poll timing, `fitLayer`, clear benching, set
   `readyAt`, periodic save. Then `upgradeWhenDue`.
4. `aimKey` (focused card, pointer, rest, intro; `keepInRoom`) and `moveKey`.
5. `calibrating` (tune/bench). If it takes the frame, `drawRoom` and stop.
6. `visibleRect`, `dropStaleJump`, `jumpWithoutMotion` (reduced motion only).
7. `engine.beginFrame()`. Everything from here to `endFrame` goes to the GPU in
   one submit.
8. `scheduleWork`: the key light first and the fill gets what it leaves, but
   half each until the fill has an image. The frame budget is 70% of the budget
   while scrolling. On a very slow backend the first key evaluation can exceed
   the estimated frame budget, so when the key has an image and the fill does
   not (`bootstrapFill`) the fill gets the whole frame instead of starving.
9. `precomputeSpare` if nothing worked (see Spares).
10. `lightLevels`: key level from `strikeLevel` (or linear in reduced motion),
    fill level `easeOutCubic` over age 0.2 to 1.6 s; a change marks the frame
    dirty. Then `quality.worked()` if anything worked.
11. `compositeAndPresent`, `copyGlassOnCadence`, `placeGlow`.
12. `ready` uniform, `layer.draw`, `engine.endFrame()`, `syncGlassScene`.
13. `publishOnCadence`: status every `PUBLISH_EVERY` (0.5 s); a report once
    after `REPORT_AFTER` (10 s) and again when the page goes.

## Composite and drawn rect

Only the view is composited (a landscape screen shows about 55% of the
walked-in box). `state.drawn` is the image uv the last composite drew. The
composite runs when something changed (drawn rect = view grown by
`VIEW_MARGIN`) or when the view leaves the drawn rect (grown by `VIEW_GROW`, so
scrolling back out does not composite every frame). The margin gives the glass
something to bend at the edge. Lights go in as `shownLight` entries at their
`evalPos`; the key only when it has an image.

## Presentation: room layer and glass copy

- On WebGPU the room layer draws on the engine's device straight from its
  image, so nothing crosses contexts (`fitLayer` swaps to `GPURoomLayer`; on
  failure it keeps the current layer and sets `gpuLayerFailed`). The WebGL
  engine still hands over an `ImageBitmap`. A new layer is swapped in the frame
  it draws, so there is never a frame without a room.
- `present` returns true when the three.js copy still needs taking via
  `copyGlass`; the WebGPU layer draws from the engine's own image. WebGL has no
  separate half-size copy, so its snapshot is reused for the glass too.
- The three.js copy only shows through the glass, blurred, so it is half size
  and taken at a lower rate: at most every `GLASS_EVERY` (0.05 s). A copy
  crosses contexts and cost about as much as the whole frame's network at
  stride 8, and the glass blurs it anyway. `glassStale` means the glass copy
  lags the room; `glassAt` is the copy clock.
- Images arrive bottom row first, so the texture is not flipped
  (`unflippedTexture`).
- `syncGlassScene` bumps `mesh.userData.sceneVersion` when the uniform
  signature (copies, dpr, viewport, box, ready, sharp, glow) changes, so the
  glass re-renders only then.
- The soft bloom (`placeGlow`) exists because the tonemap flattens the key
  light otherwise. It follows the animated `key.pos`, sized by the projected
  radius; strength goes 0.9 to 0.45 with the walk, times the key level.

## Timing and cadence

- `RelightFrameClock` delivers 24 updates per second. It keeps fractional
  deadlines: 24 updates on a 60 Hz display alternate two and three refreshes;
  resetting the deadline to each draw would round that down to 20 Hz. It
  estimates the refresh interval as the lower quartile of the last 60 callback
  gaps once it has 8, which ignores occasional delayed callbacks while still
  adapting after a screen change. A stall never queues catch-up work: after a
  missed slot or lateness beyond one refresh, the next deadline is one interval
  from now. A gap over 250 ms (or negative) is a resume: the clock restarts and
  the sample is flagged `resumed` so hidden time isn't blamed on quality.
- `advanceCopyClock` keeps the copy cadence's fractional phase on the slower
  24 Hz rendering clock (about 20 copies per second at 0.05 s) and drops missed
  slots after stalls instead of copying several images on one frame.

## Fill light

`createFill` is valid only on its engine instance; a new model, source tier or
device gets a fresh image (`fillMatches`). `install` reuses a prepared fill only
when it matches, and `fillPrepared` reports whether that fill had an image.
`fillStep` starts with a coarse whole-image evaluation when full detail doesn't
fit the budget, then refines row bands.

## Status fields

`statusOf` feeds `setRelightStatus` and, when a page harness installs it,
`window.__relightObserve` (opt-in diagnostics; nothing is installed in
production). `perf/relight-motion-check.mjs` reads `phase`, `maxKeyImages` and
`maxAnimatedStep`. Keep field names and meanings. `resting: 1` means every
pixel gets evaluated once the light rests. `moving` is the preview stride for
the view. `prepared` is `'timed'`, `'built'` or null.
