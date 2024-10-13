import React from 'react';
import { Canvas, useFrame } from '@react-three/fiber'; // Add useFrame import
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

export default function About() {
  return (
    <section className="relative w-full h-screen flex flex-col justify-center items-center text-center  text-white p-8">
      <div className="w-full max-w-4xl mx-auto">
        <h2 className="text-4xl font-bold mb-4">About Harrison Martin</h2>
        <p className="text-lg leading-relaxed mb-8">
          Harrison Martin is a passionate Computer Science major and skilled 3D artist who blends technical expertise with creative vision. With experience in full-stack development and 3D printing technologies, Harrison brings innovative digital solutions to life, whether it's crafting intricate 3D models or building responsive web applications.
        </p>
        <p className="text-lg leading-relaxed mb-8">
          His work explores the intersection of art and technology, pushing boundaries in the fields of software engineering and 3D design. Harrison's dedication to modern web development, coupled with his advanced knowledge of 3D printing, allows him to deliver cutting-edge solutions that seamlessly integrate form and function.
        </p>

      </div>
    </section>
  );
}

function RotatingCube() {
  const meshRef = React.useRef();

  useFrame(() => {
    meshRef.current.rotation.x += 0.01;
    meshRef.current.rotation.y += 0.01;
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={new THREE.Color('cyan')} />
    </mesh>
  );
}
