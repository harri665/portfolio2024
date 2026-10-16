---
paths:
  - "client/src/Components/Homepage/relight/RelightBase.js"
  - "client/src/Components/Homepage/relight/RelightBase.test.js"
  - "client/src/Components/Homepage/relight/RelightEngine.js"
  - "client/src/Components/Homepage/relight/RelightGPU.js"
---

# Relight engines

Reference notes for the relight engines. The source files carry no comments; this
file holds the reasoning, layouts and measurements behind them.

## Origin

The engines are a trimmed port of the runtime from the relight project at
`E:\NextCloud\Documents\relight`, which implements Neural Render Proxies (Sancho et
al., EGSR 2026). A small MLP relights a Cornell box per pixel for a spherical light
given by position and radius.

## Architecture

- `RelightBase.js` holds what both backends share: the camera (`cam`, `project`,
  `unproject`), the light domain (`lo`, `hi`, `rmin`, `rmax`, `normLight`), the
  surface lookup (`surfaceDistance`), the band and span helpers (`rows`, `cols`,
  `share`, `span`, `drawRect`, `tapSigmaScale`), the network shape check
  (`readNetwork`), the cost model (`timeable`, `recordTiming`, `seedTiming`,
  `evalCost`) and kernel tuning (`tune`).
- `RelightGPU.js` (`RelightGPUEngine`) is the main path. It runs the whole MLP for a
  workgroup tile inside workgroup memory. A 512px light takes about 5ms on WebGPU
  against about 21ms on WebGL2 (measured on an RTX 3080).
- `RelightEngine.js` (`RelightEngine`) is the WebGL2 fallback, used only where WebGPU
  is unavailable. WebGL2 has no compute shaders, so the MLP is a chain of fragment
  passes over bands of rows, ping-ponging activations between two texture arrays
  (`arrs`).

## Shared constants (`RelightBase.js`)

- `SLOTS` (4): network output slots. One holds a light; the rest are spares for the
  bench.
- `RESOLVED` (2): full-resolution images the backdrop builds up one light at a time,
  one per light. An engine can be built with more (`options.images`) to keep images
  for places a light is likely to go.
- `NO_PHASE` (`[0, 0]`): where in each stride x stride block an evaluation takes its
  pixel.
- `MIN_BAND_ROWS` (16): below this the fixed per-pass cost outweighs the rows (many
  times over on WebGL).
- `MIN_TIMED_SHARE` (0.25): thin bands make the GPU look slow. 16 rows at 768px read
  about 16ms for a light that really takes about 8ms, so passes covering less than
  this share of the grid are not timed.
- `LIGHT_INPUTS` (4) and `GEO_INPUTS` (6): first-layer inputs after the pixel
  inputs, see "Inputs and network shape".
- `DRAW_MARGIN` (2): see `drawRect` below.

## Phase order

`phaseOrder(stride)` returns the stride x stride offsets in Bayer order, so the
first quarter of a stride's offsets already covers the grid at half the stride. The
recursive `bayerRank` places quadrants in the order top-left, bottom-right,
top-right, bottom-left (`BAYER_QUADRANT_RANK`, `[0, 2, 3, 1]`, indexed by
`(y >= n/2) * 2 + (x >= n/2)`). Results are cached per stride in `PHASE_ORDERS`.

## Spans and rectangles

- `span(stride, r0, r1, c0, c1)` gives the pixels a resolve of those items covers as
  `[x0, x1, y0, y1]`.
- `drawRect(view)` gives the pixels a composite of `view` (image uv
  `[u0, u1, v0, v1]`) draws, as `[x0, x1, y0, y1]` measured from the top. It extends
  `DRAW_MARGIN` (two) pixels past the view so the room layer's Catmull-Rom taps at the edge land on
  drawn pixels. Pixels outside are not drawn.
- `surfaceDistance(u, v)` interpolates bilinearly between the four nearest pixels.
  Without interpolation a light held off the floor stepped a whole row at a time. If
  any of the four taps is background it falls back to the nearest pixel.
- `tapSigmaScale()` is `1.5 * 2 * tan(fov / 2) / W`, one and a half pixel footprints
  per unit distance. Bilateral upsampling multiplies it by the stride and the
  pixel's camera distance to get the Gaussian sigma for position differences. The
  WebGL composite computes the same value inline from `tanxy`.

