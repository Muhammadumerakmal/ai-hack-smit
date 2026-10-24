"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, MathUtils, Object3D, type Group, type InstancedMesh, type Mesh, type MeshStandardMaterial } from "three";

/*
 * "Attendance clock": twelve staff figures stand on a dial like hour markers. A sweeping hand
 * checks them in one by one (they light up teal, lift slightly, then fade as the day ages), so the
 * scene tells the product's story: people + time + HR status. The palette mirrors the app's
 * status colours (teal present, amber late, sky on leave, dim absent); the violet core is the AI.
 * All geometry is procedural, nothing is downloaded. R3F disposes geometries/materials on unmount.
 */

const PEOPLE = 12;
const RING = 2.5;
const SWEEP_SECONDS = 14; // one "working day" per revolution
const TAU = Math.PI * 2;

type Status = "present" | "late" | "leave" | "absent";
const STATUS: Status[] = ["present", "present", "late", "present", "present", "present", "leave", "present", "present", "absent", "present", "present"];

const COLORS = {
  idle: new Color("#52525b"),
  present: new Color("#2dd4bf"),
  late: new Color("#f59e0b"),
  leave: new Color("#38bdf8"),
  absent: new Color("#3f3f46"),
};

const easeOut = (x: number) => 1 - Math.pow(1 - MathUtils.clamp(x, 0, 1), 3);

/** Hand angle at time t (radians, clockwise seen from above). */
const handAngle = (t: number) => -(t / SWEEP_SECONDS) * TAU;

/** How long ago (0..1 of a revolution) the hand passed angle `phi`. */
function sincePassed(phi: number, t: number) {
  const a = handAngle(t);
  return (((phi - a) % TAU) + TAU) % TAU / TAU;
}

function Person({ index, animated, staticTime }: { index: number; animated: boolean; staticTime: number }) {
  const group = useRef<Group>(null);
  const body = useRef<MeshStandardMaterial>(null);
  const head = useRef<MeshStandardMaterial>(null);
  const status = STATUS[index];
  const phi = (index / PEOPLE) * TAU;
  const x = Math.sin(phi) * RING;
  const z = Math.cos(phi) * RING;
  const tmp = useMemo(() => new Color(), []);

  useFrame(({ clock }) => {
    const t = animated ? clock.elapsedTime : staticTime;
    const g = group.current;
    if (!g || !body.current || !head.current) return;

    // Entrance: figures rise in, one after another.
    const appear = animated ? easeOut((t - 0.35 - index * 0.07) / 0.6) : 1;
    g.scale.setScalar(Math.max(appear, 0.0001) * 0.8);

    // A "day" behind the hand: lit right after check-in, fading as the hand comes round again.
    const since = sincePassed(phi, t);
    const lit = status === "absent" ? 0 : status === "leave" ? 0.55 : 1 - since;
    const pop = status === "absent" || status === "leave" ? 0 : Math.exp(-since * 28);
    g.position.y = 0.14 + pop * 0.16;

    tmp.copy(COLORS.idle).lerp(COLORS[status], MathUtils.clamp(lit * 1.15, 0, 1));
    body.current.color.copy(tmp);
    body.current.emissive.copy(COLORS[status]);
    body.current.emissiveIntensity = status === "absent" ? 0 : 0.08 + lit * 0.45 + pop * 0.9;
    head.current.color.copy(tmp);
    head.current.emissive.copy(COLORS[status]);
    head.current.emissiveIntensity = body.current.emissiveIntensity * 0.8;
  });

  return (
    <group ref={group} position={[x, 0.14, z]} scale={0.8}>
      <mesh position={[0, 0.36, 0]}>
        <capsuleGeometry args={[0.15, 0.3, 6, 16]} />
        <meshStandardMaterial ref={body} roughness={0.42} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.82, 0]}>
        <sphereGeometry args={[0.12, 24, 16]} />
        <meshStandardMaterial ref={head} roughness={0.38} metalness={0.05} />
      </mesh>
    </group>
  );
}

function Ticks() {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      const major = i % 5 === 0;
      o.position.set(Math.sin(a) * 3.0, 0.15, Math.cos(a) * 3.0);
      o.rotation.set(0, a, 0);
      o.scale.set(1, 1, major ? 2.4 : 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, new Color(major ? "#5eead4" : "#3f3f46"));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 60]}>
      <boxGeometry args={[0.025, 0.02, 0.09]} />
      <meshStandardMaterial roughness={0.5} />
    </instancedMesh>
  );
}

