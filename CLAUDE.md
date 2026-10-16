# Project handoff

## Relight motion resilience (October 16, 2026)

Commit `ce053bf` (`Keep relight stable during large light moves`) was merged from
`relight-motion-resilience` into `master` and pushed to GitHub. It addresses the
homepage relight image losing its apparent brightness and detail after a large
light movement. See `client/src/Components/Homepage/RelightBackdrop.js` and
`client/src/Components/Homepage/relight/lightMotion.js`.

- The animated key light accumulates motion toward its target, but each new
  evaluated position stays within `0.03` world units of the last evaluation.
  This is half the cached-image trust distance (`0.06`), so a large pointer or
  card jump cannot discard most of the previous light image in one update.
- When a complete spare image covers the destination view, a jump over `0.18`
  world units hands off through a `0.12` second crossfade. Reduced-motion mode
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
mobile emulation, and software WebGL. The check asserts at most `0.031` world
units per evaluated move and at most `0.41` image blend. It uses the built client,
installed Chrome, and repository project-card cache; see the script for flags.
Browser emulation and a software renderer do not establish physical-device
performance. The existing build warning about an unused constant in
`client/src/utils/api.js` was unrelated.

Before modifying or committing, inspect `git status`. The local server cache
and load-log files had uncommitted edits when this handoff was written; they
were deliberately excluded from `ce053bf`.
