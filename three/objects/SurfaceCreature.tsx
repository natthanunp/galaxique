"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { CREATURE_MODELS, hasCreatureModel } from "@/three/objects/CreatureModel";
import { createBehavior, DURATIONS, step, type Behavior, type BehaviorEvent, type BehaviorStateName } from "@/three/creature/behavior";
import type { CreatureSpec } from "@/types/universe";

/** Grounded kinds stand on the surface; others perch, hover or drift. */
const STAGING: Record<string, { base: number; height: number; float: number; clip?: string }> = {
  fox: { base: 0, height: 0.85, float: 0, clip: "Survey" },
  cat: { base: 0, height: 0.75, float: 0 },
  bird: { base: 0, height: 0.6, float: 0 },
  dragon: { base: 0.35, height: 1.0, float: 0.06 },
  fish: { base: 0.75, height: 0.55, float: 0.12 },
  jelly: { base: 0.8, height: 0.8, float: 0.14 },
  spirit: { base: 0.7, height: 0.9, float: 0.1 },
};

/** Playback speed of the kind's loop per state; transitions ease between them. */
const TIME_SCALE: Record<BehaviorStateName, number> = {
  sleep: 0.15, rest: 0.3, idle: 0.8, notice: 0.7, greet: 1.1, talk: 1, listen: 0.7, react: 1.2,
};

export interface CreatureController {
  dispatch: (event: BehaviorEvent) => void;
}

