import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import {
  AdaptiveQuality,
  MIN_FPS,
  REFINE_FRAMES,
  firstTier,
  gpuName,
  loadProfile,
  measuredCosts,
  profileFor,
  saveProfile,
  seedCosts,
  upgradeTier,
} from './relight/adaptiveQuality';
import { MIN_BAND_ROWS } from './relight/RelightBase';
import { RelightEngine } from './relight/RelightEngine';
import { RelightGPUEngine, requestRelightDevice } from './relight/RelightGPU';
import { ROOM_FRAGMENT, RoomLayer } from './relight/roomLayer';
import { encodePixels, loadRelightScene } from './relight/scene';
import { setRelightStatus } from './relight/status';
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
// The network runs on WebGPU where the browser has it (relight/RelightGPU),
// about five times faster than on WebGL2, where it runs otherwise
// (relight/RelightEngine); add ?relight=webgl to the URL to compare. Either
// hands each image over as an ImageBitmap. The room is drawn on a layer
// fixed to the viewport (relight/roomLayer), which stays put while the page
// scrolls; this canvas draws it too, but only for the glass to bend.
// Only a light that moves is re-evaluated, on every 2nd to 16th pixel if a
// full evaluation won't fit the frame budget. Once it rests, it's refined to
// full resolution a band of rows per frame, into a second slot that swaps in
// when done. A resting room costs one composite, and only when it changes.
// The frame budget, the canvas's pixel ratio and the image size rise for as
// long as the page holds 30 fps (relight/adaptiveQuality), and are remembered
// for the device's next visit. A larger size is fetched in the background and
// swapped in once ready. Refinement waits while the page scrolls, so those
// frames go to keeping the canvas over the viewport. The fixed layer draws at
// the screen's own pixel ratio, up to ROOM_MAX_DPR, whatever the canvas's.

const SCENE_URL = `${process.env.PUBLIC_URL}/relight/cornell`;
// The room at 512 px is scene.json and pixels.bin; other sizes carry theirs
const NATIVE = 512;
const tierSuffix = (tier) => (tier === NATIVE ? '' : `-${tier}`);
const PANEL_SELECTOR = '[data-prism-panel]';
// The hero the room is framed in on phones (PrismHero)
const HERO_SELECTOR = '[data-prism-hero]';
// Top of the hero's space on phones, below the nav bar (px)
const NAV_CLEAR = 72;
// Scroll range of the walk-in, as the knot's drip uses it: from this far down
// the page until the gallery's top edge rises to END_TOP (viewport heights)
const START = 0.03;
const END_TOP = 0.14;

// A light re-evaluates once it has moved this far (world units, ~1 px)
const MOVE_EPS = 0.004;
// How long a light rests before its preview is refined (s)
const REFINE_DELAY = 0.12;
// The page counts as scrolling until it has held still this long (s)
const SCROLL_REST = 0.15;

// World-space depth of the light: mid-room under the pointer, near the back
// wall behind a card. The box spans -1..1 on every axis, the camera looks
// down -z from z = 3.9.
const POINTER_DEPTH = 0.15;
const CARD_DEPTH = -0.45;
const REST = [0.42, 0.76, 0.15];
const INTRO_FROM = [0.1, 0.84, -0.1];

const KEY = { radius: 0.1, color: [1, 0.83, 0.64], intensity: 26 };
// A steel-blue light hidden in the far top corner, so the room is never black
const FILL = { pos: [0.64, 0.72, -0.64], radius: 0.07, color: [0.55, 0.7, 1], intensity: 9, hidden: true };

// GPU time per frame for the network (ms), until the device shows what it can take
const START_BUDGET = { compact: 5, full: 7 };
// Highest canvas pixel ratio, if the screen has that many
const MAX_DPR = { compact: 1.5, full: 2 };
// How often what was learned is saved (s)
const SAVE_EVERY = 5;
// How often the page's readout of the running setup is refreshed (s)
const PUBLISH_EVERY = 0.5;
// Size of one of the WebGL engine's activation arrays (bytes): larger runs
// faster (32 MB ~20% over 8 MB) but phones have less memory to give
const BAND_BYTES = { compact: 16 << 20, full: 32 << 20 };
// Highest pixel ratio the fixed layer draws the room at. The layer is one
// cheap pass, redrawn only when it changes; drawn at the canvas's ratio (1 on
// phones), the screen scaled it up again after the room's own upscale, and on
// a 3x phone the room looked a third of its resolution.
const ROOM_MAX_DPR = 2;

