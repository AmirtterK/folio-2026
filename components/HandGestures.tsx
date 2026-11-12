"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Spherical, Vector3 } from "three";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

/* ------------------------------------------------------------------------------------------------
 * Hand gestures -> free-cam control
 *
 *   POINT  (index out, middle/ring/pinky folded)  + move   => orbit (drag feel: the scene follows your hand)
 *   PINCH  (thumb tip touching index tip)                  => zoom dial: held closed keeps zooming OUT,
 *                                                             spreading thumb+index apart keeps zooming IN,
 *                                                             the middle band holds the distance
 *   anything else (open hand, fist, ...)                   => nothing happens
 *
 * Design notes (why it is built this way):
 *  - Poses are classified from MediaPipe *world* landmarks (metric 3D), using joint bend angles, so the result
 *    does not depend on the webcam aspect ratio, hand size, or hand orientation.
 *  - Finger up/down and pinch both use two thresholds (hysteresis) so they do not flicker at the boundary.
 *  - The current pose is debounced in time, and a short hand-lost grace period keeps the mode alive through
 *    one or two dropped frames instead of resetting everything.
 *  - Fingertip positions go through a One Euro filter (low jitter when still, low lag when moving fast).
 *  - Motion is velocity based and applied every render frame with a real dt, so it is frame-rate independent,
 *    and a short inertia glide follows a release.
 *  - The camera is orbited directly (spherical coordinates around controls.target) instead of poking the
 *    controls' damping state, so it works the same in any three-stdlib version.
 *  - The render loop never dies: it reschedules itself first and every frame is wrapped in try/catch.
 * ---------------------------------------------------------------------------------------------- */

const WASM_PATH = "/mediapipe/wasm";
const MODEL_LOCAL = "/mediapipe/hand_landmarker.task"; // optional: drop the model here to skip the download
const MODEL_REMOTE =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_CACHE = "hand-landmarker-v2";

// MediaPipe confidence thresholds (library default is 0.5 for all three; slightly lower = fewer dropouts)
const DETECT_CONF = 0.4;

// Finger state from the bend angle at the middle joint (degrees): below = straight, above = folded
const EXTENDED_BELOW = 40;
const FOLDED_ABOVE = 70;

// Pinch = thumb tip to index tip distance / hand size (wrist to middle knuckle)
const PINCH_ENTER = 0.45;
const PINCH_EXIT = 0.6;

// Debounce / dropout handling (milliseconds)
const ENTER_MS = 40; // a new pose must be stable this long before it takes over
const EXIT_MS = 120; // leaving a pose needs a little longer (tolerates flicker)
const LOST_GRACE_MS = 250; // hand missing this long => back to idle
const STALE_MS = 160; // no fresh detection this long => stop driving the camera

// Motion mapping
const YAW_GAIN = 4.0; // rad of orbit per full video width of hand travel
const PITCH_GAIN = 3.0; // rad of tilt per full video width of hand travel
// Zoom dial (thumb tip to index tip distance / hand size)
const ZOOM_RATE = 1.0; // ln(distance) per second at full dial
const ZOOM_CLOSED = 0.6; // below this the pinch counts as closed => zoom out
const ZOOM_OPEN = 0.78; // above this the fingers count as spread => zoom in
const ZOOM_MAX_APERTURE = 2.2; // wider than this and it is no longer a zoom gesture
const DEADZONE = 0.03; // ignore hand speeds below this (video widths per second): kills jitter drift
const MAX_ANG_SPEED = 5; // rad/s
// Thumb sticking out (thumb tip to index knuckle / hand size), used to tell a zoom spread from a pointing hand
const THUMB_OUT_ON = 0.55;
const THUMB_OUT_OFF = 0.4;
const FOLLOW_TAU = 0.06; // s, how quickly camera speed follows the hand while a gesture is held
const INERTIA_TAU = 0.35; // s, glide after releasing a gesture

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// [knuckle (MCP), middle joint (PIP), tip] for index, middle, ring, pinky
const FINGER_JOINTS: [number, number, number][] = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];

type P3 = { x: number; y: number; z: number };
type Pose = "none" | "point" | "zoom";
type Mode = "idle" | "rotate" | "zoom";

export type HandGesturesCameraProps = {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  enabled: boolean;
};

