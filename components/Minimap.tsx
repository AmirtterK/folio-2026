"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CarPose } from "@/components/ToyCarSmoke";

// World coordinate bounds for the Monza track centerline (500gt3.com layout)
const MIN_X = -95;
const MAX_X = 110;
const MIN_Z = -75;
const MAX_Z = 52;

const SVG_W = 260;
const SVG_H = 170;
const PAD = 16;

// SVG Path generated from the exact 240 spline points of Autodromo Nazionale Monza
const TRACK_PATH =
  "M 149.5 146.4 L 147.0 146.4 L 144.5 146.4 L 142.0 146.4 L 139.5 146.4 L 137.0 146.4 L 134.5 146.4 L 132.0 146.4 L 129.5 146.4 L 127.0 146.4 L 124.5 146.4 L 121.9 146.4 L 119.5 146.4 L 116.9 146.4 L 114.5 146.4 L 111.9 146.5 L 109.4 146.6 L 106.9 146.6 L 104.4 146.6 L 101.8 146.4 L 99.5 146.2 L 97.0 145.9 L 94.6 145.3 L 92.5 144.0 L 91.3 141.8 L 90.6 139.5 L 89.9 137.1 L 88.8 134.9 L 86.6 134.0 L 84.1 134.3 L 81.9 135.3 L 80.5 137.3 L 79.8 139.7 L 79.3 142.2 L 78.6 144.5 L 77.1 146.4 L 74.8 147.2 L 72.2 147.2 L 69.7 146.9 L 67.3 146.6 L 64.8 146.2 L 62.3 145.9 L 59.9 145.5 L 57.4 145.0 L 55.0 144.2 L 52.8 143.2 L 50.7 141.9 L 48.7 140.3 L 46.9 138.6 L 45.2 136.9 L 43.6 135.0 L 42.1 133.0 L 40.7 131.0 L 39.5 128.9 L 38.4 126.7 L 37.4 124.4 L 36.5 122.1 L 35.7 119.8 L 35.0 117.5 L 34.4 115.1 L 33.9 112.7 L 33.6 110.3 L 33.3 107.8 L 33.1 105.4 L 32.9 103.0 L 32.7 100.5 L 32.6 98.1 L 32.5 95.7 L 32.5 93.2 L 32.5 90.8 L 32.6 88.3 L 32.6 85.9 L 32.7 83.4 L 32.7 81.0 L 32.8 78.5 L 32.8 76.1 L 32.9 73.6 L 32.9 71.2 L 32.8 68.7 L 32.6 66.3 L 32.3 63.9 L 31.8 61.5 L 30.9 59.2 L 29.5 57.3 L 27.4 55.8 L 25.3 54.5 L 23.3 53.0 L 22.8 50.8 L 23.9 48.6 L 25.6 46.8 L 27.4 45.1 L 29.6 43.9 L 31.9 43.0 L 34.1 41.8 L 35.5 39.8 L 36.0 37.4 L 36.3 35.0 L 36.9 32.6 L 38.3 30.6 L 39.9 28.7 L 41.8 27.1 L 43.8 25.8 L 46.2 24.8 L 48.6 24.3 L 51.1 24.0 L 53.6 23.7 L 56.0 23.5 L 58.6 23.3 L 61.1 23.1 L 63.6 23.1 L 66.1 23.2 L 68.5 23.7 L 70.9 24.4 L 73.2 25.3 L 75.5 26.4 L 77.6 27.7 L 79.6 29.2 L 81.2 31.0 L 82.6 33.0 L 83.8 35.1 L 85.1 37.3 L 86.4 39.3 L 87.8 41.4 L 89.2 43.4 L 90.6 45.5 L 91.9 47.5 L 93.3 49.5 L 94.7 51.5 L 96.2 53.5 L 97.6 55.5 L 99.1 57.5 L 100.5 59.5 L 102.0 61.5 L 103.5 63.5 L 104.9 65.5 L 106.4 67.5 L 107.8 69.4 L 109.3 71.4 L 110.7 73.4 L 112.2 75.4 L 113.6 77.4 L 115.1 79.4 L 116.5 81.4 L 118.0 83.3 L 119.4 85.4 L 120.9 87.4 L 122.3 89.4 L 123.7 91.4 L 125.2 93.4 L 126.7 95.4 L 128.3 97.4 L 129.6 99.2 L 131.0 101.3 L 132.5 103.3 L 134.2 105.2 L 136.3 106.2 L 138.0 104.5 L 139.3 102.3 L 140.7 100.2 L 143.0 99.6 L 145.4 100.4 L 147.5 101.6 L 149.6 103.0 L 151.3 104.8 L 152.7 106.9 L 154.1 108.9 L 156.0 110.4 L 158.3 111.3 L 160.8 111.6 L 163.3 111.6 L 165.8 111.6 L 168.2 111.6 L 170.8 111.7 L 173.3 111.7 L 175.8 111.7 L 178.3 111.7 L 180.8 111.6 L 183.3 111.6 L 185.8 111.6 L 188.3 111.6 L 190.8 111.6 L 193.3 111.6 L 195.8 111.6 L 198.4 111.6 L 200.8 111.6 L 203.3 111.5 L 205.8 111.4 L 208.3 111.4 L 210.8 111.4 L 213.3 111.7 L 215.8 112.1 L 218.2 112.5 L 220.7 113.1 L 223.0 114.0 L 225.3 115.0 L 227.4 116.2 L 229.5 117.7 L 231.4 119.3 L 233.0 121.1 L 234.4 123.1 L 235.4 125.4 L 236.1 127.8 L 236.4 130.2 L 236.2 132.6 L 235.4 134.9 L 234.2 137.1 L 232.6 139.0 L 230.9 140.8 L 228.9 142.2 L 226.6 143.2 L 224.3 144.1 L 221.9 144.8 L 219.5 145.3 L 217.0 145.8 L 214.5 146.0 L 212.0 146.2 L 209.5 146.3 L 207.0 146.3 L 204.5 146.4 L 202.0 146.5 L 199.5 146.5 L 197.0 146.5 L 194.5 146.4 L 192.0 146.4 L 189.5 146.4 L 187.0 146.4 L 184.5 146.4 L 182.0 146.4 L 179.5 146.4 L 177.0 146.4 L 174.5 146.4 L 172.0 146.4 L 169.4 146.4 L 167.0 146.4 L 164.5 146.4 L 162.0 146.4 L 159.5 146.4 L 157.0 146.4 L 154.5 146.4 L 152.0 146.4 L 149.5 146.4 Z";

