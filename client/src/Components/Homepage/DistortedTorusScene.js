import { Canvas, useFrame } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import LiquidGlassPass from './LiquidGlassPass';

// type: 'torusKnot',
// args: [1, 0.4, 512, 64, 2, 3],

const SCENE_PRESETS = {
  art: {
    shape: {
      type: 'torusKnot',
      args: [0.5, 0.3, 512, 32, 2],
      baseRotation: [0.2, 0, 0],
      tiltSpeed: 0.28,
      tiltAmplitude: 0.06,
    },
    ambientLightIntensity: 100,
    spotLight: { position: [5, 5, 5], color: '#ff8e8e', intensity: 1 },
    pointLights: [
      { position: [-10, 5, -5], intensity: 10000, color: '#ff00ff' },
      { position: [10, -5, 5], intensity: 10000, color: '#00ffff' },
    ],
    distortionFactor: 0.2,
    rotationWaveSpeed: 0.5,
    rotationWaveAmplitude: 0.2,
    spinSpeed: 0.02,
    mobileScale: 0.7,
    desktopScale: 1.2,
  },
  cs: {
    shape: {
      // type: 'cone',
      // args: [.2, .4, 128, 64],
      type: 'ring',
      args: [0.3, .3, 128, 64],  
      baseRotation: [0.2, 0, 0],
      tiltSpeed: 0.28,
      tiltAmplitude: 0.06,
    },
    ambientLightIntensity: 100,
    spotLight: { position: [5, 5, 5], color: '#ff8e8e', intensity: 1 },
    pointLights: [
      { position: [-10, 5, -5], intensity: 10000, color: '#ff00ff' },
      { position: [10, -5, 5], intensity: 10000, color: '#00ffff' },
    ],
    distortionFactor: 0.2,
    rotationWaveSpeed: 0.5,
    rotationWaveAmplitude: 0.2,
    spinSpeed: 0.02,
    mobileScale: 0.7,
    desktopScale: 1.2,
  },
  hub: {
    shape: {
      type: 'box',
      args: [0.5, 0.3, 10, 32, 2],
      baseRotation: [0.2, 0, 0],
      tiltSpeed: 0.28,
      tiltAmplitude: 0.06,
    },
    ambientLightIntensity: 100,
    spotLight: { position: [5, 5, 5], color: '#ff8e8e', intensity: 1 },
    pointLights: [
      { position: [-10, 5, -5], intensity: 10000, color: '#ff00ff' },
      { position: [10, -5, 5], intensity: 10000, color: '#00ffff' },
    ],
    distortionFactor: 0.2,
    rotationWaveSpeed: 0.5,
    rotationWaveAmplitude: 0.2,
    spinSpeed: 0.02,
    mobileScale: 0.7,
    desktopScale: 1.2,
  },
};

// Each site looks at the same prism through its own lens: the shader pulls
// the spectrum toward two colours. The hub leaves it unfiltered.
const LENSES = {
  cs: { a: [0.2, 0.62, 1.0], b: [0.52, 0.4, 1.0], strength: 0.72 },
  art: { a: [1.0, 0.36, 0.44], b: [1.0, 0.68, 0.3], strength: 0.72 },
};

export default function DistortedTorusScene({
  className = 'h-screen w-full relative',
  variant = 'art',
  cameraPosition = [0, 0, 5],
  lens = null,
  unfold = false,
  onUnfold,
  glassSelector,
}) {
  const preset = SCENE_PRESETS[variant] || SCENE_PRESETS.art;

  return (
    <div className={className}>
      <Canvas
        camera={{ position: cameraPosition, fov: 60 }}
        dpr={[1, 1.5]}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={preset.ambientLightIntensity} color="#ffffff" />
        <spotLight
          position={preset.spotLight.position}
          angle={0.2}
          penumbra={1}
          intensity={preset.spotLight.intensity}
          color={preset.spotLight.color}
          castShadow
        />
        {preset.pointLights.map((light) => (
          <pointLight
            key={`${light.position.join('-')}-${light.color}`}
            position={light.position}
            intensity={light.intensity}
            color={light.color}
          />
        ))}

        <DistortedTorus
          preset={preset}
          lens={LENSES[lens]}
          unfold={unfold}
          onUnfold={onUnfold}
        />

        {glassSelector && <LiquidGlassPass selector={glassSelector} />}
      </Canvas>
    </div>
  );
}

