// The relight network on WebGPU: the forward pass of my relight project's
// WebGPU runtime, trimmed to what the backdrop needs. A compute kernel runs
// the whole MLP per workgroup tile of pixels in workgroup memory, where WebGL2
// needs a chain of fragment passes through textures; on an RTX 3080 a light
// at 512 px takes ~5 ms here against ~21 ms there.
//
// It runs on a device of its own, beside three.js's WebGL2 context. The
// composite draws the lit room into an OffscreenCanvas of this device and
// hands it over as an ImageBitmap, which three.js uploads as a texture
// (~0.3 ms a frame at 512 px on an RTX 3080). Unlike the canvas itself,
// which holds its image only until the browser next presents it, the
// bitmap keeps it however late three.js draws.
//
// Unlike the relight project, which keeps the first layer's light-independent
// part per pixel (128 floats, 134 MB at 512 px), this keeps the network's
// pixel inputs (39 halves, 21 MB) and runs the first layer in the kernel: a
// little more arithmetic for a sixth of the memory, which phones need.
//
// Where the GPU has 16-bit floats (shader-f16), the network runs in them:
// a third faster on an RTX 3080, and phone GPUs do twice the f16 arithmetic.
// The image moves by at most 3/255 and almost nowhere by more than 1.

/* global GPUBufferUsage, GPUMapMode, BigUint64Array */
import { RelightBase, SLOTS } from './RelightBase';

// Workgroup sizes to try, largest first; each thread computes 4 pixels x 4
// channels, so a workgroup of T threads covers T / (width / 4) * 4 pixels
const THREADS = [256, 128];

// Workgroup memory (bytes) a workgroup of `threads` needs: the activations
// of its tile, each pixel's geometric features, and the three outputs
function workgroupBytes(threads, width, half) {
  const tile = (threads / (width / 4)) * 4;
  return tile * width * (half ? 2 : 4) + tile * 32 + tile * 12;
}

// A device for the relight network; throws, saying why, where WebGPU can't
// run it. It asks for the adapter's own workgroup memory limit, as the
// default (16 KB) only fits the smaller workgroup.
export async function requestRelightDevice() {
  if (!navigator.gpu) {
    throw new Error(window.isSecureContext ? 'this browser has no WebGPU' : 'WebGPU needs HTTPS');
  }
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('this browser has no OffscreenCanvas');
  }
  // The default adapter, as WebGL uses: on a laptop with two GPUs, the image
  // mustn't have to cross between them every frame
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('the browser offers no WebGPU adapter for this GPU');
  }
  const L = adapter.limits;
  const features = ['timestamp-query', 'shader-f16'].filter((f) => adapter.features.has(f));
  return adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: {
      maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize,
      maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
      maxBufferSize: L.maxBufferSize,
    },
  });
}

const u = (x) => `${x >>> 0}u`;

// float32 -> float16 bits, rounded to nearest even
function toHalf(values) {
  const out = new Uint16Array(values.length);
  const f = new Float32Array(1);
  const bits = new Uint32Array(f.buffer);
  for (let k = 0; k < values.length; k += 1) {
    f[0] = values[k];
    const x = bits[0];
    const sign = (x >>> 16) & 0x8000;
    const e = ((x >>> 23) & 0xff) - 112;
    let m = x & 0x7fffff;
    if (e <= 0) {
      // subnormal, or too small for a half
      out[k] = e < -10 ? sign : sign | ((m | 0x800000) >> (14 - e));
    } else if (e >= 31) {
      out[k] = sign | 0x7c00;
    } else {
      const rest = m & 0x1fff;
      m >>= 13;
      let h = sign | (e << 10) | m;
      if (rest > 0x1000 || (rest === 0x1000 && m & 1)) {
        h += 1;
      }
      out[k] = h;
    }
  }
  return out;
}

