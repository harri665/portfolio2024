// tunes the relight backdrop to the device: network budget, canvas dpr and image size,
// pushing quality up as long as the page holds 30fps. saved per gpu for next visit

export const MIN_FPS = 30;
// ms. slack is for frames vsync rounds just past 33ms (5 refreshes at 144Hz, 9 at 240Hz)
const LATE_SLACK = 5;
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

// never go back up to a dpr that failed, it just stutters again
const DPR_WINDOW = 90;
const DPR_STEP = 0.25;
const DPR_DROP = 0.2;
const DPR_KEEP = 0.02;
const DPR_SETTLE = 12;

export class AdaptiveQuality {
  constructor({ budget, dpr, dprRange, failedDpr = Infinity, minFps = MIN_FPS }) {
    this.lateMs = 1000 / minFps + LATE_SLACK;
    this.budgetMax = (1000 / minFps) * BUDGET_SHARE;
    this.frameNo = 0;
    this.lastWork = -Infinity;
    this.budget = budget;
    this.ceiling = Infinity;
    [this.dprMin, this.dprMax] = dprRange;
    this.dpr = clamp(dpr, this.dprMin, this.dprMax);
    this.failedDpr = failedDpr;
    this.lateRate = { work: 0, idle: 0 };
    this.window = { frames: 0, late: 0, good: 0, settle: 0 };
    this.stats = { frames: 0, seconds: 0, late: 0 };
  }

  // keep `settled` off while loading. shader compiles made frames late and on first visits
  // the intro light dropped the budget to the floor
  frame(delta, settled, hold = false) {
    this.frameNo += 1;
    if (!(delta > 0) || delta > GAP || hold) {
      return null;
    }
    const recent = this.frameNo - this.lastWork <= WORK_FRAMES;
    const late = delta * 1000 > this.lateMs;
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

    return !recent && settled ? this.judgeDpr(late) : null;
  }

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

export const TIERS = [384, 512, 768];
// ms. phones used to start lower back when they ran at 60
const START_BUDGET = { compact: 7, full: 7 };
export const REFINE_FRAMES = 40;
const UPGRADE_FRAMES = 12;

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
    return budget;
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
  return cost * (next / engine.W) ** 2 <= budget * UPGRADE_FRAMES ? next : null;
}

function nextVisitTier(engine, budget) {
  const i = TIERS.indexOf(engine.W);
  const cost = engine.evalCost(1);
  return i > 0 && cost !== null && cost > budget * REFINE_FRAMES ? TIERS[i - 1] : engine.W;
}

// small network is ~3.3x faster but ~2dB worse vs path traced refs (perf/relight-bench.mjs).
// big one wins down to every 4th pixel, so small is for gpus that can't refine past that

export const NETWORKS = ['128x4', '64x4'];
const SMALL_SPEEDUP = 3.3;

export function firstNetwork(profile) {
  return NETWORKS.includes(profile?.network) ? profile.network : NETWORKS[0];
}

export function tunedKernel(profile, network) {
  return profile?.network === network ? profile.kernel ?? null : null;
}

// hysteresis so a gpu near the line doesn't flip back and forth
export function switchNetwork(engine, budget) {
  const cost = engine.evalCost(1);
  const i = NETWORKS.indexOf(networkKey(engine));
  if (cost === null || engine.timing.seeded || i < 0) {
    return null;
  }
  const refines = (full, room) => full / 16 <= budget * REFINE_FRAMES * room;
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
const MAX_AGE = 30 * 24 * 3600 * 1000;

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
    (measured.backend ?? 'webgl') !== engine.backend ||
    !(measured.res > 0)
  ) {
    return;
  }
  const scale = (engine.W / measured.res) ** 2;
  const byStride = {};
  Object.entries(measured.byStride).forEach(([s, ms]) => {
    byStride[s] = ms * scale;
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
  if (!engine || !Object.keys(engine.timing.byStride).length) {
    return null;
  }
  return {
    gpu,
    fps,
    ...measuredCosts(engine),
    budget: quality.budget,
    dpr: quality.dpr,
    failedDpr: Number.isFinite(quality.failedDpr) ? quality.failedDpr : null,
    tier: nextVisitTier(engine, quality.budget),
    kernel: engine.tuned ? engine.kernelName : null,
  };
}

export function loadProfile(gpu, fps) {
  try {
    const profile = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const fits = profile?.gpu === gpu && (profile.fps ?? MIN_FPS) === fps;
    return fits && Date.now() - profile.at < MAX_AGE ? profile : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, at: Date.now() }));
  } catch {
    // nowhere to keep it
  }
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}