// With `unfold` on, scrolling toward the gallery unrolls the knot into a solid
// rounded panel behind it, in three beats: the knot quickly unrolls sideways
// into a wide band in the open space just above the gallery, a wave runs
// across the band, then the band stretches down to cover the gallery. The gallery marks itself with this
// attribute; the panel covers its box plus a margin and scrolls with it.
const PANEL_SELECTOR = '[data-prism-panel]';
// The unfold starts this far down the page and finishes once the gallery's
// top edge has risen to UNFOLD_END_TOP (both in viewport heights)
const UNFOLD_START = 0.03;
const UNFOLD_END_TOP = 0.14;
// Where each beat ends, as a share of the unfold's scroll range
const UNROLL_END = 0.35;
const WAVE_END = 0.65;

const NON_KNOT_SHAPES = new Set(['box', 'icosahedron', 'torus', 'sphere']);

function DistortedTorus({ preset, lens, unfold, onUnfold }) {
  const meshRef = useRef();
  const panelElement = useRef(null);
  const unfoldEased = useRef(0);

  const shape = preset.shape || SCENE_PRESETS.art.shape;
  const isKnot = !NON_KNOT_SHAPES.has(shape.type);
  const knotGeometry = useMemo(
    () => (isKnot ? createUnrollableKnot(...shape.args) : null),
    [isKnot, shape.args]
  );
  useEffect(() => () => knotGeometry?.dispose(), [knotGeometry]);

  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const isMobile = windowWidth <= 768;
  const scale = isMobile ? preset.mobileScale : preset.desktopScale;
  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      distortionFactor: { value: preset.distortionFactor },
      introOpacity: { value: 0 },
      introGlow: { value: 1 },
      resolution: {
        value: new THREE.Vector2(
          typeof window !== 'undefined' ? window.innerWidth : 1920,
          typeof window !== 'undefined' ? window.innerHeight : 1080
        ),
      },
      colorTransition: { value: 0.5 },
      tintA: { value: new THREE.Vector3(...(lens?.a || [1, 1, 1])) },
      tintB: { value: new THREE.Vector3(...(lens?.b || [1, 1, 1])) },
      lensStrength: { value: lens?.strength || 0 },
      unfold: { value: 0 },
      wave: { value: 0 },
      tube: { value: shape.args?.[1] ?? 0.4 },
      panelCenter: { value: new THREE.Vector2(0, 0) },
      panelSize: { value: new THREE.Vector2(1, 1) },
      panelRadius: { value: 0.1 },
      worldPerPx: { value: 0.01 },
    }),
    [preset.distortionFactor, lens, shape.args]
  );

  useFrame(({ clock, size, camera }, delta) => {
    if (!meshRef.current) {
      return;
    }

    const elapsedTime = clock.getElapsedTime();
    const baseRotation = preset.shape?.baseRotation || [0, 0, 0];
    const tiltSpeed = preset.shape?.tiltSpeed ?? 0.3;
    const tiltAmplitude = preset.shape?.tiltAmplitude ?? 0.04;
    const introDuration = preset.introDuration ?? 1.8;
    const introDelay = preset.introDelay ?? 0.05;
    const introStartScale = preset.introStartScale ?? 0;
    const introStartZ = preset.introStartZ ?? -2.2;
    const introStartY = preset.introStartY ?? 0.35;
    const introSpinBoost = preset.introSpinBoost ?? 1.3;

    const introTime = clamp01((elapsedTime - introDelay) / introDuration);
    const introEase = easeOutCubic(introTime);
    const introScaleEase = easeOutBack(introTime);
    const introFadeEase = easeInOutCubic(introTime);

    const rotationAngle =
      Math.sin(elapsedTime * preset.rotationWaveSpeed) * preset.rotationWaveAmplitude;
    const introSpin = (1 - introEase) * (1 - introEase) * introSpinBoost;
    const introScaleMultiplier = THREE.MathUtils.lerp(
      introStartScale,
      1,
      introScaleEase
    );

    meshRef.current.position.y =
      THREE.MathUtils.lerp(introStartY, 0, introEase) +
      Math.sin(elapsedTime * 1.2) * 0.02 * introFadeEase;
    meshRef.current.position.z = THREE.MathUtils.lerp(introStartZ, 0, introEase);

    meshRef.current.rotation.x =
      baseRotation[0] + Math.sin(elapsedTime * tiltSpeed) * tiltAmplitude;
    meshRef.current.rotation.y = baseRotation[1] + rotationAngle + introSpin;
    meshRef.current.rotation.z =
      baseRotation[2] + elapsedTime * preset.spinSpeed + (1 - introEase) * 0.4;

    meshRef.current.scale.setScalar(scale * introScaleMultiplier);

    if (unfold && knotGeometry) {
      updatePanel(size, camera, delta);
    }

    uniforms.distortionFactor.value = THREE.MathUtils.lerp(
      preset.distortionFactor * 2.25,
      preset.distortionFactor,
      introEase
    );
    uniforms.introOpacity.value = introFadeEase;
    uniforms.introGlow.value = 1 - introEase;
    uniforms.time.value = elapsedTime;
  });

  // Tracks the gallery's box in world units and eases the unfold toward the
  // scroll position. The canvas is fixed full-viewport, so canvas pixels are
  // viewport pixels.
  function updatePanel(size, camera, delta) {
    if (!panelElement.current?.isConnected) {
      panelElement.current = document.querySelector(PANEL_SELECTOR);
    }
    const el = panelElement.current;

    if (!el) {
      return;
    }

    const rect = el.getBoundingClientRect();
    const vw = size.width;
    const vh = Math.max(size.height, 1);

    const start = UNFOLD_START * vh;
    const end = Math.max(rect.top + window.scrollY - UNFOLD_END_TOP * vh, start + 0.2 * vh);
    const target = clamp01((window.scrollY - start) / (end - start));

    const previous = unfoldEased.current;
    let progress = THREE.MathUtils.damp(previous, target, 5, delta);
    if (Math.abs(progress - target) < 0.0005) {
      progress = target;
    }
    unfoldEased.current = progress;
    if (onUnfold && progress !== previous) {
      onUnfold(progress);
    }

    // The band sits just above the gallery; stretching moves its top edge to
    // the panel's top and its bottom edge down to the panel's bottom
    const pad = vw < 640 ? 10 : 24;
    const bandHeight = Math.min(300, vh * 0.3);
    const bandBottom = rect.top - (vw < 640 ? 12 : 20);
    const stretch = easeInOutCubic(clamp01((progress - WAVE_END) / (1 - WAVE_END)));
    const top = THREE.MathUtils.lerp(bandBottom - bandHeight, rect.top - pad, stretch);
    const bottom = THREE.MathUtils.lerp(bandBottom, rect.bottom + pad, stretch);

    const visibleHeight =
      2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const worldPerPx = visibleHeight / vh;
    uniforms.panelSize.value.set((rect.width + pad * 2) * worldPerPx, (bottom - top) * worldPerPx);
    uniforms.panelCenter.value.set(
      (rect.left + rect.width / 2 - vw / 2) * worldPerPx,
      -((top + bottom) / 2 - vh / 2) * worldPerPx
    );
    uniforms.panelRadius.value = (vw < 640 ? 20 : 28) * worldPerPx;
    uniforms.worldPerPx.value = worldPerPx;
    uniforms.unfold.value = clamp01(progress / UNROLL_END);
    uniforms.wave.value = clamp01((progress - UNROLL_END) / (WAVE_END - UNROLL_END));
  }

  return (
    // Unrolled vertices leave the knot's bounding sphere, so skip culling
    <mesh
      ref={meshRef}
      scale={scale}
      frustumCulled={false}
      geometry={knotGeometry || undefined}
    >
      {!knotGeometry && <ShapeGeometry type={shape.type} args={shape.args} />}
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
        transparent
      />
    </mesh>
  );
}

