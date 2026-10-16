// tunes the relight backdrop to the device: network budget, canvas dpr and image size,
// spending spare time on detail while the page delivers 24 lighting updates per second.

export const MIN_FPS = 24;
// Without scheduler metadata allow one 60 Hz refresh of delivery quantization.
// In particular, alternating 33/50 ms delivery is the expected 24 Hz cadence.
const DELIVERY_SLACK = 1000 / 60 + 2;
// s, anything longer is a hidden tab or a stall
const GAP = 0.25;
const WORK_FRAMES = 2;
const RATE_ALPHA = 0.05;
const BLAME = 0.03;

// budget backs off on a late frame and caps at 90% of where it failed, then creeps back up,
// so it settles just under what the gpu can take instead of missing a frame every second
const BUDGET_MIN = 1;
const BUDGET_SHARE = 0.7;
const GROW = 1.02;
const BACK_OFF = 0.75;
const CREEP = 1.0005;

// Avoid retrying a failed DPR during this visit. A future visit measures it again.
const DPR_WINDOW_MS = 3000;
const DPR_STEP = 0.25;
const DPR_DROP = 0.2;
const DPR_KEEP = 0.02;
const DPR_SETTLE_MS = 500;

export class AdaptiveQuality {
  constructor({ budget, dpr, dprRange, failedDpr = Infinity, minFps = MIN_FPS }) {
    this.lateMs = 1000 / minFps + DELIVERY_SLACK;
    this.budgetMax = (1000 / minFps) * BUDGET_SHARE;
    this.frameNo = 0;
    this.lastWork = -Infinity;
    this.budget = clamp(budget, BUDGET_MIN, this.budgetMax);
    this.ceiling = Infinity;
    [this.dprMin, this.dprMax] = dprRange;
    this.dpr = clamp(dpr, this.dprMin, this.dprMax);
    this.failedDpr = failedDpr;
    this.lateRate = { work: 0, idle: 0 };
    this.window = { ms: 0, lateMs: 0, good: 0, settle: 0 };
    this.stats = { frames: 0, seconds: 0, late: 0 };
    this.tierCheck = { key: null, upSince: null, downSince: null, changedAt: -Infinity };
  }

  // keep `settled` off while loading. shader compiles made frames late and on first visits
  // the intro light dropped the budget to the floor
  frame(delta, settled, hold = false, schedule = null) {
    this.frameNo += 1;
    if (!(delta > 0) || delta > GAP || hold || schedule?.resumed) {
      this.tierCheck.upSince = null;
      this.tierCheck.downSince = null;
      return null;
    }
    const recent = this.frameNo - this.lastWork <= WORK_FRAMES;
    const hasSchedule = Number.isFinite(schedule?.missedSlots);
    const late = hasSchedule
      ? schedule.missedSlots > 0 || (
        Number.isFinite(schedule.latenessMs) && Number.isFinite(schedule.refreshMs) &&
        schedule.latenessMs > schedule.refreshMs + 2
      )
      : delta * 1000 > this.lateMs;
    this.stats.frames += 1;
    this.stats.seconds += delta;
    this.stats.late += late ? 1 : 0;
    const rates = this.lateRate;
    const kind = recent ? 'work' : 'idle';
    if (settled) {
      rates[kind] += RATE_ALPHA * ((late ? 1 : 0) - rates[kind]);
    }

    if (recent && late && settled && rates.work > rates.idle + BLAME) {
      this.ceiling = this.budget * 0.9;
      this.budget *= BACK_OFF;
    } else if (recent && !late) {
      this.ceiling *= CREEP;
      this.budget = Math.min(this.ceiling, this.budget * GROW);
    }
    this.budget = clamp(this.budget, BUDGET_MIN, this.budgetMax);

    return !recent && settled ? this.judgeDpr(late, delta * 1000) : null;
  }

  worked() {
    this.lastWork = this.frameNo;
  }