// Geometric features of a pixel (position x, normal n) for a sphere light
// (centre, radius): f0 = (direction to the light, cosine), f1 = (0.5 ln d,
// 0.25 ln solid angle, G, valid), where G is the unshadowed irradiance factor
const GEO_WGSL = /* wgsl */ `
const PI = 3.14159265358979;
struct Geo { f0: vec4f, f1: vec4f };
fn geoFeatures(x: vec4f, n: vec3f, lc: vec4f) -> Geo {
  var o: Geo;
  if (x.w <= 0.0) { return o; }
  let v = lc.xyz - x.xyz;
  let d = max(length(v), 1e-4);
  let l = v / d;
  let cs = dot(n, l);
  let s = min(lc.w / d, 1.0);
  let om = 2.0 * PI * s * s / (1.0 + sqrt(max(1.0 - s * s, 0.0)));
  o.f0 = vec4f(l, cs);
  o.f1 = vec4f(0.5 * log(d), 0.25 * log(om + 1e-6), om * max(cs, 0.0) / PI, 1.0);
  return o;
}
`;

// Per pixel: the grid encoding and aux features, packed as pairs of halves
function precomputeWGSL({ W, H, levels, feats, gridRes, gridOff, auxDim, XW }) {
  const arr = (a) => `array<u32, ${a.length}>(${a.map(u).join(', ')})`;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> grid: array<f32>;
@group(0) @binding(1) var<storage, read> auxB: array<f32>;
@group(0) @binding(2) var<storage, read_write> X: array<u32>;
var<private> RES: array<u32, ${levels}> = ${arr(gridRes)};
var<private> GOFF: array<u32, ${levels}> = ${arr(gridOff)};
const W = ${u(W)}; const H = ${u(H)}; const F = ${u(feats)};

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x;
  if (p >= W * H) { return; }
  let uu = (f32(p % W) + 0.5) / f32(W);
  let vv = (f32(p / W) + 0.5) / f32(H);
  var x: array<f32, ${XW * 2}>;
  for (var l = 0u; l < ${u(levels)}; l++) {
    let R = RES[l];
    let fx = uu * f32(R - 1u); let fy = vv * f32(R - 1u);
    let x0 = min(u32(floor(fx)), R - 2u); let y0 = min(u32(floor(fy)), R - 2u);
    let tx = fx - f32(x0); let ty = fy - f32(y0);
    let b = GOFF[l];
    for (var f = 0u; f < F; f++) {
      let v00 = grid[b + (y0 * R + x0) * F + f];
      let v01 = grid[b + (y0 * R + x0 + 1u) * F + f];
      let v10 = grid[b + ((y0 + 1u) * R + x0) * F + f];
      let v11 = grid[b + ((y0 + 1u) * R + x0 + 1u) * F + f];
      x[l * F + f] = mix(mix(v00, v01, tx), mix(v10, v11, tx), ty);
    }
  }
  for (var j = 0u; j < ${u(auxDim)}; j++) { x[${u(levels * feats)} + j] = auxB[p * ${u(auxDim)} + j]; }
  for (var j = 0u; j < ${u(XW)}; j++) { X[p * ${u(XW)} + j] = pack2x16float(vec2f(x[2u * j], x[2u * j + 1u])); }
}
`;
}

// The network for a band of items [i0, i1) of one light's item grid at a
// stride, into the light's slot. `add` carries the first layer's bias plus
// its light columns times the light, which are the same for every pixel.
// `half` runs it in 16-bit floats, from 16-bit weights.
function forwardWGSL({ W, H, WD, NH, PIXIN, XW, geo, mul, threads, off, half }) {
  const CG = WD / 4;
  const PG = threads / CG;
  const TP = PG * 4;
  const HSTRIDE = WD * CG + CG;
  const S = half ? 'f16' : 'f32';
  const V = half ? 'vec4h' : 'vec4f';
  return /* wgsl */ `
