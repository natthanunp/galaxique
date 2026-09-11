"use client";
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePerfStore } from '@/store/perfStore';
import { COSMIC, VIBE_GRADE } from '@/lib/cosmicVisuals';
import { useBakedTexture } from '@/three/hooks/useBakedTexture';
import type { Vibe } from '@/types/universe';

/** One baked sky draw, shared by all celestial types and direct WebGL exports. */
export function CosmicBackground({ primaryColor, secondaryColor, vibe }: { primaryColor: string; secondaryColor: string; vibe: Vibe }) {
  const size = useThree(s => s.size);
  const tier = usePerfStore(s=>s.tier);
  const texture=useBakedTexture(COSMIC.textureUrl('deep-field', tier));
  const material=useMemo(()=>new THREE.ShaderMaterial({
    uniforms:{uMap:{value:texture},uAspect:{value:size.width/size.height},uImageAspect:{value:1},uTint:{value:new THREE.Color(primaryColor).lerp(new THREE.Color(secondaryColor),.4).lerp(new THREE.Color(VIBE_GRADE[vibe]),.2)}},
    vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,.999,1.);}`,
    fragmentShader:`varying vec2 vUv;uniform sampler2D uMap;uniform vec3 uTint;uniform float uAspect;uniform float uImageAspect;
      void main(){vec2 uv=vUv-.5;if(uAspect>uImageAspect)uv.y*=uImageAspect/uAspect;else uv.x*=uAspect/uImageAspect;vec3 sky=texture2D(uMap,uv+.5).rgb;gl_FragColor=vec4(vec3(.002,.003,.007)+sky*.65*mix(vec3(1.),uTint,.18),1.);}`,
    depthTest:false,depthWrite:false,
  }),[texture,primaryColor,secondaryColor,vibe,size.width,size.height]);
  useEffect(()=>()=>material.dispose(),[material]);
  return <mesh material={material} renderOrder={-1000} frustumCulled={false}><planeGeometry args={[2,2]}/></mesh>;
}
