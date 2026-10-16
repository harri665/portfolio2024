const profile = { gpu: 'test-gpu', fps: 30, budget: 7, tier: 512 };

beforeEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

test('clearing settings survives the old renderer saving again during reload', () => {
  const { clearProfile, loadProfile, saveProfile } = require('./adaptiveQuality');
  window.localStorage.setItem('unrelated-preference', 'keep');
  saveProfile(profile);
  expect(loadProfile(profile.gpu, profile.fps)).toMatchObject(profile);

  expect(clearProfile()).toBe(true);
  // The renderer saves periodically, on pagehide, and during effect cleanup.
  saveProfile(profile);
  window.dispatchEvent(new Event('pagehide'));
  saveProfile(profile);

  expect(window.localStorage.getItem('relight-quality')).toBeNull();
  expect(loadProfile(profile.gpu, profile.fps)).toBeNull();
  expect(window.localStorage.getItem('unrelated-preference')).toBe('keep');

  // A fresh page may learn and save a new profile normally.
  jest.resetModules();
  const fresh = require('./adaptiveQuality');
  fresh.saveProfile({ ...profile, budget: 9 });
  expect(fresh.loadProfile(profile.gpu, profile.fps).budget).toBe(9);
});

test('a failed removal reports failure without disabling normal profile saving', () => {
  const { clearProfile, loadProfile, saveProfile } = require('./adaptiveQuality');
  saveProfile(profile);
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('Storage is blocked', 'SecurityError');
  });

  expect(clearProfile()).toBe(false);
  expect(loadProfile(profile.gpu, profile.fps)).toMatchObject(profile);
  saveProfile({ ...profile, budget: 8 });
  expect(loadProfile(profile.gpu, profile.fps).budget).toBe(8);
});

function quality(options = {}) {
  const { AdaptiveQuality } = require('./adaptiveQuality');
  return new AdaptiveQuality({ budget: 7, dpr: 1, dprRange: [1, 2], ...options });
}

function engine(size, cost, overrides = {}) {
  return {
    W: size,
    backend: 'webgpu',
    scene: { network: { width: 128, hidden: 4 } },
    timing: { byStride: { 1: cost }, seeded: false },
    evalCost: () => cost,
    ...overrides,
  };
}

test('the 24 Hz budget reserves 30 percent for the rest of the page', () => {
  const { MIN_FPS } = require('./adaptiveQuality');
  const q = quality();
  expect(MIN_FPS).toBe(24);
  expect(q.budgetMax).toBeCloseTo((1000 / 24) * 0.7);
  expect(quality({ budget: 100 }).budget).toBe(q.budgetMax);
});

test('normal alternating 33/50 ms delivery never counts as a missed update', () => {
  const q = quality();
  for (let i = 0; i < 240; i += 1) {
    q.worked();
    q.frame(i % 2 ? 0.05 : 1 / 30, true, false, { missedSlots: 0 });
  }
  expect(q.stats.late).toBe(0);
  expect(q.stats.frames / q.stats.seconds).toBeCloseTo(24);
  expect(q.budget).toBeCloseTo(q.budgetMax);
  // Callers without metadata still tolerate the ordinary refresh quantization.
  const fallback = quality();
  fallback.worked();
  fallback.frame(0.05, true);
  expect(fallback.stats.late).toBe(0);
});

test('actual missed slots reduce work budget; suspended and warm-up samples do not', () => {
  const q = quality();
  q.worked();
  q.frame(0.08, true, false, { missedSlots: 1 });
  expect(q.stats.late).toBe(1);
  expect(q.budget).toBeCloseTo(7 * 0.75);
  const budget = q.budget;
  q.frame(0.08, true, true, { missedSlots: 1 });
  q.frame(0.08, true, false, { missedSlots: 1, resumed: true });
  q.frame(1, true, false, { missedSlots: 20 });
  expect(q.budget).toBe(budget);
  expect(q.stats.frames).toBe(1);
});

test('sub-slot overload is late when delivery exceeds one refresh of quantization', () => {
  const q = quality();
  q.worked();
  q.frame(0.05, true, false, { missedSlots: 0, latenessMs: 8.34, refreshMs: 1000 / 60 });
  expect(q.stats.late).toBe(0);
  const before = q.budget;
  q.worked();
  q.frame(0.075, true, false, { missedSlots: 0, latenessMs: 35, refreshMs: 1000 / 60 });
  expect(q.stats.late).toBe(1);
  expect(q.budget).toBeLessThan(before);
});

test('idle DPR adapts over elapsed time, independently of callback count', () => {
  for (const delta of [1 / 24, 1 / 60]) {
    const q = quality({ dpr: 1.5 });
    let elapsed = 0;
    while (elapsed + delta < 3) {
      expect(q.frame(delta, true, false, { missedSlots: 1 })).toBeNull();
      elapsed += delta;
    }
    expect(q.dpr).toBe(1.5);
    // Floating-point accumulation can leave the boundary one callback short.
    q.frame(delta, true, false, { missedSlots: 1 });
    q.frame(delta, true, false, { missedSlots: 1 });
    expect(q.dpr).toBe(1.25);
  }
});

