"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CarPose } from "@/components/ToyCarSmoke";

// World coordinate bounds for the Monza track centerline (500gt3.com layout)
const MIN_X = -90;
const MAX_X = 91;
const MIN_Z = -48;
const MAX_Z = 48;

const SVG_W = 240;
const SVG_H = 140;
const PAD = 14;

// SVG Path generated from the exact 180 spline points of Autodromo Nazionale Monza
const TRACK_PATH =
  "M 134.7 118.1 L 132.0 118.1 L 129.1 118.1 L 126.3 118.1 L 123.5 118.1 L 120.7 118.1 L 117.9 118.1 L 115.1 118.1 L 112.2 118.2 L 109.4 118.3 L 106.6 118.4 L 103.8 118.1 L 101.1 117.3 L 98.5 116.2 L 95.8 115.4 L 93.0 115.4 L 90.3 116.1 L 87.7 117.1 L 85.0 117.9 L 82.2 118.4 L 79.4 118.8 L 76.6 119.0 L 73.8 119.1 L 71.0 119.1 L 68.2 118.9 L 65.4 118.6 L 62.7 118.1 L 60.0 117.3 L 57.3 116.4 L 54.8 115.2 L 52.5 113.7 L 50.2 112.0 L 48.1 110.0 L 46.2 108.0 L 44.4 105.8 L 43.0 103.4 L 41.9 100.8 L 41.0 98.2 L 40.3 95.5 L 39.6 92.8 L 39.0 90.0 L 38.5 87.3 L 38.0 84.5 L 37.5 81.8 L 36.9 79.0 L 36.4 76.3 L 36.0 73.5 L 35.9 70.7 L 35.8 67.9 L 35.5 65.1 L 34.6 62.5 L 33.3 60.0 L 31.7 57.7 L 30.1 55.4 L 28.7 52.9 L 27.4 50.5 L 26.2 47.9 L 25.0 45.4 L 23.7 42.9 L 22.3 40.5 L 20.9 38.0 L 20.0 35.4 L 19.9 32.6 L 20.5 29.9 L 21.7 27.3 L 23.3 25.0 L 25.7 23.7 L 28.5 23.3 L 31.3 23.1 L 34.1 22.8 L 36.9 22.1 L 39.6 21.3 L 42.3 20.8 L 45.1 21.3 L 47.6 22.6 L 49.8 24.2 L 51.9 26.1 L 53.8 28.2 L 55.5 30.4 L 57.0 32.8 L 58.5 35.2 L 60.0 37.5 L 61.3 40.0 L 62.7 42.4 L 64.2 44.8 L 65.9 47.0 L 67.9 49.0 L 69.9 51.0 L 72.0 52.9 L 74.0 54.8 L 76.2 56.6 L 78.3 58.4 L 80.4 60.2 L 82.4 62.2 L 84.4 64.2 L 86.4 66.2 L 88.4 68.2 L 90.4 70.1 L 92.5 72.0 L 94.6 73.9 L 96.7 75.7 L 98.8 77.6 L 100.9 79.4 L 103.0 81.3 L 105.1 82.9 L 107.6 84.5 L 110.0 85.9 L 112.5 87.2 L 115.1 88.4 L 117.7 89.4 L 120.4 90.2 L 123.1 91.0 L 125.8 91.6 L 128.6 92.2 L 131.3 92.8 L 134.1 93.2 L 136.9 93.4 L 139.7 93.5 L 142.5 93.4 L 145.3 93.4 L 148.1 93.4 L 150.9 93.4 L 153.8 93.4 L 156.6 93.4 L 159.4 93.4 L 162.2 93.4 L 165.0 93.4 L 167.8 93.4 L 170.6 93.4 L 173.4 93.4 L 176.3 93.4 L 179.1 93.4 L 181.9 93.4 L 184.7 93.4 L 187.5 93.4 L 190.3 93.4 L 193.1 93.4 L 195.9 93.4 L 198.7 93.4 L 201.6 93.3 L 204.4 93.2 L 207.2 93.3 L 210.0 93.5 L 212.8 93.6 L 215.6 94.0 L 218.0 95.3 L 219.3 97.8 L 219.7 100.6 L 219.6 103.4 L 218.8 106.1 L 217.1 108.2 L 214.8 109.9 L 212.4 111.3 L 209.9 112.7 L 207.4 113.9 L 204.7 114.9 L 202.0 115.7 L 199.3 116.4 L 196.5 116.8 L 193.7 117.0 L 190.9 117.1 L 188.1 117.2 L 185.3 117.3 L 182.5 117.2 L 179.7 117.2 L 176.9 117.2 L 174.1 117.2 L 171.2 117.2 L 168.4 117.2 L 165.6 117.2 L 162.8 117.1 L 160.0 117.2 L 157.2 117.3 L 154.4 117.5 L 151.6 117.8 L 148.8 118.0 L 146.0 118.2 L 143.2 118.2 L 140.3 118.2 L 137.5 118.2 L 134.7 118.1 Z";

// Start line coordinates on SVG: x = 13.08, z = 41.27
const START_LINE_SVG = {
  x: 134.7,
  y: 118.1,
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
        width: 250,
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
          color: "rgba(255,255,255,0.9)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.8,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: "#d82424" }}>●</span> MONZA RADAR
        </span>
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
            maxHeight: 160,
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

          {/* Corner labels matching 500gt3.com */}
          <text x="32" y="14" fill="rgba(255,255,255,0.5)" fontSize="7.5" fontWeight="600" textAnchor="middle">Lesmo (6-7)</text>
          <text x="14" y="55" fill="rgba(255,255,255,0.5)" fontSize="7.5" fontWeight="600" textAnchor="end">Roggia (4-5)</text>
          <text x="35" y="126" fill="rgba(255,255,255,0.5)" fontSize="7.5" fontWeight="600" textAnchor="middle">Curva Grande (3)</text>
          <text x="96" y="133" fill="rgba(255,255,255,0.5)" fontSize="7.5" fontWeight="600" textAnchor="middle">Rettifilo (1-2)</text>
          <text x="110" y="74" fill="rgba(255,255,255,0.5)" fontSize="7.5" fontWeight="600" textAnchor="middle">Ascari (8-10)</text>
          <text x="228" y="86" fill="rgba(255,255,255,0.5)" fontSize="7.5" fontWeight="600" textAnchor="middle">Parabolica (11)</text>

          {/* Start / Finish line bar */}
          <line
            x1={START_LINE_SVG.x}
            y1={START_LINE_SVG.y - 6}
            x2={START_LINE_SVG.x}
            y2={START_LINE_SVG.y + 6}
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
