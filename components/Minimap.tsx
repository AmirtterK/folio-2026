"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CarPose } from "@/components/ToyCarSmoke";

// World coordinate bounds for the track centerline
const MIN_X = -82;
const MAX_X = 60;
const MIN_Z = -85;
const MAX_Z = 73;

const SVG_W = 200;
const SVG_H = 220;
const PAD = 16;

// SVG Path generated from the exact 136 track centerline cross-sections
const TRACK_PATH =
  "M 67.8 70.5 L 67.8 34.7 L 67.8 31.1 L 67.6 28.7 L 66.8 26.4 L 65.7 24.4 L 64.1 22.6 L 62.2 21 L 60 19.9 L 57.6 19.2 L 55 18.9 L 52.2 18.9 L 34.4 18.9 L 31.7 18.9 L 29.1 19.2 L 26.7 20 L 24.6 21.4 L 22.7 23.1 L 21.2 25.1 L 20.1 27.4 L 19.3 29.8 L 19.1 32.4 L 19.1 35.9 L 19.1 67.6 L 19.1 71.2 L 19.4 74 L 20.1 76.5 L 21.3 78.8 L 22.9 80.7 L 24.8 82.3 L 27 83.5 L 29.3 84.2 L 31.8 84.5 L 35.7 84.5 L 78.1 84.5 L 81.9 84.5 L 84.5 84.2 L 86.8 83.6 L 89 82.5 L 90.9 81 L 92.5 79.1 L 93.8 77 L 94.5 74.6 L 94.8 71.9 L 94.8 68.2 L 94.8 35.6 L 94.8 32.2 L 95 30.1 L 95.6 28.1 L 96.5 26.3 L 97.8 24.8 L 99.3 23.5 L 101.1 22.5 L 103.1 21.9 L 105.2 21.7 L 109.1 21.7 L 159.2 21.7 L 162.3 21.7 L 165.9 22 L 169.2 23 L 172.4 24.6 L 175.2 26.9 L 177.5 29.7 L 179.3 33.2 L 180.5 37.3 L 180.9 42 L 180.4 46 L 179 49.6 L 177 52.7 L 174.4 55.4 L 171.5 57.5 L 168.3 59 L 165.1 60 L 162 60.3 L 145 60.3 L 142.7 60.3 L 140.3 60.5 L 138.2 61.3 L 136.2 62.4 L 134.3 63.8 L 132.5 65.4 L 130.8 67.2 L 104.4 98.7 L 103.1 100.4 L 102 102 L 101.1 103.5 L 100.5 105.1 L 100 106.9 L 99.8 108.9 L 99.7 111.3 L 99.7 114.9 L 99.6 147.6 L 99.6 153.1 L 99.6 157 L 99.3 160.5 L 98.3 163.6 L 96.8 166.6 L 94.7 169.6 L 92 172.7 L 73.1 191.3 L 69.7 194.2 L 66.3 196.6 L 62.7 198.4 L 58.6 199.7 L 53.8 200.6 L 48.1 201 L 42 200.9 L 36.4 200 L 31.5 198.4 L 27.3 196.1 L 23.8 193.2 L 21.2 189.6 L 19.6 185.5 L 19.1 180.8 L 19.1 176.5 L 19.1 155.2 L 19.5 151.7 L 20.6 148.2 L 22.3 145 L 24.7 142.1 L 27.6 139.7 L 31.1 137.8 L 34.9 136.6 L 39.1 136.2 L 50.5 136.2 L 52.9 136.2 L 55.8 135.8 L 58.6 134.9 L 61.2 133.5 L 63.4 131.6 L 65.2 129.4 L 66.6 127 L 67.5 124.4 L 67.8 121.8 L 67.8 118.7 L 67.8 91.9 Z";

// Start line coordinates on SVG: x = -11.28, z = 0
const START_LINE_SVG = {
  x: PAD + ((-11.28 - MIN_X) / (MAX_X - MIN_X)) * (SVG_W - 2 * PAD),
  y: PAD + ((0 - MIN_Z) / (MAX_Z - MIN_Z)) * (SVG_H - 2 * PAD),
};

