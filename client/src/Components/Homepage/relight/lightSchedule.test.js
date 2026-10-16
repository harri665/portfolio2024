import { FILL, REST_DELAY } from './lightWork';
import { TRUST_DISTANCE } from './lightMotion';
import { MOVE_EPS, atRest, converged, forgetImage, makeLight, needsWork, stepLight } from './lightSchedule';
import { areaOf, covers, grow, sameRect, visibleRect } from './rect';
import { adoptSpare, aimSpares, createSpares, releaseSpare, retargetSpare, takeSpare } from './spares';

function fakeEngine() {
  return {
    W: 32, H: 32, images: 5,
    rows: (stride = 1) => Math.ceil(32 / stride),
    cols: (stride = 1) => Math.ceil(32 / stride),
    evalCost: (stride) => 32 / stride ** 2,
    evaluate: jest.fn(),
    resolve: jest.fn((slot, image, stride, phase, [r0, r1, c0, c1]) => [c0 * stride, c1 * stride, r0 * stride, r1 * stride]),
  };
}

const KEY_DEF = { radius: 0.1, color: [1, 1, 1] };
const VIEW = [0.1, 0.9, 0.1, 0.9];

test('rect helpers clamp to the image and compare coverage', () => {
  expect(grow([0.02, 0.5, 0.5, 0.99], 0.03)).toEqual([0, 0.53, 0.47, 1]);
  expect(covers([0, 1, 0, 1], VIEW)).toBe(true);
  expect(covers(null, VIEW)).toBe(false);
  expect(covers([0.2, 1, 0, 1], VIEW)).toBe(false);
  expect(sameRect([0, 1, 0, 1], [0, 1, 0, 1])).toBe(true);
  expect(sameRect(null, [0, 1, 0, 1])).toBe(false);
  expect(areaOf([0.25, 0.75, 0, 0.5])).toBeCloseTo(0.25);
  expect(visibleRect({ left: -100, top: 0, size: 400 }, 200, 800)).toEqual([0.25, 0.75, 0, 1]);
});

test('a moved light starts a fresh cycle and settles at rest into full-detail rows', () => {
  const engine = fakeEngine();
  const light = makeLight([0, 0, 0], KEY_DEF, 0);
  expect(needsWork(light, false, VIEW)).toBe(true);
  stepLight(engine, light, 0, 4, VIEW);
  expect(light.evalPos).toEqual([0, 0, 0]);
  expect(light.still).toBe(0);
  expect(light.lastMove).toBeNull();
  expect(light.lastAlpha).toBe(1);
  expect(light.refining).toBe(false);
  expect(engine.resolve.mock.calls[0][5]).toBe(1);

  let now = REST_DELAY;
  while (!converged(light)) {
    stepLight(engine, light, now, 4, VIEW);
    now += 1 / 24;
  }
  expect(light.refining).toBe(true);
  expect(light.stride).toBe(1);
  expect(atRest(light)).toBe(true);
  expect(needsWork(light, false, VIEW)).toBe(false);

  light.pos = [MOVE_EPS * 2, 0, 0];
  expect(atRest(light)).toBe(false);
  stepLight(engine, light, now, 4, VIEW);
  expect(light.refining).toBe(false);
  expect(light.lastMove).toBeCloseTo(MOVE_EPS * 2);
  expect(light.lastAlpha).toBeLessThan(1);
});

test('a fixed light only needs work until it converges, wherever the view is', () => {
  const fill = makeLight(FILL.pos, FILL, 1);
  expect(needsWork(fill, true, VIEW)).toBe(true);
  Object.assign(fill, { evalPos: [...fill.pos], stride: 1, done: 1, rect: [0.4, 0.6, 0.4, 0.6] });
  expect(needsWork(fill, false, VIEW)).toBe(false);
});

