"use client";

import dynamic from "next/dynamic";
import HUD from "@/components/HUD";
import LipMark from "@/components/LipMark";
import TouchControls from "@/components/TouchControls";

const Scene = dynamic(() => import("@/components/Scene"), { ssr: false });

export default function Home() {
  return (
    <div className="relative h-dvh w-dvw touch-none overflow-hidden bg-black">
      <Scene />
      <HUD />
      <TouchControls />
      <LipMark />
    </div>
  );
}
