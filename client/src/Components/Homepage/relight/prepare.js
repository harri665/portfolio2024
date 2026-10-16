// gets the relit room ready while the CS page still shows the poster: device, fetch, build,
// and time the network on this gpu so the backdrop starts where it would've settled.
// doesn't need three.js, and yields to the page between steps

import {
  MIN_FPS,
  NETWORKS,
  firstBudget,
  firstNetwork,
  firstTier,
  tunedKernel,
  gpuName,
  loadProfile,
  measuredCosts,
  seedCosts,
  switchNetwork,
  upgradeTier,
} from './adaptiveQuality';
import { RESOLVED } from './RelightBase';
import { createFill, fillStep } from './lightWork';
import { RelightEngine } from './RelightEngine';
import { RelightGPUEngine, requestRelightDevice } from './RelightGPU';
import { loadRelightScene } from './scene';

// packed by perf/relight-pack.mjs
const roomUrl = (network) => `${process.env.PUBLIC_URL}/relight/cornell-${network}`;
export const NATIVE = 512;
const tierSuffix = (tier) => (tier === NATIVE ? '' : `-${tier}`);

export const COMPACT_QUERY = '(max-width: 768px), (pointer: coarse)';
// 32MB is ~20% faster than 8MB but phones don't have the memory
const BAND_BYTES = { compact: 16 << 20, full: 32 << 20 };
export const bandBytesFor = (compact) => (compact ? BAND_BYTES.compact : BAND_BYTES.full);
// full res images kept for where the key light is likely to go next, ~12 bytes a pixel each
// (3MB at 512, 7MB at 768)
const SPARE_BYTES = { compact: 8 << 20, full: 32 << 20 };
const MAX_SPARES = 6;

const BENCH_RUNS = 3;
// ms, the page is showing and might be scrolling
const BENCH_MAX_MS = 30;
const BENCH_LIMIT = 16;
const ROOM_MAX_DPR = 2;

export function loadRoom(tier, signal, priority, network = NETWORKS[0]) {
  return loadRelightScene(roomUrl(network), signal, tierSuffix(tier), priority);
}

export async function createRelightEngine(data, device, bandBytes, signal, kernel = null) {
  let notGPU = null;
  const compact = window.matchMedia?.(COMPACT_QUERY).matches ?? false;
  const spares = (compact ? SPARE_BYTES.compact : SPARE_BYTES.full) / (data.scene.width * data.scene.height * 12);
  const images = RESOLVED + Math.min(MAX_SPARES, Math.floor(spares));
  if (device) {
    try {
      return { engine: await RelightGPUEngine.create(device, data, { kernel, images }), notGPU };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      console.warn('Relight backdrop running on WebGL instead of WebGPU:', error);
      notGPU = `WebGPU couldn't build the network (${error.message})`;
    }
  }
  return { engine: new RelightEngine(data, { bandBytes, kernel, images }), notGPU };
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
  const profile = gpu ? loadProfile(gpu, MIN_FPS, webgl || !navigator.gpu ? 'webgl' : 'webgpu') : null;
  const bandBytes = bandBytesFor(compact);

  if (!webgl) {
    prep.device = requestRelightDevice();
    prep.device.catch(() => {});
  }
  let tier = firstTier(profile, compact);
  let network = firstNetwork(profile);
  const [device, data] = await Promise.all([
    prep.device?.catch(() => null) ?? null,
    loadRoom(tier, signal, 'low', network).catch((error) => {
      if (error?.name === 'AbortError' || (tier === NATIVE && network === NETWORKS[0])) {
        throw error;
      }
      tier = NATIVE;
      network = NETWORKS[0];
      return loadRoom(NATIVE, signal, 'low');
    }),
  ]);
  const kernel = tunedKernel(profile, network, device ? 'webgpu' : 'webgl');
  const built = await createRelightEngine(data, device, bandBytes, signal, kernel);
  prep.engine = built.engine;
  throwIfAborted(signal);
  let { engine } = built;
  engine.tuned = !!kernel && engine.kernelName === kernel;
  seedCosts(engine, profile);
  const result = {
    engine,
    notGPU: built.notGPU,
    device: prep.device,
    tier,
    network,
    timed: false,
    upgrade: null,
    upgradeFailed: false,
  };

  result.timed = await benchmark(engine, prep);
  await tune(engine, prep);

  const budget = firstBudget(profile, compact);
  result.fill = await prepareFill(result, { signal, budget, claimed: () => prep.claimed, claim: prep.claim });
  const change = () => {
    const other = switchNetwork(engine, budget);
    if (other) {
      return { tier, network: other };
    }
    const larger = upgradeTier(engine, budget, shownPx());
    return larger ? { tier: larger, network } : null;
  };
  let next = result.timed ? change() : null;
  while (next && !prep.claimed) {
    const controller = new AbortController();
    prep.upgrade = controller;
    const pending = loadRoom(next.tier, controller.signal, 'low', next.network);
    pending.catch(() => {});
    const arrived = await Promise.race([pending.then(() => true, () => true), prep.claim.then(() => false)]);
    throwIfAborted(signal);
    if (!arrived) {
      result.upgrade = { ...next, controller, data: pending };
      break;
    }
    prep.upgrade = null;
    let larger;
    try {
      const kernel = next.network === network && engine.tuned ? engine.kernelName : null;
      larger = await createRelightEngine(
        await pending,
        engine.backend === 'webgpu' ? device : null,
        bandBytes,
        signal,
        kernel
      );
      larger.engine.tuned = !!kernel;
    } catch (error) {
      throwIfAborted(signal);
      console.warn(`Relight backdrop staying at ${tier} px (${network}):`, error);
      result.upgradeFailed = true;
      break;
    }
    seedCosts(larger.engine, measuredCosts(engine));
    engine.dispose();
    engine = larger.engine;
    prep.engine = engine;
    throwIfAborted(signal);
    ({ tier, network } = next);
    Object.assign(result, { engine, tier, network });
    const timed = await benchmark(engine, prep);
    await tune(engine, prep);
    result.fill = await prepareFill(result, { signal, budget, claimed: () => prep.claimed, claim: prep.claim });
    next = timed ? change() : null;
  }
  return result;
}

