// Retain the copy cadence's fractional phase on a slower rendering clock. Drop
// missed slots after stalls instead of copying several images on the same frame.
export function advanceCopyClock(now, previous, interval) {
  if (!Number.isFinite(previous)) return now;
  return previous + Math.floor((now - previous + 1e-9) / interval) * interval;
}