// onDpr(ratio): the pixel ratio the canvas should draw at
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

  // WebGL after a WebGPU device is lost, or when the URL asks for it
  const [webgl, setWebgl] = useState(
    () => new URLSearchParams(window.location.search).get('relight') === 'webgl'
  );

  const st = useRef(null);
  if (!st.current) {
    const gpu = gpuName(renderer.getContext());
    // Touch screens held 60 fps while the room scrolled with the canvas and
    // trailed the finger; on its fixed layer it doesn't, and at 60 the
    // network had half the time and phones saw a coarse room
    const fps = MIN_FPS;
    const profile = loadProfile(gpu, fps);
    const device = window.devicePixelRatio || 1;
    st.current = {
      engine: null,
      built: null, // the engine with its image and how to show it (buildEngine)
      layer: null, // the fixed layer the room is shown on (RoomLayer)
      device: null, // a promise of the WebGPU device, or of null
      notGPU: null, // why the network isn't on WebGPU, if it isn't
      publishedAt: -Infinity,
      bandBytes: compact ? BAND_BYTES.compact : BAND_BYTES.full,
      readyAt: null,
      progress: 0,
      box: { left: 0, top: 0, size: 1 },
      pointer: null, // image uv under the pointer, fixed when it moves
      card: { el: null, uv: null },
      key: makeLight(INTRO_FROM, KEY, [0, 1]),
      fill: makeLight(FILL.pos, FILL, [2, 3]),
      lastLevels: null,
      panel: null,
      hero: null,
      scrollY: 0,
      scrolledAt: -Infinity,
      gpu,
      fps,
      profile,
      fromProfile: !!profile,
      savedAt: 0,
      tier: firstTier(profile, compact),
      upgrading: null, // the AbortController of a larger size on its way
      upgradeFailed: false,
      upgradeCheckedAt: 0,
      shownPx: 0,
      roomDpr: 1,
      quality: new AdaptiveQuality({
        budget: finite(profile?.budget, compact ? START_BUDGET.compact : START_BUDGET.full),
        // phones start at 1, as the other backdrops draw them
        dpr: finite(profile?.dpr, compact ? 1 : Math.min(device, 1.5)),
        dprRange: [1, Math.max(1, Math.min(device, compact ? MAX_DPR.compact : MAX_DPR.full))],
        failedDpr: finite(profile?.failedDpr, Infinity),
        minFps: fps,
      }),
    };
  }

  const uniforms = useMemo(
    () => ({
      tRelight: { value: null },
      texSize: { value: new THREE.Vector2(1, 1) },
      dpr: { value: 1 },
      viewport: { value: new THREE.Vector2(1, 1) },
      box: { value: new THREE.Vector4(0, 0, 1, 0.1) }, // left, top, size (px), edge feather (uv)
      ready: { value: 0 },
      dim: { value: 1 },
      saturation: { value: 1 },
      hotKeep: { value: 1 },
      glowAt: { value: new THREE.Vector3(0, 0, 0) }, // x, y, disc radius (px)
      glowColor: { value: new THREE.Vector3(0, 0, 0) },
    }),
    []
  );

  // The canvas starts at the remembered (or default) pixel ratio. What was
  // learned is saved now and then, and as the page goes away.
  useEffect(() => {
    const state = st.current;
    onDpr?.(state.quality.dpr);
    const save = () => saveState(state);
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
    // onDpr is read once; later ratios go out from the frame loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The WebGPU device, asked for once and kept across image sizes. A device
  // that's lost (a GPU reset, a driver update) hands over to WebGL.
  const deviceFor = (state) => {
    if (!state.device) {
      state.device = requestRelightDevice()
        .catch((error) => {
          state.notGPU = error.message;
          return null;
        })
        .then((device) => {
          device?.lost.then((info) => {
            if (info.reason !== 'destroyed') {
              console.warn('Relight backdrop lost its WebGPU device:', info.message);
              state.notGPU = `its WebGPU device was lost (${info.message || info.reason})`;
              setWebgl(true);
            }
          });
          return device;
        });
    }
    return state.device;
  };
  useEffect(() => {
    const state = st.current;
    return () => {
      const device = state.device;
      state.device = null;
      device?.then((d) => d?.destroy());
      setRelightStatus({ phase: 'idle' });
    };
  }, []);

  // The fixed layer, just under the backdrop's scrolling one (PrismBackdrop)
  useEffect(() => {
    const state = st.current;
    const host = renderer.domElement.closest('[data-backdrop-layer]');
    if (!host) {
      return undefined;
    }
    try {
      state.layer = new RoomLayer(host);
    } catch (error) {
      console.warn('Relight backdrop has no fixed layer:', error);
      return undefined;
    }
    return () => {
      state.layer?.dispose();
      state.layer = null;
    };
  }, [renderer]);

  // Load the scene and build the network, on WebGPU or WebGL
  useEffect(() => {
    const state = st.current;
    const controller = new AbortController();
    const { signal } = controller;
    const fail = (error) => {
      if (error?.name !== 'AbortError') {
        console.warn('Relight backdrop unavailable:', error);
        setRelightStatus({ phase: 'failed', reason: error?.message || String(error) });
        onFail?.();
      }
    };
    setRelightStatus({ phase: 'loading' });
    if (webgl && !state.notGPU) {
      state.notGPU = 'the page was asked for WebGL (?relight=webgl)';
    }

    if (navigator.connection?.saveData) {
      fail(new Error('data saver is on'));
      return undefined;
    }

    // A missing size falls back to the one every device can have
    const load = (tier) => loadRelightScene(SCENE_URL, signal, tierSuffix(tier));
    const start = async () => {
      const [device, data] = await Promise.all([
        webgl ? null : deviceFor(state),
        load(state.tier).catch((error) => {
          if (error?.name === 'AbortError' || state.tier === NATIVE) {
            throw error;
          }
          state.tier = NATIVE;
          return load(NATIVE);
        }),
      ]);
      const built = await buildEngine(data, device, state.bandBytes, signal);
      if (signal.aborted) {
        built.dispose();
        return;
      }
      if (built.notGPU) {
        state.notGPU = built.notGPU;
      }
      seedCosts(built.engine, state.profile);
      install(state, built, uniforms);
      publish(state);
    };
    start().catch(fail);

    return () => {
      controller.abort();
      state.upgrading?.abort();
      state.upgrading = null;
      saveState(state);
      state.built?.dispose();
      state.built = null;
      state.engine = null;
      state.readyAt = null;
      uniforms.tRelight.value = null;
    };
    // onFail only matters once; a new one mustn't rebuild the network
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, uniforms, webgl]);

  // Fetches and prepares the room at `tier` px while the current one keeps
  // running, then swaps it in, starting from the current one's costs
  const startUpgrade = (tier) => {
    const state = st.current;
    const controller = new AbortController();
    const { signal } = controller;
    state.upgrading = controller;
    // on the device the current one runs on
    const device = state.engine.backend === 'webgpu' ? state.device : null;
    Promise.all([device, loadRelightScene(SCENE_URL, signal, tierSuffix(tier))])
      .then(([gpu, data]) => buildEngine(data, gpu, state.bandBytes, signal))
      .then((built) => {
        if (signal.aborted || !state.engine) {
          built.dispose();
          return;
        }
        seedCosts(built.engine, measuredCosts(state.engine));
        install(state, built, uniforms);
        state.tier = tier;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn(`Relight backdrop staying at ${state.tier} px:`, error);
          state.upgradeFailed = true;
        }
      })
      .finally(() => {
        if (state.upgrading === controller) {
          state.upgrading = null;
        }
      });
  };

  // With a mouse, the light follows the pointer. Its image position is fixed
  // when it moves, so scrolling alone leaves the light where it is.
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

    // ── Scroll: how far into the room the camera has walked
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
    if (window.scrollY !== state.scrollY) {
      state.scrollY = window.scrollY;
      state.scrolledAt = now;
    }
    const scrolling = now - state.scrolledAt < SCROLL_REST;

    // ── Where the image sits: a framed window on the hero, cover behind the gallery
    const walk = easeInOutCubic(progress);
    const small = vw < 640;
    const [heroSize, heroY] = small
      ? phoneHero(state, vw, vh)
      : [Math.min(vw * 0.9, vh * 0.86), vh * 0.5];
    const roomDpr = state.layer ? Math.min(window.devicePixelRatio || 1, ROOM_MAX_DPR) : viewport.dpr;
    state.shownPx = heroSize * roomDpr;
    state.roomDpr = roomDpr;
    const coverSize = Math.max(vw, vh) * 1.04;
    const boxSize = THREE.MathUtils.lerp(heroSize, coverSize, walk);
    const centerY = THREE.MathUtils.lerp(heroY, vh * 0.5, walk);
    state.box = { left: vw / 2 - boxSize / 2, top: centerY - boxSize / 2, size: boxSize };

    uniforms.dpr.value = viewport.dpr;
    uniforms.viewport.value.set(vw, vh);
    uniforms.box.value.set(state.box.left, state.box.top, boxSize, THREE.MathUtils.lerp(0.14, 0.03, walk));
    uniforms.dim.value = THREE.MathUtils.lerp(0.72, 0.4, walk);
    uniforms.saturation.value = THREE.MathUtils.lerp(0.8, 0.55, walk);
    uniforms.hotKeep.value = THREE.MathUtils.lerp(1, 0.35, walk);

    // Also sets data-focus on the card in focus on touch screens
    updateLights(state.panel || document, size, delta);

    const { engine, quality } = state;
    // The pixel ratio is left alone until the room has loaded and struck on
    const age = engine && state.readyAt !== null ? now - state.readyAt : 0;
    // ...and held while a larger size is prepared, which costs CPU, not pixels
    const dpr = quality.frame(delta, age > 1.5, !!state.upgrading);
    if (dpr !== null) {
      onDpr?.(dpr);
    }

    if (!engine) {
      uniforms.ready.value = 0;
      state.layer?.draw(uniforms, vw, vh, roomDpr);
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
    // Once a second, whether the GPU has room for a larger image
    if (!state.upgrading && !state.upgradeFailed && age > 2 && now - state.upgradeCheckedAt > 1) {
      state.upgradeCheckedAt = now;
      const next = upgradeTier(engine, quality.budget, state.shownPx);
      if (next) {
        startUpgrade(next);
      }
    }

    // ── Where the light wants to be: behind the card in focus, else under
    // the pointer, else at rest
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
    // the light drops in from the ceiling while the room fades in
    if (age < 1.4 && !state.pointer && !state.card.uv) {
      aim = INTRO_FROM.map((v, i) => THREE.MathUtils.lerp(v, REST[i], easeInOutCubic(clamp01((age - 0.35) / 1.05))));
    }
    // Where it comes to rest is in the room too. Held back only on the way,
    // behind a card deep in the room it crept across the image as it settled,
    // and wherever it was held off a surface it shook.
    aim = [...aim];
    keepInRoom(engine, aim, key.radius);

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
    if (needsWork(key, now, finest, scrolling)) {
      passes.push(key);
    }
    if (needsWork(fill, now, finest, scrolling) && (!passes.length || !fill.evalPos)) {
      passes.push(fill);
    }

    // Brightness is free: the key strikes on like a lamp, the fill fades up
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
      passes.forEach((light) => {
        if (step(engine, light, now, budget / passes.length, finest)) {
          dirty = true;
        }
      });
      if (dirty) {
        engine.composite([shown(key, KEY.intensity * keyLevel), shown(fill, FILL.intensity * fillLevel)]);
        state.built.present(state.layer);
      }
    }

    // A soft bloom around the key light's disc, which the tonemap flattens
    if (key.evalPos) {
      const p = engine.project(key.evalPos);
      const { left, top, size: s } = state.box;
      uniforms.glowAt.value.set(left + p.u * s, top + p.v * s, (key.radius / (p.z * 2 * engine.cam.tx)) * s);
      const glow = THREE.MathUtils.lerp(0.9, 0.45, walk) * keyLevel;
      uniforms.glowColor.value.set(KEY.color[0] * glow, KEY.color[1] * glow, KEY.color[2] * glow);
    }
    uniforms.ready.value = clamp01(age / 0.5);
    state.layer?.draw(uniforms, vw, vh, roomDpr);

    if (now - state.publishedAt > PUBLISH_EVERY) {
      state.publishedAt = now;
      publish(state);
    }
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={ROOM_FRAGMENT}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// The room's size and centre on a phone's hero (px): as large as the space
// between the nav bar and the first cards allows, a little wider than the
// screen so its walls feather off the edges
function phoneHero(state, vw, vh) {
  if (!state.hero?.isConnected) {
    state.hero = document.querySelector(HERO_SELECTOR);
  }
  if (!state.hero) {
    return [Math.min(vw * 1.12, vh * 0.6), vh * 0.44];
  }
  // where the hero ends at the top of the page
  const bottom = state.hero.getBoundingClientRect().bottom + window.scrollY;
  const space = Math.max(bottom - NAV_CLEAR, vh * 0.4);
  return [Math.min(vw * 1.2, space), NAV_CLEAR + space / 2];
}

// Tells the page what the room runs on and how, for RelightStatus
function publish(state) {
  const { engine, quality } = state;
  if (!engine) {
    return;
  }
  const round = (x) => (x === null ? null : Number(x.toFixed(1)));
  setRelightStatus({
    phase: 'running',
    backend: engine.backend,
    notGPU: engine.backend === 'webgpu' ? null : state.notGPU,
    half: !!engine.half,
    size: engine.W,
    gpu: state.gpu,
    fps: state.fps,
    dpr: quality.dpr,
    budget: round(quality.budget),
    cost: round(engine.evalCost(1)),
    seeded: engine.timing.seeded,
    moving: previewStride(engine, quality.budget),
    resting: refineStride(engine, quality.budget),
    fixedLayer: !!state.layer,
    roomDpr: state.roomDpr,
    fromProfile: state.fromProfile,
    upgrading: !!state.upgrading,
  });
}

// Keeps what this visit learned for the next
function saveState({ engine, gpu, fps, quality }) {
  const profile = profileFor(gpu, fps, engine, quality);
  if (profile) {
    saveProfile(profile);
  }
}

// The network for a loaded scene: on `device` (WebGPU) if there is one and
// it can run it, else on WebGL. Returns { engine, texture, present, dispose,
// notGPU }: the texture the backdrop samples, present(layer) to call after
// each composite, which hands the image to the texture and the fixed layer,
// dispose() for all of it, and why a device couldn't run it, if it couldn't.
async function buildEngine(data, device, bandBytes, signal) {
  let engine = null;
  let notGPU = null;
  if (device) {
    try {
      engine = await RelightGPUEngine.create(device, data);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      console.warn('Relight backdrop running on WebGL instead of WebGPU:', error);
      notGPU = `WebGPU couldn't build the network (${error.message})`;
    }
  }
  if (!engine) {
    engine = new RelightEngine(data, await encodePixels(data, signal), { bandBytes });
  }

  // Images come bottom row first, so they go in unflipped
  const texture = new THREE.Texture();
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const release = (image) => {
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      image.close();
    }
  };
  return {
    engine,
    notGPU,
    texture,
    present: (layer) => {
      const previous = texture.image;
      const image = engine.snapshot();
      texture.image = image;
      texture.needsUpdate = true;
      layer?.setImage(image);
      if (previous !== image) {
        release(previous);
      }
    },
    dispose: () => {
      release(texture.image);
      engine.dispose();
      texture.dispose();
    },
  };
}

