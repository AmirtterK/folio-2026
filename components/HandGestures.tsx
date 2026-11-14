"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Spherical, Vector3 } from "three";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

/* ------------------------------------------------------------------------------------------------
 * Hand gestures -> camera control. With a hand in view it is ALWAYS exactly one of three things:
 *
 *   ORBIT      index finger out, thumb tucked, other fingers folded, then move
 *              => rotate the scene (it follows your hand, like dragging)
 *
 *   PINCH OUT  anything else, with the thumb and index tips close together
 *              => keeps zooming OUT for as long as you hold it
 *
 *   PINCH IN   anything else, with the thumb and index tips spread apart
 *              => keeps zooming IN for as long as you hold it
 *
 * There is no "hold still" zone: zoom is a single threshold (ZOOM_SPLIT) with a little hysteresis so it
 * doesn't flicker right at the border. No hand in view => nothing happens. The camera stops at its
 * min/max distance.
 *
 * Notes:
 *  - Hand pose comes from MediaPipe world landmarks (metric 3D) and finger bend angles, so it does not depend on
 *    how big the hand looks, the webcam aspect ratio or the hand orientation.
 *  - The pose has to be stable for a few frames before it counts, and a short dropout does not end a gesture.
 *  - The camera is moved directly with spherical coordinates around controls.target, every render frame, with a
 *    real dt, so it is frame-rate independent.
 *  - The small box on screen shows what the tracker sees and the live thumb/index gap, so ZOOM_SPLIT can be
 *    tuned from real numbers.
 * ---------------------------------------------------------------------------------------------- */

const WASM_PATH = "/mediapipe/wasm";
const MODEL_LOCAL = "/mediapipe/hand_landmarker.task"; // shipped in /public/mediapipe
const MODEL_REMOTE =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_CACHE = "hand-landmarker-v3";

const DETECT_CONF = 0.4; // MediaPipe default is 0.5; a bit lower = fewer dropouts

/* ---------- pose classification ---------- */

// finger state from the bend angle at the middle joint (degrees): below = straight, above = folded
const EXTENDED_BELOW = 40;
const FOLDED_ABOVE = 70;
// thumb tip to the nearest middle-finger point (knuckle, middle joint, tip) / hand size. This is what tells the two
// gestures apart: thumb RESTING ON the curled middle finger (small) = orbit, thumb AWAY from it (big) = zoom.
const THUMB_MID_ON = 0.5; // below this the thumb counts as next to the middle finger
const THUMB_MID_OFF = 0.65; // above this it counts as away again (hysteresis)

// pose debounce (ms)
const ENTER_MS = 60; // from nothing into a pose
const SWITCH_MS = 120; // directly from one pose to the other
const LOST_GRACE_MS = 250; // hand missing this long => nothing
const STALE_MS = 200; // no fresh detection this long => stop driving the camera

/* ---------- orbit ---------- */

const YAW_GAIN = 4.0; // rad of orbit per full video width of hand travel
const PITCH_GAIN = 3.0; // rad of tilt per full video width of hand travel
const DEADZONE = 0.03; // ignore hand speeds below this (video widths per second): kills jitter drift
const MAX_STEP = 0.25; // max rad applied from one detection frame (guards against tracking glitches)
const ROT_TAU = 0.05; // s, how smoothly the pending rotation is applied

/* ---------- zoom (pinch in / pinch out) ---------- */

const ZOOM_SETTLE_MS = 100; // right after the zoom pose appears the hand is still forming the shape: do nothing
const ZOOM_SPLIT = 0.8; // thumb/index gap: below = pinch (zoom OUT), above = spread (zoom IN)
const ZOOM_HYST = 0.04; // the gap must cross SPLIT by this much to flip direction (no flicker at the border)
const ZOOM_RATE = 1.4; // ln(distance) per second (constant speed)
const ZOOM_TAU = 0.07; // s, how smoothly the zoom speed follows
const MIN_APERTURE = 0.05;

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
type Pose = "none" | "orbit" | "zoom";
type ZoomDir = "in" | "out";