## Cost model (`RelightBase.js`)

- `timeable(stride, r0, r1, c0, c1, hardwareTimer)` decides whether a pass is timed. A pass
  is skipped while another measurement is pending, when it has fewer than
  `MIN_BAND_ROWS` rows (or the whole grid if smaller), or when it covers less than
  `max(MIN_BAND_ROWS / rows, MIN_TIMED_SHARE)` of the grid. `hardwareTimer` is true
  when the backend can use timestamp or timer queries for this pass. Without them
  (software timing), once a stride has `SOFTWARE_CALIBRATION_SAMPLES` (3) unseeded
  samples only one pass in `SOFTWARE_TIMING_INTERVAL` (24) is timed. Hardware timing
  runs every eligible pass.
- `recordTiming(stride, share, ms)` drops the first `WARMUP_SAMPLES` (2) samples,
  which include shader compiles. It scales the measurement to a full grid (`ms / share`). The first real
  sample discards seeded values. The smoothing (`smoothCost`) drops fast and rises slowly (average
  0.5/0.5 when faster, 0.9/0.1 when slower) so one stall does not make a fast GPU
  look slow.
- `seedTiming(byStride)` loads saved per-stride costs, keeping only finite positive
  values at stride >= 1, and marks them seeded.
- `evalCost(s)` estimates inference cost at stride `s`:
  - An actual measurement at that stride wins.
  - Otherwise it takes the two measurements nearest in `x = 1 / stride^2` (the
    pixel share) and fits `fixed + variable * x`, separating fixed dispatch
    overhead from per-pixel work.
  - A negative per-pixel slope comes from noisy or incomparable measurements and
    does not justify a negative cost; it returns the larger of the two.
  - A fit whose fixed part falls below the reserve is rejected: a zero or negative
    intercept cannot establish that dispatch overhead is zero.
  - A lone sample cannot identify either component. It keeps its full
    pixel-scaled cost plus a reserve of 15% (`FIXED_COST_RESERVE`) of the smallest known cost, so sparse
    passes never become free.
  - This only estimates inference. Callers must also budget resolves and
    presentation.
  - Worked examples from `RelightBase.test.js`: with `{1: 10, 4: 2.5}` the model is
    2ms per dispatch plus 8ms for a full sample grid, so stride 2 costs 4ms and
    stride 8 costs 2.125ms. With `{1: 10, 4: 0.5}` the intercept is negative, so
    stride 2 falls back to the reserve rule (2.575ms). With software timing,
    after three calibrating samples 23 of every 24 passes are skipped; hardware
    timestamp queries stay enabled on every pass.

## Kernel tuning (`RelightBase.tune`)

`tune(light, stride, runs, signal, slot)` is shared by both backends. It swaps in a
fresh `timing` object with a dummy `pending` (so no timing runs), then for each of
`tuneCandidates()`: `prepareVariant` (WebGPU compiles the pipeline, skipping
kernels that fail; WebGL passes the candidate through), `useVariant`, one warm-up
`evaluate` that also sets the pipeline up, `whenIdle()`, then `runs` timed
evaluations followed by `whenIdle()`. The fastest variant is kept and the old
`timing` restored, then `afterTune()` runs (WebGL deletes the other passes). An
abort signal stops at the next check. Results are keyed by `kernelName`.
`whenIdle()` is `queue.onSubmittedWorkDone()` on WebGPU and `fence(gl)` from
`util.js` on WebGL.

## Inputs and network shape

- The first layer takes the pixel inputs (hash-grid features from `grid_res` levels
  x `feats`, then `aux_dim` auxiliary values, default 7), then `LIGHT_INPUTS` (4)
  normalized light values (`normLight`: position mapped to [-1, 1] within the light
  box, radius mapped to [-1, 1] within the radius range), then `GEO_INPUTS` (6)
  geometry features when the network has `geo`. `readNetwork` (in
  `RelightBase.js`) reads the network description and throws if the first layer's
  width does not match. `hiddenLayers` is `network.hidden - 1`, the number of
  hidden-to-hidden layers; the output layer is `layers[hiddenLayers + 1]`.
