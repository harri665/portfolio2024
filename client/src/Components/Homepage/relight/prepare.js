// Gets the relit room ready while the CS home page still shows its still.
// The live scene waits for the visitor to move, or 3.5 s after load
// (sceneStart), so parsing three.js doesn't hold up the page. The room's
// network doesn't need three.js: it runs on a WebGPU device or a WebGL2
// context of its own. So in that wait, from 2 s after load (Prism.js):
// - the WebGPU device is asked for, the room fetched at the size this
//   device starts at, and the network built, its shaders compiled
// - a light is evaluated a few times to time the network on this GPU, at
//   the finest stride that holds the GPU no longer than BENCH_MAX_MS
// - with those costs, a GPU with room to spare fetches the next size up and
//   is timed there too, so the room starts at the size it would have swapped
//   up to a few seconds in
// The backdrop takes it when it mounts (takePreparedRelight), however far it
// got: for a visitor who moves straight away it's still the room loading, and
// a larger size on its way carries on in the backdrop. What it measured
// stands in for the backdrop's own first measurements, so the first frames
// show the room at the strides this GPU can afford instead of at a guess.
// Nothing here is drawn, and no frame waits on it: it yields to the page
// between steps and polls the GPU once a frame.

import {
  MIN_FPS,
  firstBudget,
  firstTier,
  gpuName,
  loadProfile,
  measuredCosts,
  seedCosts,
  upgradeTier,
} from './adaptiveQuality';
import { RelightEngine } from './RelightEngine';
import { RelightGPUEngine, requestRelightDevice } from './RelightGPU';
import { encodePixels, loadRelightScene } from './scene';

const SCENE_URL = `${process.env.PUBLIC_URL}/relight/cornell`;
export const NATIVE = 512;
const tierSuffix = (tier) => (tier === NATIVE ? '' : `-${tier}`);

export const COMPACT_QUERY = '(max-width: 768px), (pointer: coarse)';
// 32MB is ~20% faster than 8MB but phones don't have the memory
const BAND_BYTES = { compact: 16 << 20, full: 32 << 20 };
export const bandBytesFor = (compact) => (compact ? BAND_BYTES.compact : BAND_BYTES.full);

const BENCH_RUNS = 3;
// ms, the page is showing and might be scrolling
const BENCH_MAX_MS = 30;
const BENCH_LIMIT = 16;
const ROOM_MAX_DPR = 2;

// The room at `tier` px; a missing size falls back to the one every device has
export function loadRoom(tier, signal, priority) {
  return loadRelightScene(SCENE_URL, signal, tierSuffix(tier), priority);
}

// The network for a loaded scene: on `device` (WebGPU) if there is one and
// it can run it, else on WebGL. Returns { engine, notGPU }: why the device
// couldn't run it, if it couldn't.
export async function createRelightEngine(data, device, bandBytes, signal) {
  let notGPU = null;
  if (device) {
    try {
      return { engine: await RelightGPUEngine.create(device, data), notGPU };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      console.warn('Relight backdrop running on WebGL instead of WebGPU:', error);
      notGPU = `WebGPU couldn't build the network (${error.message})`;
    }
  }
  return { engine: new RelightEngine(data, await encodePixels(data, signal), { bandBytes }), notGPU };
}

let current = null;
// so a late import doesn't build a second network
let taken = false;

export function prepareRelight() {
  if (current || taken || navigator.connection?.saveData) {
    return;
  }
  const prep = {
    controller: new AbortController(),
    upgrade: null,
    device: null,
    engine: null,
    claimed: false,
    settled: false,
    disposed: false,
  };
  prep.claim = new Promise((resolve) => {
    prep.onClaim = resolve;
  });
  prep.result = run(prep)
    .catch((error) => {
      if (prep.controller.signal.aborted) {
        dispose(prep);
        return null;
      }
      return { error };
    })
    .finally(() => {
      prep.settled = true;
    });
  current = prep;
}

// For the backdrop: a promise of what was prepared, as soon as it has an
// engine; null if nothing was. It owns the engine and the device from then
// on. Resolves to { engine, notGPU, device, tier, timed, upgrade,
// upgradeFailed } or { error }. `device` is the WebGPU device request (a
// promise, which rejects saying why there's none) or null; `upgrade` a
// larger size still on its way ({ tier, controller, data }), for the
// backdrop to swap in.
export function takePreparedRelight() {
  taken = true;
  const prep = current;
  current = null;
  if (!prep) {
    return Promise.resolve(null);
  }
  prep.claimed = true;
  prep.onClaim();
  return prep.result;
}

export function cancelPreparedRelight() {
  taken = false;
  const prep = current;
  current = null;
  if (!prep) {
    return;
  }
  prep.controller.abort();
  prep.upgrade?.abort();
  if (prep.settled) {
    dispose(prep);
  }
}

