"use client";

/**
 * HandGestures: drive the car with your hand through the webcam.
 *
 * Mount it to switch gestures on (it asks for the camera), unmount it to switch them off (the camera is released).
 * It writes into the same `input` ref the keyboard and on-screen buttons use, so the car itself needs no changes.
 *
 *   open palm (4 fingers up)        drive forward
 *   fist                            brake
 *   two fingers (index + middle)    reverse
 *   tilt your hand left / right     steer, proportional to the tilt (like turning a wheel)
 *   anything else, or no hand       coast
 *
 * Hand tracking is MediaPipe's Hand Landmarker (@mediapipe/tasks-vision) and runs entirely in the browser; the video
 * never leaves your machine. The WASM runtime is served from /mediapipe/wasm (copied there by
 * scripts/copy-mediapipe.mjs) and the small model file is fetched once from Google's MediaPipe model storage.
 *
 * Usage:
 *   {gestures && <HandGestures input={input} onPressed={(p) => setPressed((prev) => ({ ...prev, ...p }))} />}
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { CarInput } from "@/components/ToyCar";

export type Pressed = Partial<Record<keyof CarInput, boolean>>;

type Gesture = "forward" | "brake" | "reverse" | "coast";
type Pt = { x: number; y: number };

const WASM_PATH = "/mediapipe/wasm";
// The model is looked up here first, so dropping hand_landmarker.task into public/mediapipe/ skips the download.
const MODEL_LOCAL = "/mediapipe/hand_landmarker.task";
const MODEL_REMOTE =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_CACHE = "hand-landmarker-v1"; // browser Cache Storage, so the download happens once

const STEER_DEAD = (8 * Math.PI) / 180;   // tilt below this is ignored, so a relaxed hand drives straight
const STEER_FULL = (40 * Math.PI) / 180;  // tilt at which the wheels reach full lock
const STEER_SMOOTH = 0.4;                 // 0..1, higher follows the hand faster
const HOLD_FRAMES = 3;                    // a gesture must hold this many frames before it takes effect
const HAND_LOST_MS = 350;                 // controls release this long after the hand leaves the frame
const FRAME_MS = 33;                      // run the tracker at about 30 fps, leaving the rest to the 3D scene
const GPU_TIMEOUT_MS = 10000;             // if the GPU delegate has not come up by then, fall back to the CPU
const CPU_TIMEOUT_MS = 30000;             // give up with an error if the CPU start takes longer than this

const LABEL: Record<Gesture, string> = {
  forward: "✋ Go",
  brake: "✊ Brake",
  reverse: "✌️ Reverse",
  coast: "Coasting",
};

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Reads the gesture and the hand's tilt from the 21 landmarks. Works in pixel space so it is not skewed by the video's aspect ratio. */
function classify(l: Pt[], w: number, h: number): { gesture: Gesture; tilt: number } {
  const px = (i: number): Pt => ({ x: l[i].x * w, y: l[i].y * h });
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const wrist = px(0);

  // a finger is "up" when its tip is clearly farther from the wrist than its middle joint (works at any hand angle)
  const up = (tip: number, pip: number) => dist(px(tip), wrist) > dist(px(pip), wrist) * 1.1;
  const index = up(8, 6), middle = up(12, 10), ring = up(16, 14), pinky = up(20, 18);
  const count = Number(index) + Number(middle) + Number(ring) + Number(pinky);

  let gesture: Gesture = "coast";
  if (count === 4) gesture = "forward";
  else if (count === 0) gesture = "brake";
  else if (index && middle && !ring && !pinky) gesture = "reverse";

  // angle of the wrist -> middle knuckle line from straight up. The video is not mirrored in the data, so a hand
  // tilted toward the driver's right leans toward smaller x; the minus sign makes positive mean "right".
  const mid = px(9);
  const tilt = -Math.atan2(mid.x - wrist.x, wrist.y - mid.y);
  return { gesture, tilt };
}

function describeError(e: unknown) {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Camera blocked. Allow camera access for this site, then turn gestures off and on.";
  if (name === "NotFoundError") return "No camera found.";
  if (name === "NotReadableError") return "The camera is in use by another app.";
  return e instanceof Error ? e.message : "Could not start hand tracking.";
}

/* ---------- shared tracker ---------- */

