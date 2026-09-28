import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { AdaptiveQuality, gpuName, loadProfile, saveProfile, sceneKey } from './relight/adaptiveQuality';
import { RelightEngine, loadRelightScene } from './relight/RelightEngine';
import useCardLights, { CARD_SELECTOR } from './useCardLights';

// ─── CS: a Cornell box lit by a neural network ─────────────────────────────
// The CS home page's backdrop is a live neural render proxy: a small MLP,
// trained on path-traced light transport, predicts the global illumination of
// a Cornell box for a sphere light anywhere inside it (see relight/). The
// light is yours. On the hero it follows the pointer through the room, its
// glow bleeding red and green off the walls; phones get a light that drops in
// from the ceiling and settles. Scrolling to the gallery walks the camera into
// the box until it fills the screen behind the glass cards, and the light
// moves behind whichever card you hover (on touch screens, the one in focus),
// so each pane is lit from behind by the room's bounce light.
//
// Only a light that moves is re-evaluated, on every 2nd to 16th pixel if a
// full evaluation won't fit the frame budget. Once it rests, it's refined to
// full resolution a band of rows per frame, into a second slot that swaps in
// when done. A resting room costs one composite, and only when it changes.
// The frame budget and the canvas's pixel ratio rise for as long as the page
// holds 30 fps (relight/adaptiveQuality), and are remembered for the device's
// next visit.

const SCENE_URL = `${process.env.PUBLIC_URL}/relight/cornell`;
const PANEL_SELECTOR = '[data-prism-panel]';
// walk-in scroll range, in viewport heights
const START = 0.03;
const END_TOP = 0.14;

// ~1px in world units
const MOVE_EPS = 0.004;
// s at rest before it's refined
const REFINE_DELAY = 0.12;

// box is -1..1 on every axis, camera at z = 3.9 looking down -z
const POINTER_DEPTH = 0.15;
const CARD_DEPTH = -0.45;
const REST = [0.42, 0.76, 0.15];
const INTRO_FROM = [0.1, 0.84, -0.1];

const KEY = { radius: 0.1, color: [1, 0.83, 0.64], intensity: 26 };
// hidden fill light so the room is never fully black
const FILL = { pos: [0.64, 0.72, -0.64], radius: 0.07, color: [0.55, 0.7, 1], intensity: 9, hidden: true };

// GPU time per frame for the network (ms), until the device shows what it can take
const START_BUDGET = { compact: 5, full: 7 };
const MAX_DPR = { compact: 1.5, full: 2 };
const SAVE_EVERY = 5;

