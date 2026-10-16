import { RelightFrameClock } from './frameClock';

test.each([60, 90, 120, 144])('delivers 24 updates per second without drift at %i Hz', (hz) => {
  const clock = new RelightFrameClock(24);
  const samples = [];
  for (let i = 0; i < hz * 30; i += 1) {
    const sample = clock.step(i * 1000 / hz);
    if (sample) samples.push(sample);
  }
  expect(samples).toHaveLength(720);
  expect(samples.every((sample) => sample.missedSlots === 0)).toBe(true);
  expect(Math.max(...samples.map((sample) => sample.latenessMs))).toBeLessThan(1000 / hz + 0.3);
});

test('60 Hz uses two and three refreshes without treating the 50 ms interval as a miss', () => {
  const clock = new RelightFrameClock();
  const samples = Array.from({ length: 60 }, (_, i) => clock.step(i * 1000 / 60)).filter(Boolean);
  const intervals = new Set(samples.slice(1).map((sample) => Math.round(sample.deltaMs)));
  expect([...intervals].sort()).toEqual([33, 50]);
  expect(samples.every((sample) => sample.missedSlots === 0)).toBe(true);
});

test('counts missed work after a stall and drops catch-up updates', () => {
  const clock = new RelightFrameClock();
  clock.step(0);
  const delayed = clock.step(100);
  expect(delayed.missedSlots).toBe(1);
  expect(clock.step(100)).toBeNull();
  expect(clock.step(116.67)).toBeNull();
  expect(clock.step(133.33)).toBeNull();
  expect(clock.step(150).missedSlots).toBe(0);
});

test('tab resume starts a new deadline without blaming hidden time on quality', () => {
  const clock = new RelightFrameClock();
  clock.step(0);
  expect(clock.step(5000)).toMatchObject({ missedSlots: 0, resumed: true, deltaMs: 0 });
  clock.suspend();
  expect(clock.step(6000)).toMatchObject({ missedSlots: 0, resumed: true, deltaMs: 0 });
  expect(clock.step(6016.67)).toBeNull();
});