// Progress text for the overlay, also logged to the console so a stuck startup shows where it stopped.
let stageNow = "Starting…";
const stageListeners = new Set<(s: string) => void>();
function reportStage(s: string) {
  stageNow = s;
  console.log("[hands]", s);
  stageListeners.forEach((f) => f(s));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Gets the model file as bytes, with download progress. Cached in the browser after the first time. */
async function fetchModel(): Promise<Uint8Array> {
  const cache = typeof caches !== "undefined" ? await caches.open(MODEL_CACHE).catch(() => null) : null;
  for (const url of [MODEL_LOCAL, MODEL_REMOTE]) {
    const hit = await cache?.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }

  for (const url of [MODEL_LOCAL, MODEL_REMOTE]) {
    let res: Response;
    try { res = await fetch(url); } catch { continue; }
    if (!res.ok || !res.body) continue;

    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    let lastStep = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      const step = total ? Math.floor((got / total) * 20) : Math.floor(got / 1e6); // report every 5% (or every MB)
      if (step !== lastStep) {
        lastStep = step;
        reportStage(total ? `Downloading hand model… ${Math.round((got / total) * 100)}%` : `Downloading hand model… ${(got / 1e6).toFixed(1)} MB`);
      }
    }

    const bytes = new Uint8Array(got);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    if (bytes.length < 1_000_000) continue; // not a real model file (for example an HTML 404 page)
    await cache?.put(url, new Response(bytes as unknown as BodyInit)).catch(() => {});
    return bytes;
  }
  throw new Error("Could not download the hand model. Check your connection, or save it as public/mediapipe/hand_landmarker.task.");
}

/**
 * One tracker for the whole page, created once and reused. MediaPipe's WASM loader does not cope with two loads
 * running at the same time, and React Strict Mode (dev) mounts every effect twice, which would start two.
 */
let sharedLandmarker: Promise<HandLandmarker> | null = null;

function loadLandmarker(): Promise<HandLandmarker> {
  if (!sharedLandmarker) {
    sharedLandmarker = (async () => {
      reportStage("Loading hand tracking runtime…");
      const { FilesetResolver, HandLandmarker: Landmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

      reportStage("Downloading hand model (first time only)…");
      const model = await fetchModel();

      const create = (delegate: "GPU" | "CPU") =>
        Landmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });

      reportStage("Starting hand tracking…");
      try {
        return await withTimeout(create("GPU"), GPU_TIMEOUT_MS, "GPU start");
      } catch (e) {
        console.warn("[hands] GPU delegate failed, using CPU:", e);
        reportStage("GPU unavailable, starting on CPU…");
        return await withTimeout(create("CPU"), CPU_TIMEOUT_MS, "CPU start");
      }
    })().catch((e) => {
      sharedLandmarker = null; // let the next toggle try again
      throw e;
    });
  }
  return sharedLandmarker;
}

/* ---------- component ---------- */

