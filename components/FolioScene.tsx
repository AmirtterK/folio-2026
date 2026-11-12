"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import FolioCar from "@/components/FolioCar";
import type { CarInput } from "@/components/FolioCarBase";
import type { CarModel, CarPose } from "@/components/FolioCar";
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
import ChessKnight from "@/components/ChessKnight";
import NeuralNetworkHologram from "@/components/NeuralNetworkHologram";
import CarLoadingHologram from "@/components/CarLoadingHologram";
import LogoObstacle from "@/components/LogoObstacle";
import { TROPHY_POS, KNIGHT_POS, NEURAL_POS } from "@/components/landmarkConfig";

type View = "track" | "smoke" | "html";
type LandmarkId = "trophy" | "knight" | "neural";

/** Trees, bushes, rocks and stones farther than this from the car are not drawn (free cam draws everything). */
const SCENERY_RADIUS = 100;

/* ---------- Loading Overlay ---------- */

function LoadingScreen({ progress, visible }: { progress: number; visible: boolean }) {
  const r = 54;
  const stroke = 5;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(progress, 100) / 100) * circ;

  return (
    <div
      className="folio-loader"
      role="status"
      aria-live="polite"
      aria-label="Loading"
      data-progress={Math.round(progress)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
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
          stroke="#ffffff"
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
        {Math.round(progress)}%
      </span>
    </div>
  );
}

/* ---------- Free cam (orbit / pan / zoom around the map) ---------- */

