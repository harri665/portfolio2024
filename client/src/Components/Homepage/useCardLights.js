import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// Where the backdrop lights up under a glass card. With a mouse it's the
// hovered card; on touch screens it's the card nearest the middle of the
// screen, which also gets `data-focus` so CSS can light its rim and the glass
// can thicken. Each card's light fades in and out where it is; moving to
// another card crossfades, nothing slides.
export const CARD_SELECTOR = '[data-liquid-glass]';

// Returns update(root, size, delta), to call once a frame. It gives the two
// brightest lights, the card coming in and the one leaving, as
// [left, top, right, bottom, amount] in CSS pixels.
export default function useCardLights() {
  // The focused card, and every card whose light is still fading (card -> 0..1)
  const focus = useRef({ el: null, lights: new Map() });
  const canHover = useMemo(
    () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true,
    []
  );

  useEffect(() => {
    const focusState = focus.current;
    return () => focusState.el?.removeAttribute('data-focus');
  }, []);

  return function update(root, size, delta) {
    let next = null;
    if (canHover) {
      next = root.querySelector(`${CARD_SELECTOR}:hover`);
    } else {
      const middle = size.height / 2;
      let best = Infinity;
      root.querySelectorAll(CARD_SELECTOR).forEach((card) => {
        const r = card.getBoundingClientRect();
        if (r.bottom < 0 || r.top > size.height) {
          return;
        }
        const distance = Math.abs((r.top + r.bottom) / 2 - middle);
        if (distance < best) {
          best = distance;
          next = card;
        }
      });
    }

    const f = focus.current;
    if (next !== f.el) {
      if (!canHover) {
        f.el?.removeAttribute('data-focus');
        next?.setAttribute('data-focus', '');
      }
      f.el = next;
    }
    if (next && !f.lights.has(next)) {
      f.lights.set(next, 0);
    }
    f.lights.forEach((amount, card) => {
      const eased = THREE.MathUtils.damp(amount, card === next ? 1 : 0, 8, delta);
      if (card !== next && (eased < 0.002 || !card.isConnected)) {
        f.lights.delete(card);
      } else {
        f.lights.set(card, eased);
      }
    });

    return [...f.lights]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([card, amount]) => {
        const r = card.getBoundingClientRect();
        return [r.left, r.top, r.right, r.bottom, amount];
      });
  };
}