${half ? 'enable f16;' : ''}
struct Fwd { i0: u32, i1: u32, stride: u32, slot: u32, lc: vec4f, add: array<vec4f, ${CG}> };
@group(0) @binding(0) var<storage, read> Wv: array<${V}>;
@group(0) @binding(1) var<storage, read> X: array<u32>;
@group(0) @binding(2) var<storage, read> pgeo: array<vec4f>;
@group(0) @binding(3) var<uniform> fu: Fwd;
@group(0) @binding(4) var<storage, read_write> outB: array<vec2u>;
var<workgroup> act: array<${S}, ${TP * WD}>;
var<workgroup> pf: array<vec4f, ${2 * TP}>;
var<workgroup> res: array<f32, ${TP * 3}>;
${GEO_WGSL}
fn pixelOf(i: u32) -> u32 {
  let s = fu.stride;
  let cw = (${u(W)} + s - 1u) / s;
  return (i / cw) * s * ${u(W)} + (i % cw) * s;
}
fn outRow(o: u32, pl: u32) -> f32 {
  var acc = f32(Wv[${u(off.BO)} + o / 4u][o % 4u]);
  let row = ${u(off.WO)} + o * ${u(CG)};
  for (var k = 0u; k < ${u(CG)}; k++) {
    let w = Wv[row + k];
    let b = pl * ${u(WD)} + k * 4u;
    acc += f32(w.x * act[b] + w.y * act[b + 1u] + w.z * act[b + 2u] + w.w * act[b + 3u]);
  }
  return acc;
}

@compute @workgroup_size(${threads})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) t: u32) {
  let base = fu.i0 + wg.x * ${u(TP)};
  let pg = t / ${u(CG)};
  let cg = t % ${u(CG)};

  // The tile's pixel inputs, unpacked into act, and its geometric features
  for (var e = t; e < ${u(TP * XW)}; e += ${u(threads)}) {
    let pl = e / ${u(XW)}; let j = e % ${u(XW)};
    var v = vec2f(0.0);
    if (base + pl < fu.i1) { v = unpack2x16float(X[pixelOf(base + pl) * ${u(XW)} + j]); }
    act[pl * ${u(WD)} + 2u * j] = ${S}(v.x);
    act[pl * ${u(WD)} + 2u * j + 1u] = ${S}(v.y);
  }
  if (t < ${u(TP)}) {
    var g: Geo;
    if (base + t < fu.i1) {
      let p = pixelOf(base + t);
      g = geoFeatures(pgeo[2u * p], pgeo[2u * p + 1u].xyz, fu.lc);
    }
    pf[2u * t] = g.f0; pf[2u * t + 1u] = g.f1;
  }
  workgroupBarrier();

  // Layer 0
  let add = ${V}(fu.add[cg]);
  var h = array<${V}, 4>(add, add, add, add);
  let r0 = pg * ${u(4 * WD)};
  for (var k = 0u; k < ${u(PIXIN)}; k++) {
    let w = Wv[${u(off.W0T)} + k * ${u(CG)} + cg];
    h[0] += act[r0 + k] * w;
    h[1] += act[r0 + ${u(WD)} + k] * w;
    h[2] += act[r0 + ${u(2 * WD)} + k] * w;
    h[3] += act[r0 + ${u(3 * WD)} + k] * w;
  }
  ${geo ? `for (var q = 0u; q < 4u; q++) {
    let f0 = ${V}(pf[2u * (pg * 4u + q)]); let f1 = ${V}(pf[2u * (pg * 4u + q) + 1u]);
    h[q] += Wv[${u(off.W0G)} + cg] * f0.x + Wv[${u(off.W0G + CG)} + cg] * f0.y
          + Wv[${u(off.W0G + 2 * CG)} + cg] * f0.z + Wv[${u(off.W0G + 3 * CG)} + cg] * f0.w
          + Wv[${u(off.W0G + 4 * CG)} + cg] * f1.x + Wv[${u(off.W0G + 5 * CG)} + cg] * f1.y;
  }` : ''}
  workgroupBarrier();
  for (var q = 0u; q < 4u; q++) {
    let pl = pg * 4u + q;
    let v = select(${V}(0.0), max(h[q], ${V}(0.0)), base + pl < fu.i1);
    let a = pl * ${u(WD)} + cg * 4u;
    act[a] = v.x; act[a + 1u] = v.y; act[a + 2u] = v.z; act[a + 3u] = v.w;
  }
  workgroupBarrier();

  // Hidden layers
  for (var l = 0u; l < ${u(NH)}; l++) {
    let wo = ${u(off.HID)} + l * ${u(HSTRIDE)};
    let bias = Wv[wo + ${u(WD * CG)} + cg];
    var a0 = bias; var a1 = bias; var a2 = bias; var a3 = bias;
    for (var k = 0u; k < ${u(WD)}; k++) {
      let w = Wv[wo + k * ${u(CG)} + cg];
      a0 += act[r0 + k] * w;
      a1 += act[r0 + ${u(WD)} + k] * w;
      a2 += act[r0 + ${u(2 * WD)} + k] * w;
      a3 += act[r0 + ${u(3 * WD)} + k] * w;
    }
    workgroupBarrier();
    let outs = array<${V}, 4>(max(a0, ${V}(0.0)), max(a1, ${V}(0.0)), max(a2, ${V}(0.0)), max(a3, ${V}(0.0)));
    for (var q = 0u; q < 4u; q++) {
      let a = (pg * 4u + q) * ${u(WD)} + cg * 4u;
      let v = outs[q];
      act[a] = v.x; act[a + 1u] = v.y; act[a + 2u] = v.z; act[a + 3u] = v.w;
    }
    workgroupBarrier();
  }

  // Output: rgb, with the 'mul' head as h[0..2] * G + h[3..5]
  if (t < ${u(TP * 3)}) {
    let pl = t / 3u; let o = t % 3u;
    res[t] = ${mul ? 'outRow(o, pl) * pf[2u * pl + 1u].z + outRow(o + 3u, pl)' : 'outRow(o, pl)'};
  }
  workgroupBarrier();
  if (t < ${u(TP)} && base + t < fu.i1) {
    outB[fu.slot * ${u(W * H)} + base + t] =
      vec2u(pack2x16float(vec2f(res[3u * t], res[3u * t + 1u])), pack2x16float(vec2f(res[3u * t + 2u], 0.0)));
  }
}
`;
}

// Sums the lights, adds each one's own disc, tonemaps and writes sRGB: the
// WebGL engine's composite. Rows go bottom first, as in its render target,
// so the backdrop samples either the same way.
function compositeWGSL({ W, H }) {
  return /* wgsl */ `
