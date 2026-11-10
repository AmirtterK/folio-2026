"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundHeight } from "@/components/Terrain";

export type SignPlacement = {
  id: string;
  x: number;
  z: number;
  rotY: number;
};

/**
 * Sign placements: rotY points the arrow in the ramp's launch direction (local +X),
 * and the bulb face (local +Z) faces the approaching driver.
 *
 * In Three.js with Y-up rotation:
 *   local +X  →  world (cos(rotY), 0, -sin(rotY))   ← arrow direction
 *   local +Z  →  world (sin(rotY), 0,  cos(rotY))   ← face normal (toward viewer)
 *
 * Ramp angle `a` is in math convention: direction = (cos(a), sin(a)) in XZ where Z = sin(a).
 * Three.js rotateY maps +X to (cos(rotY), 0, -sin(rotY)), so rotY = -a makes arrow point
 * along (cos(a), 0, sin(a)) which matches the ramp launch direction.
 * The face normal then points to (sin(-a), 0, cos(-a)) = (-sin(a), 0, cos(a)).
 * The driver approaches from behind the ramp (opposite of launch), i.e. from direction
 * (-cos(a), 0, -sin(a)). We need the face normal to point toward the approaching driver,
 * so we add π to rotY: rotY = -a + π  →  arrow points opposite launch (but we want it
 * pointing IN the launch direction for the chevron). Solution: flip the billboard 180° so
 * the face (bulbs at +Z) points toward the approaching driver, while the arrow still
 * points in the launch direction. We do this by placing the sign *before* the ramp
 * and rotating so the face normal = -rampDir. That means rotY = -a + π → but then arrow
 * points backward. Instead keep rotY = -a and place the sign behind the ramp start so the
 * driver sees the front.
 *
 * Actually the simplest fix: place signs BEFORE the ramp (behind the launch start) so the
 * driver approaches from -rampDir and sees the front (+Z face). Each sign is placed at
 * ramp.x - cos(a)*13, ramp.z - sin(a)*13 (behind the ramp start), and rotY = -a so the
 * arrow points in the launch direction and the face normal points roughly toward the
 * approach path.
 */
export const JUMP_SIGNS: SignPlacement[] = [
  // Mega Kicker: ramp a = -π*0.9, sign placed behind the ramp start
  { id: "mega-kicker",   x: 35 - Math.cos(-Math.PI * 0.9) * 13,  z: 38 - Math.sin(-Math.PI * 0.9) * 13,  rotY: Math.PI * 0.9 },
  // Curva Grande: ramp a = -π*0.25
  { id: "curva-grande",  x: -55 - Math.cos(-Math.PI * 0.25) * 13, z: 25 - Math.sin(-Math.PI * 0.25) * 13, rotY: Math.PI * 0.25 },
  // Serraglio: ramp a = π*0.5
  { id: "serraglio",     x: -40 - Math.cos(Math.PI * 0.5) * 13,   z: -38 - Math.sin(Math.PI * 0.5) * 13,  rotY: -Math.PI * 0.5 },
  // Parabolica: ramp a = π*0.85
  { id: "parabolica",    x: 95 - Math.cos(Math.PI * 0.85) * 13,   z: 12 - Math.sin(Math.PI * 0.85) * 13,  rotY: -Math.PI * 0.85 },
  // Center Kicker: ramp a = 0
  { id: "center-kicker", x: 45 - 13,                               z: 6,                                    rotY: 0 },
];

/**
 * 21 Light bulbs in an arrow formation.
 * Each bulb has a column index (0-8, left-to-right) used by the chasing animation.
 */
const BULB_POSITIONS: { x: number; y: number; col: number }[] = [
  // Shaft: 2 rows of 6 bulbs (columns 0 to 5)
  ...[-1.6, -1.25, -0.9, -0.55, -0.2, 0.15].flatMap((x, col) => [
    { x, y: 0.24, col },
    { x, y: -0.24, col },
  ]),
  // Arrowhead: 3 columns (columns 6 to 8)
  // Column 6 (base of head): 5 bulbs
  { x: 0.65, y: -0.85, col: 6 },
  { x: 0.65, y: -0.42, col: 6 },
  { x: 0.65, y: 0.0, col: 6 },
  { x: 0.65, y: 0.42, col: 6 },
  { x: 0.65, y: 0.85, col: 6 },
  // Column 7 (mid head): 3 bulbs
  { x: 1.15, y: -0.42, col: 7 },
  { x: 1.15, y: 0.0, col: 7 },
  { x: 1.15, y: 0.42, col: 7 },
  // Column 8 (tip of arrow): 1 bulb
  { x: 1.65, y: 0.0, col: 8 },
];