test('tier decisions require sustained headroom, projected demand, and a cooldown', () => {
  const q = quality();
  const e = engine(384, 2);
  expect(q.nextTier(e, 300, 0)).toBeNull();
  expect(q.nextTier(e, 900, 1000)).toBeNull();
  expect(q.nextTier(e, 900, 6999)).toBeNull();
  expect(q.nextTier(e, 900, 7000)).toBe(512);
  const larger = engine(512, 3);
  expect(q.nextTier(larger, 900, 10000)).toBeNull();
  expect(q.nextTier(larger, 900, 22000)).toBeNull();
  expect(q.nextTier(larger, 900, 28000)).toBe(768);
});

test('an expensive tier downgrades live and seeded guesses cannot switch tiers', () => {
  const q = quality();
  const e = engine(768, 400);
  expect(q.nextTier(e, 900, 0)).toBeNull();
  expect(q.nextTier(e, 900, 2999)).toBeNull();
  expect(q.nextTier(e, 900, 3000)).toBe(512);
  expect(q.nextTier(engine(512, 400), 900, 4000)).toBeNull();
  const seeded = engine(384, 1, { timing: { seeded: true, byStride: { 1: 1 } } });
  expect(quality().nextTier(seeded, 900, 100000)).toBeNull();
});

test('sustained missed slots can lower an otherwise affordable tier; interruptions reset the dwell', () => {
  const q = quality();
  const e = engine(768, 1);
  q.lateRate.work = 0.3;
  expect(q.nextTier(e, 900, 0)).toBeNull();
  q.frame(1 / 24, true, true);
  expect(q.nextTier(e, 900, 3000)).toBeNull();
  expect(q.nextTier(e, 900, 6000)).toBe(512);
});

test('old engine, cadence, backend, viewport, and expired profiles are rejected', () => {
  const { loadProfile, saveProfile, PROFILE_VERSION } = require('./adaptiveQuality');
  saveProfile({ ...profile, fps: 24, backend: 'webgpu' });
  const valid = JSON.parse(window.localStorage.getItem('relight-quality'));
  expect(loadProfile(profile.gpu, 24, 'webgpu').version).toBe(PROFILE_VERSION);
  expect(loadProfile(profile.gpu, 30)).toBeNull();
  expect(loadProfile(profile.gpu, 24, 'webgl')).toBeNull();
  for (const change of [
    { version: 1 },
    { engineVersion: 'previous-engine' },
    { viewport: { ...valid.viewport, dpr: 10 } },
    { at: Date.now() - 31 * 24 * 3600 * 1000 },
  ]) {
    window.localStorage.setItem('relight-quality', JSON.stringify({ ...valid, ...change }));
    expect(loadProfile(profile.gpu, 24)).toBeNull();
  }
});

test('saved low budgets and DPR failures are reconsidered and provisional costs are not saved', () => {
  const { firstBudget, profileFor, seedCosts } = require('./adaptiveQuality');
  expect(firstBudget({ budget: 1 }, true)).toBe(7);
  const e = engine(512, 10);
  const q = quality({ failedDpr: 1.5 });
  expect(profileFor('gpu', 24, e, q)).toMatchObject({ failedDpr: null, tier: 512 });
  e.seedTiming = jest.fn();
  const measured = { network: '128x4', backend: 'webgpu', res: 768, byStride: { 1: 10 } };
  seedCosts(e, { ...measured, backend: 'webgl' });
  expect(e.seedTiming).not.toHaveBeenCalled();
  seedCosts(e, measured);
  expect(e.seedTiming).toHaveBeenCalledWith({ 1: 11.5 });
  e.timing.seeded = true;
  expect(profileFor('gpu', 24, e, q)).toBeNull();
});

test('saved kernels are specific to their model and backend', () => {
  const { tunedKernel } = require('./adaptiveQuality');
  const saved = { network: '128x4', backend: 'webgpu', kernel: '64x1' };
  expect(tunedKernel(saved, '128x4', 'webgpu')).toBe('64x1');
  expect(tunedKernel(saved, '64x4', 'webgpu')).toBeNull();
  expect(tunedKernel(saved, '128x4', 'webgl')).toBeNull();
});

test('model selection budgets every resting pixel within the refinement goal', () => {
  const { switchNetwork, REFINE_MS, MIN_FPS } = require('./adaptiveQuality');
  const budget = 7;
  const fullLimit = budget * REFINE_MS * MIN_FPS / 1000;
  expect(switchNetwork(engine(384, fullLimit), budget)).toBeNull();
  expect(switchNetwork(engine(384, fullLimit + 1), budget)).toBe('64x4');
  const small = (cost) => engine(384, cost, {
    scene: { network: { width: 64, hidden: 4 } },
  });
  // Reclaim model fidelity only with twice the required headroom.
  expect(switchNetwork(small(fullLimit * 0.49 / 3.3), budget)).toBe('128x4');
  expect(switchNetwork(small(fullLimit * 0.51 / 3.3), budget)).toBeNull();
});
