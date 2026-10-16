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
