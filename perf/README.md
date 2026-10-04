# Performance test

Measures every page of the four sites (hub, CS, Art, Blog). It finds pages by
following the links on each home page, plus `/contact`, `/colophon` and `/glass`.

- **Load, on every page:** TTFB, FCP, LCP, CLS, TBT, bytes transferred (all and
  JS only), request count, JS heap and main-thread time.
- **Frames, on pages that draw WebGL:** fps, p50/p95/p99/max frame time, the
  share of frames below 30 fps, and how busy the main thread is. These are
  measured while the pointer moves, while the page rests, and while it
  scrolls. On the CS home page it also reports the budget and pixel ratio the
  relight backdrop settled on, and runs a return visit to check that the saved
  quality profile avoids the first-visit stutter.

Each run uses a fresh browser profile, so every visit is a first visit. Each
number is the median of `--runs` visits. Visits to `/api/load` are stubbed,
so a test run doesn't write to `loadLogs.json`.

## Setup

    cd perf && npm install

It needs the dev servers (`npm run dev` at the repo root). For `--target
build` it needs only the API server on port 3005.

## Usage

    npm run perf                    # every page, desktop, 3 runs
    npm run perf:3d                 # 3D pages on desktop, retina and low-end
    npm run perf:quick              # 1 run, 3 pages per site
    npm run perf:devices            # every profile
    node run.mjs --list             # print the pages it found and exit

Options:

    --target local|build|prod  dev server (default), client/build served like
                               nginx (minified, gzipped: use this for load
                               numbers), or the live sites
    --profiles a,b|all         desktop, retina, low-end, mobile, mobile-weak
    --sites cs,art             limit to some sites
    --match REGEX              filter on "site/path", e.g. "^cs/$"
    --max-pages N              at most N pages per site
    --runs N  --duration S     visits per page, seconds per frame phase
    --3d-only  --no-frames     only WebGL pages / skip the frame phases
    --headed                   show the browser (real vsync)
    --save-baseline            save this run as results/baseline.json
    --compare baseline|previous|none|FILE
    --strict                   exit 1 if anything got worse than the baseline

The GPU can't be throttled, only replaced. The `low-end` and `mobile-weak`
profiles render WebGL on the CPU (SwiftShader) to stand in for a weak GPU.
Results are saved to `results/` (not committed). Baselines are specific to
the machine they were measured on.

## Posters

The home pages paint a still of their 3D scene first and start the live scene
once the page has loaded and the visitor moves, scrolls or types (or 3.5 s
after load); the art home page starts its scene straight away. `posters.mjs` captures those stills into `client/public/posters`
from the dev server, so re-run it whenever a home page's scene changes:

    node posters.mjs                # every poster
    node posters.mjs --sites cs     # one site's

## Relight bench

`relight-bench.mjs` times the CS backdrop's network on its own, with no scene
running (the CS home page with `?relight=bench`, see
`client/src/Components/Homepage/relight/bench.js`): GPU ms per evaluation of
a whole light at each stride and image size, on WebGPU and WebGL. At 512 px
it also scores the image of each of the relight project's six test lights
against its path-traced reference (`refs.bin`, read from that project's
`web/scenes/cornell`), as its `evaluate.py` does: PSNR after exposure
normalisation and a Reinhard tonemap.

    node relight-bench.mjs                      # desktop, WebGPU and WebGL
    node relight-bench.mjs --profiles low-end --strides 4,8,16 --no-quality
    node relight-bench.mjs --save-reference     # keep these images to compare with

`--save-reference` keeps each image in `relight-reference/` (not committed,
as GPUs round differently); later runs report how far they moved from them,
to check that a change meant to leave the image alone did.

## Relight data

The relit room ships packed by `relight-pack.mjs`, from the relight
project's export (`export.py`, kept as exported in
`relight-data/cornell-original/`): positions as 16-bit values instead of
32-bit floats plus a distance, the duplicate normals dropped, and every
channel stored as byte-split row differences that gzip well, with a `.gz`
beside each file for nginx's `gzip_static`. The 512 px pixels go from
3.4 MB gzipped to 0.7 MB, the 768 px ones from 7.4 to 1.4 MB.

    node relight-pack.mjs --in ../relight-data/cornell-original --out ../client/public/relight/cornell-128x4