function ShapeGeometry({ type, args }) {
  switch (type) {
    case 'box':
      return <boxGeometry args={args} />;
    case 'icosahedron':
      return <icosahedronGeometry args={args} />;
    case 'torus':
      return <torusGeometry args={args} />;
    case 'sphere':
      return <sphereGeometry args={args} />;
    case 'torusKnot':
    default:
      return <torusKnotGeometry args={args} />;
  }
}

// A standard TorusKnotGeometry plus, per vertex, the point on the knot's
// centreline it hangs off (aCenter) and that point's frame (aN, aB). The
// shader needs those to straighten the centreline and uncurl the tube.
// The curve and frames mirror three.js's own TorusKnotGeometry so the
// vertices line up one-to-one.
function createUnrollableKnot(
  radius = 1,
  tube = 0.4,
  tubularSegments = 64,
  radialSegments = 8,
  p = 2,
  q = 3
) {
  const geometry = new THREE.TorusKnotGeometry(
    radius,
    tube,
    tubularSegments,
    radialSegments,
    p,
    q
  );
  const count = (tubularSegments + 1) * (radialSegments + 1);
  const centers = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const binormals = new Float32Array(count * 3);

  const P1 = new THREE.Vector3();
  const P2 = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i += 1) {
    const u = (i / tubularSegments) * p * Math.PI * 2;
    knotCurvePoint(u, p, q, radius, P1);
    knotCurvePoint(u + 0.01, p, q, radius, P2);
    T.subVectors(P2, P1);
    N.addVectors(P2, P1);
    B.crossVectors(T, N);
    N.crossVectors(B, T);
    B.normalize();
    N.normalize();

    for (let j = 0; j <= radialSegments; j += 1) {
      const k = (i * (radialSegments + 1) + j) * 3;
      P1.toArray(centers, k);
      N.toArray(normals, k);
      B.toArray(binormals, k);
    }
  }

  geometry.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
  geometry.setAttribute('aN', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aB', new THREE.BufferAttribute(binormals, 3));
  return geometry;
}

