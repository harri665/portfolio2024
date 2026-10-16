import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { visitId } from '../../utils/visit';

import {
  AdaptiveQuality,
  MIN_FPS,
  NETWORKS,
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
} from './relight/adaptiveQuality';
import {
  COMPACT_QUERY,
  NATIVE,
  bandBytesFor,
  createRelightEngine,
  loadRoom,
  benchStride,
  takePreparedRelight,
  tuneEngine,
  prepareFill,
} from './relight/prepare';
import { requestRelightDevice } from './relight/RelightGPU';
import { RESOLVED, phaseOrder } from './relight/RelightBase';
import { FILL, REST_DELAY, evaluateRows, fillMatches, fillStep, itemRect, previewStride, refinementProgress } from './relight/lightWork';
import { boundedDamp, limitMove, readyHandoff, TRUST_DISTANCE, MAX_EVAL_MOVE, HANDOFF_DISTANCE, HANDOFF_SECONDS } from './relight/lightMotion';
import { advanceCopyClock } from './relight/copyClock';
import { GPURoomLayer, ROOM_FRAGMENT, RoomLayer } from './relight/roomLayer';
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
// world units. a light that moved this far since a pixel was evaluated keeps ~37% of it,
// further and the image falls back to the coarse evaluation upsampled
const TRUST_DIST = TRUST_DISTANCE;
const BENCH_TRIES = 6;
const SCROLL_REST = 0.15;
// s between looking for where the cards are while the light rests
const TARGETS_EVERY = 0.5;
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

const MAX_DPR = { compact: 1.5, full: 2 };
const SAVE_EVERY = 5;
const PUBLISH_EVERY = 0.5;
// s, and again when the page goes
const REPORT_AFTER = 10;
// drawn at the canvas's dpr (1 on phones) it got upscaled twice and looked
// a third of its resolution on a 3x phone
const ROOM_MAX_DPR = 2;
// s between the copies three.js takes for the glass on webgpu. a copy crosses contexts and cost
// about as much as the whole frame's network at stride 8, and the glass blurs it anyway
const GLASS_EVERY = 0.05;

