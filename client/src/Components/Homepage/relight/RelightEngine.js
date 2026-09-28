// Neural relighting of a Cornell box, for the CS home page's backdrop. A
// trimmed port of the WebGL2 runtime from my relight project, a browser
// implementation of Neural Render Proxies (Sancho et al., EGSR 2026). It keeps
// only the forward pass, and it runs on three.js's own WebGL2 context, so its
// image is an ordinary render target that the glass pass can bend. Where
// WebGPU is available, RelightGPU runs the same network about four times
// faster; this is the fallback.
//
// no compute shaders in webgl2 so the MLP is a chain of fragment passes over bands of rows,
// ping-ponging activations between two texture arrays

import { RelightBase, SLOTS } from './RelightBase';

export { SLOTS };

// 32MB ran ~20% faster than 8MB
const BAND_BYTES = 16 << 20;

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

// rows bottom first, that's what three.js render targets expect
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

// Builds everything on `gl` straight away, from a loaded scene
// (loadRelightScene) and its encoded pixels (encodePixels). The caller must
// hand over a clean GL state (three.js: renderer.resetState()) and reset
// three.js's cache after every call into the engine, which leaves its own
// bindings behind. bandBytes: the size of one activation texture array.
export class RelightEngine extends RelightBase {
  constructor(gl, { scene, layers, geom }, { X, XG, normal4 }, { bandBytes = BAND_BYTES } = {}) {
    super(scene, geom);
    this.gl = gl;
    this.backend = 'webgl';
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('this GPU cannot render to floating-point textures');
    }
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const { W, H } = this;
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
    const th = Math.max(8, Math.min(H, Math.floor(bandBytes / (W * G * 8))));
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

    this.startTiming(stride, r0, r1);
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
  // A timer query when the GPU has one, otherwise a fence (which also counts
  // whatever three.js queued before, so it errs slow)

  startTiming(stride, r0, r1) {
    const gl = this.gl;
    if (!this.timeable(stride, r0, r1)) {
      this.timing.skip = true;
      return;
    }
    this.timing.skip = false;
    const pending = { stride, share: (r1 - r0) / this.rows(stride), start: performance.now() };
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
    this.recordTiming(pending.stride, pending.share, ms);
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
