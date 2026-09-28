// Fits the relight backdrop to the device it runs on. Nothing is benchmarked
// up front and nothing extra is loaded: it watches the page's own frames and
// spends the GPU on image quality for as long as the page holds 30 fps. The
// display's own refresh rate isn't the goal; a frame that runs past 30 fps
// says the last thing asked of the GPU was too much.
//
// Three settings follow from that:
// - The network's budget per frame (ms of GPU time), which sets how coarse a
//   moving light's preview is and how far a resting one is refined. It grows
//   while frames that ran the network stay on time and backs off when one is
//   late.
// - The canvas's pixel ratio, which sets what every frame costs, the glass
//   most of all. It's judged only on frames with no network work, so the two
//   don't chase each other: a resting room that still misses frames has too
//   many pixels, and one that never does can afford more.
// - The image size the network runs at (its tier). The first visit loads a
//   small or a middle one; once the network has been timed, a GPU with room
//   to spare fetches the next size up in the background and swaps it in.
//
// What was learned is kept for the next visit (loadProfile, saveProfile).

// The slowest frame rate the page may drop to while the light moves
const MIN_FPS = 30;
// A frame is late once it runs this far past that (ms). The slack keeps
// frames that vsync rounds just past 33 ms (5 refreshes at 144 Hz, 9 at
// 240 Hz) on time.
const LATE_MS = 1000 / MIN_FPS + 5;
// Longer gaps are a hidden tab or a stall, not a frame (s)
const GAP = 0.25;
// Frames this soon after network work carry its cost
const WORK_FRAMES = 2;

// Budget (ms): between MIN and SHARE of a 30 fps frame, the rest left for the
// glass and the page. Each on-time frame with work grows it by GROW; a late
// one multiplies it by BACK_OFF and caps the climb at 90% of where it
// failed, a cap that then rises by CREEP a frame, so the budget settles just
// under what the GPU can take instead of missing a frame every second.
const BUDGET_MIN = 1;
const BUDGET_MAX = (1000 / MIN_FPS) * 0.7;
const GROW = 1.02;
const BACK_OFF = 0.75;
const CREEP = 1.0005;

// Pixel ratio: judged over windows of this many frames without work. Over
// DROP of them late lowers it a step; under KEEP for two windows running
// raises it, though never back to a ratio that has failed, which would only
// stutter again (a resting room costs the same every frame). A window drops
// as soon as it has seen enough late frames to fail.
const DPR_WINDOW = 90;
const DPR_STEP = 0.25;
const DPR_DROP = 0.2;
const DPR_KEEP = 0.02;
// Frames ignored after a change, while the canvas and glass resize
const DPR_SETTLE = 12;

export class AdaptiveQuality {
  // failedDpr: the lowest pixel ratio that missed frames (on an earlier visit)
  constructor({ budget, dpr, dprRange, failedDpr = Infinity }) {
    this.frameNo = 0;
    this.lastWork = -Infinity;
    this.budget = budget;
    this.ceiling = Infinity;
    [this.dprMin, this.dprMax] = dprRange;
    this.dpr = clamp(dpr, this.dprMin, this.dprMax);
    this.failedDpr = failedDpr;
    this.window = { frames: 0, late: 0, good: 0, settle: 0 };
  }

  // Once a frame, before any work, with the frame's delta (s). `judgeDpr`
  // lets the pixel ratio change; keep it off while loading, when the CPU
  // work would read as too many pixels. `hold` leaves everything be (while a
  // tier is prepared). Returns a new pixel ratio, or null.
  frame(delta, judgeDpr, hold = false) {
    this.frameNo += 1;
    if (!(delta > 0) || delta > GAP || hold) {
      return null;
    }
    const recent = this.frameNo - this.lastWork <= WORK_FRAMES;
    const late = delta * 1000 > LATE_MS;

    if (recent && late) {
      this.ceiling = this.budget * 0.9;
      this.budget *= BACK_OFF;
    } else if (recent) {
      this.ceiling *= CREEP;
      this.budget = Math.min(this.ceiling, this.budget * GROW);
    }
    this.budget = clamp(this.budget, BUDGET_MIN, BUDGET_MAX);

    return !recent && judgeDpr ? this.judgeDpr(late) : null;
  }

  // Call on a frame that ran the network
  worked() {
    this.lastWork = this.frameNo;
  }

  judgeDpr(late) {
    const w = this.window;
    if (w.settle > 0) {
      w.settle -= 1;
      return null;
    }
    w.frames += 1;
    w.late += late ? 1 : 0;
    if (w.frames < DPR_WINDOW && w.late <= DPR_WINDOW * DPR_DROP) {
      return null;
    }
    const rate = w.late / w.frames;
    w.frames = 0;
    w.late = 0;

    let next = this.dpr;
    if (rate > DPR_DROP) {
      w.good = 0;
      if (this.dpr > this.dprMin) {
        this.failedDpr = Math.min(this.failedDpr, this.dpr);
        next = Math.max(this.dprMin, this.dpr - DPR_STEP);
      }
    } else if (rate < DPR_KEEP) {
      w.good += 1;
      const up = Math.min(this.dprMax, this.dpr + DPR_STEP);
      if (w.good >= 2 && up > this.dpr && up < this.failedDpr) {
        next = up;
        w.good = 0;
      }
    } else {
      w.good = 0;
    }
    if (next === this.dpr) {
      return null;
    }
    this.dpr = next;
    w.settle = DPR_SETTLE;
    return next;
  }
}