/* ---------- small helpers ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist3 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const deadzone = (v: number) => {
  const a = Math.abs(v) - DEADZONE;
  return a > 0 ? Math.sign(v) * a : 0;
};

/** Angle (degrees) between the two segments around a joint: 0 = perfectly straight, large = folded. */
function bendDeg(l: P3[], mcp: number, pip: number, tip: number) {
  const ax = l[pip].x - l[mcp].x, ay = l[pip].y - l[mcp].y, az = l[pip].z - l[mcp].z;
  const bx = l[tip].x - l[pip].x, by = l[tip].y - l[pip].y, bz = l[tip].z - l[pip].z;
  const na = Math.hypot(ax, ay, az);
  const nb = Math.hypot(bx, by, bz);
  if (na < 1e-6 || nb < 1e-6) return 0;
  return (Math.acos(clamp((ax * bx + ay * by + az * bz) / (na * nb), -1, 1)) * 180) / Math.PI;
}

/** One Euro filter: smooth when slow (no jitter), responsive when fast (no lag). */
class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;
  constructor(private minCutoff = 1.2, private beta = 4, private dCutoff = 1) {}
  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x: number, tSec: number) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      this.dxPrev = 0;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.tPrev);
    this.tPrev = tSec;
    const dx = (x - this.xPrev) / dt;
    this.dxPrev += this.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    this.xPrev += this.alpha(cutoff, dt) * (x - this.xPrev);
    return this.xPrev;
  }
}

/** Load the model: browser cache -> bundled copy in /public -> download (then cache it). */
async function loadModel(): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(MODEL_REMOTE);
    if (hit) return await hit.arrayBuffer();
  } catch {
    /* Cache API unavailable (e.g. insecure context): just fetch */
  }
  try {
    const r = await fetch(MODEL_LOCAL);
    if (r.ok && !(r.headers.get("content-type") || "").includes("text/html")) return await r.arrayBuffer();
  } catch {
    /* no bundled copy */
  }
  const res = await fetch(MODEL_REMOTE);
  if (!res.ok) throw new Error(`Could not download the hand model (HTTP ${res.status}).`);
  if (cache) {
    try {
      await cache.put(MODEL_REMOTE, res.clone());
    } catch {
      /* caching is best effort */
    }
  }
  return await res.arrayBuffer();
}

// scratch objects for orbiting (no per-frame allocations)
const _offset = new Vector3();
const _sph = new Spherical();

function orbit(controls: OrbitControlsImpl, dTheta: number, dPhi: number, dLogRadius: number) {
  const cam = controls.object;
  const target = controls.target;
  _offset.copy(cam.position).sub(target);
  _sph.setFromVector3(_offset);
  _sph.theta += dTheta;
  _sph.phi = clamp(_sph.phi + dPhi, controls.minPolarAngle ?? 0, controls.maxPolarAngle ?? Math.PI);
  _sph.radius = clamp(_sph.radius * Math.exp(dLogRadius), controls.minDistance ?? 0, controls.maxDistance ?? Infinity);
  _sph.makeSafe();
  _offset.setFromSpherical(_sph);
  cam.position.copy(target).add(_offset);
  controls.update();
}