struct Light { pr: vec4f, e: vec4f, info: vec4u };  // info: slot, stride, disc shown
struct Frame {
  camO: vec4f, camX: vec4f, camY: vec4f, camZ: vec4f, tanxy: vec4f,
  exposure: f32, nLights: u32, _a: u32, _b: u32,
  lights: array<Light, ${SLOTS}>,
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> outB: array<vec2u>;
@group(0) @binding(2) var<storage, read> pgeo: array<vec4f>;
const W = ${u(W)}; const H = ${u(H)}; const NP = ${u(W * H)};

fn camDir(uv: vec2f) -> vec3f {
  return normalize(frame.camX.xyz * ((0.5 - uv.x) * 2.0 * frame.tanxy.x)
    + frame.camY.xyz * ((0.5 - uv.y) * 2.0 * frame.tanxy.y) + frame.camZ.xyz);
}
// How much of the pixel sees the light's own disc, 4x4 supersampled and
// hidden behind nearer surfaces
fn directCov(p: u32, l: u32) -> f32 {
  let L = frame.lights[l];
  let c = L.pr.xyz; let r = L.pr.w;
  let g = pgeo[2u * p];
  let surf = select(1e9, g.w, g.w > 0.0);
  let oc = frame.camO.xyz - c;
  let px = f32(p % W); let py = f32(p / W);
  let d0 = camDir(vec2f((px + 0.5) / f32(W), (py + 0.5) / f32(H)));
  let b0 = dot(d0, oc);
  let pixAng = 2.0 * frame.tanxy.x / f32(W) * 1.5;
  let dist2 = dot(oc, oc) - b0 * b0;
  let slack = r + pixAng * length(oc);
  if (dist2 > slack * slack || b0 > 0.0) { return 0.0; }
  var cnt = 0.0;
  for (var sy = 0u; sy < 4u; sy++) {
    for (var sx = 0u; sx < 4u; sx++) {
      let d = camDir(vec2f((px + (f32(sx) + 0.5) / 4.0) / f32(W), (py + (f32(sy) + 0.5) / 4.0) / f32(H)));
      let b = dot(d, oc);
      let disc = b * b - dot(oc, oc) + r * r;
      if (disc >= 0.0) {
        let t0 = -b - sqrt(disc);
        if (t0 > 0.0 && t0 < surf) { cnt += 1.0; }
      }
    }
  }
  return cnt / 16.0;
}
fn outAt(i: u32) -> vec3f {
  let v = outB[i];
  return max(vec3f(unpack2x16float(v.x), unpack2x16float(v.y).x), vec3f(0.0));
}
// A slot's network output at pixel p. A preview (stride s > 1) is upsampled
// bilinearly, weighted by surface position so light doesn't bleed across edges.
fn netAt(slot: u32, s: u32, p: u32) -> vec3f {
  let base = slot * NP;
  if (s <= 1u) { return outAt(base + p); }
  let cw = (W + s - 1u) / s; let ch = (H + s - 1u) / s;
  let fx = f32(p % W) / f32(s); let fy = f32(p / W) / f32(s);
  let x0 = min(u32(fx), cw - 1u); let y0 = min(u32(fy), ch - 1u);
  let x1 = min(x0 + 1u, cw - 1u); let y1 = min(y0 + 1u, ch - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let g = pgeo[2u * p];
  let sig = 1.5 * f32(s) * 2.0 * frame.tanxy.x / f32(W) * max(g.w, 1e-3);
  var acc = vec3f(0.0); var ws = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let cx = select(x0, x1, (k & 1u) == 1u); let cy = select(y0, y1, k >= 2u);
    let wb = select(1.0 - tx, tx, (k & 1u) == 1u) * select(1.0 - ty, ty, k >= 2u);
    let q = pgeo[2u * (cy * s * W + cx * s)];
    let dq = q.xyz - g.xyz;
    var wgt = exp(-dot(dq, dq) / (2.0 * sig * sig));
    if ((q.w > 0.0) != (g.w > 0.0)) { wgt = 0.0; }
    let w = wb * (wgt + 1e-4);
    acc += w * outAt(base + cy * cw + cx);
    ws += w;
  }
  return acc / max(ws, 1e-12);
}
fn tone(x: vec3f) -> vec3f { let y = max(x, vec3f(0.0)) * frame.exposure; return y / (1.0 + y); }
fn srgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = (H - 1u - min(u32(pos.y), H - 1u)) * W + min(u32(pos.x), W - 1u);
  var I = vec3f(0.0);
  for (var l = 0u; l < frame.nLights; l++) {
    let L = frame.lights[l];
    I += L.e.xyz * (netAt(L.info.x, L.info.y, p) + select(0.0, directCov(p, l), L.info.z != 0u));
  }
  return vec4f(clamp(srgb(tone(I)), vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
}

// Builds the network on `device` from a loaded scene (loadRelightScene).
// Create with RelightGPUEngine.create; take each composite with snapshot().
export class RelightGPUEngine extends RelightBase {
  static async create(device, data) {
    const engine = new RelightGPUEngine(device, data);
    await engine.build(data);
    return engine;
  }

  constructor(device, { scene, geom }) {
    super(scene, geom);
    this.device = device;
    this.backend = 'webgpu';
    this.buffers = [];
    this.canvas = new OffscreenCanvas(this.W, this.H);
  }

  async build({ scene, layers, grid, gridOff, aux, geom, normal }) {
    const dev = this.device;
    const { W, H } = this;
    const NP = W * H;
    const net = scene.network;
    const WD = net.width;
    const CG = WD / 4;
    const NH = net.hidden - 1;
    const auxDim = net.aux_dim ?? 7;
    const geo = !!net.geo;
    const mul = net.head === 'mul';
    const levels = net.grid_res.length;
    const PIXIN = levels * net.feats + auxDim;
    const IN = layers[0].shape[1];
    if (IN !== PIXIN + 4 + (geo ? 6 : 0)) {
      throw new Error(`unexpected first-layer width ${IN}`);
    }
    const XW = Math.ceil(PIXIN / 2);
    if (XW * 2 > WD) {
      throw new Error('the pixel inputs are wider than a layer');
    }
    const half = dev.features.has('shader-f16');
    this.half = half;
    const limits = dev.limits;
    const threads = THREADS.find(
      (t) =>
        t % CG === 0 &&
        t <= limits.maxComputeInvocationsPerWorkgroup &&
        workgroupBytes(t, WD, half) <= limits.maxComputeWorkgroupStorageSize
    );
    if (!threads) {
      throw new Error('not enough workgroup memory for the network');
    }
    this.tile = (threads / CG) * 4;

    // Weights, in vec4s: the first layer's pixel and geometric columns and
    // each hidden layer transposed (input-major, 4 outputs per vec4, bias
    // after), the output layer row-major and its bias. The first layer's bias
    // and light columns stay here, for `add`.
    const off = {};
    let len = 0;
    const alloc = (key, vec4s) => {
      off[key] = len;
      len += vec4s;
    };
    alloc('W0T', PIXIN * CG);
    alloc('W0G', geo ? 6 * CG : 0);
    alloc('HID', NH * (WD * CG + CG));
    const NO = mul ? 6 : 3;
    alloc('WO', NO * CG);
    alloc('BO', 2);
    const P = new Float32Array(len * 4);
    const w0 = layers[0].w;
    for (let c = 0; c < WD; c += 1) {
      for (let k = 0; k < PIXIN; k += 1) {
        P[(off.W0T + k * CG) * 4 + c] = w0[c * IN + k];
      }
      for (let j = 0; geo && j < 6; j += 1) {
        P[(off.W0G + j * CG) * 4 + c] = w0[c * IN + PIXIN + 4 + j];
      }
    }
    for (let l = 0; l < NH; l += 1) {
      const { w, b } = layers[l + 1];
      const o = (off.HID + l * (WD * CG + CG)) * 4;
      for (let c = 0; c < WD; c += 1) {
        for (let k = 0; k < WD; k += 1) {
          P[o + k * WD + c] = w[c * WD + k];
        }
      }
      P.set(b, o + WD * WD);
    }
    P.set(layers[NH + 1].w, off.WO * 4);
    P.set(layers[NH + 1].b, off.BO * 4);
    this.b0 = layers[0].b;
    this.w0Light = new Float32Array(WD * 4);
    for (let c = 0; c < WD; c += 1) {
      for (let j = 0; j < 4; j += 1) {
        this.w0Light[c * 4 + j] = w0[c * IN + PIXIN + j];
      }
    }

    const pgeo = new Float32Array(NP * 8);
    for (let p = 0; p < NP; p += 1) {
      pgeo.set(geom.subarray(p * 4, p * 4 + 4), p * 8);
      pgeo.set(normal.subarray(p * 3, p * 3 + 3), p * 8 + 4);
    }

    const shapes = { W, H, WD, NH, PIXIN, XW, geo, mul, threads, off, half };
    const module = (code, label) => dev.createShaderModule({ code, label });
    const compositeModule = module(compositeWGSL({ W, H }), 'relight composite');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    const [pre, forward, composite] = await Promise.all([
      dev.createComputePipelineAsync({
        layout: 'auto',
        compute: {
          module: module(
            precomputeWGSL({ W, H, levels, feats: net.feats, gridRes: net.grid_res, gridOff, auxDim, XW }),
            'relight inputs'
          ),
          entryPoint: 'main',
        },
      }),
      dev.createComputePipelineAsync({
        layout: 'auto',
        compute: { module: module(forwardWGSL(shapes), 'relight network'), entryPoint: 'main' },
      }),
      dev.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: compositeModule, entryPoint: 'vs' },
        fragment: { module: compositeModule, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      }),
    ]);

    const U = GPUBufferUsage;
    const buffer = (size, usage, data) => {
      const b = dev.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage, mappedAtCreation: !!data });
      if (data) {
        new data.constructor(b.getMappedRange()).set(data);
        b.unmap();
      }
      this.buffers.push(b);
      return b;
    };
    const wBuf = half ? buffer(P.byteLength / 2, U.STORAGE, toHalf(P)) : buffer(P.byteLength, U.STORAGE, P);
    const xBuf = buffer(NP * XW * 4, U.STORAGE);
    const pgeoBuf = buffer(pgeo.byteLength, U.STORAGE, pgeo);
    const outBuf = buffer(SLOTS * NP * 8, U.STORAGE);
    this.fwdBuf = buffer(32 + CG * 16, U.UNIFORM | U.COPY_DST);
    this.frameBuf = buffer(96 + SLOTS * 48, U.UNIFORM | U.COPY_DST);
    const bind = (pipeline, list) =>
      dev.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: list.map((b, i) => ({ binding: i, resource: { buffer: b } })),
      });
    this.forward = forward;
    this.compositePipeline = composite;
    this.fwdGroup = bind(forward, [wBuf, xBuf, pgeoBuf, this.fwdBuf, outBuf]);
    this.compositeGroup = bind(composite, [this.frameBuf, outBuf, pgeoBuf]);

    if (dev.features.has('timestamp-query')) {
      this.querySet = dev.createQuerySet({ type: 'timestamp', count: 2 });
      this.queryBuf = buffer(16, U.QUERY_RESOLVE | U.COPY_SRC);
      this.readBuf = buffer(16, U.MAP_READ | U.COPY_DST);
    }

    // The pixel inputs, once
    const gridBuf = dev.createBuffer({ size: grid.byteLength, usage: U.STORAGE, mappedAtCreation: true });
    new Float32Array(gridBuf.getMappedRange()).set(grid);
    gridBuf.unmap();
    const auxBuf = dev.createBuffer({ size: aux.byteLength, usage: U.STORAGE, mappedAtCreation: true });
    new Float32Array(auxBuf.getMappedRange()).set(aux);
    auxBuf.unmap();
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pre);
    pass.setBindGroup(0, bind(pre, [gridBuf, auxBuf, xBuf]));
    pass.dispatchWorkgroups(Math.ceil(NP / 64));
    pass.end();
    dev.queue.submit([enc.finish()]);
    await dev.queue.onSubmittedWorkDone();
    gridBuf.destroy();
    auxBuf.destroy();

    this.context = this.canvas.getContext('webgpu');
    this.context.configure({ device: dev, format: this.format, alphaMode: 'opaque' });
  }

  // Evaluates `light` ({pos, radius}) at stride s into `slot`, rows r0 to r1
  // of its item grid (all of them by default)
  evaluate(light, slot, stride = 1, r0 = 0, r1 = this.rows(stride)) {
    const dev = this.device;
    const cw = Math.ceil(this.W / stride);
    const i0 = r0 * cw;
    const i1 = Math.min(r1, this.rows(stride)) * cw;
    if (i1 <= i0) {
      return;
    }
    const ln = this.normLight(light);
    const data = new ArrayBuffer(32 + this.b0.length * 4);
    new Uint32Array(data, 0, 4).set([i0, i1, stride, slot]);
    new Float32Array(data, 16, 4).set([...light.pos, light.radius]);
    const add = new Float32Array(data, 32);
    const w = this.w0Light;
    for (let c = 0; c < add.length; c += 1) {
      add[c] = this.b0[c] + w[c * 4] * ln[0] + w[c * 4 + 1] * ln[1] + w[c * 4 + 2] * ln[2] + w[c * 4 + 3] * ln[3];
    }
    dev.queue.writeBuffer(this.fwdBuf, 0, data);

    const timed = this.timeable(stride, r0, r1);
    const stamped = timed && this.querySet && this.readBuf.mapState === 'unmapped';
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass(
      stamped
        ? { timestampWrites: { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
        : undefined
    );
    pass.setPipeline(this.forward);
    pass.setBindGroup(0, this.fwdGroup);
    pass.dispatchWorkgroups(Math.ceil((i1 - i0) / this.tile));
    pass.end();
    if (stamped) {
      enc.resolveQuerySet(this.querySet, 0, 2, this.queryBuf, 0);
      enc.copyBufferToBuffer(this.queryBuf, 0, this.readBuf, 0, 16);
    }
    dev.queue.submit([enc.finish()]);
    if (timed) {
      this.time(stride, (r1 - r0) / this.rows(stride), stamped);
    }
  }

  // GPU time from the pass's timestamps when the device has them, otherwise
  // until the queue is done (which counts the wait for the GPU, so errs slow)
  time(stride, share, stamped) {
    const pending = { stride, share, done: false, ms: null };
    this.timing.pending = pending;
    const start = performance.now();
    const settle = (ms) => {
      pending.ms = ms > 0 ? ms : null;
      pending.done = true;
    };
    if (stamped) {
      this.readBuf
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const t = new BigUint64Array(this.readBuf.getMappedRange());
          const ms = Number(t[1] - t[0]) / 1e6;
          this.readBuf.unmap();
          settle(ms);
        })
        .catch(() => settle(null));
    } else {
      this.device.queue
        .onSubmittedWorkDone()
        .then(() => settle(performance.now() - start))
        .catch(() => settle(null));
    }
  }

  // Call once a frame; collects a finished measurement
  pollTiming() {
    const pending = this.timing.pending;
    if (pending?.done) {
      this.timing.pending = null;
      this.recordTiming(pending.stride, pending.share, pending.ms);
    }
  }

  // Draws the lit image, to take with snapshot(). lights: [{pos, radius,
  // color, intensity, slot, stride, hidden}]; a hidden light lights the room
  // without its own disc showing.
  composite(lights, exposure = 1) {
    const dev = this.device;
    const frame = new ArrayBuffer(96 + SLOTS * 48);
    const F = new Float32Array(frame);
    const U32 = new Uint32Array(frame);
    const { X, Y, Z, O, tx, ty } = this.cam;
    F.set(O, 0);
    F.set(X, 4);
    F.set(Y, 8);
    F.set(Z, 12);
    F.set([tx, ty], 16);
    F[20] = exposure;
    const n = Math.min(lights.length, SLOTS);
    U32[21] = n;
    lights.slice(0, n).forEach((l, i) => {
      const o = 24 + i * 12;
      F.set([...l.pos, l.radius], o);
      F.set(l.color.map((c) => c * l.intensity), o + 4);
      U32.set([l.slot, l.stride || 1, l.hidden ? 0 : 1], o + 8);
    });
    dev.queue.writeBuffer(this.frameBuf, 0, frame);

    const enc = dev.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
      ],
    });
    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, this.compositeGroup);
    pass.draw(3);
    pass.end();
    dev.queue.submit([enc.finish()]);
  }

  // The last composite, as an ImageBitmap the caller closes
  snapshot() {
    return this.canvas.transferToImageBitmap();
  }

  // The device is the caller's, and outlives the engine
  dispose() {
    this.context?.unconfigure();
    this.querySet?.destroy();
    this.buffers.forEach((b) => b.destroy());
    this.buffers = [];
  }
}
