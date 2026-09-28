// Neural relighting of a Cornell box, for the CS home page's backdrop. A
// trimmed port of the WebGL2 runtime from my relight project, a browser
// implementation of Neural Render Proxies (Sancho et al., EGSR 2026). It keeps
// only the forward pass, and it runs on three.js's own WebGL2 context, so its
// image is an ordinary render target that the glass pass can bend.
//
// A small MLP predicts every pixel's indirect light from one sphere light.
// Each light is evaluated into its own slot of a texture array, so changing a
// light's colour or brightness costs nothing and moving a light re-evaluates
// only that light. The composite sums the slots, adds each light's own disc
// analytically, tonemaps, and writes sRGB.
//
// WebGL2 has no compute shaders, so the network runs as a chain of
// fragment-shader passes over a band of rows at a time. Each pass writes OUT
// groups of 4 channels of the next layer into layers of a texture array,
// reading the previous layer from the other array and its weights from a
// uniform buffer. A light can also be evaluated on every s-th pixel only (its
// stride), a cheap preview the composite upsamples along the geometry.

// Light slots in the output array: two lights, double-buffered
export const SLOTS = 4;
// Target size of one activation texture array
const BAND_BYTES = 8 << 20;

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

function typed(buf, entry) {
  const n = entry.shape.reduce((a, b) => a * b, 1);
  if (entry.dtype === 'float32') {
    return new Float32Array(buf, entry.offset, n);
  }
  const h = new Uint16Array(buf, entry.offset, n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = f16tab[h[i]];
  }
  return out;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
// Longest stretch of preparation between yields to the page (ms)
const SLICE_MS = 6;

// Fetches a scene exported by the relight project (scene.json, model.bin,
// pixels.bin) and does the CPU-side preparation: the network's
// light-independent inputs for every pixel (its grid encoding and the aux
// features). Yields every few ms so the page keeps scrolling meanwhile.
// `suffix` picks another image size of the same network (scene-768.json and
// pixels-768.bin for '-768'); model.bin is shared.
export async function loadRelightScene(base, signal, suffix = '') {
  const get = async (file) => {
    const response = await fetch(`${base}/${file}`, { signal });
    if (!response.ok) {
      throw new Error(`failed to load ${file} (${response.status})`);
    }
    return response;
  };
  const scene = await (await get(`scene${suffix}.json`)).json();
  const [model, pixels] = await Promise.all(
    ['model.bin', `pixels${suffix}.bin`].map(async (file) => (await get(file)).arrayBuffer())
  );
  await nextTask();

  const W = scene.width;
  const H = scene.height;
  const NP = W * H;
  const net = scene.network;
  if (net.light_grid) {
    throw new Error('light_grid models are not supported');
  }

  let gridLen = 0;
  const gridOff = scene.model.grids.map((g) => {
    const offset = gridLen;
    gridLen += g.shape[0] * g.shape[1] * g.shape[2];
    return offset;
  });
  const grid = new Float32Array(gridLen);
  scene.model.grids.forEach((g, i) => grid.set(typed(model, g), gridOff[i]));
  const layers = scene.model.layers.map((l) => ({
    w: typed(model, l.weight),
    b: typed(model, l.bias),
    shape: l.weight.shape,
  }));
  const aux = typed(pixels, scene.pixels.aux);
  const geom = typed(pixels, scene.pixels.geom);
  const normal = typed(pixels, scene.pixels.normal);
  await nextTask();

  const auxDim = net.aux_dim ?? 7;
  const levels = net.grid_res.length;
  const F = net.feats;
  const ENC = levels * F;
  const XG = Math.ceil((ENC + auxDim) / 4);
  // [group][pixel][4]
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
      if (signal?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      slice = performance.now();
    }
  }

  const normal4 = new Float32Array(NP * 4);
  for (let p = 0; p < NP; p += 1) {
    normal4[p * 4] = normal[p * 3];
    normal4[p * 4 + 1] = normal[p * 3 + 1];
    normal4[p * 4 + 2] = normal[p * 3 + 2];
  }

  return { scene, layers, X, XG, geom, normal4 };
}

const VS = `#version 300 es
void main() {
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float; precision highp int;
precision highp sampler2D; precision highp sampler2DArray;
`;

