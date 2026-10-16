import { boundedDamp, limitMove, readyHandoff, MAX_EVAL_MOVE } from './lightMotion';

test('a long frame or distant target cannot move a light beyond one trusted evaluation step', () => {
  const start = [0, 0, 0];
  const next = boundedDamp(start, [1, 0, 0], 6, 0.5);
  expect(next[0]).toBeCloseTo(MAX_EVAL_MOVE);
  expect(next[1]).toBe(0);
  expect(boundedDamp(next, [1, 0, 0], 6, 0.5)[0]).toBeCloseTo(2 * MAX_EVAL_MOVE);
});

test('small moves retain the normal damping and settle at the target', () => {
  const next = boundedDamp([0, 0, 0], [0.02, 0, 0], 6, 1 / 24);
  expect(next[0]).toBeCloseTo(0.02 * (1 - Math.exp(-6 / 24)));
  expect(boundedDamp([0.02, 0, 0], [0.02, 0, 0], 6, 1 / 24)).toEqual([0.02, 0, 0]);
});

test('subthreshold movement accumulates while its evaluated position is unchanged', () => {
  const evaluated = [0, 0, 0];
  let animated = [...evaluated];
  for (let i = 0; i < 4; i += 1) {
    animated = limitMove(evaluated, boundedDamp(animated, [0.02, 0, 0], 6, 1 / 24, Infinity));
  }
  expect(animated[0]).toBeGreaterThan(0.004);
  expect(animated[0]).toBeLessThan(0.02);
});

test('a handoff needs a complete image at the destination that covers the view', () => {
  const view = [0.1, 0.9, 0.1, 0.9];
  const spares = [
    { ready: true, pos: [1, 0, 0], rect: [0, 1, 0, 1] },
    { ready: false, pos: [0.01, 0, 0], rect: [0, 1, 0, 1] },
    { ready: true, pos: [0.02, 0, 0], rect: [0.2, 0.8, 0.2, 0.8] },
    { ready: true, pos: [0.04, 0, 0], rect: [0, 1, 0, 1] },
  ];
  expect(readyHandoff(spares, [0, 0, 0], view, 0.06)).toBe(spares[3]);
  expect(readyHandoff(spares, [0, 0, 0], view, 0.03)).toBeNull();
});