export default function HandGesturesCamera({ controlsRef, enabled }: HandGesturesCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<"loading" | "running" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!enabled) return;

    // Everything this effect creates lives here so cleanup can always release it, even mid-startup
    // (React StrictMode mounts, unmounts and re-mounts effects in dev).
    let cancelled = false;
    let landmarker: HandLandmarker | null = null;
    let stream: MediaStream | null = null;
    let raf = 0;

    const teardown = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try {
        landmarker?.close();
      } catch {
        /* already closed */
      }
      landmarker = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };

    async function run() {
      const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      if (cancelled) return;
      const resolver = await FilesetResolver.forVisionTasks(WASM_PATH);
      if (cancelled) return;
      const modelBuffer = await loadModel();
      if (cancelled) return;

      const create = (delegate: "GPU" | "CPU") =>
        HandLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetBuffer: new Uint8Array(modelBuffer), delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: DETECT_CONF,
          minHandPresenceConfidence: DETECT_CONF,
          minTrackingConfidence: DETECT_CONF,
        });

      let created: HandLandmarker;
      try {
        created = await create("GPU");
      } catch {
        created = await create("CPU");
      }
      if (cancelled) {
        created.close();
        return;
      }
      landmarker = created;

      // Ask for a modest size/fps first; if the camera rejects or stalls on that, retry with no constraints at all.
      const openCamera = async () => {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: "user" },
            audio: false,
          });
        } catch (e: any) {
          if (e?.name === "NotAllowedError" || e?.name === "SecurityError" || cancelled) throw e;
          await new Promise((r) => setTimeout(r, 400));
          if (cancelled) throw e;
          return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      };
      const media = await openCamera();
      if (cancelled) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = media;
      await video.play();
      if (cancelled) return;
      setStatus("running");

      /* ------------------------------ per-session gesture state ------------------------------ */
      const fingerExt = [false, false, false, false]; // index, middle, ring, pinky (hysteresis state)
      let pinchOn = false;
      let thumbOut = false;
      let zoomBase = -1; // how many of middle/ring/pinky were out when the pinch started
      let rawPose: Pose = "none";
      let pose: Pose = "none"; // debounced
      let cand: Pose = "none";
      let candSince = 0;
      let mode: Mode = "idle";
      let hasHand = false;
      let lastSeen = 0;
      let lastDetect = 0;
      let lastVideoTime = -1;
      let lastTick = performance.now();
      let lastLabel = "";

      const fx = new OneEuro();
      const fy = new OneEuro();
      const fr = new OneEuro(1.5, 2); // smooths the pinch aperture
      let prevX: number | null = null;
      let prevY = 0;
      let prevT = 0;

      // target (from the hand) and smoothed (applied) camera speeds
      let tYaw = 0, tPitch = 0, tZoom = 0;
      let wYaw = 0, wPitch = 0, wZoom = 0;

      let errStreak = 0;
      let rebuilds = 0;
      let recovering = false;

      const setBadge = () => {
        const label = !controlsRef.current
          ? "Free cam off (press F)"
          : !hasHand
            ? "No hand"
            : mode === "rotate"
              ? "Rotate"
              : mode === "zoom"
                ? "Zoom"
                : "Hand ready";
        if (label !== lastLabel) {
          lastLabel = label;
          if (badgeRef.current) badgeRef.current.textContent = label;
        }
      };

      const setMode = (m: Mode) => {
        if (m === mode) return;
        mode = m;
        fx.reset();
        fy.reset();
        fr.reset();
        prevX = null;
        tYaw = tPitch = tZoom = 0;
      };

      const updatePose = (raw: Pose, now: number) => {
        if (raw === pose) {
          cand = pose;
          return;
        }
        if (raw !== cand) {
          cand = raw;
          candSince = now;
          return;
        }
        if (now - candSince >= (raw === "none" ? EXIT_MS : ENTER_MS)) pose = raw;
      };

      const draw = (lm: P3[] | null) => {
        const c = canvasRef.current;
        const v = videoRef.current;
        if (!c || !v || !v.videoWidth || !v.videoHeight) return;
        if (c.width !== v.videoWidth) c.width = v.videoWidth;
        if (c.height !== v.videoHeight) c.height = v.videoHeight;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, c.width, c.height);
        if (!lm) return;
        const accent = mode === "rotate" ? "#60a5fa" : mode === "zoom" ? "#facc15" : "#4ade80";
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        for (const [a, b] of BONES) {
          ctx.beginPath();
          ctx.moveTo(lm[a].x * c.width, lm[a].y * c.height);
          ctx.lineTo(lm[b].x * c.width, lm[b].y * c.height);
          ctx.stroke();
        }
        ctx.fillStyle = mode === "idle" ? "#f87171" : accent;
        for (const i of [4, 8]) {
          ctx.beginPath();
          ctx.arc(lm[i].x * c.width, lm[i].y * c.height, i === 8 ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      const onNoHand = (now: number) => {
        draw(null);
        tYaw = tPitch = tZoom = 0;
        if (now - lastSeen > LOST_GRACE_MS) {
          hasHand = false;
          pose = cand = rawPose = "none";
          pinchOn = false;
          setMode("idle");
        }
        setBadge();
      };

      const onHand = (lm: P3[], world: P3[], aspect: number, now: number) => {
        hasHand = true;
        lastSeen = now;

        // finger up / down with hysteresis
        for (let i = 0; i < 4; i++) {
          const [m, p, t] = FINGER_JOINTS[i];
          const bend = bendDeg(world, m, p, t);
          if (bend < EXTENDED_BELOW) fingerExt[i] = true;
          else if (bend > FOLDED_ABOVE) fingerExt[i] = false;
        }
        const handSize = dist3(world[0], world[9]) || 0.09;
        const pinchRatio = dist3(world[4], world[8]) / handSize;
        const thumbRatio = dist3(world[4], world[5]) / handSize; // big = thumb sticking out
        pinchOn = pinchOn ? pinchRatio < PINCH_EXIT : pinchRatio < PINCH_ENTER;
        thumbOut = thumbOut ? thumbRatio > THUMB_OUT_OFF : thumbRatio > THUMB_OUT_ON;

        const others = (fingerExt[1] ? 1 : 0) + (fingerExt[2] ? 1 : 0) + (fingerExt[3] ? 1 : 0);
        const pointing = fingerExt[0] && others === 0; // index out, rest folded (thumb ignored)
        const pointLike = pointing && !thumbOut; // ...and the thumb tucked in: a real pointing hand, not a spread

        // Detect index-thumb ASAP: use their distance directly for zoom intent
        const pinchNow = pinchRatio < PINCH_EXIT; // thumb/index engaged or close
        const closeZoom = pinchRatio < ZOOM_CLOSED; // clearly close => zoom out intent
        // Spread-apart thumb/index should only continue zoom when already zooming; a pointing/slide hand often has them far apart
        const spreadZoom = pinchRatio > ZOOM_OPEN && pose === "zoom" && !pointLike && !pointing;

        // Zoom starts on a close pinch (or continues when already zooming). Spreading keeps zooming only while in zoom mode.
        const zoomStay =
          pose === "zoom" &&
          zoomBase >= 0 &&
          Math.abs(others - zoomBase) <= 1 &&
          !pointLike &&
          !pointing &&
          pinchRatio < ZOOM_MAX_APERTURE;
        const zoomRaw = pinchOn || pinchNow || zoomStay;

        rawPose = zoomRaw ? "zoom" : pointing ? "point" : "none";
        // promote zoom immediately for fast response when index/thumb indicate a close pinch (not spread-while-sliding)
        if (rawPose === "zoom" && (pinchOn || pinchNow || closeZoom || zoomStay)) {
          pose = "zoom";
          cand = "zoom";
        } else {
          updatePose(rawPose, now);
        }
        if (pose !== "zoom") zoomBase = -1;
        else if (zoomBase < 0) zoomBase = others;
        setMode(pose === "point" ? "rotate" : pose === "zoom" ? "zoom" : "idle");

        // Drive zoom responsively when a pinch/zoom gesture is detected; keep slide responsive in point mode
        const zoomActive = rawPose === "zoom" || mode === "zoom";
        const rotateActive = rawPose === "point" || mode === "rotate";
        if (zoomActive && rawPose === "zoom") {
          // Pinch dial based on index-thumb distance: small/close => zoom out, big/spread => zoom in
          const r = fr.filter(pinchRatio, now / 1000);
          if (r < ZOOM_CLOSED) tZoom = ZOOM_RATE * clamp((ZOOM_CLOSED - r) / 0.22, 0.5, 1);
          else if (r > ZOOM_OPEN) tZoom = -ZOOM_RATE * clamp((r - ZOOM_OPEN) / 0.25, 0.5, 1);
          else tZoom = 0;
          tYaw = tPitch = 0;
          prevX = null;
        } else if (rotateActive && rawPose === "point" && !zoomRaw) {
          const t = now / 1000;
          const sx = fx.filter(lm[8].x, t);
          const sy = fy.filter(lm[8].y, t);
          if (prevX !== null) {
            const dt = clamp(t - prevT, 1 / 120, 0.2);
            const vx = deadzone((sx - prevX) / dt);
            const vy = deadzone((sy - prevY) / dt);
            // raw (un-mirrored) x: moving your hand right decreases x => orbit so the scene follows the hand
            tYaw = clamp(vx * YAW_GAIN, -MAX_ANG_SPEED, MAX_ANG_SPEED);
            tPitch = clamp(-vy * aspect * PITCH_GAIN, -MAX_ANG_SPEED, MAX_ANG_SPEED);
            tZoom = 0;
          }
          prevX = sx;
          prevY = sy;
          prevT = t;
        } else {
          tYaw = tPitch = tZoom = 0;
          prevX = null;
        }

        draw(lm);
        setBadge();
      };

      const rebuild = async () => {
        recovering = true;
        try {
          rebuilds++;
          const old = landmarker;
          landmarker = null;
          try {
            old?.close();
          } catch {
            /* ignore */
          }
          const fresh = await create("CPU");
          if (cancelled) {
            fresh.close();
            return;
          }
          landmarker = fresh;
          lastVideoTime = -1;
          errStreak = 0;
        } catch (e: any) {
          if (!cancelled) {
            setStatus("error");
            setErrorMsg(e?.message || "Hand tracking stopped working.");
          }
        } finally {
          recovering = false;
        }
      };

      const tick = () => {
        // reschedule FIRST so nothing below can ever kill the loop
        raf = requestAnimationFrame(tick);
        if (cancelled) return;
        try {
          const now = performance.now();
          const dt = clamp((now - lastTick) / 1000, 0.001, 0.05);
          lastTick = now;

          const v = videoRef.current;
          const lmk = landmarker;
          // throttle detection to ~30fps to reduce main-thread load (rendering/inertia still runs every frame)
          if (lmk && v && v.readyState >= 2 && v.currentTime !== lastVideoTime && now - lastDetect >= 33) {
            lastVideoTime = v.currentTime;
            lastDetect = now;
            const res = lmk.detectForVideo(v, now);
            errStreak = 0;
            const lm = res.landmarks?.[0] as P3[] | undefined;
            if (lm) {
              const aspect = (v.videoHeight || 480) / (v.videoWidth || 640);
              // world landmarks are metric 3D; fall back to normalized coords scaled to "width units"
              const world =
                (res.worldLandmarks?.[0] as P3[] | undefined) ??
                lm.map((p) => ({ x: p.x, y: p.y * aspect, z: p.z }));
              onHand(lm, world, aspect, now);
            } else {
              onNoHand(now);
            }
          }

          // stale detections (stalled camera, tab throttled...) must not keep driving the camera
          const driving = mode !== "idle" && hasHand && now - lastDetect <= STALE_MS;
          if (!driving) tYaw = tPitch = tZoom = 0;

          // ease the applied speed toward the hand's speed; glide (slower decay) once the gesture is released
          const k = 1 - Math.exp(-dt / (driving ? FOLLOW_TAU : INERTIA_TAU));
          wYaw += (tYaw - wYaw) * k;
          wPitch += (tPitch - wPitch) * k;
          wZoom += (tZoom - wZoom) * k;

          const controls = controlsRef.current;
          if (!controls) {
            wYaw = wPitch = wZoom = 0;
          } else if (Math.abs(wYaw) > 1e-4 || Math.abs(wPitch) > 1e-4 || Math.abs(wZoom) > 1e-4) {
            orbit(controls, wYaw * dt, wPitch * dt, wZoom * dt);
          } else {
            wYaw = wPitch = wZoom = 0;
          }
          if (now - lastDetect > 500) setBadge();
        } catch (err) {
          errStreak++;
          if (errStreak === 1) console.warn("[gestures] frame error", err);
          if (errStreak >= 8 && !recovering) {
            if (rebuilds < 2) void rebuild();
            else if (!cancelled) {
              setStatus("error");
              setErrorMsg("Hand tracking keeps failing. Reload the page and try again.");
            }
          }
        }
      };

      raf = requestAnimationFrame(tick);
    }

    run().catch((err: any) => {
      if (cancelled) return;
      setStatus("error");
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      const busy = err?.name === "NotReadableError" || /timeout starting video/i.test(err?.message || "");
      setErrorMsg(
        denied
          ? "Camera permission was denied."
          : busy
            ? "Camera is busy or not responding. Close other apps/tabs using it, check the privacy shutter, then press G twice."
            : err?.message || String(err)
      );
    });

    return teardown;
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
        <>
          <div
            ref={badgeRef}
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              color: "#fff",
              background: "rgba(0,0,0,0.55)",
              padding: "3px 8px",
              borderRadius: 6,
              pointerEvents: "none",
            }}
          >
            No hand
          </div>
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
            Point index (other fingers folded) + move = rotate · Pinch thumb+index: hold closed = zoom out, spread apart = zoom in
          </div>
        </>
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
