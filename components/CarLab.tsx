"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import ToyCarSmoke from "@/components/ToyCarSmoke";
import type { CarInput } from "@/components/ToyCar";
import type { CarPose } from "@/components/ToyCarSmoke";
import {
  RacingTrack,
  FolioTopDownCam,
  flatGround,
  TRACK_BOUNDS,
  TRACK_START,
} from "@/components/RacingTrack";
import Minimap from "@/components/Minimap";
import HandGestures from "@/components/HandGestures";

type View = "track" | "smoke" | "html";

const KEY_MAP: Record<string, keyof CarInput> = {
  KeyW: "fwd",
  ArrowUp: "fwd",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "brake",
};

const BTN: React.CSSProperties = {
  width: 58,
  height: 58,
  borderRadius: 16,
  borderWidth: 2,
  borderStyle: "solid",
  borderColor: "#cfc8bd",
  backgroundColor: "#fffdf9",
  color: "#2a2622",
  fontSize: 22,
  cursor: "pointer",
  userSelect: "none",
  touchAction: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const HINT: React.CSSProperties = {
  position: "fixed",
  bottom: 84,
  left: 0,
  right: 0,
  textAlign: "center",
  pointerEvents: "none",
  color: "#2e2b27",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  textShadow: "0 1px 3px rgba(255,255,255,0.8)",
};

export default function CarLab() {
  const [view, setView] = useState<View>("track");
  const [color, setColor] = useState("#ff7a1a");
  const [smokeOn, setSmokeOn] = useState(true);
  const [showCurbs, setShowCurbs] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [zoomMultiplier, setZoomMultiplier] = useState(1.0);
  const [carResetKey, setCarResetKey] = useState(0);
  const [pressed, setPressed] = useState<Partial<Record<keyof CarInput, boolean>>>({});
  const speedRef = useRef<HTMLSpanElement>(null);
  const input = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 0 });
  const pose = useRef<CarPose>({
    x: TRACK_START.x,
    y: TRACK_START.y,
    z: TRACK_START.z,
    yaw: TRACK_START.yaw,
    speed: 0,
  });
  const [gestures, setGestures] = useState(false);

  const set = (k: keyof CarInput, v: 0 | 1) => {
    input.current[k] = v;
    setPressed((p) => ({ ...p, [k]: !!v }));
  };

  const resetCar = useCallback(() => {
    setCarResetKey((k) => k + 1);
    pose.current.x = TRACK_START.x;
    pose.current.y = TRACK_START.y;
    pose.current.z = TRACK_START.z;
    pose.current.yaw = TRACK_START.yaw;
    pose.current.speed = 0;
  }, []);

  // Keyboard input
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = KEY_MAP[e.code];
      if (k) {
        set(k, 1);
        e.preventDefault();
      }
      if (e.code === "KeyR") {
        resetCar();
      }
      if (e.code === "KeyM") {
        setShowMinimap((v) => !v);
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = KEY_MAP[e.code];
      if (k) set(k, 0);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [resetCar]);

  // Mouse wheel zoom in track view
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (view !== "track") return;
      setZoomMultiplier((z) => Math.min(1.8, Math.max(0.65, z + e.deltaY * 0.001)));
    },
    [view]
  );

  useEffect(() => {
    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const hold = (k: keyof CarInput, label: string, aria: string) => (
    <button
      aria-label={aria}
      style={{
        ...BTN,
        ...(pressed[k] ? { backgroundColor: "#ff7a1a", color: "#fff", borderColor: "#ff7a1a" } : {}),
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(k, 1);
      }}
      onPointerUp={() => set(k, 0)}
      onPointerCancel={() => set(k, 0)}
    >
      {label}
    </button>
  );

  const tab = (id: View, text: string) => (
    <button
      onClick={() => setView(id)}
      style={{
        padding: "8px 14px",
        borderRadius: 10,
        borderWidth: 2,
        borderStyle: "solid",
        borderColor: "#cfc8bd",
        cursor: "pointer",
        backgroundColor: view === id ? "#2a2622" : "#fffdf9",
        color: view === id ? "#fffdf9" : "#2a2622",
        font: "inherit",
        fontWeight: view === id ? 600 : 500,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {text}
    </button>
  );

  const onSpeed = (s: number) => {
    if (speedRef.current) speedRef.current.textContent = Math.abs(s).toFixed(1);
  };

  const is3d = view !== "html";

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "#cbe2f2" }}>
      {is3d ? (
        <Canvas
          key={view === "track" ? "track" : "lab"}
          shadows
          camera={
            view === "track"
              ? { position: [20, 26, 20], fov: 26, near: 0.5, far: 800 }
              : { position: [6, 3.5, 7], fov: 40 }
          }
        >
          {view === "track" ? (
            <>
              <color attach="background" args={["#cbe2f2"]} />
              <fog attach="fog" args={["#cbe2f2", 80, 420]} />
              <ambientLight intensity={0.7} />
              <hemisphereLight args={["#dbe9f6", "#739855", 0.55]} />
              <directionalLight
                position={[40, 75, 30]}
                intensity={1.35}
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-camera-near={10}
                shadow-camera-far={200}
                shadow-camera-left={-75}
                shadow-camera-right={75}
                shadow-camera-top={75}
                shadow-camera-bottom={-75}
                shadow-bias={-0.0004}
              />
              <RacingTrack showCurbs={showCurbs} />
              <ToyCarSmoke
                key={`car-${carResetKey}`}
                color={color}
                keyboard={false}
                input={input}
                onSpeed={onSpeed}
                smoke={smokeOn}
                terrain={flatGround}
                pose={pose}
                bounds={TRACK_BOUNDS}
                start={TRACK_START}
                maxSpeed={18}
                carScale={0.65}
              />
              <FolioTopDownCam pose={pose} zoomMultiplier={zoomMultiplier} />
            </>
          ) : (
            <>
              <ambientLight intensity={0.8} />
              <hemisphereLight args={["#ffffff", "#555555", 0.5]} />
              <directionalLight position={[4, 7, 5]} intensity={1.2} />
              <ToyCarSmoke color={color} keyboard={false} input={input} onSpeed={onSpeed} smoke={smokeOn} />
              <OrbitControls target={[0, 1, 0]} />
            </>
          )}
        </Canvas>
      ) : (
        <iframe title="Classic toy car" src="/toy-car.html" style={{ width: "100%", height: "100%", border: 0 }} />
      )}

      {/* Top Header Controls Bar */}
      <div
        style={{
          position: "fixed",
          top: 14,
          left: 14,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          zIndex: 10,
        }}
      >
        {tab("track", "🏁 Racing Track")}
        {tab("smoke", "🏎️ Detailed Car")}
        {tab("html", "Classic (HTML)")}

        {is3d && (
          <label
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              marginLeft: 8,
              color: "#2a2622",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Paint
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 28, height: 28, border: "none", borderRadius: 6, cursor: "pointer" }}
            />
          </label>
        )}

        {(view === "smoke" || view === "track") && (
          <label
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              marginLeft: 8,
              color: "#2a2622",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={smokeOn}
              onChange={(e) => setSmokeOn(e.target.checked)}
            />
            Smoke
          </label>
        )}

        {view === "track" && (
          <>
            <label
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                marginLeft: 8,
                color: "#2a2622",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showCurbs}
                onChange={(e) => setShowCurbs(e.target.checked)}
              />
              Curbs
            </label>

            <label
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                marginLeft: 8,
                color: "#2a2622",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showMinimap}
                onChange={(e) => setShowMinimap(e.target.checked)}
              />
              Minimap
            </label>

            <button
              onClick={resetCar}
              title="Respawn car at the starting grid (or press 'R')"
              style={{
                padding: "7px 12px",
                borderRadius: 9,
                borderWidth: 1.5,
                borderStyle: "solid",
                borderColor: "#cfc8bd",
                backgroundColor: "#fffdf9",
                color: "#2a2622",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                marginLeft: 4,
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              ⟲ Reset [R]
            </button>
          </>
        )}

        {is3d && (
          <label
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              marginLeft: 8,
              color: "#2a2622",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={gestures}
              onChange={(e) => setGestures(e.target.checked)}
            />
            Hand gestures
          </label>
        )}
      </div>

      {is3d && (
        <>
          <div
            style={{
              position: "fixed",
              top: 14,
              right: 18,
              color: "#2a2622",
              backgroundColor: "rgba(255,253,249,0.85)",
              padding: "6px 14px",
              borderRadius: 10,
              border: "1.5px solid #cfc8bd",
              fontSize: 14,
              fontWeight: 600,
              zIndex: 10,
              boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
            }}
          >
            Speed <span ref={speedRef} style={{ fontSize: 18, fontWeight: 700, color: "#ff7a1a" }}>0.0</span> u/s
          </div>

          {/* On-screen touch buttons for mobile / mouse */}
          <div
            style={{
              position: "fixed",
              bottom: 18,
              left: 20,
              right: 20,
              display: "flex",
              justifyContent: "space-between",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
              {hold("left", "◀", "Steer left")}
              {hold("right", "▶", "Steer right")}
            </div>
            <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
              {hold("back", "▼", "Reverse")}
              {hold("fwd", "▲", "Forward")}
            </div>
          </div>
        </>
      )}

      {is3d && gestures && (
        <HandGestures input={input} onPressed={(p) => setPressed((prev) => ({ ...prev, ...p }))} />
      )}

      {/* Real-time Track Radar Minimap */}
      {view === "track" && (
        <Minimap
          pose={pose}
          visible={showMinimap}
          onToggle={() => setShowMinimap((v) => !v)}
          onReset={resetCar}
        />
      )}

      {view === "track" && (
        <div style={HINT}>
          WASD or Arrow Keys to steer • Space to brake • Scroll wheel to zoom • M for Minimap • R to reset
        </div>
      )}
    </div>
  );
}
