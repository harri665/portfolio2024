import assert from 'node:assert/strict';
import test from 'node:test';
import { frameStats, summarizeRelight, threeState } from './measure.mjs';

const sample = (at, updates, seconds, lights, overrides = {}) => ({
  at, status: {
    phase: 'running', sceneUpdates: updates, measuredSeconds: seconds,
    lightingUpdates: lights, refinementUpdates: 0, missedFrames: 0,
    fps: 24, backend: 'webgpu', size: 768, network: '128x4', ...overrides,
  },
});

test('scene submissions, lighting submissions, and browser callbacks remain distinct', () => {
  const result = summarizeRelight([sample(1000, 24, 1, 10), sample(3000, 72, 3, 34)]);
  assert.equal(result.sceneUpdateHz, 24);
  assert.equal(result.lightingSubmissionHz, 12);
  assert.equal(result.refinementSubmissionHz, 0);
  assert.match(result.cadence, /not confirmed display/);
  assert.equal(frameStats(Array(120).fill(1000 / 60)).fps, 60);
});

test('warm-up holds do not inflate lighting throughput by dividing by active scene time', () => {
  const result = summarizeRelight([sample(1000, 24, 1, 10), sample(4000, 72, 3, 34)]);
  assert.equal(result.sceneUpdateHz, 24);
  assert.equal(result.lightingSubmissionHz, 8);
  assert.equal(result.observedSeconds, 3);
  assert.equal(result.measuredSeconds, 2);
});

test('renderer counter resets discard stale measurements and insufficient samples give no rate', () => {
  assert.equal(summarizeRelight([]), null);
  const result = summarizeRelight([sample(1000, 24, 1, 10), sample(2000, 0, 0, 0), sample(3000, 24, 1, 5)]);
  assert.equal(result.counterResets, 1);
  assert.equal(result.sceneUpdateHz, 24);
  assert.equal(result.lightingSubmissionHz, 5);
});

test('only a live renderer establishes Relight presence, even if settings remain saved', () => {
  const original = globalThis.window;
  globalThis.window = { __perf: { canvases: [{ isConnected: true, width: 100, height: 100, clientWidth: 100 }], relight: [] } };
  try {
    assert.equal(threeState().relight, null);
    window.__perf.relight.push(sample(performance.now(), 24, 1, 10));
    assert.equal(threeState().relight.phase, 'running');
    window.__perf.relight[0].at = performance.now() - 3000;
    assert.equal(threeState().relight, null);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