const NUM_COLUMNS = 9;

function buildArrowHousingGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.9, -0.48);
  shape.lineTo(0.45, -0.48);
  shape.lineTo(0.45, -1.2);
  shape.lineTo(2.05, 0.0);
  shape.lineTo(0.45, 1.2);
  shape.lineTo(0.45, 0.48);
  shape.lineTo(-1.9, 0.48);
  shape.closePath();

  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
}

function buildBackingGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.85, -0.44);
  shape.lineTo(0.4, -0.44);
  shape.lineTo(0.4, -1.1);
  shape.lineTo(1.95, 0.0);
  shape.lineTo(0.4, 1.1);
  shape.lineTo(0.4, 0.44);
  shape.lineTo(-1.85, 0.44);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * Bulb socket: a small cylinder + hemisphere cap that sticks out from the backing plate,
 * so each bulb looks physically mounted rather than a flat dot.
 */
function buildBulbGeometry(): THREE.BufferGeometry {
  // Socket base (small cylinder recessed into the backing)
  const socket = new THREE.CylinderGeometry(0.065, 0.075, 0.08, 10);
  socket.rotateX(Math.PI / 2);
  socket.translate(0, 0, 0.04);

  // Bulb dome (hemisphere sticking out)
  const dome = new THREE.SphereGeometry(0.11, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  dome.rotateX(-Math.PI / 2);
  dome.translate(0, 0, 0.08);

  // Merge socket + dome into one piece
  const merged = new THREE.BufferGeometry();
  const socketPos = socket.attributes.position as THREE.BufferAttribute;
  const domePos = dome.attributes.position as THREE.BufferAttribute;
  const totalVerts = socketPos.count + domePos.count;
  const pos = new Float32Array(totalVerts * 3);
  const nrm = new Float32Array(totalVerts * 3);
  for (let i = 0; i < socketPos.count; i++) {
    pos[i * 3] = socketPos.getX(i);
    pos[i * 3 + 1] = socketPos.getY(i);
    pos[i * 3 + 2] = socketPos.getZ(i);
    nrm[i * 3] = (socket.attributes.normal as THREE.BufferAttribute).getX(i);
    nrm[i * 3 + 1] = (socket.attributes.normal as THREE.BufferAttribute).getY(i);
    nrm[i * 3 + 2] = (socket.attributes.normal as THREE.BufferAttribute).getZ(i);
  }
  const off = socketPos.count;
  for (let i = 0; i < domePos.count; i++) {
    pos[(off + i) * 3] = domePos.getX(i);
    pos[(off + i) * 3 + 1] = domePos.getY(i);
    pos[(off + i) * 3 + 2] = domePos.getZ(i);
    nrm[(off + i) * 3] = (dome.attributes.normal as THREE.BufferAttribute).getX(i);
    nrm[(off + i) * 3 + 1] = (dome.attributes.normal as THREE.BufferAttribute).getY(i);
    nrm[(off + i) * 3 + 2] = (dome.attributes.normal as THREE.BufferAttribute).getZ(i);
  }
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));

  // Indices
  const sIdx = socket.index!;
  const dIdx = dome.index!;
  const idx = new Uint16Array(sIdx.count + dIdx.count);
  for (let i = 0; i < sIdx.count; i++) idx[i] = sIdx.getX(i);
  for (let i = 0; i < dIdx.count; i++) idx[sIdx.count + i] = dIdx.getX(i) + off;
  merged.setIndex(new THREE.BufferAttribute(idx, 1));

  socket.dispose();
  dome.dispose();
  return merged;
}

// Shared geometries and materials to keep GPU overhead minimal
let sharedHousingGeo: THREE.BufferGeometry | null = null;
let sharedBackingGeo: THREE.BufferGeometry | null = null;
let sharedBulbGeo: THREE.BufferGeometry | null = null;
let sharedPostGeo: THREE.BufferGeometry | null = null;

