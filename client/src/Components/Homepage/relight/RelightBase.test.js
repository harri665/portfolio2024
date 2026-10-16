import { RelightBase } from './RelightBase';

const cost = (byStride, stride) => RelightBase.prototype.evalCost.call({ timing: { byStride } }, stride);

test('an actual stride measurement wins over cheaper scaled measurements', () => {
  expect(cost({ 1: 20, 2: 8, 4: 0.1 }, 2)).toBe(8);
  expect(cost({}, 1)).toBeNull();
});

test('two consistent measurements preserve fixed pass overhead between strides and beyond them', () => {
  // Two milliseconds per dispatch plus eight milliseconds for a full sample grid.
  expect(cost({ 1: 10, 4: 2.5 }, 2)).toBeCloseTo(4);
  expect(cost({ 1: 10, 4: 2.5 }, 8)).toBeCloseTo(2.125);
  expect(cost({ 2: 4, 4: 2.5 }, 1)).toBeCloseTo(10);
});

test('a single measurement retains fixed overhead instead of predicting a free sparse pass', () => {
  expect(cost({ 1: 10 }, 16)).toBeCloseTo(1.5 + 10 / 256);
  expect(cost({ 4: 2 }, 1)).toBeCloseTo(0.3 + 32);
});

test('unknown strides use nearby samples and reject negative fixed or per-pixel costs', () => {
  expect(cost({ 1: 1000, 2: 4, 4: 2.5 }, 8)).toBeCloseTo(2.125);
  expect(cost({ 1: 2, 4: 10 }, 2)).toBe(10);
  // A zero/negative intercept cannot establish that dispatch overhead is zero.
  expect(cost({ 1: 10, 4: 0.5 }, 2)).toBeCloseTo(2.575);
  expect(cost({ 1: NaN, 2: -1, 4: 0 }, 8)).toBeNull();
});

test('software timing measures initial samples then throttles to periodic checks while hardware timing runs every pass', () => {
  const base = Object.create(RelightBase.prototype);
  base.W = 512;
  base.H = 512;
  base.timing = { byStride: {}, counts: {}, pending: null, seeded: false, ticks: 0 };

  for (let i = 0; i < 3; i += 1) {
    expect(base.timeable(4, 0, 128, 0, 128, false)).toBe(true);
    base.recordTiming(4, 1, 2.5);
  }
  // Once calibrated with 3 samples, software timing skips 23 out of 24 passes.
  for (let i = 0; i < 23; i += 1) {
    expect(base.timeable(4, 0, 128, 0, 128, false)).toBe(false);
  }
  expect(base.timeable(4, 0, 128, 0, 128, false)).toBe(true);
  // Hardware timestamp queries remain enabled on every pass.
  expect(base.timeable(4, 0, 128, 0, 128, true)).toBe(true);
});