// Only this async owner writes the engine until the promise hands it to install().
// Claiming races the yield, so a hidden tab does not hold startup hostage to an rAF.
// Partial bands and their image travel together and the visible renderer resumes them.
export async function prepareFill(built, { signal, budget = 8, claimed = () => false, claim = null, maxMs = Infinity }) {
  const { engine } = built;
  const fill = createFill(engine);
  built.fill = fill;
  const started = performance.now();
  while (!claimed() && !signal.aborted && fill.done < 1 && performance.now() - started < maxMs) {
    engine.beginFrame();
    let spent;
    try {
      spent = fillStep(engine, fill, Math.min(8, budget), true);
    } finally {
      engine.endFrame();
    }
    if (!(spent > 0)) break;
    await yieldPreparation(signal, claim);
    engine.pollTiming();
  }
  throwIfAborted(signal);
  return fill;
}

function yieldPreparation(signal, claim) {
  return new Promise((resolve) => {
    let frame;
    const done = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', done);
      resolve();
    };
    frame = requestAnimationFrame(done);
    signal.addEventListener('abort', done, { once: true });
    claim?.then(done);
    if (signal.aborted) done();
  });
}

// tuning on a 3080: ~15% faster on webgpu, 2x on webgl
const TUNE_MS = 24;

async function tune(engine, prep) {
  if (!prep.claimed) {
    await tuneEngine(engine, prep.controller.signal);
    throwIfAborted(prep.controller.signal);
  }
}

export async function tuneEngine(engine, signal = null, slot = 0) {
  const cost = engine.evalCost(1);
  if (engine.tuned || cost === null) {
    return;
  }
  const stride = [1, 2, 4].find((s) => engine.evalCost(s) <= BENCH_MAX_MS) ?? 8;
  const runs = Math.min(8, Math.max(2, Math.ceil(TUNE_MS / engine.evalCost(stride))));
  const { lo, hi, rmin, rmax } = engine;
  const light = { pos: lo.map((v, i) => (v + hi[i]) / 2), radius: (rmin + rmax) / 2 };
  await engine.tune(light, stride, runs, signal, slot);
  if (!signal?.aborted) {
    engine.tuned = true;
  }
}

// whole light at every 16th pixel is so few pixels the per pass overhead dominates. an AMD 860M
// read 330ms for a light that takes 47 and got stuck at every 16th pixel
export function benchStride(engine) {
  const known = Object.keys(engine.timing.byStride).map(Number);
  if (!known.length) {
    return null;
  }
  const finest = [1, 2, 4].find((s) => engine.evalCost(s) <= BENCH_MAX_MS) ?? 8;
  // Cropped/banded refinement can finish without a large enough timing sample.
  // Validate a transferred profile on this engine before it can block adaptation
  // forever. The caller runs this only at rest and caps the number of attempts.
  if (engine.timing.seeded) return finest;
  return finest < Math.min(...known) ? finest : null;
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
