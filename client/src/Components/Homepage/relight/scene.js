// Loading a scene exported by the relight project (scene.json, model.bin,
// pixels.bin): a Cornell box, the network that relights it, and the
// per-pixel geometry the network reads. Shared by both engines; the WebGL one
// also needs the network's pixel inputs prepared on the CPU (encodePixels),
// which the WebGPU one prepares on the GPU.

const f16tab = (() => {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h += 1) {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 31;
    const m = h & 1023;
    t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return t;
})();

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
// ms between yields to the page
const SLICE_MS = 6;
// Halves converted between looks at the clock
const DECODE_STEP = 1 << 16;

// An array of the file, as float32. Halves are converted a slice at a time,
// yielding between them: at 768 px the pixels are ~8M of them, which held
// the page for a few hundred ms on a phone.
async function typed(buf, entry, signal) {
  const n = entry.shape.reduce((a, b) => a * b, 1);
  if (entry.dtype === 'float32') {
    return new Float32Array(buf, entry.offset, n);
  }
  const h = new Uint16Array(buf, entry.offset, n);
  const out = new Float32Array(n);
  let slice = performance.now();
  for (let i0 = 0; i0 < n; i0 += DECODE_STEP) {
    const i1 = Math.min(n, i0 + DECODE_STEP);
    for (let i = i0; i < i1; i += 1) {
      out[i] = f16tab[h[i]];
    }
    if (performance.now() - slice > SLICE_MS) {
      await nextTask();
      throwIfAborted(signal);
      slice = performance.now();
    }
  }
  return out;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('aborted', 'AbortError');
  }
}

// Fetches and unpacks a scene. `suffix` picks another image size of the same
// network (scene-768.json and pixels-768.bin for '-768'); model.bin is shared.
// `priority` is the fetches' (fetch's own; 'low' to stay behind the page's).
// Returns { scene, layers, grid, gridOff, aux, geom, normal }: the network's
// layers ({w, b, shape}), its multi-resolution grids flattened into one
// array, and per pixel the aux features, geometry (position, camera distance)
// and shading normal.
export async function loadRelightScene(base, signal, suffix = '', priority = 'auto') {
  const get = async (file) => {
    const response = await fetch(`${base}/${file}`, { signal, priority });
    if (!response.ok) {
      throw new Error(`failed to load ${file} (${response.status})`);
    }
    return response;
  };
  const scene = await (await get(`scene${suffix}.json`)).json();
  const [model, pixels] = await Promise.all(
    ['model.bin', `pixels${suffix}.bin`].map(async (file) => (await get(file)).arrayBuffer())
  );
  if (scene.network.light_grid) {
    throw new Error('light_grid models are not supported');
  }
  await nextTask();
  throwIfAborted(signal);

  let gridLen = 0;
  const gridOff = scene.model.grids.map((g) => {
    const offset = gridLen;
    gridLen += g.shape[0] * g.shape[1] * g.shape[2];
    return offset;
  });
  const grid = new Float32Array(gridLen);
  for (let i = 0; i < scene.model.grids.length; i += 1) {
    grid.set(await typed(model, scene.model.grids[i], signal), gridOff[i]);
  }
  const layers = [];
  for (const l of scene.model.layers) {
    layers.push({
      w: await typed(model, l.weight, signal),
      b: await typed(model, l.bias, signal),
      shape: l.weight.shape,
    });
  }
  const aux = await typed(pixels, scene.pixels.aux, signal);
  const geom = await typed(pixels, scene.pixels.geom, signal);
  const normal = await typed(pixels, scene.pixels.normal, signal);
  await nextTask();
  throwIfAborted(signal);

  return { scene, layers, grid, gridOff, aux, geom, normal };
}

// The WebGL engine's light-independent network inputs for every pixel, its
// grid encoding and the aux features, as X [group][pixel][4], plus the
// normals padded to 4. Yields every few ms so the page keeps scrolling.
export async function encodePixels({ scene, grid, gridOff, aux, normal }, signal) {
  const W = scene.width;
  const H = scene.height;
  const NP = W * H;
  const net = scene.network;
  const auxDim = net.aux_dim ?? 7;
  const levels = net.grid_res.length;
  const F = net.feats;
  const ENC = levels * F;
  const XG = Math.ceil((ENC + auxDim) / 4);
  const X = new Float32Array(XG * NP * 4);
  const put = (p, f, v) => {
    X[((f >> 2) * NP + p) * 4 + (f & 3)] = v;
  };
  let slice = performance.now();
  for (let y = 0; y < H; y += 1) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x += 1) {
      const p = y * W + x;
      const u = (x + 0.5) / W;
      for (let l = 0; l < levels; l += 1) {
        const R = net.grid_res[l];
        const b = gridOff[l];
        const fx = u * (R - 1);
        const fy = v * (R - 1);
        const x0 = Math.min(Math.floor(fx), R - 2);
        const y0 = Math.min(Math.floor(fy), R - 2);
        const tx = fx - x0;
        const ty = fy - y0;
        const i00 = b + (y0 * R + x0) * F;
        const i10 = i00 + R * F;
        for (let f = 0; f < F; f += 1) {
          const top = grid[i00 + f] + (grid[i00 + F + f] - grid[i00 + f]) * tx;
          const bot = grid[i10 + f] + (grid[i10 + F + f] - grid[i10 + f]) * tx;
          put(p, l * F + f, top + (bot - top) * ty);
        }
      }
      for (let j = 0; j < auxDim; j += 1) {
        put(p, ENC + j, aux[p * auxDim + j]);
      }
    }
    if (performance.now() - slice > SLICE_MS) {
      await nextTask();
      throwIfAborted(signal);
      slice = performance.now();
    }
  }

  const normal4 = new Float32Array(NP * 4);
  for (let p = 0; p < NP; p += 1) {
    normal4[p * 4] = normal[p * 3];
    normal4[p * 4 + 1] = normal[p * 3 + 1];
    normal4[p * 4 + 2] = normal[p * 3 + 2];
  }
  return { X, XG, normal4 };
}