function knotCurvePoint(u, p, q, radius, target) {
  const quOverP = (q / p) * u;
  const cs = Math.cos(quOverP);
  target.x = radius * (2 + cs) * 0.5 * Math.cos(u);
  target.y = radius * (2 + cs) * Math.sin(u) * 0.5;
  target.z = radius * Math.sin(quOverP) * 0.5;
  return target;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const vertexShader = `
  attribute vec3 aCenter;
  attribute vec3 aN;
  attribute vec3 aB;

  varying vec2 vUv;
  varying float vUnfold;
  varying float vUnroll;

  uniform float time;
  uniform float distortionFactor;
  uniform float unfold;
  uniform float wave;
  uniform float worldPerPx;
  uniform float tube;
  uniform vec2 panelCenter;
  uniform vec2 panelSize;

  void main() {
    vUv = uv;
    vec3 transformed = position;

    transformed.x += sin(transformed.y * 10.0 + time) * distortionFactor;
    transformed.y += cos(transformed.x * 10.0 + time) * distortionFactor;

    // How far this vertex is through the unroll. The end of the knot nearest
    // uv.x = 0 goes first, so the ribbon streams out one end at a time.
    float local = clamp((unfold - uv.x * 0.35) / 0.65, 0.0, 1.0);
    vUnroll = local;
    vUnfold = smoothstep(0.45, 1.0, local);

    if (local <= 0.0) {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      return;
    }

    // 1. straighten: the centreline slides onto a line across the panel
    // 2. uncurl: the tube splits along its seam and its cross-section opens flat
    // 3. widen: the flat strip spreads out to the panel's full width
    float straighten = smoothstep(0.0, 0.55, local);
    float uncurl = smoothstep(0.25, 0.75, local);
    float widen = smoothstep(0.5, 1.0, local);

    mat3 model = mat3(modelMatrix);
    float r = tube * length(model[0]);
    vec3 center = (modelMatrix * vec4(aCenter, 1.0)).xyz;
    vec3 frameN = normalize(model * aN);
    vec3 frameB = normalize(model * aB);

    // Along the knot maps to the panel's width, around the tube to its height
    vec3 lineCenter = vec3(panelCenter.x + (uv.x - 0.5) * panelSize.x, panelCenter.y, 0.0);
    vec3 spine = mix(center, lineCenter, straighten);
    // lift toward the camera while in flight so the ribbon passes over itself
    spine.z += sin(straighten * 3.14159) * 0.6;

    // Flat, the tube's N faces the camera and the seam runs across the panel
    vec3 n = normalize(mix(frameN, vec3(0.0, 0.0, 1.0), straighten) + vec3(1e-4, 2e-4, 3e-4));
    vec3 b = normalize(mix(frameB, vec3(0.0, -1.0, 0.0), straighten) + vec3(3e-4, 1e-4, 2e-4));

    // Uncurl the cross-section: an arc of fixed length whose curvature eases
    // from 1/r (the closed tube) to 0 (flat), measured from the point opposite
    // the seam
    float width = mix(6.2831853 * r, panelSize.y, widen);
    float arcPos = (uv.y - 0.5) * width;
    float curvature = (1.0 - uncurl) / max(r, 1e-4);
    vec3 arc;
    if (curvature < 1e-3) {
      arc = -b * arcPos;
    } else {
      float angle = curvature * arcPos;
      arc = -b * (sin(angle) / curvature) - n * ((1.0 - cos(angle)) / curvature);
    }
    vec3 worldPosition = spine + n * (r * (1.0 - uncurl)) + arc;

    // the shader's wobble fades out as the knot lets go of its shape
    worldPosition += model * (transformed - position) * (1.0 - straighten);

    // Once flat, the panel keeps a slow squiggle like the knot's: mostly down
    // its sides, a little along its top and bottom. Measured in the panel's
    // own coordinates so the ripples travel with it as the page scrolls.
    float flatness = smoothstep(0.6, 1.0, local);
    vec2 panelPos = (uv - 0.5) * panelSize;
    float ripple = 6.2831853 / (420.0 * worldPerPx);
    float squiggle = 5.0 * worldPerPx * flatness;
    worldPosition.x += sin(panelPos.y * ripple + time * 0.9) * squiggle;
    worldPosition.y += cos(panelPos.x * ripple * 0.8 + time * 0.9) * squiggle * 0.6;

    // The wave beat: a short ripple travels across the band from left to right
    float front = uv.x - (wave * 1.5 - 0.25);
    float envelope = exp(-front * front / 0.018) * sin(wave * 3.14159);
    worldPosition.y += sin(front * 6.2831853 * 2.5) * envelope * 28.0 * worldPerPx;
    worldPosition.z += envelope * 0.25;

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying float vUnfold;
  varying float vUnroll;
  uniform float time;
  uniform vec2 resolution;
  uniform float colorTransition;
  uniform float introOpacity;
  uniform float introGlow;
  uniform vec3 tintA;
  uniform vec3 tintB;
  uniform float lensStrength;
  uniform vec2 panelSize;
  uniform float panelRadius;
  uniform float worldPerPx;

  float fresnel(vec3 viewDirection, vec3 normal) {
    return pow(1.0 - dot(viewDirection, normal), 3.0);
  }

  void main() {
    // The closed knot only ever showed its outside; once it opens, the inside
    // shows too
    if (!gl_FrontFacing && vUnroll <= 0.0) discard;

    vec3 normal = normalize(vec3(vUv, 1.0));
    vec3 viewDirection = normalize(vec3(0.0, 0.0, 1.0));

    float r = 0.5 + 0.5 * sin(vUv.x * 2.0 + time * 0.5);
    float g = 0.5 + 0.5 * cos(vUv.y * 2.0 + time * 0.5);
    float b = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 4.0 - time * 0.5);
    vec3 baseColor = vec3(r, g, b);

    float lum = dot(baseColor, vec3(0.333));
    vec3 lensColor = mix(tintA, tintB, smoothstep(0.2, 0.8, 0.5 * (r + b)));
    baseColor = mix(baseColor, lensColor * (0.55 + lum * 0.8), lensStrength);

    float fresnelFactor = fresnel(viewDirection, normal);
    vec3 fresnelColor = vec3(0.9, 0.9, 1.0) * fresnelFactor;

    vec3 finalColor = mix(baseColor, fresnelColor, fresnelFactor * 0.6);

    vec3 refractedColor = mix(finalColor, vec3(1.0), fresnelFactor);

    float alpha = (0.7 + fresnelFactor * 0.4) * (0.2 + 0.8 * introOpacity);
    vec3 reflectionColor = vec3(0.8, 0.9, 1.0);
    vec3 entryGlow = vec3(0.65, 0.85, 1.0) * introGlow * (0.5 + fresnelFactor);
    vec3 finalLitColor = mix(refractedColor, reflectionColor, fresnelFactor) + entryGlow;

    // the inside of the tube, seen while it uncurls, sits in shadow
    if (!gl_FrontFacing) finalLitColor *= 0.55;

    // Flat, the surface is a solid panel: rounded corners, a hairline rim like
    // the glass cards, and dimmed so the gallery reads on top of it
    vec2 p = (vUv - 0.5) * panelSize;
    vec2 q = abs(p) - panelSize * 0.5 + panelRadius;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - panelRadius;
    float mask = 1.0 - smoothstep(-worldPerPx, worldPerPx, d);
    float rim = 1.0 - smoothstep(0.0, worldPerPx * 1.5, abs(d + worldPerPx * 1.5));
    float grain = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    vec3 panelColor = baseColor * 0.38 + vec3(rim * 0.22) + grain;

    finalLitColor = mix(finalLitColor, panelColor, vUnfold);
    alpha = mix(alpha, mask * (0.2 + 0.8 * introOpacity), vUnfold);

    gl_FragColor = vec4(finalLitColor, alpha);
  }
`;