export type HandGesturesCameraProps = {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  enabled: boolean;
};

/* ---------- helpers ---------- */

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

/** Orbit / zoom the camera around controls.target. dLogRadius > 0 = zoom out, < 0 = zoom in. */
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

      // Ask for a modest size/fps first; if the camera rejects it, retry with no constraints at all.
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

      /* ------------------------------ gesture state ------------------------------ */
      const fingerExt = [false, false, false, false]; // index, middle, ring, pinky (hysteresis state)
      let thumbNearMid = false;
      let thumbMidDbg = 0; // thumb-to-middle-finger distance, shown in the preview label

      let pose: Pose = "none"; // debounced pose
      let cand: Pose = "none";
      let candSince = 0;
      let poseSince = 0;

      let hasHand = false;
      let lastSeen = 0;
      let lastDetect = 0;
      let lastVideoTime = -1;
      let lastTick = performance.now();
      let lastLabel = "";
      let aperture = 1;
      let zoomDir: ZoomDir | null = null;

      const fx = new OneEuro();
      const fy = new OneEuro();
      const fa = new OneEuro(1.5, 2); // smooths the thumb/index gap
      let prevX: number | null = null;
      let prevY = 0;
      let prevT = 0;

      let pendYaw = 0; // rotation still to be applied (rad)
      let pendPitch = 0;
      let zoomTarget = 0; // zoom speed asked for (ln distance / s)
      let zoomApplied = 0; // smoothed zoom speed actually applied

      let errStreak = 0;
      let rebuilds = 0;
      let recovering = false;

      const now0 = () => performance.now();

      const setBadge = () => {
        let label: string;
        if (!controlsRef.current) label = "Camera not ready";
        else if (!hasHand) label = "No hand";
        else if (pose === "orbit") label = `ORBIT (thumb-middle ${thumbMidDbg.toFixed(2)})`;
        else if (pose === "zoom") {
          const a = aperture.toFixed(2);
          label =
            now0() - poseSince < ZOOM_SETTLE_MS
              ? `Pinch · ready (gap ${a})`
              : zoomDir === "out"
                ? `Pinch IN → zoom OUT (gap ${a})`
                : `Pinch OUT → zoom IN (gap ${a})`;
        } else label = `Idle: curl the middle finger (thumb-middle ${thumbMidDbg.toFixed(2)})`;
        if (label !== lastLabel) {
          lastLabel = label;
          if (badgeRef.current) badgeRef.current.textContent = label;
        }
      };

      const enterPose = (next: Pose, now: number) => {
        pose = next;
        poseSince = now;
        fx.reset();
        fy.reset();
        fa.reset();
        prevX = null;
        pendYaw = 0;
        pendPitch = 0;
        zoomTarget = 0;
        zoomDir = null;
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
        const delay = pose === "none" ? ENTER_MS : SWITCH_MS;
        if (now - candSince >= delay) enterPose(raw, now);
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
        const accent = pose === "orbit" ? "#60a5fa" : pose === "zoom" ? "#facc15" : "#4ade80";
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        for (const [a, b] of BONES) {
          ctx.beginPath();
          ctx.moveTo(lm[a].x * c.width, lm[a].y * c.height);
          ctx.lineTo(lm[b].x * c.width, lm[b].y * c.height);
          ctx.stroke();
        }
        ctx.fillStyle = pose === "none" ? "#f87171" : accent;
        for (const i of [4, 8]) {
          ctx.beginPath();
          ctx.arc(lm[i].x * c.width, lm[i].y * c.height, i === 8 ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      const onNoHand = (now: number) => {
        draw(null);
        zoomTarget = 0;
        if (now - lastSeen > LOST_GRACE_MS) {
          hasHand = false;
          cand = "none";
          if (pose !== "none") enterPose("none", now);
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
        const pinchRatio = dist3(world[4], world[8]) / handSize; // thumb tip to index tip: the zoom gap
        const thumbMid =
          Math.min(dist3(world[4], world[9]), dist3(world[4], world[10]), dist3(world[4], world[11]), dist3(world[4], world[12])) /
          handSize;
        thumbMidDbg = thumbMid;
        thumbNearMid = thumbNearMid ? thumbMid < THUMB_MID_OFF : thumbMid < THUMB_MID_ON;

        const indexUp = fingerExt[0];
        const middleCurled = !fingerExt[1];

        // ORBIT: index pointing out, middle finger curled, thumb resting against the curled middle finger.
        // ZOOM:  middle finger curled, thumb AWAY from it; the thumb-index gap decides in / out.
        // Anything else (e.g. middle finger sticking out) does nothing.
        const orbitPose = indexUp && middleCurled && thumbNearMid;
        const zoomPose = middleCurled && !thumbNearMid;
        updatePose(orbitPose ? "orbit" : zoomPose ? "zoom" : "none", now);

        const t = now / 1000;
        if (pose === "orbit") {
          const sx = fx.filter(lm[8].x, t);
          const sy = fy.filter(lm[8].y, t);
          if (prevX !== null) {
            const dt = clamp(t - prevT, 1 / 120, 0.2);
            const vx = deadzone((sx - prevX) / dt);
            const vy = deadzone((sy - prevY) / dt);
            // raw (un-mirrored) x: moving your hand right decreases x => orbit so the scene follows the hand
            pendYaw += clamp(vx * dt * YAW_GAIN, -MAX_STEP, MAX_STEP);
            pendPitch += clamp(-vy * dt * aspect * PITCH_GAIN, -MAX_STEP, MAX_STEP);
          }
          prevX = sx;
          prevY = sy;
          prevT = t;
          zoomTarget = 0;
        } else if (pose === "zoom") {
          aperture = Math.max(MIN_APERTURE, fa.filter(pinchRatio, t));
          // single threshold with hysteresis: pinched = OUT, spread = IN, never "hold"
          if (zoomDir === null) zoomDir = aperture < ZOOM_SPLIT ? "out" : "in";
          else if (zoomDir === "out" && aperture > ZOOM_SPLIT + ZOOM_HYST) zoomDir = "in";
          else if (zoomDir === "in" && aperture < ZOOM_SPLIT - ZOOM_HYST) zoomDir = "out";
          zoomTarget = now - poseSince >= ZOOM_SETTLE_MS ? (zoomDir === "out" ? ZOOM_RATE : -ZOOM_RATE) : 0;
        } else {
          zoomTarget = 0;
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
          // detect at ~30fps (rendering and camera motion still run every frame)
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

          // stale detections (stalled camera, throttled tab...) must not keep driving the camera
          if (!(hasHand && now - lastDetect <= STALE_MS)) zoomTarget = 0;

          // apply pending rotation smoothly, and ease the zoom speed toward its target
          const kRot = 1 - Math.exp(-dt / ROT_TAU);
          const dYaw = pendYaw * kRot;
          const dPitch = pendPitch * kRot;
          pendYaw -= dYaw;
          pendPitch -= dPitch;
          if (Math.abs(pendYaw) < 1e-5) pendYaw = 0;
          if (Math.abs(pendPitch) < 1e-5) pendPitch = 0;
          zoomApplied += (zoomTarget - zoomApplied) * (1 - Math.exp(-dt / ZOOM_TAU));
          if (Math.abs(zoomApplied) < 1e-3 && zoomTarget === 0) zoomApplied = 0;

          const controls = controlsRef.current;
          if (!controls) {
            pendYaw = pendPitch = zoomApplied = 0;
          } else if (dYaw !== 0 || dPitch !== 0 || zoomApplied !== 0) {
            orbit(controls, dYaw, dPitch, zoomApplied * dt);
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
            One finger (thumb tucked) + move = orbit · Otherwise: pinch fingers together = zoom out, spread thumb and
            index apart = zoom in
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