// Puts a built network in place of the one running (if any). Its slots are
// empty, so both lights are evaluated afresh, in the same frame, before the
// next composite.
function install(state, built, uniforms) {
  state.built?.dispose();
  state.built = built;
  state.engine = built.engine;
  uniforms.tRelight.value = built.texture;
  uniforms.texSize.value.set(built.engine.W, built.engine.H);
  [state.key, state.fill].forEach((light) =>
    Object.assign(light, { evalPos: null, shown: 0, stride: 0, refineStride: 0, refineRow: 0 })
  );
  state.lastLevels = null;
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

// A moved light always needs work; refining a resting one waits out a scroll
function needsWork(light, now, finest, scrolling) {
  return (
    !light.evalPos ||
    distance(light.pos, light.evalPos) > MOVE_EPS ||
    (!scrolling && light.stride > finest && now - light.still > REFINE_DELAY)
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
    // as many rows as fit the budget; on a slow GPU a few at a time, though
    // never so few that the pass costs more than its rows
    const rows = cost ? Math.floor((total * budget) / cost / 4) * 4 : MIN_BAND_ROWS;
    const r1 = Math.min(total, light.refineRow + THREE.MathUtils.clamp(rows, MIN_BAND_ROWS, total));
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
  return [1, 2, 4].find((s) => engine.evalCost(s) <= budget * REFINE_FRAMES) ?? 8;
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

// The world point under image uv at world depth z
function atDepth(engine, [u, v], z) {
  return engine.unproject(u, v, engine.cam.O[2] - z);
}

// Keeps a light inside the box and in front of the first surface under it,
// so it slides over the blocks and walls instead of sinking into them
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
  // The patch of surface around it, as wide as the light looks at the front
  // of the room, where it looks largest. Measured where it is, pulling it
  // forward widened the patch onto a nearer edge, which pulled it further,
  // and letting it back narrowed it again: it flipped between the two.
  const r = radius / ((O[2] - engine.hi[2]) * 2 * tx);
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
  // A short gallery may not scroll far enough, so it always finishes by the
  // time the page can't scroll any further
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

// A lamp striking on: dark, two flickers, then full
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

