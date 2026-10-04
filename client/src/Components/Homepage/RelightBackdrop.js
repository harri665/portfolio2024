import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { visitId } from '../../utils/visit';

import {
  AdaptiveQuality,
  MIN_FPS,
  NETWORKS,
  REFINE_FRAMES,
  firstBudget,
  firstNetwork,
  firstTier,
  gpuName,
  loadProfile,
  measuredCosts,
  profileFor,
  saveProfile,
  seedCosts,
  switchNetwork,
  tunedKernel,
  upgradeTier,
} from './relight/adaptiveQuality';
import { MIN_BAND_ROWS } from './relight/RelightBase';
import {
  COMPACT_QUERY,
  NATIVE,
  bandBytesFor,
  createRelightEngine,
  loadRoom,
  benchStride,
  takePreparedRelight,
  tuneEngine,
} from './relight/prepare';
import { requestRelightDevice } from './relight/RelightGPU';
import { ROOM_FRAGMENT, RoomLayer } from './relight/roomLayer';
import { reportRelight } from './relight/report';
import { setRelightStatus } from './relight/status';
import useCardLights, { CARD_SELECTOR } from './useCardLights';

// CS backdrop: cornell box lit live by a small MLP trained on path traced GI (see relight/)
// webgpu is ~5x faster than webgl2. ?relight=webgl to compare

const PANEL_SELECTOR = '[data-prism-panel]';
const HERO_SELECTOR = '[data-prism-hero]';
// px below the nav bar
const NAV_CLEAR = 72;
// walk-in scroll range, in viewport heights
const START = 0.03;
const END_TOP = 0.14;

// ~1px in world units
const MOVE_EPS = 0.004;
// s at rest before it's refined
const REFINE_DELAY = 0.12;
const BENCH_TRIES = 6;
const SCROLL_REST = 0.15;
// margin so the glass has something to bend at the edge. widened when you scroll
// back out so it doesn't re-evaluate every frame
const VIEW_MARGIN = 0.03;
const VIEW_GROW = 0.15;

// box is -1..1 on every axis, camera at z = 3.9 looking down -z
const POINTER_DEPTH = 0.15;
const CARD_DEPTH = -0.45;
const REST = [0.42, 0.76, 0.15];
const INTRO_FROM = [0.1, 0.84, -0.1];

const KEY = { radius: 0.1, color: [1, 0.83, 0.64], intensity: 26 };
// hidden fill light so the room is never fully black
const FILL = { pos: [0.64, 0.72, -0.64], radius: 0.07, color: [0.55, 0.7, 1], intensity: 9, hidden: true };

