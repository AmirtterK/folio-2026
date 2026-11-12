"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CarPose } from "@/components/FolioCar";
import {
  TRACK_SCALE,
  TRACK_CENTER_X,
  TRACK_CENTER_Z,
} from "@/components/RacingTrack";

import { KNIGHT_POS, NEURAL_POS } from "@/components/landmarkConfig";

// Exact SVG Path extracted directly from the Monza circuit vector layout
const TRACK_PATH = "M 325.0 258.0 L 313.8 258.0 L 302.7 258.0 L 291.5 258.0 L 280.3 258.0 L 269.1 258.0 L 258.0 258.0 L 246.8 258.0 L 235.6 258.0 L 224.5 258.0 L 213.4 257.0 L 202.2 257.0 L 193.1 251.9 L 182.6 251.1 L 172.0 254.6 L 161.2 257.5 L 150.1 258.0 L 138.9 258.0 L 127.7 257.9 L 116.6 256.9 L 105.8 254.2 L 95.3 250.3 L 85.4 245.1 L 76.9 237.9 L 69.4 229.7 L 63.4 220.3 L 58.7 210.2 L 55.5 199.5 L 53.3 188.5 L 51.3 177.6 L 49.3 166.6 L 47.3 155.6 L 45.5 144.6 L 43.5 133.6 L 41.9 122.5 L 40.3 111.5 L 34.6 102.4 L 27.7 94.3 L 23.9 83.8 L 19.6 73.5 L 15.3 63.2 L 10.8 52.9 L 6.9 42.5 L 4.1 31.7 L 9.3 17.6 L 19.5 13.2 L 30.3 10.7 L 41.3 8.4 L 52.3 6.5 L 63.3 4.7 L 74.4 4.1 L 82.8 11.0 L 89.1 20.2 L 95.2 29.5 L 101.4 38.8 L 107.7 48.1 L 113.9 57.3 L 120.7 66.2 L 127.7 74.9 L 135.2 83.2 L 142.8 91.3 L 150.7 99.2 L 158.9 106.9 L 166.8 114.8 L 174.7 122.6 L 182.8 130.3 L 191.0 138.0 L 199.0 145.7 L 207.2 153.3 L 215.2 161.1 L 223.3 168.7 L 231.6 176.2 L 241.8 180.0 L 253.0 179.3 L 263.7 182.0 L 272.3 189.1 L 282.8 192.4 L 293.9 193.0 L 305.1 193.0 L 316.2 193.0 L 327.3 194.0 L 338.5 194.0 L 349.7 194.0 L 360.8 194.0 L 372.0 194.0 L 383.1 195.0 L 394.3 195.0 L 405.4 195.0 L 416.6 195.0 L 427.8 195.0 L 439.0 195.0 L 450.1 196.0 L 461.2 196.0 L 472.4 196.0 L 483.6 196.0 L 494.6 197.4 L 504.7 201.8 L 511.1 210.7 L 511.4 221.7 L 507.2 232.1 L 500.6 241.0 L 491.0 246.7 L 480.5 250.5 L 469.7 253.1 L 458.7 255.0 L 447.6 256.5 L 436.6 257.9 L 425.5 259.0 L 414.3 259.0 L 403.1 259.0 L 392.0 258.0 L 380.9 258.0 L 369.7 258.0 L 358.5 258.0 L 347.3 258.0 L 336.2 258.0 Z";

// Start line coordinates on SVG: x = 325.0, y = 258.0
const START_LINE_SVG = {
  x: 325.0,
  y: 258.0,
};

type MinimapProps = {
  pose: MutableRefObject<CarPose>;
  visible: boolean;
  onToggle: () => void;
};

