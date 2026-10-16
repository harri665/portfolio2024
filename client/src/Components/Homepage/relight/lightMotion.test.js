import {
  dampedPosition,
  imageBlend,
  readyHandoff,
} from './lightMotion';

test('a distant target follows the original exponential easing without a movement cap', () => {
  const start = [0, 0, 0];
  const next = dampedPosition(start, [1, 0, 0], 6, 1 / 24);
  expect(next[0]).toBeCloseTo(1 - Math.exp(-6 / 24));
  expect(next[0]).toBeGreaterThan(0.03);
  expect(dampedPosition(next, [1, 0, 0], 6, 1 / 24)[0]).toBeGreaterThan(next[0]);
});

test('small moves retain the same damping and settle at the target', () => {
  const next = dampedPosition([0, 0, 0], [0.02, 0, 0], 4, 1 / 24);
  expect(next[0]).toBeCloseTo(0.02 * (1 - Math.exp(-4 / 24)));
  expect(dampedPosition([0.02, 0, 0], [0.02, 0, 0], 4, 1 / 24)).toEqual([0.02, 0, 0]);
});

test('nearby movement reuses the image but a distant move drops its old light spot', () => {
  expect(imageBlend(0.01)).toBeCloseTo(1 - Math.exp(-0.01 / 0.06));
  expect(imageBlend(0.059)).toBeLessThan(1);
  expect(imageBlend(0.06)).toBe(1);
  expect(imageBlend(1)).toBe(1);
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