const MAX_DPR = { compact: 1.5, full: 2 };
const SAVE_EVERY = 5;
const PUBLISH_EVERY = 0.5;
// s, and again when the page goes
const REPORT_AFTER = 10;
// drawn at the canvas's dpr (1 on phones) it got upscaled twice and looked
// a third of its resolution on a 3x phone
const ROOM_MAX_DPR = 2;

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
  const compact = useMemo(() => window.matchMedia?.(COMPACT_QUERY).matches ?? false, []);

  const [webgl, setWebgl] = useState(
    () => new URLSearchParams(window.location.search).get('relight') === 'webgl'
  );

  const st = useRef(null);
  if (!st.current) {
    const gpu = gpuName(renderer.getContext());
    // phones held 60 but then the network only had half the time and the room looked coarse
    const fps = MIN_FPS;
    const profile = loadProfile(gpu, fps);
    const device = window.devicePixelRatio || 1;
    st.current = {
      engine: null,
      built: null,
      layer: null,
      device: null,
      notGPU: null,
      publishedAt: -Infinity,
      bandBytes: bandBytesFor(compact),
      readyAt: null,
      progress: 0,
      box: { left: 0, top: 0, size: 1 },
      view: [0, 1, 0, 1],
      pointer: null,
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
      capped: compact,
      profile,
      fromProfile: !!profile,
      savedAt: 0,
      tier: firstTier(profile, compact),
      network: firstNetwork(profile),
      // 'timed' | 'built' | null
      prepared: null,
      visit: visitId(),
      upgrading: null,
      tuning: false,
      benching: false,
      tuneController: new AbortController(),
      upgradeFailed: false,
      upgradeCheckedAt: 0,
      shownPx: 0,
      roomDpr: 1,
      quality: new AdaptiveQuality({
        budget: firstBudget(profile, compact),
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
      glowAt: { value: new THREE.Vector3(0, 0, 0) }, // x, y, radius (px)
      glowColor: { value: new THREE.Vector3(0, 0, 0) },
    }),
    []
  );

  useEffect(() => {
    const state = st.current;
    onDpr?.(state.quality.dpr);
    const save = () => {
      saveState(state);
      if (state.reported) {
        report(state);
      }
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lost device (gpu reset, driver update) falls back to webgl
  const deviceFor = (state, requested = null) => {
    if (!state.device) {
      state.device = (requested || requestRelightDevice())
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

  useEffect(() => {
    const state = st.current;
    const controller = new AbortController();
    const { signal } = controller;
    const fail = (error) => {
      if (error?.name !== 'AbortError') {
        console.warn('Relight backdrop unavailable:', error);
        setRelightStatus({ phase: 'failed', reason: error?.message || String(error) });
        reportRelight({ phase: 'failed', reason: error?.message || String(error), gpu: st.current.gpu }, st.current.visit);
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

    const prepare = async () => {
      const [device, data] = await Promise.all([
        webgl ? null : deviceFor(state),
        loadRoom(state.tier, signal, undefined, state.network).catch((error) => {
          if (error?.name === 'AbortError' || (state.tier === NATIVE && state.network === NETWORKS[0])) {
            throw error;
          }
          state.tier = NATIVE;
          state.network = NETWORKS[0];
          return loadRoom(NATIVE, signal);
        }),
      ]);
      const kernel = tunedKernel(state.profile, state.network);
      const built = await createRelightEngine(data, device, state.bandBytes, signal, kernel);
      built.engine.tuned = !!kernel && built.engine.kernelName === kernel;
      seedCosts(built.engine, state.profile);
      return built;
    };
    const start = async () => {
      const prepared = await takePreparedRelight();
      if (prepared?.error) {
        throw prepared.error;
      }
      if (prepared) {
        if (prepared.device) {
          deviceFor(state, prepared.device);
        }
        state.tier = prepared.tier;
        state.network = prepared.network;
        state.prepared = prepared.timed ? 'timed' : 'built';
        state.upgradeFailed = prepared.upgradeFailed;
      }
      const built = withTexture(prepared || (await prepare()));
      if (signal.aborted) {
        built.dispose();
        prepared?.upgrade?.controller.abort();
        return;
      }
      if (built.notGPU) {
        state.notGPU = built.notGPU;
      }
      install(state, built, uniforms);
      publish(state);
      if (prepared?.upgrade) {
        startUpgrade(prepared.upgrade, prepared.upgrade);
      }
    };
    start().catch(fail);

    return () => {
      controller.abort();
      state.tuneController.abort();
      state.upgrading?.abort();
      state.upgrading = null;
      saveState(state);
      state.built?.dispose();
      state.built = null;
      state.engine = null;
      state.readyAt = null;
      uniforms.tRelight.value = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, uniforms, webgl]);

  const startUpgrade = ({ tier, network }, pending = null) => {
    const state = st.current;
    const controller = pending?.controller || new AbortController();
    const { signal } = controller;
    state.upgrading = controller;
    const device = state.engine.backend === 'webgpu' ? state.device : null;
    const kernel = network === state.network && state.engine.tuned ? state.engine.kernelName : null;
    Promise.all([device, pending?.data || loadRoom(tier, signal, undefined, network)])
      .then(([gpu, data]) => buildEngine(data, gpu, state.bandBytes, signal, kernel))
      .then((built) => {
        built.engine.tuned = !!kernel;
        if (signal.aborted || !state.engine) {
          built.dispose();
          return;
        }
        seedCosts(built.engine, measuredCosts(state.engine));
        install(state, built, uniforms);
        state.tier = tier;
        state.network = network;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn(`Relight backdrop staying at ${state.tier} px (${state.network}):`, error);
          state.upgradeFailed = true;
        }
      })
      .finally(() => {
        if (state.upgrading === controller) {
          state.upgrading = null;
        }
      });
  };

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
    if (window.scrollY !== state.scrollY) {
      state.scrollY = window.scrollY;
      state.scrolledAt = now;
    }
    const scrolling = now - state.scrolledAt < SCROLL_REST;

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

    updateLights(state.panel || document, size, delta);

    const { engine, quality } = state;
    const age = engine && state.readyAt !== null ? now - state.readyAt : 0;
    const dpr = quality.frame(delta, age > 1.5, !!state.upgrading || state.tuning || state.benching);
    if (dpr !== null) {
      onDpr?.(dpr);
    }

    if (!engine) {
      uniforms.ready.value = 0;
      state.layer?.draw(uniforms, vw, vh, roomDpr);
      return;
    }
    engine.pollTiming();
    if (!engine.timing.pending) {
      state.benching = false;
    }
    if (state.readyAt === null) {
      state.readyAt = now;
    }
    if (now - state.savedAt > SAVE_EVERY) {
      state.savedAt = now;
      saveState(state);
    }
    if (!state.upgrading && !state.tuning && !state.upgradeFailed && age > 2 && now - state.upgradeCheckedAt > 1) {
      state.upgradeCheckedAt = now;
      const network = switchNetwork(engine, quality.budget);
      const tier = network ? state.tier : upgradeTier(engine, quality.budget, state.shownPx);
      if (tier) {
        startUpgrade({ tier, network: network || state.network });
      }
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
    // not held back at rest. tried that and it crept across the image behind
    // deep cards and shook when held off a surface
    aim = [...aim];
    keepInRoom(engine, aim, key.radius);

    if (reduceMotion) {
      key.pos = [...aim];
    } else {
      const lambda = state.card.uv ? 6 : 4;
      key.pos = key.pos.map((v, i) => THREE.MathUtils.damp(v, aim[i], lambda, delta));
    }
    keepInRoom(engine, key.pos, key.radius);

    const { budget } = quality;
    if (state.tuning) {
      state.layer?.draw(uniforms, vw, vh, roomDpr);
      return;
    }
    const resting = (light) => light.evalPos && distance(light.pos, light.evalPos) <= MOVE_EPS && !light.refineRect;
    const timed = engine.evalCost(1) !== null;

    const bench = timed && !engine.timing.pending && (engine.benchRuns ?? 0) < BENCH_TRIES ? benchStride(engine) : null;
    if (bench && age > 2 && !scrolling && resting(key) && resting(fill) && now - key.still > 0.5) {
      engine.benchRuns = (engine.benchRuns ?? 0) + 1;
      state.benching = true;
      engine.evaluate({ pos: key.evalPos, radius: key.radius }, fill.slots[1 - fill.shown], bench);
      state.layer?.draw(uniforms, vw, vh, roomDpr);
      return;
    }
    if (!engine.tuned && timed && age > 3 && !scrolling && resting(key) && resting(fill) && now - key.still > 1) {
      state.tuning = true;
      tuneEngine(engine, state.tuneController.signal, fill.slots[1 - fill.shown])
        .catch((error) => {
          engine.tuned = true;
          console.warn('Relight backdrop tuning failed:', error);
        })
        .finally(() => {
          state.tuning = false;
          if (state.engine === engine) {
            publish(state);
          }
        });
      state.layer?.draw(uniforms, vw, vh, roomDpr);
      return;
    }

    const view = visibleRect(state.box, vw, vh);
    state.view = view;
    const finest = refineStride(engine, budget, areaOf(grow(view, VIEW_MARGIN)));
    let dirty = false;
    const passes = [];
    if (needsWork(key, now, finest, scrolling, view)) {
      passes.push(key);
    }
    if (needsWork(fill, now, finest, scrolling, view) && (!passes.length || !fill.evalPos)) {
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
      passes.forEach((light) => {
        if (step(engine, light, now, budget / passes.length, finest, view)) {
          dirty = true;
        }
      });
      if (dirty) {
        engine.composite([shown(key, KEY.intensity * keyLevel), shown(fill, FILL.intensity * fillLevel)]);
        state.built.present(state.layer);
      }
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
    state.layer?.draw(uniforms, vw, vh, roomDpr);

    if (now - state.publishedAt > PUBLISH_EVERY) {
      state.publishedAt = now;
      publish(state);
    }
    if (!state.reported && age > REPORT_AFTER) {
      state.reported = true;
      report(state);
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

function phoneHero(state, vw, vh) {
  if (!state.hero?.isConnected) {
    state.hero = document.querySelector(HERO_SELECTOR);
  }
  if (!state.hero) {
    return [Math.min(vw * 1.12, vh * 0.6), vh * 0.44];
  }
  const bottom = state.hero.getBoundingClientRect().bottom + window.scrollY;
  const space = Math.max(bottom - NAV_CLEAR, vh * 0.4);
  return [Math.min(vw * 1.2, space), NAV_CLEAR + space / 2];
}

function publish(state) {
  const status = statusOf(state);
  if (status) {
    setRelightStatus(status);
  }
}

function report(state) {
  const status = statusOf(state);
  if (!status) {
    return;
  }
  const { frames, seconds, late } = state.quality.stats;
  reportRelight(
    {
      ...status,
      frames,
      frameRate: seconds > 0 ? Math.round(frames / seconds) : null,
      latePct: frames ? Math.round((late / frames) * 1000) / 10 : null,
      runningSec: state.readyAt === null ? null : Math.round(seconds),
    },
    state.visit
  );
}

function statusOf(state) {
  const { engine, quality } = state;
  if (!engine) {
    return null;
  }
  const round = (x) => (x === null ? null : Number(x.toFixed(1)));
  return {
    phase: 'running',
    backend: engine.backend,
    notGPU: engine.backend === 'webgpu' ? null : state.notGPU,
    half: !!engine.half,
    size: engine.W,
    network: state.network,
    kernel: engine.kernelName ? `${engine.kernelName}${engine.tuned ? '' : ', untuned'}` : null,
    gpu: state.gpu,
    fps: state.fps,
    capped: state.capped,
    dpr: quality.dpr,
    budget: round(quality.budget),
    cost: round(engine.evalCost(1)),
    seeded: engine.timing.seeded,
    moving: previewStride(engine, quality.budget, areaOf(grow(state.view, VIEW_MARGIN))),
    resting: refineStride(engine, quality.budget, areaOf(grow(state.view, VIEW_MARGIN))),
    fixedLayer: !!state.layer,
    roomDpr: state.roomDpr,
    fromProfile: state.fromProfile,
    prepared: state.prepared,
    upgrading: !!state.upgrading,
  };
}

function saveState({ engine, gpu, fps, quality }) {
  const profile = profileFor(gpu, fps, engine, quality);
  if (profile) {
    saveProfile(profile);
  }
}

async function buildEngine(data, device, bandBytes, signal, kernel) {
  return withTexture(await createRelightEngine(data, device, bandBytes, signal, kernel));
}

function withTexture({ engine, notGPU }) {
  // images come bottom row first so don't flip
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

function install(state, built, uniforms) {
  state.tuneController.abort();
  state.tuneController = new AbortController();
  state.built?.dispose();
  state.built = built;
  state.engine = built.engine;
  uniforms.tRelight.value = built.texture;
  uniforms.texSize.value.set(built.engine.W, built.engine.H);
  [state.key, state.fill].forEach((light) =>
    Object.assign(light, { evalPos: null, rect: null, shown: 0, stride: 0, refineStride: 0, refineRect: null })
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
    // rect is image uv: u0, u1, v0, v1
    evalPos: null,
    rect: null,
    shown: 0,
    stride: 0,
    still: 0,
    refineStride: 0,
    refineRect: null,
    refineRow: 0,
  };
}

function needsWork(light, now, finest, scrolling, view) {
  return (
    !light.evalPos ||
    distance(light.pos, light.evalPos) > MOVE_EPS ||
    !covers(light.rect, view) ||
    (!scrolling && light.stride > finest && now - light.still > REFINE_DELAY)
  );
}

function step(engine, light, now, budget, finest, view) {
  const moved = !light.evalPos || distance(light.pos, light.evalPos) > MOVE_EPS;
  if (moved || !covers(light.rect, view)) {
    const rect = grow(view, moved ? VIEW_MARGIN : VIEW_GROW);
    const stride = previewStride(engine, budget, areaOf(rect));
    if (moved) {
      light.evalPos = [...light.pos];
      light.still = now;
    }
    const at = { pos: light.evalPos, radius: light.radius };
    engine.evaluate(at, light.slots[light.shown], stride, ...itemRect(engine, rect, stride));
    light.rect = rect;
    light.stride = stride;
    light.refineRect = null;
    return true;
  }
  if (light.stride > finest) {
    if (light.refineStride !== finest || !light.refineRect) {
      light.refineStride = finest;
      light.refineRect = light.rect;
      light.refineRow = 0;
    }
    const [r0, r1, c0, c1] = itemRect(engine, light.refineRect, finest);
    const other = 1 - light.shown;
    const cost = engine.evalCost(finest);
    const rowCost = cost && cost * engine.share(finest, 0, 1, c0, c1);
    const rows = rowCost ? Math.floor(budget / rowCost / 4) * 4 : MIN_BAND_ROWS;
    const from = Math.max(r0, light.refineRow);
    const to = Math.min(r1, from + THREE.MathUtils.clamp(rows, MIN_BAND_ROWS, r1 - r0));
    engine.evaluate({ pos: light.evalPos, radius: light.radius }, light.slots[other], finest, from, to, c0, c1);
    light.refineRow = to;
    if (to >= r1) {
      light.shown = other;
      light.stride = finest;
      light.rect = light.refineRect;
      light.refineRect = null;
      return true;
    }
  }
  return false;
}

// ~40 frames of budget. slow gpus stop at a softer image instead of stalling for seconds
function refineStride(engine, budget, area = 1) {
  if (engine.evalCost(1) === null) {
    return 4;
  }
  return [1, 2, 4].find((s) => engine.evalCost(s) * area <= budget * REFINE_FRAMES) ?? 8;
}

function previewStride(engine, budget, area = 1) {
  if (engine.evalCost(1) === null) {
    return 4;
  }
  return [1, 2, 4, 8].find((s) => engine.evalCost(s) * area <= budget) ?? 16;
}

function visibleRect(box, vw, vh) {
  return [
    clamp01(-box.left / box.size),
    clamp01((vw - box.left) / box.size),
    clamp01(-box.top / box.size),
    clamp01((vh - box.top) / box.size),
  ];
}

function grow([u0, u1, v0, v1], m) {
  return [clamp01(u0 - m), clamp01(u1 + m), clamp01(v0 - m), clamp01(v1 + m)];
}

function covers(rect, view) {
  return !!rect && rect[0] <= view[0] && rect[1] >= view[1] && rect[2] <= view[2] && rect[3] >= view[3];
}

function areaOf([u0, u1, v0, v1]) {
  return Math.max(0, u1 - u0) * Math.max(0, v1 - v0);
}

function itemRect(engine, [u0, u1, v0, v1], stride) {
  return [
    Math.floor((v0 * engine.H) / stride),
    Math.min(engine.rows(stride), Math.floor((v1 * engine.H) / stride) + 2),
    Math.floor((u0 * engine.W) / stride),
    Math.min(engine.cols(stride), Math.floor((u1 * engine.W) / stride) + 2),
  ];
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
  // measured where it is. pulling it forward first made it flip between two edges
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