- `head === 'mul'` networks output 6 values per pixel: `a` (multiplied by the
  geometric term `G`) and `b` (added). Other networks output 3 (just `a`).
- Positions are stored as uint16 per axis, 0 meaning background, with
  `value = lo + (q - 1) * (hi - lo) / 65534` from `scene.pixels.pos.range`. The
  normal is aux channels 3, 4 and 5.
- Geometry features: `f0 = (direction to light, cos)` and
  `f1 = (0.5 ln d, 0.25 ln solid angle, G, valid)`, zero for background pixels.
  The solid angle of the light sphere is `2 pi s^2 / (1 + sqrt(1 - s^2))` with
  `s = min(r / d, 1)` (the `solidAngle` shader function), and
  `G = omega * max(cos, 0) / pi`. Only six of these values reach the network (all
  of `f0`, the first two of `f1`); WebGPU fills the rest of `f1` but no weights
  read it, and WebGL leaves them zero.

## Shared shader snippets

Each backend shares small snippets within its own language. They compute the same
results as the inline code they replaced:

- `SOLID_ANGLE_GLSL` / `SOLID_ANGLE_WGSL`: `solidAngle(r, d)` (the WGSL one also
  defines `PI`), used by the layer-0 geometry features and the composite's `G`.
- `TAP_GLSL` / `TAP_WGSL`: the bilateral upsample tap. `tapWeight` is the bilinear
  weight for corner `k` (bit 0 picks x1, `k >= 2` picks y1) times
  `exp(-|dq|^2 / (2 sig^2)) + 1e-4`, with the Gaussian zeroed when one tap is
  background and the other is not. GLSL also has `tapCell`. Used by the composite's
  preview upsample (`netAt`) and by the resolve.
- `GEOMETRY_GLSL` (WebGL `geomAt`, `normalAt`) and `POS_WGSL` / `NRM_WGSL` (WebGPU
  `posAt`, `nrmAt`).
- `FULLSCREEN_WGSL`: `fullscreenCorner(i)`, the oversized triangle used by the
  composite and blit vertex shaders. WebGL uses `FULLSCREEN_VS`.

## WebGPU engine (`RelightGPU.js`)

### Memory and precision

- It stores the pixel inputs (39 halves per pixel, 21MB) and runs layer 0 inside the
  kernel, instead of caching layer 0's output per pixel as the relight repo does
  (128 floats per pixel, 134MB). Phones need the memory. The light's contribution to
  layer 0 (`b0` plus `w0Light` times the normalized light) is folded on the CPU into
  the per-pass uniform `add` (`writeForwardUniforms`).
- f16 is used where available (`shader-f16`): about a third faster on the 3080, and
  the image moves by at most 3/255.
- `toHalf` converts f32 to f16 bits with round to nearest even, for the weight
  buffer.
- Pixel positions (plus camera distance) and normals live in separate arrays of
  halves (`ppos`, `pnrm`, read by `posAt` and `nrmAt`), so the bilateral taps, which
  only want positions, read 8 bytes a pixel instead of 16 of every 32. Halved
  positions move the image by at most 1/255 and do not change the PSNR.
- `IMAGE_FORMAT` is `rgba16float`: the composited image stays in halves so it is not
  quantised before the room layer's upscale and grade.

### Device

`requestRelightDevice` asks for the adapter's own workgroup storage, storage
binding and buffer size limits; the 16KB default only fits the smallest kernel. It
requests `timestamp-query`, `shader-f16` and `subgroups` when present. It uses the
default adapter, like WebGL does, so on dual-GPU laptops the image does not cross
GPUs every frame. It needs WebGPU (which needs HTTPS) and OffscreenCanvas.

### Kernel variants (`KERNELS`, `kernelKey`)

- Which kernel is fastest depends on the GPU, so `tune()` times them. The first that
  fits is the default.
- A thread computes `pixels x channels` groups of 4 outputs. More pixels reuse each
  weight it loads (what the 3080 is short of; 8 is enough there). More channels
  reuse each activation (phones, where workgroup memory is just cache).
- 32-thread kernels are for GPUs with small subgroups (Mali, Apple).
- On the 3080 the channel, double and subgroup kernels lose by 3-20%; they exist for
  other GPUs.
