// webgpu version of the relight forward pass. whole MLP per workgroup tile in workgroup memory,
// ~5ms vs ~21ms on webgl2 for a 512px light (3080)
//
// stores the pixel inputs (39 halves, 21MB) and runs layer 0 in the kernel instead of caching
// it per pixel like the relight repo does (128 floats, 134MB). phones need the memory
//
// f16 where available: ~1/3 faster on the 3080, image moves by 3/255 at most

/* global GPUBufferUsage, GPUMapMode, GPUShaderStage, GPUTextureUsage, BigUint64Array */
import { NO_PHASE, RESOLVED, RelightBase, SLOTS } from './RelightBase';

// which one's fastest depends on the gpu, tune() times them. first that fits is the default.
// a thread works out pixels x channels groups of 4 outputs. more pixels reuse each weight it
// loads (what the 3080 is short of, 8 is enough there), more channels each activation (phones,
// where workgroup memory is just cache). 32 threads for gpus with small subgroups (mali, apple).
// on the 3080 the channel, double and subgroup kernels lose by 3-20%, they're for other gpus
export const KERNELS = [
  { threads: 256, pixels: 4 },
  { threads: 128, pixels: 4 },
  { threads: 256, pixels: 8 },
  { threads: 128, pixels: 8 },
  { threads: 64, pixels: 8 },
  { threads: 64, pixels: 4 },
  { threads: 64, pixels: 16 },
  { threads: 64, pixels: 8, channels: 2 },
  { threads: 128, pixels: 4, channels: 2 },
  { threads: 32, pixels: 8 },
  { threads: 32, pixels: 8, channels: 2 },
  { threads: 64, pixels: 8, double: true },
  { threads: 128, pixels: 4, double: true },
  { threads: 64, pixels: 8, subgroup: true },
  { threads: 32, pixels: 8, channels: 2, subgroup: true },
];
// saved profiles hold these, one channel group keeps the old name
export const kernelKey = (k) =>
  `${k.threads}x${k.pixels}${k.channels > 1 ? `c${k.channels}` : ''}${k.double ? 'd' : ''}${k.subgroup ? 's' : ''}`;

// pixels a workgroup takes, CG / channels threads share each pixel
const tileOf = (k, CG) => ((k.threads * (k.channels ?? 1)) / CG) * k.pixels;

function workgroupBytes(k, width, half, outputs) {
  const tile = tileOf(k, width / 4);
  return tile * width * (half ? 2 : 4) * (k.double ? 2 : 1) + tile * 32 + tile * outputs * 4;
}

const outputsOf = (mul) => (mul ? 6 : 3);
const wordsOf = (mul) => (mul ? 3 : 2);

// asks for the adapter's own workgroup memory limit, the 16KB default only fits the small kernel
export async function requestRelightDevice() {
  if (!navigator.gpu) {
    throw new Error(window.isSecureContext ? 'this browser has no WebGPU' : 'WebGPU needs HTTPS');
  }
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('this browser has no OffscreenCanvas');
  }
  // default adapter like webgl uses, so on dual gpu laptops the image doesn't cross gpus every frame
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('the browser offers no WebGPU adapter for this GPU');
  }
  const L = adapter.limits;
  const features = ['timestamp-query', 'shader-f16', 'subgroups'].filter((f) => adapter.features.has(f));
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

// ms, closer completions get reported together
const QUEUE_GRAIN = 0.1;
// the composited image. halves so it isn't quantised before the room's upscale and grade
const IMAGE_FORMAT = 'rgba16float';
// passes a frame's uniforms have room for, past that it submits early and starts over
const RING = 64;

// f32 -> f16 bits, round to nearest even
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

// f0 = (dir to light, cos), f1 = (0.5 ln d, 0.25 ln solid angle, G, valid)
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

// pixel positions (+ camera distance) and normals in separate arrays of halves, so the
// bilateral taps, which only want positions, read 8 bytes a pixel instead of 16 of every 32.
// halved positions move the image by 1/255 at most and don't change the PSNR
const POS_WGSL = /* wgsl */ `
fn posAt(p: u32) -> vec4f { let q = ppos[p]; return vec4f(unpack2x16float(q.x), unpack2x16float(q.y)); }`;
const NRM_WGSL = /* wgsl */ `
fn nrmAt(p: u32) -> vec3f { let n = pnrm[p]; return vec3f(unpack2x16float(n.x), unpack2x16float(n.y).x); }`;

