"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { groundHeight } from "@/components/Terrain";
import type { CarPose } from "@/components/FolioCar";
import { NEURAL_POS } from "@/components/landmarkConfig";
import HolographicMaterial, { type HolographicMaterialProps } from "@/components/HolographicMaterial";
import HologramBase, { HOLO_COLOR, LANDMARK_BASE_SIZE } from "@/components/HologramBase";
import HoloText from "@/components/HoloText";
import HoloKeyPrompt from "@/components/HoloKeyPrompt";
import { NEURAL_LINES } from "@/components/landmarkProjects";
import netData from "@/data/neuralHologram.json";

export { NEURAL_POS };

type NeuralNetworkHologramProps = {
  pose: MutableRefObject<CarPose>;
  inspecting: boolean;
  onNearChange: (near: boolean) => void;
  onInspectToggle: (inspect: boolean) => void;
  /** Night mode uses additive (glowing) blending; in daylight it falls back to normal blending so it stays visible. */
  night?: boolean;
  /** Touch devices get a tap gesture prompt instead of an Enter key. */
  touch?: boolean;
  hologram?: HolographicMaterialProps;
};

/* ---------- network layout (same as the neural-flows visualizer, in its own units) ---------- */

const ARCH: number[] = netData.architecture; // [784, 64, 32, 26]
const LAYER_SPACING = 5.5;
const INPUT_SPACING = 0.24;
const HIDDEN_SPACING = 0.95;
const OUTPUT_SPACING = 0.48;
const INPUT_SIZE = 0.18;
const HIDDEN_R = 0.22;
const OUTPUT_R = 0.19;

const NET_SCALE = 0.22; // network units -> world units (the whole net is ~3.6 wide, ~2.7 tall)
const NET_Y = 1.75; // centre of the network above the plinth top

/* ---------- idle animation (same timing as neural-flows' idle pulse) ---------- */

const IDLE_STEP = 1.3; // seconds per layer hop (flash + travel)
const PULSE_DUR = 1.0; // seconds for a pulse to cross one set of connections
const IDLE_LOOP = ARCH.length * IDLE_STEP;
const IDLE_SPEED = 0.765; // playback speed of the idle animation (1 = original)
const PACKET_R = 0.16; // light packet radius, network units

const flashAt = (t: number, start: number) => {
  const tt = t - start;
  return tt < 0 ? 0 : Math.min(1, tt * 14) * Math.exp(-tt * 4);
};

function layerPositions(layer: number, count: number, x: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  if (layer === 0) {
    const h = 27 * INPUT_SPACING;
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / 28);
      const c = i % 28;
      out.push([x, h / 2 - r * INPUT_SPACING, -h / 2 + c * INPUT_SPACING]);
    }
  } else if (layer === ARCH.length - 1) {
    const h = (count - 1) * OUTPUT_SPACING;
    for (let i = 0; i < count; i++) out.push([x, h / 2 - i * OUTPUT_SPACING, 0]);
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    const h = (rows - 1) * HIDDEN_SPACING;
    const w = (cols - 1) * HIDDEN_SPACING;
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      out.push([x, h / 2 - r * HIDDEN_SPACING, -w / 2 + c * HIDDEN_SPACING]);
    }
  }
  return out;
}

/** Writes a uniform-scale translation matrix straight into an instance buffer. */
function writeInstance(arr: Float32Array, i: number, x: number, y: number, z: number, s: number) {
  const o = i * 16;
  arr[o] = s;
  arr[o + 5] = s;
  arr[o + 10] = s;
  arr[o + 15] = 1;
  arr[o + 12] = x;
  arr[o + 13] = y;
  arr[o + 14] = z;
}

/**
 * Holographic neural network landmark: the 784 > 64 > 32 > 26 letter-recognition MLP from neural-flows,
 * floating above the shared hologram plinth (see HologramBase) like the chess knight, on the road.
 *
 * - nodes and the strongest connections (from the trained weights) use the HolographicMaterial
 * - light packets travel along the connections and every layer flashes in turn, looping like the
 *   idle animation in neural-flows. Only the layer that is currently animating is touched each frame.
 * - it turns slowly on the plinth and is solid (Terrain registers a collider at NEURAL_POS)
 */
