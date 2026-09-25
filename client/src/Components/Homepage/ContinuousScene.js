import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { motion } from 'framer-motion';
import * as THREE from 'three';

// ─── Continuous 3D scene ─────────────────────────────────────────────────────
// A fixed, full-screen, pointer-events-none canvas that sits behind page
// content. One persistent object is driven by scroll: keyframes are placed in
// viewport-height units (`at: 1` = scrolled one screen down) and every
// property — position, scale, rotation, distortion, colors, opacity — is
// interpolated smoothly between them, so the object travels continuously as
// the visitor moves through the page instead of cutting between sections.
//
// The canvas never intercepts clicks and dims out of the way of content, so
// the portfolio itself stays fully usable on top of it.
//
// Two optional hooks tie the object into the page instead of leaving it as
// wallpaper:
//  - `anchorRef`: a DOM element (e.g. a sticky rail slot next to the grid).
//    As the visitor scrolls out of the hero the object glides into that slot
//    and stays there at full opacity — it occupies real layout space, so it
//    never sits behind content. Ignored on mobile, where there is no rail.
//  - `controlsRef`: mutable { tintA, tintB, excite, textureUrl } the page can
//    set from project-card hover handlers; the object smoothly adopts the
//    project's accent colors and spins up while hovered. When `textureUrl`
//    is set, the project's thumbnail is loaded and flows onto the object's
//    surface like liquid — the object becomes a living preview of the work.
//    Textures are cached per URL; failed loads (CORS, 404) fall back to the
//    tint-only look without retry spam.

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function ContinuousShape({
  keyframes,
  shapeArgs,
  scrollRef,
  pointerRef,
  anchorRef,
  controlsRef,
  reducedMotion,
}) {
  const meshRef = useRef();
  const smoothed = useRef({ progress: 0, px: 0, py: 0, excite: 0, tint: 0, map: 0 });
  const tintColors = useRef({ a: new THREE.Color('#ffffff'), b: new THREE.Color('#ffffff') });
  // Thumbnail-preview textures: `cache` maps url → THREE.Texture (loaded),
  // null (loading) or false (failed — never retried).
  const textureState = useRef({ url: null, cache: new Map() });

  const placeholderTexture = useMemo(() => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    return tex;
  }, []);

  const keyColors = useMemo(
    () =>
      keyframes.map((k) => ({
        a: new THREE.Color(k.colorA),
        b: new THREE.Color(k.colorB),
      })),
    [keyframes]
  );

  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      distortionFactor: { value: keyframes[0].distortion },
      opacity: { value: keyframes[0].opacity },
      colorA: { value: keyColors[0].a.clone() },
      colorB: { value: keyColors[0].b.clone() },
      map: { value: placeholderTexture },
      mapBlend: { value: 0 },
    }),
    [keyframes, keyColors, placeholderTexture]
  );

  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const isMobile = windowWidth <= 768;

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const elapsed = reducedMotion ? 0 : state.clock.getElapsedTime();
    const s = smoothed.current;

    // Damp scroll + pointer so motion stays fluid even on jumpy scroll input
    const damp = 1 - Math.exp(-delta * 5);
    const dampFast = 1 - Math.exp(-delta * 8);
    s.progress += (scrollRef.current - s.progress) * damp;
    s.px += (pointerRef.current.x - s.px) * damp;
    s.py += (pointerRef.current.y - s.py) * damp;

    // Hover feedback from the page (project-card handlers)
    const controls = controlsRef ? controlsRef.current : null;
    const exciteTarget = controls && controls.excite ? 1 : 0;
    s.excite += (exciteTarget - s.excite) * dampFast;
    const tintTarget = controls && controls.tintA ? 1 : 0;
    s.tint += (tintTarget - s.tint) * dampFast;
    if (controls && controls.tintA) {
      tintColors.current.a.set(controls.tintA);
      tintColors.current.b.set(controls.tintB || controls.tintA);
    }

    // Liquid thumbnail preview: load the hovered project's image once and
    // crossfade it over the abstract surface when ready.
    const ts = textureState.current;
    const desiredUrl = controls && controls.textureUrl ? controls.textureUrl : null;
    if (desiredUrl !== ts.url) {
      ts.url = desiredUrl;
      if (desiredUrl && !ts.cache.has(desiredUrl)) {
        ts.cache.set(desiredUrl, null);
        new THREE.TextureLoader().setCrossOrigin('anonymous').load(
          desiredUrl,
          (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.colorSpace = THREE.SRGBColorSpace;
            ts.cache.set(desiredUrl, tex);
          },
          undefined,
          () => ts.cache.set(desiredUrl, false)
        );
      }
    }
    const readyTexture = ts.url ? ts.cache.get(ts.url) : null;
    s.map += ((readyTexture ? 1 : 0) - s.map) * dampFast;
    if (readyTexture && uniforms.map.value !== readyTexture) {
      uniforms.map.value = readyTexture;
    }
    uniforms.mapBlend.value = s.map;

    // Find the keyframe segment for the current scroll depth (in vh units)
    const p = s.progress;
    let i = 0;
    while (i < keyframes.length - 2 && p > keyframes[i + 1].at) i += 1;
    const from = keyframes[i];
    const to = keyframes[i + 1];
    const span = Math.max(to.at - from.at, 0.0001);
    const local = smoothstep(THREE.MathUtils.clamp((p - from.at) / span, 0, 1));
    const lerp = THREE.MathUtils.lerp;
    const clamp = THREE.MathUtils.clamp;

    const mobileFactor = isMobile ? 0.6 : 1;
    // On mobile pull the object toward center so it stays on screen
    const xFactor = isMobile ? 0.45 : 1;

    let x = lerp(from.position[0], to.position[0], local) * xFactor;
    let y = lerp(from.position[1], to.position[1], local);
    let z = lerp(from.position[2], to.position[2], local);
    let scale = lerp(from.scale, to.scale, local) * mobileFactor;
    let opacity = lerp(from.opacity, to.opacity, local);

    // On mobile there is no rail, so fade further behind the grid
    if (isMobile) {
      opacity *= lerp(1, 0.5, clamp(p, 0, 1));
    }

    // Dock into the rail slot next to the grid once the hero scrolls away.
    // The slot is a real DOM element, so the object lands in reserved layout
    // space at full opacity instead of hiding behind content.
    const anchorEl = anchorRef ? anchorRef.current : null;
    if (anchorEl && !isMobile) {
      const anchorT = smoothstep(clamp((p - 0.08) / 0.55, 0, 1));
      const rect = anchorT > 0 ? anchorEl.getBoundingClientRect() : null;
      // rect.width of 0 means the rail is display:none (tablet widths) —
      // fall back to the plain keyframe journey.
      if (rect && rect.width > 1) {
        const halfW = state.viewport.width / 2;
        const halfH = state.viewport.height / 2;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const ax = ((cx / window.innerWidth) * 2 - 1) * halfW;
        const ay = -(((cy / window.innerHeight) * 2 - 1) * halfH);
        const slotWorldWidth = (rect.width / window.innerWidth) * state.viewport.width;
        const aScale = slotWorldWidth * 0.3;

        x = lerp(x, ax, anchorT);
        y = lerp(y, ay, anchorT);
        z = lerp(z, 0, anchorT);
        scale = lerp(scale, aScale, anchorT);
        opacity = lerp(opacity, 0.95, anchorT);
      }
    }

    mesh.position.set(x, y + Math.sin(elapsed * 1.1) * 0.04, z);

    const spin = reducedMotion
      ? 0
      : lerp(from.spinSpeed, to.spinSpeed, local) * (1 + s.excite * 1.6);
    mesh.rotation.x =
      lerp(from.rotation[0], to.rotation[0], local) +
      Math.sin(elapsed * 0.3) * 0.05 +
      s.py * 0.12;
    mesh.rotation.y =
      lerp(from.rotation[1], to.rotation[1], local) + elapsed * spin * 0.3 + s.px * 0.2;
    mesh.rotation.z = lerp(from.rotation[2], to.rotation[2], local) + elapsed * spin * 0.1;

    mesh.scale.setScalar(scale * (1 + s.excite * 0.05));

    uniforms.time.value = elapsed;
    uniforms.distortionFactor.value = reducedMotion
      ? 0
      : lerp(from.distortion, to.distortion, local) + s.excite * 0.1;
    uniforms.opacity.value = opacity;
    uniforms.colorA.value
      .copy(keyColors[i].a)
      .lerp(keyColors[i + 1].a, local)
      .lerp(tintColors.current.a, s.tint * 0.85);
    uniforms.colorB.value
      .copy(keyColors[i].b)
      .lerp(keyColors[i + 1].b, local)
      .lerp(tintColors.current.b, s.tint * 0.85);
  });

  return (
    <mesh ref={meshRef}>
      <torusKnotGeometry args={shapeArgs} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

// Sparse starfield that counter-scrolls slightly for depth
function ParallaxParticles({ scrollRef }) {
  const pointsRef = useRef();

  const positions = useMemo(() => {
    const count = 260;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = 4 + Math.random() * 6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi) - 3;
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    points.rotation.y = clock.getElapsedTime() * 0.015;
    points.position.y = Math.min(scrollRef.current, 4) * 0.6;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.018} color="#8899bb" transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

export default function ContinuousScene({
  keyframes,
  shapeArgs = [1, 0.32, 220, 36, 2, 3],
  particles = true,
  anchorRef = null,
  controlsRef = null,
}) {
  const scrollRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const handleScroll = () => {
      // Scroll depth in viewport heights — robust regardless of page length
      scrollRef.current = window.scrollY / Math.max(window.innerHeight, 1);
    };
    const handlePointer = (e) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pointermove', handlePointer, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pointermove', handlePointer);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 60 }}
        dpr={[1, 1.5]}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={80} color="#ffffff" />
        <pointLight position={[-10, 5, -5]} intensity={9000} color="#ff00ff" />
        <pointLight position={[10, -5, 5]} intensity={9000} color="#00ffff" />
        <ContinuousShape
          keyframes={keyframes}
          shapeArgs={shapeArgs}
          scrollRef={scrollRef}
          pointerRef={pointerRef}
          anchorRef={anchorRef}
          controlsRef={controlsRef}
          reducedMotion={reducedMotion}
        />
        {particles && !reducedMotion && <ParallaxParticles scrollRef={scrollRef} />}
      </Canvas>
    </div>
  );
}

