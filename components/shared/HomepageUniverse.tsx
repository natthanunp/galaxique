"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { useBakedTexture } from "@/three/hooks/useBakedTexture";
import { RenderPerformanceMetrics } from "@/three/scene/RenderPerformanceMetrics";
import { usePerfStore } from "@/store/perfStore";
import { targetDpr, tierDprCap } from "@/lib/perf";
import { useSceneActivity } from "@/lib/useSceneActivity";
import { COSMIC, communityGrade } from "@/lib/cosmicVisuals";

/** Real perspective scene. Window-level input lets the artwork respond while
 * every foreground link and the phone's native scrolling remain usable. */
function MovingUniverse({ color, active }: { color: string; active: boolean }) {
  const size = useThree(state => state.size);
  const clouds = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const time = useRef(0);
  const narrow = size.width < 640;

  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer.current.x = event.clientX / window.innerWidth * 2 - 1;
      pointer.current.y = event.clientY / window.innerHeight * 2 - 1;
    };
    const leave = () => { pointer.current = { x: 0, y: 0 }; };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, [active]);

  useFrame((state, delta) => {
    if (!active) return;
    const camera = state.camera;
    const dt = Math.min(delta, 0.05);
    time.current += dt;
    const t = time.current;
    // A slow camera orbit remains visible on touch devices without taking over swipes.
    const x = pointer.current.x * 1.3 + Math.sin(t * 0.17) * 0.7;
    const y = -pointer.current.y * 0.65 + Math.cos(t * 0.13) * 0.35;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, x, 3, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, y, 3, dt);
    camera.lookAt(0, 0, -2);
    if (clouds.current) {
      clouds.current.rotation.y = Math.sin(t * 0.12) * 0.1;
      clouds.current.rotation.z = Math.sin(t * 0.08) * 0.035;
    }
  });

  return (
    <>
      <color attach="background" args={["#08132a"]} />
      <group ref={clouds} scale={narrow ? [0.7, 1.1, 1] : [1, 1, 1]}>
        <NebulaCloud position={[-10, 4, -9]} color="#3aaeff" rotation={0.45} />
        <NebulaCloud position={[10, 1, -5]} color="#d467c2" rotation={-0.7} />
        <NebulaCloud position={[-3, -8, -2]} color={color} rotation={0.2} />
      </group>
      <DepthStars />
    </>
  );
}

/** Large translucent clouds occupy separate depth planes around the content. */
function NebulaCloud({ position, color, rotation }: { position: [number, number, number]; color: string; rotation: number }) {
  const tier = usePerfStore(state => state.tier);
  const texture = useBakedTexture(COSMIC.textureUrl("deep-field", tier), 96, false);
  const dust = useBakedTexture(COSMIC.textureUrl("dust-absorption", tier), 0, false);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uDust: { value: dust }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vUv; void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D uMap; uniform sampler2D uDust; uniform vec3 uColor;
      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
      }
      void main() {
        vec2 p=vUv-.5;
        float shape=exp(-dot(p*vec2(1.3,1.8),p*vec2(1.3,1.8))*6.);
        vec3 cloud=texture2D(uMap,vUv).rgb;
        float detail=dot(cloud,vec3(.3,.45,.25));
        vec2 q=vUv*5.+vec2(detail*.5,detail*.3);
        float fine=noise(q)*.52+noise(q*2.1)*.28+noise(q*4.3)*.14+noise(q*8.7)*.06;
        float dust=texture2D(uDust,vUv).r;
        float density=shape*(.12+smoothstep(.25,.78,fine)*1.25+detail*.3)*(1.-dust*.35);
        density*=smoothstep(0.,.08,vUv.x)*smoothstep(0.,.08,1.-vUv.x)*smoothstep(0.,.08,vUv.y)*smoothstep(0.,.08,1.-vUv.y);
        vec3 tint=mix(uColor,vec3(.67,.8,1.),clamp(detail*1.3,0.,.45));
        gl_FragColor=vec4(tint*1.3,clamp(density,0.,.85));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), [texture, dust, color]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh position={position} rotation={[0, 0, rotation]} material={material}><planeGeometry args={[38, 30]} /></mesh>;
}

/** Stars occupy a volume in front of and behind the galaxy, so camera motion
 * produces real perspective/parallax rather than sliding a background image. */
function DepthStars() {
  const tier = usePerfStore(state => state.tier);
  const count = tier === "low" ? 350 : tier === "medium" ? 650 : 1000;
  const geometry = useMemo(() => {
    let seed = 1701;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([(random() - 0.5) * 90, (random() - 0.5) * 65, -40 + random() * 49], i * 3);
      const warmth = random();
      colors.set([0.65 + warmth * 0.3, 0.72 + warmth * 0.16, 1 - warmth * 0.25], i * 3);
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    result.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return result;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points geometry={geometry}>
      <shaderMaterial
        vertexColors
        transparent
        depthWrite={false}
        vertexShader={`varying vec3 vColor; void main() {
          vColor = color; vec4 view = modelViewMatrix * vec4(position, 1.);
          gl_PointSize = clamp(28. / max(1., -view.z), 1.1, 3.);
          gl_Position = projectionMatrix * view;
        }`}
        fragmentShader={`varying vec3 vColor; void main() {
          float r = length(gl_PointCoord - .5);
          gl_FragColor = vec4(vColor, (1. - smoothstep(.05, .5, r)) * .75);
        }`}
      />
    </points>
  );
}

export default function HomepageUniverse({ vibeStats }: { vibeStats?: Record<string, number> | null }) {
  const active = useSceneActivity();
  const tier = usePerfStore(state => state.tier);
  const color = communityGrade(vibeStats);
  useEffect(() => { usePerfStore.getState().initialize(); }, []);

  return (
    <div aria-hidden data-testid="homepage-universe" className="pointer-events-none fixed inset-0 -z-10 bg-[#03050c]">
      <Canvas
        camera={{ position: [0, 0, 17], fov: 50, near: 0.1, far: 100 }}
        dpr={tierDprCap(tier, targetDpr())}
        frameloop={active ? "always" : "demand"}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
        fallback={<div className="h-full w-full bg-[url('/assets/galaxy/galaxy-desktop.webp')] bg-cover bg-center" />}
      >
        <MovingUniverse color={color} active={active} />
        <RenderPerformanceMetrics adapt={active} />
      </Canvas>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,12,.12),transparent_45%,rgba(3,5,12,.08))]" />
    </div>
  );
}