export default function NeuralNetworkHologram({
  pose,
  inspecting,
  onNearChange,
  onInspectToggle,
  night = true,
  touch = false,
  hologram,
}: NeuralNetworkHologramProps) {
  const spinRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.InstancedMesh>(null);
  const packetRef = useRef<THREE.InstancedMesh>(null);
  const flashOn = useRef<boolean[]>(ARCH.map(() => false));
  const packetOn = useRef<boolean[]>(ARCH.map(() => false));
  const [isNear, setIsNear] = useState(false);
  const isNearRef = useRef(false);

  const y = groundHeight(NEURAL_POS.x, NEURAL_POS.z);

  const net = useMemo(() => {
    const startX = -((ARCH.length - 1) * LAYER_SPACING) / 2;
    const layers = ARCH.map((count, l) => layerPositions(l, count, startX + l * LAYER_SPACING));
    const offsets: number[] = [];
    let total = 0;
    layers.forEach((p) => {
      offsets.push(total);
      total += p.length;
    });
    offsets.push(total); // offsets[l] .. offsets[l + 1] are the nodes of layer l

    // all nodes merged into one mesh (a few thousand triangles, one draw call)
    const box = new THREE.BoxGeometry(INPUT_SIZE, INPUT_SIZE, INPUT_SIZE);
    const hidden = new THREE.SphereGeometry(HIDDEN_R, 10, 8);
    const output = new THREE.SphereGeometry(OUTPUT_R, 10, 8);
    const nodeRadius = new Float32Array(total);
    const nodePos = new Float32Array(total * 3);
    const parts: THREE.BufferGeometry[] = [];
    layers.forEach((pts, l) => {
      const template = l === 0 ? box : l === ARCH.length - 1 ? output : hidden;
      const rad = l === 0 ? INPUT_SIZE * 0.75 : l === ARCH.length - 1 ? OUTPUT_R : HIDDEN_R;
      pts.forEach(([x, py, z], i) => {
        const g = template.clone();
        g.translate(x, py, z);
        parts.push(g);
        const n = offsets[l] + i;
        nodeRadius[n] = rad;
        nodePos.set([x, py, z], n * 3);
      });
    });
    const nodesGeo = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    [box, hidden, output].forEach((g) => g.dispose());

    // connections: line segments + the data the light packets need (stored layer by layer)
    let connCount = 0;
    const connStart: number[] = [];
    netData.conns.forEach((c) => {
      connStart.push(connCount);
      connCount += c.length / 2;
    });
    connStart.push(connCount); // connStart[l] .. connStart[l + 1] are the connections of hop l
    const linePos = new Float32Array(connCount * 6);
    const lineNormal = new Float32Array(connCount * 6);
    const connSrc = new Float32Array(connCount * 3);
    const connTgt = new Float32Array(connCount * 3);
    let k = 0;
    netData.conns.forEach((flat, l) => {
      for (let j = 0; j < flat.length; j += 2) {
        const s = (offsets[l] + flat[j]) * 3;
        const t = (offsets[l + 1] + flat[j + 1]) * 3;
        for (let a = 0; a < 3; a++) {
          linePos[k * 6 + a] = nodePos[s + a];
          linePos[k * 6 + 3 + a] = nodePos[t + a];
          connSrc[k * 3 + a] = nodePos[s + a];
          connTgt[k * 3 + a] = nodePos[t + a];
        }
        // the hologram shader needs a normal; lines have none, so give every vertex "up"
        lineNormal[k * 6 + 1] = 1;
        lineNormal[k * 6 + 4] = 1;
        k++;
      }
    });
    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    linesGeo.setAttribute("normal", new THREE.BufferAttribute(lineNormal, 3));

    return { total, connCount, offsets, connStart, nodesGeo, linesGeo, nodeRadius, nodePos, connSrc, connTgt };
  }, []);

  const glow = useMemo(
    () => ({
      sphere: new THREE.SphereGeometry(1, 6, 4), // tiny glows, so a low-poly sphere is plenty
      flashMat: new THREE.MeshBasicMaterial({
        color: "#cfeaff",
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      packetMat: new THREE.MeshBasicMaterial({
        color: "#d8f1ff",
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    []
  );

  useEffect(
    () => () => {
      net.nodesGeo.dispose();
      net.linesGeo.dispose();
      glow.sphere.dispose();
      glow.flashMat.dispose();
      glow.packetMat.dispose();
    },
    [net, glow]
  );

  useFrame((state) => {
    const clock = state.clock.elapsedTime;
    const t = (clock * IDLE_SPEED) % IDLE_LOOP;

    // slow turntable spin with a gentle float
    const g = spinRef.current;
    if (g) {
      g.rotation.y = clock * 0.5;
      g.position.y = NET_Y + Math.sin(clock * 1.2) * 0.04;
    }

    // layer flashes: a halo blooms on every node of a layer when its turn comes, then fades.
    // Only layers that are lit (or just went dark) are written, the rest of the buffer is left alone.
    const flash = flashRef.current;
    if (flash) {
      const arr = flash.instanceMatrix.array as Float32Array;
      let dirty = false;
      for (let l = 0; l < ARCH.length; l++) {
        const fl = flashAt(t, l * IDLE_STEP);
        const on = fl > 0.01;
        if (!on && !flashOn.current[l]) continue;
        flashOn.current[l] = on;
        dirty = true;
        for (let i = net.offsets[l]; i < net.offsets[l + 1]; i++) {
          const s = on ? net.nodeRadius[i] * (1.1 + 1.5 * fl) : 0;
          writeInstance(arr, i, net.nodePos[i * 3], net.nodePos[i * 3 + 1], net.nodePos[i * 3 + 2], s);
        }
      }
      if (dirty) flash.instanceMatrix.needsUpdate = true;
    }

    // light packets: each connection layer sends its pulse from source to target, one hop after the other
    const packets = packetRef.current;
    if (packets) {
      const arr = packets.instanceMatrix.array as Float32Array;
      let dirty = false;
      for (let l = 0; l < netData.conns.length; l++) {
        const p = (t - (l * IDLE_STEP + 0.3)) / PULSE_DUR;
        const on = p >= 0 && p <= 1.08;
        if (!on && !packetOn.current[l]) continue;
        packetOn.current[l] = on;
        dirty = true;
        const q = Math.min(1, Math.max(0, p));
        const s = on ? PACKET_R * (p > 1 ? Math.max(0, 1 - (p - 1) / 0.08) : 1) : 0;
        for (let i = net.connStart[l]; i < net.connStart[l + 1]; i++) {
          const o = i * 3;
          writeInstance(
            arr,
            i,
            net.connSrc[o] + (net.connTgt[o] - net.connSrc[o]) * q,
            net.connSrc[o + 1] + (net.connTgt[o + 1] - net.connSrc[o + 1]) * q,
            net.connSrc[o + 2] + (net.connTgt[o + 2] - net.connSrc[o + 2]) * q,
            s
          );
        }
      }
      if (dirty) packets.instanceMatrix.needsUpdate = true;
    }

    // proximity check with the same wide hysteresis as the trophy, so the prompt doesn't flicker at the edge
    const p = pose.current;
    if (p) {
      const dist = Math.hypot(p.x - NEURAL_POS.x, p.z - NEURAL_POS.z);
      const nearNow = isNearRef.current ? dist < 10.0 : dist < 6.5;
      if (nearNow !== isNearRef.current) {
        isNearRef.current = nearNow;
        setIsNear(nearNow);
        onNearChange(nearNow);
      }
    }
  });

  const holo = { hologramColor: HOLO_COLOR, hologramBrightness: 1.3, scanlineSize: 8, enableAdditive: night, ...hologram };

  return (
    <group position={[NEURAL_POS.x, y, NEURAL_POS.z]} rotation={[0, (Math.PI * 50) / 180, 0]}>
      {/* Invisible tap hitbox so the whole landmark is tappable on mobile */}
      <mesh
        position={[0, 2, 0]}
        userData={{ landmark: "neural" }}
        onClick={(e) => { if (isNear && !inspecting) { e.stopPropagation(); onInspectToggle(true); } }}
      >
        <sphereGeometry args={[4.0, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <HologramBase night={night} size={LANDMARK_BASE_SIZE} ringEnd={4.2} lightY={1.9}>
        <group ref={spinRef} position={[0, NET_Y, 0]} scale={NET_SCALE}>
          <mesh geometry={net.nodesGeo}>
            <HolographicMaterial {...holo} />
          </mesh>
          <lineSegments geometry={net.linesGeo}>
            <HolographicMaterial {...holo} />
          </lineSegments>
          <instancedMesh
            ref={flashRef}
            args={[glow.sphere, glow.flashMat, net.total]}
            frustumCulled={false}
            renderOrder={3}
          />
          <instancedMesh
            ref={packetRef}
            args={[glow.sphere, glow.packetMat, net.connCount]}
            frustumCulled={false}
            renderOrder={4}
          />
        </group>

        {/* Neural Flows as free-floating holographic writing, revealed while inspecting */}
        <HoloText lines={NEURAL_LINES} active={inspecting} night={night} mobile={touch} />

        {/* Floating prompt: a quiet orb that becomes an Enter key (or a tap gesture on touch) as the car pulls up */}
        <HoloKeyPrompt
          active={isNear}
          visible={!inspecting}
          onActivate={() => onInspectToggle(true)}
          position={[2.5, 1.9, 0]}
          night={night}
          touch={touch}
        />
      </HologramBase>
    </group>
  );
}
