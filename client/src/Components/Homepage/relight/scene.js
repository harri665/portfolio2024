// loads a room packed by perf/relight-pack.mjs. halves stay 16-bit, widening them
// to f32 here used to block the page for a few hundred ms on phones

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
// ms between yields to the page
const SLICE_MS = 6;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('aborted', 'AbortError');
  }
}

function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 31;
  const m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}

function floats(buf, entry) {
  const n = entry.shape.reduce((a, b) => a * b, 1);
  if (entry.dtype === 'float32') {
    return new Float32Array(buf, entry.offset, n);
  }
  return Float32Array.from(new Uint16Array(buf, entry.offset, n), halfToFloat);
}

// undoes relight-pack's planes: row deltas, low bytes then high bytes
async function unpackPlanes(bytes, W, H, channels, at, out, signal) {
  const NP = W * H;
  let slice = performance.now();
  for (let k = 0; k < channels; k += 1) {
    const lo = k * NP * 2;
    const hi = lo + NP;
    for (let y = 0; y < H; y += 1) {
      let v = 0;
      for (let p = y * W, end = p + W; p < end; p += 1) {
        v = (v + (bytes[lo + p] | (bytes[hi + p] << 8))) & 0xffff;
        out[at(p, k)] = v;
      }
      if ((y & 31) === 31 && performance.now() - slice > SLICE_MS) {
        await nextTask();
        throwIfAborted(signal);
        slice = performance.now();
      }
    }
  }
  return out;
}

// suffix picks another size of the same network ('-768'), model.bin is shared.
// pos is u16 over scene.pixels.pos.range from 1, 0 = pixel sees nothing
export async function loadRelightScene(base, signal, suffix = '', priority = 'auto') {
  const get = async (file) => {
    const response = await fetch(`${base}/${file}`, { signal, priority });
    if (!response.ok) {
      throw new Error(`failed to load ${file} (${response.status})`);
    }
    return response;
  };
  const scene = await (await get(`scene${suffix}.json`)).json();
  if (scene.pixels?.format !== 2) {
    throw new Error('the room needs packing (perf/relight-pack.mjs)');
  }
  if (scene.network.light_grid) {
    throw new Error('light_grid models are not supported');
  }
  const [model, pixels] = await Promise.all(
    ['model.bin', scene.pixels.file ?? `pixels${suffix}.bin`].map(async (file) => (await get(file)).arrayBuffer())
  );
  throwIfAborted(signal);

  let gridLen = 0;
  const gridOff = scene.model.grids.map((g) => {
    if (g.dtype !== 'float16') {
      throw new Error('the grids must be float16');
    }
    const offset = gridLen;
    gridLen += g.shape[0] * g.shape[1] * g.shape[2];
    return offset;
  });
  const grid = new Uint16Array(gridLen);
  scene.model.grids.forEach((g, i) => {
    grid.set(new Uint16Array(model, g.offset, g.shape[0] * g.shape[1] * g.shape[2]), gridOff[i]);
  });
  const layers = scene.model.layers.map((l) => ({
    w: floats(model, l.weight),
    b: floats(model, l.bias),
    shape: l.weight.shape,
  }));

  const W = scene.width;
  const H = scene.height;
  const NP = W * H;
  const plane = (entry) => new Uint8Array(pixels, entry.offset, entry.bytes);
  const aux = await unpackPlanes(
    plane(scene.pixels.aux),
    W,
    H,
    scene.pixels.aux.channels,
    (p, k) => ((k >> 2) * NP + p) * 4 + (k & 3),
    new Uint16Array(NP * 8),
    signal
  );
  const pos = await unpackPlanes(
    plane(scene.pixels.pos),
    W,
    H,
    3,
    (p, k) => p * 4 + k,
    new Uint16Array(NP * 4),
    signal
  );
  throwIfAborted(signal);

  return { scene, layers, grid, gridOff, aux, pos };
}
