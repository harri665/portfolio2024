# Project handoff

## Current relight movement (October 16, 2026 follow-up)

The key light again uses the original exponential damping: rate `6` near a
focused card and `4` for pointer or rest movement. Its animated position is not
distance-capped. Prepared-image handoffs now follow that animated position;
the bloom follows it too. When a large jump has no ready image, a spare holds
the previous image briefly while a new preview appears. Image replacement is
limited to about `0.39` per moving evaluation, preserving detail without
slowing the light. Reduced-motion mode retains its ready-image snap behavior.

Focused relight tests passed (39 tests), the production build passed, and the
browser motion check passed on desktop WebGPU/WebGL, reduced motion, mobile
emulation, and software WebGL. Desktop checks assert that motion exceeds the
old `0.03` position cap while cached-image replacement stays bounded. The
browser screenshots were inspected during and after card changes.

## Relight motion resilience (October 16, 2026)

Commit `ce053bf` (`Keep relight stable during large light moves`) was merged from
`relight-motion-resilience` into `master` and pushed to GitHub. It addresses the
homepage relight image losing its apparent brightness and detail after a large
light movement. See `client/src/Components/Homepage/RelightBackdrop.js` and
`client/src/Components/Homepage/relight/lightMotion.js`.

- The initial motion fix capped movement to `0.03` world units per evaluated
  position, half the cached-image trust distance (`0.06`). The follow-up above
  removed that position cap and retained the trust limit for image blending.
- When a complete spare image covers the destination view, a jump over `0.18`
  world units hands off through a crossfade. Reduced-motion mode
  switches to a ready image or prepares one while keeping the old image shown.
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
animated movement and at most `0.41` image blend. It uses the built client,
installed Chrome, and repository project-card cache; see the script for flags.
Browser emulation and a software renderer do not establish physical-device
performance. The existing build warning about an unused constant in
`client/src/utils/api.js` was unrelated.

Before modifying or committing, inspect `git status`. The local server cache
and load-log files had uncommitted edits when this handoff was written; they
were deliberately excluded from `ce053bf`.
