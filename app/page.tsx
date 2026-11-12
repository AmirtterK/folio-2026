"use client";

import dynamic from "next/dynamic";

// WebGL only exists in the browser, so skip server rendering for the scene.
const FolioScene = dynamic(() => import("@/components/FolioScene"), { ssr: false });

export default function Page() {
  return (
    <>
      {/*
        Painted with the first HTML response, before the 3D bundle is parsed.
        FolioScene's root (later in the DOM) covers it as soon as React mounts,
        and FolioScene keeps its own progress overlay until the car is ready.
      */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a1238",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            border: "4px solid rgba(255,255,255,0.14)",
            borderTopColor: "#ff7a1a",
            animation: "bootSpin 0.9s linear infinite",
          }}
        />
        <style>{`@keyframes bootSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
      <FolioScene />
    </>
  );
}