function Dial({ animated, staticTime }: { animated: boolean; staticTime: number }) {
  const root = useRef<Group>(null);
  const hand = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const coreMat = useRef<MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    const t = animated ? clock.elapsedTime : staticTime;
    const e = animated ? easeOut(t / 1.4) : 1;
    if (root.current) {
      root.current.position.y = -0.35 * (1 - e);
      root.current.scale.setScalar(0.94 + 0.06 * e);
    }
    if (hand.current) hand.current.rotation.y = handAngle(t);
    if (core.current && coreMat.current) {
      const breathe = animated ? 0.5 + 0.5 * Math.sin(t * 1.6) : 0.6;
      core.current.position.y = 0.42 + breathe * 0.05;
      coreMat.current.emissiveIntensity = 0.55 + breathe * 0.5;
    }
  });

  return (
    <group ref={root}>
      {/* Dial body and rim */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[3.25, 3.4, 0.26, 128]} />
        <meshStandardMaterial color="#1b1e23" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.131, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.12, 3.25, 128]} />
        <meshStandardMaterial color="#0f766e" emissive="#14b8a6" emissiveIntensity={0.35} roughness={0.4} />
      </mesh>
      <Ticks />

      {/* Clock hand + the soft sweep it leaves behind */}
      <group ref={hand} position={[0, 0.16, 0]}>
        <mesh position={[0, 0.03, 1.2]}>
          <boxGeometry args={[0.05, 0.035, 2.4]} />
          <meshStandardMaterial color="#99f6e4" emissive="#2dd4bf" emissiveIntensity={1.1} roughness={0.3} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[2.95, 48, Math.PI / 2, 0.55]} />
          <meshBasicMaterial color="#2dd4bf" transparent opacity={0.08} depthWrite={false} />
        </mesh>
      </group>

      {/* Hub and the AI core (violet is reserved for AI in this product) */}
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.34, 0.38, 0.16, 48]} />
        <meshStandardMaterial color="#1f2024" roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh ref={core} position={[0, 0.44, 0]}>
        <icosahedronGeometry args={[0.11, 3]} />
        <meshStandardMaterial ref={coreMat} color="#6d28d9" emissive="#7c3aed" emissiveIntensity={0.8} roughness={0.3} />
      </mesh>

      {STATUS.map((_, i) => (
        <Person key={i} index={i} animated={animated} staticTime={staticTime} />
      ))}
    </group>
  );
}

const FOV = 34;
const FRAME_WIDTH = 7.5; // dial + figures + breathing room, in world units
const ELEVATION = 0.62; // camera height relative to distance (≈ 32° down onto the dial)

/** Distance that fits the dial across the panel's width, whatever its aspect ratio. */
function fitDistance(aspect: number) {
  const halfV = MathUtils.degToRad(FOV / 2);
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  return Math.max(8, FRAME_WIDTH / 2 / Math.tan(halfH));
}

/** Frames the dial in the upper part of the panel (the copy sits below), with slow drift and pointer parallax. */
function CameraRig({ animated }: { animated: boolean }) {
  // The camera comes from the frame state (not useThree) so React's immutability rules hold.
  useFrame(({ clock, pointer, camera, size }) => {
    const d = fitDistance(size.width / size.height);
    const t = clock.elapsedTime;
    const drift = animated ? Math.sin(t * 0.12) * 0.06 + pointer.x * 0.12 : 0.04;
    const lift = animated ? pointer.y * 0.05 : 0;
    const angle = drift; // orbit a little around the dial
    const target = { x: d * Math.sin(angle), y: d * (ELEVATION + lift), z: d * Math.cos(angle) };
    camera.position.x = MathUtils.lerp(camera.position.x, target.x, animated ? 0.05 : 1);
    camera.position.y = MathUtils.lerp(camera.position.y, target.y, animated ? 0.05 : 1);
    camera.position.z = MathUtils.lerp(camera.position.z, target.z, animated ? 0.05 : 1);
    // Aim below the dial so it sits high in the frame, above the headline.
    camera.lookAt(0, -d * 0.17, 0);
  });
  return null;
}

export default function AttendanceClockScene({ animated = true }: { animated?: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={animated ? "always" : "demand"}
      camera={{ position: [0, 7, 11], fov: FOV, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <fog attach="fog" args={["#0b0d10", 14, 30]} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#a5f3fc", "#0b0b0f", 0.35]} />
      <directionalLight position={[4, 8, 5]} intensity={1.6} color="#ffffff" />
      {/* Soft pool of light on the dial so the figures read against it */}
      <pointLight position={[0, 4.2, 0.6]} intensity={22} distance={10} decay={2} color="#e6fffb" />
      <pointLight position={[-5, 2.5, -4]} intensity={30} distance={16} color="#14b8a6" />
      <pointLight position={[0, 0.9, 0]} intensity={1.2} distance={2.6} color="#8b5cf6" />
      <group rotation={[0, -0.35, 0]}>
        <Dial animated={animated} staticTime={8.6} />
      </group>
      <CameraRig animated={animated} />
    </Canvas>
  );
}
