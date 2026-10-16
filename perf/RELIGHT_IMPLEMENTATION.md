# Relight implementation and validation

October 15, 2026. Local changes for the CS homepage at `cs.harrison-martin.com`, targeting 24 lighting updates per second and more actual image detail. No deployment is part of this result. The original investigation is [here](RELIGHT_RENDERING_INVESTIGATION.md).

## Agent allocation

The user explicitly requested a cluster with model costs considered. Three agents worked with separate file ownership, and the parent reviewed and integrated their work:

| Model | Work | Reason for allocation |
| --- | --- | --- |
| GPT-6 Astra, high reasoning | Refinement, GPU image ownership during preparation, renderer integration, independent integration review | These changes can introduce stale lighting or resource-lifetime bugs across two backends. |
| GPT-6.1 Sol, high reasoning | Quality adaptation, cached-profile validation, inference-cost estimates, existing benchmark integration | Substantial implementation with bounded interfaces and testable policy decisions. |
| GPT-6 Luna, medium reasoning | Route audit and browser regression harness | Narrow checks with concrete acceptance conditions, reviewed by the parent. |

This allocation follows [OpenAI's model-selection guidance](https://developers.openai.com/api/docs/guides/model-selection). It is a relative capability/cost choice, not a claim about an exact dollar cost or this account's billing.

## Implemented

- A Relight-only deadline clock retains fractional intervals. At 60 Hz it alternates two and three refreshes to deliver 24 scheduled updates, instead of rounding down to 20. It drops catch-up work after stalls and excludes hidden-tab time from quality feedback. The art torus, hub, and grid retain their existing frame policy.
- Resolution demand uses the room's current enlarged size times room DPR. Available source tiers remain 384, 512, and 768. Raising canvas DPR alone is not presented as extra lighting detail.
- After the key light stops moving, full-resolution row bands make monotonic progress to every visible source pixel. Budget changes do not restart that progress. Moving updates are limited to two phases to bound repeated full-area resolve overhead.
- The 24 Hz controller reserves 30% of the nominal frame interval for surrounding work. It treats ordinary 33/50 ms delivery as healthy, reacts to missed deadlines, and changes tiers only after sustained pressure/headroom and a cooldown. Model selection now considers full-detail resting work. A failed higher-tier allocation does not disable downward adaptation.
- Measured inference costs take precedence at their actual stride. Missing-stride estimates retain fixed dispatch overhead; the 15% reserve when measurements are insufficient is explicitly a heuristic, not a measurement of whole-frame GPU time.
- Stationary fill preparation uses bounded batches while loading. Completed or partial row state transfers with its owning engine, so handoff does not restart it or allow two writers. Tier/model changes prepare a matching fill image, with a short preparation limit while the previous engine remains visible. Color, intensity, and intro fade remain composite operations.
- Glass image copies preserve their 20 Hz phase under the new 24 Hz scene clock, avoiding accidental reduction to 12 Hz. Speculative light work pauses during upgrades or deadline pressure.
- Cached profiles are versioned against the engine, target cadence, viewport scale, and backend. Old budgets are reconsidered. Provisional timings are remeasured at rest even if preceding refinement bands were too small to time. The configuration disclosure includes **Clear cached settings**, preserves unrelated preferences, and prevents pagehide/unmount from restoring the removed profile.
- Configuration reports distinguish source size, displayed size, actual refinement completion, and the target update cadence. Opt-in benchmark observations separate scene updates, changed-light updates, and refinement updates; none is claimed to measure display scanout.

## Validation

32 focused Jest tests and four benchmark-summary tests passed. The production build passed with the existing unused-variable warning in `utils/api.js` and existing toolchain notices. `git diff --check` passed. Browser checks run against the production build using installed Chrome 155 and the existing local site-serving helper. Analytics/API writes are stubbed; twelve deterministic project cards exercise the actual glass and touch-focus code.

Commands:

```powershell
# In client/
npm.cmd test -- --watchAll=false --runInBand --runTestsByPath src/Components/Homepage/relight/adaptiveQuality.test.js src/Components/Homepage/relight/frameClock.test.js src/Components/Homepage/relight/RelightBase.test.js src/Components/Homepage/relight/lightWork.test.js
npm.cmd run build

# From repository root
node --test perf/lib/measure.test.mjs
node perf/relight-regression.mjs --target-fps=24 --profile=phone --out=perf/results/relight-cluster/phone-final
node perf/relight-regression.mjs --target-fps=24 --profile=tablet --out=perf/results/relight-cluster/tablet
node perf/relight-regression.mjs --target-fps=24 --profile=desktop --out=perf/results/relight-cluster/desktop
```

The existing `perf/lib/measure.mjs` also records Relight counters per measurement phase. Its browser-callback FPS remains separate from the scene and changed-light submission rates; cached settings no longer establish that a live renderer is present.

Recorded interaction results on the host RTX 3080:

| Viewport profile | WebGPU source at rest | Scene submissions during interaction | Changed-light submissions in observed window | Missed scene deadlines in that window |
| --- | --- | --- | --- | --- |
| Phone: 393 x 851, DPR 2.75 | 768 x 768 | 24.0/s | 51 over 7.88 s | 0 |
| Tablet: 820 x 1180, DPR 2 | 768 x 768 | 24.0/s | 41 over 7.92 s | 0 |
| Desktop: 1440 x 900, DPR 1 | 768 x 768 | 24.0/s | 168 over 7.96 s | 0 |

Touch profiles move the light when the focused project card changes; the light need not change on every scene update. Desktop uses a moving pointer. The scene rate uses the controller's measured active intervals, excluding preparation/tuning holds. These are submission observations, not GPU completion or display scanout measurements.

All three profiles passed full-detail convergence, source/display reporting, scroll/resize, cache reset, forced WebGL2, and root/art route checks without page errors. Forced WebGL reached every source pixel at 512. The final phone run and desktop run additionally required fresh timings on the installed engine; the tablet run preceded that final remeasurement fix. The final phone build identified its entry as `main.5a94146f.js`. Screenshots were inspected for room/glass rendering and the configuration control. A preceding phone run demonstrated a live 512-to-768 upgrade after enlargement.

This establishes local integration and cadence on one capable GPU. It does not establish a speedup factor over the public deployment or validate physical-phone thermals, memory, or GPU completion times.

The baseline before these changes used the previous local production build, which was already newer than the public CS deployment. It reached 768 on WebGPU and 512 on forced WebGL in the phone viewport on the host RTX 3080. It passed cache-reset and root/art route checks. That first fixture had no project cards, so it is a startup/routing baseline, not a controlled before/after measurement of moving-light throughput or a phone benchmark.

Local reports and screenshots live under ignored `perf/results/relight-cluster/`. The reproducible browser script is `perf/relight-regression.mjs`, with `--profile=phone|tablet|desktop`, `--target-fps=24`, and `--out=<directory>`.

## Remaining release evidence and optional work

Physical iPhone/iPad/Android measurements and Safari/Firefox checks are still required before claiming stable 24 FPS across devices. Viewport emulation retains the host GPU. The controller's inference budget and frame-deadline feedback are not a complete asynchronous measurement of inference, resolves, compositing, glass, and GPU queue completion.

The original plan's additional 1024-pixel assets, alternative shared-context WebGL presentation, sparse resolve experiments, and worker-based preparation remain optional experiments requiring measured need. This implementation does not change exported scene/model assets or the separate Relight viewer. Sustained thermal behavior, device loss, and a broad physical-device memory matrix remain release-validation work.