type MinimapProps = {
  pose: MutableRefObject<CarPose>;
  visible: boolean;
  onToggle: () => void;
  onReset?: () => void;
};

export default function Minimap({ pose, visible, onToggle, onReset }: MinimapProps) {
  const markerRef = useRef<SVGGElement>(null);

  // 60fps silky smooth direct DOM transform update without React re-render
  useEffect(() => {
    let animId: number;

    const tick = () => {
      if (markerRef.current) {
        const p = pose.current;
        const normX = (p.x - MIN_X) / (MAX_X - MIN_X);
        const normZ = (p.z - MIN_Z) / (MAX_Z - MIN_Z);

        const sx = PAD + Math.max(0, Math.min(1, normX)) * (SVG_W - 2 * PAD);
        const sz = PAD + Math.max(0, Math.min(1, normZ)) * (SVG_H - 2 * PAD);

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
  }, [pose]);

  if (!visible) {
    return (
      <button
        onClick={onToggle}
        title="Open Minimap (or press 'M')"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          padding: "8px 14px",
          borderRadius: 12,
          backgroundColor: "rgba(22, 20, 26, 0.88)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          border: "1.5px solid rgba(255, 255, 255, 0.2)",
          backdropFilter: "blur(8px)",
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          zIndex: 10,
        }}
      >
        🗺️ Minimap [M]
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        width: 220,
        borderRadius: 16,
        backgroundColor: "rgba(22, 20, 26, 0.88)",
        border: "1.5px solid rgba(255, 255, 255, 0.18)",
        backdropFilter: "blur(10px)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        overflow: "hidden",
        zIndex: 10,
        userSelect: "none",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px 4px 12px",
          color: "rgba(255,255,255,0.85)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.8,
        }}
      >
        <span>TRACK RADAR</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {onReset && (
            <button
              onClick={onReset}
              title="Reset Car (R)"
              style={{
                background: "none",
                border: "none",
                color: "#ff7a1a",
                cursor: "pointer",
                fontSize: 13,
                padding: "0 4px",
              }}
            >
              ⟲
            </button>
          )}
          <button
            onClick={onToggle}
            title="Minimize (M)"
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
              fontSize: 14,
              padding: "0 2px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Circuit Radar SVG */}
      <div style={{ padding: "4px 10px 8px 10px", display: "flex", justifyContent: "center" }}>
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{
            width: "100%",
            height: "auto",
            maxHeight: 190,
            overflow: "visible",
          }}
        >
          <defs>
            {/* Glow filter for the player cursor */}
            <filter id="carGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#ff7a1a" floodOpacity="0.9" />
            </filter>
          </defs>

          {/* Track background outline / kerbs */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="#d82424"
            strokeWidth="15"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.85"
          />

          {/* Outer track border */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="#ffffff"
            strokeWidth="11"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.9"
          />

          {/* Road asphalt surface */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="#1b181e"
            strokeWidth="8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Center racing dash line */}
          <path
            d={TRACK_PATH}
            fill="none"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth="1.2"
            strokeDasharray="4 5"
            strokeLinejoin="round"
          />

          {/* Start / Finish line bar */}
          <line
            x1={START_LINE_SVG.x - 7}
            y1={START_LINE_SVG.y}
            x2={START_LINE_SVG.x + 7}
            y2={START_LINE_SVG.y}
            stroke="#ffffff"
            strokeWidth="3"
            strokeDasharray="2.5 2.5"
          />

          {/* Real-time Player Car Marker */}
          <g ref={markerRef} filter="url(#carGlow)">
            {/* Player vehicle arrow */}
            <polygon
              points="0,-7 5,6 0,3.5 -5,6"
              fill="#ff7a1a"
              stroke="#ffffff"
              strokeWidth="1"
            />
            {/* Center dot */}
            <circle r="1.5" fill="#ffffff" />
          </g>
        </svg>
      </div>
    </div>
  );
}
