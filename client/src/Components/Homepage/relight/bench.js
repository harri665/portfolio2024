// A bench for the relight engines, for perf/relight-bench.mjs. With
// ?relight=bench in the URL the CS home page starts no scene and loads this
// instead, which puts window.__relightBench up:
//   open({ tier, backend })   builds an engine ('webgpu' or 'webgl') at a size
//   time({ stride, n })       GPU ms per evaluation of a whole light (median)
//   render({ lights, stride, exposure })
//                             the composite of those lights (white, intensity
//                             1, discs shown) as base64 RGBA, rows bottom first
//   close()
// Nothing here runs on a normal visit.

import { createRelightEngine, loadRoom } from './prepare';
import { requestRelightDevice } from './RelightGPU';

const BAND_BYTES = 32 << 20;

let engine = null;
let device = null;

function finish() {
  if (engine.backend === 'webgpu') {
    return engine.device.queue.onSubmittedWorkDone();
  }
  // webgl fences only change between tasks, poll across them
  const gl = engine.gl;
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
        channel.port2.postMessage(0);
        return;
      }
      gl.deleteSync(sync);
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

function close() {
  engine?.dispose();
  engine = null;
}

async function open({ tier = 512, backend = 'webgpu' } = {}) {
  close();
  const signal = new AbortController().signal;
  if (backend === 'webgpu' && !device) {
    device = await requestRelightDevice();
  }
  const data = await loadRoom(tier, signal);
  const built = await createRelightEngine(data, backend === 'webgpu' ? device : null, BAND_BYTES, signal);
  engine = built.engine;
  // warm up so shader compiles aren't timed
  engine.evaluate(midLight(), 0, 8);
  await finish();
  engine.pollTiming();
  return {
    backend: engine.backend,
    notGPU: built.notGPU,
    size: engine.W,
    half: !!engine.half,
    network: `${engine.scene.network.width}x${engine.scene.network.hidden}`,
  };
}

function midLight() {
  const { lo, hi, rmin, rmax } = engine;
  return { pos: lo.map((v, i) => (v + hi[i]) / 2), radius: (rmin + rmax) / 2 };
}

async function time({ stride = 1, n = 8, batches = 3, light = midLight() } = {}) {
  const runs = [];
  for (let b = 0; b < batches; b += 1) {
    await finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i += 1) {
      engine.evaluate(light, i % 2, stride);
    }
    await finish();
    runs.push((performance.now() - t0) / n);
    engine.pollTiming();
  }
  runs.sort((a, b) => a - b);
  return { ms: runs[runs.length >> 1], runs, items: engine.rows(stride) * Math.ceil(engine.W / stride) };
}

// The composite of `lights` ([{pos, radius}]), each in a slot of its own, as
// base64 RGBA bytes, rows bottom first as the engines draw them
async function render({ lights, stride = 1, exposure = 1 }) {
  const shown = lights.map((l, i) => {
    engine.evaluate(l, i, stride);
    return { pos: l.pos, radius: l.radius, color: [1, 1, 1], intensity: 1, slot: i, stride, hidden: false };
  });
  engine.composite(shown, exposure);
  const image = engine.snapshot();
  const canvas = new OffscreenCanvas(engine.W, engine.H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  image.close?.();
  await finish();
  engine.pollTiming();
  const bytes = new Uint8Array(ctx.getImageData(0, 0, engine.W, engine.H).data.buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return { width: engine.W, height: engine.H, rgba: btoa(text) };
}

export function installBench() {
  window.__relightBench = { open, time, render, close };
}
