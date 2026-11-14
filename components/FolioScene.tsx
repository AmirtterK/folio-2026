"use client";

import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from "react";
import type { MutableRefObject } from "react";
import dynamic from "next/dynamic";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
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

const HandGestures = dynamic(() => import("@/components/HandGestures"), { ssr: false });
import ChessKnight from "@/components/ChessKnight";
import NeuralNetworkHologram from "@/components/NeuralNetworkHologram";
import PrinterInteractive from "@/components/PrinterInteractive";
import GmailInteractive from "@/components/GmailInteractive";
import DiplomaLandmark from "@/components/DiplomaLandmark";
import LinkedInInteractive from "@/components/LinkedInInteractive";
import CarLoadingHologram from "@/components/CarLoadingHologram";
import MovableLogo from "@/components/MovableLogo";
import { PhysicsProvider } from "@/components/PhysicsProvider";
import ExampleModels from "@/components/ExampleModels";
import { ClaudeCodeLogo } from "@/components/ClaudeCodeLogo";
import { CodexLogo } from "@/components/CodexLogo";
import { OpenAILogo } from "@/components/OpenAILogo";
import * as R3FLogos from "@/components/r3f-logos";
import { KNIGHT_POS, NEURAL_POS, PRINTER_POS, GMAIL_POS, DIPLOMA_POS, LINKEDIN_POS } from "@/components/landmarkConfig";

type View = "track" | "smoke";
type LandmarkId = "knight" | "neural" | "printer" | "gmail" | "diploma" | "linkedin";

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
        pointerEvents: "none",
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

/* ---------- Fixed camera (locked position/orbit, rotate only) ---------- */

function FreeCamControls({
  pose,
  input: _input,
  controlsRef: externalRef,
  inspecting = false,
  mobile = false,
}: {
  pose: React.MutableRefObject<CarPose>;
  input: React.MutableRefObject<CarInput>;
  controlsRef?: React.MutableRefObject<any>;
  inspecting?: boolean;
  mobile?: boolean;
}) {
  const { camera } = useThree();
  const internalRef = useRef<any>(null);
  const controlsRef = externalRef ?? internalRef;
  // Start looking in this direction, attached to the car (orbit target follows car)
  const baseDefaultDistance = 38;
  const startDistance = mobile ? baseDefaultDistance : baseDefaultDistance * 0.95; // PC: zoom in 5% on start
  const minDistance = 12;
  const maxDistance = 80;
  const viewDir = useMemo(() => new THREE.Vector3(-0.699, -0.12, -0.705).normalize(), []);
  const carDelta = useMemo(() => new THREE.Vector3(), []);

  // Keep the orbit pivot on the car so camera stays attached and moves with it
  useFrame(() => {
    const c = controlsRef.current;
    if (!c || inspecting) return;
    const p = pose.current;
    carDelta.set(p.x, p.y + 1.2, p.z).sub(c.target);
    if (carDelta.lengthSq() < 1e-8) return;
    c.target.add(carDelta);
    camera.position.add(carDelta);
  });

  // Place camera once at start looking in requested direction toward the car
  useEffect(() => {
    const initialTarget = new THREE.Vector3(pose.current.x, pose.current.y + 1.2, pose.current.z);
    const offset = viewDir.clone().multiplyScalar(-startDistance);
    camera.position.copy(initialTarget).add(offset);
    camera.lookAt(initialTarget);
    const c = controlsRef.current;
    if (c) {
      c.target.copy(initialTarget);
      c.update();
    }
  }, [camera, controlsRef, viewDir, pose, startDistance]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!inspecting}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.8}
      enablePan={false}
      enableZoom={true}
      minDistance={minDistance}
      maxDistance={maxDistance}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI / 2 - 0.08}
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

