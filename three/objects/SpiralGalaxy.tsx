"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { useBakedTexture } from "@/three/hooks/useBakedTexture";
import { GALAXY_RADIUS, sampleStars, type ArmField } from "@/lib/galaxyLayout";

const discVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Baked arms tinted violet→blue by radius, warm cream-gold core, offset dust lanes.
const discFragment = /* glsl */ `
uniform sampler2D uEmission;
uniform sampler2D uDust;
uniform float uFade;
varying vec2 vUv;
vec2 rotate(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec3 e = texture2D(uEmission, vUv).rgb;
  float lum = dot(e, vec3(0.3333));
  float dust = texture2D(uDust, rotate(p, -0.16) * 0.5 + 0.5).r;
  vec3 armTint = mix(vec3(0.66, 0.5, 1.0), vec3(0.42, 0.62, 1.0), smoothstep(0.25, 0.9, r));
  vec3 core = vec3(1.0, 0.86, 0.62);
  vec3 col = mix(armTint * lum * 1.7, core * (lum * 1.5 + 0.08), smoothstep(0.28, 0.0, r));
  col *= 1.0 - dust * 0.55 * smoothstep(0.1, 0.35, r);
  float edge = smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(col * edge * uFade, 1.0);
}`;

const starVertex = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uGather;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 scattered = position * 3.2 + vec3(sin(aPhase * 7.0), cos(aPhase * 5.0), sin(aPhase * 3.0)) * 4.0;
  float g = 1.0 - pow(1.0 - uGather, 3.0);
  vec3 pos = mix(scattered, position, g);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + aPhase) + aPhase * 31.0);
  gl_PointSize = aSize * uPixelRatio * twinkle * (14.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = twinkle * mix(0.3, 1.0, g);
}`;

const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * a, a * vAlpha);
}`;

interface SpiralGalaxyProps {
  field: ArmField;
  starCount: number;
  /** 0→1 intro gathering progress, read every frame. */
  gather: { current: number };
  dayColor: string;
  animate: boolean;
}

export function SpiralGalaxy({ field, starCount, gather, dayColor, animate }: SpiralGalaxyProps) {
  const emission = useBakedTexture("/assets/galaxy/stellar-emission-1024.webp");
  const dust = useBakedTexture("/assets/galaxy/dust-absorption-512.webp", 0, false);

  const discMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: discVertex,
    fragmentShader: discFragment,
    uniforms: { uEmission: { value: emission }, uDust: { value: dust }, uFade: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [emission, dust]);

  const stars = useMemo(() => {
    const positions = sampleStars(field, starCount);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    const colors = new Float32Array(starCount * 3);
    const warm = new THREE.Color("#ffe2b0"), violet = new THREE.Color("#b9a2ff"), blue = new THREE.Color("#9cc2ff");
    const c = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const r = Math.hypot(positions[i * 3], positions[i * 3 + 1]) / GALAXY_RADIUS;
      const h = Math.sin(i * 12.9898) * 43758.5453;
      const rand = h - Math.floor(h);
      sizes[i] = 0.6 + rand * rand * 2.4;
      phases[i] = rand;
      c.copy(r < 0.2 ? warm : violet).lerp(blue, Math.min(1, Math.max(0, (r - 0.25) / 0.6)));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: { uTime: { value: 0 }, uGather: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry, material };
  }, [field, starCount]);

  // Weekday color as a few faint nebula patches along the arms, never dominant.
  const nebula = useMemo(() => {
    const count = 36;
    const sampled = sampleStars(field, count, 99);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(sampled, 3));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const material = new THREE.PointsMaterial({
      size: 1.6, map: new THREE.CanvasTexture(canvas), color: dayColor, transparent: true,
      opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    return { geometry, material };
  }, [field, dayColor]);

  const time = useRef(0);
  useFrame((state, delta) => {
    if (animate) time.current += delta;
    stars.material.uniforms.uTime.value = time.current;
    stars.material.uniforms.uGather.value = gather.current;
    stars.material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
    discMaterial.uniforms.uFade.value = Math.min(1, gather.current * 1.2);
  });

  return (
    <group>
      <mesh material={discMaterial} renderOrder={0}>
        <planeGeometry args={[GALAXY_RADIUS * 2, GALAXY_RADIUS * 2]} />
      </mesh>
      <points geometry={nebula.geometry} material={nebula.material} renderOrder={1} />
      <points geometry={stars.geometry} material={stars.material} renderOrder={2} />
    </group>
  );
}