export default function Minimap({ pose, visible, onToggle }: MinimapProps) {
  const markerRef = useRef<SVGGElement>(null);

  // 60fps silky smooth direct DOM transform update without React re-render
  useEffect(() => {
    if (!visible) return;
    let animId: number;

    const tick = () => {
      if (markerRef.current) {
        const p = pose.current;
        // Direct mathematical inverse of the 3D world coordinates
        const sx = p.x / TRACK_SCALE + TRACK_CENTER_X;
        const sz = p.z / TRACK_SCALE + TRACK_CENTER_Z;

        // Heading angle in SVG degrees (0° = up along -z, 90° = right along +x)
        const rotDeg = 180 - (p.yaw * 180) / Math.PI;

        markerRef.current.setAttribute(
          "transform",
          `translate(${sx.toFixed(1)}, ${sz.toFixed(1)}) rotate(${rotDeg.toFixed(1)})`
        );
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [pose, visible]);

  return (
    <div
      role="dialog"
      aria-modal={visible ? "true" : undefined}
      aria-hidden={!visible}
      aria-label="Track map. Tap anywhere to close."
      onClick={onToggle}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))",
        backgroundColor: "rgba(5, 8, 18, 0.35)",
        backdropFilter: "blur(2px)",
        userSelect: "none",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 0.35s ease",
      }}
    >
      <div
        style={{
          width: "min(75vw, 880px)",
          maxHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "clamp(5px, 1.1vw, 13px)",
          border: "1px solid rgba(255, 255, 255, 0.55)",
          borderRadius: 10,
          backgroundColor: "rgba(9, 13, 28, 0.85)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
          transform: visible ? "scale(1) translateY(0)" : "scale(0.92) translateY(12px)",
          opacity: visible ? 1 : 0,
          transition: "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease",
        }}
      >
        <svg
          viewBox="-16 -16 548 296"
          style={{
            width: "100%",
            height: "auto",
            maxHeight: "67vh",
            display: "block",
            overflow: "visible",
          }}
        >
          <defs>
            {/* Google Maps navigation beam gradient */}
            <linearGradient id="navBeamGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#4285F4" stopOpacity="0.5" />
              <stop offset="60%" stopColor="#4285F4" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#4285F4" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="arrowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#4285F4" />
              <stop offset="100%" stopColor="#1a73e8" />
            </linearGradient>
          </defs>

          {/* Track background outline / kerbs */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="#d82424"
            strokeWidth="28"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.85"
          />

          {/* Outer track border */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="#ffffff"
            strokeWidth="22"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />

          {/* Road asphalt surface */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="#1b181e"
            strokeWidth="16"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Center racing dash line */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth="2.2"
            strokeDasharray="8 9"
            strokeLinejoin="round"
          />

          {/* Start / Finish line bar */}
          <line
            x1={START_LINE_SVG.x}
            y1={START_LINE_SVG.y - 10}
            x2={START_LINE_SVG.x}
            y2={START_LINE_SVG.y + 10}
            stroke="#ffffff"
            strokeWidth="4"
            strokeDasharray="4 4"
          />

          {/* Achievement Trophy Landmark pin in infield */}
          <g transform={`translate(${(0 / TRACK_SCALE + TRACK_CENTER_X).toFixed(1)}, ${(20 / TRACK_SCALE + TRACK_CENTER_Z).toFixed(1)})`}>
            <text x="0" y="15" fontSize="40" textAnchor="middle" style={{ pointerEvents: "none" }}>🏆</text>
          </g>

          {/* Holographic Chess Knight Landmark pin on the long straight */}
          <g transform={`translate(${(KNIGHT_POS.x / TRACK_SCALE + TRACK_CENTER_X).toFixed(1)}, ${(KNIGHT_POS.z / TRACK_SCALE + TRACK_CENTER_Z).toFixed(1)})`}>
            <circle r="19" fill="rgba(10, 18, 56, 0.85)" stroke="#5ec8ff" strokeWidth="2.5" />
            <text x="0" y="13" fontSize="34" textAnchor="middle" fill="#5ec8ff" style={{ pointerEvents: "none" }}>♞</text>
          </g>

          {/* Holographic Neural Network Landmark pin on the main straight */}
          <g transform={`translate(${(NEURAL_POS.x / TRACK_SCALE + TRACK_CENTER_X).toFixed(1)}, ${(NEURAL_POS.z / TRACK_SCALE + TRACK_CENTER_Z).toFixed(1)})`}>
            <circle r="19" fill="rgba(10, 18, 56, 0.85)" stroke="#5ec8ff" strokeWidth="2.5" />
            <g stroke="#5ec8ff" strokeWidth="1.4" opacity="0.85" style={{ pointerEvents: "none" }}>
              <line x1="-9" y1="-7" x2="0" y2="-4" /><line x1="-9" y1="-7" x2="0" y2="4" />
              <line x1="-9" y1="0" x2="0" y2="-4" /><line x1="-9" y1="0" x2="0" y2="4" />
              <line x1="-9" y1="7" x2="0" y2="-4" /><line x1="-9" y1="7" x2="0" y2="4" />
              <line x1="0" y1="-4" x2="9" y2="0" /><line x1="0" y1="4" x2="9" y2="0" />
            </g>
            <g fill="#5ec8ff" style={{ pointerEvents: "none" }}>
              <circle cx="-9" cy="-7" r="2.4" /><circle cx="-9" cy="0" r="2.4" /><circle cx="-9" cy="7" r="2.4" />
              <circle cx="0" cy="-4" r="2.4" /><circle cx="0" cy="4" r="2.4" />
              <circle cx="9" cy="0" r="2.8" />
            </g>
          </g>

          {/* Logo obstacles at track center */}
          {[
            { x: 0, z: 0, color: "#D97757", glyph: "C" },
            { x: 3, z: 0, color: "#7A9DFF", glyph: "X" },
            { x: -3, z: 0, color: "#ffffff", glyph: "G" },
            { x: 0, z: 4, color: "#EEEEEE", glyph: "L" },
          ].map((o, i) => (
            <g key={i} transform={`translate(${(o.x / TRACK_SCALE + TRACK_CENTER_X).toFixed(1)}, ${(o.z / TRACK_SCALE + TRACK_CENTER_Z).toFixed(1)})`}>
              <circle r="9" fill="rgba(10,18,56,0.85)" stroke={o.color} strokeWidth="2" />
              <text x="0" y="4" fontSize="12" textAnchor="middle" fill={o.color} style={{ pointerEvents: "none" }}>{o.glyph}</text>
            </g>
          ))}

          {/* Real-time Player Navigation Pointer (Google Maps style) */}
          <g ref={markerRef}>
            {/* Soft heading vision cone / beam like Google Maps navigation */}
            <path d="M 0 0 L -18 -36 A 40 40 0 0 1 18 -36 Z" fill="url(#navBeamGrad)" />

            {/* Outer soft location pulse ring */}
            <circle
              r="17"
              fill="rgba(66, 133, 244, 0.2)"
              stroke="#4285F4"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />

            {/* Circular white base with blue border */}
            <circle r="11" fill="#ffffff" stroke="#1a73e8" strokeWidth="1.8" />

            {/* Sleek Google Maps navigation chevron arrow */}
            <path
              d="M 0 -14 L 8.5 7 L 0 3.2 L -8.5 7 Z"
              fill="url(#arrowGrad)"
              stroke="#ffffff"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />

            {/* Central white beacon dot */}
            <circle cx="0" cy="1" r="1.5" fill="#ffffff" />
          </g>
        </svg>
      </div>
    </div>
  );
}