  // Called with real elapsed milliseconds, usually once a second. A slow tier must
  // stay expensive for three seconds; an upgrade needs six seconds of headroom.
  // Rebuilding a tier is expensive, so never bounce between adjacent sizes.
  nextTier(engine, shownPx, nowMs) {
    if (!Number.isFinite(nowMs) || engine.timing.seeded) {
      return null;
    }
    const w = this.tierCheck;
    const key = `${engine.W}:${networkKey(engine)}:${engine.backend}`;
    if (w.key !== key) {
      w.key = key;
      w.upSince = null;
      w.downSince = null;
    }
    if (nowMs - w.changedAt < TIER_COOLDOWN_MS) {
      return null;
    }
    const cost = engine.evalCost(1);
    if (cost === null) {
      return null;
    }
    const i = TIERS.indexOf(engine.W);
    const tooSlow = i > 0 && cost > this.budget * REFINE_UPDATES * 1.25;
    const pressured = i > 0 && this.lateRate.work > 0.2 && this.lateRate.work > this.lateRate.idle + BLAME;
    w.downSince = tooSlow || pressured ? w.downSince ?? nowMs : null;
    const up = upgradeTier(engine, this.budget, shownPx);
    w.upSince = up && !tooSlow && !pressured ? w.upSince ?? nowMs : null;
    const next = w.downSince !== null && nowMs - w.downSince >= TIER_DOWN_MS
      ? TIERS[i - 1]
      : w.upSince !== null && nowMs - w.upSince >= TIER_UP_MS ? up : null;
    if (next) {
      w.changedAt = nowMs;
      w.upSince = null;
      w.downSince = null;
    }
    return next;
  }

  judgeDpr(late, elapsedMs) {
    const w = this.window;
    if (w.settle > 0) {
      w.settle -= elapsedMs;
      return null;
    }
    w.ms += elapsedMs;
    w.lateMs += late ? elapsedMs : 0;
    if (w.ms < DPR_WINDOW_MS) {
      return null;
    }
    const rate = w.lateMs / w.ms;
    w.ms = 0;
    w.lateMs = 0;

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
    w.settle = DPR_SETTLE_MS;
    return next;
  }
}

export const TIERS = [384, 512, 768];
// ms. phones used to start lower back when they ran at 60
const START_BUDGET = { compact: 7, full: 7 };
export const REFINE_MS = 1500;
const REFINE_UPDATES = (REFINE_MS * MIN_FPS) / 1000;
// Compatibility for callers that spread full-resolution work over updates.
export const REFINE_FRAMES = REFINE_UPDATES;
const UPGRADE_MS = 500;
const TIER_DOWN_MS = 3000;
const TIER_UP_MS = 6000;
const TIER_COOLDOWN_MS = 15000;

// largest size is only ever reached by timing the gpu
export function firstTier(profile, compact) {
  if (TIERS.includes(profile?.tier)) {
    return profile.tier;
  }
  return compact || slowConnection() ? TIERS[0] : TIERS[1];
}

export function firstBudget(profile, compact) {
  const budget = profile?.budget;
  if (Number.isFinite(budget) && budget > 0) {
    // Saved settings are a starting hint. Reconsider a previous low budget using
    // live measurements instead of starting permanently at its old failure floor.
    return clamp(budget, START_BUDGET[compact ? 'compact' : 'full'], (1000 / MIN_FPS) * BUDGET_SHARE);
  }
  return compact ? START_BUDGET.compact : START_BUDGET.full;
}

export function upgradeTier(engine, budget, shownPx) {
  const next = TIERS[TIERS.indexOf(engine.W) + 1];
  const cost = engine.evalCost(1);
  if (!next || cost === null || engine.timing.seeded || slowConnection()) {
    return null;
  }
  // the largest needs ~100MB while it's prepared
  if (next > TIERS[1] && navigator.deviceMemory && navigator.deviceMemory < 4) {
    return null;
  }
  if (shownPx <= engine.W) {
    return null;
  }
  return cost * (next / engine.W) ** 2 <= budget * (UPGRADE_MS * MIN_FPS / 1000) ? next : null;
}

// The small network is ~3.3x faster but ~2dB worse against path-traced references
// (perf/relight-bench.mjs). Keep the larger model when its full image can settle
// within the refinement goal; a sparse preview must not hide a slow resting image.

export const NETWORKS = ['128x4', '64x4'];
const SMALL_SPEEDUP = 3.3;

export function firstNetwork(profile) {
  return NETWORKS.includes(profile?.network) ? profile.network : NETWORKS[0];
}

export function tunedKernel(profile, network, backend = null) {
  return profile?.network === network && (!backend || profile.backend === backend)
    ? profile.kernel ?? null : null;
}