function dispose(prep) {
  if (prep.disposed) {
    return;
  }
  prep.disposed = true;
  prep.engine?.dispose();
  prep.device?.then((device) => device.destroy()).catch(() => {});
}

async function run(prep) {
  const { signal } = prep.controller;
  const compact = window.matchMedia?.(COMPACT_QUERY).matches ?? false;
  const webgl = new URLSearchParams(window.location.search).get('relight') === 'webgl';
  const gpu = probeGpu();
  const profile = gpu ? loadProfile(gpu, MIN_FPS) : null;
  const bandBytes = bandBytesFor(compact);

  if (!webgl) {
    prep.device = requestRelightDevice();
    prep.device.catch(() => {});
  }
  let tier = firstTier(profile, compact);
  const [device, data] = await Promise.all([
    prep.device?.catch(() => null) ?? null,
    loadRoom(tier, signal, 'low').catch((error) => {
      if (error?.name === 'AbortError' || tier === NATIVE) {
        throw error;
      }
      tier = NATIVE;
      return loadRoom(NATIVE, signal, 'low');
    }),
  ]);
  const built = await createRelightEngine(data, device, bandBytes, signal);
  prep.engine = built.engine;
  throwIfAborted(signal);
  let { engine } = built;
  seedCosts(engine, profile);
  const result = {
    engine,
    notGPU: built.notGPU,
    device: prep.device,
    tier,
    timed: false,
    upgrade: null,
    upgradeFailed: false,
  };

  result.timed = await benchmark(engine, prep);

  // A size up, while the GPU has room for it and the backdrop hasn't started
  const budget = firstBudget(profile, compact);
  let next = result.timed ? upgradeTier(engine, budget, shownPx()) : null;
  while (next && !prep.claimed) {
    const controller = new AbortController();
    prep.upgrade = controller;
    const pending = loadRoom(next, controller.signal, 'low');
    pending.catch(() => {});
    const arrived = await Promise.race([pending.then(() => true, () => true), prep.claim.then(() => false)]);
    throwIfAborted(signal);
    if (!arrived) {
      result.upgrade = { tier: next, controller, data: pending };
      break;
    }
    prep.upgrade = null;
    let larger;
    try {
      larger = await createRelightEngine(await pending, engine.backend === 'webgpu' ? device : null, bandBytes, signal);
    } catch (error) {
      throwIfAborted(signal);
      console.warn(`Relight backdrop staying at ${tier} px:`, error);
      result.upgradeFailed = true;
      break;
    }
    seedCosts(larger.engine, measuredCosts(engine));
    engine.dispose();
    engine = larger.engine;
    prep.engine = engine;
    throwIfAborted(signal);
    tier = next;
    Object.assign(result, { engine, tier });
    // taken before it's timed, it runs on the smaller size's costs
    const timed = await benchmark(engine, prep);
    next = timed ? upgradeTier(engine, budget, shownPx()) : null;
  }
  return result;
}

async function benchmark(engine, prep) {
  const { signal } = prep.controller;
  const { lo, hi, rmin, rmax } = engine;
  const light = { pos: lo.map((v, i) => (v + hi[i]) / 2), radius: (rmin + rmax) / 2 };
  let stride = 0;
  let runs = 0;
  for (let i = 0; i < BENCH_LIMIT && !prep.claimed; i += 1) {
    const cost = engine.timing.seeded ? null : engine.evalCost(1);
    const finest = cost === null ? 8 : ([1, 2, 4].find((s) => engine.evalCost(s) <= BENCH_MAX_MS) ?? 8);
    if (finest !== stride) {
      stride = finest;
      runs = 0;
    }
    if (runs >= BENCH_RUNS) {
      return true;
    }
    const before = engine.timing.byStride[stride];
    engine.evaluate(light, 0, stride);
    await measured(engine, prep);
    throwIfAborted(signal);
    if (!engine.timing.seeded && engine.timing.byStride[stride] !== before) {
      runs += 1;
    }
  }
  return !prep.claimed && !engine.timing.seeded && engine.evalCost(1) !== null;
}

async function measured(engine, prep) {
  do {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    engine.pollTiming();
  } while (engine.timing.pending && !prep.claimed && !prep.controller.signal.aborted);
}

// three.js hasn't made a context yet so grab our own
function probeGpu() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      return null;
    }
    const name = gpuName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return null;
  }
}

function shownPx() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const size = vw < 640 ? Math.min(vw * 1.2, vh * 0.6) : Math.min(vw * 0.9, vh * 0.86);
  return size * Math.min(window.devicePixelRatio || 1, ROOM_MAX_DPR);
}

function throwIfAborted(signal) {
  if (signal.aborted) {
    throw new DOMException('aborted', 'AbortError');
  }
}