// Start line coordinates on SVG: x = 25.0, z = 45.0
const START_LINE_SVG = {
  x: 149.5,
  y: 146.4,
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
            {/* Pulsing radar target ring */}
            <circle
              r="9.5"
              fill="rgba(255, 122, 26, 0.22)"
              stroke="#ff7a1a"
              strokeWidth="0.8"
              strokeDasharray="2.5 2"
            />

            {/* Wheels */}
            {/* Front Left */}
            <rect x="-5.2" y="-6.5" width="2" height="4" rx="0.8" fill="#141216" stroke="#ffffff" strokeWidth="0.4" />
            {/* Front Right */}
            <rect x="3.2" y="-6.5" width="2" height="4" rx="0.8" fill="#141216" stroke="#ffffff" strokeWidth="0.4" />
            {/* Rear Left */}
            <rect x="-5.5" y="2.5" width="2.2" height="4.5" rx="0.8" fill="#141216" stroke="#ffffff" strokeWidth="0.4" />
            {/* Rear Right */}
            <rect x="3.3" y="2.5" width="2.2" height="4.5" rx="0.8" fill="#141216" stroke="#ffffff" strokeWidth="0.4" />

            {/* Car Chassis Body */}
            <path
              d="M 0 -8.5 L 2.8 -4 L 3.4 3.5 L 3.8 7 L -3.8 7 L -3.4 3.5 L -2.8 -4 Z"
              fill="#ff7a1a"
              stroke="#ffffff"
              strokeWidth="0.8"
              strokeLinejoin="round"
            />

            {/* Rear Spoiler / Wing */}
            <rect x="-5.2" y="6.6" width="10.4" height="1.6" rx="0.5" fill="#ffffff" stroke="#ff7a1a" strokeWidth="0.5" />

            {/* Twin Headlights */}
            <circle cx="-1.6" cy="-7.5" r="0.6" fill="#ffff99" />
            <circle cx="1.6" cy="-7.5" r="0.6" fill="#ffff99" />

            {/* Cockpit Canopy */}
            <ellipse cx="0" cy="0" rx="1.6" ry="2.2" fill="#1a1820" stroke="#60a5fa" strokeWidth="0.5" />
            {/* Helmet Dot */}
            <circle cx="0" cy="-0.2" r="0.9" fill="#ffffff" />
          </g>
        </svg>
      </div>
    </div>
  );
}
