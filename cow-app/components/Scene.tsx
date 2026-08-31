"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import Cow from "./Cow";

export default function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 1.6, 3.6], fov: 45 }}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
    >
      <Sky sunPosition={[10, 8, 5]} turbidity={3} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[12, 32]} />
        <meshStandardMaterial color="#6fae4a" />
      </mesh>

      <Cow />

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 2.1}
        minAzimuthAngle={-Math.PI / 4}
        maxAzimuthAngle={Math.PI / 4}
        target={[0, 0.7, 0]}
      />
    </Canvas>
  );
}
