"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const COUNT = 2;
const TAIL = 1.1;
const HALF_WIDTH = 0.01;

interface Meteor { x: number; y: number; z: number; dx: number; dy: number; speed: number; age: number; life: number; wait: number }

const idle = (): Meteor => ({ x: 0, y: 0, z: 0, dx: 0, dy: 0, speed: 0, age: 0, life: 0, wait: 3 + Math.random() * 8 });

/** Occasional shooting stars streaking across the view, independent of the galaxy's tilt and spin. */
export function Meteors({ animate }: { animate: boolean }) {
  const meteors = useRef<Meteor[]>(null as unknown as Meteor[]);
  const reduced = useMemo(() => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const { geometry, positions, colors } = useMemo(() => {
    const positions = new Float32Array(COUNT * 9);
    const colors = new Float32Array(COUNT * 9);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    return { geometry, positions, colors };
  }, []);

  useFrame((_, delta) => {
    if (!animate || reduced) return;
    meteors.current ??= Array.from({ length: COUNT }, idle);
    const dt = Math.min(delta, 0.05);

    meteors.current.forEach((m, i) => {
      if (m.life === 0) {
        m.wait -= dt;
        if (m.wait > 0) return;
        // Spawn along the top/right and fall toward the lower left at a varied angle.
        const angle = Math.PI * (1.12 + Math.random() * 0.2);
        m.dx = Math.cos(angle);
        m.dy = Math.sin(angle);
        m.x = -2 + Math.random() * 12;
        m.y = 2 + Math.random() * 5;
        m.z = -2 + Math.random() * 4;
        m.speed = 9 + Math.random() * 6;
        m.life = 0.7 + Math.random() * 0.6;
        m.age = 0;
      }

      m.age += dt;
      if (m.age >= m.life) {
        Object.assign(m, idle());
        positions.fill(0, i * 9, i * 9 + 9);
        colors.fill(0, i * 9, i * 9 + 9);
        return;
      }

      const travelled = m.age * m.speed;
      const hx = m.x + m.dx * travelled;
      const hy = m.y + m.dy * travelled;
      const tx = hx - m.dx * TAIL;
      const ty = hy - m.dy * TAIL;
      const nx = -m.dy * HALF_WIDTH;
      const ny = m.dx * HALF_WIDTH;
      positions.set([hx + nx, hy + ny, m.z, hx - nx, hy - ny, m.z, tx, ty, m.z], i * 9);

      const t = m.age / m.life;
      const fade = Math.min(1, t * 8) * Math.min(1, (1 - t) * 3);
      colors.set([0.95 * fade, 0.97 * fade, fade, 0.95 * fade, 0.97 * fade, fade, 0, 0, 0], i * 9);
    });

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  });

  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={5} raycast={() => null}>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}