// hysteresis so a gpu near the line doesn't flip back and forth
export function switchNetwork(engine, budget) {
  const cost = engine.evalCost(1);
  const i = NETWORKS.indexOf(networkKey(engine));
  if (cost === null || engine.timing.seeded || i < 0) {
    return null;
  }
  const refines = (full, room) => full <= budget * REFINE_UPDATES * room;
  if (i === 0 && !refines(cost, 1)) {
    return NETWORKS[1];
  }
  if (i === 1 && refines(cost * SMALL_SPEEDUP, 0.5)) {
    return NETWORKS[0];
  }
  return null;
}

function slowConnection() {
  const c = navigator.connection;
  return !!c && (c.saveData || /(^|-)[23]g$/.test(c.effectiveType || ''));
}

// localStorage can throw (private windows etc), then we just use defaults

const STORAGE_KEY = 'relight-quality';
export const PROFILE_VERSION = 2;
export const ENGINE_VERSION = 'relight-24-full-refinement-v1';
const MAX_AGE = 30 * 24 * 3600 * 1000;
// A reset reloads the page. Its pagehide/unmount saves must not restore the old profile.
let profileCleared = false;

// A rotation or substantially different display needs a new quality decision.
// Bucket CSS dimensions to avoid invalidation from mobile browser toolbar changes.
function viewportScale() {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  return {
    width: Math.round(w / 200),
    height: Math.round(h / 200),
    dpr: Math.round((window.devicePixelRatio || 1) * 2) / 2,
  };
}

// chrome/safari say "WebKit WebGL" unless you ask for the unmasked name, firefox warns if you ask
export function gpuName(gl) {
  const plain = String(gl.getParameter(gl.RENDERER));
  if (!/^webkit/i.test(plain)) {
    return plain;
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : plain;
}

function networkKey(engine) {
  const net = engine.scene.network;
  return `${net.width}x${net.hidden}`;
}

// only on the same backend, webgpu is ~5x faster
export function seedCosts(engine, measured) {
  if (
    !measured?.byStride ||
    measured.network !== networkKey(engine) ||
    measured.backend !== engine.backend ||
    !(measured.res > 0)
  ) {
    return;
  }
  const scale = (engine.W / measured.res) ** 2;
  const byStride = {};
  Object.entries(measured.byStride).forEach(([s, ms]) => {
    if (Number.isFinite(ms) && ms > 0) {
      // The saved query omits some presentation/resolve work and is only a hint.
      byStride[s] = ms * Math.max(1, scale) * 1.15;
    }
  });
  engine.seedTiming(byStride);
}

export function measuredCosts(engine) {
  return {
    res: engine.W,
    network: networkKey(engine),
    backend: engine.backend,
    byStride: { ...engine.timing.byStride },
  };
}

// first measurements include shader compiles so the engine drops them
export function profileFor(gpu, fps, engine, quality) {
  if (!engine || engine.timing.seeded || !Object.keys(engine.timing.byStride).length) {
    return null;
  }
  return {
    gpu,
    fps,
    version: PROFILE_VERSION,
    engineVersion: ENGINE_VERSION,
    viewport: viewportScale(),
    ...measuredCosts(engine),
    budget: quality.budget,
    dpr: quality.dpr,
    // A thermal or transient failure should not forbid a future visit retrying.
    failedDpr: null,
    tier: engine.W,
    kernel: engine.tuned ? engine.kernelName : null,
  };
}

export function loadProfile(gpu, fps, backend = null) {
  if (profileCleared) {
    return null;
  }
  try {
    const profile = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const fits = profile?.version === PROFILE_VERSION && profile.engineVersion === ENGINE_VERSION &&
      profile.gpu === gpu && profile.fps === fps &&
      (!backend || profile.backend === backend) &&
      JSON.stringify(profile.viewport) === JSON.stringify(viewportScale());
    const age = Date.now() - profile?.at;
    return fits && age >= 0 && age < MAX_AGE ? profile : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  if (profileCleared) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...profile,
      version: PROFILE_VERSION,
      engineVersion: ENGINE_VERSION,
      viewport: viewportScale(),
      at: Date.now(),
    }));
  } catch {
    // nowhere to keep it
  }
}

export function clearProfile() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    profileCleared = true;
    return true;
  } catch {
    return false;
  }
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}
