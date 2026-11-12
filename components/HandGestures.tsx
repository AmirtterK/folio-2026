"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_LOCAL = "/mediapipe/hand_landmarker.task";
const MODEL_REMOTE =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_CACHE = "hand-landmarker-v1";

const SMOOTH = 0.25;
const ROTATE_SPEED = 2.2;
const TILT_SPEED = 1.6;
const ZOOM_SPEED = 0.012; // per unit normalized pinch delta

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

type Pt = { x: number; y: number; z: number };

export type HandGesturesCameraProps = {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  enabled: boolean;
};

export default function HandGesturesCamera({ controlsRef, enabled }: HandGesturesCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTime = useRef(-1);

  const prevIndexX = useRef<number | null>(null);
  const prevIndexY = useRef<number | null>(null);
  const smoothMoveX = useRef(0);
  const smoothMoveY = useRef(0);
  const velYaw = useRef(0);
  const velPitch = useRef(0);
  const prevPinch = useRef<number | null>(null);
  const smoothPinchDelta = useRef(0);
  const pointingHold = useRef(0);
  const pointingLost = useRef(0);
  const debugTick = useRef(0);

  const [status, setStatus] = useState<"loading" | "running" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function run() {
      const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      if (cancelled) return;

      const resolver = await FilesetResolver.forVisionTasks(WASM_PATH);
      if (cancelled) return;

      let modelBuffer: ArrayBuffer;
      try {
        const c = await caches.open(MODEL_CACHE);
        const r = await c.match(MODEL_LOCAL);
        if (r) {
          modelBuffer = await r.arrayBuffer();
        } else {
          const res = await fetch(MODEL_REMOTE);
          if (res.ok) c.put(MODEL_LOCAL, res.clone());
          modelBuffer = await res.arrayBuffer();
        }
      } catch {
        const res = await fetch(MODEL_REMOTE);
        modelBuffer = await res.arrayBuffer();
      }
      if (cancelled) return;

      let landmarker: HandLandmarker | null = null;
      try {
        landmarker = await HandLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetBuffer: new Uint8Array(modelBuffer), delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
        });
      } catch {
        landmarker = await HandLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetBuffer: new Uint8Array(modelBuffer), delegate: "CPU" },
          runningMode: "VIDEO",
          numHands: 1,
        });
      }
      if (cancelled || !landmarker) return;
      landmarkerRef.current = landmarker;

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      setStatus("running");

      const loop = () => {
        if (cancelled) return;
        const lm = landmarkerRef.current;
        const v = videoRef.current;
        if (lm && v && v.readyState >= 2) {
          const now = performance.now();
          if (v.currentTime !== lastVideoTime.current) {
            lastVideoTime.current = v.currentTime;
            const res = lm.detectForVideo(v, now);
            const canvas = canvasRef.current;
            const controls = controlsRef.current as any;
            if (canvas) {
              const ctx = canvas.getContext("2d");
              if (ctx) {
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                if (res.landmarks && res.landmarks[0]) {
                  const lm0 = res.landmarks[0] as Pt[];
                  const pts = lm0.map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
                  // draw skeleton
                  ctx.strokeStyle = "#4ade80";
                  ctx.lineWidth = 2;
                  BONES.forEach(([a, b]) => {
                    ctx.beginPath();
                    ctx.moveTo(pts[a].x, pts[a].y);
                    ctx.lineTo(pts[b].x, pts[b].y);
                    ctx.stroke();
                  });
                  // draw pinch points
                  ctx.fillStyle = "#f87171";
                  [4, 8].forEach((i) => {
                    ctx.beginPath();
                    ctx.arc(pts[i].x, pts[i].y, 6, 0, Math.PI * 2);
                    ctx.fill();
                  });

                  const wrist = lm0[0];
                  const indexMcp = lm0[5];
                  const middleMcp = lm0[9];
                  const thumbTip = lm0[4];
                  const indexTip = lm0[8];

                  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
                  const handSize = d(wrist, middleMcp) || 0.1;
                  const isExtended = (tip: number, pip: number) => d(lm0[tip], wrist) > d(lm0[pip], wrist) * 1.1;

                  const indexUp = isExtended(8, 6);
                  const middleUp = isExtended(12, 10);
                  const ringUp = isExtended(16, 14);
                  const pinkyUp = isExtended(20, 18);
                  const pinchDist = d(thumbTip, indexTip) / handSize;
                  const pinching = pinchDist < 0.45;
                  // rotation pose: index pointing, other fingers down, not pinching (thumb can relax) - stable for sliding
                  const rawPointing = indexUp && !middleUp && !ringUp && !pinkyUp && !pinching;
                  // hysteresis: keep pointing stable through brief tracking/pose flicker
                  if (rawPointing) {
                    pointingHold.current = Math.min(pointingHold.current + 1, 10);
                    pointingLost.current = 0;
                  } else {
                    pointingLost.current = Math.min(pointingLost.current + 1, 10);
                    if (pointingLost.current > 6) pointingHold.current = 0;
                  }
                  const pointing = pointingHold.current >= 1;

                  // Rotation: draw/circle with index finger while pointing
                  let moveX = 0;
                  let moveY = 0;
                  if (pointing) {
                    if (prevIndexX.current !== null && prevIndexY.current !== null) {
                      moveX = indexTip.x - prevIndexX.current;
                      moveY = indexTip.y - prevIndexY.current;
                    }
                    prevIndexX.current = indexTip.x;
                    prevIndexY.current = indexTip.y;
                  } else {
                    prevIndexX.current = null;
                    prevIndexY.current = null;
                  }
                  smoothMoveX.current += (moveX - smoothMoveX.current) * SMOOTH;
                  smoothMoveY.current += (moveY - smoothMoveY.current) * SMOOTH;

                  // Zoom: pinch thumb + index (track continuously; pinch overrides pointing hysteresis)
                  let pinchDelta = 0;
                  if (!pointing || pinching) {
                    if (prevPinch.current !== null) pinchDelta = pinchDist - prevPinch.current;
                    prevPinch.current = pinchDist;
                  } else {
                    prevPinch.current = null;
                  }
                  smoothPinchDelta.current += (pinchDelta - smoothPinchDelta.current) * SMOOTH;
                  // continuous zoom when held: pinch in (close) => keep zooming out, spread out => keep zooming in
                  const continuousZoom = (!pointing || pinching)
                    ? (pinchDist < 0.38 ? -0.012 : pinchDist > 0.75 ? 0.012 : 0)
                    : 0;

                  // update velocities: slide gives input, inertia carries a bit after release
                  if (pointing) {
                    // inverted for mirrored camera input, much more sensitive
                    velYaw.current = velYaw.current * 0.25 + (smoothMoveX.current * 12.0) * 0.75;
                    velPitch.current = velPitch.current * 0.25 + (-smoothMoveY.current * 9.0) * 0.75;
                  } else {
                    // decay (inertia/momentum after finger stops or pose released)
                    velYaw.current *= 0.93;
                    velPitch.current *= 0.93;
                    if (Math.abs(velYaw.current) < 0.00005) velYaw.current = 0;
                    if (Math.abs(velPitch.current) < 0.00005) velPitch.current = 0;
                  }

                  debugTick.current++;
                  if (debugTick.current % 30 === 0) {
                    console.log("[gestures]", {
                      hasControls: !!controls,
                      hasAz: !!controls?.getAzimuthalAngle,
                      pointing,
                      pinching,
                      moveX: +smoothMoveX.current.toFixed(4),
                      moveY: +smoothMoveY.current.toFixed(4),
                      velYaw: +velYaw.current.toFixed(4),
                      velPitch: +velPitch.current.toFixed(4),
                      pinch: +smoothPinchDelta.current.toFixed(4),
                    });
                  }

                  // visual cue for mode
                  ctx.fillStyle = pointing ? "#60a5fa" : "#f87171";
                  ctx.beginPath();
                  ctx.arc(pts[8].x, pts[8].y, 7, 0, Math.PI * 2);
                  ctx.fill();

                  if (controls) {
                    // apply rotation (with inertia) around fixed orbit target
                    if (Math.abs(velYaw.current) > 0.00001 || Math.abs(velPitch.current) > 0.00001) {
                      if (typeof controls.getAzimuthalAngle === "function" && typeof controls.setAzimuthalAngle === "function") {
                        controls.setAzimuthalAngle(controls.getAzimuthalAngle() + velYaw.current);
                      } else if (typeof controls.rotateLeft === "function") {
                        controls.rotateLeft(velYaw.current);
                      }
                      if (typeof controls.getPolarAngle === "function" && typeof controls.setPolarAngle === "function") {
                        const minP = controls.minPolarAngle ?? 0;
                        const maxP = controls.maxPolarAngle ?? Math.PI;
                        const next = Math.min(maxP, Math.max(minP, controls.getPolarAngle() + velPitch.current));
                        controls.setPolarAngle(next);
                      } else if (typeof controls.rotateUp === "function") {
                        controls.rotateUp(velPitch.current);
                      }
                    }

                    // Pinch/spread to zoom: spread out => zoom in, pinch in (close) => zoom out (continuous when held)
                    if (!pointing || pinching) {
                      const zoomDelta = smoothPinchDelta.current * 2.5 + continuousZoom;
                      if (Math.abs(zoomDelta) > 0.0008) {
                        if (zoomDelta > 0) {
                          if (typeof controls.dollyIn === "function") controls.dollyIn(1 + zoomDelta);
                        } else {
                          if (typeof controls.dollyOut === "function") controls.dollyOut(1 + Math.abs(zoomDelta));
                        }
                      }
                    }
                    controls.update?.();
                  }
                } else {
                  prevIndexX.current = null;
                  prevIndexY.current = null;
                  prevPinch.current = null;
                  // keep inertia decaying when hand not detected
                  velYaw.current *= 0.93;
                  velPitch.current *= 0.93;
                  if (controls && (Math.abs(velYaw.current) > 0.00001 || Math.abs(velPitch.current) > 0.00001)) {
                    if (typeof controls.getAzimuthalAngle === "function" && typeof controls.setAzimuthalAngle === "function") {
                      controls.setAzimuthalAngle(controls.getAzimuthalAngle() + velYaw.current);
                    } else if (typeof controls.rotateLeft === "function") {
                      controls.rotateLeft(velYaw.current);
                    }
                    if (typeof controls.getPolarAngle === "function" && typeof controls.setPolarAngle === "function") {
                      const minP = controls.minPolarAngle ?? 0;
                      const maxP = controls.maxPolarAngle ?? Math.PI;
                      const next = Math.min(maxP, Math.max(minP, controls.getPolarAngle() + velPitch.current));
                      controls.setPolarAngle(next);
                    } else if (typeof controls.rotateUp === "function") {
                      controls.rotateUp(velPitch.current);
                    }
                    controls.update?.();
                  }
                }
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
    }

    run().catch((err: any) => {
      if (cancelled) return;
      setStatus("error");
      setErrorMsg(err?.message || String(err));
    });

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const lm = landmarkerRef.current;
      if (lm) lm.close();
      landmarkerRef.current = null;
      const v = videoRef.current;
      if (v && v.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      }
    };
  }, [enabled, controlsRef]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 72,
        left: 16,
        zIndex: 50,
        width: 280,
        height: 210,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.25)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        background: "#000",
      }}
    >
      <video
        ref={videoRef}
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        muted
        playsInline
      />
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "scaleX(-1)" }}
      />
      {status === "running" && (
        <div
          style={{
            position: "absolute",
            bottom: 6,
            left: 6,
            right: 6,
            fontSize: 10,
            lineHeight: 1.3,
            color: "#fff",
            background: "rgba(0,0,0,0.55)",
            padding: "4px 6px",
            borderRadius: 6,
            pointerEvents: "none",
          }}
        >
          Point index (others folded) + slide to rotate · Pinch thumb+index to zoom (pinch in = zoom in)
        </div>
      )}
      {status !== "running" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            fontSize: 12,
            textAlign: "center",
            padding: 8,
          }}
        >
          {status === "loading" ? "Starting camera…" : errorMsg}
        </div>
      )}
    </div>
  );
}
