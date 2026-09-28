// What the WebGL and WebGPU engines share: the scene's camera and light
// domain, and the model of what an evaluation costs on this GPU.
//
// Both evaluate a light into a slot at a stride s: every s-th pixel only, in
// a compact ceil(W/s) x ceil(H/s) grid the composite upsamples along the
// geometry. Evaluations can run a band of that grid's rows at a time.

// two lights, double buffered
export const SLOTS = 4;
// below this the fixed per pass cost outweighs the rows (many times over on webgl)
export const MIN_BAND_ROWS = 16;
// thin bands make the gpu look slow. 16 rows at 768px read ~16ms for a light that takes ~8
const MIN_TIMED_SHARE = 0.25;

export class RelightBase {
  constructor(scene, geom) {
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
  }

  rows(stride = 1) {
    return Math.ceil(this.H / stride);
  }

  // Whether an evaluation of rows r0 to r1 at `stride` is worth timing
  timeable(stride, r0, r1) {
    const rows = this.rows(stride);
    return !this.timing.pending && r1 - r0 >= Math.min(rows, Math.max(MIN_BAND_ROWS, rows * MIN_TIMED_SHARE));
  }

  recordTiming(stride, share, ms) {
    this.timing.samples += 1;
    // first runs include shader compiles
    if (ms === null || this.timing.samples <= 2) {
      return;
    }
    const full = ms / share;
    if (this.timing.seeded) {
      this.timing.seeded = false;
      this.timing.byStride = {};
    }
    const t = this.timing.byStride;
    // drops fast, rises slow, so one stall doesn't make a fast gpu look slow
    t[stride] = !t[stride] ? full : full < t[stride] ? 0.5 * t[stride] + 0.5 * full : 0.9 * t[stride] + 0.1 * full;
  }

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

  // each measured stride k predicts t[k] * (k / s)^2
  evalCost(s) {
    const t = this.timing.byStride;
    const known = Object.keys(t).map(Number);
    if (!known.length) {
      return null;
    }
    return Math.min(...known.map((k) => t[k] * (k / s) ** 2));
  }

  normLight(l) {
    const { lo, hi } = this;
    return [0, 1, 2]
      .map((i) => (2 * (l.pos[i] - lo[i])) / (hi[i] - lo[i]) - 1)
      .concat([(2 * (l.radius - this.rmin)) / (this.rmax - this.rmin) - 1]);
  }

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
}