function FreeCamControls({
  pose,
  input,
}: {
  pose: React.MutableRefObject<CarPose>;
  input: React.MutableRefObject<CarInput>;
}) {
  const camera = useThree((s) => s.camera);
  const controlsRef = useRef<any>(null);
  const tmp = useMemo(
    () => ({ fwd: new THREE.Vector3(), right: new THREE.Vector3(), move: new THREE.Vector3() }),
    []
  );
  // Orbit around whatever the chase camera was looking at (the car) when free cam was opened.
  // The camera keeps its current position, so entering free cam never jumps.
  const target = useMemo(
    () => new THREE.Vector3(pose.current.x, pose.current.y + 0.3, pose.current.z),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // WASD fly the camera across the map (relative to where it is looking)
  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const i = input.current;
    const f = (i.fwd ? 1 : 0) - (i.back ? 1 : 0);
    const r = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    if (!f && !r) return;

    const dt = Math.min(delta, 0.05);
    // forward = camera look direction flattened onto the ground
    camera.getWorldDirection(tmp.fwd);
    tmp.fwd.y = 0;
    if (tmp.fwd.lengthSq() < 1e-6) tmp.fwd.set(0, 0, -1);
    tmp.fwd.normalize();
    tmp.right.set(-tmp.fwd.z, 0, tmp.fwd.x);

    // faster when zoomed out, slower when zoomed in close
    const dist = camera.position.distanceTo(controls.target);
    const speed = Math.max(6, dist * 0.9);

    tmp.move
      .set(0, 0, 0)
      .addScaledVector(tmp.fwd, f)
      .addScaledVector(tmp.right, r)
      .normalize()
      .multiplyScalar(speed * dt);
    camera.position.add(tmp.move);
    controls.target.add(tmp.move);
  });

  return (
    <OrbitControls
      ref={controlsRef}
      target={target}
      enableDamping
      dampingFactor={0.08}
      zoomSpeed={1.2}
      panSpeed={1.1}
      rotateSpeed={0.8}
      minDistance={2}
      maxDistance={450}
      maxPolarAngle={Math.PI * 0.49} // can't dip under the ground
      screenSpacePanning={false} // right-drag slides across the map instead of up/down
    />
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

/** In free cam, WASD moves the camera (arrows keep driving the car). */
const CAM_KEYS: Record<string, "fwd" | "back" | "left" | "right"> = {
  KeyW: "fwd",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
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

export default function FolioScene() {
  const [view, setView] = useState<View>("track");
  const [color, setColor] = useState("#8d9196");
  const [carModel, setCarModel] = useState<CarModel>("ferrari");
  const [smokeOn, setSmokeOn] = useState(true);
  const [showCurbs, setShowCurbs] = useState(true);
  const [night, setNight] = useState(true);
  const [showMinimap, setShowMinimap] = useState(false);
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
  const [freeCam, setFreeCam] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const freeCamRef = useRef(false);
  freeCamRef.current = freeCam;

  /* ---- Touch device detection: phones/tablets get a tap prompt instead of the Enter key ---- */
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setIsTouch(coarse.matches || navigator.maxTouchPoints > 0);
    update();
    coarse.addEventListener?.("change", update);
    return () => coarse.removeEventListener?.("change", update);
  }, []);

  /* ---- Landmark inspection state: trophy, chess knight and neural network share the same flow ---- */
  const [inspecting, setInspecting] = useState<LandmarkId | null>(null);
  const [lastInspected, setLastInspected] = useState<LandmarkId | null>(null);
  useEffect(() => { if (inspecting) setLastInspected(inspecting); }, [inspecting]);
  const [nearLandmark, setNearLandmark] = useState<LandmarkId | null>(null);
  const nearLandmarkRef = useRef<LandmarkId | null>(null);
  const inspectingRef = useRef<LandmarkId | null>(null);
  nearLandmarkRef.current = nearLandmark;
  inspectingRef.current = inspecting;

  const obstacleVelocities = useRef<Record<string, THREE.Vector3>>({});
  const emptyInput = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 1 });
  // Free-cam movement keys (WASD) -- kept separate from the car's input so arrows can still drive
  const camKeys = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 0 });

  const handleLandmarkNearChange = useCallback((id: LandmarkId, near: boolean) => {
    setNearLandmark((cur) => (near ? id : cur === id ? null : cur));
    if (!near) setInspecting((cur) => (cur === id ? null : cur));
  }, []);

  // Standing view per landmark: camera at eye level, shifted right of the hologram (same heading, no
  // turn), so the landmark sits on the left and its floating holographic writing sits beside it.
  // The fov is 26, so 10 back frames the whole landmark on its shared base plus the text column.
  const inspectViews = useMemo(() => {
    const make = (x: number, z: number) => {
      const y = groundHeight(x, z);
      const back = isTouch ? 8.0 : 10.0;
      return {
        target: new THREE.Vector3(x + 0.9, y + 2.3, z),
        cam: new THREE.Vector3(x + 0.9, y + 2.4, z + back),
      };
    };
    return {
      trophy: make(TROPHY_POS.x, TROPHY_POS.z),
      knight: make(KNIGHT_POS.x, KNIGHT_POS.z),
      neural: make(NEURAL_POS.x, NEURAL_POS.z),
    };
  }, [isTouch]);

  /* ---- Tap-to-inspect handler for mobile (bypasses R3F pointer events, which are unreliable on touch) ---- */
  const MobileTapHandler = ({ pose }: { pose: MutableRefObject<CarPose> }) => {
    const { camera, scene, gl } = useThree();
    const raycaster = useRef(new THREE.Raycaster());
    const startRef = useRef<{ x: number; y: number; t: number } | null>(null);

    useEffect(() => {
      const el = gl.domElement;
      const onStart = (e: TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        e.preventDefault();
        startRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      };
      const onEnd = (e: TouchEvent) => {
        e.preventDefault();
        const s = startRef.current;
        startRef.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.hypot(dx, dy) > 12) return; // it was a drag/pan, not a tap
        if (Date.now() - s.t > 400) return;

        const rect = el.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((t.clientX - rect.left) / rect.width) * 2 - 1,
          -((t.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.current.setFromCamera(ndc, camera);
        const hits = raycaster.current.intersectObjects(scene.children, true);
        const hit = hits.find((h) => h.object.userData?.landmark || h.object.userData?.link);

        if (hit && hit.object.userData?.link) {
          // tapping a link: let the click open it, don't exit
          return;
        }

        if (inspectingRef.current) {
          // any tap that isn't a link exits the inspection view
          setInspecting(null);
          return;
        }

        if (hit && hit.object.userData?.landmark) {
          const id = hit.object.userData.landmark as LandmarkId;
          const p = pose.current;
          const landmarkPos =
            id === "trophy"
              ? { x: TROPHY_POS.x, z: TROPHY_POS.z }
              : id === "knight"
              ? { x: KNIGHT_POS.x, z: KNIGHT_POS.z }
              : { x: NEURAL_POS.x, z: NEURAL_POS.z };
          const dist = Math.hypot(p.x - landmarkPos.x, p.z - landmarkPos.z);
          if (dist < 7.0) {
            setInspecting(id);
          }
        }
      };
      el.addEventListener("touchstart", onStart, { passive: false });
      el.addEventListener("touchend", onEnd, { passive: false });
      return () => {
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchend", onEnd);
      };
    }, [camera, scene, gl, pose]);

    return null;
  };
  const [sceneReady, setSceneReady] = useState(false);
  const [carReady, setCarReady] = useState(false);
  const [carLoaded, setCarLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [canvasDeferred, setCanvasDeferred] = useState(false);
  const readySignaled = useRef(false);

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

  // Synthetic progress while the scene builds: creep up to 92% quickly, then the
  // car signals readiness and we jump to 100%.
  useEffect(() => {
    if (sceneReady) { setLoadProgress(100); return; }
    if (!canvasDeferred || carReady) return;
    let t = 0;
    const interval = setInterval(() => {
      t += 80;
      // Ease-out curve capping at 92% until the car is actually ready
      const p = 92 * (1 - Math.exp(-t / 450));
      setLoadProgress((prev) => Math.max(prev, Math.min(92, p)));
    }, 80);
    return () => clearInterval(interval);
  }, [canvasDeferred, carReady, sceneReady]);

  // Called by FolioCar only after the GLB body has mounted in the scene.
  const handleSceneReady = useCallback(() => {
    setCarLoaded(true);
    setCarReady(true);
    setLoadProgress(100);
    if (readySignaled.current) return;
    readySignaled.current = true;
    // Let the ring visibly reach 100% before fading the overlay out.
    setTimeout(() => setSceneReady(true), 350);
  }, []);

  const set = (k: keyof CarInput, v: 0 | 1) => {
    input.current[k] = v;
    // return the same object when nothing changed, so key auto-repeat doesn't re-render the whole scene every keydown
    setPressed((p) => (!!p[k] === !!v ? p : { ...p, [k]: !!v }));
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
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (typing) return;
      // The car dropdown keeps focus after a pick. Let it handle menu navigation, but any other
      // key should blur it and reach the game shortcuts instead of the select's type-ahead
      // jumping to "Ferrari" / "Renault" and silently changing the car.
      if (tag === "SELECT") {
        const menuKeys = [
          "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
          "Enter", "NumpadEnter", "Escape", "Space", "Tab",
          "Home", "End", "PageUp", "PageDown",
        ];
        if (menuKeys.includes(e.code)) return;
        target?.blur();
        e.preventDefault();
      }

      // Map overlay: M toggles, Esc closes, and driving shortcuts pause while it is open.
      if (e.code === "KeyM" && !e.repeat) {
        e.preventDefault();
        setShowMinimap((v) => !v);
        return;
      }
      if (showMinimap) {
        if (e.code === "Escape") {
          e.preventDefault();
          setShowMinimap(false);
        }
        return;
      }

      // Free cam: F toggles, Esc exits
      if (e.code === "KeyF" && !e.repeat) {
        e.preventDefault();
        setInspecting(null);
        setFreeCam((v) => !v);
        return;
      }
      if (e.code === "Escape" && freeCamRef.current) {
        setFreeCam(false);
        e.preventDefault();
        return;
      }

      // If inspecting, pressing ANY button immediately exits and returns to normal driving view
      if (inspectingRef.current) {
        setInspecting(null);
        if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Escape" || e.code === "Space") {
          e.preventDefault();
          return;
        }
      }

      // Free cam: WASD moves the camera, arrows (handled below) still drive the car
      const camK = CAM_KEYS[e.code];
      if (freeCamRef.current && camK) {
        camKeys.current[camK] = 1;
        e.preventDefault();
        return;
      }

      const k = KEY_MAP[e.code];
      if (k) {
        set(k, 1);
        e.preventDefault();
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        const near = nearLandmarkRef.current;
        if (near && !freeCamRef.current) {
          setInspecting(near);
          e.preventDefault();
        }
      }
      if (e.code === "KeyR") {
        resetCar();
      }
    };
    const up = (e: KeyboardEvent) => {
      const camK = CAM_KEYS[e.code];
      if (camK) camKeys.current[camK] = 0;
      const k = KEY_MAP[e.code];
      if (k) set(k, 0);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [resetCar, showMinimap]);

  // Mouse wheel zoom in track view
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (view !== "track" || freeCamRef.current) return; // free cam zooms via OrbitControls
      setZoomMultiplier((z) => Math.min(1.8, Math.max(0.65, z + e.deltaY * 0.001)));
    },
    [view]
  );

  // Leaving the track view always ends free cam and closes the full-screen map.
  useEffect(() => {
    if (view !== "track") {
      setFreeCam(false);
      setShowMinimap(false);
    }
  }, [view]);

  // Entering/leaving free cam: drop any held movement so nothing gets stuck or drives off
  useEffect(() => {
    camKeys.current.fwd = camKeys.current.back = camKeys.current.left = camKeys.current.right = 0;
    set("fwd", 0);
    set("back", 0);
    set("left", 0);
    set("right", 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeCam]);

  useEffect(() => {
    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const hold = (k: keyof CarInput, label: string, aria: string) => (
    <button
      aria-label={aria}
      className="folio-drive-btn"
      style={{
        ...BTN,
        ...(pressed[k] ? { backgroundColor: "#111111", color: "#fff", borderColor: "#111111" } : {}),
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
      className="folio-tab"
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
      className="folio-app"
      data-touch={isTouch ? "true" : "false"}
      style={{ position: "fixed", inset: 0, backgroundColor: night ? "#0a1238" : "#cbe2f2" }}
      onClick={() => {
        if (inspectingRef.current) setInspecting(null);
      }}
    >
      {is3d && canvasDeferred ? (
        <Canvas
          key={view === "track" ? "track" : "lab"}
          shadows
          dpr={[1, 2]}
          frameloop={showMinimap ? "never" : "always"}
          camera={
            view === "track"
              ? { position: [20, 26, 20], fov: 26, near: 0.5, far: 800 }
              : { position: [6, 3.5, 7], fov: 40 }
          }
        >
          {view === "track" ? (
            <>
              <color attach="background" args={[night ? "#0a1238" : "#cbe2f2"]} />
              <fog
                attach="fog"
                args={
                  freeCam
                    ? night
                      ? ["#0c1747", 150, 780]
                      : ["#cbe2f2", 250, 780]
                    : night
                      ? ["#0c1747", 35, 230]
                      : ["#cbe2f2", 80, 420]
                }
              />
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
                shadow-normalBias={0.03}
              />
              <RacingTrack showCurbs={showCurbs} night={night} withTerrain={true} pose={pose} />
              <Terrain pose={pose} radius={freeCam ? Infinity : SCENERY_RADIUS} />
              <ChessKnight
                pose={pose}
                night={night}
                inspecting={inspecting === "knight"}
                onNearChange={(near) => handleLandmarkNearChange("knight", near)}
                onInspectToggle={(on) => setInspecting(on ? "knight" : null)}
                touch={isTouch}
              />
              <NeuralNetworkHologram
                pose={pose}
                night={night}
                inspecting={inspecting === "neural"}
                onNearChange={(near) => handleLandmarkNearChange("neural", near)}
                onInspectToggle={(on) => setInspecting(on ? "neural" : null)}
                touch={isTouch}
              />
              <AchievementTrophy
                pose={pose}
                night={night}
                inspecting={inspecting === "trophy"}
                onNearChange={(near) => handleLandmarkNearChange("trophy", near)}
                onInspectToggle={(on) => setInspecting(on ? "trophy" : null)}
                touch={isTouch}
              />
              <MobileTapHandler pose={pose} />
              <CarLoadingHologram pose={pose} visible={!carLoaded} night={night} />
              <LogoObstacle position={[0, 0.8, 0]} color="#D97757" pose={pose} id="claude" velocities={obstacleVelocities} />
              <LogoObstacle position={[3, 0.8, 0]} color="#7A9DFF" pose={pose} id="codex" velocities={obstacleVelocities} />
              <LogoObstacle position={[-3, 0.8, 0]} color="#ffffff" pose={pose} id="chatgpt" velocities={obstacleVelocities} />
              <LogoObstacle position={[0, 0.8, 4]} color="#EEEEEE" pose={pose} id="lobe" velocities={obstacleVelocities} />
              <FolioCar
                key={`car-${carResetKey}-${carModel}`}
                color={color}
                keyboard={false}
                input={inspecting || !carLoaded ? emptyInput : input}
                onSpeed={onSpeed}
                smoke={smokeOn && carLoaded}
                terrain={groundHeight}
                grip={groundGrip}
                collide={groundCollide}
                pose={pose}
                bounds={TERRAIN_BOUNDS}
                start={TRACK_START}
                maxSpeed={18}
                carScale={0.75075}
                model={carModel}
                headlights={night}
                onReady={handleSceneReady}
              />
              <FolioTopDownCam
                pose={pose}
                zoomMultiplier={zoomMultiplier}
                mobile={isTouch}
                inspecting={!!inspecting}
                inspectTarget={inspecting ? inspectViews[inspecting].target : (lastInspected ? inspectViews[lastInspected].target : undefined)}
                inspectCamPos={inspecting ? inspectViews[inspecting].cam : (lastInspected ? inspectViews[lastInspected].cam : undefined)}
                freeCam={freeCam}
              />
              {freeCam && <FreeCamControls pose={pose} input={camKeys} />}
            </>
          ) : (
            <>
              <ambientLight intensity={0.8} />
              <hemisphereLight args={["#ffffff", "#555555", 0.5]} />
              <directionalLight position={[4, 7, 5]} intensity={1.2} />
              <FolioCar key={carModel} color={color} keyboard={false} input={carLoaded ? input : emptyInput} onSpeed={onSpeed} smoke={smokeOn && carLoaded} carScale={1.155} model={carModel} onReady={handleSceneReady} />
              <OrbitControls target={[0, 1, 0]} />
            </>
          )}
        </Canvas>
      ) : is3d ? null : (
        <iframe title="Classic car" src="/classic-car.html" style={{ width: "100%", height: "100%", border: 0 }} />
      )}

      {/* Top Header Controls Bar */}
      <div
        className="folio-toolbar"
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
        {tab("track", "Racing Track")}
        {tab("smoke", "Detailed Car")}
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
            Car
            <select
              className="folio-select"
              value={carModel}
              onChange={(e) => {
                const next = e.target.value as CarModel;
                if (next === carModel) return;
                setCarLoaded(false); // keep the new car still (and light/smoke-free) until its GLB is in
                setCarModel(next);
                resetCar(); // respawn on the grid with the new car
                e.currentTarget.blur();
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 9,
                border: "1.5px solid #cfc8bd",
                backgroundColor: "#fffdf9",
                color: "#2a2622",
                font: "inherit",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              <option value="ferrari">Ferrari F599</option>
              <option value="r17">Renault R17</option>
              <option value="sf90">Ferrari SF90</option>
              <option value="nissan">Nissan Silvia S15</option>
              <option value="porsche">Porsche Panamera</option>
              <option value="corvette">Corvette Stingray</option>
            </select>
          </label>
        )}

        {is3d && carModel === "r17" && (
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

            <button
              onClick={() => setShowMinimap(true)}
              title="Open map (or press 'M')"
              className="folio-map-btn"
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
              Map
            </button>

            <button
              onClick={() => {
                setInspecting(null);
                setFreeCam((v) => !v);
              }}
              title="Free cam: orbit, pan and zoom around the map. Press F or Esc to return."
              style={{
                padding: "7px 12px",
                borderRadius: 9,
                borderWidth: 1.5,
                borderStyle: "solid",
                borderColor: freeCam ? "#111111" : "#cfc8bd",
                backgroundColor: freeCam ? "#111111" : "#fffdf9",
                color: freeCam ? "#ffffff" : "#2a2622",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                marginLeft: 4,
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              {freeCam ? "Exit free cam [F]" : "Free cam [F]"}
            </button>

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
              Reset [R]
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
            className="folio-speed"
            style={{
              position: "fixed",
              bottom: 92,
              right: 20,
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
            Speed <span ref={speedRef} style={{ fontSize: 18, fontWeight: 700, color: "#111111" }}>0.0</span> u/s
          </div>

          {/* On-screen touch buttons for mobile / mouse */}
          <div
            className="folio-touch"
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
            <div className="folio-touch-group" style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
              {hold("left", "\u25C0", "Steer left")}
              {hold("right", "\u25B6", "Steer right")}
            </div>
            <div className="folio-touch-group" style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
              {hold("back", "\u25BC", "Reverse")}
              {hold("fwd", "\u25B2", "Forward")}
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
        />
      )}

      {view === "track" && (
        <div className="folio-hint" style={night ? { ...HINT, color: "#c9d1ff", textShadow: "0 1px 3px rgba(0,0,0,0.8)" } : HINT}>
          {freeCam
            ? "FREE CAM | WASD to move camera | Arrows to drive | Drag to orbit | Right-drag to pan | Scroll to zoom | F or Esc to go back"
            : "WASD or Arrow Keys to steer | Space to brake | Scroll wheel to zoom | M for map | R to reset | F for free cam"}
        </div>
      )}

      {/* Loading overlay -- covers everything until the car is in the scene */}
      <LoadingScreen progress={loadProgress} visible={!sceneReady} />

      {/* Global CSS keyframes and responsive layout for DOM overlays */}
      <style>{`
        @keyframes pillFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }

        .folio-toolbar {
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .folio-toolbar::-webkit-scrollbar { display: none; }

        canvas { touch-action: manipulation; }

        @media (max-width: 760px), (pointer: coarse) and (max-height: 600px) {
          .folio-toolbar {
            top: max(8px, env(safe-area-inset-top)) !important;
            left: 8px !important;
            right: 8px !important;
            padding: 6px 8px !important;
            gap: 6px !important;
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            border-radius: 12px !important;
          }
          .folio-toolbar > * { flex: 0 0 auto; }
          .folio-toolbar .folio-map-btn { order: -1; }
          .folio-toolbar > label {
            margin-left: 2px !important;
            font-size: 12px !important;
            white-space: nowrap;
          }
          .folio-toolbar > label > span,
          .folio-toolbar > label { white-space: nowrap; }
          .folio-toolbar .folio-tab {
            padding: 7px 10px !important;
            font-size: 12px !important;
          }
          .folio-toolbar .folio-map-btn,
          .folio-toolbar button {
            padding: 7px 10px !important;
            font-size: 12px !important;
          }
          .folio-toolbar .folio-select {
            max-width: 148px;
            padding: 5px 8px !important;
            font-size: 12px !important;
          }
          .folio-speed {
            top: auto !important;
            bottom: max(70px, calc(env(safe-area-inset-bottom) + 62px)) !important;
            right: 10px !important;
            padding: 4px 10px !important;
            font-size: 12px !important;
          }
          .folio-speed span { font-size: 16px !important; }
          .folio-touch {
            bottom: max(10px, env(safe-area-inset-bottom)) !important;
            left: 10px !important;
            right: 10px !important;
          }
          .folio-touch-group { gap: 8px !important; }
          .folio-drive-btn {
            width: 52px !important;
            height: 52px !important;
            border-radius: 14px !important;
            font-size: 20px !important;
          }
          .folio-hint { display: none !important; }
        }

        @media (max-width: 420px) {
          .folio-toolbar {
            top: max(6px, env(safe-area-inset-top)) !important;
            left: 6px !important;
            right: 6px !important;
            padding: 5px 7px !important;
            gap: 5px !important;
          }
          .folio-toolbar .folio-tab,
          .folio-toolbar .folio-map-btn,
          .folio-toolbar button {
            padding: 6px 8px !important;
            font-size: 11px !important;
          }
          .folio-toolbar .folio-select { max-width: 132px; }
          .folio-speed { bottom: max(66px, calc(env(safe-area-inset-bottom) + 58px)) !important; }
          .folio-drive-btn {
            width: 48px !important;
            height: 48px !important;
            font-size: 18px !important;
          }
        }
      `}</style>
    </div>
  );
}