// One pass of a layer: `out` output groups from `kin` input groups.
// stage 'l0':  first layer. Pixel features come from `src` (xg groups), then
//              the normalised light, then (geo) 6 geometric features.
//       'hid': hidden layer, activations from `src` at the band-local row.
//       'out': output layer, written at the item's absolute row. With the
//              'mul' head, out = h[0..2] * G + h[3..5].
function layerFS({ kin, out, relu, stage, xg = 0, geo = false, mul = false }) {
  const J = [...Array(out).keys()];
  const acc = (x, b) =>
    J.map(
      (j) =>
        `a${j} += w[${b} + ${4 * j}] * ${x}.x + w[${b} + ${4 * j + 1}] * ${x}.y + ` +
        `w[${b} + ${4 * j + 2}] * ${x}.z + w[${b} + ${4 * j + 3}] * ${x}.w;`
    ).join('\n    ');
  const needItem = stage === 'l0' || (stage === 'out' && mul);
  const nTex = stage === 'l0' ? xg : kin;
  const targets = stage === 'out' ? 1 : out;
  return `${HEAD}
uniform sampler2DArray src;
layout(std140) uniform Wt { vec4 w[${kin * out * 4}]; };
uniform vec4 bias[${out}];
uniform int yOff;
${needItem ? 'uniform vec4 ln; uniform int stride;' : ''}
${geo || mul ? `uniform sampler2D geomT; uniform sampler2D normT;
uniform vec3 boxLo, boxHi; uniform vec2 radRange;
// Direction and cosine to the light, log distance and log solid angle, and the
// unshadowed irradiance factor G
void geoFeatures(ivec2 px, vec4 L, out vec4 g0, out vec4 g1, out float G) {
  vec3 c = boxLo + (L.xyz + 1.0) * 0.5 * (boxHi - boxLo);
  float r = radRange.x + (L.w + 1.0) * 0.5 * (radRange.y - radRange.x);
  vec4 gm = texelFetch(geomT, px, 0);
  float valid = gm.w > 0.0 ? 1.0 : 0.0;
  vec3 v = c - gm.xyz;
  float d = max(length(v), 1e-4);
  vec3 l = v / d;
  float cosv = dot(texelFetch(normT, px, 0).xyz, l);
  float s = min(r / d, 1.0);
  float omega = 6.283185307 * s * s / (1.0 + sqrt(max(1.0 - s * s, 0.0)));
  g0 = vec4(l, cosv) * valid;
  g1 = vec4(0.5 * log(d), 0.25 * log(omega + 1e-6), 0.0, 0.0) * valid;
  G = omega * max(cosv, 0.0) / 3.141592654 * valid;
}` : ''}
${[...Array(targets).keys()].map((j) => `layout(location = ${j}) out vec4 o${j};`).join('\n')}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  ${stage === 'l0' ? 'vec4 L = ln; ivec2 px = ivec2(q.x, q.y + yOff) * stride;' : 'ivec2 px = ivec2(q.x, q.y - yOff);'}
  ${stage === 'out' && mul ? 'vec4 L = ln; ivec2 ip = q * stride;' : ''}
  ${J.map((j) => `vec4 a${j} = bias[${j}];`).join(' ')}
  for (int k = 0; k < ${nTex}; k++) {
    vec4 x = texelFetch(src, ivec3(px, k), 0);
    int b = k * ${out * 4};
    ${acc('x', 'b')}
  }
  ${stage === 'l0' ? acc('L', xg * out * 4) : ''}
  ${stage === 'l0' && geo ? `vec4 g0, g1; float G;
  geoFeatures(px, L, g0, g1, G);
  ${acc('g0', (xg + 1) * out * 4)}
  ${acc('g1', (xg + 2) * out * 4)}` : ''}
  ${stage === 'out' && mul
    ? `vec4 g0, g1; float G;
  geoFeatures(ip, L, g0, g1, G);
  o0 = vec4(a0.xyz * G + vec3(a0.w, a1.xy), 0.0);`
    : stage === 'out'
      ? 'o0 = a0;'
      : J.map((j) => `o${j} = ${relu ? `max(a${j}, vec4(0.0))` : `a${j}`};`).join('\n  ')}
}`;
}

