import { createFill, evaluateRows, fillMatches, fillStep, refinementProgress, WHOLE } from './lightWork';
import { benchStride, prepareFill } from './prepare';
import { advanceCopyClock } from './copyClock';

function fakeEngine() {
  return {
    W: 32, H: 32,
    rows: (stride = 1) => Math.ceil(32 / stride),
    cols: (stride = 1) => Math.ceil(32 / stride),
    evalCost: (stride) => 32 / stride ** 2,
    evaluate: jest.fn(),
    resolve: jest.fn((slot, image, stride, phase, [r0, r1, c0, c1]) => [c0 * stride, c1 * stride, r0 * stride, r1 * stride]),
    beginFrame: jest.fn(), endFrame: jest.fn(), pollTiming: jest.fn(),
  };
}

test('provisional timing is remeasured at rest even when refinement bands were too small to time', () => {
  const engine = { ...fakeEngine(), timing: { byStride: { 2: 8 }, seeded: true } };
  expect(benchStride(engine)).toBe(2);
  engine.timing.seeded = false;
  expect(benchStride(engine)).toBeNull();
  engine.evalCost = (stride) => 8 / stride ** 2;
  expect(benchStride(engine)).toBe(1);
});

test('fixed fill progressively covers every source pixel and never evaluates again when complete', () => {
  const engine = fakeEngine();
  const fill = createFill(engine);
  fillStep(engine, fill, 4, true);
  expect(fill.evalPos).toEqual(fill.pos);
  expect(fill.next).toBe(0);
  for (let i = 0; i < 8; i += 1) fillStep(engine, fill, 4, true);
  expect(fill.next).toBe(engine.H);
  expect(fill.done).toBe(1);
  expect(refinementProgress(fill, engine)).toBe(1);
  const calls = engine.evaluate.mock.calls.length;
  fillStep(engine, fill, 4, true);
  expect(engine.evaluate).toHaveBeenCalledTimes(calls);
  const bands = engine.evaluate.mock.calls.slice(1);
  expect(bands.map((args) => args.slice(3, 5))).toEqual([[0, 4], [4, 8], [8, 12], [12, 16], [16, 20], [20, 24], [24, 28], [28, 32]]);
});

test('full-detail refinement makes monotonic progress under changing budgets in the visible region', () => {
  const engine = fakeEngine();
  const job = { ...createFill(engine), next: 0 };
  const rect = [0.25, 0.75, 0.25, 0.75];
  const positions = [];
  for (const budget of [1, 3, 0.5, 8, 8]) {
    const spent = evaluateRows(engine, job, rect, budget, 1);
    expect(spent).toBeLessThanOrEqual(Math.max(budget, 1));
    positions.push(job.next);
  }
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(job.next).toBe(26);
  for (const args of engine.evaluate.mock.calls) expect(args[2]).toBe(1);
});

test('prepared fill belongs exclusively to its original engine and fixed-light definition', () => {
  const engine = fakeEngine();
  const fill = createFill(engine);
  expect(fillMatches(fill, engine)).toBe(true);
  expect(fillMatches(fill, fakeEngine())).toBe(false);
  expect(fillMatches({ ...fill, radius: 0.2 }, engine)).toBe(false);
});

test('claim during a preparation yield transfers partial rows without further writes', async () => {
  const engine = fakeEngine();
  const controller = new AbortController();
  let take;
  let claimed = false;
  const claim = new Promise((resolve) => { take = resolve; });
  const built = { engine };
  const result = prepareFill(built, { signal: controller.signal, budget: 4, claimed: () => claimed, claim });
  expect(engine.evaluate).toHaveBeenCalledTimes(1);
  claimed = true;
  take();
  const fill = await result;
  expect(fillMatches(fill, engine)).toBe(true);
  expect(fill.rect).toEqual(WHOLE);
  expect(fill.done).toBe(0);
  expect(engine.evaluate).toHaveBeenCalledTimes(1);
  fillStep(engine, fill, 4, true);
  expect(fill.next).toBe(4);
});

test('aborting preparation wakes a pending yield and closes its submitted batch', async () => {
  const engine = fakeEngine();
  const controller = new AbortController();
  const result = prepareFill({ engine }, { signal: controller.signal, budget: 4 });
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(engine.beginFrame).toHaveBeenCalledTimes(1);
  expect(engine.endFrame).toHaveBeenCalledTimes(1);
});

test('glass retains 20 copies per second on a 24 FPS scene clock and drops stalled slots', () => {
  let last = -Infinity;
  let copies = 0;
  for (let i = 0; i < 240; i += 1) {
    const now = i / 24;
    if (now - last + 1e-9 >= 0.05) {
      last = advanceCopyClock(now, last, 0.05);
      copies += 1;
    }
  }
  expect(copies).toBe(200);
  last = advanceCopyClock(25.025, last, 0.05);
  expect(last).toBeCloseTo(25);
  expect(25.025 - last).toBeLessThan(0.05);
});