interface SurfaceCreatureProps {
  spec: CreatureSpec;
  primaryColor: string;
  /** 0 (cozy, slow) – 1 (intense, snappy); scales motion energy. */
  energy: number;
  quiet: boolean;
  seed: number;
  reducedMotion: boolean;
  controller: React.RefObject<CreatureController | null>;
  onStateChange?: (state: BehaviorStateName, reaction?: string) => void;
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export function SurfaceCreature({ spec, primaryColor, energy, quiet, seed, reducedMotion, controller, onStateChange }: SurfaceCreatureProps) {
  const kind = hasCreatureModel(spec.kind) ? spec.kind : "spirit";
  const model = CREATURE_MODELS[kind];
  const staging = STAGING[kind];
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const shadowMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.3 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying vec2 vUv; uniform float uOpacity; void main() { float radius = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.02, 0.025, 0.02, (1.0 - smoothstep(0.1, 1.0, radius)) * uOpacity); }",
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }), []);
  useEffect(() => () => { shadowMaterial.dispose(); }, [shadowMaterial]);
  const { scene, animations } = useGLTF(model.url);
  const { camera, pointer, clock } = useThree();

  const { object, head, eyes } = useMemo(() => {
    const clone = cloneSkinned(scene) as THREE.Group;
    clone.rotation.y = model.rotationY;
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        if (kind === "spirit" && /glasses/i.test(node.name + node.geometry.name)) node.visible = false;
        const tint = (m: THREE.Material) => {
          const copy = m.clone();
          if (copy instanceof THREE.MeshStandardMaterial) {
            copy.emissive = new THREE.Color(primaryColor);
            copy.emissiveIntensity = 0.05;
          }
          return copy;
        };
        node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
      }
    });
    // Fit to the landing camera and put the feet/base exactly on the ground.
    // Measure bind-pose geometry: a skinned mesh's own box is empty until its skeleton has updated.
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3();
    clone.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      box.union(node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld));
    });
    const size = box.getSize(new THREE.Vector3());
    const scale = staging.height / Math.max(size.y, 1e-6);
    const holder = new THREE.Group();
    clone.scale.multiplyScalar(scale);
    clone.position.set(-(box.min.x + size.x / 2) * scale, -box.min.y * scale, -(box.min.z + size.z / 2) * scale);
    holder.add(clone);
    let headBone: THREE.Object3D | null = null;
    const eyeMeshes: THREE.Object3D[] = [];
    clone.traverse((node) => {
      if (!headBone && (node as THREE.Bone).isBone && /head/i.test(node.name)) headBone = node;
      if (/eye/i.test(node.name) && node instanceof THREE.Mesh) eyeMeshes.push(node);
    });
    return { object: holder, head: headBone as THREE.Object3D | null, eyes: eyeMeshes };
  }, [scene, model, kind, staging.height, primaryColor]);

  const { actions } = useAnimations(animations, body);
  const clipName = staging.clip ?? ("animation" in model ? model.animation : undefined);
  const action = clipName ? actions[clipName] : undefined;

  const behavior = useRef<Behavior>(createBehavior(0, quiet, reducedMotion));
  const lastState = useRef<BehaviorStateName>(quiet ? "sleep" : "idle");
  const lastSince = useRef(0);
  const random = useMemo(() => seeded(seed), [seed]);
  const blink = useRef({ next: 2 + random() * 3, until: 0 });
  const wander = useRef({ yaw: 0, target: 0, next: 0 });
  const pointerSeen = useRef({ x: 0, y: 0, at: -10, nearAt: -10 });
  const press = useRef<number | null>(null);
  const headRest = useMemo(() => head?.quaternion.clone() ?? null, [head]);

  useEffect(() => {
    behavior.current = createBehavior(clock.elapsedTime, quiet, reducedMotion);
    controller.current = {
      dispatch: (event) => { behavior.current = step(behavior.current, event, clock.elapsedTime); },
    };
    return () => { controller.current = null; };
  }, [controller, clock, quiet, reducedMotion]);

  useEffect(() => {
    action?.reset().setEffectiveTimeScale(TIME_SCALE[behavior.current.state]).fadeIn(0.4).play();
    return () => { action?.fadeOut(0.3); };
  }, [action]);

  const amp = (0.6 + energy * 0.8) * (reducedMotion ? 0.3 : 1);
  const tempo = 0.7 + energy * 0.6;
  const toCamera = useMemo(() => new THREE.Vector3(), []);
  const lookQuat = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);

  useFrame((_, delta) => {
    const t = clock.elapsedTime;
    let b = step(behavior.current, { type: "tick" }, t);
    // Visitor's pointer hovering near the creature sparks curiosity (throttled).
    if (pointer.x !== pointerSeen.current.x || pointer.y !== pointerSeen.current.y) {
      pointerSeen.current = { ...pointerSeen.current, x: pointer.x, y: pointer.y, at: t };
      const screen = root.current ? root.current.getWorldPosition(toCamera).project(camera) : null;
      if (screen && Math.hypot(screen.x - pointer.x, screen.y - pointer.y) < 0.22 && t - pointerSeen.current.nearAt > 6) {
        pointerSeen.current.nearAt = t;
        b = step(b, { type: "pointerNear" }, t);
      }
    }
    if (press.current !== null && t - press.current > 0.55) {
      press.current = null;
      b = step(b, { type: "longPress" }, t);
    }
    behavior.current = b;
    if (b.state !== lastState.current || b.since !== lastSince.current) {
      lastState.current = b.state;
      lastSince.current = b.since;
      onStateChange?.(b.state, b.reaction);
    }

    // Clip speed eases toward the state's tempo: a crossfade, never a cut.
    if (action) {
      const goal = TIME_SCALE[b.state] * tempo;
      action.setEffectiveTimeScale(THREE.MathUtils.lerp(action.getEffectiveTimeScale(), goal, 1 - Math.exp(-delta * 3)));
    }

    const g = root.current, inner = body.current;
    if (!g || !inner) return;
    const elapsed = t - b.since;
    let y = staging.base + Math.sin(t * 1.3 * tempo) * staging.float * amp;
    let pitch = 0, roll = 0, yawOffset = 0, squash = 1;
    const breath = Math.sin(t * (b.state === "sleep" || b.state === "rest" ? 0.9 : 1.8) * tempo);
    squash += breath * 0.015 * amp;
    roll += Math.sin(t * 0.37 + seed) * 0.03 * amp; // weight shift

    const facesVisitor = b.state !== "sleep" && b.state !== "rest" && b.state !== "idle";
    if (b.state === "idle") {
      if (t > wander.current.next) {
        wander.current.target = (random() - 0.5) * 0.8;
        wander.current.next = t + 3 + random() * 5;
      }
      wander.current.yaw = THREE.MathUtils.lerp(wander.current.yaw, wander.current.target, 1 - Math.exp(-delta * 0.8));
    }

    switch (b.state) {
      case "sleep":
      case "rest":
        y -= 0.02; pitch += 0.12; yawOffset = 0.6;
        break;
      case "notice":
        pitch -= 0.06 * easeInOut(Math.min(1, elapsed / 0.6));
        break;
      case "greet": {
        const p = Math.min(1, elapsed / DURATIONS.greet);
        if (reducedMotion) { pitch += Math.sin(p * Math.PI) * 0.12; break; }
        if (kind === "fox" || kind === "cat") y += Math.abs(Math.sin(p * Math.PI * 2)) * 0.14 * amp;
        else if (kind === "bird") { y += Math.sin(p * Math.PI) * 0.25; squash += Math.sin(p * Math.PI * 8) * 0.05; }
        else if (kind === "dragon") y += Math.sin(p * Math.PI) * 0.3;
        else if (kind === "spirit") pitch += Math.sin(p * Math.PI) * 0.35;
        else { y += Math.sin(p * Math.PI) * 0.15; roll += Math.sin(p * Math.PI * 2) * 0.25; }
        break;
      }
      case "talk":
        y += Math.abs(Math.sin(t * 9)) * 0.015 * amp;
        break;
      case "listen":
        roll += 0.14;
        break;
      case "react": {
        const p = Math.min(1, elapsed / (b.reaction === "dizzy" ? DURATIONS.dizzy : DURATIONS.react));
        const fade = Math.sin(p * Math.PI);
        if (b.reaction === "happy") y += Math.abs(Math.sin(p * Math.PI * 4)) * 0.12 * amp;
        if (b.reaction === "excited") y += Math.abs(Math.sin(t * 11)) * 0.08 * amp;
        if (b.reaction === "shy") { pitch -= 0.15 * fade; yawOffset = 0.4 * fade; squash -= 0.05 * fade; }
        if (b.reaction === "curious") { roll += 0.24 * fade; pitch += 0.08 * fade; }
        if (b.reaction === "sleepy") { pitch += 0.12 * fade; y -= 0.02 * fade; }
        if (b.reaction === "dizzy") yawOffset = easeInOut(p) * Math.PI * 4;
        break;
      }
    }

    shadowMaterial.uniforms.uOpacity.value = 0.32 / (1 + Math.max(y, 0) * 1.8);
    shadow.current?.scale.setScalar(1 + Math.max(y, 0) * 0.25);

    // Body turns toward the visitor after the head (slower rate).
    const cameraYaw = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
    const goalYaw = (facesVisitor ? cameraYaw : wander.current.yaw) + yawOffset;
    inner.rotation.y = THREE.MathUtils.lerp(inner.rotation.y, goalYaw, 1 - Math.exp(-delta * (b.reaction === "dizzy" ? 10 : 1.6)));
    inner.rotation.x = THREE.MathUtils.lerp(inner.rotation.x, pitch, 1 - Math.exp(-delta * 4));
    inner.rotation.z = THREE.MathUtils.lerp(inner.rotation.z, roll, 1 - Math.exp(-delta * 4));
    g.position.y = THREE.MathUtils.lerp(g.position.y, y, 1 - Math.exp(-delta * 8));
    inner.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

    // Head follows the pointer (if recently moved) or the camera, within natural limits.
    if (head && headRest && b.state !== "sleep") {
      const aimPointer = t - pointerSeen.current.at < 2;
      const yaw = THREE.MathUtils.clamp(aimPointer ? pointer.x * 0.6 : cameraYaw - inner.rotation.y, -0.6, 0.6);
      const tilt = THREE.MathUtils.clamp(aimPointer ? -pointer.y * 0.3 : -0.1, -0.35, 0.35);
      lookQuat.copy(headRest).multiply(new THREE.Quaternion().setFromEuler(euler.set(tilt, yaw, 0)));
      head.quaternion.slerp(lookQuat, 1 - Math.exp(-delta * 5));
    }

    // Irregular blinks.
    if (eyes.length) {
      if (t > blink.current.next) {
        blink.current.until = t + 0.12;
        blink.current.next = t + 2 + random() * 4.5;
      }
      const closed = t < blink.current.until || b.state === "sleep";
      for (const eye of eyes) eye.scale.y = THREE.MathUtils.lerp(eye.scale.y, closed ? 0.1 : 1, 0.5);
    }
  });

  return (
    <>
    <group ref={root} position={[0, staging.base, 0]}>
      <group
        ref={body}
        onPointerDown={(e) => { e.stopPropagation(); press.current = clock.elapsedTime; }}
        onPointerUp={(e) => {
          e.stopPropagation();
          if (press.current !== null) controller.current?.dispatch({ type: "tap" });
          press.current = null;
        }}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; press.current = null; }}
      >
        <primitive object={object} />
      </group>
      <pointLight color={primaryColor} intensity={0.6} distance={3} position={[0.6, staging.height + 0.4, 0.8]} />
    </group>
    <mesh ref={shadow} position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} material={shadowMaterial}>
      <circleGeometry args={[staging.height * 0.65, 24]} />
    </mesh>
    </>
  );
}