- `kernelKey` builds the names that saved profiles hold, such as `256x4`,
  `64x8c2`, `64x8d`, `64x8s`. A single channel group keeps the old name (no `c1`).
  Do not change existing keys.
- `tileOf(k, groups)` is the pixels a workgroup takes: `groups / channels` threads
  share each pixel, so a tile is `threads * channels / groups * pixels`. `groups` is
  the layer width / 4, the vec4 channel groups.
- `workgroupBytes` is activation storage (doubled for `double`), plus
  `GEO_FEATURE_BYTES` (32) of geometry features and 4 bytes per output per tile
  pixel.
- Filters in `fittingKernels`: a pixel's threads must share a subgroup whatever size the GPU
  picks (`subgroupMinSize` divisible by threads per pixel, plus the `subgroup_id`
  WGSL feature). The geometry and output stages take one pixel per thread, so a
  tile cannot outnumber the threads. Workgroup memory, invocation and dispatch
  limits also apply.
- A saved kernel this GPU no longer compiles falls back to the default.

### Forward kernel (`forwardWGSL`)

- Activations are vec4s so a thread loads 4 inputs at once. Loaded one at a time,
  workgroup memory loads outnumbered the FMAs, which is what phone GPUs are worst
  at. A thread with C channel groups loads 4C weights and P activations per step for
  16CP FMAs.
- A pixel's threads (`threadsPerPixel` = `groups / channels`) hold channel groups
  that are `threadsPerPixel` apart, so neighbouring threads read neighbouring
  weights. A team of `threadsPerPixel` threads handles `pixels` pixels; a tile is
  `tilePixels` pixels.
- `double` writes each layer into the other half of `act`, so it needs no barrier
  before the writes. The output stage reads the half the last layer wrote
  (`lastActOffset`).
- `subgroup` keeps a pixel's activations in its threads' registers between hidden
  layers and shuffles them across with `subgroupShuffle`, so those layers need no
  barriers or workgroup memory. A pixel's threads are lanes `lane0..` of one
  subgroup, whichever threads the GPU put in it. The output rows take every channel
  of a pixel, so they still go through workgroup memory.
- `px`, `py` offset the sample grid so each frame can take different pixels. The
  last row or column can land off the image; those taps are read clamped and the
  resolve does not use them.
- The output layer stays f32 like the WebGL output layer: it is HDR and only 6 wide.

### Weight buffer layout (`packWeights`)

All offsets (`off`) are in vec4s, in this order:

- `layer0Pixel`: layer-0 pixel-input weights, `ceil(pixelInputs / 4) * 4` rows of
  `groups` vec4s, transposed so output channels are contiguous.
- `layer0Geo`: the 6 geometry-feature rows (only for `geo`).
- `hidden`: per hidden layer, `width` input rows of `groups` vec4s, then `groups`
  vec4s of bias.
- `outWeights`: output layer weights, row-major (`outputCount(mul)` rows of
  `width`).
- `outBias`: output biases (2 vec4s).

`packWeights` also returns layer 0's bias (`bias0`, kept as `b0`) and its light
columns (`lightWeights`, kept as `w0Light`). With f16 the buffer goes through
`toHalf`.

### Uniforms, the ring and submits

- Per-pass uniforms sit in a ring (`RING_SLOTS` = 64 entries of `ringStride` bytes) at
  dynamic offsets so a frame's passes do not overwrite each other's. `stage` copies
  a pass's uniforms in and returns its offset; when the ring is full it submits what
  is queued and starts over.
- `Fwd` (forward): `i0, i1, stride, slot, x0, xw, px, py` (u32,
  `FWD_GRID_WORDS`), then `lc` (light centre and radius, at word `FWD_LIGHT`) and
  `add` (layer-0 bias plus light term, `groups` vec4s, from word
  `FWD_HEADER_WORDS`). 48 + 16 * groups bytes.
