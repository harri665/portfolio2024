// the room on its own fixed canvas. in the three.js canvas it rode up with every scroll
// and snapped back (browser scrolls on its own thread), so that canvas only draws the glass now

// catmull-rom upscale (5 bilinear taps) since it's shown several times larger on phones,
// clamped to the 4 nearest pixels so the light's disc doesn't ring dark
export const ROOM_FRAGMENT = `
  uniform sampler2D tRelight;
  uniform vec2 texSize;
  uniform float dpr;
  uniform vec2 viewport;
  uniform vec4 box;
  uniform float ready;
  uniform float dim;
  uniform float saturation;
  uniform float hotKeep;
  uniform vec3 glowAt;
  uniform vec3 glowColor;

  vec3 sharpSample(vec2 uv) {
    vec2 pos = uv * texSize;
    vec2 c = floor(pos - 0.5) + 0.5;
    vec2 f = pos - c;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 t0 = (c - 1.0) / texSize;
    vec2 t3 = (c + 2.0) / texSize;
    vec2 t12 = (c + w2 / w12) / texSize;
    vec3 sum = texture2D(tRelight, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y)
      + texture2D(tRelight, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
      + texture2D(tRelight, t12).rgb * (w12.x * w12.y)
      + texture2D(tRelight, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
      + texture2D(tRelight, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
    float weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    vec2 a = c / texSize;
    vec2 b = (c + 1.0) / texSize;
    vec3 p00 = texture2D(tRelight, a).rgb;
    vec3 p10 = texture2D(tRelight, vec2(b.x, a.y)).rgb;
    vec3 p01 = texture2D(tRelight, vec2(a.x, b.y)).rgb;
    vec3 p11 = texture2D(tRelight, b).rgb;
    return clamp(sum / weight, min(min(p00, p10), min(p01, p11)), max(max(p00, p10), max(p01, p11)));
  }

  float sdRoundBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 px = vec2(gl_FragCoord.x, viewport.y * dpr - gl_FragCoord.y) / dpr;
    vec3 base = vec3(0.031, 0.035, 0.047);
    vec3 color = base;

    if (ready > 0.0) {
      vec2 uv = (px - box.xy) / box.z;
      float d = sdRoundBox(uv - 0.5, vec2(0.5), 0.05);
      float mask = 1.0 - smoothstep(-box.w, 0.0, d);
      if (mask > 0.0) {
        vec3 image = sharpSample(vec2(uv.x, 1.0 - uv.y));
        float luma = dot(image, vec3(0.2126, 0.7152, 0.0722));
        float hot = smoothstep(0.82, 0.97, luma) * hotKeep;
        image = mix(mix(vec3(luma), image, saturation) * dim, image, hot);
        color = mix(base, max(image, base), mask * ready);
      }

      float r = length(px - glowAt.xy);
      float reach = glowAt.z * 2.5 + 26.0;
      color += glowColor * exp(-r / reach) * smoothstep(glowAt.z * 0.6, glowAt.z * 1.6, r) * ready;
    }

    color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const VERTEX = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const UNIFORMS = ['texSize', 'dpr', 'viewport', 'box', 'ready', 'dim', 'saturation', 'hotKeep', 'glowAt', 'glowColor'];

export class RoomLayer {
  constructor(before) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '100%',
      // large viewport on phones so it doesn't resize when the toolbar collapses
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '0',
    });
    canvas.style.height = '100lvh';
    const options = { alpha: false, antialias: false, depth: false, stencil: false };
    const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
    if (!gl) {
      throw new Error('WebGL is not available');
    }
    this.canvas = canvas;
    this.gl = gl;

    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl.FRAGMENT_SHADER, `precision highp float;\n${ROOM_FRAGMENT}`);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`room layer shader: ${gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(program);
    this.locations = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(gl.getUniformLocation(program, 'tRelight'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    // rows come bottom first already
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    this.drawn = null;
    before.parentNode.insertBefore(canvas, before);
  }

  setImage(source) {
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.drawn = null;
  }

  // skipped if nothing changed, the canvas keeps its last frame
  draw(uniforms, width, height, dpr) {
    const gl = this.gl;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.drawn = null;
    }
    const values = UNIFORMS.map((name) => {
      const v = name === 'dpr' ? dpr : name === 'viewport' ? [width, height] : uniforms[name].value;
      return typeof v === 'number' ? v : Array.isArray(v) ? v : v.toArray();
    });
    const key = JSON.stringify(values);
    if (key === this.drawn) {
      return;
    }
    this.drawn = key;
    values.forEach((v, i) => {
      const at = this.locations[UNIFORMS[i]];
      if (typeof v === 'number') {
        gl.uniform1f(at, v);
      } else {
        gl[`uniform${v.length}fv`](at, v);
      }
    });
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }
}
