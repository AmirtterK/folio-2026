"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// WebGL only exists in the browser, so skip server rendering for the scene.
const FolioScene = dynamic(() => import("@/components/FolioScene"), { ssr: false });

function isMobileDevice() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) <= 900;
  return uaMobile || (coarse && smallViewport && navigator.maxTouchPoints > 0);
}

export default function Page() {
  const [status, setStatus] = useState<"checking" | "phone" | "desktop">("checking");

  useEffect(() => {
    setStatus(isMobileDevice() ? "phone" : "desktop");
  }, []);

  if (status !== "desktop") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
          color: "#ffffff",
          padding: "24px",
          textAlign: "center",
          fontFamily: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
        }}
      >
        {status === "phone" ? (
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Best experienced on PC</div>
            <div style={{ fontSize: 16, lineHeight: 1.6, opacity: 0.9 }}>
              This interactive 3D experience is designed for desktop. Please open this site on a PC for the best
              experience.
            </div>
          </div>
        ) : null}
      </div>
    );
  }

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
          background: "#000000",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            border: "4px solid rgba(255,255,255,0.14)",
            borderTopColor: "#111111",
            animation: "bootSpin 0.9s linear infinite",
          }}
        />
        <style>{`@keyframes bootSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
      <FolioScene />
    </>
  );
}
