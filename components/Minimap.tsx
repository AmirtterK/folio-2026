"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CarPose } from "@/components/ToyCarSmoke";

// World coordinate bounds for the Monza track centerline
const MIN_X = -74;
const MAX_X = 71;
const MIN_Z = -137;
const MAX_Z = 104;

const SVG_W = 200;
const SVG_H = 260;
const PAD = 16;

// SVG Path generated from the exact 180 spline points of Autodromo Nazionale Monza
const TRACK_PATH =
  "M 72.8 174.0 L 74.2 171.0 L 74.7 167.7 L 74.6 164.2 L 74.4 160.9 L 73.9 157.5 L 73.5 154.2 L 73.1 150.9 L 72.8 147.5 L 72.8 144.2 L 72.8 140.9 L 72.8 137.5 L 72.8 134.2 L 72.8 130.8 L 72.8 127.5 L 72.8 124.1 L 72.8 120.8 L 72.8 117.5 L 72.8 114.0 L 72.8 110.8 L 72.7 107.4 L 72.7 104.1 L 72.7 100.7 L 72.7 97.4 L 72.6 94.0 L 72.6 90.7 L 72.7 87.4 L 72.8 83.8 L 72.9 80.7 L 73.0 77.3 L 73.2 74.0 L 73.8 70.6 L 75.0 67.5 L 76.9 64.6 L 76.9 61.4 L 74.0 59.0 L 71.5 56.4 L 72.1 53.2 L 73.0 50.0 L 73.7 46.6 L 74.6 43.3 L 75.9 40.2 L 77.8 37.2 L 80.0 34.4 L 82.4 31.7 L 85.2 29.2 L 88.3 27.1 L 91.7 25.2 L 95.3 23.6 L 99.0 22.2 L 103.0 21.2 L 107.0 20.7 L 111.0 21.0 L 115.0 21.8 L 118.8 23.1 L 122.5 24.6 L 125.9 26.5 L 128.9 28.7 L 131.5 31.3 L 133.6 34.1 L 135.3 37.2 L 136.8 40.3 L 137.7 43.6 L 138.2 46.9 L 138.4 50.2 L 138.6 53.6 L 138.9 56.8 L 139.3 60.2 L 139.6 63.6 L 139.9 66.9 L 140.0 70.2 L 140.0 73.6 L 139.8 76.9 L 139.5 80.3 L 138.9 83.6 L 137.7 86.8 L 135.4 89.5 L 132.6 91.9 L 132.6 95.0 L 135.6 97.3 L 138.5 99.7 L 139.6 102.9 L 139.7 106.2 L 140.3 109.5 L 140.9 112.8 L 141.8 116.1 L 143.5 119.2 L 146.2 121.6 L 149.6 123.5 L 153.4 124.7 L 157.4 124.6 L 161.3 123.5 L 165.3 122.8 L 169.2 123.8 L 172.3 125.9 L 174.7 128.6 L 176.2 131.7 L 177.0 135.0 L 177.2 138.4 L 176.7 141.7 L 175.6 144.9 L 174.0 148.0 L 172.4 151.0 L 170.8 154.1 L 169.2 157.2 L 167.6 160.3 L 166.0 163.3 L 164.3 166.4 L 162.6 169.4 L 160.9 172.5 L 159.2 175.5 L 157.6 178.6 L 156.1 181.7 L 155.0 184.9 L 154.0 188.1 L 153.1 191.4 L 152.2 194.7 L 151.2 197.9 L 150.3 201.2 L 149.4 204.5 L 148.2 207.7 L 146.4 210.6 L 143.4 212.9 L 140.0 214.9 L 137.6 217.5 L 139.2 220.5 L 141.7 223.2 L 141.8 226.4 L 139.4 229.1 L 136.3 231.3 L 133.0 233.3 L 129.3 234.8 L 125.5 235.8 L 121.6 236.6 L 117.5 237.2 L 113.4 237.6 L 109.3 237.9 L 105.2 238.2 L 101.2 238.3 L 97.1 238.5 L 93.0 238.6 L 88.9 238.6 L 84.8 238.5 L 80.7 238.5 L 76.6 238.3 L 72.5 238.2 L 68.4 238.1 L 64.3 237.9 L 60.2 237.7 L 56.1 237.4 L 52.0 236.8 L 48.1 236.1 L 44.1 235.3 L 40.2 234.4 L 36.4 233.1 L 33.0 231.3 L 30.1 229.0 L 27.7 226.3 L 25.7 223.3 L 24.2 220.2 L 23.1 217.0 L 22.5 213.7 L 22.3 210.3 L 22.5 207.0 L 23.1 203.7 L 24.1 200.4 L 25.5 197.2 L 27.4 194.4 L 29.8 191.6 L 32.5 189.2 L 35.6 186.9 L 38.8 184.9 L 42.4 183.3 L 46.2 182.0 L 50.1 180.9 L 53.9 179.8 L 57.8 178.7 L 61.7 177.8 L 65.8 177.1 L 69.6 176.1 L 72.8 174.0 Z";

// Start line coordinates on SVG: x = -25, z = 10
const START_LINE_SVG = {
  x: 72.8,
  y: 155.1,
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
            maxHeight: 220,
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

          {/* Corner labels */}
          <text x="108" y="14" fill="rgba(255,255,255,0.5)" fontSize="8" fontWeight="600" textAnchor="middle">Curva Grande</text>
          <text x="180" y="120" fill="rgba(255,255,255,0.5)" fontSize="8" fontWeight="600" textAnchor="start">Lesmo</text>
          <text x="156" y="240" fill="rgba(255,255,255,0.5)" fontSize="8" fontWeight="600" textAnchor="middle">Ascari</text>
          <text x="16" y="196" fill="rgba(255,255,255,0.5)" fontSize="8" fontWeight="600" textAnchor="end">Parabolica</text>
          <text x="50" y="60" fill="rgba(255,255,255,0.5)" fontSize="8" fontWeight="600" textAnchor="end">Rettifilo</text>

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
