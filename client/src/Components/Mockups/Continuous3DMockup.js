import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { motion } from 'framer-motion';
import * as THREE from 'three';

// ─── Continuous 3D mockup ────────────────────────────────────────────────────
// One persistent 3D object lives in a fixed, full-screen canvas behind the
// page. Scroll position drives every property of the scene — position, scale,
// rotation, distortion, and color — interpolated smoothly between per-section
// keyframes so the whole page reads as one continuous journey instead of
// separate blocks.

// One keyframe per section. Scroll progress (0 → 1) sweeps through these.
const KEYFRAMES = [
  {
    // Hero — centered, calm, cyan/magenta
    position: [0, 0, 0],
    scale: 1.25,
    rotation: [0.2, 0, 0],
    distortion: 0.18,
    spinSpeed: 0.25,
    colorA: '#00e5ff',
    colorB: '#ff00e5',
    cameraZ: 5,
  },
  {
    // Section 2 — drifts right, tightens up, teal/green
    position: [1.7, 0.1, -0.4],
    scale: 0.85,
    rotation: [0.9, 0.6, 0.3],
    distortion: 0.05,
    spinSpeed: 0.45,
    colorA: '#2dd4bf',
    colorB: '#22ff88',
    cameraZ: 5,
  },
  {
    // Section 3 — swings left, agitated, orange/pink
    position: [-1.7, -0.1, 0],
    scale: 1.05,
    rotation: [-0.4, 1.8, 0.8],
    distortion: 0.5,
    spinSpeed: 0.8,
    colorA: '#fb923c',
    colorB: '#ff4d6d',
    cameraZ: 5,
  },
  {
    // Contact — returns to center, close to camera, violet/blue
    position: [0, 0.15, 1.2],
    scale: 1.5,
    rotation: [0.3, 3.2, 0.1],
    distortion: 0.3,
    spinSpeed: 0.3,
    colorA: '#8b5cf6',
    colorB: '#38bdf8',
    cameraZ: 5,
  },
];

const SECTION_COUNT = KEYFRAMES.length;

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// ─── Scene ───────────────────────────────────────────────────────────────────

function ContinuousShape({ scrollRef, pointerRef }) {
  const meshRef = useRef();
  const smoothed = useRef({ progress: 0, px: 0, py: 0 });

  const keyColors = useMemo(
    () =>
      KEYFRAMES.map((k) => ({
        a: new THREE.Color(k.colorA),
        b: new THREE.Color(k.colorB),
      })),
    []
  );

  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      distortionFactor: { value: KEYFRAMES[0].distortion },
      colorA: { value: keyColors[0].a.clone() },
      colorB: { value: keyColors[0].b.clone() },
    }),
    [keyColors]
  );

  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const isMobile = windowWidth <= 768;

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const elapsed = clock.getElapsedTime();
    const s = smoothed.current;

    // Damp scroll + pointer so motion stays fluid even on jumpy scroll input
    const damp = 1 - Math.exp(-delta * 5);
    s.progress += (scrollRef.current - s.progress) * damp;
    s.px += (pointerRef.current.x - s.px) * damp;
    s.py += (pointerRef.current.y - s.py) * damp;

    // Locate ourselves between two keyframes
    const t = THREE.MathUtils.clamp(s.progress, 0, 1) * (SECTION_COUNT - 1);
    const i = Math.min(Math.floor(t), SECTION_COUNT - 2);
    const local = smoothstep(THREE.MathUtils.clamp(t - i, 0, 1));
    const from = KEYFRAMES[i];
    const to = KEYFRAMES[i + 1];
    const lerp = THREE.MathUtils.lerp;

    const mobileFactor = isMobile ? 0.62 : 1;
    // On mobile pull the object toward center so text can sit over it
    const xFactor = isMobile ? 0.35 : 1;

    mesh.position.x = lerp(from.position[0], to.position[0], local) * xFactor;
    mesh.position.y =
      lerp(from.position[1], to.position[1], local) + Math.sin(elapsed * 1.1) * 0.04;
    mesh.position.z = lerp(from.position[2], to.position[2], local);

    const spin = lerp(from.spinSpeed, to.spinSpeed, local);
    mesh.rotation.x =
      lerp(from.rotation[0], to.rotation[0], local) +
      Math.sin(elapsed * 0.3) * 0.05 +
      s.py * 0.15;
    mesh.rotation.y =
      lerp(from.rotation[1], to.rotation[1], local) + elapsed * spin * 0.3 + s.px * 0.25;
    mesh.rotation.z = lerp(from.rotation[2], to.rotation[2], local) + elapsed * spin * 0.1;

    mesh.scale.setScalar(lerp(from.scale, to.scale, local) * mobileFactor);

    uniforms.time.value = elapsed;
    uniforms.distortionFactor.value = lerp(from.distortion, to.distortion, local);
    uniforms.colorA.value.copy(keyColors[i].a).lerp(keyColors[i + 1].a, local);
    uniforms.colorB.value.copy(keyColors[i].b).lerp(keyColors[i + 1].b, local);
  });

  return (
    <mesh ref={meshRef}>
      <torusKnotGeometry args={[1, 0.32, 256, 40, 2, 3]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
      />
    </mesh>
  );
}

