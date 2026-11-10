"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import ToyCarSmoke from "@/components/ToyCarSmoke";
import type { CarInput } from "@/components/ToyCar";
import type { CarPose } from "@/components/ToyCarSmoke";
import {
  RacingTrack,
  FolioTopDownCam,
  TRACK_START,
} from "@/components/RacingTrack";
import {
  Terrain,
  groundHeight,
  groundGrip,
  groundCollide,
  TERRAIN_BOUNDS,
} from "@/components/Terrain";
import * as THREE from "three";
import Minimap from "@/components/Minimap";
import HandGestures from "@/components/HandGestures";
import AchievementTrophy from "@/components/AchievementTrophy";
import { TROPHY_POS } from "@/components/landmarkConfig";

type View = "track" | "smoke" | "html";

/* ---------- Loading Overlay ---------- */

function SceneLoader({ onReady }: { onReady: () => void }) {
  const called = useRef(false);
  const frameCount = useRef(0);

  // Once WebGL has compiled shaders and rendered the initial frames, signal scene ready.
  // This avoids any hooks that touch THREE.DefaultLoadingManager during render.
  useFrame(() => {
    frameCount.current++;
    if (!called.current && frameCount.current >= 4) {
      called.current = true;
      onReady();
    }
  });

  return null;
}

