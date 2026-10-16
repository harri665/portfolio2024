// Limit how far a rendered light moves between evaluations. A larger step replaces too much
// of its cached image with a sparse preview, which can make the light appear to fade out.
export const TRUST_DISTANCE = 0.06;
export const MAX_EVAL_MOVE = TRUST_DISTANCE / 2;
export const HANDOFF_DISTANCE = TRUST_DISTANCE * 3;
export const HANDOFF_SECONDS = 0.12;

export function limitMove(from, wanted, maxMove = MAX_EVAL_MOVE) {
  const length = Math.hypot(...wanted.map((value, i) => value - from[i]));
  if (!(length > maxMove)) return wanted;
  return wanted.map((value, i) => from[i] + ((value - from[i]) * maxMove) / length);
}

export function boundedDamp(from, aim, lambda, delta, maxMove = MAX_EVAL_MOVE) {
  const t = 1 - Math.exp(-lambda * Math.max(0, delta));
  return limitMove(from, from.map((value, i) => value + (aim[i] - value) * t), maxMove);
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