function precomputeWGSL({ W, H, levels, feats, gridRes, gridOff, auxDim, XW, posRange, camO }) {
  const arr = (a) => `array<u32, ${a.length}>(${a.map(u).join(', ')})`;
  const f = (x) => `${x}`.includes('.') || `${x}`.includes('e') ? `${x}` : `${x}.0`;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> grid: array<u32>;
@group(0) @binding(1) var<storage, read> auxB: array<u32>;
@group(0) @binding(2) var<storage, read> posB: array<u32>;
@group(0) @binding(3) var<storage, read_write> X: array<u32>;
@group(0) @binding(4) var<storage, read_write> ppos: array<vec2u>;
@group(0) @binding(5) var<storage, read_write> pnrm: array<vec2u>;
var<private> RES: array<u32, ${levels}> = ${arr(gridRes)};
var<private> GOFF: array<u32, ${levels}> = ${arr(gridOff)};
const W = ${u(W)}; const H = ${u(H)}; const F = ${u(feats)}; const NP = ${u(W * H)};
const POS_LO = ${f(posRange[0])}; const POS_STEP = ${f((posRange[1] - posRange[0]) / 65534)};
const CAM_O = vec3f(${camO.map(f).join(', ')});

fn gridAt(i: u32) -> f32 {
  return unpack2x16float(grid[i >> 1u])[i & 1u];
}
fn auxAt(p: u32, j: u32) -> f32 {
  let i = ((j >> 2u) * NP + p) * 4u + (j & 3u);
  return unpack2x16float(auxB[i >> 1u])[i & 1u];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let p = gid.x;
  if (p >= NP) { return; }
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
      let v00 = gridAt(b + (y0 * R + x0) * F + f);
      let v01 = gridAt(b + (y0 * R + x0 + 1u) * F + f);
      let v10 = gridAt(b + ((y0 + 1u) * R + x0) * F + f);
      let v11 = gridAt(b + ((y0 + 1u) * R + x0 + 1u) * F + f);
      x[l * F + f] = mix(mix(v00, v01, tx), mix(v10, v11, tx), ty);
    }
  }
  for (var j = 0u; j < ${u(auxDim)}; j++) { x[${u(levels * feats)} + j] = auxAt(p, j); }
  for (var j = 0u; j < ${u(XW)}; j++) { X[p * ${u(XW)} + j] = pack2x16float(vec2f(x[2u * j], x[2u * j + 1u])); }

  let q0 = posB[2u * p]; let q1 = posB[2u * p + 1u];
  var g = vec4f(0.0);
  if ((q0 & 0xffffu) != 0u) {
    let w = POS_LO + (vec3f(f32(q0 & 0xffffu), f32(q0 >> 16u), f32(q1 & 0xffffu)) - 1.0) * POS_STEP;
    g = vec4f(w, length(w - CAM_O));
  }
  ppos[p] = vec2u(pack2x16float(g.xy), pack2x16float(g.zw));
  pnrm[p] = vec2u(pack2x16float(vec2f(auxAt(p, 3u), auxAt(p, 4u))), pack2x16float(vec2f(auxAt(p, 5u), 0.0)));
}
`;
}

// activations are vec4s so a thread loads 4 inputs at once. one at a time, the workgroup
// memory loads outnumbered the FMAs, which is what phone gpus are worst at. a thread with
// C channel groups loads 4C weights and P activations a step for 16CP FMAs.
// double writes each layer into the other half of act, so it needs no barrier before the writes.
// subgroup keeps a pixel's activations in its threads' registers between hidden layers and
// shuffles them across, so those need no barriers or workgroup memory
function forwardWGSL({ W, H, WD, NH, PIXIN, XW, geo, mul, threads, pixels: P, channels: C = 1, double: DB, subgroup: SG, off, half }) {
  const CG = WD / 4;
  // threads a pixel, a thread's channel groups are CGC apart so neighbours read neighbouring weights
  const CGC = CG / C;
  const NO = outputsOf(mul);
  const NW = wordsOf(mul);
  const PG = threads / CGC;
  const TP = PG * P;
  const Q = [...Array(P).keys()];
  const CS = [...Array(C).keys()];
  const HSTRIDE = WD * CG + CG;
  const A = TP * CG;
  // the half the last layer wrote
  const LAST = DB ? ((NH + 1) % 2) * A : 0;
  const X4 = Math.ceil(XW / 2);
  const PIN4 = Math.ceil(PIXIN / 4);
  const V = half ? 'vec4h' : 'vec4f';
  const lines = (list, f) => list.map(f).join('\n      ');
  // acc(c, q) += x(q) · weights w{c}0..3
  const fma = (acc, x) =>
    lines(
      CS.flatMap((c) => Q.map((q) => [c, q])),
      ([c, q]) => `${acc(c, q)} += ${x(q)}.x * w${c}0 + ${x(q)}.y * w${c}1 + ${x(q)}.z * w${c}2 + ${x(q)}.w * w${c}3;`
    );
  const rows4 = (at) =>
    CS.map((c) => [0, 1, 2, 3].map((j) => `let w${c}${j} = Wv[${at} + ${u(j * CG + c * CGC)}];`).join(' ')).join(
      '\n      '
    );
  const acts = (at) => Q.map((q) => `let x${q} = act[${at(q)}];`).join(' ');
  const hq = (c, q) => (typeof q === 'number' ? `h[${c * P + q}]` : `h[${c ? `${u(c * P)} + ` : ''}${q}]`);
  return /* wgsl */ `
${half ? 'enable f16;' : ''}
${SG ? 'enable subgroups;\nrequires subgroup_id;' : ''}
struct Fwd {
  i0: u32, i1: u32, stride: u32, slot: u32, x0: u32, xw: u32, px: u32, py: u32,
  lc: vec4f, add: array<vec4f, ${CG}>,
};
@group(0) @binding(0) var<storage, read> Wv: array<${V}>;
@group(0) @binding(1) var<storage, read> X: array<u32>;
@group(0) @binding(2) var<storage, read> ppos: array<vec2u>;
@group(0) @binding(3) var<uniform> fu: Fwd;
@group(0) @binding(4) var<storage, read_write> outB: array<u32>;
@group(0) @binding(5) var<storage, read> pnrm: array<vec2u>;
var<workgroup> act: array<${V}, ${DB ? 2 * A : A}>;
var<workgroup> pf: array<vec4f, ${2 * TP}>;
var<workgroup> res: array<f32, ${TP * NO}>;
${GEO_WGSL}
${POS_WGSL}
${NRM_WGSL}
// px, py offset the grid so each frame can take different pixels. the last row/column can land
// off the image, they're read clamped and the resolve doesn't use them
fn pixelOf(i: u32) -> u32 {
  let s = fu.stride;
  let x = min((fu.x0 + i % fu.xw) * s + fu.px, ${u(W - 1)});
  let y = min((i / fu.xw) * s + fu.py, ${u(H - 1)});
  return y * ${u(W)} + x;
}
fn itemOf(i: u32) -> u32 {
  let cw = (${u(W)} + fu.stride - 1u) / fu.stride;
  return (i / fu.xw) * cw + fu.x0 + i % fu.xw;
}
fn outRow(o: u32, pl: u32) -> f32 {
  var acc = f32(Wv[${u(off.BO)} + o / 4u][o % 4u]);
  let row = ${u(off.WO)} + o * ${u(CG)};
  for (var k = 0u; k < ${u(CG)}; k++) {
    acc += f32(dot(Wv[row + k], act[${LAST ? `${u(LAST)} + ` : ''}pl * ${u(CG)} + k]));
  }
  return acc;
}

