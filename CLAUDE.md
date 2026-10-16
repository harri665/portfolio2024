# Project handoff

## Current relight movement (October 16, 2026)

The key light again uses the original exponential damping: rate `6` near a
focused card and `4` for pointer or rest movement. Its animated position is not
distance-capped. The renderer composites one moving key-light image. It no
longer shows an old-position trail or crossfades two key images during normal
movement; those paths produced visible duplicate lights. A prepared spare image
is adopted only once the animated light reaches it and the image covers the
view. If a move exceeds the `0.06` world-unit image trust distance, the stale
image is discarded so the new evaluation cannot retain a second light spot.
The bloom follows the animated position. Reduced-motion mode still snaps to a
ready image or waits for a complete one.

Verification for this change: five focused relight Jest suites passed (38 tests),
the production client build passed, and the browser motion check passed in
desktop WebGPU and WebGL, reduced-motion WebGL, mobile WebGL emulation, and
software WebGL. The desktop WebGPU capture was inspected during a fast card
change and showed one moving key-light spot. The check asserts at most one
moving key-light image while preserving uncapped animated movement.

## Relight motion resilience (October 16, 2026)

Commit `ce053bf` (`Keep relight stable during large light moves`) was merged from
`relight-motion-resilience` into `master` and pushed to GitHub. It addresses the
homepage relight image losing its apparent brightness and detail after a large
light movement. See `client/src/Components/Homepage/RelightBackdrop.js` and
`client/src/Components/Homepage/relight/lightMotion.js`.

- The initial motion fix capped movement to `0.03` world units per evaluated
  position, half the cached-image trust distance (`0.06`). The follow-up above
  removed that position cap and retained the trust limit for image blending.
- The initial implementation crossfaded prepared images over large jumps and
  briefly displayed an old image as a trail. Those animated paths were removed
  after duplicate lights appeared. Reduced-motion mode still switches to a
  ready image or prepares one while keeping the old image shown.
- Spare preparation can run for the first visible cards, while the renderer
  reserves a separate turn to bootstrap the fill light on slow backends.
  Diagnostic status now reports the largest movement/blend, handoffs, and
  spare readiness.
- The commit also contains related relight and glass-rendering performance work
  already present in the checkout: cheaper resolve paths, calibrated timing,
  adaptive DPR behavior, and fewer redundant room/glass renders. A WebGL glass
  snapshot fallback was fixed during integration.

Verification at the time of the commit: five focused relight Jest suites passed
(38 tests), `npm.cmd run build` passed, and `node perf/relight-motion-check.mjs`
passed in local Chrome for desktop WebGPU, desktop WebGL, reduced motion,
mobile emulation, and software WebGL. At that commit, the check asserted at most
`0.031` world units per evaluated move. The current check verifies restored
animated movement and at most one moving key image in the composite. It uses
the built client, installed Chrome, and repository project-card cache; see the
script for flags.
Browser emulation and a software renderer do not establish physical-device
performance. The existing build warning about an unused constant in
`client/src/utils/api.js` was unrelated.

Before modifying or committing, inspect `git status`. The local server cache
and load-log files had uncommitted edits when this handoff was written; they
were deliberately excluded from `ce053bf`.
