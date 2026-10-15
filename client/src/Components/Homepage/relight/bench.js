// ?relight=bench, used by perf/relight-bench.mjs. exposes window.__relightBench
// with open / time / frame / render / accumulate / tune / close. never runs on a normal visit

import { createRelightEngine, loadRoom } from './prepare';
import { phaseOrder } from './RelightBase';
import { requestRelightDevice } from './RelightGPU';
import { GPURoomLayer } from './roomLayer';

const BAND_BYTES = 32 << 20;
// ms a frame stage's batch should take at least, and the most runs one gets
const FRAME_BATCH_MS = 100;
const MAX_FRAME_RUNS = 256;

let engine = null;
let device = null;
// stands in for the room layer, which takes each image into its own webgl context
let presenter = null;
// the webgpu engine's own room layer, drawn on this page like the backdrop's
let room = null;

function finish() {
  if (engine.backend === 'webgpu') {
    return engine.device.queue.onSubmittedWorkDone();
  }
  return fence(engine.gl);
}

// webgl fences only change between tasks, poll across them
function fence(gl) {
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
  room?.dispose();
  room = null;
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

// a frame the way the backdrop runs a moving light, a stage at a time: the network, folding it
// into the light's image, the composite, and handing the image to another webgl context.
// snapshot and present are timed with a composite in front (they need a new image), taken off after.
// composites the view of the walked-in box on this screen like the backdrop, null for the whole image.
// webgpu presents differently now: glass is the half size copy three.js takes for the glass (one
// every 50ms at most, not every frame), room the room layer drawing from the engine's image on its
// own device. direct totals that way, with a glass copy every frame
async function frame({ stride = 4, n = 4, batches = 3, light = midLight(), view = walkedIn() } = {}) {
  const all = [0, engine.rows(stride), 0, engine.cols(stride)];
  const order = phaseOrder(stride);
  const whole = [0, engine.W, 0, engine.H];
  const shown = [{ ...light, color: [1, 1, 1], intensity: 1, resolved: 0, hidden: false }];
  engine.evaluate(light, 0, stride, ...all);
  engine.resolve(0, 0, stride, order[0], all, 1);
  const stages = {
    evaluate: (i) => engine.evaluate(light, 0, stride, ...all, order[i % order.length]),
    resolve: (i) => engine.resolve(0, 0, stride, order[i % order.length], all, 0.5, whole),
    composite: () => engine.composite(shown, 1, view),
    // the three above in one submit, the way a frame of the backdrop runs them
    oneSubmit: (i) => {
      engine.beginFrame();
      stages.evaluate(i);
      stages.resolve(i);
      stages.composite();
      engine.endFrame();
    },
    snapshot: () => {
      engine.composite(shown, 1, view);
      engine.snapshot().close?.();
    },
    ...(engine.backend === 'webgpu' && {
      glass: () => {
        engine.composite(shown, 1, view);
        engine.halfImage(present);
      },
      room: () => {
        engine.composite(shown, 1, view);
        drawRoom();
      },
    }),
    present: () => {
      engine.composite(shown, 1, view);
      present(engine.snapshot());
    },
  };
  // waiting on the gpu has a fixed latency (tens of ms for the other context's fence, and noisy
  // on webgl), so each stage runs in batches long enough to bury it, less the latency of an empty one
  const wait = async (other) => {
    await finish();
    if (other) {
      await fence(presenter.gl);
    }
  };
  const batch = async (run, other, count) => {
    const runs = [];
    for (let b = 0; b < batches; b += 1) {
      await wait(other);
      const t0 = performance.now();
      for (let i = 0; i < count; i += 1) {
        run(i);
      }
      await wait(other);
      runs.push(performance.now() - t0);
      engine.pollTiming();
    }
    runs.sort((a, b) => a - b);
    return runs[runs.length >> 1];
  };
  present(engine.snapshot());
  const idle = { engine: await batch(() => {}, false, 0), both: await batch(() => {}, true, 0) };
  const ms = {};
  for (const [name, run] of Object.entries(stages)) {
    const other = name === 'present' || name === 'glass';
    const empty = idle[other ? 'both' : 'engine'];
    let count = n;
    let took = await batch(run, other, count);
    while (took < Math.max(FRAME_BATCH_MS, 10 * empty) && count < MAX_FRAME_RUNS) {
      count *= 2;
      took = await batch(run, other, count);
    }
    ms[name] = Math.max(0, took - empty) / count;
  }
  // snapshot is taking the image off the canvas, upload is the other context taking it in
  ms.upload = Math.max(0, ms.present - ms.snapshot);
  ms.snapshot = Math.max(0, ms.snapshot - ms.composite);
  ms.present = ms.snapshot + ms.upload;
  ms.total = ms.evaluate + ms.resolve + ms.composite + ms.present;
  if (ms.glass != null) {
    ms.glass = Math.max(0, ms.glass - ms.composite);
    ms.room = Math.max(0, ms.room - ms.composite);
    ms.direct = ms.evaluate + ms.resolve + ms.composite + ms.glass + ms.room;
  }
  return ms;
}

// the walked-in room at this page's size and dpr
function drawRoom() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!room) {
    const host = document.body.appendChild(document.createElement('div'));
    room = new GPURoomLayer(host, engine);
    const size = Math.max(vw, vh) * 1.04;
    const value = (x, y = 0, z = 0, w = 0) => ({ value: { x, y, z, w } });
    room.uniforms = {
      texSize: value(1, 1),
      box: value(vw / 2 - size / 2, vh / 2 - size / 2, size, 0.03),
      ready: { value: 1 },
      dim: { value: 0.4 },
      saturation: { value: 0.55 },
      hotKeep: { value: 0.35 },
      glowAt: value(vw * 0.4, vh * 0.4, 30),
      glowColor: value(0.4, 0.3, 0.2),
    };
  }
  room.setImage();
  room.draw(room.uniforms, vw, vh, Math.min(window.devicePixelRatio || 1, 2));
}

// RelightBackdrop's box once walked in (max side * 1.04, centred) and its view margin
function walkedIn() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const size = Math.max(vw, vh) * 1.04;
  const m = 0.03;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  return [(size - vw) / 2 / size - m, (size + vw) / 2 / size + m, (size - vh) / 2 / size - m, (size + vh) / 2 / size + m].map(clamp);
}

function present(image) {
  if (!presenter) {
    // a page canvas like the room layer's, an offscreen one takes another path in chrome
    const gl = document.createElement('canvas').getContext('webgl2', { alpha: false, antialias: false, depth: false });
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    presenter = { gl };
  }
  const { gl } = presenter;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  image.close?.();
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
  window.__relightBench = { open, time, frame, render, accumulate, tune, close };
}
