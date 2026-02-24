import { Canvas, useFrame } from '@react-three/fiber';
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';

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
      args: [0.5, 0.3, 5, 32, 2],
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

export default function DistortedTorusScene({
  className = 'h-screen w-full relative',
  variant = 'art',
  cameraPosition = [0, 0, 5],
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

        <DistortedTorus preset={preset} />
      </Canvas>
    </div>
  );
}

function DistortedTorus({ preset }) {
  const meshRef = useRef();
  const shape = preset.shape || SCENE_PRESETS.art.shape;
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
    }),
    [preset.distortionFactor]
  );

  useFrame(({ clock }) => {
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

    uniforms.distortionFactor.value = THREE.MathUtils.lerp(
      preset.distortionFactor * 2.25,
      preset.distortionFactor,
      introEase
    );
    uniforms.introOpacity.value = introFadeEase;
    uniforms.introGlow.value = 1 - introEase;
    uniforms.time.value = elapsedTime;
  });

  return (
    <mesh ref={meshRef} scale={scale}>
      <ShapeGeometry type={shape.type} args={shape.args} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
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

// Vertex and Fragment shaders remain unchanged
const vertexShader = `
  varying vec2 vUv;
  uniform float time;
  uniform float distortionFactor;

  void main() {
    vUv = uv;
    vec3 transformed = position;

    transformed.x += sin(transformed.y * 10.0 + time) * distortionFactor;
    transformed.y += cos(transformed.x * 10.0 + time) * distortionFactor;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  uniform float time;
  uniform vec2 resolution;
  uniform float colorTransition;
  uniform float introOpacity;
  uniform float introGlow;

  float fresnel(vec3 viewDirection, vec3 normal) {
    return pow(1.0 - dot(viewDirection, normal), 3.0);
  }

  void main() {
    vec3 normal = normalize(vec3(vUv, 1.0));
    vec3 viewDirection = normalize(vec3(0.0, 0.0, 1.0));

    float r = 0.5 + 0.5 * sin(vUv.x * 2.0 + time * 0.5);
    float g = 0.5 + 0.5 * cos(vUv.y * 2.0 + time * 0.5);
    float b = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 4.0 - time * 0.5);
    vec3 baseColor = vec3(r, g, b);

    float fresnelFactor = fresnel(viewDirection, normal);
    vec3 fresnelColor = vec3(0.9, 0.9, 1.0) * fresnelFactor;

    vec3 finalColor = mix(baseColor, fresnelColor, fresnelFactor * 0.6);

    vec2 refractedUV = vUv + sin(time + vUv * 10.0) * 0.05;
    vec3 refractedColor = mix(finalColor, vec3(1.0), fresnelFactor);

    float alpha = (0.7 + fresnelFactor * 0.4) * (0.2 + 0.8 * introOpacity);
    vec3 reflection = reflect(normal, viewDirection);
    vec3 reflectionColor = vec3(0.8, 0.9, 1.0);
    vec3 entryGlow = vec3(0.65, 0.85, 1.0) * introGlow * (0.5 + fresnelFactor);
    vec3 finalLitColor = mix(refractedColor, reflectionColor, fresnelFactor) + entryGlow;

    gl_FragColor = vec4(finalLitColor, alpha);
  }
`;