// Bouncing "scroll" hint for hero sections
export function ScrollCue({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col items-center gap-1.5 text-white/40 ${className}`}
    >
      <span className="font-mono text-[10px] tracking-[0.3em]">SCROLL</span>
      <motion.span
        animate={{ y: [0, 7, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        className="text-lg leading-none"
      >
        ↓
      </motion.span>
    </div>
  );
}

// ─── Shaders ─────────────────────────────────────────────────────────────────

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  uniform float time;
  uniform float distortionFactor;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec3 transformed = position;

    transformed.x += sin(transformed.y * 8.0 + time) * distortionFactor;
    transformed.y += cos(transformed.x * 8.0 + time) * distortionFactor;
    transformed.z += sin((transformed.x + transformed.y) * 4.0 + time * 0.7) * distortionFactor * 0.5;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  uniform float time;
  uniform float opacity;
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform sampler2D map;
  uniform float mapBlend;

  void main() {
    vec3 viewDirection = vec3(0.0, 0.0, 1.0);
    float fresnelFactor = pow(1.0 - abs(dot(viewDirection, vNormal)), 3.0);

    float wave = 0.5 + 0.5 * sin(vUv.x * 6.0 + vUv.y * 4.0 + time * 0.6);
    vec3 baseColor = mix(colorA, colorB, wave);

    vec3 rim = vec3(0.9, 0.95, 1.0) * fresnelFactor;
    vec3 abstractColor = baseColor * (0.55 + 0.45 * wave) + rim * 0.8;

    // Liquid preview: the hovered project's thumbnail flows over the
    // surface — repeated along the tube with a slow swimming distortion.
    vec2 liquidUv = vUv * vec2(3.0, 1.0);
    liquidUv += 0.035 * vec2(
      sin(vUv.y * 9.0 + time * 0.8),
      cos(vUv.x * 11.0 + time * 0.6)
    );
    vec3 texColor = texture2D(map, liquidUv).rgb;
    vec3 previewColor = texColor * (0.8 + 0.3 * wave) + rim * 0.45;

    vec3 finalColor = mix(abstractColor, previewColor, mapBlend);

    float alpha = (0.75 + fresnelFactor * 0.25) * opacity;
    gl_FragColor = vec4(finalColor, alpha);
  }
`;
