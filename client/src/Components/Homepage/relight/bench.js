// ?relight=bench, used by perf/relight-bench.mjs. exposes window.__relightBench
// with open / time / render / accumulate / tune / close. never runs on a normal visit

import { createRelightEngine, loadRoom } from './prepare';
import { phaseOrder } from './RelightBase';
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

async function open({ tier = 512, backend = 'webgpu', network, kernel = null, bandBytes = BAND_BYTES } = {}) {
  close();
  const signal = new AbortController().signal;
  if (backend === 'webgpu' && !device) {
    device = await requestRelightDevice();
  }
  const data = await loadRoom(tier, signal, 'auto', network);
  const built = await createRelightEngine(data, backend === 'webgpu' ? device : null, bandBytes, signal, kernel);
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
    kernel: engine.kernelName,
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

async function render({ lights, stride = 1, exposure = 1, rect = [] }) {
  const shown = lights.map((l, i) => {
    engine.evaluate(l, i, stride, ...rect);
    return { pos: l.pos, radius: l.radius, color: [1, 1, 1], intensity: 1, slot: i, stride, hidden: false };
  });
  engine.composite(shown, exposure);
  return readImage();
}

// moves a light from `from` to `to` over `frames` frames the way the backdrop does, each frame a
// different phase folded in by how far it moved. scored against every pixel at `to`.
// accumulate false is one evaluation at phase 0 each frame, how the backdrop used to look
async function accumulate({ from, to, frames = 16, stride = 8, trust = 0.06, accumulate = true, exposure = 1 }) {
  const all = [0, engine.rows(stride), 0, engine.cols(stride)];
  const order = phaseOrder(stride);
  let kept = null;
  let prev = null;
  for (let i = 0; i < frames; i += 1) {
    const t = frames > 1 ? i / (frames - 1) : 1;
    const light = { pos: from.map((v, k) => v + (to[k] - v) * t), radius: engine.rmin };
    const moved = prev ? distance(light.pos, prev) : Infinity;
    const alpha = accumulate && prev ? 1 - Math.exp(-moved / trust) : 1;
    const phase = accumulate ? order[i % order.length] : [0, 0];
    engine.evaluate(light, 0, stride, ...all, phase);
    kept = engine.resolve(0, 0, stride, phase, all, alpha, kept);
    prev = light.pos;
  }
  const light = { pos: to, radius: engine.rmin, color: [1, 1, 1], intensity: 1, hidden: false };
  engine.composite([{ ...light, resolved: 0 }], exposure);
  const got = await readImage();
  const ref = await render({ lights: [light], stride: 1, exposure });
  return { psnr: psnr(got.rgba, ref.rgba) };
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function psnr(a, b) {
  const x = atob(a);
  const y = atob(b);
  let se = 0;
  let n = 0;
  for (let i = 0; i < x.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const d = x.charCodeAt(i + c) - y.charCodeAt(i + c);
      se += d * d;
      n += 1;
    }
  }
  return se ? 10 * Math.log10((255 * 255 * n) / se) : Infinity;
}

async function readImage() {
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

function tune({ stride = 1, runs = 4 } = {}) {
  return engine.tune(midLight(), stride, runs);
}

export function installBench() {
  window.__relightBench = { open, time, render, accumulate, tune, close };
}
