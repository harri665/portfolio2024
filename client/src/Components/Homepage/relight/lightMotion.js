// A large evaluation step replaces too much of the cached image with a sparse preview.
// Limit image replacement, not the light's animated movement.
export const TRUST_DISTANCE = 0.06;
export const MAX_EVAL_MOVE = TRUST_DISTANCE / 2;
export const HANDOFF_DISTANCE = TRUST_DISTANCE * 3;
export const TRAIL_SECONDS = 0.18;
export const MAX_IMAGE_BLEND = 1 - Math.exp(-MAX_EVAL_MOVE / TRUST_DISTANCE);

export function dampedPosition(from, aim, lambda, delta) {
  const t = 1 - Math.exp(-lambda * Math.max(0, delta));
  return from.map((value, i) => value + (aim[i] - value) * t);
}

export function imageBlend(moved) {
  return Math.min(1 - Math.exp(-moved / TRUST_DISTANCE), MAX_IMAGE_BLEND);
}

export function handoffProgress(from, to, position) {
  const direction = to.map((value, i) => value - from[i]);
  const length2 = direction.reduce((sum, value) => sum + value * value, 0);
  if (length2 <= 0) return 1;
  const traveled = position.reduce((sum, value, i) => sum + (value - from[i]) * direction[i], 0);
  return Math.max(0, Math.min(1, traveled / length2));
}

export function readyHandoff(spares, aim, view, trustDistance) {
  let best = null;
  let nearest = trustDistance;
  for (const spare of spares) {
    if (!spare.ready || !spare.pos || !spare.rect ||
        spare.rect[0] > view[0] || spare.rect[1] < view[1] ||
        spare.rect[2] > view[2] || spare.rect[3] < view[3]) continue;
    const d = Math.hypot(...spare.pos.map((value, i) => value - aim[i]));
    if (d <= nearest) {
      best = spare;
      nearest = d;
    }
  }
  return best;
}