- `Frame` (composite): `camO, camX, camY, camZ, tanxy` (vec4 each), `exposure`,
  `nLights`, two pads, then `SLOTS` lights of `pr` (position, radius), `e` (colour
  times intensity) and `info` (slot, stride, disc shown). 96 + 48 * SLOTS bytes
  (`FRAME_HEADER_WORDS`, `LIGHT_WORDS`; `FRAME_EXPOSURE`, `FRAME_LIGHT_COUNT`,
  `LIGHT_EMISSION`, `LIGHT_INFO` are word offsets). A resolved light uses stride
  `FULL_RES_STRIDE` (1 here), since its image is read like a stride-1 slot.
- `Res` (resolve): 20 words: `s, px, py, raw, dst, c0, c1, r0, r1, x0, y0, xw, yh,
  k0x, k0y, k1x, k1y` (u32), `alpha`, `sig` (f32), `sparse` (u32). 80 bytes
  (`RESOLVE_WORDS`; `RESOLVE_ALPHA`, `RESOLVE_SIGMA`, `RESOLVE_SPARSE` are word
  offsets).
- `outB` holds the `SLOTS - RESOLVED` network slots first, then the full-resolution
  images, so a resolved light's slot is `SLOTS - RESOLVED + index`. Each pixel takes
  `wordsPerPixel(mul)` u32 words of packed halves.
- A frame's passes go in one encoder and one submit: `beginFrame`, then `evaluate`,
  `resolve`, `composite` as often as needed, then `endFrame`. The fixed cost of a
  submit was most of a pass at the strides phones run. Outside a frame every pass
  submits on its own (`commit`). `afterSubmit` callbacks run after each submit.

### Timing

- Timestamp queries time a pass when available and the readback buffer is
  unmapped.
- Many phones have no timestamp queries. Timing from submit counted the rest of the
  frame and made the network look several times slower than it is. Instead the pass
  goes in a submit of its own (`ownSubmit` in `evaluate`) and the time is from the previous queue drain (or the
  submit) to its own drain.
- The readback can only start once its pass is submitted, so it is queued on
  `afterSubmit`.
- Chrome sometimes resolves both queue promises at once behind a long queue. If the
  difference is within `QUEUE_GRAIN_MS` (0.1ms, closer completions get reported
  together) it falls back to the time since submit.

### Composite and resolve

- The composite renders rows bottom first, like the WebGL render target. The
  `drawRect` rows are from the top, so the scissor flips them. It writes into
  `image`, which the room layer draws from on the same device. Pixels outside the
  view keep an older composite; the backdrop composites again before they show.
- Previews (stride > 1) upsample with weights from position, so light does not bleed
  across edges. `G` is computed per pixel so a preview keeps the light's shape, not
  just its colour. The direct disc view of the light is 4x4 supersampled
  (`directCov`).
- `resolveWGSL` folds one evaluation into a light's full-resolution image. Pixels it
  evaluated are copied; the rest move toward the upsampled evaluation by `alpha`, so
  at rest every pixel ends up evaluated and a moving light keeps what it evaluated
  recently. Pixels outside `keep` have nothing to keep yet, so they take the
  upsample fully. `hx`, `hy` are the last column and row whose pixel lies on the
  image. The sparse path only copies evaluated pixels (`evaluatedOnly`: stride 1
  with no phase; or nothing to blend).
- For `resolve`, `slot` is the evaluation and `target` the light's full-resolution
  image. `keep` is the span that image already holds (`[x0, x1, y0, y1]`); outside it
  pixels are just upsampled.
- `BLIT_WGSL` copies the composited image onto a canvas, at the same size
  (snapshots) or half size (the glass's copy, each pixel the average of 4 through
  linear filtering).
- `halfImage` is half size for the three.js copy the glass bends, which is blurred
  there anyway. It is handed over once the frame is submitted.
- Firefox forgets the canvas configuration every snapshot, so `currentTexture`
  reconfigures and retries.

## WebGL2 engine (`RelightEngine.js`)

### Bands and passes

- Activations live in two `RGBA16F` texture arrays of `groups = width / 4` layers
  and `th` rows (at least `MIN_BAND_HEIGHT`, 8). `BAND_BYTES` (16MB) sets the band height. When the band size was
  measured, 32MB ran about 20% faster than 8MB.