// ─── Image size ────────────────────────────────────────────────────────────
// The sizes the room is exported at. Every size runs the same network, so
// its cost scales with the pixel count; a GPU timed at one size predicts
// the others.

export const TIERS = [384, 512, 768];
// A resting light is refined as far as fits in this many frames' budget
export const REFINE_FRAMES = 40;
// A size up is fetched if a resting light would reach every pixel within
// this many frames' budget, and the hero draws the room larger than now
const UPGRADE_FRAMES = 12;

// The first size: what the last visit settled on, else the small one on
// phones and slow connections and the middle one elsewhere. The largest is
// only ever reached by timing the GPU.
export function firstTier(profile, compact) {
  if (TIERS.includes(profile?.tier)) {
    return profile.tier;
  }
  return compact || slowConnection() ? TIERS[0] : TIERS[1];
}

// The size to fetch next, or null to stay. `shownPx`: the hero's framed
// room in canvas pixels.
export function upgradeTier(engine, budget, shownPx) {
  const next = TIERS[TIERS.indexOf(engine.W) + 1];
  const cost = engine.evalCost(1);
  if (!next || cost === null || engine.timing.seeded || slowConnection()) {
    return null;
  }
  // the largest needs ~100 MB while it's prepared
  if (next > TIERS[1] && navigator.deviceMemory && navigator.deviceMemory < 4) {
    return null;
  }
  if (shownPx <= engine.W) {
    return null;
  }
  return cost * (next / engine.W) ** 2 <= budget * UPGRADE_FRAMES ? next : null;
}

// The size the next visit loads: this one, or the one below if a resting
// light couldn't be refined to every pixel here
function nextVisitTier(engine, budget) {
  const i = TIERS.indexOf(engine.W);
  const cost = engine.evalCost(1);
  return i > 0 && cost !== null && cost > budget * REFINE_FRAMES ? TIERS[i - 1] : engine.W;
}

function slowConnection() {
  const c = navigator.connection;
  return !!c && (c.saveData || /(^|-)[23]g$/.test(c.effectiveType || ''));
}

// ─── Kept between visits ───────────────────────────────────────────────────
// One profile per browser, for its GPU: the network's measured costs (and
// the size they were measured at), the budget, the pixel ratio (and the
// lowest one that failed), and the size to load. A returning visitor starts
// where the last visit settled instead of at a guess. Storage can be missing or throw
// (private windows, blocked site data); the page just starts from defaults.

const STORAGE_KEY = 'relight-quality';
const MAX_AGE = 30 * 24 * 3600 * 1000;

// Chrome and Safari report every GPU as "WebKit WebGL" unless asked for the
// unmasked name; Firefox reports a real (sanitised) one and warns if asked
export function gpuName(gl) {
  const plain = String(gl.getParameter(gl.RENDERER));
  if (!/^webkit/i.test(plain)) {
    return plain;
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : plain;
}

// Measured costs carry over to the same network at any image size
function networkKey(engine) {
  const net = engine.scene.network;
  return `${net.width}x${net.hidden}`;
}

// Starts `engine` from costs measured on an earlier visit, or at another
// size this visit ({res, network, byStride})
export function seedCosts(engine, measured) {
  if (!measured?.byStride || measured.network !== networkKey(engine) || !(measured.res > 0)) {
    return;
  }
  const scale = (engine.W / measured.res) ** 2;
  const byStride = {};
  Object.entries(measured.byStride).forEach(([s, ms]) => {
    byStride[s] = ms * scale;
  });
  engine.seedTiming(byStride);
}

// What `engine` has measured, in the form seedCosts takes
export function measuredCosts(engine) {
  return { res: engine.W, network: networkKey(engine), byStride: { ...engine.timing.byStride } };
}

// The profile to keep, once the network's costs are known: measured (the
// engine drops the first measurements, which include compiling its shaders)
// or carried over from a size measured before. A resting light on a touch
// screen may never be timed again after a swap, and its size must be kept.
export function profileFor(gpu, engine, quality) {
  if (!engine || !Object.keys(engine.timing.byStride).length) {
    return null;
  }
  return {
    gpu,
    ...measuredCosts(engine),
    budget: quality.budget,
    dpr: quality.dpr,
    // Infinity (nothing failed) is stored as null
    failedDpr: Number.isFinite(quality.failedDpr) ? quality.failedDpr : null,
    tier: nextVisitTier(engine, quality.budget),
  };
}

export function loadProfile(gpu) {
  try {
    const profile = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    return profile?.gpu === gpu && Date.now() - profile.at < MAX_AGE ? profile : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, at: Date.now() }));
  } catch {
    // nothing to keep it in
  }
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}