export default function RelightBackdrop({ onProgress, onFail, onDpr, frameInfo }) {
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

  const meshRef = useRef(null);
  const st = useRef(null);
  if (!st.current) {
    const gpu = gpuName(renderer.getContext());
    // phones held 60 but then the network only had half the time and the room looked coarse
    const fps = MIN_FPS;
    const profile = loadProfile(gpu, fps, webgl || !navigator.gpu ? 'webgl' : 'webgpu');
    const device = window.devicePixelRatio || 1;
    st.current = {
      engine: null,
      built: null,
      layer: null,
      host: null,
      gpuLayerFailed: false,
      // the glass's copy is behind the room since this time
      glassStale: false,
      glassAt: -Infinity,
      device: null,
      notGPU: null,
      publishedAt: -Infinity,
      bandBytes: bandBytesFor(compact),
      readyAt: null,
      progress: 0,
      box: { left: 0, top: 0, size: 1 },
      view: [0, 1, 0, 1],
      // image uv the last composite drew
      drawn: null,
      pointer: null,
      card: { el: null, uv: null },
      key: makeLight(INTRO_FROM, KEY, 0),
      fill: makeLight(FILL.pos, FILL, 1),
      spares: [],
      handoff: null,
      pendingJump: null,
      handoffs: 0,
      maxMotionStep: 0,
      maxMotionBlend: 0,
      targetsAt: -Infinity,
      lastLevels: null,
      panel: null,
      hero: null,
      heroCache: { vw: 0, vh: 0, size: 0, y: 0 },
      texVersion: 0,
      lastTexVersion: -1,
      uniformSig: '',
      sceneVersion: 0,
      scrollY: 0,
      scrolledAt: -Infinity,
      gpu,
      fps,
      capped: true,
      lightingUpdates: 0,
      refinementUpdates: 0,
      fillPrepared: false,
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
      configChangedAt: -Infinity,
      now: 0,
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
      sharp: { value: 1 },
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
    state.host = host;
    try {
      state.layer = new RoomLayer(host);
    } catch (error) {
      console.warn('Relight backdrop has no fixed layer:', error);
      return undefined;
    }
    return () => {
      state.layer?.dispose();
      state.layer = null;
      state.host = null;
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
      const kernel = tunedKernel(state.profile, state.network, device ? 'webgpu' : 'webgl');
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
      .then(async (built) => {
        built.engine.tuned = !!kernel;
        if (signal.aborted || !state.engine) {
          built.dispose();
          return;
        }
        seedCosts(built.engine, measuredCosts(state.engine));
        try {
          await prepareFill(built, { signal, budget: state.quality.budget, maxMs: 250 });
        } catch (error) {
          built.dispose();
          throw error;
        }
        if (signal.aborted || !state.engine) {
          built.dispose();
          return;
        }
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
    state.now = now;
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
    state.roomDpr = roomDpr;
    const coverSize = Math.max(vw, vh) * 1.04;
    const boxSize = THREE.MathUtils.lerp(heroSize, coverSize, walk);
    state.shownPx = boxSize * roomDpr;
    const centerY = THREE.MathUtils.lerp(heroY, vh * 0.5, walk);
    state.box = { left: vw / 2 - boxSize / 2, top: centerY - boxSize / 2, size: boxSize };

    uniforms.dpr.value = viewport.dpr;
    uniforms.viewport.value.set(vw, vh);
    uniforms.box.value.set(state.box.left, state.box.top, boxSize, THREE.MathUtils.lerp(0.14, 0.03, walk));
    uniforms.dim.value = THREE.MathUtils.lerp(0.72, 0.4, walk);
    uniforms.saturation.value = THREE.MathUtils.lerp(0.8, 0.55, walk);
    uniforms.hotKeep.value = THREE.MathUtils.lerp(1, 0.35, walk);
    uniforms.sharp.value = state.layer ? 0 : 1;

    updateLights(state.panel || document, size, delta);

    const { engine, quality } = state;
    const age = engine && state.readyAt !== null ? now - state.readyAt : 0;
    const dpr = quality.frame(delta, age > 1.5, !!state.upgrading || state.tuning || state.benching, frameInfo?.current);
    if (dpr !== null) {
      onDpr?.(dpr);
    }

    if (!engine) {
      uniforms.ready.value = 0;
      state.layer?.draw(uniforms, vw, vh, roomDpr);
      syncGlassScene(state, uniforms, meshRef.current);
      return;
    }
    engine.pollTiming();
    fitLayer(state);
    uniforms.sharp.value = state.layer ? 0 : 1;
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
    if (!state.upgrading && !state.tuning && age > 2 && now - state.configChangedAt > 15 && now - state.upgradeCheckedAt > 1) {
      state.upgradeCheckedAt = now;
      const requestedNetwork = switchNetwork(engine, quality.budget);
      // An allocation failure prevents retrying larger assets, but must not
      // strand a slowing device at a tier or model it can no longer sustain.
      const network = state.upgradeFailed && requestedNetwork === NETWORKS[0] ? null : requestedNetwork;
      const tier = network ? state.tier : quality.nextTier(engine, state.shownPx, now * 1000);
      if (tier && (!state.upgradeFailed || tier < state.tier || network === NETWORKS[1])) {
        startUpgrade({ tier, network: network || state.network });
      }
    }

    const { key, fill } = state;
    let aim = REST;
    const card = state.panel
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

    if (state.handoff || state.pendingJump) {
      // Keep the old evaluated image and its source position together during the swap.
      key.pos = [...key.evalPos];
    } else if (reduceMotion && (!key.evalPos || distance(aim, key.evalPos) <= MAX_EVAL_MOVE)) {
      key.pos = [...aim];
    } else {
      // Preserve damping between tiny moves, but never let the animated position run
      // farther than one trusted step ahead of the last completed evaluation.
      const from = key.evalPos || key.pos;
      key.pos = boundedDamp(key.pos, aim, reduceMotion ? 100 : state.card.uv ? 6 : 4, delta, Infinity);
      keepInRoom(engine, key.pos, key.radius);
      key.pos = limitMove(from, key.pos);
    }

    const { budget } = quality;
    const resting = (light) => light.evalPos && distance(light.pos, light.evalPos) <= MOVE_EPS && converged(light);
    if (state.tuning) {
      if (scrolling || !resting(key) || (key.evalPos && distance(aim, key.evalPos) > MOVE_EPS)) {
        state.tuneController.abort();
      }
      state.layer?.draw(uniforms, vw, vh, roomDpr);
      syncGlassScene(state, uniforms, meshRef.current);
      return;
    }
    const timed = engine.evalCost(1) !== null;

    const bench = timed && !engine.timing.pending && (engine.benchRuns ?? 0) < BENCH_TRIES ? benchStride(engine) : null;
    if (bench && age > 2 && !scrolling && resting(key) && resting(fill) && now - key.still > 0.5) {
      engine.benchRuns = (engine.benchRuns ?? 0) + 1;
      state.benching = true;
      engine.evaluate({ pos: key.evalPos, radius: key.radius }, fill.slot, bench);
      state.layer?.draw(uniforms, vw, vh, roomDpr);
      syncGlassScene(state, uniforms, meshRef.current);
      return;
    }
    if (!engine.tuned && timed && age > 3 && !scrolling && resting(key) && resting(fill) && now - key.still > 1) {
      state.tuning = true;
      tuneEngine(engine, state.tuneController.signal, fill.slot)
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
      syncGlassScene(state, uniforms, meshRef.current);
      return;
    }

    const view = visibleRect(state.box, vw, vh);
    state.view = view;
    if (state.pendingJump && distance(aim, state.pendingJump.spare.pos) > TRUST_DIST) {
      Object.assign(state.pendingJump.spare, { pos: null, evalPos: null, slot: fill.slot, ready: false, rank: Infinity });
      state.pendingJump = null;
    }
    if (state.handoff && distance(aim, state.handoff.spare.pos) > TRUST_DIST) {
      state.handoff = null;
    }
    if (!state.handoff && !state.pendingJump && key.evalPos && distance(aim, key.evalPos) > HANDOFF_DISTANCE) {
      const spare = readyHandoff(state.spares, aim, view, TRUST_DIST);
      if (spare) {
        if (reduceMotion) {
          takeSpare(key, spare);
          key.pos = [...key.evalPos];
        } else {
          state.handoff = { spare, start: now };
        }
        state.handoffs += 1;
      } else if (reduceMotion && state.spares.length) {
        // Reduced motion keeps the old image still until a complete destination image is ready.
        const target = state.spares.find((s) => !s.ready) || state.spares[state.spares.length - 1];
        Object.assign(target, {
          pos: [...aim], evalPos: null, rect: null, kept: null, stride: 0,
          phase: 0, done: 0, next: 0, still: now, refining: false,
          slot: key.slot, ready: false, rank: Infinity,
        });
        state.pendingJump = { spare: target };
        key.pos = [...key.evalPos];
      }
    }
    const handoff = state.handoff;
    const handoffMix = handoff ? clamp01((now - handoff.start) / HANDOFF_SECONDS) : 0;
    if (handoff && handoffMix >= 1) {
      takeSpare(key, handoff.spare);
      key.pos = [...key.evalPos];
      state.handoff = null;
    }
    // everything from here to endFrame goes to the gpu in one submit
    engine.beginFrame();
    // key light first and the fill gets what it leaves, but half each until the fill has an image
    let worked = false;
    const frameBudget = scrolling ? budget * 0.7 : budget;
    let left = frameBudget;
    // On a very slow backend, the first key evaluation can exceed the estimated
    // frame budget. Give the missing fill its own turn instead of starving it.
    const bootstrapFill = !fill.evalPos && !!key.evalPos;
    let keyWorked = false;
    let jumpReady = false;
    if (!bootstrapFill && state.pendingJump) {
      const target = state.pendingJump.spare;
      left -= step(engine, target, now, frameBudget, view, scrolling);
      if (converged(target)) {
        target.ready = true;
        takeSpare(key, target);
        key.pos = [...key.evalPos];
        state.pendingJump = null;
        state.handoffs += 1;
        jumpReady = true;
      }
      worked = true;
    } else if (!bootstrapFill && !state.handoff && needsWork(key, scrolling, view)) {
      adopt(key, state.spares, aim);
      const moved = key.evalPos ? distance(key.pos, key.evalPos) : null;
      if (moved !== null && moved > MOVE_EPS) {
        state.maxMotionStep = Math.max(state.maxMotionStep, moved);
        state.maxMotionBlend = Math.max(state.maxMotionBlend, 1 - Math.exp(-moved / TRUST_DIST));
      }
      left -= step(engine, key, now, fill.evalPos ? frameBudget : frameBudget / 2, view, scrolling);
      worked = true;
      keyWorked = true;
    }
    const fillWorked = needsWork(fill, scrolling, view) && fillStep(engine, fill, bootstrapFill ? frameBudget : left, !worked) > 0;
    if (fillWorked) {
      worked = true;
    }

    let dirty = keyWorked || fillWorked || jumpReady || !!handoff;
    if (worked) {
      state.lightingUpdates += 1;
      if (key.refining) state.refinementUpdates += 1;
    }
    // nothing to show changed, so get ready for where the key light goes next
    if (!worked && !handoff && !state.pendingJump && !scrolling && !state.upgrading && quality.lateRate.idle < 0.05 && (progress > 0.3 || state.card.el) && state.panel && state.spares.length) {
      precompute(state, engine, Math.min(budget * 0.5, 8), now, view, vw, vh, canHover);
    }
    const keyLevel = reduceMotion ? clamp01(age / 0.6) : strike(age);
    const fillLevel = easeOutCubic(clamp01((age - 0.2) / 1.4));
    const levels = `${keyLevel.toFixed(3)} ${fillLevel.toFixed(3)}`;
    if (levels !== state.lastLevels) {
      state.lastLevels = levels;
      dirty = true;
    }

    if (worked) {
      quality.worked();
    }
    // only the view gets drawn (a landscape screen shows ~55% of the walked-in box), so it's
    // drawn again once the view leaves that, wider while scrolling so it isn't every frame
    if (dirty || !covers(state.drawn, view)) {
      state.drawn = grow(view, dirty ? VIEW_MARGIN : VIEW_GROW);
      const keyIntensity = KEY.intensity * keyLevel;
      const lights = key.evalPos
        ? handoff && handoffMix < 1
          ? [shown(key, keyIntensity * (1 - handoffMix)), shown({ ...key, evalPos: handoff.spare.pos, image: handoff.spare.image }, keyIntensity * handoffMix)]
          : [shown(key, keyIntensity)]
        : [];
      if (fill.evalPos) lights.push(shown(fill, FILL.intensity * fillLevel));
      engine.composite(lights, 1, state.drawn);
      state.glassStale = state.built.present(state.layer, uniforms.texSize.value);
    }
    if (state.glassStale && now - state.glassAt + 1e-9 >= GLASS_EVERY) {
      state.glassStale = false;
      state.glassAt = advanceCopyClock(now, state.glassAt, GLASS_EVERY);
      state.built.copyGlass(uniforms.texSize.value);
    }

    // soft bloom, the tonemap flattens the key light otherwise
    if (key.evalPos) {
      const glowPos = state.handoff
        ? key.evalPos.map((value, i) => THREE.MathUtils.lerp(value, state.handoff.spare.pos[i], handoffMix))
        : key.evalPos;
      const p = engine.project(glowPos);
      const { left, top, size: s } = state.box;
      uniforms.glowAt.value.set(left + p.u * s, top + p.v * s, (key.radius / (p.z * 2 * engine.cam.tx)) * s);
      const glow = THREE.MathUtils.lerp(0.9, 0.45, walk) * keyLevel;
      uniforms.glowColor.value.set(KEY.color[0] * glow, KEY.color[1] * glow, KEY.color[2] * glow);
    }
    uniforms.ready.value = clamp01(age / 0.5);
    state.layer?.draw(uniforms, vw, vh, roomDpr);
    engine.endFrame();
    syncGlassScene(state, uniforms, meshRef.current);

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
    <mesh ref={meshRef} frustumCulled={false}>
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

function syncGlassScene(state, uniforms, mesh) {
  if (!mesh) {
    return;
  }
  const copies = uniforms.tRelight.value?.userData?.copies ?? 0;
  const b = uniforms.box.value;
  const g = uniforms.glowAt.value;
  const c = uniforms.glowColor.value;
  const v = uniforms.viewport.value;
  const sig = `${copies}:${uniforms.dpr.value}:${v.x}:${v.y}:${b.x.toFixed(2)}:${b.y.toFixed(2)}:${b.z.toFixed(2)}:${uniforms.ready.value.toFixed(3)}:${uniforms.sharp.value}:${g.x.toFixed(1)}:${g.y.toFixed(1)}:${g.z.toFixed(1)}:${c.x.toFixed(3)}`;
  if (sig !== state.uniformSig) {
    state.uniformSig = sig;
    state.sceneVersion += 1;
    mesh.userData.sceneVersion = state.sceneVersion;
  }
}

function phoneHero(state, vw, vh) {
  if (!state.hero?.isConnected) {
    state.hero = document.querySelector(HERO_SELECTOR);
    state.heroCache.vw = 0;
  }
  if (!state.hero) {
    return [Math.min(vw * 1.12, vh * 0.6), vh * 0.44];
  }
  const cache = state.heroCache;
  if (cache.vw !== vw || cache.vh !== vh) {
    const bottom = state.hero.getBoundingClientRect().bottom + window.scrollY;
    const space = Math.max(bottom - NAV_CLEAR, vh * 0.4);
    cache.vw = vw;
    cache.vh = vh;
    cache.size = Math.min(vw * 1.2, space);
    cache.y = NAV_CLEAR + space / 2;
  }
  return [cache.size, cache.y];
}

function publish(state) {
  const status = statusOf(state);
  if (status) {
    setRelightStatus(status);
    // Opt-in diagnostics used by the page harness; no observer is installed in production.
    if (typeof window.__relightObserve === 'function') window.__relightObserve(status);
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
    progress: round(state.progress),
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
    // every pixel gets evaluated once the light rests
    resting: 1,
    fixedLayer: !!state.layer,
    roomDpr: state.roomDpr,
    shownPx: Math.round(state.shownPx),
    refining: refinementProgress(state.key, engine),
    preparingJump: !!state.pendingJump,
    motionStep: state.key.lastMove == null ? null : Number(state.key.lastMove.toFixed(3)),
    motionBlend: state.key.lastAlpha == null ? null : Number(state.key.lastAlpha.toFixed(2)),
    maxMotionStep: Number(state.maxMotionStep.toFixed(3)),
    maxMotionBlend: Number(state.maxMotionBlend.toFixed(2)),
    handoffs: state.handoffs,
    sparesReady: state.spares.filter((spare) => spare.ready).length,
    spareCandidates: state.spares.filter((spare) => spare.rank < Infinity).length,
    converged: converged(state.key) && converged(state.fill),
    fillPrepared: state.fillPrepared,
    lightingUpdates: state.lightingUpdates,
    refinementUpdates: state.refinementUpdates,
    sceneUpdates: quality.stats.frames,
    measuredSeconds: quality.stats.seconds,
    missedFrames: quality.stats.late,
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

// on webgpu the room layer draws on the engine's device straight from its image, so nothing
// crosses contexts. the webgl engine still hands over an ImageBitmap
function fitLayer(state) {
  const { engine, layer, host } = state;
  if (!layer || !host) {
    return;
  }
  const gpu = engine.backend === 'webgpu' && !state.gpuLayerFailed;
  if (gpu && layer.device === engine.device) {
    layer.use(engine);
    return;
  }
  if (!gpu && !layer.device) {
    return;
  }
  let next;
  try {
    next = gpu ? new GPURoomLayer(host, engine) : new RoomLayer(host);
  } catch (error) {
    console.warn('Relight backdrop keeps its room layer:', error);
    state.gpuLayerFailed = true;
    return;
  }
  // swapped in the frame it draws, so there's no frame without a room
  layer.dispose();
  state.layer = next;
}

function withTexture({ engine, notGPU, fill }) {
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
  const take = (image, texSize) => {
    const previous = texture.image;
    texture.image = image;
    texture.needsUpdate = true;
    texture.userData.copies = (texture.userData.copies || 0) + 1;
    texSize.set(image.width, image.height);
    if (previous !== image) {
      release(previous);
    }
  };
  return {
    engine,
    notGPU,
    fill,
    texture,
    // true if the three.js copy still needs taking (copyGlass), the webgpu layer draws from the
    // engine's own image
    present: (layer, texSize) => {
      if (layer?.device && layer.device === engine.device) {
        layer.setImage();
        return true;
      }
      const image = engine.snapshot();
      if (!layer) {
        take(image, texSize);
        return false;
      }
      layer.setImage(image);
      if (!engine.halfImage) {
        // WebGL has no separate half-size copy. Reuse this snapshot for the glass too.
        take(image, texSize);
        return false;
      }
      release(image);
      return true;
    },
    // the three.js copy only shows through the glass, blurred, so half size and at a lower rate
    copyGlass: (texSize) => engine.halfImage((image) => take(image, texSize)),
    dispose: () => {
      release(texture.image);
      engine.dispose();
      texture.dispose();
    },
  };
}

function install(state, built, uniforms) {
  if (state.engine) state.configChangedAt = state.now;
  state.tuneController.abort();
  state.tuneController = new AbortController();
  state.built?.dispose();
  state.built = built;
  state.engine = built.engine;
  uniforms.tRelight.value = built.texture;
  uniforms.texSize.value.set(built.engine.W, built.engine.H);
  [state.key, state.fill].forEach((light, i) =>
    Object.assign(light, { image: i, evalPos: null, rect: null, kept: null, stride: 0, phase: 0, done: 0, next: 0, refining: false, lastMove: null, lastAlpha: null })
  );
  if (fillMatches(built.fill, built.engine)) {
    const preparedFill = { ...built.fill };
    delete preparedFill.engine;
    Object.assign(state.fill, preparedFill);
  }
  state.fillPrepared = fillMatches(built.fill, built.engine) && !!built.fill.evalPos;
  // the rest of the engine's images, evaluated ahead at where the key light might go. the fill is
  // done by then so they borrow its slot
  state.spares = Array.from({ length: (built.engine.images ?? RESOLVED) - RESOLVED }, (_, i) => ({
    image: RESOLVED + i,
    slot: state.fill.slot,
    radius: KEY.radius,
    pos: null,
    rect: null,
    kept: null,
    next: 0,
    ready: false,
    rank: Infinity,
  }));
  state.targetsAt = -Infinity;
  state.handoff = null;
  state.pendingJump = null;
  state.lastLevels = null;
  state.glassStale = false;
  state.drawn = null;
}

// slot is where the network writes, image the light's full res image the evaluations build up
function makeLight(pos, { radius, color, hidden = false, fixed = false }, index) {
  return {
    pos: [...pos],
    radius,
    color,
    hidden,
    fixed,
    slot: index,
    image: index,
    evalPos: null,
    // image uv the evaluations cover: u0, u1, v0, v1
    rect: null,
    // pixels the image holds from earlier evaluations: x0, x1, y0, y1
    kept: null,
    stride: 0,
    phase: 0,
    // evaluations at this stride since the light last moved
    done: 0,
    // first row a fixed light hasn't evaluated at every pixel yet
    next: 0,
    still: 0,
  };
}

function converged(light) {
  return light.stride > 0 && light.done >= light.stride ** 2;
}

function needsWork(light, scrolling, view) {
  if (light.fixed) {
    return !light.evalPos || !converged(light);
  }
  return (
    !light.evalPos ||
    distance(light.pos, light.evalPos) > MOVE_EPS ||
    !covers(light.rect, view) ||
    (!scrolling && !converged(light))
  );
}

// each evaluation takes every stride-th pixel from a different place in the stride x stride block
// and folds it into the light's image. at rest that's every pixel after stride^2 of them, moving
// it keeps pixels evaluated while the light was close to where it is now
function step(engine, light, now, budget, view, scrolling = false) {
  const moved = light.evalPos ? distance(light.pos, light.evalPos) : Infinity;
  const fresh = moved > MOVE_EPS;
  const rect = fresh || !covers(light.rect, view) ? grow(view, fresh ? VIEW_MARGIN : VIEW_GROW) : light.rect;
  if (fresh || !sameRect(rect, light.rect)) {
    light.refining = false;
    light.next = 0;
  }
  // A quiet light finishes actual source pixels, in bands, rather than waiting up to
  // 256 display updates for a stride-16 phase cycle. Budget changes never reset this job.
  if (!fresh && now - light.still >= REST_DELAY && engine.evalCost(1) !== null) {
    light.refining = true;
    light.rect = rect;
    const spent = evaluateRows(engine, light, rect, budget, 1);
    light.stride = 1;
    light.done = light.next >= itemRect(engine, rect, 1)[1] ? 1 : 0;
    return spent;
  }
  const stride = previewStride(engine, budget, areaOf(rect));
  // newly covered pixels and a new stride need a whole cycle again
  if (fresh || stride !== light.stride || !sameRect(rect, light.rect)) {
    light.done = 0;
  }
  light.stride = stride;
  let alpha = 0;
  if (fresh) {
    alpha = Number.isFinite(moved) ? 1 - Math.exp(-moved / TRUST_DIST) : 1;
    light.lastMove = Number.isFinite(moved) ? moved : null;
    light.lastAlpha = alpha;
    light.evalPos = [...light.pos];
    light.still = now;
  }
  const cost = engine.evalCost(stride);
  const each = cost === null ? budget : cost * areaOf(rect);
  // strides are 4x apart in cost so one evaluation can leave up to 3/4 of the budget. the rest
  // goes on more phases, never more than the cycle has left
  // Each phase also resolves the full covered area; do not fill spare budget with
  // dozens of unmeasured resolves when inference happens to be cheap.
  const maxPhases = fresh || scrolling ? 1 : 2;
  const phases = Math.max(1, Math.min(maxPhases, Math.floor(budget / Math.max(each, 0.001)), stride ** 2 - light.done));
  const order = phaseOrder(stride);
  const items = itemRect(engine, rect, stride);
  for (let i = 0; i < phases; i += 1) {
    const phase = order[light.phase % order.length];
    light.phase += 1;
    light.done += 1;
    engine.evaluate({ pos: light.evalPos, radius: light.radius }, light.slot, stride, ...items, phase);
    // the light only moved before the first, the rest are where it is now
    light.kept = engine.resolve(light.slot, light.image, stride, phase, items, i ? 0 : alpha, light.kept);
  }
  light.rect = rect;
  return each * phases;
}

// a light that comes within one trusted movement step of an image evaluated ahead starts from
// that instead of what it brought from further away. only where it's going, or a light resting
// next to one would trade its own image for it on the first nudge. swapped, so nothing's copied
function adopt(light, spares, aim) {
  if (light.evalPos && distance(light.pos, light.evalPos) <= MOVE_EPS) {
    return;
  }
  let best = null;
  spares.forEach((spare) => {
    const d = spare.ready && distance(aim, spare.pos) <= TRUST_DIST ? distance(light.pos, spare.pos) : Infinity;
    if (d <= MAX_EVAL_MOVE && (!best || d < distance(light.pos, best.pos))) {
      best = spare;
    }
  });
  if (!best) {
    return;
  }
  takeSpare(light, best);
}

function takeSpare(light, best) {
  [light.image, best.image] = [best.image, light.image];
  Object.assign(light, {
    evalPos: best.pos,
    rect: best.rect,
    kept: best.kept,
    stride: 1,
    phase: 0,
    done: 1,
    next: best.next,
    refining: false,
  });
  Object.assign(best, { pos: null, evalPos: null, rect: null, kept: null, stride: 0, phase: 0, done: 0, next: 0, slot: 1, ready: false, rank: Infinity });
}

// only on frames nothing else needs, a band of rows at a time into the likeliest spare not done yet
function precompute(state, engine, budget, now, view, vw, vh, canHover) {
  if (engine.evalCost(1) === null) {
    return 0;
  }
  if (now - state.targetsAt > TARGETS_EVERY) {
    state.targetsAt = now;
    aimSpares(state.spares, likelyTargets(state, engine, vw, vh, canHover), grow(view, VIEW_MARGIN));
  }
  const spare = state.spares.find((s) => s.rank < Infinity && !s.ready);
  if (!spare) {
    return 0;
  }
  const spent = evaluateRows(engine, spare, spare.rect, budget, 1);
  spare.ready = spare.next >= itemRect(engine, spare.rect, 1)[1];
  return spent;
}

// keeps spares already at a target, gives the rest to new ones, likeliest first
function aimSpares(spares, targets, rect) {
  const at = (spare, pos) => !!spare.pos && distance(spare.pos, pos) <= MOVE_EPS;
  const wanted = targets.slice(0, spares.length);
  const free = spares.filter((s) => !wanted.some((pos) => at(s, pos)));
  spares.forEach((s) => {
    s.rank = Infinity;
  });
  wanted.forEach((pos, rank) => {
    const spare = spares.find((s) => s.rank === Infinity && at(s, pos)) || free.shift();
    if (!spare) {
      return;
    }
    if (!at(spare, pos)) {
      Object.assign(spare, { pos, rect, kept: null, next: 0, ready: false });
    }
    spare.rank = rank;
  });
  spares.sort((a, b) => a.rank - b.rank);
}

// where the key light would end up for the cards it could go to next, likeliest first
function likelyTargets(state, engine, vw, vh, canHover) {
  const { left, top, size } = state.box;
  const cards = [...state.panel.querySelectorAll(CARD_SELECTOR)].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });
  let picks = [];
  if (canHover) {
    // whichever the pointer's nearest gets hovered next
    const [px, py] = state.pointer ? [left + state.pointer[0] * size, top + state.pointer[1] * size] : [vw / 2, vh / 2];
    picks = cards
      .filter((c) => c.x > 0 && c.x < vw && c.y > 0 && c.y < vh)
      .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
  } else {
    // touch focuses the card nearest the middle (the first of a row), and the light goes where it
    // was the moment it took over: halfway between it and the card before it at the middle.
    // so that's the same place whatever the scroll
    const rows = cards.filter((c, i) => !cards.slice(0, i).some((d) => Math.abs(d.y - c.y) < 1));
    const at = rows.findIndex((c) => c.el === state.card.el);
    for (let k = 1; at >= 0 && k < rows.length; k += 1) {
      [at + k, at - k].forEach((i) => {
        const before = rows[i + (i > at ? -1 : 1)];
        if (rows[i]) {
          picks.push({ x: rows[i].x, y: rows[i].y + vh / 2 - (rows[i].y + before.y) / 2 });
        }
      });
    }
  }
  return picks
    .map(({ x, y }) => {
      const pos = [...atDepth(engine, [(x - left) / size, (y - top) / size], CARD_DEPTH)];
      keepInRoom(engine, pos, KEY.radius);
      return pos;
    })
    .filter((pos) => !state.key.evalPos || distance(pos, state.key.evalPos) > TRUST_DIST);
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

function sameRect(a, b) {
  return !!a && !!b && a.every((v, i) => v === b[i]);
}

function areaOf([u0, u1, v0, v1]) {
  return Math.max(0, u1 - u0) * Math.max(0, v1 - v0);
}

function shown(light, intensity) {
  return {
    pos: light.evalPos,
    radius: light.radius,
    color: light.color,
    intensity,
    resolved: light.image,
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