- Each pass writes `out` vec4 groups at once to multiple render targets (`OUTPUTS`
  1, 2, 4 or 8, named `o<n>` by `outputsName`; saved profiles store these names).
  On a 3080 one group per pass is twice as fast as eight, but it depends on the GPU,
  so `tune()` decides. The default is the largest of these at most
  `DEFAULT_OUTPUTS` (2). Candidates must fit the draw buffer and attachment limits,
  divide `groups`, and fit `groups * 64 * n` bytes of weights in a uniform block.
- Weights for each pass are packed by `packLayer` into one uniform buffer at
  `UNIFORM_BUFFER_OFFSET_ALIGNMENT` offsets, bound with `bindBufferRange` per draw.
  Layout per pass: `w[(k * out + j) * 4 + c]` is a vec4 over the 4 outputs of group
  `j` for input texture `k`, component `c`. `columnOf(k, c)` maps that slot to a
  weight column (`layer0Column`, `denseColumn` in `passesFor`).
- Layer 0 reads the encoded pixel inputs (`xTex`, `pixelVec4s` layers, computed
  once by `encodeFS` at setup from the hash grid and aux data, at most
  `MAX_ENCODE_TARGETS` layers per pass), then the light vec4, then two geometry
  vec4s for `geo` networks. The grid texture is at most `MAX_GRID_WIDTH` texels
  wide.
- The output layer is one pass writing into the slot's framebuffer in `outTex`.
- Passes that are not the tuned choice are deleted after tuning
  (`dropOtherPasses`).

### Precision

The hidden matmuls run in mediump, which phones execute at twice the rate (desktops
run it as highp anyway). Geometry stays highp, because positions and the log of a
distance do not survive f16, and so does the output layer, the same as the WebGPU
kernel: it is HDR and only 6 wide.

### Platform quirks

- The engine renders to an OffscreenCanvas (`createCanvas`) so it can hand over an ImageBitmap.
  Without OffscreenCanvas the canvas has to be read in the same frame it is drawn.
- No `invalidateFramebuffer` for tiled GPUs. ANGLE treats an array texture's layers
  as one image, so on D3D11 invalidating a pass's layers dropped the layers written
  before it, and on Vulkan (SwiftShader) each invalidation cleared the whole band,
  1.7x slower at stride 8.
- Fence state only changes between tasks, so fences are polled across tasks with a
  MessageChannel (`fence` in `util.js`, used by `whenIdle`) rather than spun.
- Needs `EXT_color_buffer_float` or `EXT_color_buffer_half_float`.

### Uniform and texture conventions

- Texture units (`UNIT`, `SAMPLER_UNITS`): 0 `src` / `outT` (input), 1 `resT`
  (resolved), 2 `posT` (positions), 4 `auxT`, 6 `gridT`. `bindTexture(unit, ...)`
  activates `TEXTURE0 + unit`. The `Wt` uniform block is bound at binding 0.
- `posMap` is (lowest position, step). `lInfo` is (slot, stride, disc shown), with
  stride `FULL_RES_STRIDE` (0) meaning the light's full-resolution image in
  `resT`.
- `layerFS` stages are `LAYER0_STAGE`, `HIDDEN_STAGE` and `OUTPUT_STAGE`.
- `resolve`'s `items` uniform is `(c0, c1, r0, r1)` and `keep` is
  `(x0, y0, x1, y1)`.
- The composite renders rows bottom first, which is what three.js render targets
  expect.

### Resolve

Folds one evaluation into a light's full-resolution image like the WebGPU resolve.
A pass cannot read the pixel it blends into, so it is drawn in three parts by
`side` (`SIDE`): `upsampled` (0) is upsampled pixels with nothing kept, `kept` (1)
the kept ones (blended by constant alpha), `evaluated` (2) the evaluated pixels.

### Timing

- With `EXT_disjoint_timer_query_webgl2` passes are timed by `TIME_ELAPSED` queries,
  discarded when the GPU reports a disjoint.
- Without it, a fence before and after the pass is watched every millisecond or so
  (`watchFences`, `FENCE_POLL_MS`), giving up after `FENCE_TIMEOUT_MS` (1000ms). Checking once a frame
  made every evaluation read as at least a frame long, and iPhones (no timer
  queries) ran far coarser strides than they needed to.
- `beginFrame`, `endFrame` and `flush` are no-ops: the WebGPU engine batches a
  frame's passes into one submit, and WebGL already does.
