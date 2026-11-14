"use client";

/**
 * three.js showcase models ported to react-three-fiber (WebGL):
 *  - Coffeemat      <- webgl_loader_gltf_compressed (GLB with meshopt + KTX2/Basis textures)
 *                      Includes the animated robotic hand holding the coffee cup & Oreo!
 *  - Kinematics bot <- webgl_loader_collada_kinematics (Collada ABB robot with animated joints)
 *
 * Models live in /public/models/examples/ (full 4.78MB coffeemat.glb, 5.15MB abb_irb52_7_120.dae).
 * Basis Universal transcoder lives in /public/basis/.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { groundHeight } from "@/components/Terrain";
import { setCircleColliders, clearCircleColliders } from "@/components/trackCollision";

/**
 * Where the example models stand in the infield/center.
 * The robot arm used to stand right on top of the diploma (8, 40); it is now out in the open, 20 units east of it.
 */
export const EXAMPLE_POSITIONS = {
  coffeemat: [18, 0, 42] as [number, number, number],
  robot: [28, 0, 40] as [number, number, number],
};

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

class ModelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[examples] model error:", err);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function prepareMesh(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      // Many CAD/Collada files omit vertex normals â€” compute them so shaders can light the surfaces
      if (!m.geometry.attributes.normal) {
        m.geometry.computeVertexNormals();
      }
      m.castShadow = true;
      m.receiveShadow = true;
          }
  });
}

/* ------------------------------------------------------------------ */
/* Coffeemat (GLB + meshopt + KTX2/Basis textures + Oreo robot hand)   */
/* ------------------------------------------------------------------ */

const COFFEE_SCALE = 0.035;

