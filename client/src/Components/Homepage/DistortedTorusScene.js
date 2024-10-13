import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, TorusKnot, SpotLight, PointLight } from '@react-three/drei';
import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';


export default function DistortedTorusScene() {
  return (
    <div className="h-screen w-full relative">
      <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
        <ambientLight intensity={0.3} color="#ffffff" />
        <spotLight
          position={[5, 5, 5]}
          angle={0.2}
          penumbra={1}
          intensity={1}
          color="#ff8e8e"
          castShadow
        />
        <pointLight position={[-10, 5, -5]} intensity={10000} color="#ff00ff" />
        <pointLight position={[10, -5, 5]} intensity={10000} color="#00ffff" />

        <DistortedTorus />
      </Canvas>

      {/* Sticky Notes Container */}
      <NotesContainer />
    </div>
  );
}

function DistortedTorus() {
  const meshRef = useRef();
  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      distortionFactor: { value: 0.2 },
      resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      colorTransition: { value: 0.5 },
    }),
    []
  );

  useFrame(({ clock }) => {
    const elapsedTime = clock.getElapsedTime();
    const rotationAngle = Math.sin(elapsedTime * 0.5) * 0.2;
    meshRef.current.rotation.y = rotationAngle;
    meshRef.current.rotation.z = elapsedTime * 0.02;
    uniforms.time.value = elapsedTime;
  });

  return (
    <TorusKnot ref={meshRef} args={[1, 0.4, 256, 32]} scale={1.}>
      <shaderMaterial
        attach="material"
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
      />
    </TorusKnot>
  );
}

function NotesContainer() {
  return (
    <div className="fixed bottom-0 left-0 w-full flex justify-between p-4 space-x-4 bg-gray-800 text-white">
      <div className="w-1/3 p-2 bg-gray-700 rounded-lg">Note 1</div>
      <div className="w-1/3 p-2 bg-gray-700 rounded-lg">Note 2</div>
      <div className="w-1/3 p-2 bg-gray-700 rounded-lg">Note 3</div>
    </div>
  );
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

    float alpha = 0.7 + fresnelFactor * 0.4;
    vec3 reflection = reflect(normal, viewDirection);
    vec3 reflectionColor = vec3(0.8, 0.9, 1.0);

    gl_FragColor = vec4(mix(refractedColor, reflectionColor, fresnelFactor), alpha);
  }
`;