function LoadingScreen({ progress, visible }: { progress: number; visible: boolean }) {
  const r = 54;
  const stroke = 5;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(progress, 100) / 100) * circ;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a1238",
        transition: "opacity 0.5s ease-out",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <svg width={140} height={140} style={{ transform: "rotate(-90deg)" }}>
        {/* Track ring */}
        <circle
          cx={70} cy={70} r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        <circle
          cx={70} cy={70} r={r}
          fill="none"
          stroke="#ff7a1a"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 0.35s ease-out" }}
        />
      </svg>
      {/* Percentage centered on top of the SVG */}
      <span
        style={{
          position: "absolute",
          color: "#ffffff",
          fontSize: 22,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: 0.5,
        }}
      >
        {Math.round(progress)}
      </span>
    </div>
  );
}

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
  const [color, setColor] = useState("#5a3527");
  const [smokeOn, setSmokeOn] = useState(true);
  const [showCurbs, setShowCurbs] = useState(true);
  const [night, setNight] = useState(true);
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

  /* ---- Landmark Achievement Inspection State ---- */
  const [inspectingTrophy, setInspectingTrophy] = useState(false);
  const [isNearTrophy, setIsNearTrophy] = useState(false);
  const isNearTrophyRef = useRef(false);
  const inspectingTrophyRef = useRef(false);
  isNearTrophyRef.current = isNearTrophy;
  inspectingTrophyRef.current = inspectingTrophy;

  const emptyInput = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 1 });

  const handleTrophyNearChange = useCallback((near: boolean) => {
    setIsNearTrophy(near);
    if (!near) {
      setInspectingTrophy(false);
    }
  }, []);

  const trophyY = groundHeight(TROPHY_POS.x, TROPHY_POS.z);
  // Standing view: camera at eye level, shifted right of the cup (same heading, no turn), so the
  // cup sits on the left and the 3D hover panel (x +0.75..+2.2 from the cup) sits beside it.
  const inspectTarget = useMemo(
    () => new THREE.Vector3(TROPHY_POS.x + 0.78, trophyY + 1.45, TROPHY_POS.z),
    [trophyY]
  );
  // fov is 26, so 6.6 back fits the whole slender trophy (about 2.9 high with the ruby) and the panel.
  const inspectCamPos = useMemo(
    () => new THREE.Vector3(TROPHY_POS.x + 0.78, trophyY + 1.55, TROPHY_POS.z + 6.6),
    [trophyY]
  );

  /* ---- Loading state ---- */
  const [sceneReady, setSceneReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [canvasDeferred, setCanvasDeferred] = useState(false);

  // Defer canvas mount so the loading screen paints first
  useEffect(() => {
    // Two-frame delay: first frame paints loading screen, second mounts canvas
    let raf1: number, raf2: number;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setCanvasDeferred(true);
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, []);

  // Synthetic progress: terrain build is synchronous and heavy, so we simulate
  // progress from 0→70% over 2.5s while buildTerrain() runs, then drei's
  // useProgress fills in the final 70→100% as textures upload.
  useEffect(() => {
    if (sceneReady) { setLoadProgress(100); return; }
    if (!canvasDeferred) return;
    let t = 0;
    const interval = setInterval(() => {
      t += 80;
      // Ease-out curve capping at 70%
      const p = 70 * (1 - Math.exp(-t / 900));
      setLoadProgress(p);
    }, 80);
    return () => clearInterval(interval);
  }, [canvasDeferred, sceneReady]);

  const handleSceneReady = useCallback(() => {
    setLoadProgress(100);
    // Short delay to let the bar reach 100% visually before fading
    setTimeout(() => setSceneReady(true), 400);
  }, []);

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
      // If inspecting, pressing ANY button immediately exits and returns to normal driving view
      if (inspectingTrophyRef.current) {
        setInspectingTrophy(false);
        if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Escape" || e.code === "Space") {
          e.preventDefault();
          return;
        }
      }

      const k = KEY_MAP[e.code];
      if (k) {
        set(k, 1);
        e.preventDefault();
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        if (isNearTrophyRef.current) {
          setInspectingTrophy(true);
          e.preventDefault();
        }
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
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: night ? "#0a1238" : "#cbe2f2" }}
      onClick={() => {
        if (inspectingTrophyRef.current) setInspectingTrophy(false);
      }}
    >
      {is3d && canvasDeferred ? (
        <Canvas
          key={view === "track" ? "track" : "lab"}
          shadows
          camera={
            view === "track"
              ? { position: [20, 26, 20], fov: 26, near: 0.5, far: 800 }
              : { position: [6, 3.5, 7], fov: 40 }
          }
        >
          <SceneLoader onReady={handleSceneReady} />
          {view === "track" ? (
            <>
              <color attach="background" args={[night ? "#0a1238" : "#cbe2f2"]} />
              <fog attach="fog" args={night ? ["#0c1747", 35, 230] : ["#cbe2f2", 80, 420]} />
              <ambientLight intensity={night ? 0.55 : 0.7} color={night ? "#5a68ff" : "#ffffff"} />
              <hemisphereLight args={night ? ["#4a5cff", "#3a1a7a", 0.7] : ["#dbe9f6", "#739855", 0.55]} />
              <directionalLight
                position={night ? [-40, 75, -30] : [40, 75, 30]}
                intensity={night ? 1.5 : 1.35}
                color={night ? "#7b88ff" : "#ffffff"}
                castShadow
                shadow-mapSize={[1024, 1024]}
                shadow-camera-near={10}
                shadow-camera-far={200}
                shadow-camera-left={-75}
                shadow-camera-right={75}
                shadow-camera-top={75}
                shadow-camera-bottom={-75}
                shadow-bias={-0.0004}
              />
              <RacingTrack showCurbs={showCurbs} night={night} withTerrain={true} />
              <Terrain pose={pose} />
              <AchievementTrophy
                pose={pose}
                inspecting={inspectingTrophy}
                onNearChange={handleTrophyNearChange}
                onInspectToggle={setInspectingTrophy}
              />
              <ToyCarSmoke
                key={`car-${carResetKey}`}
                color={color}
                keyboard={false}
                input={inspectingTrophy ? emptyInput : input}
                onSpeed={onSpeed}
                smoke={smokeOn}
                terrain={groundHeight}
                grip={groundGrip}
                collide={groundCollide}
                pose={pose}
                bounds={TERRAIN_BOUNDS}
                start={TRACK_START}
                maxSpeed={18}
                carScale={0.65}
                model="r17"
                headlights={night}
              />
              <FolioTopDownCam
                pose={pose}
                zoomMultiplier={zoomMultiplier}
                inspecting={inspectingTrophy}
                inspectTarget={inspectTarget}
                inspectCamPos={inspectCamPos}
              />
            </>
          ) : (
            <>
              <ambientLight intensity={0.8} />
              <hemisphereLight args={["#ffffff", "#555555", 0.5]} />
              <directionalLight position={[4, 7, 5]} intensity={1.2} />
              <ToyCarSmoke color={color} keyboard={false} input={input} onSpeed={onSpeed} smoke={smokeOn} model="r17" />
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
          backgroundColor: "rgba(255,253,249,0.85)",
          padding: "8px 12px",
          borderRadius: 14,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
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
              <input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} />
              Night
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
        <div style={night ? { ...HINT, color: "#c9d1ff", textShadow: "0 1px 3px rgba(0,0,0,0.8)" } : HINT}>
          WASD or Arrow Keys to steer • Space to brake • Scroll wheel to zoom • M for Minimap • R to reset
        </div>
      )}

      {/* Loading overlay — covers everything until the scene is built */}
      <LoadingScreen progress={loadProgress} visible={!sceneReady} />

      {/* Global CSS keyframes for DOM overlays */}
      <style>{`
        @keyframes pillFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
