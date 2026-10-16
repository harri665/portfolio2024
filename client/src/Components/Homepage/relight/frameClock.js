// Keep fractional deadlines: 24 updates on a 60 Hz display alternate two and three
// refreshes. Resetting the deadline to each draw would round that down to 20 Hz.
const JITTER_MS = 0.25;
const RESUME_MS = 250;

export class RelightFrameClock {
  constructor(fps = 24) {
    this.interval = 1000 / fps;
    this.deadline = null;
    this.lastCallback = null;
    this.lastDraw = null;
    this.resuming = false;
    this.refreshMs = 1000 / 60;
    this.callbackIntervals = [];
  }

  suspend() {
    this.deadline = null;
    this.lastCallback = null;
    this.lastDraw = null;
    this.resuming = true;
  }

  step(timestamp) {
    if (!Number.isFinite(timestamp)) return null;
    const gap = this.lastCallback === null ? 0 : timestamp - this.lastCallback;
    if (gap < 0 || gap > RESUME_MS) this.suspend();
    if (gap > 0 && gap < RESUME_MS) {
      this.callbackIntervals.push(gap);
      if (this.callbackIntervals.length > 60) this.callbackIntervals.shift();
      // The lower quartile ignores occasional delayed callbacks while still
      // adapting to a different refresh rate after a screen change.
      if (this.callbackIntervals.length >= 8) {
        const ordered = [...this.callbackIntervals].sort((a, b) => a - b);
        this.refreshMs = ordered[Math.floor(ordered.length / 4)];
      }
    }
    this.lastCallback = timestamp;
    if (this.deadline === null) this.deadline = timestamp;
    if (timestamp + JITTER_MS < this.deadline) return null;

    const latenessMs = Math.max(0, timestamp - this.deadline);
    const missedSlots = Math.floor((latenessMs + JITTER_MS) / this.interval);
    const sample = {
      timestamp,
      deltaMs: this.lastDraw === null ? 0 : timestamp - this.lastDraw,
      latenessMs,
      missedSlots,
      refreshMs: this.refreshMs,
      resumed: this.resuming,
    };
    this.lastDraw = timestamp;
    this.resuming = false;
    // A stall never queues catch-up work on subsequent callbacks.
    this.deadline = missedSlots || latenessMs > this.refreshMs + JITTER_MS
      ? timestamp + this.interval
      : this.deadline + this.interval;
    return sample;
  }
}