// Sparse starfield that counter-scrolls slightly for depth
function ParallaxParticles({ scrollRef }) {
  const pointsRef = useRef();

  const positions = useMemo(() => {
    const count = 350;
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
    points.position.y = scrollRef.current * 2.5;
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
      <pointsMaterial size={0.02} color="#8899bb" transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: 'hero',
    align: 'center',
    accent: 'text-cyan-300',
    tag: 'MOCKUP · CONTINUOUS 3D',
    title: 'One object.\nOne journey.',
    body: 'A single 3D form lives behind the entire page. As you scroll, it never cuts or reloads — it travels, morphs, and recolors continuously between sections.',
  },
  {
    id: 'travel',
    align: 'left',
    accent: 'text-teal-300',
    tag: '01 · SEAMLESS TRAVEL',
    title: 'It moves with you',
    body: 'Scroll position is interpolated through keyframes with damping, so the object glides to the empty side of the layout and settles while you read. No section boundaries, no hard transitions.',
  },
  {
    id: 'react',
    align: 'right',
    accent: 'text-orange-300',
    tag: '02 · REACTIVE MATERIAL',
    title: 'It reacts to context',
    body: 'Distortion, spin, and the shader palette are all scroll-driven. Calm where the content is dense, energetic where the page wants attention. Mouse movement adds a subtle parallax on top.',
  },
  {
    id: 'cta',
    align: 'center',
    accent: 'text-violet-300',
    tag: '03 · READY WHEN YOU ARE',
    title: 'Homepage candidate',
    body: 'This is a standalone mockup — nothing on the live homepage has changed. If the effect feels right, the same keyframe system can drive the existing hero scene.',
  },
];

export default function Continuous3DMockup() {
  const scrollRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });
  const progressBarRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? window.scrollY / max : 0;
      scrollRef.current = progress;
      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${progress})`;
      }
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
    <div className="relative bg-[#07070c] text-white">
      {/* Fixed scene behind everything */}
      <div className="fixed inset-0 z-0">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 60 }}
          dpr={[1, 1.5]}
          style={{ width: '100%', height: '100%' }}
        >
          <ambientLight intensity={80} color="#ffffff" />
          <pointLight position={[-10, 5, -5]} intensity={9000} color="#ff00ff" />
          <pointLight position={[10, -5, 5]} intensity={9000} color="#00ffff" />
          <ContinuousShape scrollRef={scrollRef} pointerRef={pointerRef} />
          <ParallaxParticles scrollRef={scrollRef} />
        </Canvas>
        {/* Vignette so text stays legible over the scene */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(7,7,12,0.75)_100%)]" />
      </div>

      {/* Scroll progress bar */}
      <div className="fixed left-0 top-0 z-20 h-0.5 w-full bg-white/10">
        <div
          ref={progressBarRef}
          className="h-full w-full origin-left bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400"
          style={{ transform: 'scaleX(0)' }}
        />
      </div>

      {/* Mockup badge */}
      <div className="fixed right-4 top-4 z-20 rounded border border-white/15 bg-white/5 px-3 py-1 font-mono text-[11px] tracking-widest text-white/60 backdrop-blur">
        MOCKUP · NOT LIVE
      </div>

      {/* Scrolling content */}
      <div className="relative z-10">
        {SECTIONS.map((section, index) => (
          <section
            key={section.id}
            className={`flex min-h-screen items-center px-6 sm:px-12 lg:px-24 ${
              section.align === 'left'
                ? 'justify-start'
                : section.align === 'right'
                ? 'justify-end'
                : 'justify-center'
            }`}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.4 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className={`max-w-xl ${section.align === 'center' ? 'text-center' : ''}`}
            >
              <p className={`mb-4 font-mono text-xs tracking-[0.3em] ${section.accent}`}>
                {section.tag}
              </p>
              <h2 className="mb-6 whitespace-pre-line text-4xl font-bold leading-tight sm:text-6xl">
                {section.title}
              </h2>
              <p className="text-base leading-relaxed text-white/70 sm:text-lg">
                {section.body}
              </p>
              {index === 0 && (
                <div className="mt-16 flex flex-col items-center gap-2 text-white/40">
                  <span className="font-mono text-[11px] tracking-[0.3em]">SCROLL</span>
                  <motion.span
                    animate={{ y: [0, 8, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="text-xl"
                  >
                    ↓
                  </motion.span>
                </div>
              )}
              {index === SECTIONS.length - 1 && (
                <div className="mt-10 flex flex-wrap justify-center gap-4">
                  <a
                    href="/"
                    className="rounded border border-violet-500/40 bg-violet-500/10 px-6 py-3 font-mono text-sm text-violet-300 transition hover:bg-violet-500/20"
                  >
                    ← Back to current homepage
                  </a>
                </div>
              )}
            </motion.div>
          </section>
        ))}
      </div>
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
  uniform vec3 colorA;
  uniform vec3 colorB;

  void main() {
    vec3 viewDirection = vec3(0.0, 0.0, 1.0);
    float fresnelFactor = pow(1.0 - abs(dot(viewDirection, vNormal)), 3.0);

    float wave = 0.5 + 0.5 * sin(vUv.x * 6.0 + vUv.y * 4.0 + time * 0.6);
    vec3 baseColor = mix(colorA, colorB, wave);

    vec3 rim = vec3(0.9, 0.95, 1.0) * fresnelFactor;
    vec3 finalColor = baseColor * (0.55 + 0.45 * wave) + rim * 0.8;

    float alpha = 0.75 + fresnelFactor * 0.25;
    gl_FragColor = vec4(finalColor, alpha);
  }
`;
