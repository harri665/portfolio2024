// Nearby evaluations can reuse the previous image. A light that moves farther
// than the image's trust distance must drop it so it cannot leave a second spot.
export const TRUST_DISTANCE = 0.06;
export const MAX_EVAL_MOVE = TRUST_DISTANCE / 2;
export const HANDOFF_DISTANCE = TRUST_DISTANCE * 3;

export function dampedPosition(from, aim, lambda, delta) {
  const t = 1 - Math.exp(-lambda * Math.max(0, delta));
  return from.map((value, i) => value + (aim[i] - value) * t);
}

export function imageBlend(moved) {
  return moved >= TRUST_DISTANCE ? 1 : 1 - Math.exp(-moved / TRUST_DISTANCE);
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