export default function HandGestures({
  input,
  onPressed,
}: {
  input: MutableRefObject<CarInput>;
  /** Called only when the set of "pressed" controls changes, so the on-screen buttons can light up. */
  onPressed?: (p: Pressed) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const pressedRef = useRef(onPressed);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [stage, setStage] = useState(stageNow);
  const [aspect, setAspect] = useState(4 / 3);

  useEffect(() => {
    pressedRef.current = onPressed;
  });

  useEffect(() => {
    stageListeners.add(setStage);
    return () => { stageListeners.delete(setStage); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;

    const release = () => {
      const k = input.current;
      k.fwd = k.back = k.left = k.right = k.brake = 0;
    };

    // per-frame state
    let lastVideoTime = -1;
    let lastRun = 0;
    let lastSeen = 0;
    let candidate: Gesture | null = null;
    let candidateFrames = 0;
    let stable: Gesture = "coast";
    let steer = 0; // -1 (full left) .. +1 (full right), smoothed
    let lastPressed = "";

    const setLabel = (text: string) => {
      if (labelRef.current) labelRef.current.textContent = text;
    };

    const publishPressed = () => {
      const k = input.current;
      const p = { fwd: k.fwd > 0.5, back: k.back > 0.5, brake: k.brake > 0.5, left: k.left > 0.3, right: k.right > 0.3 };
      const key = [p.fwd, p.back, p.brake, p.left, p.right].map(Number).join("");
      if (key !== lastPressed) {
        lastPressed = key;
        pressedRef.current?.(p);
      }
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !landmarker || v.readyState < 2) return;

      const now = performance.now();
      if (now - lastRun < FRAME_MS || v.currentTime === lastVideoTime) return;
      lastRun = now;
      lastVideoTime = v.currentTime;

      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      const g = c.getContext("2d");
      g?.clearRect(0, 0, c.width, c.height);

      const hand = landmarker.detectForVideo(v, now).landmarks[0];

      if (hand) {
        lastSeen = now;
        const { gesture, tilt } = classify(hand, v.videoWidth, v.videoHeight);

        if (gesture === candidate) candidateFrames++;
        else { candidate = gesture; candidateFrames = 1; }
        if (candidateFrames >= HOLD_FRAMES) stable = gesture;

        const mag = Math.min(1, Math.max(0, (Math.abs(tilt) - STEER_DEAD) / (STEER_FULL - STEER_DEAD)));
        steer += (Math.sign(tilt) * mag - steer) * STEER_SMOOTH;
        if (Math.abs(steer) < 0.02) steer = 0;

        const k = input.current;
        k.fwd = stable === "forward" ? 1 : 0;
        k.back = stable === "reverse" ? 1 : 0;
        k.brake = stable === "brake" ? 1 : 0;
        k.left = steer < 0 ? -steer : 0;
        k.right = steer > 0 ? steer : 0;

        const arrow = steer < -0.1 ? "◀" : steer > 0.1 ? "▶" : "•";
        setLabel(`${LABEL[stable]}  ${arrow} ${Math.round(Math.abs(steer) * 100)}%`);

        if (g) {
          g.lineWidth = 3;
          g.strokeStyle = "#ff7a1a";
          g.beginPath();
          for (const [a, b] of BONES) {
            g.moveTo(hand[a].x * c.width, hand[a].y * c.height);
            g.lineTo(hand[b].x * c.width, hand[b].y * c.height);
          }
          g.stroke();
          g.fillStyle = "#ffffff";
          for (const p of hand) {
            g.beginPath();
            g.arc(p.x * c.width, p.y * c.height, 4, 0, Math.PI * 2);
            g.fill();
          }
        }
      } else if (now - lastSeen > HAND_LOST_MS) {
        candidate = null;
        candidateFrames = 0;
        stable = "coast";
        steer = 0;
        release();
        setLabel("Show your hand to drive");
      }

      publishPressed();
    };

    // ask for the camera right away so the permission prompt shows while the model loads
    reportStage("Waiting for camera permission…");
    const mediaP: Promise<MediaStream> = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        })
      : Promise.reject(new Error("This page needs a secure context (https or localhost) to use the camera."));
    mediaP.then(
      (m) => { if (cancelled) m.getTracks().forEach((t) => t.stop()); },
      () => {},
    );

    (async () => {
      try {
        const media = await mediaP;
        if (cancelled) return;
        reportStage("Camera ready, loading hand tracking…");

        const lm = await loadLandmarker();
        if (cancelled) return;
        landmarker = lm;
        stream = media;

        const v = videoRef.current;
        if (!v) return;
        v.srcObject = media;
        await v.play();
        if (cancelled) return;
        if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);

        reportStage("Tracking");
        setStatus("ready");
        setLabel("Show your hand to drive");
        raf = requestAnimationFrame(tick);
      } catch (e) {
        if (cancelled) return;
        console.error("[hands] startup failed:", e);
        mediaP.then((m) => m.getTracks().forEach((t) => t.stop()), () => {});
        setError(describeError(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      const v = videoRef.current;
      if (v) v.srcObject = null;
      release();
      pressedRef.current?.({ fwd: false, back: false, left: false, right: false, brake: false });
    };
  }, [input]);

  return (
    <div style={PANEL}>
      <div style={{ position: "relative" }}>
        {/* mirrored like a bathroom mirror, so moving your hand right moves it right on screen */}
        <div style={{ position: "relative", width: "100%", aspectRatio: String(aspect), backgroundColor: "#14161b", transform: "scaleX(-1)" }}>
          <video ref={videoRef} muted playsInline style={FILL} />
          <canvas ref={canvasRef} style={FILL} />
        </div>
        {status !== "ready" && (
          <div style={{ ...OVERLAY, color: status === "error" ? "#ffb4ab" : "#ffffff" }}>
            {status === "error" ? error : stage}
          </div>
        )}
      </div>
      <div ref={labelRef} style={{ padding: "6px 10px 0", fontSize: 14, fontWeight: 700 }}>Show your hand to drive</div>
      <div style={{ padding: "2px 10px 8px", fontSize: 11, opacity: 0.7 }}>✋ go · ✊ brake · ✌️ reverse · tilt to steer</div>
    </div>
  );
}

const PANEL: CSSProperties = {
  position: "fixed", left: 20, bottom: 92, width: "min(220px, 40vw)", overflow: "hidden", pointerEvents: "none",
  borderRadius: 12, borderWidth: 2, borderStyle: "solid", borderColor: "#cfc8bd",
  backgroundColor: "rgba(255,253,249,0.95)", color: "#2a2622",
};
const FILL: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill" };
const OVERLAY: CSSProperties = {
  position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 12, textAlign: "center", fontSize: 12, backgroundColor: "rgba(20,22,27,0.8)",
};