// Sums the lights and tonemaps. Rows are written bottom first, as three.js
// render targets expect.
const compositeFS = (W, H) => `${HEAD}
uniform sampler2DArray outT; uniform sampler2D geomT;
uniform vec3 camO, camX, camY, camZ; uniform vec2 tanxy;
uniform float exposure; uniform int nLights;
uniform vec4 lPR[${SLOTS}]; uniform vec3 lE[${SLOTS}]; uniform ivec3 lInfo[${SLOTS}];  // slot, stride, disc shown
layout(location = 0) out vec4 disp;
const float W = ${W}.0, H = ${H}.0;

vec3 camDir(vec2 uv) {
  return normalize(camX * ((0.5 - uv.x) * 2.0 * tanxy.x) + camY * ((0.5 - uv.y) * 2.0 * tanxy.y) + camZ);
}
// How much of the pixel sees the light's own disc, 4x4 supersampled and
// hidden behind nearer surfaces
float directCov(ivec2 pix, int l) {
  vec3 c = lPR[l].xyz; float r = lPR[l].w;
  vec4 g = texelFetch(geomT, pix, 0);
  float surf = g.w > 0.0 ? g.w : 1e9;
  vec3 oc = camO - c;
  float px = float(pix.x), py = float(pix.y);
  vec3 d0 = camDir(vec2((px + 0.5) / W, (py + 0.5) / H));
  float b0 = dot(d0, oc);
  float pixAng = 2.0 * tanxy.x / W * 1.5;
  float dist2 = dot(oc, oc) - b0 * b0;
  float slack = r + pixAng * length(oc);
  if (dist2 > slack * slack || b0 > 0.0) return 0.0;
  float cnt = 0.0;
  for (int sy = 0; sy < 4; sy++) {
    for (int sx = 0; sx < 4; sx++) {
      vec3 d = camDir(vec2((px + (float(sx) + 0.5) / 4.0) / W, (py + (float(sy) + 0.5) / 4.0) / H));
      float b = dot(d, oc);
      float disc = b * b - dot(oc, oc) + r * r;
      if (disc >= 0.0) {
        float t0 = -b - sqrt(disc);
        if (t0 > 0.0 && t0 < surf) cnt += 1.0;
      }
    }
  }
  return cnt / 16.0;
}
// A slot's network output at pix. A preview (stride s > 1) is upsampled
// bilinearly, weighted by surface position so light doesn't bleed across edges.
vec3 netAt(int slot, int s, ivec2 pix) {
  if (s <= 1) return max(texelFetch(outT, ivec3(pix, slot), 0).xyz, 0.0);
  ivec2 last = ivec2((${W} + s - 1) / s - 1, (${H} + s - 1) / s - 1);
  vec2 f = vec2(pix) / float(s);
  ivec2 c0 = min(ivec2(f), last), c1 = min(c0 + 1, last);
  vec2 t = f - vec2(c0);
  vec4 g = texelFetch(geomT, pix, 0);
  float sig = 1.5 * float(s) * 2.0 * tanxy.x / W * max(g.w, 1e-3);
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 c = ivec2((k & 1) == 1 ? c1.x : c0.x, k >= 2 ? c1.y : c0.y);
    float wb = ((k & 1) == 1 ? t.x : 1.0 - t.x) * (k >= 2 ? t.y : 1.0 - t.y);
    vec4 q = texelFetch(geomT, c * s, 0);
    vec3 dq = q.xyz - g.xyz;
    float wg = (q.w > 0.0) == (g.w > 0.0) ? exp(-dot(dq, dq) / (2.0 * sig * sig)) : 0.0;
    float w = wb * (wg + 1e-4);
    acc += w * max(texelFetch(outT, ivec3(c, slot), 0).xyz, 0.0);
    ws += w;
  }
  return acc / max(ws, 1e-12);
}
vec3 tone(vec3 x) { vec3 y = max(x, 0.0) * exposure; return y / (1.0 + y); }
vec3 srgb(vec3 c) { return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, 12.92 * c, lessThanEqual(c, vec3(0.0031308))); }
void main() {
  ivec2 pix = ivec2(int(gl_FragCoord.x), ${H - 1} - int(gl_FragCoord.y));
  vec3 I = vec3(0.0);
  for (int l = 0; l < ${SLOTS}; l++) {
    if (l >= nLights) break;
    I += lE[l] * (netAt(lInfo[l].x, lInfo[l].y, pix) + (lInfo[l].z != 0 ? directCov(pix, l) : 0.0));
  }
  disp = vec4(clamp(srgb(tone(I)), 0.0, 1.0), 1.0);
}`;