function CoffeematModel({ position }: { position: [number, number, number] }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const [obj, setObj] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Generate a lightweight procedural studio environment for metallic PBR reflections
    // (Prevents metals and chrome parts from rendering completely black at night)
    const pmrem = new THREE.PMREMGenerator(gl);
    const roomEnv = new RoomEnvironment();
    const envTex = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmrem.dispose();

    // Setup KTX2Loader using our local basis transcoder
    const ktx2 = new KTX2Loader()
      .setTranscoderPath("/basis/")
      .detectSupport(gl);

    const loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2);
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load(
      "/models/examples/coffeemat.glb",
      (gltf) => {
        if (cancelled) return;
        prepareMesh(gltf.scene);

        // Give the PBR materials proper environment reflections & lighting
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((mat) => {
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.envMap = envTex;
                mat.envMapIntensity = 1.2;
                mat.roughness = Math.max(0.15, mat.roughness);
                mat.needsUpdate = true;
              }
            });
          }
        });

        // Compute exact bounding box and place flush on the ground
        const box = new THREE.Box3().setFromObject(gltf.scene);
        gltf.scene.position.y -= box.min.y;

        console.log("[examples] coffeemat loaded with textures & Oreo hand!");
        setObj(gltf.scene);
      },
      undefined,
      (err) => console.error("[examples] coffeemat load error:", err),
    );

    return () => {
      cancelled = true;
      ktx2.dispose();
      envTex.dispose();
    };
  }, [gl, scene]);

  if (!obj) return null;
  const [x, , z] = position;
  const y = groundHeight(x, z);

  return (
    <group position={[x, y, z]} rotation={[0, Math.PI / 4, 0]} scale={COFFEE_SCALE}>
      {/* Local showcase spotlight so the coffee machine, Oreo, and cup are brightly lit */}
      <pointLight position={[0, 160, 80]} intensity={45} distance={300} color="#fff6ea" />
      <primitive object={obj} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Collada kinematics robot (ABB IRB52 arm)                            */
/* ------------------------------------------------------------------ */

const ROBOT_SCALE = 3.5;

function KinematicsRobot({ position }: { position: [number, number, number] }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  const kin = useRef<any>(null);
  const current = useRef<Record<string, number>>({});
  const target = useRef<Record<string, number>>({});
  const nextPick = useRef(0);

  useEffect(() => {
    let cancelled = false;
    new ColladaLoader().load(
      "/models/examples/abb_irb52_7_120.dae",
      (collada) => {
        if (cancelled) return;
        prepareMesh(collada.scene);

        kin.current = (collada as any).kinematics;
        const joints = (collada as any).kinematics?.joints ?? {};
        for (const name of Object.keys(joints)) {
          if (!joints[name].static) current.current[name] = joints[name].zeroPosition ?? 0;
        }

        // ABB Industrial Robot Palette (Orange body with dark steel joint accents)
        const abbOrange = new THREE.MeshStandardMaterial({
          color: new THREE.Color("#e8580d"),
          roughness: 0.3,
          metalness: 0.15,
        });
        const darkSteel = new THREE.MeshStandardMaterial({
          color: new THREE.Color("#3d444b"),
          roughness: 0.4,
          metalness: 0.6,
        });

        collada.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.geometry.computeVertexNormals();
            const parentName = (mesh.parent?.name || mesh.name).toLowerCase();
            if (parentName.includes("base") || parentName.includes("4") || parentName.includes("6")) {
              mesh.material = darkSteel;
            } else {
              mesh.material = abbOrange;
            }
          }
        });

        // Align base flush on ground
        const box = new THREE.Box3().setFromObject(collada.scene);
        collada.scene.position.y -= box.min.y;

        console.log("[examples] ABB kinematics robot loaded!");
        setObj(collada.scene);
      },
      undefined,
      (err) => console.error("[examples] Collada robot load error:", err),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  // solid: the car can't drive through the arm's base (a circle sized from the model's footprint)
  useEffect(() => {
    if (!obj) return;
    obj.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    const r = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 0.5 * ROBOT_SCALE * 0.45, 1.2, 2.6);
    setCircleColliders("landmark-robot", [{ x: position[0], z: position[2], r }]);
    return () => clearCircleColliders("landmark-robot");
  }, [obj, position]);

  // Animate robot joints smoothly
  useFrame((state, dt) => {
    const k = kin.current;
    if (!k) return;
    const t = state.clock.elapsedTime;
    if (t > nextPick.current) {
      nextPick.current = t + 2 + Math.random() * 3;
      for (const name of Object.keys(current.current)) {
        const j = k.joints[name];
        if (j && j.limits) {
          target.current[name] = THREE.MathUtils.lerp(j.limits.min, j.limits.max, Math.random());
        }
      }
    }
    const a = 1 - Math.exp(-dt * 2.0);
    for (const name of Object.keys(current.current)) {
      const goal = target.current[name] ?? current.current[name];
      current.current[name] += (goal - current.current[name]) * a;
      k.setJointValue(name, current.current[name]);
    }
  });

  if (!obj) return null;
  const [x, , z] = position;
  const y = groundHeight(x, z);

  return (
    <group position={[x, y, z]} rotation={[0, (Math.PI * 50) / 180, 0]} scale={ROBOT_SCALE}>
      {/* Showcase light for the robotic arm */}
      <pointLight position={[0, 4, 2]} intensity={25} distance={15} color="#ffffff" />
      <primitive object={obj} />
    </group>
  );
}
/* ------------------------------------------------------------------ */
/* Main exported component                                            */
/* ------------------------------------------------------------------ */

export default function ExampleModels() {
  const [rx, , rz] = EXAMPLE_POSITIONS.robot;
  return (
    <group>
      {/* Coffeemat model commented out per user request â€” no asset is loaded */}
      {/* <ModelErrorBoundary>
        <CoffeematModel position={EXAMPLE_POSITIONS.coffeemat} />
      </ModelErrorBoundary> */}
      <ModelErrorBoundary>
        <KinematicsRobot position={EXAMPLE_POSITIONS.robot} />
      </ModelErrorBoundary>

    </group>
  );
}