test('forgetting an image keeps position and slot', () => {
  const light = { ...makeLight([1, 2, 3], KEY_DEF, 0), evalPos: [1, 2, 3], stride: 4, done: 3, refining: true, lastMove: 0.1 };
  forgetImage(light, 3);
  expect(light).toMatchObject({ pos: [1, 2, 3], slot: 0, image: 3, evalPos: null, stride: 0, done: 0, refining: false, lastMove: null, lastAlpha: null });
});

test('taking a spare swaps images and frees the spare into slot 1', () => {
  const engine = fakeEngine();
  const [spare] = createSpares(engine, 1);
  Object.assign(spare, { pos: [0.5, 0, 0], rect: [0, 1, 0, 1], kept: [0, 32, 0, 32], next: 34, ready: true, rank: 0, slot: 0 });
  const light = makeLight([0.5, 0, 0], KEY_DEF, 0);
  takeSpare(light, spare);
  expect(light).toMatchObject({ image: 2, evalPos: [0.5, 0, 0], rect: [0, 1, 0, 1], kept: [0, 32, 0, 32], stride: 1, done: 1, next: 34, refining: false });
  expect(spare).toMatchObject({ image: 0, pos: null, evalPos: null, rect: null, kept: null, stride: 0, phase: 0, done: 0, next: 0, slot: 1, ready: false, rank: Infinity });
});

test('releasing a stale jump keeps its evaluated rect; retargeting clears it', () => {
  const spare = { pos: [1, 0, 0], evalPos: [1, 0, 0], rect: [0, 1, 0, 1], kept: [0, 1, 0, 1], next: 3, ready: true, rank: 0, slot: 0 };
  releaseSpare(spare, 1);
  expect(spare).toMatchObject({ pos: null, evalPos: null, rect: [0, 1, 0, 1], next: 3, slot: 1, ready: false, rank: Infinity });
  retargetSpare(spare, [0, 1, 0], 0, 7);
  expect(spare).toMatchObject({ pos: [0, 1, 0], rect: null, kept: null, next: 0, still: 7, refining: false, slot: 0 });
});

test('a moving light adopts the nearest ready spare where it is going, a resting one does not', () => {
  const spares = [
    { image: 2, pos: [0.02, 0, 0], rect: [0, 1, 0, 1], ready: true },
    { image: 3, pos: [0.01, 0, 0], rect: [0, 1, 0, 1], ready: true },
    { image: 4, pos: [0.005, 0, 0], rect: [0.3, 1, 0, 1], ready: true },
  ];
  const resting = { ...makeLight([0, 0, 0], KEY_DEF, 0), evalPos: [0, 0, 0] };
  expect(adoptSpare(resting, spares, [0.01, 0, 0], VIEW)).toBe(false);
  const moving = { ...makeLight([0, 0, 0], KEY_DEF, 0), evalPos: [-0.5, 0, 0] };
  expect(adoptSpare(moving, spares, [0.01, 0, 0], VIEW)).toBe(true);
  expect(moving.image).toBe(3);
  const far = { ...makeLight([0, 0, 0], KEY_DEF, 0), evalPos: [-0.5, 0, 0] };
  expect(adoptSpare(far, spares, [TRUST_DISTANCE * 2, 0, 0], VIEW)).toBe(false);
});

test('aiming spares keeps one already at a target and ranks the rest likeliest first', () => {
  const spares = [
    { pos: [1, 0, 0], ready: true, rank: Infinity, rect: [0, 1, 0, 1], kept: [0, 1, 0, 1], next: 9 },
    { pos: null, ready: false, rank: Infinity, rect: null, kept: null, next: 0 },
  ];
  const kept = spares[0];
  aimSpares(spares, [[0, 1, 0], [1, 0, 0]], [0.2, 0.8, 0.2, 0.8]);
  expect(spares[0]).toMatchObject({ pos: [0, 1, 0], rank: 0, rect: [0.2, 0.8, 0.2, 0.8], next: 0, ready: false });
  expect(spares[1]).toBe(kept);
  expect(kept).toMatchObject({ rank: 1, ready: true, next: 9 });
});