export default function RelightBackdrop({ onProgress, onFail, onDpr }) {
  const renderer = useThree((state) => state.gl);
  const updateLights = useCardLights();
  const canHover = useMemo(
    () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true,
    []
  );
  const reduceMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  );
  const compact = useMemo(
    () => window.matchMedia?.('(max-width: 768px), (pointer: coarse)').matches ?? false,
    []
  );

  const st = useRef(null);
  if (!st.current) {
    const gpu = gpuName(renderer.getContext());
    const profile = loadProfile(gpu);
    const device = window.devicePixelRatio || 1;
    st.current = {
      engine: null,
      target: null,
      framebuffer: null,
      readyAt: null,
      progress: 0,
      box: { left: 0, top: 0, size: 1 },
      pointer: null, // image uv under the pointer, fixed when it moves
      card: { el: null, uv: null },
      key: makeLight(INTRO_FROM, KEY, [0, 1]),
      fill: makeLight(FILL.pos, FILL, [2, 3]),
      lastLevels: null,
      panel: null,
      gpu,
      profile,
      savedAt: 0,
      quality: new AdaptiveQuality({
        budget: finite(profile?.budget, compact ? START_BUDGET.compact : START_BUDGET.full),
        dpr: finite(profile?.dpr, compact ? 1 : Math.min(device, 1.5)),
        dprRange: [1, Math.max(1, Math.min(device, compact ? MAX_DPR.compact : MAX_DPR.full))],
        failedDpr: finite(profile?.failedDpr, Infinity),
      }),
    };
  }

  const uniforms = useMemo(
    () => ({
      tRelight: { value: null },
      dpr: { value: 1 },
      viewport: { value: new THREE.Vector2(1, 1) },
      box: { value: new THREE.Vector4(0, 0, 1, 0.1) }, // left, top, size (px), edge feather (uv)
      ready: { value: 0 },
      dim: { value: 1 },
      saturation: { value: 1 },
      hotKeep: { value: 1 },
      glowAt: { value: new THREE.Vector3(0, 0, 0) }, // x, y, radius (px)
      glowColor: { value: new THREE.Vector3(0, 0, 0) },
    }),
    []
  );

  useEffect(() => {
    const state = st.current;
    onDpr?.(state.quality.dpr);
    const save = () => saveState(state);
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the scene and build the network on three.js's own context
  useEffect(() => {
    const state = st.current;
    const controller = new AbortController();
    const ctx = renderer.getContext();
    const fail = (error) => {
      if (error?.name !== 'AbortError') {
        console.warn('Relight backdrop unavailable:', error);
        onFail?.();
      }
    };

    if (typeof WebGL2RenderingContext === 'undefined' || !(ctx instanceof WebGL2RenderingContext)) {
      fail(new Error('WebGL2 is not available'));
      return undefined;
    }
    if (navigator.connection?.saveData) {
      fail(new Error('data saver is on'));
      return undefined;
    }

    loadRelightScene(SCENE_URL, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) {
          return;
        }
        renderer.resetState();
        ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, false);
        ctx.pixelStorei(ctx.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        ctx.pixelStorei(ctx.UNPACK_ALIGNMENT, 4);
        let engine;
        try {
          engine = new RelightEngine(ctx, data);
        } finally {
          renderer.resetState();
        }

        if (state.profile?.scene === sceneKey(engine)) {
          engine.seedTiming(state.profile.byStride);
        }

        const target = new THREE.WebGLRenderTarget(engine.W, engine.H, {
          depthBuffer: false,
          generateMipmaps: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        });
        // Let three.js create the target's framebuffer, then borrow it
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        state.framebuffer = ctx.getParameter(ctx.FRAMEBUFFER_BINDING);
        renderer.setRenderTarget(previous);

        state.engine = engine;
        state.target = target;
        uniforms.tRelight.value = target.texture;
      })
      .catch(fail);

    return () => {
      controller.abort();
      saveState(state);
      state.engine?.dispose();
      state.target?.dispose();
      state.engine = null;
      state.target = null;
      uniforms.tRelight.value = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, uniforms]);

  useEffect(() => {
    if (!canHover) {
      return undefined;
    }
    const state = st.current;
    const onMove = (event) => {
      if (event.pointerType === 'touch') {
        return;
      }
      const { left, top, size } = state.box;
      state.pointer = [(event.clientX - left) / size, (event.clientY - top) / size];
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [canHover]);

  useFrame(({ clock, size, viewport }, delta) => {
    const state = st.current;
    const now = clock.getElapsedTime();
    const vw = size.width;
    const vh = Math.max(size.height, 1);

    if (!state.panel?.isConnected) {
      state.panel = document.querySelector(PANEL_SELECTOR);
    }
    const target = state.panel
      ? walkInProgress(state.panel, vh)
      : clamp01(window.scrollY / vh);
    const previous = state.progress;
    let progress = THREE.MathUtils.damp(previous, target, 5, delta);
    if (Math.abs(progress - target) < 0.0005) {
      progress = target;
    }
    state.progress = progress;
    if (onProgress && progress !== previous) {
      onProgress(progress);
    }

    const walk = easeInOutCubic(progress);
    const small = vw < 640;
    const heroSize = small ? Math.min(vw * 1.12, vh * 0.6) : Math.min(vw * 0.9, vh * 0.86);
    const coverSize = Math.max(vw, vh) * 1.04;
    const boxSize = THREE.MathUtils.lerp(heroSize, coverSize, walk);
    const centerY = THREE.MathUtils.lerp(vh * (small ? 0.44 : 0.5), vh * 0.5, walk);
    state.box = { left: vw / 2 - boxSize / 2, top: centerY - boxSize / 2, size: boxSize };

    uniforms.dpr.value = viewport.dpr;
    uniforms.viewport.value.set(vw, vh);
    uniforms.box.value.set(state.box.left, state.box.top, boxSize, THREE.MathUtils.lerp(0.14, 0.03, walk));
    uniforms.dim.value = THREE.MathUtils.lerp(0.72, 0.4, walk);
    uniforms.saturation.value = THREE.MathUtils.lerp(0.8, 0.55, walk);
    uniforms.hotKeep.value = THREE.MathUtils.lerp(1, 0.35, walk);

    updateLights(state.panel || document, size, delta);

    const { engine, quality } = state;
    const age = engine && state.readyAt !== null ? now - state.readyAt : 0;
    const dpr = quality.frame(delta, age > 1.5);
    if (dpr !== null) {
      onDpr?.(dpr);
    }

    if (!engine) {
      uniforms.ready.value = 0;
      return;
    }
    engine.pollTiming();
    if (state.readyAt === null) {
      state.readyAt = now;
    }
    if (now - state.savedAt > SAVE_EVERY) {
      state.savedAt = now;
      saveState(state);
    }

    const { key, fill } = state;
    let aim = REST;
    const card =
      progress > 0.3 && state.panel
        ? state.panel.querySelector(canHover ? `${CARD_SELECTOR}:hover` : `${CARD_SELECTOR}[data-focus]`)
        : null;
    if (card !== state.card.el) {
      state.card.el = card;
      state.card.uv = null;
      if (card) {
        const r = card.getBoundingClientRect();
        const { left, top, size: s } = state.box;
        state.card.uv = [((r.left + r.right) / 2 - left) / s, ((r.top + r.bottom) / 2 - top) / s];
      }
    }
    if (state.card.uv) {
      aim = atDepth(engine, state.card.uv, CARD_DEPTH);
    } else if (state.pointer) {
      aim = atDepth(engine, state.pointer, POINTER_DEPTH);
    }
    if (age < 1.4 && !state.pointer && !state.card.uv) {
      aim = INTRO_FROM.map((v, i) => THREE.MathUtils.lerp(v, REST[i], easeInOutCubic(clamp01((age - 0.35) / 1.05))));
    }

    if (reduceMotion) {
      key.pos = [...aim];
    } else {
      const lambda = state.card.uv ? 6 : 4;
      key.pos = key.pos.map((v, i) => THREE.MathUtils.damp(v, aim[i], lambda, delta));
    }
    keepInRoom(engine, key.pos, key.radius);

    // ── Evaluate what changed, within the frame budget
    const { budget } = quality;
    const finest = refineStride(engine, budget);
    let dirty = false;
    const passes = [];
    if (needsWork(key, now, finest)) {
      passes.push(key);
    }
    if (needsWork(fill, now, finest) && (!passes.length || !fill.evalPos)) {
      passes.push(fill);
    }

    const keyLevel = reduceMotion ? clamp01(age / 0.6) : strike(age);
    const fillLevel = easeOutCubic(clamp01((age - 0.2) / 1.4));
    const levels = `${keyLevel.toFixed(3)} ${fillLevel.toFixed(3)}`;
    if (levels !== state.lastLevels) {
      state.lastLevels = levels;
      dirty = true;
    }

    if (passes.length) {
      quality.worked();
    }
    if (passes.length || dirty) {
      // The engine drives the context directly, so three.js's cache of it
      // goes stale: hand over a clean state and take it back after
      renderer.resetState();
      passes.forEach((light) => {
        if (step(engine, light, now, budget / passes.length, finest)) {
          dirty = true;
        }
      });
      if (dirty) {
        engine.composite(
          [shown(key, KEY.intensity * keyLevel), shown(fill, FILL.intensity * fillLevel)],
          state.framebuffer
        );
      }
      renderer.resetState();
    }

    // soft bloom, the tonemap flattens the key light otherwise
    if (key.evalPos) {
      const p = engine.project(key.evalPos);
      const { left, top, size: s } = state.box;
      uniforms.glowAt.value.set(left + p.u * s, top + p.v * s, (key.radius / (p.z * 2 * engine.cam.tx)) * s);
      const glow = THREE.MathUtils.lerp(0.9, 0.45, walk) * keyLevel;
      uniforms.glowColor.value.set(KEY.color[0] * glow, KEY.color[1] * glow, KEY.color[2] * glow);
    }
    uniforms.ready.value = clamp01(age / 0.5);
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// Keeps what this visit learned for the next, once the network has been
// measured (the first measurements include compiling its shaders)
function saveState({ engine, gpu, quality }) {
  if (!engine || engine.timing.samples <= 2 || engine.timing.seeded) {
    return;
  }
  saveProfile({
    gpu,
    scene: sceneKey(engine),
    byStride: engine.timing.byStride,
    budget: quality.budget,
    dpr: quality.dpr,
    failedDpr: Number.isFinite(quality.failedDpr) ? quality.failedDpr : null,
  });
}

function makeLight(pos, { radius, color, hidden = false }, slots) {
  return {
    pos: [...pos],
    radius,
    color,
    hidden,
    slots,
    // what the shown slot holds: its position, stride, and when it was set
    evalPos: null,
    shown: 0,
    stride: 0,
    still: 0,
    // the refinement under way in the other slot: its stride and next row
    refineStride: 0,
    refineRow: 0,
  };
}

function needsWork(light, now, finest) {
  return (
    !light.evalPos ||
    distance(light.pos, light.evalPos) > MOVE_EPS ||
    (light.stride > finest && now - light.still > REFINE_DELAY)
  );
}

// One frame's work on a light. A moved light is re-evaluated in its shown
// slot, as coarsely as the budget needs; a resting preview is refined into
// the other slot (at stride `finest`) a band at a time, then swapped in.
// True if the image changed.
function step(engine, light, now, budget, finest) {
  if (!light.evalPos || distance(light.pos, light.evalPos) > MOVE_EPS) {
    const stride = previewStride(engine, budget);
    light.evalPos = [...light.pos];
    engine.evaluate({ pos: light.evalPos, radius: light.radius }, light.slots[light.shown], stride);
    light.stride = stride;
    light.still = now;
    light.refineRow = 0;
    return true;
  }
  if (light.stride > finest) {
    if (light.refineStride !== finest) {
      light.refineStride = finest;
      light.refineRow = 0;
    }
    const other = 1 - light.shown;
    const total = engine.rows(finest);
    const cost = engine.evalCost(finest);
    // as many rows as fit the budget; on a slow GPU a few at a time
    const rows = cost ? Math.floor((total * budget) / cost / 4) * 4 : 16;
    const r1 = Math.min(total, light.refineRow + THREE.MathUtils.clamp(rows, 4, total));
    engine.evaluate({ pos: light.evalPos, radius: light.radius }, light.slots[other], finest, light.refineRow, r1);
    light.refineRow = r1;
    if (r1 >= total) {
      light.shown = other;
      light.stride = finest;
      light.refineRow = 0;
      return true;
    }
  }
  return false;
}

// How far a resting light is refined: the finest stride whose whole
// evaluation fits in about 40 frames' budget. Fast GPUs reach every pixel;
// slow ones stop at a softer image rather than stall the page for seconds.
// Nothing is refined before the GPU's speed is known.
function refineStride(engine, budget) {
  if (engine.evalCost(1) === null) {
    return 4;
  }
  return [1, 2, 4].find((s) => engine.evalCost(s) <= budget * 40) ?? 8;
}

// The finest stride whose evaluation fits the budget; unmeasured, a cheap one
function previewStride(engine, budget) {
  if (engine.evalCost(1) === null) {
    return 4;
  }
  return [1, 2, 4, 8].find((s) => engine.evalCost(s) <= budget) ?? 16;
}

function shown(light, intensity) {
  return {
    pos: light.evalPos,
    radius: light.radius,
    color: light.color,
    intensity,
    slot: light.slots[light.shown],
    stride: light.stride,
    hidden: light.hidden,
  };
}

function atDepth(engine, [u, v], z) {
  return engine.unproject(u, v, engine.cam.O[2] - z);
}

function keepInRoom(engine, pos, radius) {
  const margin = radius + 0.03;
  for (let i = 0; i < 3; i += 1) {
    pos[i] = THREE.MathUtils.clamp(pos[i], engine.lo[i] + margin, engine.hi[i] - (i === 2 ? 0 : margin));
  }
  const { O, tx } = engine.cam;
  const p = engine.project(pos);
  if (p.z <= 0) {
    return;
  }
  const r = radius / (p.z * 2 * tx);
  const surface = Math.min(
    engine.surfaceDistance(p.u, p.v),
    engine.surfaceDistance(p.u - r, p.v),
    engine.surfaceDistance(p.u + r, p.v),
    engine.surfaceDistance(p.u, p.v - r),
    engine.surfaceDistance(p.u, p.v + r)
  );
  const offset = pos.map((v, i) => v - O[i]);
  const dist = Math.hypot(...offset);
  const limit = surface - radius * 1.5 - 0.03;
  if (dist > limit && limit > 0.5) {
    for (let i = 0; i < 3; i += 1) {
      pos[i] = O[i] + (offset[i] * limit) / dist;
    }
  }
}

function walkInProgress(panel, vh) {
  const rect = panel.getBoundingClientRect();
  // short galleries might not scroll far enough
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
  let start = START * vh;
  let end = Math.max(rect.top + window.scrollY - END_TOP * vh, start + 0.2 * vh);
  end = Math.min(end, maxScroll);
  if (end - start < 0.15 * vh) {
    start = 0;
    end = maxScroll;
  }
  return end > 0 ? clamp01((window.scrollY - start) / (end - start)) : 1;
}

function strike(t) {
  const keys = [
    [0.3, 0],
    [0.36, 0.75],
    [0.44, 0.12],
    [0.58, 0.9],
    [0.68, 0.45],
    [0.9, 1],
  ];
  if (t <= keys[0][0]) {
    return 0;
  }
  for (let i = 1; i < keys.length; i += 1) {
    if (t < keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return 1;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function finite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const vertexShader = `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// The relit image placed in the page: a window with soft rounded edges on the
// hero that grows past the screen's edges, dimmed and a little desaturated
// so glass and text read over it, plus a bloom around the light
const fragmentShader = `
  uniform sampler2D tRelight;
  uniform float dpr;
  uniform vec2 viewport;
  uniform vec4 box;
  uniform float ready;
  uniform float dim;
  uniform float saturation;
  uniform float hotKeep;
  uniform vec3 glowAt;
  uniform vec3 glowColor;

  float sdRoundBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 px = vec2(gl_FragCoord.x, viewport.y * dpr - gl_FragCoord.y) / dpr;
    vec3 base = vec3(0.031, 0.035, 0.047);
    vec3 color = base;

    if (ready > 0.0) {
      vec2 uv = (px - box.xy) / box.z;
      float d = sdRoundBox(uv - 0.5, vec2(0.5), 0.05);
      float mask = 1.0 - smoothstep(-box.w, 0.0, d);
      if (mask > 0.0) {
        vec3 image = texture2D(tRelight, vec2(uv.x, 1.0 - uv.y)).rgb;
        float luma = dot(image, vec3(0.2126, 0.7152, 0.0722));
        float hot = smoothstep(0.82, 0.97, luma) * hotKeep;
        image = mix(mix(vec3(luma), image, saturation) * dim, image, hot);
        color = mix(base, max(image, base), mask * ready);
      }

      float r = length(px - glowAt.xy);
      float reach = glowAt.z * 2.5 + 26.0;
      color += glowColor * exp(-r / reach) * smoothstep(glowAt.z * 0.6, glowAt.z * 1.6, r) * ready;
    }

    color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(color, 1.0);
  }
`;
