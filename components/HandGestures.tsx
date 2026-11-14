"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Spherical, Vector3 } from "three";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

/* ------------------------------------------------------------------------------------------------
 * Hand gestures -> fixed camera control (rotate only)
 *
 *   POINT  (index out, middle/ring/pinky folded)  + move   => rotate/orbit (drag feel: the scene follows your hand)
 *   PINCH  (middle/ring/pinky folded, thumb + index)       => zoom, touchscreen style: the aperture when the gesture
 *          starts is the anchor; spreading thumb/index zooms in, closing them zooms out (1:1, proportional)
 *   anything else                                          => nothing happens
 *
 * Design notes (why it is built this way):
 *  - Poses are classified from MediaPipe *world* landmarks (metric 3D), using joint bend angles, so the result
 *    does not depend on the webcam aspect ratio, hand size, or hand orientation.
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
const MODEL_CACHE = "hand-landmarker-v3";

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
// Pinch zoom (thumb tip to index tip distance / hand size = "aperture"), touchscreen style:
// the aperture when the gesture starts is the anchor; spreading from it zooms in, closing it zooms out.
const ZOOM_GAIN = 1.0; // camera distance = anchorDistance * (anchorAperture / aperture) ^ ZOOM_GAIN
const ZOOM_SETTLE_MS = 150; // after entering zoom wait this long before taking the anchor (hand is still forming the shape)
const ZOOM_MIN_APERTURE = 0.12; // floor so a fully closed pinch cannot blow up the ratio
const ZOOM_MAX_APERTURE = 2.2; // wider than this and it is no longer a zoom gesture
const ZOOM_MAX_LOG = 1.6; // max |ln(distance change)| from the anchor in one gesture (~5x)
const ZOOM_FOLLOW = 6; // 1/s, how hard the camera chases the pinch target
const ZOOM_MAX_SPEED = 3; // max ln(distance) per second
const ZOOM_EPS = 0.008; // ignore remaining error below this
// Non-stop zoom: keep the pinch spread (or closed) well past the anchor and the camera keeps zooming on its own,
// accumulating across repeated pinches, until it hits the controls' min/max distance.
const ZOOM_DRIFT_START = 0.8; // |ln(aperture / anchor)| beyond this starts the continuous zoom (~2.2x spread / ~0.45x close)
const ZOOM_DRIFT_FULL = 0.7; // ...and reaches full drift speed this much further out
const ZOOM_DRIFT_RATE = 1.2; // ln(distance) per second at full drift
const DEADZONE = 0.03; // ignore hand speeds below this (video widths per second): kills jitter drift
const MAX_ANG_SPEED = 5; // rad/s
// Thumb sticking out (thumb tip to index knuckle / hand size), used to tell a zoom spread from a pointing hand
const THUMB_OUT_ON = 0.65;
const THUMB_OUT_OFF = 0.45;
const INDEX_FIST_BEND = 95; // index bend (deg) above this = curled into a fist, never a pinch
const SWITCH_MS = 90; // switching directly between rotate and zoom needs this much stability
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
      let zoomSince = 0; // when zoom mode was entered
      let zoomAnchorAperture = -1; // aperture at the start of the pinch (-1 = not taken yet)
      let zoomAnchorLog = 0; // ln(camera distance) at the start of the pinch
      let zoomTarget: number | null = null; // ln(camera distance) the pinch is asking for
      let zoomDrift = 0; // accumulated continuous-zoom offset (ln distance) for this gesture
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
      const fr = new OneEuro(1.2, 3); // smooths the pinch aperture
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
          ? "Camera not ready"
          : !hasHand
            ? "No hand"
            : mode === "rotate"
              ? "Rotate"
              : mode === "zoom"
                ? "Zoom"
                : "";
        if (label !== lastLabel) {
          lastLabel = label;
          if (badgeRef.current) badgeRef.current.textContent = label;
        }
      };

      const setMode = (m: Mode, now: number) => {
        if (m === mode) return;
        if (mode === "zoom") wZoom = 0; // no glide after a pinch: it stops where you stop
        mode = m;
        fx.reset();
        fy.reset();
        fr.reset();
        prevX = null;
        tYaw = tPitch = tZoom = 0;
        zoomTarget = null;
        zoomAnchorAperture = -1;
        zoomDrift = 0;
        zoomSince = now;
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
        // start from idle immediately; dropping to none and switching between gestures are debounced
        const delay = raw === "none" ? EXIT_MS : pose === "none" ? 0 : SWITCH_MS;
        if (now - candSince >= delay) pose = raw;
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
          setMode("idle", now);
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
        const indexBend = bendDeg(world, 5, 6, 8);
        // ZOOM: middle/ring/pinky folded, index not curled into a fist, and the thumb is either clearly out or
        //       touching the index tip (works from a closed pinch AND from an open, spread thumb+index).
        // POINT: index out, thumb tucked, the rest folded.
        const zoomGesture =
          others === 0 && indexBend < INDEX_FIST_BEND && (thumbOut || pinchOn) && pinchRatio < ZOOM_MAX_APERTURE;
        const pointing = !zoomGesture && fingerExt[0] && others === 0;

        rawPose = zoomGesture ? "zoom" : pointing ? "point" : "none";
        updatePose(rawPose, now);
        setMode(pose === "point" ? "rotate" : pose === "zoom" ? "zoom" : "idle", now);

        if (mode === "rotate") {
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
        } else if (mode === "zoom") {
          const t = now / 1000;
          const aperture = Math.max(ZOOM_MIN_APERTURE, fr.filter(pinchRatio, t));
          const controls = controlsRef.current;
          if (controls && now - zoomSince >= ZOOM_SETTLE_MS) {
            const curLog = Math.log(controls.object.position.distanceTo(controls.target));
            const hadAnchor = zoomAnchorAperture >= 0;
            if (!hadAnchor) {
              zoomAnchorAperture = aperture;
              zoomAnchorLog = curLog;
            }
            // spread (aperture grows) => distance shrinks => zoom in; pinch closed => zoom out
            const d = Math.log(aperture / zoomAnchorAperture); // + = spread, - = closed
            const delta = clamp(-ZOOM_GAIN * d, -ZOOM_MAX_LOG, ZOOM_MAX_LOG);
            // held far past the anchor => keep zooming non-stop (accumulates over repeated pinches)
            if (hadAnchor) {
              const dt = clamp(t - prevT, 0, 0.1);
              const over = clamp((Math.abs(d) - ZOOM_DRIFT_START) / ZOOM_DRIFT_FULL, 0, 1);
              zoomDrift -= Math.sign(d) * over * ZOOM_DRIFT_RATE * dt;
            }
            // stay inside the camera's distance limits so nothing winds up past the boundary
            const lo = Math.log(Math.max(controls.minDistance || 0, 1e-3));
            const hi = Number.isFinite(controls.maxDistance) ? Math.log(controls.maxDistance) : Infinity;
            zoomTarget = clamp(zoomAnchorLog + delta + zoomDrift, lo, hi);
            zoomDrift = zoomTarget - zoomAnchorLog - delta;
          } else {
            zoomTarget = null;
          }
          tYaw = tPitch = 0;
          prevX = null;
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
          if (!driving) {
            tYaw = tPitch = tZoom = 0;
            zoomTarget = null;
          }
          // pinch zoom: chase the target distance every render frame (smooth, no overshoot between detections)
          if (driving && mode === "zoom" && zoomTarget !== null) {
            const c = controlsRef.current;
            if (c) {
              const err = zoomTarget - Math.log(c.object.position.distanceTo(c.target));
              tZoom = Math.abs(err) < ZOOM_EPS ? 0 : clamp(err * ZOOM_FOLLOW, -ZOOM_MAX_SPEED, ZOOM_MAX_SPEED);
            }
          }

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
            Point index (thumb tucked) + move = rotate · Thumb+index out, other fingers folded: spread = zoom in, pinch = zoom out
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