// A layer's weights split into passes of `out` output groups. Uniform block of
// pass p: w[(k * out + j) * 4 + c] = weights from input (group k, component c)
// to outputs 4(p*out + j) .. +3. inCol(k, c) maps an input slot to a weight
// column, or -1 for padding.
function packLayer(layer, nIn, kin, out, inCol) {
  const nOut = layer.shape[0];
  const passes = Math.ceil(Math.ceil(nOut / 4) / out);
  return Array.from({ length: passes }, (_, p) => {
    const w = new Float32Array(kin * out * 16);
    const b = new Float32Array(out * 4);
    for (let j = 0; j < out; j += 1) {
      for (let r = 0; r < 4; r += 1) {
        const o = 4 * (p * out + j) + r;
        if (o >= nOut) {
          continue;
        }
        b[j * 4 + r] = layer.b[o];
        for (let k = 0; k < kin; k += 1) {
          for (let c = 0; c < 4; c += 1) {
            const i = inCol(k, c);
            if (i >= 0) {
              w[((k * out + j) * 4 + c) * 4 + r] = layer.w[o * nIn + i];
            }
          }
        }
      }
    }
    return { w, b };
  });
}

// Builds everything on `gl` straight away. The caller must hand over a clean
// GL state (three.js: renderer.resetState()) and reset three.js's cache after
// every call into the engine, which leaves its own bindings behind.
export class RelightEngine {
  constructor(gl, { scene, layers, X, XG, geom, normal4 }) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('this GPU cannot render to floating-point textures');
    }
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.scene = scene;
    this.geom = geom;
    const W = scene.width;
    const H = scene.height;
    this.W = W;
    this.H = H;

    const M = scene.camera.to_world;
    const col = (j) => [M[0][j], M[1][j], M[2][j]];
    const tx = Math.tan((scene.camera.fov * Math.PI) / 360);
    this.cam = { X: col(0), Y: col(1), Z: col(2), O: col(3), tx, ty: (tx * H) / W };
    [this.lo, this.hi] = scene.light_bbox;
    [this.rmin, this.rmax] = scene.radius_range;
    this.timing = { byStride: {}, samples: 0, pending: null, seeded: false };
    this.resources = { textures: [], framebuffers: [], programs: [], buffers: [] };

    const net = scene.network;
    const WD = net.width;
    const NH = net.hidden - 1;
    const G = WD / 4;
    const auxDim = net.aux_dim ?? 7;
    const geo = !!net.geo;
    const mul = net.head === 'mul';
    const PIXIN = net.grid_res.length * net.feats + auxDim;
    const IN = layers[0].shape[1];
    if (IN !== PIXIN + 4 + (geo ? 6 : 0)) {
      throw new Error(`unexpected first-layer width ${IN}`);
    }
    this.NH = NH;

    // Output groups per pass: bounded by render targets, 64 B of targets per
    // pixel, and the uniform block size
    const P = (p) => gl.getParameter(p);
    const maxBlock = P(gl.MAX_UNIFORM_BLOCK_SIZE);
    const align = P(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT);
    const maxRT = Math.min(P(gl.MAX_DRAW_BUFFERS), P(gl.MAX_COLOR_ATTACHMENTS));
    let out = Math.max(1, Math.min(maxRT, 8, Math.floor(maxBlock / (G * 64))));
    while (G % out) {
      out -= 1;
    }

    // Weights in one uniform buffer, one aligned block per (layer, pass)
    const blocks = [];
    let uboLen = 0;
    const place = ({ w, b }) => {
      const off = uboLen;
      uboLen += Math.ceil(w.byteLength / align) * align;
      blocks.push([off, w]);
      return { off, size: w.byteLength, b };
    };
    const l0 = packLayer(layers[0], IN, XG + 1 + (geo ? 2 : 0), out, (k, c) => {
      if (k < XG) {
        return 4 * k + c < PIXIN ? 4 * k + c : -1;
      }
      // the light (4), then the geometric features (6)
      const i = PIXIN + 4 * (k - XG) + c;
      return i < IN ? i : -1;
    });
    const hidden = layers.slice(1, NH + 1).map((L) => packLayer(L, WD, G, out, (k, c) => 4 * k + c));
    const weights = [l0, ...hidden].map((passes) => passes.map(place));
    this.wOut = place(packLayer(layers[NH + 1], WD, G, mul ? 2 : 1, (k, c) => 4 * k + c)[0]);
    const all = new Float32Array(uboLen / 4);
    blocks.forEach(([off, w]) => all.set(w, off / 4));
    this.ubo = gl.createBuffer();
    this.resources.buffers.push(this.ubo);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, all, gl.STATIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    const A2 = gl.TEXTURE_2D_ARRAY;
    const T2 = gl.TEXTURE_2D;
    this.xTex = this.texture(A2, gl.RGBA16F, W, H, XG);
    gl.texSubImage3D(A2, 0, 0, 0, 0, W, H, XG, gl.RGBA, gl.FLOAT, X);
    this.geomTex = this.texture(T2, gl.RGBA32F, W, H);
    gl.texSubImage2D(T2, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, new Float32Array(geom));
    this.normTex = this.texture(T2, gl.RGBA16F, W, H);
    gl.texSubImage2D(T2, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, normal4);
    this.outTex = this.texture(A2, gl.RGBA16F, W, H, SLOTS);
    this.outFbos = Array.from({ length: SLOTS }, (_, s) => this.framebuffer([[this.outTex, s]]));

    this.vao = gl.createVertexArray();
    this.pComp = this.program(compositeFS(W, H), 'composite');
    // Activations for a band of rows, ping-ponged between two arrays
    const th = Math.max(8, Math.min(H, Math.floor(BAND_BYTES / (W * G * 8))));
    const arrs = [0, 1].map(() => this.texture(A2, gl.RGBA16F, W, th, G));
    this.net = {
      th,
      arrs,
      fbos: arrs.map((t) =>
        Array.from({ length: G / out }, (_, p) =>
          this.framebuffer(Array.from({ length: out }, (_, j) => [t, p * out + j]))
        )
      ),
      w: weights,
      mul,
      l0: this.program(layerFS({ kin: XG + 1 + (geo ? 2 : 0), out, relu: true, stage: 'l0', xg: XG, geo }), 'layer 0'),
      hid: this.program(layerFS({ kin: G, out, relu: true, stage: 'hid' }), 'hidden layer'),
      out: this.program(layerFS({ kin: G, out: mul ? 2 : 1, relu: false, stage: 'out', mul }), 'output layer'),
    };
    gl.bindVertexArray(null);
    gl.bindTexture(A2, null);
    gl.bindTexture(T2, null);
  }

  // ─── GL helpers ─────────────────────────────────────────────────────────

  texture(target, format, w, h, layers = 1) {
    const gl = this.gl;
    const t = gl.createTexture();
    this.resources.textures.push(t);
    gl.bindTexture(target, t);
    if (target === gl.TEXTURE_2D_ARRAY) {
      gl.texStorage3D(target, 1, format, w, h, layers);
    } else {
      gl.texStorage2D(target, 1, format, w, h);
    }
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // A framebuffer over [texture, layer] attachments, one draw buffer each
  framebuffer(attach) {
    const gl = this.gl;
    const f = gl.createFramebuffer();
    this.resources.framebuffers.push(f);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    attach.forEach(([t, layer], j) =>
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + j, t, 0, layer)
    );
    gl.drawBuffers(attach.map((_, j) => gl.COLOR_ATTACHMENT0 + j));
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  program(fs, label) {
    const gl = this.gl;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VS);
    const f = shader(gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    const log = gl.getProgramParameter(p, gl.LINK_STATUS)
      ? null
      : gl.getShaderInfoLog(f) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(p);
    gl.deleteShader(vs);
    gl.deleteShader(f);
    if (log !== null) {
      gl.deleteProgram(p);
      throw new Error(`${label} shader: ${log}`);
    }
    this.resources.programs.push(p);
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i += 1) {
      const name = gl.getActiveUniform(p, i).name;
      u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
    }
    const block = gl.getUniformBlockIndex(p, 'Wt');
    if (block !== gl.INVALID_INDEX) {
      gl.uniformBlockBinding(p, block, 0);
    }
    gl.useProgram(p);
    [['src', 0], ['outT', 0], ['geomT', 2], ['normT', 4]].forEach(([name, unit]) => {
      if (u[name]) {
        gl.uniform1i(u[name], unit);
      }
    });
    if (u.boxLo) {
      gl.uniform3fv(u.boxLo, this.lo);
      gl.uniform3fv(u.boxHi, this.hi);
      gl.uniform2f(u.radRange, this.rmin, this.rmax);
    }
    gl.useProgram(null);
    return { p, u };
  }

  // ─── Evaluation ────────────────────────────────────────────────────────

  // Rows of the item grid a light at stride s spans
  rows(stride = 1) {
    return Math.ceil(this.H / stride);
  }

  // Evaluates `light` ({pos, radius}) at stride s into `slot`, rows r0 to r1
  // of its item grid (all of them by default)
  evaluate(light, slot, stride = 1, r0 = 0, r1 = this.rows(stride)) {
    const gl = this.gl;
    const E = this.net;
    const ln = this.normLight(light);
    const gw = Math.ceil(this.W / stride);
    const draw = (chunk, P) => {
      gl.bindBufferRange(gl.UNIFORM_BUFFER, 0, this.ubo, chunk.off, chunk.size);
      gl.uniform4fv(P.u.bias, chunk.b);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const setLight = (P) => {
      gl.uniform4fv(P.u.ln, ln);
      gl.uniform1i(P.u.stride, stride);
    };

    this.startTiming(stride, (r1 - r0) / this.rows(stride));
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.geomTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.normTex);
    for (let y0 = r0; y0 < r1; y0 += E.th) {
      const h = Math.min(E.th, r1 - y0);
      let cur = -1;
      for (let l = 0; l <= this.NH; l += 1) {
        const P = l === 0 ? E.l0 : E.hid;
        const dst = l === 0 ? 0 : 1 - cur;
        gl.useProgram(P.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, l === 0 ? this.xTex : E.arrs[cur]);
        gl.uniform1i(P.u.yOff, l === 0 ? y0 : 0);
        if (l === 0) {
          setLight(P);
        }
        gl.viewport(0, 0, gw, h);
        E.w[l].forEach((chunk, p) => {
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, E.fbos[dst][p]);
          draw(chunk, P);
        });
        cur = dst;
      }
      const P = E.out;
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, E.arrs[cur]);
      gl.uniform1i(P.u.yOff, y0);
      if (E.mul) {
        setLight(P);
      }
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.outFbos[slot]);
      gl.viewport(0, y0, gw, h);
      draw(this.wOut, P);
    }
    this.stopTiming();
  }

  // Draws the lit image into `framebuffer` (W x H). lights:
  // [{pos, radius, color, intensity, slot, stride, hidden}]; a hidden light
  // lights the room without its own disc showing
  composite(lights, framebuffer, exposure = 1) {
    const gl = this.gl;
    const { u, p } = this.pComp;
    const { X, Y, Z, O, tx, ty } = this.cam;
    gl.useProgram(p);
    gl.uniform3fv(u.camO, O);
    gl.uniform3fv(u.camX, X);
    gl.uniform3fv(u.camY, Y);
    gl.uniform3fv(u.camZ, Z);
    gl.uniform2f(u.tanxy, tx, ty);
    gl.uniform1f(u.exposure, exposure);
    const n = Math.min(lights.length, SLOTS);
    gl.uniform1i(u.nLights, n);
    const pr = new Float32Array(SLOTS * 4);
    const E = new Float32Array(SLOTS * 3);
    const info = new Int32Array(SLOTS * 3);
    lights.slice(0, n).forEach((l, i) => {
      pr.set([...l.pos, l.radius], i * 4);
      E.set(l.color.map((c) => c * l.intensity), i * 3);
      info.set([l.slot, l.stride || 1, l.hidden ? 0 : 1], i * 3);
    });
    gl.uniform4fv(u.lPR, pr);
    gl.uniform3fv(u.lE, E);
    gl.uniform3iv(u.lInfo, info);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.outTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.geomTex);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, this.W, this.H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ─── Timing ────────────────────────────────────────────────────────────
  // GPU time per evaluation, as ms for a whole light at each stride. A timer
  // query when the GPU has one, otherwise a fence (which also counts whatever
  // three.js queued before, so it errs slow).

  startTiming(stride, share) {
    const gl = this.gl;
    if (this.timing.pending || share <= 0) {
      this.timing.skip = true;
      return;
    }
    this.timing.skip = false;
    const pending = { stride, share, start: performance.now() };
    if (this.timer) {
      pending.query = gl.createQuery();
      gl.beginQuery(this.timer.TIME_ELAPSED_EXT, pending.query);
    }
    this.timing.pending = pending;
  }

  stopTiming() {
    const gl = this.gl;
    const pending = this.timing.pending;
    if (this.timing.skip || !pending) {
      return;
    }
    if (pending.query) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    } else {
      pending.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
  }

  // Call once a frame; collects a finished measurement
  pollTiming() {
    const gl = this.gl;
    const pending = this.timing.pending;
    if (!pending) {
      return;
    }
    let ms = null;
    if (pending.query) {
      if (!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) {
        return;
      }
      if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
        ms = gl.getQueryParameter(pending.query, gl.QUERY_RESULT) / 1e6;
      }
      gl.deleteQuery(pending.query);
    } else if (pending.sync) {
      if (gl.clientWaitSync(pending.sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
        return;
      }
      ms = performance.now() - pending.start;
      gl.deleteSync(pending.sync);
    }
    this.timing.pending = null;
    this.timing.samples += 1;
    // The first runs include compiling the shaders
    if (ms === null || this.timing.samples <= 2) {
      return;
    }
    const full = ms / pending.share;
    if (this.timing.seeded) {
      this.timing.seeded = false;
      this.timing.byStride = {};
    }
    const t = this.timing.byStride;
    const s = pending.stride;
    // Falls quickly, rises slowly: a one-off stall mustn't make a fast GPU
    // look slow for long
    t[s] = !t[s] ? full : full < t[s] ? 0.5 * t[s] + 0.5 * full : 0.9 * t[s] + 0.1 * full;
  }

  // Starts from costs measured on an earlier visit ({stride: ms}). They
  // stand in until this visit measures its own, which replace them all.
  seedTiming(byStride) {
    const t = {};
    Object.entries(byStride || {}).forEach(([s, ms]) => {
      if (Number(s) >= 1 && Number.isFinite(ms) && ms > 0) {
        t[s] = ms;
      }
    });
    if (Object.keys(t).length) {
      this.timing.byStride = t;
      this.timing.seeded = true;
    }
  }

  // Estimated ms to evaluate one whole light at stride s, or null before
  // anything was measured. Each measured stride k predicts t[k] * (k / s)^2.
  evalCost(s) {
    const t = this.timing.byStride;
    const known = Object.keys(t).map(Number);
    if (!known.length) {
      return null;
    }
    return Math.min(...known.map((k) => t[k] * (k / s) ** 2));
  }

  // ─── Camera and lights ─────────────────────────────────────────────────

  normLight(l) {
    const { lo, hi } = this;
    return [0, 1, 2]
      .map((i) => (2 * (l.pos[i] - lo[i])) / (hi[i] - lo[i]) - 1)
      .concat([(2 * (l.radius - this.rmin)) / (this.rmax - this.rmin) - 1]);
  }

  // World point -> image uv (0..1, y down) and camera depth
  project(p) {
    const { X, Y, Z, O, tx, ty } = this.cam;
    const v = [p[0] - O[0], p[1] - O[1], p[2] - O[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const zc = dot(v, Z);
    return { u: 0.5 - dot(v, X) / (zc * 2 * tx), v: 0.5 - dot(v, Y) / (zc * 2 * ty), z: zc };
  }

  unproject(u, v, zc) {
    const { X, Y, Z, O, tx, ty } = this.cam;
    const xc = (0.5 - u) * 2 * tx * zc;
    const yc = (0.5 - v) * 2 * ty * zc;
    return [0, 1, 2].map((i) => O[i] + X[i] * xc + Y[i] * yc + Z[i] * zc);
  }

  // Distance from the camera to the first surface through image uv, or
  // Infinity where the ray leaves the scene
  surfaceDistance(u, v) {
    const x = Math.min(this.W - 1, Math.max(0, Math.floor(u * this.W)));
    const y = Math.min(this.H - 1, Math.max(0, Math.floor(v * this.H)));
    const t = this.geom[(y * this.W + x) * 4 + 3];
    return t > 0 ? t : Infinity;
  }

  dispose() {
    const gl = this.gl;
    if (this.timing.pending?.query) {
      gl.deleteQuery(this.timing.pending.query);
    }
    if (this.timing.pending?.sync) {
      gl.deleteSync(this.timing.pending.sync);
    }
    this.resources.textures.forEach((t) => gl.deleteTexture(t));
    this.resources.framebuffers.forEach((f) => gl.deleteFramebuffer(f));
    this.resources.programs.forEach((p) => gl.deleteProgram(p));
    this.resources.buffers.forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(this.vao);
  }
}