@compute @workgroup_size(${threads})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) t: u32${
    SG
      ? `,
    @builtin(subgroup_id) sgi: u32, @builtin(subgroup_size) sgs: u32, @builtin(subgroup_invocation_id) lane: u32`
      : ''
  }) {
  let base = fu.i0 + wg.x * ${u(TP)};
  ${SG
    ? `// a pixel's threads are lanes lane0.. of one subgroup, whichever threads the gpu put in it
  let tt = sgi * sgs + lane;
  let pg = tt / ${u(CGC)};
  let cg = tt % ${u(CGC)};
  let lane0 = lane - cg;`
    : `let pg = t / ${u(CGC)};
  let cg = t % ${u(CGC)};`}

  for (var e = t; e < ${u(TP * X4)}; e += ${u(threads)}) {
    let pl = e / ${u(X4)}; let q = e % ${u(X4)};
    var v = vec4f(0.0);
    if (base + pl < fu.i1) {
      let at = pixelOf(base + pl) * ${u(XW)} + 2u * q;
      let hi = ${XW % 2 ? `select(vec2f(0.0), unpack2x16float(X[at + 1u]), 2u * q + 1u < ${u(XW)})` : 'unpack2x16float(X[at + 1u])'};
      v = vec4f(unpack2x16float(X[at]), hi);
    }
    act[pl * ${u(CG)} + q] = ${V}(v);
  }
  if (t < ${u(TP)}) {
    var g: Geo;
    if (base + t < fu.i1) {
      let p = pixelOf(base + t);
      g = geoFeatures(posAt(p), nrmAt(p), fu.lc);
    }
    pf[2u * t] = g.f0; pf[2u * t + 1u] = g.f1;
  }
  workgroupBarrier();

  ${CS.map((c) => `let add${c} = ${V}(fu.add[cg + ${u(c * CGC)}]);`).join(' ')}
  var h = array<${V}, ${C * P}>(${CS.flatMap((c) => Q.map(() => `add${c}`)).join(', ')});
  let r0 = pg * ${u(P * CG)};
  for (var k = 0u; k < ${u(PIN4)}; k++) {
    ${rows4(`${u(off.W0T)} + k * ${u(4 * CG)} + cg`)}
    ${acts((q) => `r0 + ${u(q * CG)} + k`)}
    ${fma(hq, (q) => `x${q}`)}
  }
  ${geo ? `for (var q = 0u; q < ${u(P)}; q++) {
    let f0 = ${V}(pf[2u * (pg * ${u(P)} + q)]); let f1 = ${V}(pf[2u * (pg * ${u(P)} + q) + 1u]);
    ${CS.map((c) => {
      const g = (j) => `Wv[${u(off.W0G + j * CG + c * CGC)} + cg]`;
      return `${hq(c, 'q')} += ${g(0)} * f0.x + ${g(1)} * f0.y
          + ${g(2)} * f0.z + ${g(3)} * f0.w
          + ${g(4)} * f1.x + ${g(5)} * f1.y;`;
    }).join('\n    ')}
  }` : ''}
  ${DB || SG ? '' : 'workgroupBarrier();'}
  for (var q = 0u; q < ${u(P)}; q++) {
    let live = base + pg * ${u(P)} + q < fu.i1;
    ${CS.map((c) =>
      SG
        ? `${hq(c, 'q')} = select(${V}(0.0), max(${hq(c, 'q')}, ${V}(0.0)), live);`
        : `act[${DB ? `${u(A)} + ` : ''}r0 + q * ${u(CG)} + cg + ${u(c * CGC)}] = select(${V}(0.0), max(${hq(c, 'q')}, ${V}(0.0)), live);`
    ).join('\n    ')}
  }
  ${SG ? '' : 'workgroupBarrier();'}

  for (var l = 0u; l < ${u(NH)}; l++) {
    let wo = ${u(off.HID)} + l * ${u(HSTRIDE)};
    ${CS.map((c) => `let bias${c} = Wv[wo + ${u(WD * CG + c * CGC)} + cg];`).join(' ')}
    ${CS.map((c) => Q.map((q) => `var a${c}_${q} = bias${c};`).join(' ')).join('\n    ')}
    ${SG
      ? `${CS.map(
          (s) => `for (var j = 0u; j < ${u(CGC)}; j++) {
      let k = ${s ? `${u(s * CGC)} + ` : ''}j;
      ${rows4(`wo + k * ${u(4 * CG)} + cg`)}
      ${Q.map((q) => `let x${q} = subgroupShuffle(${hq(s, q)}, lane0 + j);`).join(' ')}
      ${fma((c, q) => `a${c}_${q}`, (q) => `x${q}`)}
    }`
        ).join('\n    ')}
    ${CS.map((c) => Q.map((q) => `${hq(c, q)} = max(a${c}_${q}, ${V}(0.0));`).join(' ')).join('\n    ')}
  }
  // the output rows take every channel of a pixel, they go through workgroup memory
  workgroupBarrier();
  ${CS.map((c) => Q.map((q) => `act[r0 + ${u(q * CG + c * CGC)} + cg] = ${hq(c, q)};`).join(' ')).join('\n  ')}
  workgroupBarrier();`
      : `${DB ? `let src = select(0u, ${u(A)}, (l & 1u) == 0u); let dst = ${u(A)} - src;` : ''}
    for (var k = 0u; k < ${u(CG)}; k++) {
      ${rows4(`wo + k * ${u(4 * CG)} + cg`)}
      ${acts((q) => `${DB ? 'src + ' : ''}r0 + ${u(q * CG)} + k`)}
      ${fma((c, q) => `a${c}_${q}`, (q) => `x${q}`)}
    }
    ${DB ? '' : 'workgroupBarrier();'}
    ${CS.map((c) => Q.map((q) => `act[${DB ? 'dst + ' : ''}r0 + ${u(q * CG + c * CGC)} + cg] = max(a${c}_${q}, ${V}(0.0));`).join('\n    ')).join(
      '\n    '
    )}
    workgroupBarrier();
  }`}

  for (var e = t; e < ${u(TP * NO)}; e += ${u(threads)}) {
    res[e] = outRow(e % ${u(NO)}, e / ${u(NO)});
  }
  workgroupBarrier();
  if (t < ${u(TP)} && base + t < fu.i1) {
    let o = (fu.slot * ${u(W * H)} + itemOf(base + t)) * ${u(NW)};
    let r = t * ${u(NO)};
    ${mul
      ? `outB[o] = pack2x16float(vec2f(res[r], res[r + 1u]));
    outB[o + 1u] = pack2x16float(vec2f(res[r + 2u], res[r + 3u]));
    outB[o + 2u] = pack2x16float(vec2f(res[r + 4u], res[r + 5u]));`
      : `outB[o] = pack2x16float(vec2f(res[r], res[r + 1u]));
    outB[o + 1u] = pack2x16float(vec2f(res[r + 2u], 0.0));`}
  }
}
`;
}

// rows bottom first like the webgl render target
function compositeWGSL({ W, H, mul }) {
  const NW = wordsOf(mul);
  return /* wgsl */ `
struct Light { pr: vec4f, e: vec4f, info: vec4u };  // info: slot, stride, disc shown
struct Frame {
  camO: vec4f, camX: vec4f, camY: vec4f, camZ: vec4f, tanxy: vec4f,
  exposure: f32, nLights: u32, _a: u32, _b: u32,
  lights: array<Light, ${SLOTS}>,
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> outB: array<u32>;
@group(0) @binding(2) var<storage, read> ppos: array<vec2u>;
${mul ? '@group(0) @binding(3) var<storage, read> pnrm: array<vec2u>;' : ''}
const W = ${u(W)}; const H = ${u(H)}; const NP = ${u(W * H)};
  const PI = 3.14159265358979;
${POS_WGSL}
${mul ? NRM_WGSL : ''}
struct Net { a: vec3f, b: vec3f };

fn camDir(uv: vec2f) -> vec3f {
  return normalize(frame.camX.xyz * ((0.5 - uv.x) * 2.0 * frame.tanxy.x)
    + frame.camY.xyz * ((0.5 - uv.y) * 2.0 * frame.tanxy.y) + frame.camZ.xyz);
}
// 4x4 supersampled
fn directCov(p: u32, g: vec4f, l: u32) -> f32 {
  let L = frame.lights[l];
  let c = L.pr.xyz; let r = L.pr.w;
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
fn outAt(i: u32) -> Net {
  let w0 = unpack2x16float(outB[${u(NW)} * i]); let w1 = unpack2x16float(outB[${u(NW)} * i + 1u]);
  ${mul
    ? `let w2 = unpack2x16float(outB[3u * i + 2u]);
  return Net(vec3f(w0, w1.x), vec3f(w1.y, w2));`
    : 'return Net(vec3f(w0, w1.x), vec3f(0.0));'}
}
// previews upsample weighted by position so light doesn't bleed across edges. G is
// computed per pixel so a preview keeps the light's shape, not just its colour
fn lit(n: Net, g: vec4f, nrm: vec3f, light: vec4f) -> vec3f {
  ${mul
    ? `var G = 0.0;
  if (g.w > 0.0) {
    let v = light.xyz - g.xyz;
    let d = max(length(v), 1e-4);
    let cs = dot(nrm, v / d);
    if (cs > 0.0) {
      let s = min(light.w / d, 1.0);
      let om = 2.0 * PI * s * s / (1.0 + sqrt(max(1.0 - s * s, 0.0)));
      G = om * cs / PI;
    }
  }
  return max(n.a * G + n.b, vec3f(0.0));`
    : 'return max(n.a, vec3f(0.0));'}
}
fn netAt(slot: u32, s: u32, p: u32, g: vec4f) -> Net {
  let base = slot * NP;
  if (s <= 1u) { return outAt(base + p); }
  let cw = (W + s - 1u) / s; let ch = (H + s - 1u) / s;
  let fx = f32(p % W) / f32(s); let fy = f32(p / W) / f32(s);
  let x0 = min(u32(fx), cw - 1u); let y0 = min(u32(fy), ch - 1u);
  let x1 = min(x0 + 1u, cw - 1u); let y1 = min(y0 + 1u, ch - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let sig = 1.5 * f32(s) * 2.0 * frame.tanxy.x / f32(W) * max(g.w, 1e-3);
  var acc = Net(vec3f(0.0), vec3f(0.0)); var ws = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let cx = select(x0, x1, (k & 1u) == 1u); let cy = select(y0, y1, k >= 2u);
    let wb = select(1.0 - tx, tx, (k & 1u) == 1u) * select(1.0 - ty, ty, k >= 2u);
    let q = posAt(cy * s * W + cx * s);
    let dq = q.xyz - g.xyz;
    var wgt = exp(-dot(dq, dq) / (2.0 * sig * sig));
    if ((q.w > 0.0) != (g.w > 0.0)) { wgt = 0.0; }
    let w = wb * (wgt + 1e-4);
    let n = outAt(base + cy * cw + cx);
    acc.a += w * n.a; acc.b += w * n.b;
    ws += w;
  }
  let iw = 1.0 / max(ws, 1e-12);
  return Net(acc.a * iw, acc.b * iw);
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
  let g = posAt(p);
  ${mul ? 'let nrm = nrmAt(p);' : 'let nrm = vec3f(0.0);'}
  var I = vec3f(0.0);
  for (var l = 0u; l < frame.nLights; l++) {
    let L = frame.lights[l];
    I += L.e.xyz * (lit(netAt(L.info.x, L.info.y, p, g), g, nrm, L.pr) + select(0.0, directCov(p, g, l), L.info.z != 0u));
  }
  return vec4f(clamp(srgb(tone(I)), vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
}

// copies the composited image onto a canvas, the same size (snapshots) or half (the glass's copy,
// each pixel the average of 4)
const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[i];
  return Out(vec4f(p, 0.0, 1.0), vec2f(0.5 + 0.5 * p.x, 0.5 - 0.5 * p.y));
}
@fragment fn fs(o: Out) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(image, smp, o.uv, 0.0).rgb, 1.0);
}
`;

// folds one evaluation into a light's full res image. pixels it evaluated are copied, the rest
// move toward the evaluation upsampled by alpha, so at rest every pixel ends up evaluated and a
// moving light keeps what it evaluated recently. pixels outside keep have nothing to keep yet
function resolveWGSL({ W, H, mul }) {
  const NW = wordsOf(mul);
  return /* wgsl */ `
struct Res {
  s: u32, px: u32, py: u32, raw: u32, dst: u32, c0: u32, c1: u32, r0: u32,
  r1: u32, x0: u32, y0: u32, xw: u32, yh: u32, k0x: u32, k0y: u32, k1x: u32,
  k1y: u32, alpha: f32, sig: f32, sparse: u32,
};
@group(0) @binding(0) var<uniform> ru: Res;
@group(0) @binding(1) var<storage, read_write> outB: array<u32>;
@group(0) @binding(2) var<storage, read> ppos: array<vec2u>;
const W = ${u(W)}; const H = ${u(H)}; const NP = ${u(W * H)};
${POS_WGSL}

fn load(i: u32, w: ptr<function, array<vec2f, ${NW}>>) {
  for (var k = 0u; k < ${u(NW)}; k++) { (*w)[k] = unpack2x16float(outB[${u(NW)} * i + k]); }
}
fn store(i: u32, w: array<vec2f, ${NW}>) {
  for (var k = 0u; k < ${u(NW)}; k++) { outB[${u(NW)} * i + k] = pack2x16float(w[k]); }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = ru.s;
  let cw = (W + s - 1u) / s;
  let raw = ru.raw * NP;
  var w: array<vec2f, ${NW}>;
  if (ru.sparse != 0u) {
    let gw = ru.c1 - ru.c0;
    let gh = ru.r1 - ru.r0;
    if (gid.x >= gw * gh) { return; }
    let cx = ru.c0 + gid.x % gw;
    let cy = ru.r0 + gid.x / gw;
    let x = cx * s + ru.px;
    let y = cy * s + ru.py;
    if (x >= W || y >= H) { return; }
    load(raw + cy * cw + cx, &w);
    store(ru.dst * NP + y * W + x, w);
    return;
  }
  if (gid.x >= ru.xw * ru.yh) { return; }
  let x = ru.x0 + gid.x % ru.xw; let y = ru.y0 + gid.x / ru.xw;
  let p = y * W + x;
  let dst = ru.dst * NP + p;
  // last column/row whose pixel is on the image
  let hx = max(min(ru.c1 - 1u, (W - 1u - ru.px) / s), ru.c0);
  let hy = max(min(ru.r1 - 1u, (H - 1u - ru.py) / s), ru.r0);
  if (x >= ru.px && y >= ru.py) {
    let dx = x - ru.px; let dy = y - ru.py;
    let cx = dx / s; let cy = dy / s;
    if (dx % s == 0u && dy % s == 0u && cx >= ru.c0 && cx <= hx && cy >= ru.r0 && cy <= hy) {
      load(raw + cy * cw + cx, &w);
      store(dst, w);
      return;
    }
  }
  let kept = x >= ru.k0x && x < ru.k1x && y >= ru.k0y && y < ru.k1y;
  let alpha = select(1.0, ru.alpha, kept);
  if (alpha <= 0.0) { return; }

  let fx = max(f32(x) - f32(ru.px), 0.0) / f32(s);
  let fy = max(f32(y) - f32(ru.py), 0.0) / f32(s);
  let x0 = clamp(u32(fx), ru.c0, hx); let y0 = clamp(u32(fy), ru.r0, hy);
  let x1 = min(x0 + 1u, hx); let y1 = min(y0 + 1u, hy);
  let tx = clamp(fx - f32(x0), 0.0, 1.0); let ty = clamp(fy - f32(y0), 0.0, 1.0);
  let g = posAt(p);
  let sig = ru.sig * f32(s) * max(g.w, 1e-3);
  var acc: array<vec2f, ${NW}>;
  var ws = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let cx = select(x0, x1, (k & 1u) == 1u); let cy = select(y0, y1, k >= 2u);
    let wb = select(1.0 - tx, tx, (k & 1u) == 1u) * select(1.0 - ty, ty, k >= 2u);
    let q = posAt((cy * s + ru.py) * W + cx * s + ru.px);
    let dq = q.xyz - g.xyz;
    var wgt = exp(-dot(dq, dq) / (2.0 * sig * sig));
    if ((q.w > 0.0) != (g.w > 0.0)) { wgt = 0.0; }
    let wt = wb * (wgt + 1e-4);
    var n: array<vec2f, ${NW}>;
    load(raw + cy * cw + cx, &n);
    for (var j = 0u; j < ${u(NW)}; j++) { acc[j] += wt * n[j]; }
    ws += wt;
  }
  let iw = 1.0 / max(ws, 1e-12);
  if (alpha < 1.0) {
    load(dst, &w);
  }
  for (var j = 0u; j < ${u(NW)}; j++) { w[j] = mix(w[j], acc[j] * iw, alpha); }
  store(dst, w);
}
`;
}

export class RelightGPUEngine extends RelightBase {
  static async create(device, data, options = {}) {
    const engine = new RelightGPUEngine(device, data);
    await engine.build(data, options);
    return engine;
  }

  constructor(device, { scene, pos }) {
    super(scene, pos);
    this.device = device;
    this.backend = 'webgpu';
    this.buffers = [];
    this.canvas = new OffscreenCanvas(this.W, this.H);
    this.halfCanvas = new OffscreenCanvas(this.W >> 1, this.H >> 1);
  }

  async build({ scene, layers, grid, gridOff, aux, pos }, { kernel = null, images = RESOLVED } = {}) {
    const dev = this.device;
    this.images = images;
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
    // a pixel's threads have to share a subgroup, whatever size the gpu picks
    const info = dev.adapterInfo;
    const shuffles = (k) =>
      dev.features.has('subgroups') &&
      navigator.gpu.wgslLanguageFeatures?.has('subgroup_id') &&
      info?.subgroupMinSize % (CG / (k.channels ?? 1)) === 0;
    // the geometry and output stages take a pixel a thread, so a tile can't outnumber the threads
    this.kernels = KERNELS.filter(
      (k) =>
        (!k.subgroup || shuffles(k)) &&
        CG % (k.channels ?? 1) === 0 &&
        k.threads % (CG / (k.channels ?? 1)) === 0 &&
        tileOf(k, CG) <= k.threads &&
        k.threads <= limits.maxComputeInvocationsPerWorkgroup &&
        workgroupBytes(k, WD, half, outputsOf(mul)) <= limits.maxComputeWorkgroupStorageSize &&
        Math.ceil(NP / tileOf(k, CG)) <= limits.maxComputeWorkgroupsPerDimension
    );
    if (!this.kernels.length) {
      throw new Error('not enough workgroup memory for the network');
    }
    const first = this.kernels.find((k) => kernelKey(k) === kernel) || this.kernels[0];

    const off = {};
    let len = 0;
    const alloc = (key, vec4s) => {
      off[key] = len;
      len += vec4s;
    };
    alloc('W0T', Math.ceil(PIXIN / 4) * 4 * CG);
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

    this.shapes = { W, H, WD, NH, PIXIN, XW, geo, mul, off, half };
    const module = (code, label) => dev.createShaderModule({ code, label });
    const compositeModule = module(compositeWGSL({ W, H, mul }), 'relight composite');
    const blitModule = module(BLIT_WGSL, 'relight blit');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    // uniforms sit in a ring at dynamic offsets so a frame's passes don't overwrite each other's
    const S = GPUShaderStage;
    const layout = (visibility, types) =>
      dev.createPipelineLayout({
        bindGroupLayouts: [
          dev.createBindGroupLayout({
            entries: types.map((type, binding) => ({
              binding,
              visibility,
              buffer: type === 'ring' ? { type: 'uniform', hasDynamicOffset: true } : { type },
            })),
          }),
        ],
      });
    const R = 'read-only-storage';
    this.fwdLayout = layout(S.COMPUTE, [R, R, R, 'ring', 'storage', R]);
    const compositeLayout = layout(S.FRAGMENT, ['ring', R, R, ...(mul ? [R] : [])]);
    const resolveLayout = layout(S.COMPUTE, ['ring', 'storage', R]);
    const [pre, forward, composite, resolve, blit] = await Promise.all([
      dev.createComputePipelineAsync({
        layout: 'auto',
        compute: {
          module: module(
            precomputeWGSL({
              W,
              H,
              levels,
              feats: net.feats,
              gridRes: net.grid_res,
              gridOff,
              auxDim,
              XW,
              posRange: scene.pixels.pos.range,
              camO: this.cam.O,
            }),
            'relight inputs'
          ),
          entryPoint: 'main',
        },
      }),
      // a saved kernel this gpu won't compile any more falls back to the default
      this.forwardPipeline(first).then(
        (pipeline) => ({ k: first, pipeline }),
        (error) => {
          if (first === this.kernels[0]) {
            throw error;
          }
          return this.forwardPipeline(this.kernels[0]).then((pipeline) => ({ k: this.kernels[0], pipeline }));
        }
      ),
      dev.createRenderPipelineAsync({
        layout: compositeLayout,
        vertex: { module: compositeModule, entryPoint: 'vs' },
        fragment: { module: compositeModule, entryPoint: 'fs', targets: [{ format: IMAGE_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      }),
      dev.createComputePipelineAsync({
        layout: resolveLayout,
        compute: { module: module(resolveWGSL({ W, H, mul }), 'relight resolve'), entryPoint: 'main' },
      }),
      dev.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: blitModule, entryPoint: 'vs' },
        fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: this.format }] },
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
    const posBuf = buffer(NP * 8, U.STORAGE);
    const nrmBuf = buffer(NP * 8, U.STORAGE);
    // network slots, then the full res images
    const outBuf = buffer((SLOTS - RESOLVED + images) * NP * wordsOf(mul) * 4, U.STORAGE);
    const fwdBytes = 48 + CG * 16;
    const frameBytes = 96 + SLOTS * 48;
    const align = limits.minUniformBufferOffsetAlignment;
    this.ringStride = Math.ceil(Math.max(fwdBytes, frameBytes, 80) / align) * align;
    this.ringBuf = buffer(RING * this.ringStride, U.UNIFORM | U.COPY_DST);
    this.ring = new Uint8Array(RING * this.ringStride);
    this.ringUsed = 0;
    this.enc = null;
    this.framing = false;
    this.afterSubmit = [];
    const ring = (size) => ({ buffer: this.ringBuf, size });
    this.fwdF32 = new Float32Array(12 + WD);
    this.fwdU32 = new Uint32Array(this.fwdF32.buffer, 0, 8);
    const bind = (pipeline, list) =>
      dev.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: list.map((b, i) => ({ binding: i, resource: b.buffer ? b : { buffer: b } })),
      });
    this.compositePipeline = composite;
    this.fwdBuffers = [wBuf, xBuf, posBuf, ring(fwdBytes), outBuf, nrmBuf];
    this.setKernel(forward.k, forward.pipeline);
    this.compositeGroup = bind(composite, [ring(frameBytes), outBuf, posBuf, ...(mul ? [nrmBuf] : [])]);
    this.resU32 = new Uint32Array(20);
    this.resF32 = new Float32Array(this.resU32.buffer);
    this.resolvePipeline = resolve;
    this.resolveGroup = bind(resolve, [ring(80), outBuf, posBuf]);
    // the composite lands here, the room layer draws from it on this device. pixels outside the
    // view keep an older composite, the backdrop composites again before they show
    this.image = dev.createTexture({
      size: [W, H],
      format: IMAGE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.imageView = this.image.createView();
    this.blitPipeline = blit;
    this.blitGroup = dev.createBindGroup({
      layout: blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.imageView },
        { binding: 1, resource: dev.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
      ],
    });

    if (dev.features.has('timestamp-query')) {
      this.querySet = dev.createQuerySet({ type: 'timestamp', count: 2 });
      this.queryBuf = buffer(16, U.QUERY_RESOLVE | U.COPY_SRC);
      this.readBuf = buffer(16, U.MAP_READ | U.COPY_DST);
    }

    const upload = (data) => {
      const b = dev.createBuffer({ size: Math.ceil(data.byteLength / 16) * 16, usage: U.STORAGE, mappedAtCreation: true });
      new Uint16Array(b.getMappedRange()).set(data);
      b.unmap();
      return b;
    };
    const inputs = [upload(grid), upload(aux), upload(pos)];
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pre);
    pass.setBindGroup(0, bind(pre, [...inputs, xBuf, posBuf, nrmBuf]));
    pass.dispatchWorkgroups(Math.ceil(NP / 64));
    pass.end();
    dev.queue.submit([enc.finish()]);
    await dev.queue.onSubmittedWorkDone();
    inputs.forEach((b) => b.destroy());

    this.context = this.canvas.getContext('webgpu');
    this.halfContext = this.halfCanvas.getContext('webgpu');
    this.configure();
  }

  get kernelName() {
    return kernelKey(this.kernel);
  }

  forwardPipeline(k) {
    const code = forwardWGSL({ ...this.shapes, ...k });
    return this.device.createComputePipelineAsync({
      layout: this.fwdLayout,
      compute: { module: this.device.createShaderModule({ code, label: 'relight network' }), entryPoint: 'main' },
    });
  }

  setKernel(k, pipeline) {
    this.kernel = k;
    this.forward = pipeline;
    this.fwdGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: this.fwdBuffers.map((b, i) => ({ binding: i, resource: b.buffer ? b : { buffer: b } })),
    });
    this.tile = tileOf(k, this.shapes.WD / 4);
  }

  async tune(light, stride, runs = 3, signal = null, slot = 0) {
    const done = () => this.device.queue.onSubmittedWorkDone();
    const timing = this.timing;
    this.timing = { ...timing, pending: {} };
    const times = {};
    let best = null;
    try {
      for (const k of this.kernels) {
        if (signal?.aborted) {
          break;
        }
        const pipeline =
          kernelKey(k) === kernelKey(this.kernel)
            ? this.forward
            : await this.forwardPipeline(k).catch(() => null);
        if (!pipeline || signal?.aborted) {
          continue;
        }
        this.setKernel(k, pipeline);
        // first run sets up the pipeline
        this.evaluate(light, slot, stride);
        await done();
        if (signal?.aborted) {
          break;
        }
        const t0 = performance.now();
        for (let i = 0; i < runs; i += 1) {
          this.evaluate(light, slot, stride);
        }
        await done();
        const ms = (performance.now() - t0) / runs;
        times[kernelKey(k)] = ms;
        if (!best || ms < best.ms) {
          best = { k, pipeline, ms };
        }
      }
    } finally {
      this.timing = timing;
    }
    if (best) {
      this.setKernel(best.k, best.pipeline);
    }
    return { kernel: this.kernelName, times };
  }

  configure() {
    [this.context, this.halfContext].forEach((c) =>
      c.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })
    );
  }

  // firefox forgets the canvas config every snapshot so reconfigure each time
  currentTexture(context = this.context) {
    try {
      return context.getCurrentTexture();
    } catch (error) {
      this.configure();
      return context.getCurrentTexture();
    }
  }

  // a frame's passes go in one encoder and one submit: beginFrame, then evaluate / resolve /
  // composite as often as it likes, then endFrame. the fixed cost of a submit was most of a
  // pass at the strides phones run. outside a frame every pass submits on its own
  beginFrame() {
    this.framing = true;
  }

  endFrame() {
    this.framing = false;
    this.flush();
  }

  encoder() {
    if (!this.enc) {
      this.enc = this.device.createCommandEncoder();
    }
    return this.enc;
  }

  commit() {
    if (!this.framing) {
      this.flush();
    }
  }

  flush() {
    if (!this.enc) {
      return;
    }
    const dev = this.device;
    if (this.ringUsed) {
      dev.queue.writeBuffer(this.ringBuf, 0, this.ring, 0, this.ringUsed * this.ringStride);
    }
    dev.queue.submit([this.enc.finish()]);
    this.enc = null;
    this.ringUsed = 0;
    const after = this.afterSubmit;
    this.afterSubmit = [];
    after.forEach((f) => f());
  }

  // a pass's uniforms, returns their offset in the ring. a full ring submits what's queued
  stage(data) {
    if (this.ringUsed === RING) {
      this.flush();
    }
    const at = this.ringUsed * this.ringStride;
    this.ring.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), at);
    this.ringUsed += 1;
    return at;
  }

  evaluate(light, slot, stride = 1, r0 = 0, r1 = this.rows(stride), c0 = 0, c1 = this.cols(stride), phase = NO_PHASE) {
    r1 = Math.min(r1, this.rows(stride));
    c1 = Math.min(c1, this.cols(stride));
    const xw = c1 - c0;
    const i0 = r0 * xw;
    const i1 = r1 * xw;
    if (i1 <= i0 || xw <= 0) {
      return;
    }
    const ln = this.normLight(light);
    const { fwdU32, fwdF32 } = this;
    fwdU32.set([i0, i1, stride, slot, c0, xw, phase[0], phase[1]]);
    fwdF32.set(light.pos, 8);
    fwdF32[11] = light.radius;
    const w = this.w0Light;
    for (let c = 0; c < this.b0.length; c += 1) {
      fwdF32[12 + c] =
        this.b0[c] + w[c * 4] * ln[0] + w[c * 4 + 1] * ln[1] + w[c * 4 + 2] * ln[2] + w[c * 4 + 3] * ln[3];
    }

    const canStamp = Boolean(this.querySet && this.readBuf.mapState === 'unmapped');
    const timed = this.timeable(stride, r0, r1, c0, c1, canStamp);
    const stamped = timed && canStamp;
    // without timestamps the queue emptying times it, so it goes in a submit of its own
    const alone = timed && !stamped;
    if (alone) {
      this.flush();
    }
    const queued = alone ? this.queueDone() : null;
    const at = this.stage(fwdF32);
    const enc = this.encoder();
    const pass = enc.beginComputePass(
      stamped
        ? { timestampWrites: { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
        : undefined
    );
    pass.setPipeline(this.forward);
    pass.setBindGroup(0, this.fwdGroup, [at]);
    pass.dispatchWorkgroups(Math.ceil((i1 - i0) / this.tile));
    pass.end();
    if (stamped) {
      enc.resolveQuerySet(this.querySet, 0, 2, this.queryBuf, 0);
      enc.copyBufferToBuffer(this.queryBuf, 0, this.readBuf, 0, 16);
    }
    if (timed) {
      this.time(stride, this.share(stride, r0, r1, c0, c1), stamped, queued);
    }
    if (alone) {
      this.flush();
    } else {
      this.commit();
    }
  }

  // slot is the evaluation, target the light's full res image. keep is the span that image
  // already holds (x0, x1, y0, y1), outside it pixels are just upsampled
  resolve(slot, target, stride, phase, [r0, r1, c0, c1], alpha, keep = null) {
    r1 = Math.min(r1, this.rows(stride));
    c1 = Math.min(c1, this.cols(stride));
    const [x0, x1, y0, y1] = this.span(stride, r0, r1, c0, c1);
    if (x1 <= x0 || y1 <= y0) {
      return null;
    }
    const k = keep && alpha < 1 ? keep : [0, 0, 0, 0];
    const keepsAll = k[0] <= x0 && k[1] >= x1 && k[2] <= y0 && k[3] >= y1;
    const sparse = (stride === 1 && phase[0] === 0 && phase[1] === 0) || (alpha <= 0 && keepsAll) ? 1 : 0;
    const R = this.resU32;
    R.set([stride, phase[0], phase[1], slot, SLOTS - RESOLVED + target, c0, c1, r0, r1, x0, y0, x1 - x0, y1 - y0]);
    R.set([k[0], k[2], k[1], k[3]], 13);
    this.resF32[17] = alpha;
    this.resF32[18] = (1.5 * 2 * this.cam.tx) / this.W;
    R[19] = sparse;
    const at = this.stage(R);
    const pass = this.encoder().beginComputePass();
    pass.setPipeline(this.resolvePipeline);
    pass.setBindGroup(0, this.resolveGroup, [at]);
    const items = sparse ? (c1 - c0) * (r1 - r0) : (x1 - x0) * (y1 - y0);
    pass.dispatchWorkgroups(Math.ceil(items / 64));
    pass.end();
    this.commit();
    return [x0, x1, y0, y1];
  }

  queueDone() {
    return this.device.queue.onSubmittedWorkDone().then(() => performance.now());
  }

  // no timestamp queries on a lot of phones. timing from submit counted the rest of the
  // frame and made the network look several times slower than it is
  time(stride, share, stamped, queued) {
    const pending = { stride, share, done: false, ms: null };
    this.timing.pending = pending;
    const settle = (ms) => {
      pending.ms = ms > 0 ? ms : null;
      pending.done = true;
    };
    // the readback can only start once its pass is submitted
    this.afterSubmit.push(() => this.readTiming(stamped, queued, settle));
  }

  readTiming(stamped, queued, settle) {
    const start = performance.now();
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
      // chrome sometimes resolves both at once behind a long queue, fall back to time since submit
      Promise.all([queued, this.queueDone()])
        .then(([before, after]) => {
          const ms = after - Math.max(start, before);
          settle(ms > QUEUE_GRAIN ? ms : after - start);
        })
        .catch(() => settle(null));
    }
  }

  pollTiming() {
    const pending = this.timing.pending;
    if (pending?.done) {
      this.timing.pending = null;
      this.recordTiming(pending.stride, pending.share, pending.ms);
    }
  }

  // view is the part of the image that's shown, the rest isn't drawn (see RelightBase drawRect)
  composite(lights, exposure = 1, view = null) {
    if (!this.frame) {
      this.frame = new Float32Array(24 + SLOTS * 12);
      const { X, Y, Z, O, tx, ty } = this.cam;
      [O, X, Y, Z, [tx, ty]].forEach((v, i) => this.frame.set(v, i * 4));
      this.frameU32 = new Uint32Array(this.frame.buffer);
    }
    const F = this.frame;
    const U32 = this.frameU32;
    F[20] = exposure;
    const n = Math.min(lights.length, SLOTS);
    U32[21] = n;
    for (let i = 0; i < n; i += 1) {
      const l = lights[i];
      const o = 24 + i * 12;
      F[o] = l.pos[0];
      F[o + 1] = l.pos[1];
      F[o + 2] = l.pos[2];
      F[o + 3] = l.radius;
      for (let c = 0; c < 3; c += 1) {
        F[o + 4 + c] = l.color[c] * l.intensity;
      }
      // full res images sit in the last slots
      const resolved = l.resolved != null;
      U32[o + 8] = resolved ? SLOTS - RESOLVED + l.resolved : l.slot;
      U32[o + 9] = resolved ? 1 : l.stride || 1;
      U32[o + 10] = l.hidden ? 0 : 1;
    }
    const at = this.stage(F);
    const pass = this.encoder().beginRenderPass({
      colorAttachments: [{ view: this.imageView, loadOp: 'load', storeOp: 'store' }],
    });
    // rows are bottom first here, the rect's are from the top
    const [x0, x1, y0, y1] = this.drawRect(view);
    pass.setScissorRect(x0, this.H - y1, x1 - x0, y1 - y0);
    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, this.compositeGroup, [at]);
    pass.draw(3);
    pass.end();
    this.commit();
  }

  copyImage(context) {
    const pass = this.encoder().beginRenderPass({
      colorAttachments: [{ view: this.currentTexture(context).createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, this.blitGroup);
    pass.draw(3);
    pass.end();
  }

  snapshot() {
    this.copyImage(this.context);
    this.flush();
    return this.canvas.transferToImageBitmap();
  }

  // half size for the three.js copy the glass bends, it's blurred there anyway. handed over once
  // the frame's submitted
  halfImage(done) {
    this.copyImage(this.halfContext);
    this.afterSubmit.push(() => done(this.halfCanvas.transferToImageBitmap()));
    this.commit();
  }

  dispose() {
    this.enc = null;
    this.afterSubmit = [];
    this.image?.destroy();
    this.image = null;
    this.halfContext?.unconfigure();
    this.context?.unconfigure();
    this.querySet?.destroy();
    this.buffers.forEach((b) => b.destroy());
    this.buffers = [];
  }
}