function getSharedGeometries() {
  if (!sharedHousingGeo) {
    sharedHousingGeo = buildArrowHousingGeometry();
    sharedBackingGeo = buildBackingGeometry();
    sharedBulbGeo = buildBulbGeometry();
    sharedPostGeo = new THREE.CylinderGeometry(0.065, 0.075, 2.6, 8);
  }
  return {
    housing: sharedHousingGeo,
    backing: sharedBackingGeo!,
    bulb: sharedBulbGeo!,
    post: sharedPostGeo!,
  };
}

function SingleArrowSign({
  sign,
  columnMaterials,
}: {
  sign: SignPlacement;
  columnMaterials: THREE.MeshStandardMaterial[];
}) {
  const y = groundHeight(sign.x, sign.z);
  const geos = useMemo(() => getSharedGeometries(), []);

  const mats = useMemo(
    () => ({
      frame: new THREE.MeshStandardMaterial({
        color: "#f59e0b",
        roughness: 0.35,
        metalness: 0.2,
      }),
      backing: new THREE.MeshStandardMaterial({
        color: "#1a1208",
        roughness: 0.85,
        metalness: 0.1,
      }),
      post: new THREE.MeshStandardMaterial({
        color: "#2a2d34",
        roughness: 0.6,
        metalness: 0.5,
      }),
    }),
    []
  );

  return (
    <group position={[sign.x, y, sign.z]} rotation={[0, sign.rotY, 0]}>
      {/* 2 Support Poles planted into the ground */}
      <mesh position={[-1.1, 1.3, -0.05]} geometry={geos.post} material={mats.post} castShadow />
      <mesh position={[0.2, 1.3, -0.05]} geometry={geos.post} material={mats.post} castShadow />

      {/* Main Arrow Sign Board raised at eye level */}
      <group position={[0, 2.3, 0]}>
        {/* Golden-Yellow Outer Housing with Beveled Rim */}
        <mesh geometry={geos.housing} material={mats.frame} castShadow receiveShadow />

        {/* Dark Backing Plate */}
        <mesh position={[0, 0, 0.23]} geometry={geos.backing} material={mats.backing} />

        {/* 21 Mounted Light Bulbs — socket + dome protruding from backing */}
        {BULB_POSITIONS.map((pos, idx) => (
          <mesh
            key={idx}
            position={[pos.x, pos.y, 0.23]}
            geometry={geos.bulb}
            material={columnMaterials[pos.col]}
            castShadow={false}
          />
        ))}

        {/* Soft amber point light casting real golden illumination onto the grass/ramp */}
        <pointLight
          position={[0.2, 0, 0.6]}
          color="#ffaa00"
          intensity={25}
          distance={8}
          decay={2}
        />
      </group>
    </group>
  );
}

export function JumpArrowSigns() {
  // 9 shared column materials for all signs
  const columnMaterials = useMemo(
    () =>
      Array.from({ length: NUM_COLUMNS }, () =>
        new THREE.MeshStandardMaterial({
          color: "#fff8db",
          emissive: new THREE.Color("#ffaa00"),
          emissiveIntensity: 0.3,
          roughness: 0.15,
          metalness: 0.1,
          toneMapped: false,
        })
      ),
    []
  );

  /**
   * Construction / road-closed style sequential chase animation.
   * Updates only 9 materials once per frame for all 5 signs!
   */
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cycleDuration = 0.9 + 0.35;
    const phase = (t % cycleDuration) / cycleDuration;
    const sweepEnd = 0.9 / cycleDuration;
    const sweepPos = phase < sweepEnd ? (phase / sweepEnd) * NUM_COLUMNS : -99;

    for (let col = 0; col < NUM_COLUMNS; col++) {
      const dist = Math.abs(col - sweepPos);
      const band = Math.max(0, 1 - dist / 1.4);
      columnMaterials[col].emissiveIntensity = 0.3 + band * band * 5.2;
    }
  });

  return (
    <group>
      {JUMP_SIGNS.map((sign) => (
        <SingleArrowSign key={sign.id} sign={sign} columnMaterials={columnMaterials} />
      ))}
    </group>
  );
}