function CameraDebugUpdater({
  controlsRef,
  posRef,
  dirRef,
  targetRef,
}: {
  controlsRef: MutableRefObject<any>;
  posRef: MutableRefObject<HTMLDivElement | null>;
  dirRef: MutableRefObject<HTMLDivElement | null>;
  targetRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const { camera } = useThree();
  const dir = useMemo(() => new THREE.Vector3(), []);
  const fmt = (n: number, d = 2) => n.toFixed(d);
  useFrame(() => {
    camera.getWorldDirection(dir);
    const t = controlsRef.current?.target;
    if (posRef.current) posRef.current.textContent = `pos: [${fmt(camera.position.x)}, ${fmt(camera.position.y)}, ${fmt(camera.position.z)}]`;
    if (dirRef.current) dirRef.current.textContent = `dir: [${fmt(dir.x, 3)}, ${fmt(dir.y, 3)}, ${fmt(dir.z, 3)}]`;
    if (targetRef.current) {
      const tx = t ? t.x : camera.position.x + dir.x;
      const ty = t ? t.y : camera.position.y + dir.y;
      const tz = t ? t.z : camera.position.z + dir.z;
      targetRef.current.textContent = `target: [${fmt(tx)}, ${fmt(ty)}, ${fmt(tz)}]`;
    }
  });
  return null;
}

function CameraPositionApplier({
  controlsRef,
  position,
  applyTick,
  hold,
}: {
  controlsRef: MutableRefObject<any>;
  position: { x: number; y: number; z: number };
  applyTick: number;
  hold?: boolean;
}) {
  const { camera } = useThree();
  useEffect(() => {
    if (applyTick <= 0) return;
    camera.position.set(position.x, position.y, position.z);
    const c = controlsRef.current;
    if (c?.target) {
      c.update?.();
    }
    camera.updateProjectionMatrix?.();
  }, [applyTick, position.x, position.y, position.z, camera, controlsRef]);
  useFrame(() => {
    if (!hold) return;
    camera.position.set(position.x, position.y, position.z);
  });
  return null;
}

function Joystick({ input }: { input: MutableRefObject<CarInput> }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const radius = 46;
  const knobRadius = 22;

  const reset = () => {
    active.current = false;
    setKnob({ x: 0, y: 0 });
    input.current.fwd = 0;
    input.current.back = 0;
    input.current.left = 0;
    input.current.right = 0;
  };

  const update = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const max = radius - knobRadius / 2;
    if (dist > max && dist > 0) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    setKnob({ x: dx, y: dy });

    const nx = Math.max(-1, Math.min(1, dx / max));
    const ny = Math.max(-1, Math.min(1, dy / max));
    const dead = 0.18;
    input.current.left = nx < -dead ? 1 : 0;
    input.current.right = nx > dead ? 1 : 0;
    input.current.fwd = ny < -dead ? 1 : 0;
    input.current.back = ny > dead ? 1 : 0;
  };

  return (
    <div
      ref={baseRef}
      onPointerDown={(e) => {
        active.current = true;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (active.current) update(e.clientX, e.clientY);
      }}
      onPointerUp={reset}
      onPointerCancel={reset}
      style={{
        width: radius * 2,
        height: radius * 2,
        borderRadius: "50%",
        background: "rgba(255,253,249,0.78)",
        border: "2px solid #cfc8bd",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        position: "relative",
        touchAction: "none",
        userSelect: "none",
      }}
      aria-label="Drive joystick"
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: knobRadius * 2,
          height: knobRadius * 2,
          borderRadius: "50%",
          background: "#2a2622",
          border: "2px solid #111",
          transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
          boxShadow: "0 2px 4px rgba(0,0,0,0.25)",
        }}
      />
    </div>
  );
}

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
  // Temporary model rotation debug controls (degrees) - LinkedIn
  const [linkedinRotDeg, setLinkedinRotDeg] = useState({ x: 90, y: 0, z: -50 });
  const [camEdit, setCamEdit] = useState({ x: 20, y: 26, z: 20 });
  const [camApplyTick, setCamApplyTick] = useState(0);
  const [manualCamHold, setManualCamHold] = useState(false);
  const [inspectCamDistanceOffset, setInspectCamDistanceOffset] = useState(2);
  const camPosRef = useRef<HTMLDivElement>(null);
  const camDirRef = useRef<HTMLDivElement>(null);
  const camTargetRef = useRef<HTMLDivElement>(null);
  const input = useRef<CarInput>({ fwd: 0, back: 0, left: 0, right: 0, brake: 0 });
  const pose = useRef<CarPose>({
    x: TRACK_START.x,
    y: TRACK_START.y,
    z: TRACK_START.z,
    yaw: TRACK_START.yaw,
    speed: 0,
  });
  const orbitControlsRef = useRef<any>(null);
  const [gestures, setGestures] = useState(false);
  // Always on: OrbitControls (drag + hand gestures) must own the camera. It was never set to true anywhere,
  // so <FreeCamControls> never mounted and both drag and gestures had nothing to control.
  const [freeCam, setFreeCam] = useState(true);
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
  const [inspecting, setInspectingRaw] = useState<LandmarkId | null>(null);
  // When inspection opens we stamp the time, so the click that opened it can't also bubble to the root
  // div's "click anywhere closes inspection" handler and shut it again in the same gesture.
  const inspectStartRef = useRef(0);
  const setInspecting = useCallback((v: React.SetStateAction<LandmarkId | null>) => {
    if (v) inspectStartRef.current = performance.now();
    setInspectingRaw(v);
  }, []);
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

  // Inspect views: camera looks in a consistent direction relative to each object.
  // Objects framed toward left, text/right-side content toward right.
  const inspectViews = useMemo(() => {
    const VIEW_DIR = new THREE.Vector3(-0.699, -0.12, -0.705).normalize();
    const right = new THREE.Vector3().crossVectors(VIEW_DIR, new THREE.Vector3(0, 1, 0)).normalize();
    const frameShift = right.clone().multiplyScalar(isTouch ? 1.2 : 1.5);
    const make = (x: number, z: number) => {
      const y = groundHeight(x, z);
      const dist = (isTouch ? 11.0 : 10.0) * 1.1 + inspectCamDistanceOffset;
      const target = new THREE.Vector3(x, y + (isTouch ? 3.5 : 2.6), z).add(frameShift);
      const cam = target.clone().addScaledVector(VIEW_DIR, -dist);
      cam.y += (isTouch ? 0.35 : -0.05) - 1;
      return { target, cam };
    };
    const makeContact = (x: number, z: number) => {
      const y = groundHeight(x, z);
      const dist = (isTouch ? 11.5 : 11.0) * 1.21 + inspectCamDistanceOffset; // zoom out for contacts
      const target = new THREE.Vector3(x, y + (isTouch ? 3.9 : 3.2), z).add(frameShift); // aim higher
      const cam = target.clone().addScaledVector(VIEW_DIR, -dist);
      cam.y += (isTouch ? -0.2 : -0.45) - 1; // camera lower
      return { target, cam };
    };
    const makeHover = (x: number, z: number, hoverY: number) => {
      const dist = (isTouch ? 11.5 : 11.0) * 1.21 + inspectCamDistanceOffset; // zoom out for diploma
      const target = new THREE.Vector3(x, hoverY + (isTouch ? 1.0 : 0.9), z).add(frameShift); // aim higher
      const cam = target.clone().addScaledVector(VIEW_DIR, -dist);
      cam.y += (isTouch ? -0.2 : -0.45) - 1; // camera lower
      return { target, cam };
    };
    return {
      knight: make(KNIGHT_POS.x, KNIGHT_POS.z),
      neural: make(NEURAL_POS.x, NEURAL_POS.z),
      printer: makeContact(PRINTER_POS.x, PRINTER_POS.z),
      gmail: makeContact(GMAIL_POS.x, GMAIL_POS.z),
      diploma: makeHover(DIPLOMA_POS.x, DIPLOMA_POS.z, groundHeight(DIPLOMA_POS.x, DIPLOMA_POS.z) + 2.2),
      linkedin: makeContact(LINKEDIN_POS.x, LINKEDIN_POS.z),
    };
  }, [isTouch, inspectCamDistanceOffset]);

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
        startRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      };
      const onEnd = (e: TouchEvent) => {
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
            id === "knight"
              ? { x: KNIGHT_POS.x, z: KNIGHT_POS.z }
              : id === "neural"
              ? { x: NEURAL_POS.x, z: NEURAL_POS.z }
              : id === "printer"
              ? { x: PRINTER_POS.x, z: PRINTER_POS.z }
              : id === "gmail"
              ? { x: GMAIL_POS.x, z: GMAIL_POS.z }
              : id === "diploma"
              ? { x: DIPLOMA_POS.x, z: DIPLOMA_POS.z }
              : { x: LINKEDIN_POS.x, z: LINKEDIN_POS.z };
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
      // jumping to another car and silently changing the car.
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

      // Hand gestures: G toggles
      if (e.code === "KeyG" && !e.repeat) {
        e.preventDefault();
        setInspecting(null);
        setGestures((v) => !v);
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

      // Fixed camera mode: WASD/arrow keys still drive the car only (camera stays locked)
      const camK = CAM_KEYS[e.code];
      if (camK) {
        // ignore camera movement keys
      }

      const k = KEY_MAP[e.code];
      if (k) {
        set(k, 1);
        e.preventDefault();
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        const near = nearLandmarkRef.current;
        if (near) {
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

  // Leaving the track view closes the full-screen map.
  useEffect(() => {
    if (view !== "track") {
      setShowMinimap(false);
      setInspecting(null);
    }
  }, [view]);

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



  return (
    <div
      className="folio-app"
      data-touch={isTouch ? "true" : "false"}
      style={{ position: "fixed", inset: 0, backgroundColor: night ? "#0a1238" : "#cbe2f2" }}
      onClick={() => {
        if (inspectingRef.current && performance.now() - inspectStartRef.current > 400) setInspecting(null);
      }}
    >
      {canvasDeferred && (
        <Canvas
          key={view === "track" ? "track" : "lab"}
          shadows
          dpr={[1, 1.5]}
          frameloop="always"
          performance={{ min: 0.5 }}
          camera={
            view === "track"
              ? { position: [20, 26, 20], fov: 26, near: 0.5, far: 800 }
              : { position: [6, 3.5, 7], fov: 40 }
          }
        >
          {view === "track" ? (
            <PhysicsProvider pose={pose}>
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
              {/* Night environment reflections disabled to avoid load hangs */}
              <ambientLight intensity={night ? 0.45 : 0.7} color={night ? "#6a78d8" : "#ffffff"} />
              <hemisphereLight args={night ? ["#6f86d6", "#14182b", 0.45] : ["#dbe9f6", "#739855", 0.55]} />
              {/* Sun / Moon key light */}
              <directionalLight
                position={night ? [40, 90, -30] : [40, 75, 30]}
                intensity={night ? 0.85 : 1.35}
                color={night ? "#c9d8ff" : "#ffffff"}
                castShadow
                shadow-mapSize={[1024, 1024]}
                shadow-camera-near={10}
                shadow-camera-far={220}
                shadow-camera-left={-75}
                shadow-camera-right={75}
                shadow-camera-top={75}
                shadow-camera-bottom={-75}
                shadow-bias={-0.0004}
                shadow-normalBias={0.03}
              />
              <RacingTrack showCurbs={showCurbs} night={night} withTerrain={true} pose={pose} />
              <Terrain />
              <axesHelper args={[10]} position={[TRACK_START.x, TRACK_START.y + 0.05, TRACK_START.z]} />
              <gridHelper args={[20, 20, "#ff4444", "#888888"]} position={[TRACK_START.x, TRACK_START.y + 0.02, TRACK_START.z]} />
              <ExampleModels />
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
              <PrinterInteractive
                pose={pose}
                night={night}
                inspecting={inspecting === "printer"}
                onNearChange={(near) => handleLandmarkNearChange("printer", near)}
                onInspectToggle={(on) => setInspecting(on ? "printer" : null)}
                touch={isTouch}
              />
              <GmailInteractive
                pose={pose}
                night={night}
                inspecting={inspecting === "gmail"}
                onNearChange={(near) => handleLandmarkNearChange("gmail", near)}
                onInspectToggle={(on) => setInspecting(on ? "gmail" : null)}
                touch={isTouch}
              />
              <DiplomaLandmark
                pose={pose}
                night={night}
                inspecting={inspecting === "diploma"}
                onNearChange={(near) => handleLandmarkNearChange("diploma", near)}
                onInspectToggle={(on) => setInspecting(on ? "diploma" : null)}
                touch={isTouch}
              />
              <LinkedInInteractive
                pose={pose}
                night={night}
                inspecting={inspecting === "linkedin"}
                onNearChange={(near) => handleLandmarkNearChange("linkedin", near)}
                onInspectToggle={(on) => setInspecting(on ? "linkedin" : null)}
                touch={isTouch}
                debugRotation={{
                  x: (linkedinRotDeg.x * Math.PI) / 180,
                  y: (linkedinRotDeg.y * Math.PI) / 180,
                  z: (linkedinRotDeg.z * Math.PI) / 180,
                }}
              />
              <MobileTapHandler pose={pose} />
              <CarLoadingHologram pose={pose} visible={!carLoaded} night={night} />
              {[
                R3FLogos.ClaudeCodeLogo,
                R3FLogos.CodexLogo,
                R3FLogos.OpenAILogo,
                R3FLogos.OpenCodeLogo,
                R3FLogos.JavaScriptLogo,
                R3FLogos.TypeScriptLogo,
                R3FLogos.TailwindLogo,
                R3FLogos.NextJsLogo,
                R3FLogos.ThreeJsLogo,
                R3FLogos.ExpressLogo,
                R3FLogos.ViteLogo,
                R3FLogos.GitLogo,
                R3FLogos.PhpLogo,
                R3FLogos.MySqlLogo,
                R3FLogos.ShadcnLogo,
                R3FLogos.FlutterLogo,
                R3FLogos.DartLogo,
                R3FLogos.FirebaseLogo,
                R3FLogos.SqliteLogo,
                R3FLogos.ArduinoLogo,
                R3FLogos.CLogo,
                R3FLogos.PythonLogo,
                R3FLogos.JavaLogo,
                R3FLogos.BashLogo,
                R3FLogos.PostgreSqlLogo,
                R3FLogos.SupabaseLogo,
              ].map((Logo, i, arr) => {
                // 3 per row (n%3), last row gets the remainder (2) placed at the end on-road
                const perRow = 3;
                const row = Math.floor(i / perRow);
                const col = i % perRow;
                const totalRows = Math.ceil(arr.length / perRow);
                const itemsInRow = row === totalRows - 1 ? arr.length - row * perRow : perRow;
                const colOffset = col - (itemsInRow - 1) / 2; // centers last row when it has 2
                const x = 34 - row * 8.0;
                const z = 57 + colOffset * 3.7;
                const logoRotation: [number, number, number] = [0.017453, 0.872665, 0]; // X:1°, Y:50°, Z:0°
                return (
                  <MovableLogo key={i} position={[x, 0, z]}>
                    <Logo size={3} rotation={logoRotation} />
                  </MovableLogo>
                );
              })}
              <FolioCar
                key={`car-${carResetKey}-${carModel}`}
                color={color}
                keyboard={false}
                input={inspecting || !carLoaded ? emptyInput : input}
                smoke={smokeOn && carLoaded}
                terrain={groundHeight}
                grip={groundGrip}
                collide={groundCollide}
                pose={pose}
                bounds={TERRAIN_BOUNDS}
                start={TRACK_START}
                maxSpeed={24}
                carScale={1.1396}
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
                controlsRef={orbitControlsRef}
                manualOverride={manualCamHold}
              />
              {freeCam && <FreeCamControls pose={pose} input={camKeys} controlsRef={orbitControlsRef} inspecting={!!inspecting} mobile={isTouch} />}
              <CameraDebugUpdater controlsRef={orbitControlsRef} posRef={camPosRef} dirRef={camDirRef} targetRef={camTargetRef} />
              <CameraPositionApplier controlsRef={orbitControlsRef} position={camEdit} applyTick={camApplyTick} hold={manualCamHold} />
            </></PhysicsProvider>
          ) : (
            <>
              <ambientLight intensity={0.8} />
              <hemisphereLight args={["#ffffff", "#555555", 0.5]} />
              <directionalLight position={[4, 7, 5]} intensity={1.2} />
              <axesHelper args={[5]} position={[0, 0.05, 0]} />
              <FolioCar key={carModel} color={color} keyboard={false} input={carLoaded ? input : emptyInput} smoke={smokeOn && carLoaded} carScale={1.7534} model={carModel} onReady={handleSceneReady} maxSpeed={24} />
              <OrbitControls ref={orbitControlsRef} target={[0, 1, 0]} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2 - 0.08} />
              <CameraDebugUpdater controlsRef={orbitControlsRef} posRef={camPosRef} dirRef={camDirRef} targetRef={camTargetRef} />
              <CameraPositionApplier controlsRef={orbitControlsRef} position={camEdit} applyTick={camApplyTick} hold={manualCamHold} />
            </>
          )}
        </Canvas>
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
            <option value="sf90">Ferrari SF90</option>
            <option value="nissan">Nissan Silvia S15</option>
            <option value="porsche">Porsche Panamera</option>
            <option value="corvette">Corvette Stingray</option>
          </select>
        </label>



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

        {view === "track" && (
          <button
            onClick={() => {
              setInspecting(null);
              setGestures((v) => !v);
            }}
            title="Hand gestures: rotate the fixed camera (press G)."
            style={{
              padding: "7px 12px",
              borderRadius: 9,
              borderWidth: 1.5,
              borderStyle: "solid",
              borderColor: gestures ? "#111111" : "#cfc8bd",
              backgroundColor: gestures ? "#111111" : "#fffdf9",
              color: gestures ? "#ffffff" : "#2a2622",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              marginLeft: 4,
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            {gestures ? "Gestures on [G]" : "Gestures [G]"}
          </button>
        )}
      </div>

      {/* Joystick controller on left side (mobile only) */}
      {isTouch && (
        <div
          className="folio-joystick-wrap"
          style={{
            position: "fixed",
            left: 18,
            bottom: "max(18px, env(safe-area-inset-bottom))",
            zIndex: 10,
            pointerEvents: "auto",
            touchAction: "none",
          }}
        >
          <Joystick input={input} />
        </div>
      )}

      {view === "track" && gestures && (
        <HandGestures controlsRef={orbitControlsRef} enabled={true} />
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
          Drag (or use gestures) to look around from a fixed camera | WASD or Arrow Keys to drive | Space to brake | M for map | R to reset
        </div>
      )}

      {/* Loading overlay -- covers everything until the car is in the scene */}
      <LoadingScreen progress={loadProgress} visible={!sceneReady} />

      {/* Inspect camera distance */}
      <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 170,
          zIndex: 60,
          background: "rgba(0,0,0,0.72)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          width: 320,
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Inspect camera distance</div>
        <label style={{ display: "grid", gridTemplateColumns: "18px 1fr 72px", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span>D</span>
          <input
            type="range"
            min={-10}
            max={20}
            step={0.1}
            value={inspectCamDistanceOffset}
            onChange={(e) => setInspectCamDistanceOffset(Number(e.target.value))}
          />
          <input
            type="number"
            value={inspectCamDistanceOffset}
            step={0.1}
            onChange={(e) => setInspectCamDistanceOffset(Number(e.target.value))}
            style={{ width: 72, background: "#111", color: "#fff", border: "1px solid #444", borderRadius: 4, padding: "2px 4px" }}
          />
        </label>
        <div style={{ opacity: 0.85 }}>Controls camera distance from object/text in inspect view (works in inspect/key prompt view).</div>
      </div>

      {/* Camera XYZ controller */}
      <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 290,
          zIndex: 60,
          background: "rgba(0,0,0,0.72)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          width: 320,
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Camera XYZ controller</div>
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis} style={{ display: "grid", gridTemplateColumns: "18px 1fr 72px", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span>{axis.toUpperCase()}</span>
            <input
              type="range"
              min={-200}
              max={200}
              step={0.1}
              value={camEdit[axis]}
              onChange={(e) => setCamEdit((p) => ({ ...p, [axis]: Number(e.target.value) }))}
            />
            <input
              type="number"
              value={camEdit[axis]}
              step={0.1}
              onChange={(e) => setCamEdit((p) => ({ ...p, [axis]: Number(e.target.value) }))}
              style={{ width: 72, background: "#111", color: "#fff", border: "1px solid #444", borderRadius: 4, padding: "2px 4px" }}
            />
          </label>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => { setManualCamHold(true); setCamApplyTick((t) => t + 1); }}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #555", background: manualCamHold ? "#2f5a2f" : "#1b1b1b", color: "#fff", cursor: "pointer", font: "inherit" }}
          >
            Apply & Hold
          </button>
          <button
            onClick={() => setManualCamHold(false)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #555", background: "#1b1b1b", color: "#fff", cursor: "pointer", font: "inherit" }}
          >
            Release
          </button>
          <button
            onClick={() => {
              const c = orbitControlsRef.current;
              const cam = (c && c.object) ? c.object : null;
              if (cam && (cam as any).position) {
                setCamEdit({ x: (cam as any).position.x, y: (cam as any).position.y, z: (cam as any).position.z });
              }
            }}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #555", background: "#1b1b1b", color: "#fff", cursor: "pointer", font: "inherit" }}
          >
            Sync from live
          </button>
        </div>
        <div style={{ marginTop: 6, opacity: 0.85, wordBreak: "break-all" }}>
          {`[${camEdit.x.toFixed(2)}, ${camEdit.y.toFixed(2)}, ${camEdit.z.toFixed(2)}] ${manualCamHold ? "(manual hold)" : ""}`}
        </div>
      </div>

      {/* Live camera debug */}
      <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 60,
          background: "rgba(0,0,0,0.72)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          width: 320,
          backdropFilter: "blur(6px)",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Camera (live)</div>
        <div ref={camPosRef}>pos: [0.00, 0.00, 0.00]</div>
        <div ref={camDirRef}>dir: [0.000, 0.000, -1.000]</div>
        <div ref={camTargetRef}>target: [0.00, 0.00, 0.00]</div>
        <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Axes</div>
          <div><span style={{ color: "#ff5555", fontWeight: 700 }}>X</span> = red, <span style={{ color: "#55ff55", fontWeight: 700 }}>Y</span> = green, <span style={{ color: "#5599ff", fontWeight: 700 }}>Z</span> = blue</div>
        </div>
      </div>

      {/* Temporary model rotation debug controls (LinkedIn) */}
      <div
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          zIndex: 60,
          background: "rgba(0,0,0,0.72)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          width: 320,
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>LinkedIn rotation (temp)</div>
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis} style={{ display: "grid", gridTemplateColumns: "18px 1fr 56px", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span>{axis.toUpperCase()}</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={linkedinRotDeg[axis]}
              onChange={(e) => setLinkedinRotDeg((r) => ({ ...r, [axis]: Number(e.target.value) }))}
            />
            <input
              type="number"
              value={linkedinRotDeg[axis]}
              step={1}
              onChange={(e) => setLinkedinRotDeg((r) => ({ ...r, [axis]: Number(e.target.value) }))}
              style={{ width: 56, background: "#111", color: "#fff", border: "1px solid #444", borderRadius: 4, padding: "2px 4px" }}
            />
          </label>
        ))}
        <div style={{ marginTop: 6, lineHeight: 1.35, wordBreak: "break-all", opacity: 0.95 }}>
          {`clone.rotation.set(${((linkedinRotDeg.x * Math.PI) / 180).toFixed(6)}, ${((linkedinRotDeg.y * Math.PI) / 180).toFixed(6)}, ${((linkedinRotDeg.z * Math.PI) / 180).toFixed(6)});`}
        </div>
        <div style={{ marginTop: 2, opacity: 0.8 }}>
          {`// X: ${linkedinRotDeg.x}°, Y: ${linkedinRotDeg.y}°, Z: ${linkedinRotDeg.z}°`}
        </div>
      </div>

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

        canvas { touch-action: none; }

        /* Grab cursor for drag-to-orbit. It lives on <body> and the canvas inherits it, so anything that sets
           document.body.style.cursor (e.g. the Enter key's "pointer" on hover) still wins via the inline style. */
        body { cursor: grab; }
        body:active { cursor: grabbing; }
        canvas { cursor: inherit; }
        .folio-toolbar, .folio-speed, .folio-touch-group { cursor: default; }

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
        }
      `}</style>
    </div>
  );
}

